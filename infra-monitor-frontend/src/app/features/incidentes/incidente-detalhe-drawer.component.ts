import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, take } from 'rxjs';

import { ApiErrorCode, isApiError } from '../../core/models/api-error';
import { IncidentClosureReason, IncidentStatus, LatencyClosureReason, MeasurementStatus, isIncidentOpen } from '../../core/models/api-enums';
import { DashboardIncidenteResponse, IncidentKind } from '../../core/models/dashboard-incidente';
import { EpisodioLatenciaResponse } from '../../core/models/episodio-latencia';
import { IncidenteResponse } from '../../core/models/incidente';
import { NotificacaoResponse } from '../../core/models/notificacao';
import { HistoricoMedicaoResponse } from '../../core/models/relatorio';
import { AuthStateService } from '../../core/services/auth-state.service';
import { EpisodioLatenciaApiService } from '../../core/services/episodio-latencia-api.service';
import { IncidenteApiService } from '../../core/services/incidente-api.service';
import { MonitorApiService } from '../../core/services/monitor-api.service';
import { NotificacaoApiService } from '../../core/services/notificacao-api.service';
import { RelatorioApiService } from '../../core/services/relatorio-api.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { duracaoDe, rotuloEvento, rotuloMotivoEncerramento } from './ocorrencia';
import { OcorrenciaGraficoComponent } from './ocorrencia-grafico.component';
import { IncidenteTimelineComponent } from './timeline/incidente-timeline.component';
import { LimiaresMonitor, derivarTimeline } from './timeline/timeline';

type Estado = 'loading' | 'success' | 'error' | 'not-found';
type EstadoBloco = 'loading' | 'success' | 'error';

/** Folga em torno da janela: mostra a subida e a normalização, não só o miolo. */
const FOLGA_MINUTOS = 5;
const MEDICOES_NA_JANELA = 200;
const NOTIFICACOES_NA_JANELA = 20;

/**
 * Recorte comum a incidente e episódio. As duas origens têm formas de resposta
 * diferentes; o drawer normaliza uma vez na carga e todo o resto da tela lê daqui.
 */
interface OcorrenciaDetalhe {
  tipo: IncidentKind;
  id: number;
  status: IncidentStatus;
  iniciadoEm: string;
  encerradoEm: string | null;
  motivo: string | null;
  observacao: string | null;
  limiarMs: number | null;
  /** Só o episódio tem: N de medições consecutivas que o abriu e que o fecha. */
  ciclosParaEpisodio: number | null;
  reconhecidoEm: string | null;
  reconhecidoPorNome: string | null;
  /** Só o incidente tem: nulo em FECHADO significa fechamento automático pelo motor. */
  fechadoPorNome: string | null;
  /** Só o incidente tem. Ausente é o caso comum: fechado antes da V19 que o introduziu. */
  motivoEncerramento: IncidentClosureReason | null;
  /** Só o episódio tem. */
  motivoEncerramentoEpisodio: LatencyClosureReason | null;
  monitorId: number; monitorNome: string;
  equipamentoId: number; equipamentoNome: string;
  unidadeId: number; unidadeNome: string;
}

/**
 * Gaveta única de detalhe da ocorrência: serve incidente de indisponibilidade e episódio
 * de latência. Substitui as duas páginas cheias que existiam antes — `incidente-detail` e
 * `episodio-detalhe` —, que mostravam o mesmo tipo de informação em layouts diferentes.
 *
 * As duas rotas (`/incidentes/:id` e `/incidentes/latencia/:id`) continuam existindo e
 * apontam para a lista, que monta esta gaveta. O deep-link segue compartilhável: o link
 * sai em notificação do Telegram e é colado em chamado. O tipo vem da rota que casou, não
 * de um parâmetro novo — as duas sequências de id colidem e o id sozinho não diz de qual
 * origem a ocorrência veio.
 *
 * Cada bloco carrega e falha por conta própria: medições, monitor ou notificações que
 * caem marcam só o seu card, nunca derrubam a gaveta — mesmo padrão do drawer de
 * equipamento.
 */
@Component({
  selector: 'app-incidente-detalhe-drawer',
  imports: [DatePipe, RouterLink, StatusBadgeComponent, ConfirmDialogComponent,
    OcorrenciaGraficoComponent, IncidenteTimelineComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './incidente-detalhe-drawer.component.html',
  styleUrl: './incidente-detalhe-drawer.component.scss',
})
export class IncidenteDetalheDrawerComponent {
  private readonly incidentesApi = inject(IncidenteApiService);
  private readonly episodiosApi = inject(EpisodioLatenciaApiService);
  private readonly monitoresApi = inject(MonitorApiService);
  private readonly relatorios = inject(RelatorioApiService);
  private readonly notificacoesApi = inject(NotificacaoApiService);
  protected readonly authState = inject(AuthStateService);

  readonly tipo = input.required<IncidentKind>();
  readonly ocorrenciaId = input.required<number>();
  /** Linha já carregada pela lista: o cabeçalho pinta antes de qualquer resposta. */
  readonly linha = input<DashboardIncidenteResponse | null>(null);

  readonly fechar = output<void>();
  /** Reconhecimento ou fechamento concluído: a lista e os contadores recarregam. */
  readonly mudou = output<void>();

  protected readonly IncidentKind = IncidentKind;
  protected readonly folgaMinutos = FOLGA_MINUTOS;

  protected readonly ocorrencia = signal<OcorrenciaDetalhe | null>(null);
  protected readonly estado = signal<Estado>('loading');
  protected readonly erro = signal<string | null>(null);

  protected readonly medicoes = signal<HistoricoMedicaoResponse[]>([]);
  protected readonly medicoesEstado = signal<EstadoBloco>('loading');

  protected readonly notificacoes = signal<NotificacaoResponse[]>([]);
  protected readonly notificacoesEstado = signal<EstadoBloco>('loading');

  /** Nulo enquanto o monitor não respondeu: sem ele a timeline omite o "de N" do rótulo. */
  protected readonly limiares = signal<LimiaresMonitor>({ falhasParaIncidente: null, sucessosParaRecovery: null });

  protected readonly reconhecendo = signal(false);
  protected readonly resolvendo = signal(false);
  protected readonly confirmarResolucao = signal(false);

  /** Elemento que abriu a gaveta: o foco volta para ele ao fechar. */
  private readonly gatilho = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  private readonly painel = viewChild<ElementRef<HTMLElement>>('painel');

  constructor() {
    // Mesma sequência de foco do drawer de equipamento: o painel recebe o foco ao abrir
    // para que o Tab continue de dentro da gaveta, e o devolve ao gatilho ao fechar.
    effect(() => this.painel()?.nativeElement.focus());
    effect(() => {
      const id = this.ocorrenciaId();
      const tipo = this.tipo();
      this.confirmarResolucao.set(false);
      this.carregar(tipo, id);
    });
  }

  // ---- Carga -------------------------------------------------------------------

  protected recarregar(): void { this.carregar(this.tipo(), this.ocorrenciaId()); }

  private carregar(tipo: IncidentKind, id: number, aviso?: string): void {
    this.estado.set('loading');
    this.erro.set(aviso ?? null);
    // Anotado de propósito: sem o tipo da união explícito, `pipe` recai sobre a união das
    // assinaturas de `subscribe` e o TypeScript perde a inferência dos callbacks.
    const requisicao: Observable<IncidenteResponse | EpisodioLatenciaResponse> =
      tipo === IncidentKind.Latency ? this.episodiosApi.getById(id) : this.incidentesApi.getById(id);
    requisicao.pipe(take(1)).subscribe({
      next: (resposta) => {
        const ocorrencia = tipo === IncidentKind.Latency
          ? deEpisodio(resposta as EpisodioLatenciaResponse)
          : deIncidente(resposta as IncidenteResponse);
        this.ocorrencia.set(ocorrencia);
        this.estado.set('success');
        this.carregarMedicoes(ocorrencia);
        this.carregarLimiares(ocorrencia);
        this.carregarNotificacoes(ocorrencia);
      },
      error: (erro) => {
        if (temCodigo(erro, ApiErrorCode.ResourceNotFound)) this.estado.set('not-found');
        else { this.erro.set(mensagemDe(erro, 'Não foi possível carregar a ocorrência.')); this.estado.set('error'); }
      },
    });
  }

  /**
   * Janela real da ocorrência mais a folga. Ocorrência em curso usa "agora" como fim: sem
   * isso o gráfico terminaria no início e não mostraria nada do que está acontecendo.
   */
  protected carregarMedicoes(ocorrencia = this.ocorrencia()): void {
    if (!ocorrencia) return;
    this.medicoesEstado.set('loading');
    const folga = FOLGA_MINUTOS * 60 * 1000;
    const inicio = new Date(new Date(ocorrencia.iniciadoEm).getTime() - folga);
    const fimBase = ocorrencia.encerradoEm ? new Date(ocorrencia.encerradoEm).getTime() : Date.now();
    const fim = new Date(fimBase + folga);
    this.relatorios.getMedicoes({
      inicio: inicio.toISOString(), fim: fim.toISOString(), monitorId: ocorrencia.monitorId,
      size: MEDICOES_NA_JANELA, sort: { field: 'executadoEm', direction: 'asc' },
    }).pipe(take(1)).subscribe({
      next: (pagina) => { this.medicoes.set(pagina.content); this.medicoesEstado.set('success'); },
      error: () => { this.medicoes.set([]); this.medicoesEstado.set('error'); },
    });
  }

  /**
   * `falhasParaIncidente` é o N de "tentativa n/N" e não vem no incidente: ele mora na
   * configuração do monitor. Falhar aqui não tira a timeline do ar — os eventos de falha
   * continuam, só perdem o denominador.
   */
  private carregarLimiares(ocorrencia: OcorrenciaDetalhe): void {
    this.limiares.set({ falhasParaIncidente: null, sucessosParaRecovery: null });
    this.monitoresApi.getById(ocorrencia.monitorId).pipe(take(1)).subscribe({
      next: (monitor) => this.limiares.set({
        falhasParaIncidente: monitor.falhasParaIncidente,
        sucessosParaRecovery: monitor.sucessosParaRecovery,
      }),
      error: () => this.limiares.set({ falhasParaIncidente: null, sucessosParaRecovery: null }),
    });
  }

  protected carregarNotificacoes(ocorrencia = this.ocorrencia()): void {
    if (!ocorrencia) return;
    this.notificacoesEstado.set('loading');
    // Âncoras mutuamente exclusivas: as duas juntas o backend recusa com 400.
    const ancora = ocorrencia.tipo === IncidentKind.Latency
      ? { episodioLatenciaId: ocorrencia.id }
      : { incidenteId: ocorrencia.id };
    this.notificacoesApi.list({ ...ancora, size: NOTIFICACOES_NA_JANELA, sort: 'createdAt,asc' })
      .pipe(take(1)).subscribe({
        next: (pagina) => { this.notificacoes.set(pagina.content); this.notificacoesEstado.set('success'); },
        error: () => { this.notificacoes.set([]); this.notificacoesEstado.set('error'); },
      });
  }

  // ---- Timeline ----------------------------------------------------------------

  protected readonly eventos = computed(() => {
    const ocorrencia = this.ocorrencia();
    if (!ocorrencia) return [];
    return derivarTimeline({
      ocorrencia, medicoes: this.medicoes(), limiares: this.limiares(), notificacoes: this.notificacoes(),
    });
  });

  // ---- KPIs --------------------------------------------------------------------

  protected readonly emCurso = computed(() => this.ocorrencia()?.encerradoEm === null);

  /** Mesma derivação da coluna DURAÇÃO da lista: as duas telas leem a mesma ocorrência. */
  protected readonly duracao = computed(() => {
    const ocorrencia = this.ocorrencia();
    return ocorrencia ? duracaoDe(ocorrencia.iniciadoEm, ocorrencia.encerradoEm) : '—';
  });

  /** Só as medições dentro da janela: a folga é contexto visual, não amostra. */
  private readonly medicoesDaJanela = computed(() => {
    const ocorrencia = this.ocorrencia();
    if (!ocorrencia) return [];
    const inicio = new Date(ocorrencia.iniciadoEm).getTime();
    const fim = ocorrencia.encerradoEm ? new Date(ocorrencia.encerradoEm).getTime() : Date.now();
    return this.medicoes().filter((medicao) => {
      const instante = new Date(medicao.executadoEm).getTime();
      return instante >= inicio && instante <= fim;
    });
  });

  private readonly latencias = computed(() => this.medicoesDaJanela()
    .filter((medicao) => medicao.status !== MeasurementStatus.Failure && medicao.latenciaMs !== null)
    .map((medicao) => medicao.latenciaMs as number));

  protected readonly latenciaMedia = computed(() => {
    const valores = this.latencias();
    return valores.length ? Math.round(valores.reduce((a, b) => a + b, 0) / valores.length) : null;
  });

  protected readonly latenciaPico = computed(() => {
    const valores = this.latencias();
    return valores.length ? Math.max(...valores) : null;
  });

  protected readonly medicoesAcimaDoLimiar = computed(() => {
    const limiar = this.ocorrencia()?.limiarMs;
    if (limiar === null || limiar === undefined) return null;
    return this.latencias().filter((valor) => valor > limiar).length;
  });

  protected readonly falhasNaJanela = computed(() =>
    this.medicoesDaJanela().filter((medicao) => medicao.status === MeasurementStatus.Failure).length);

  protected readonly amostras = computed(() => this.medicoesDaJanela().length);

  // ---- Cor dos KPIs ------------------------------------------------------------
  //
  // Mesmas regras já valendo no drawer de equipamento, e nenhuma inventada aqui:
  //   · cor de severidade escala com o valor (Status);
  //   · cor de métrica é fixa e identifica a métrica, não o estado dela — azul para
  //     latência, âmbar para limiar e para violação, vermelho para falha;
  //   · cor nunca aparece sozinha em cima de dado ausente: sem contagem, sem cor.
  // Contagem só ganha tom quando passa de zero: zero medido e contagem desconhecida
  // (medições que não voltaram) ficam ambos neutros. A diferença entre os dois aparece
  // no texto ("0" contra "indisponível"), não na cor.

  /** Toda contagem derivada de medição só é fato depois que o bloco respondeu. */
  protected readonly medicoesProntas = computed(() => this.medicoesEstado() === 'success');

  protected readonly severidadeStatus = computed(() => {
    switch (this.statusExibido()) {
      case IncidentStatus.Open: return 'kpi--down';
      case IncidentStatus.Acknowledged: return 'kpi--warn';
      case IncidentStatus.Closed: return 'kpi--ok';
      default: return '';
    }
  });

  /**
   * Ocorrência em curso é a única leitura de tempo com carga operacional: a duração ainda
   * está crescendo. Encerrada, é histórico, e histórico não alarma. Sem escala por
   * quanto tempo faz — o domínio não tem limiar de duração para justificar uma.
   */
  protected readonly corDuracao = computed(() => (this.emCurso() ? 'kpi__valor--em-curso' : ''));

  protected readonly corLimiar = computed(() =>
    (this.ocorrencia()?.limiarMs === null || this.ocorrencia()?.limiarMs === undefined ? '' : 'kpi--warn'));

  protected readonly corPico = computed(() => ((this.latenciaPico() ?? 0) > 0 ? 'kpi--down' : ''));

  protected readonly corLatenciaMedia = computed(() => (this.latenciaMedia() === null ? '' : 'kpi--info'));

  protected readonly corAcimaDoLimiar = computed(() =>
    (this.medicoesProntas() && (this.medicoesAcimaDoLimiar() ?? 0) > 0 ? 'kpi--warn' : ''));

  /** Tom só quando há o que alertar: zero é neutro, não alerta; sem contagem, também. */
  protected readonly corFalhas = computed(() =>
    (this.medicoesProntas() && this.falhasNaJanela() > 0 ? 'kpi--down' : ''));

  // ---- Ações -------------------------------------------------------------------

  /**
   * Reconhecer só existe para incidente, e só enquanto ABERTO: é "eu vi", acontece uma
   * vez. Episódio de latência fecha sozinho quando a latência normaliza e não tem estado
   * equivalente — por isso a gaveta de latência não mostra ação nenhuma.
   */
  protected readonly podeReconhecer = computed(() => {
    const ocorrencia = this.ocorrencia();
    return !!ocorrencia && ocorrencia.tipo === IncidentKind.Incident
      && this.authState.canCloseIncident() && ocorrencia.status === IncidentStatus.Open;
  });

  /**
   * Resolver vale para ABERTO e para RECONHECIDO: reconhecer não encerra nada. A condição
   * vem de `isIncidentOpen`, espelho de `StatusIncidente.EM_ABERTO` no backend — escrita à
   * mão como `status !== Open`, ela já travou o botão quando RECONHECIDO entrou no domínio.
   */
  protected readonly podeResolver = computed(() => {
    const ocorrencia = this.ocorrencia();
    return !!ocorrencia && ocorrencia.tipo === IncidentKind.Incident
      && this.authState.canCloseIncident() && isIncidentOpen(ocorrencia.status);
  });

  /** Sem diálogo, ao contrário de resolver: reconhecer não encerra nada. */
  protected reconhecer(): void {
    const ocorrencia = this.ocorrencia();
    if (!ocorrencia || !this.podeReconhecer() || this.reconhecendo()) return;
    this.reconhecendo.set(true);
    this.erro.set(null);
    this.incidentesApi.acknowledge(ocorrencia.id).pipe(take(1)).subscribe({
      next: (atualizado) => {
        this.ocorrencia.set(deIncidente(atualizado));
        this.reconhecendo.set(false);
        this.mudou.emit();
      },
      error: (erro) => {
        this.reconhecendo.set(false);
        // 409 aqui é estado mudado por baixo de quem olha a tela: recarregar é a resposta
        // certa, não insistir no clique.
        this.carregar(ocorrencia.tipo, ocorrencia.id, mensagemDeAcao(erro, 'reconhecer o incidente'));
        this.mudou.emit();
      },
    });
  }

  protected resolver(): void {
    const ocorrencia = this.ocorrencia();
    if (!ocorrencia || !this.podeResolver() || this.resolvendo()) return;
    this.resolvendo.set(true);
    this.erro.set(null);
    this.incidentesApi.close(ocorrencia.id, { encerradoEm: new Date().toISOString(), observacao: null })
      .pipe(take(1)).subscribe({
        next: (atualizado) => {
          this.ocorrencia.set(deIncidente(atualizado));
          this.resolvendo.set(false);
          this.confirmarResolucao.set(false);
          this.mudou.emit();
        },
        error: (erro) => {
          this.resolvendo.set(false);
          this.confirmarResolucao.set(false);
          this.carregar(ocorrencia.tipo, ocorrencia.id, mensagemDeAcao(erro, 'resolver o incidente'));
          this.mudou.emit();
        },
      });
  }

  protected aoTeclar(evento: KeyboardEvent): void {
    // Com o diálogo de confirmação aberto o Escape é dele: fechar a gaveta por baixo
    // deixaria o modal órfão na tela.
    if (evento.key !== 'Escape' || this.confirmarResolucao()) return;
    evento.stopPropagation();
    this.pedirFechamento();
  }

  protected pedirFechamento(): void {
    this.gatilho?.focus();
    this.fechar.emit();
  }

  // ---- Apresentação ------------------------------------------------------------

  /** Identificação visível: as duas sequências colidem, o prefixo é que desambigua. */
  protected readonly codigo = computed(() => {
    const tipo = this.ocorrencia()?.tipo ?? this.tipo();
    return `${tipo === IncidentKind.Latency ? 'LAT' : 'INC'}-${this.ocorrenciaId()}`;
  });

  /** Mesmo rótulo da coluna EVENTO da lista: o título da gaveta não pode divergir dela. */
  protected readonly titulo = computed(() => rotuloEvento(this.ocorrencia()?.tipo ?? this.tipo()));

  /** Status exibido antes da resposta: a linha da lista já traz o dele. */
  protected readonly statusExibido = computed(() => this.ocorrencia()?.status ?? this.linha()?.status ?? null);

  /**
   * Ausente é o caso comum, não exceção: no banco de dev, 75 dos 76 incidentes fechados têm
   * `motivoEncerramento` nulo, porque foram encerrados antes da V19 que introduziu a coluna.
   */
  protected rotuloDoMotivoDeEncerramento(motivo: IncidentClosureReason | null): string {
    return rotuloMotivoEncerramento(motivo);
  }

  /**
   * "Motor de monitoramento" só é um fato para quem fechou depois da V17, quando o motor
   * passou a gravar `motivoEncerramento = AutomaticRecovery`. Um `fechadoPorNome` nulo sem
   * esse motivo é um incidente legado — encerrado antes da coluna existir — e não pode ser
   * lido como "o motor fechou".
   */
  protected nomeDeQuemEncerrou(item: OcorrenciaDetalhe): string {
    if (item.fechadoPorNome) return item.fechadoPorNome;
    if (item.motivoEncerramento === IncidentClosureReason.AutomaticRecovery) return 'Motor de monitoramento';
    return '—';
  }
}

// ---- Normalização --------------------------------------------------------------

function deIncidente(incidente: IncidenteResponse): OcorrenciaDetalhe {
  return {
    tipo: IncidentKind.Incident,
    id: incidente.id,
    status: incidente.status,
    iniciadoEm: incidente.iniciadoEm,
    encerradoEm: incidente.encerradoEm,
    motivo: incidente.motivo,
    observacao: incidente.observacao,
    limiarMs: null,
    ciclosParaEpisodio: null,
    reconhecidoEm: incidente.reconhecidoEm,
    reconhecidoPorNome: incidente.reconhecidoPorNome,
    fechadoPorNome: incidente.fechadoPorNome,
    motivoEncerramento: incidente.motivoEncerramento,
    motivoEncerramentoEpisodio: null,
    monitorId: incidente.monitor.id, monitorNome: incidente.monitor.nome,
    equipamentoId: incidente.monitor.equipamentoId, equipamentoNome: incidente.monitor.equipamentoNome,
    unidadeId: incidente.monitor.unidadeId, unidadeNome: incidente.monitor.unidadeNome,
  };
}

/**
 * Episódio em curso é "Aberto" no vocabulário unificado da lista; encerrado é FECHADO,
 * exibido como "Resolvido".
 * Não existe RECONHECIDO aqui — não há o que reconhecer em algo que fecha sozinho.
 */
function deEpisodio(episodio: EpisodioLatenciaResponse): OcorrenciaDetalhe {
  return {
    tipo: IncidentKind.Latency,
    id: episodio.id,
    status: episodio.encerradoEm === null ? IncidentStatus.Open : IncidentStatus.Closed,
    iniciadoEm: episodio.iniciadoEm,
    encerradoEm: episodio.encerradoEm,
    motivo: null,
    observacao: null,
    limiarMs: episodio.limiarMs,
    ciclosParaEpisodio: episodio.ciclosParaEpisodio,
    reconhecidoEm: null,
    reconhecidoPorNome: null,
    fechadoPorNome: null,
    motivoEncerramento: null,
    motivoEncerramentoEpisodio: episodio.motivoEncerramento,
    monitorId: episodio.monitorId, monitorNome: episodio.monitorNome,
    equipamentoId: episodio.equipamentoId, equipamentoNome: episodio.equipamentoNome,
    unidadeId: episodio.unidadeId, unidadeNome: episodio.unidadeNome,
  };
}

// ---- Auxiliares ----------------------------------------------------------------

function temCodigo(erro: unknown, codigo: ApiErrorCode): boolean {
  return erro instanceof HttpErrorResponse && isApiError(erro.error) && erro.error.code === codigo;
}

function mensagemDe(erro: unknown, alternativa: string): string {
  return erro instanceof HttpErrorResponse && isApiError(erro.error) ? erro.error.message : alternativa;
}

function mensagemDeAcao(erro: unknown, acao: string): string {
  if (temCodigo(erro, ApiErrorCode.BusinessConflict)) {
    return mensagemDe(erro, 'O incidente foi alterado no servidor. O estado atual foi recarregado.');
  }
  if (temCodigo(erro, ApiErrorCode.ResourceNotFound)) return 'O incidente não está mais disponível.';
  return mensagemDe(erro, `Não foi possível ${acao}. O estado atual foi recarregado.`);
}

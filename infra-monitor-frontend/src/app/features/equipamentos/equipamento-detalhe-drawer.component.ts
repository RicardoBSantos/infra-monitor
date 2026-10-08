import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { take } from 'rxjs';

import { plural } from '../../core/format/plural';
import { formatarPercentual } from '../../core/format/numero';
import { EquipmentOperationalStatus, MeasurementStatus } from '../../core/models/api-enums';
import { EquipamentoResponse } from '../../core/models/equipamento';
import { IncidenteResponse } from '../../core/models/incidente';
import { MonitorResponse } from '../../core/models/monitor';
import { DisponibilidadeEquipamentoResponse, HistoricoMedicaoResponse, LatenciaIcmpResponse } from '../../core/models/relatorio';
import { AuthStateService } from '../../core/services/auth-state.service';
import { DashboardStateService } from '../../core/services/dashboard-state.service';
import { EquipamentoApiService } from '../../core/services/equipamento-api.service';
import { IncidenteApiService } from '../../core/services/incidente-api.service';
import { MonitorApiService } from '../../core/services/monitor-api.service';
import { RelatorioApiService } from '../../core/services/relatorio-api.service';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { rotuloMotivoEncerramento } from '../incidentes/ocorrencia';
import { MonitorManagementComponent } from '../monitores/monitor-management.component';
import { JANELA_DIAS } from '../unidades/detalhe/unidade-detalhe.store';

type Estado = 'loading' | 'success' | 'error';

/** Janela do gráfico: 26 minutos ≈ 52 medições no intervalo padrão de 30 s. */
const JANELA_GRAFICO_MINUTOS = 26;
const MEDICOES_NA_JANELA = 60;
const INCIDENTES_RECENTES = 3;
const MEDIA_MOVEL = 5;

/** Ponto já projetado no viewBox do SVG; `y` nulo em FALHA, que vira lacuna na linha. */
interface PontoLatencia { x: number; y: number | null; }

/**
 * O que a gaveta precisa da linha já carregada pelo pai — e nada além disso.
 *
 * Tipo estreito de propósito: `DashboardEquipamentoLista` o satisfaz estruturalmente, então a
 * lista continua passando a linha inteira sem conversão, e o Mapa — que só tem
 * `DashboardEquipamento` e a unidade em contexto — monta estes cinco campos sem requisição extra.
 *
 * Os quatro primeiros campos são adiantamento: o cadastro que chega depois traz equivalente.
 * `status` NÃO é. `EquipamentoResponse` não tem esse campo, porque status é derivado e só existe
 * no read-model do painel. Sem `linha`, o KPI de status e o badge do cabeçalho ficam em "—" para
 * sempre — sem erro, sem requisição falhando, parecendo dado ausente no banco. Por isso todo host
 * é obrigado a passar a linha, mesmo carregando a gaveta todo o resto por conta própria.
 */
export interface EquipamentoResumo {
  nome: string;
  tipoNome: string;
  unidadeNome: string;
  status: EquipmentOperationalStatus;
  ativo: boolean;
}

/**
 * Painel lateral de detalhe do equipamento. Dois hosts: a lista de Equipamentos, onde é
 * endereçável por `/equipamentos/:id`, e o Mapa, onde abre por cima do cartão sem trocar de rota.
 * Substitui a antiga página cheia, preservando o `<app-monitor-management>` na seção recolhida
 * "Ver todos os monitores".
 *
 * A gaveta é autossuficiente: recebe um id e faz as próprias seis chamadas de composição. O único
 * dado que precisa vir do pai é `linha` — ver `EquipamentoResumo` acima.
 *
 * Cada bloco carrega e falha por conta própria: uma chamada de composição que cai
 * (latência, disponibilidade, incidentes) marca só o seu card, nunca derruba o
 * drawer inteiro — mesmo padrão da visão geral de unidade.
 */
@Component({
  selector: 'app-equipamento-detalhe-drawer',
  imports: [DatePipe, RouterLink, StatusBadgeComponent, MonitorManagementComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './equipamento-detalhe-drawer.component.html',
  styleUrl: './equipamento-detalhe-drawer.component.scss',
})
export class EquipamentoDetalheDrawerComponent {
  protected readonly plural = plural;
  private readonly api = inject(EquipamentoApiService);
  private readonly relatorios = inject(RelatorioApiService);
  private readonly monitores = inject(MonitorApiService);
  private readonly incidentesApi = inject(IncidenteApiService);
  private readonly dashboardState = inject(DashboardStateService);
  protected readonly authState = inject(AuthStateService);

  readonly equipamentoId = input.required<number>();
  /** Linha já carregada pelo pai: nome e status aparecem antes de qualquer resposta. */
  readonly linha = input<EquipamentoResumo | null>(null);
  /**
   * Editar e alternar monitoramento só aparecem onde o host implementa esses fluxos. A lista tem
   * formulário e diálogo de confirmação; o Mapa não tem nenhum dos dois, e oferecer lá um botão
   * que levaria o usuário para fora do mapa desfaz exatamente o motivo de a gaveta abrir por cima
   * dele. "Abrir histórico" continua nos dois hosts: é link, não `output` que o pai precise atender.
   */
  readonly acoesDeGestao = input(true);

  readonly fechar = output<void>();
  readonly editar = output<void>();
  readonly alternarEquipamento = output<void>();

  protected readonly janelaDias = JANELA_DIAS;
  protected readonly janelaGraficoMinutos = JANELA_GRAFICO_MINUTOS;

  protected readonly cadastro = signal<EquipamentoResponse | null>(null);
  protected readonly cadastroEstado = signal<Estado>('loading');

  protected readonly disponibilidade = signal<DisponibilidadeEquipamentoResponse | null>(null);
  protected readonly disponibilidadeEstado = signal<Estado>('loading');

  protected readonly latencia = signal<LatenciaIcmpResponse | null>(null);
  protected readonly latenciaEstado = signal<Estado>('loading');

  protected readonly medicoes = signal<HistoricoMedicaoResponse[]>([]);
  protected readonly medicoesEstado = signal<Estado>('loading');

  protected readonly listaMonitores = signal<MonitorResponse[]>([]);
  protected readonly monitoresEstado = signal<Estado>('loading');

  protected readonly incidentes = signal<IncidenteResponse[]>([]);
  protected readonly incidentesEstado = signal<Estado>('loading');

  protected readonly todosMonitores = signal(false);

  /** Elemento que abriu a gaveta: o foco volta para ele ao fechar. */
  private readonly gatilho = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  private readonly painel = viewChild<ElementRef<HTMLElement>>('painel');

  constructor() {
    // O limiar de latência degradada é global e vem do resumo do painel, que o
    // serviço compartilhado carrega uma única vez por sessão.
    this.dashboardState.carregarResumoSeNecessario();
    // Mesma sequência de foco do unidade-form-drawer: o painel recebe o foco ao abrir
    // para que o Tab continue de dentro da gaveta, e o devolve ao gatilho ao fechar.
    effect(() => this.painel()?.nativeElement.focus());
    effect(() => {
      const id = this.equipamentoId();
      this.todosMonitores.set(false);
      this.carregarCadastro(id);
      this.carregarDisponibilidade(id);
      this.carregarLatencia(id);
      this.carregarMedicoes(id);
      this.carregarMonitores(id);
      this.carregarIncidentes(id);
    });
  }

  // ---- Carga por bloco ---------------------------------------------------------

  protected carregarCadastro(id = this.equipamentoId()): void {
    this.cadastroEstado.set('loading');
    this.api.getById(id).pipe(take(1)).subscribe({
      next: (equipamento) => { this.cadastro.set(equipamento); this.cadastroEstado.set('success'); },
      error: () => { this.cadastro.set(null); this.cadastroEstado.set('error'); },
    });
  }

  protected carregarDisponibilidade(id = this.equipamentoId()): void {
    this.disponibilidadeEstado.set('loading');
    this.relatorios.getDisponibilidadeEquipamentos({ ...this.periodoJanela(), equipamentoId: id, size: 1 })
      .pipe(take(1)).subscribe({
        next: (pagina) => { this.disponibilidade.set(pagina.content[0] ?? null); this.disponibilidadeEstado.set('success'); },
        error: () => { this.disponibilidade.set(null); this.disponibilidadeEstado.set('error'); },
      });
  }

  protected carregarLatencia(id = this.equipamentoId()): void {
    this.latenciaEstado.set('loading');
    this.relatorios.getLatencia({ ...this.periodoJanela(), equipamentoId: id, size: 1 })
      .pipe(take(1)).subscribe({
        next: (pagina) => { this.latencia.set(pagina.content[0] ?? null); this.latenciaEstado.set('success'); },
        error: () => { this.latencia.set(null); this.latenciaEstado.set('error'); },
      });
  }

  /**
   * Uma única chamada alimenta o gráfico, a perda de pacotes, o contador de falhas
   * consecutivas, o último sucesso, a última falha e a última verificação. Ordem
   * crescente porque o gráfico é lido da esquerda para a direita.
   */
  protected carregarMedicoes(id = this.equipamentoId()): void {
    this.medicoesEstado.set('loading');
    const fim = new Date();
    const inicio = new Date(fim.getTime() - JANELA_GRAFICO_MINUTOS * 60 * 1000);
    this.relatorios.getMedicoes({
      inicio: inicio.toISOString(), fim: fim.toISOString(), equipamentoId: id,
      size: MEDICOES_NA_JANELA, sort: { field: 'executadoEm', direction: 'asc' },
    }).pipe(take(1)).subscribe({
      next: (pagina) => { this.medicoes.set(pagina.content); this.medicoesEstado.set('success'); },
      error: () => { this.medicoes.set([]); this.medicoesEstado.set('error'); },
    });
  }

  protected carregarMonitores(id = this.equipamentoId()): void {
    this.monitoresEstado.set('loading');
    this.monitores.list({ equipamentoId: id, size: 100, sort: 'id,asc' }).pipe(take(1)).subscribe({
      next: (pagina) => { this.listaMonitores.set(pagina.content); this.monitoresEstado.set('success'); },
      error: () => { this.listaMonitores.set([]); this.monitoresEstado.set('error'); },
    });
  }

  protected carregarIncidentes(id = this.equipamentoId()): void {
    this.incidentesEstado.set('loading');
    this.incidentesApi.list({ equipamentoId: id, size: INCIDENTES_RECENTES, sort: 'iniciadoEm,desc' })
      .pipe(take(1)).subscribe({
        next: (pagina) => { this.incidentes.set(pagina.content); this.incidentesEstado.set('success'); },
        error: () => { this.incidentes.set([]); this.incidentesEstado.set('error'); },
      });
  }

  /** Mesma janela do KPI de disponibilidade de Unidades: 30 dias. */
  private periodoJanela(): { inicio: string; fim: string } {
    const fim = new Date();
    const inicio = new Date(fim.getTime() - JANELA_DIAS * 24 * 60 * 60 * 1000);
    return { inicio: inicio.toISOString(), fim: fim.toISOString() };
  }

  // ---- Derivações da janela de medições ---------------------------------------

  protected readonly ultimaMedicao = computed(() => this.medicoes().at(-1) ?? null);

  protected readonly latenciaAtual = computed(() => {
    const ultima = this.ultimaMedicao();
    if (!ultima) return null;
    return ultima.status === MeasurementStatus.Failure ? 'timeout' : formatarMs(ultima.latenciaMs);
  });

  protected readonly perdaDePacotes = computed(() => {
    const janela = this.medicoes();
    if (!janela.length) return null;
    const falhas = janela.filter((medicao) => medicao.status === MeasurementStatus.Failure).length;
    return (falhas / janela.length) * 100;
  });

  protected readonly timeoutsNaJanela = computed(() =>
    this.medicoes().filter((medicao) => medicao.status === MeasurementStatus.Failure).length);

  /** Cauda de falhas do fim para o começo: mesma leitura que o IncidentProcessor faz no servidor. */
  protected readonly falhasConsecutivas = computed(() => {
    let total = 0;
    for (const medicao of [...this.medicoes()].reverse()) {
      if (medicao.status !== MeasurementStatus.Failure) break;
      total += 1;
    }
    return total;
  });

  protected readonly ultimoSucesso = computed(() =>
    [...this.medicoes()].reverse().find((medicao) => medicao.status === MeasurementStatus.Success)?.executadoEm ?? null);

  protected readonly ultimaFalha = computed(() =>
    [...this.medicoes()].reverse().find((medicao) => medicao.status === MeasurementStatus.Failure)?.executadoEm ?? null);

  protected readonly picoLatencia = computed(() => {
    const valores = latenciasDe(this.medicoes());
    return valores.length ? Math.max(...valores) : null;
  });

  // ---- Gráfico -----------------------------------------------------------------

  private readonly serie = computed<PontoLatencia[]>(() => {
    const janela = this.medicoes();
    if (!janela.length) return [];
    const valores = latenciasDe(janela);
    const escala = valores.length ? Math.max(...valores) : 0;
    const referencia = escala > 0 ? escala : 1;
    const passo = janela.length > 1 ? 100 / (janela.length - 1) : 0;
    return janela.map((medicao, indice) => ({
      x: indice * passo,
      y: medicao.latenciaMs === null ? null : 100 - (medicao.latenciaMs / referencia) * 90,
    }));
  });

  /** Segmentos separados: a linha não atravessa a lacuna deixada por uma FALHA. */
  private readonly trechosLatencia = computed(() => segmentar(this.serie()));

  protected readonly segmentosLatencia = computed(() => this.trechosLatencia().map(pontosDoTrecho));

  /** Área sob cada trecho, fechada na base: é ela que recebe o gradiente. */
  protected readonly areasLatencia = computed(() => this.trechosLatencia().map(areaDoTrecho));

  private readonly trechosMedia = computed(() => {
    const pontos = this.serie();
    const suavizada = pontos.map((ponto, indice) => {
      // A média também quebra na falha: uma linha contínua sobre a lacuna afirmaria
      // uma leitura que não existiu naquele instante.
      if (ponto.y === null) return { x: ponto.x, y: null };
      const anteriores = pontos.slice(Math.max(0, indice - MEDIA_MOVEL + 1), indice + 1)
        .map((anterior) => anterior.y)
        .filter((y): y is number => y !== null);
      return { x: ponto.x, y: anteriores.length ? anteriores.reduce((a, b) => a + b, 0) / anteriores.length : null };
    });
    return segmentar(suavizada);
  });

  protected readonly segmentosMedia = computed(() => this.trechosMedia().map(pontosDoTrecho));

  protected readonly graficoVazio = computed(() => this.serie().length < 2);
  protected readonly primeiroHorario = computed(() => this.medicoes()[0]?.executadoEm ?? null);
  protected readonly ultimoHorario = computed(() => this.ultimaMedicao()?.executadoEm ?? null);

  // ---- Monitores ---------------------------------------------------------------

  /** O painel mostra o monitor primário; o 1:N segue acessível na seção recolhida. */
  protected readonly monitorPrimario = computed(() => this.listaMonitores()[0] ?? null);
  protected readonly monitoresAdicionais = computed(() => Math.max(0, this.listaMonitores().length - 1));

  protected readonly limiarLatenciaMs = computed(() =>
    this.dashboardState.resumo()?.limiarLatenciaDegradadaMs ?? null);

  protected readonly statusAtual = computed<EquipmentOperationalStatus | null>(() => this.linha()?.status ?? null);

  // ---- Severidade --------------------------------------------------------------

  /**
   * Modificadores da primitiva `.kpi` de `_ui.scss`, os mesmos do Painel e do detalhe
   * de unidade. Status e Disponibilidade seguem condicionais ao valor; Latencia, Perda
   * e Incidentes tem cor fixa por metrica (decisao de produto).
   */
  protected readonly severidadeStatus = computed(() => {
    switch (this.statusAtual()) {
      case EquipmentOperationalStatus.Available: return 'kpi--ok';
      case EquipmentOperationalStatus.Degraded:
      case EquipmentOperationalStatus.Maintenance: return 'kpi--warn';
      case EquipmentOperationalStatus.Unavailable: return 'kpi--down';
      default: return '';
    }
  });

  /**
   * Latencia — atual e media — tem cor fixa azul, por decisao de produto: e leitura de
   * referencia, nao alarme. Vale inclusive para timeout. So a ausencia de dado fica
   * neutra: pintar o "—" seria dar cor a informacao que nao existe.
   */
  protected readonly corLatencia = computed(() => (this.ultimaMedicao() ? 'kpi--info' : ''));

  protected readonly corLatenciaMedia = computed(() => {
    const media = this.latencia()?.avgLatenciaMs;
    return media === null || media === undefined ? '' : 'kpi--info';
  });

  protected readonly severidadeDisponibilidade = computed(() => {
    const valor = this.disponibilidade()?.disponibilidadePercentual;
    if (valor === null || valor === undefined) return '';
    return valor >= 99 ? 'kpi--ok' : valor >= 95 ? 'kpi--warn' : 'kpi--down';
  });

  /** Perda e sempre ambar, qualquer que seja o percentual; sem dado, neutro. */
  protected readonly corPerda = computed(() => (this.perdaDePacotes() === null ? '' : 'kpi--warn'));

  /**
   * Incidentes e sempre vermelho para qualquer contagem, inclusive zero — a cor
   * identifica a metrica, nao o estado dela. Nao "corrigir" para neutro quando o valor
   * for 0: e o comportamento pedido, coberto por teste. So o "—" fica neutro, porque ai
   * nao ha contagem alguma: e request que falhou ou ainda nao voltou, nao ausencia de
   * incidentes.
   */
  protected readonly corIncidentes = computed(() => {
    const contagem = this.disponibilidade()?.incidentes;
    return contagem === null || contagem === undefined ? '' : 'kpi--down';
  });

  /**
   * Âmbar um passo antes do limite, vermelho ao atingi-lo. Com
   * `falhasParaIncidente = 1` não há faixa intermediária: a primeira falha já abre
   * incidente, então ela é vermelha de saída.
   */
  protected readonly severidadeFalhas = computed(() => {
    const monitor = this.monitorPrimario();
    if (!monitor) return '';
    const falhas = this.falhasConsecutivas();
    if (falhas >= monitor.falhasParaIncidente) return 'valor--critico';
    return falhas > 0 && falhas >= monitor.falhasParaIncidente - 1 ? 'valor--alerta' : '';
  });

  /** Devolve o foco ao painel quando um modal aberto por cima da gaveta se fecha. */
  focarPainel(): void { this.painel()?.nativeElement.focus(); }

  protected alternarTodosMonitores(): void { this.todosMonitores.update((aberto) => !aberto); }

  /** Escape fecha, como no unidade-form-drawer. */
  protected aoTeclar(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') { evento.stopPropagation(); this.pedirFechamento(); }
  }

  /**
   * Devolve o foco ao gatilho e avisa o pai.
   *
   * A segunda tentativa existe por causa de host que inerta o conteúdo de trás enquanto a gaveta
   * está aberta — é o caso do Mapa, onde o gatilho é um item do painel da unidade, dentro da
   * região inerte. Elemento sob ancestral `inert` não aceita foco, então a primeira chamada cai no
   * vazio e o foco fica no `<body>`: o Tab recomeçaria do topo da página, que é exatamente a
   * regressão que o requisito de acessibilidade proíbe. O `inert` só sai quando o pai reage a este
   * `emit` e a aplicação renderiza de novo; o `setTimeout` chega depois disso.
   *
   * Onde a primeira tentativa já funcionou — a lista de Equipamentos, que não inerta nada — a
   * guarda impede que qualquer temporizador seja agendado, e o comportamento continua síncrono.
   */
  protected pedirFechamento(): void {
    const gatilho = this.gatilho;
    gatilho?.focus();
    this.fechar.emit();
    if (gatilho && document.activeElement !== gatilho) setTimeout(() => gatilho.focus());
  }

  // ---- Apresentação ------------------------------------------------------------

  protected percentual(valor: number | null | undefined): string {
    return formatarPercentual(valor);
  }

  protected milissegundos(valor: number | null | undefined): string { return formatarMs(valor); }

  protected relativo(iso: string | null): string {
    if (!iso) return '—';
    const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutos < 1) return 'agora há pouco';
    if (minutos < 60) return `há ${minutos} min`;
    const horas = Math.floor(minutos / 60);
    return horas < 24 ? `há ${horas} h` : `há ${Math.floor(horas / 24)} d`;
  }

  /**
   * Como o incidente terminou — resolvido de verdade ou apenas interrompido por
   * manutenção. `null` enquanto aberto: ainda não há como saber. `incidente.motivo` é o
   * motivo de ABERTURA; não confundir os dois.
   */
  protected rotuloEncerramento(incidente: IncidenteResponse): string | null {
    return incidente.encerradoEm ? rotuloMotivoEncerramento(incidente.motivoEncerramento) : null;
  }
}

function latenciasDe(medicoes: readonly HistoricoMedicaoResponse[]): number[] {
  return medicoes.map((medicao) => medicao.latenciaMs).filter((valor): valor is number => valor !== null);
}

function formatarMs(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? '—' : `${Math.round(valor)} ms`;
}

/** Quebra a série em trechos contínuos: cada `y` nulo encerra o trecho corrente. */
function segmentar(pontos: readonly PontoLatencia[]): { x: number; y: number }[][] {
  const trechos: { x: number; y: number }[][] = [];
  let atual: { x: number; y: number }[] = [];
  for (const ponto of pontos) {
    if (ponto.y === null) {
      if (atual.length > 1) trechos.push(atual);
      atual = [];
      continue;
    }
    atual.push({ x: ponto.x, y: ponto.y });
  }
  if (atual.length > 1) trechos.push(atual);
  return trechos;
}

function pontosDoTrecho(trecho: readonly { x: number; y: number }[]): string {
  return trecho.map((ponto) => `${ponto.x.toFixed(2)},${ponto.y.toFixed(2)}`).join(' ');
}

/** Fecha o trecho na base do viewBox para o gradiente ter o que preencher. */
function areaDoTrecho(trecho: readonly { x: number; y: number }[]): string {
  const linha = trecho.map((ponto) => `${ponto.x.toFixed(2)},${ponto.y.toFixed(2)}`).join(' L ');
  return `M ${trecho[0].x.toFixed(2)},100 L ${linha} L ${trecho[trecho.length - 1].x.toFixed(2)},100 Z`;
}

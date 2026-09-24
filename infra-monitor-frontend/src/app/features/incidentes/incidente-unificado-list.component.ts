import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith, take } from 'rxjs';
import { isApiError } from '../../core/models/api-error';
import { IncidentStatus, NotificationStatus } from '../../core/models/api-enums';
import {
  DashboardIncidenteContadoresResponse,
  DashboardIncidenteQuery,
  DashboardIncidenteResponse,
  IncidentKind,
  IncidentSeverity,
  IncidentTab,
} from '../../core/models/dashboard-incidente';
import { UnidadeResponse } from '../../core/models/unidade';
import { DashboardIncidenteApiService } from '../../core/services/dashboard-incidente-api.service';
import { IncidenteApiService } from '../../core/services/incidente-api.service';
import { UnidadeApiService } from '../../core/services/unidade-api.service';
import { AuthStateService } from '../../core/services/auth-state.service';
import { AppIconComponent } from '../../shared/app-icon/app-icon.component';
import { DateRange, DateRangeComponent } from '../../shared/date-range/date-range.component';
import { PaginacaoComponent } from '../../shared/paginacao/paginacao.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { IncidenteDetalheDrawerComponent } from './incidente-detalhe-drawer.component';
import { duracaoDe, iconeEvento, rotuloEvento } from './ocorrencia';

type Estado = 'loading' | 'success' | 'empty' | 'error';
type Ordenacao = 'iniciadoEm,desc' | 'iniciadoEm,asc' | 'severidade,asc' | 'status,asc' | 'unidadeNome,asc';

/** Aba → filtro de status enviado ao backend. `todos` não filtra. */
const STATUS_DA_ABA: Record<IncidentTab, IncidentStatus | undefined> = {
  abertos: IncidentStatus.Open,
  reconhecidos: IncidentStatus.Acknowledged,
  resolvidos: IncidentStatus.Closed,
  todos: undefined,
};

/**
 * Vocabulário operacional, não a escala do backend. `ALTA`/`MEDIA` descrevem a derivação
 * a partir do tipo; quem está de plantão precisa saber o que fazer com a linha, e
 * "Crítico" e "Alerta" dizem isso. Os valores enviados ao servidor não mudam.
 */
const ROTULO_SEVERIDADE: Record<IncidentSeverity, string> = {
  [IncidentSeverity.High]: 'Crítico',
  [IncidentSeverity.Medium]: 'Alerta',
};

/**
 * Tela unificada de Incidentes: incidentes de indisponibilidade e episódios de latência
 * na mesma lista, com `tipo` dizendo de qual origem cada linha veio.
 *
 * As duas sequências de id são independentes e colidem, então nada aqui identifica uma
 * linha só por `id` — nem o `track` do `@for`, nem a navegação, que muda de destino
 * conforme o tipo.
 *
 * Reconhecer só existe para linhas de incidente. Episódio de latência fecha sozinho,
 * sem intervenção humana, e não tem estado equivalente.
 *
 * O detalhe é uma gaveta montada por esta tela, não uma página: `/incidentes/:id` e
 * `/incidentes/latencia/:id` são rotas FILHAS desta, e existem só para carregar o id e o
 * tipo. Como filhas, a navegação não recria a lista — os filtros, a aba e a página
 * sobrevivem à abertura da gaveta. Os deep-links continuam válidos e compartilháveis.
 */
@Component({
  selector: 'app-incidente-unificado-list',
  imports: [DatePipe, AppIconComponent, DateRangeComponent, PaginacaoComponent, StatusBadgeComponent,
    IncidenteDetalheDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './incidente-unificado-list.component.html',
  styleUrl: './incidente-unificado-list.component.scss',
})
export class IncidenteUnificadoListComponent {
  private readonly api = inject(DashboardIncidenteApiService);
  private readonly incidentesApi = inject(IncidenteApiService);
  private readonly unidadesApi = inject(UnidadeApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly authState = inject(AuthStateService);

  protected readonly IncidentKind = IncidentKind;
  protected readonly IncidentStatus = IncidentStatus;

  /**
   * Rota filha ativa, relida a cada navegação concluída. É snapshot de propósito: a
   * instância de `ActivatedRoute` do filho é trocada a cada navegação, então guardar a
   * instância deixaria a gaveta presa ao primeiro id aberto.
   */
  private readonly rotaDoDetalhe = toSignal(
    this.router.events.pipe(
      filter((evento): evento is NavigationEnd => evento instanceof NavigationEnd),
      map(() => this.route.snapshot.firstChild),
      startWith(this.route.snapshot.firstChild),
    ),
    { initialValue: this.route.snapshot.firstChild },
  );

  /** Nulo na lista limpa; preenchido quando uma das rotas de detalhe está ativa. */
  protected readonly detalheId = computed(() => {
    const bruto = this.rotaDoDetalhe()?.paramMap.get('id');
    const id = Number(bruto);
    return bruto != null && Number.isInteger(id) && id > 0 ? id : null;
  });

  /** Origem da ocorrência aberta: vem da rota que casou, nunca do id. */
  protected readonly detalheTipo = computed(() => this.rotaDoDetalhe()?.data['tipo'] as IncidentKind | undefined);

  /** Linha correspondente ao detalhe aberto; nula em deep-link, enquanto a lista carrega. */
  protected readonly linhaDoDetalhe = computed(() => {
    const id = this.detalheId(), tipo = this.detalheTipo();
    if (id === null || !tipo) return null;
    return this.linhas().find((linha) => linha.id === id && linha.tipo === tipo) ?? null;
  });

  protected readonly linhas = signal<DashboardIncidenteResponse[]>([]);
  protected readonly estado = signal<Estado>('loading');
  protected readonly erro = signal<string | null>(null);

  protected readonly contadores = signal<DashboardIncidenteContadoresResponse | null>(null);
  protected readonly unidades = signal<UnidadeResponse[]>([]);
  protected readonly erroApoio = signal<string | null>(null);

  protected readonly aba = signal<IncidentTab>('abertos');
  protected readonly unidadeId = signal<number | undefined>(undefined);
  protected readonly severidade = signal<IncidentSeverity | undefined>(undefined);
  protected readonly ordenacao = signal<Ordenacao>('iniciadoEm,desc');
  private readonly periodo = signal<DateRange | null>(null);

  protected readonly pagina = signal(0);
  protected readonly totalPaginas = signal(0);
  protected readonly totalElementos = signal(0);

  /** Reconhecimento em voo, por linha: o botão da linha clicada é o único que desabilita. */
  protected readonly reconhecendo = signal<number | null>(null);

  protected readonly contagem = computed(() => {
    const total = this.totalElementos();
    return total ? `${this.linhas().length} de ${total} ocorrência(s)` : '';
  });

  constructor() {
    this.carregarUnidades();
    // A lista não carrega aqui: o <app-date-range> emite o período inicial em ngOnInit e
    // é esse evento que dispara a primeira consulta, já com inicio/fim preenchidos.
  }

  // ---- Filtros -----------------------------------------------------------------

  protected mudarPeriodo(intervalo: DateRange): void {
    this.periodo.set(intervalo);
    this.reiniciarPagina();
  }

  protected mudarAba(aba: IncidentTab): void {
    if (aba === this.aba()) return;
    this.aba.set(aba);
    // Contadores não mudam com a aba: eles ignoram o filtro de status de propósito.
    this.pagina.set(0);
    this.carregarLista();
  }

  protected mudarUnidade(valor: string): void { this.unidadeId.set(numeroOuIndefinido(valor)); this.reiniciarPagina(); }
  protected mudarSeveridade(valor: string): void { this.severidade.set(ehSeveridade(valor) ? valor : undefined); this.reiniciarPagina(); }
  protected mudarOrdenacao(valor: string): void { this.ordenacao.set(valor as Ordenacao); this.reiniciarPagina(); }

  /** Qualquer filtro fora da aba muda a lista e os contadores juntos. */
  private reiniciarPagina(): void {
    this.pagina.set(0);
    this.carregarLista();
    this.carregarContadores();
  }

  protected irParaPagina(pagina1Based: number): void {
    this.pagina.set(pagina1Based - 1);
    this.carregarLista();
  }

  // ---- Carga -------------------------------------------------------------------

  protected carregarLista(): void {
    const consulta = this.consulta();
    if (!consulta) return;
    this.estado.set('loading');
    this.erro.set(null);
    this.api.list(consulta).pipe(take(1)).subscribe({
      next: (resposta) => {
        this.linhas.set(resposta.content);
        this.pagina.set(resposta.page);
        this.totalPaginas.set(resposta.totalPages);
        this.totalElementos.set(resposta.totalElements);
        this.estado.set(resposta.content.length ? 'success' : 'empty');
      },
      error: (erro) => {
        this.erro.set(mensagemDe(erro, 'Não foi possível carregar as ocorrências.'));
        this.estado.set('error');
      },
    });
  }

  /** Falha de contador não derruba a lista: as abas ficam sem número, a tabela continua. */
  private carregarContadores(): void {
    const intervalo = this.periodo();
    if (!intervalo) return;
    this.api.counters({ unidadeId: this.unidadeId(), severidade: this.severidade(), ...intervalo })
      .pipe(take(1)).subscribe({
        next: (contadores) => this.contadores.set(contadores),
        error: () => this.contadores.set(null),
      });
  }

  private carregarUnidades(): void {
    this.unidadesApi.list(true).pipe(take(1)).subscribe({
      next: (unidades) => this.unidades.set(unidades),
      error: (erro) => this.erroApoio.set(mensagemDe(erro, 'Não foi possível carregar as unidades.')),
    });
  }

  private consulta(): DashboardIncidenteQuery | null {
    const intervalo = this.periodo();
    if (!intervalo) return null;
    return {
      page: this.pagina(), size: 20, sort: this.ordenacao(),
      unidadeId: this.unidadeId(), severidade: this.severidade(),
      status: STATUS_DA_ABA[this.aba()], ...intervalo,
    };
  }

  // ---- Ações -------------------------------------------------------------------

  /** Só incidente é reconhecível, e só enquanto está ABERTO. */
  protected podeReconhecer(linha: DashboardIncidenteResponse): boolean {
    return this.authState.canCloseIncident()
      && linha.tipo === IncidentKind.Incident
      && linha.status === IncidentStatus.Open;
  }

  protected reconhecer(linha: DashboardIncidenteResponse): void {
    if (!this.podeReconhecer(linha) || this.reconhecendo() !== null) return;
    this.reconhecendo.set(linha.id);
    this.erro.set(null);
    this.incidentesApi.acknowledge(linha.id).pipe(take(1)).subscribe({
      next: () => { this.reconhecendo.set(null); this.carregarLista(); this.carregarContadores(); },
      error: (erro) => {
        this.reconhecendo.set(null);
        // 409 aqui significa que o estado mudou por baixo de quem está olhando a tela:
        // recarregar é a resposta certa, não insistir no clique.
        this.erro.set(mensagemDe(erro, 'Não foi possível reconhecer o incidente.'));
        this.carregarLista();
        this.carregarContadores();
      },
    });
  }

  /** Destinos diferentes por origem: o id sozinho não diz para onde ir. */
  protected abrir(linha: DashboardIncidenteResponse): void {
    const destino = linha.tipo === IncidentKind.Latency
      ? ['/incidentes', 'latencia', linha.id]
      : ['/incidentes', linha.id];
    this.router.navigate(destino);
  }

  /** Fechar a gaveta é voltar para a lista limpa: o histórico do navegador acompanha. */
  protected fecharDetalhe(): void {
    this.router.navigate(['/incidentes']);
  }

  /** Reconhecimento ou fechamento feito na gaveta: lista e contadores saem de sincronia. */
  protected aoMudarOcorrencia(): void {
    this.carregarLista();
    this.carregarContadores();
  }

  protected rotuloSeveridade(severidade: IncidentSeverity): string { return ROTULO_SEVERIDADE[severidade] ?? severidade; }

  /**
   * EVENTO e DURAÇÃO saem das mesmas funções que a gaveta usa no título e no KPI: a linha
   * e o detalhe são a mesma ocorrência e não podem se contradizer entre o clique e a
   * abertura. O MONITOR saiu da tabela — ele vive no "Contexto operacional" da gaveta, que
   * é onde se olha para agir, e aqui só empurrava as colunas de decisão para fora da tela.
   */
  protected rotuloEvento(tipo: IncidentKind): string { return rotuloEvento(tipo); }
  protected iconeEvento(tipo: IncidentKind) { return iconeEvento(tipo); }

  /** Ocorrência em curso conta até agora; encerrada, até o fim registrado. */
  protected duracao(linha: DashboardIncidenteResponse): string {
    return duracaoDe(linha.iniciadoEm, linha.encerradoEm);
  }

  /**
   * NOTIFICADO vem da própria linha: o backend já resolve a última notificação da âncora
   * certa (`incidente_id` ou `episodio_latencia_id`) por LATERAL, então a coluna não custa
   * uma requisição por linha. O status é validado contra o enum porque chega como texto
   * livre da projeção SQL — valor fora do domínio vira "—" em vez de badge sem rótulo.
   */
  protected statusNotificacao(linha: DashboardIncidenteResponse): NotificationStatus | null {
    const status = linha.notificacaoStatus;
    return status !== null && (Object.values(NotificationStatus) as string[]).includes(status)
      ? (status as NotificationStatus)
      : null;
  }

  /** Chave estável apesar da colisão de id entre as duas tabelas de origem. */
  protected chave(linha: DashboardIncidenteResponse): string { return `${linha.tipo}-${linha.id}`; }

  protected contadorDa(aba: IncidentTab): number | null { return this.contadores()?.[aba] ?? null; }
}

function numeroOuIndefinido(valor: string): number | undefined {
  const numero = Number(valor);
  return valor && Number.isInteger(numero) && numero > 0 ? numero : undefined;
}

function ehSeveridade(valor: string): valor is IncidentSeverity {
  return Object.values(IncidentSeverity).includes(valor as IncidentSeverity);
}

function mensagemDe(erro: unknown, alternativa: string): string {
  return erro instanceof HttpErrorResponse && isApiError(erro.error) ? erro.error.message : alternativa;
}

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin, take } from 'rxjs';

import { formatarPercentual } from '../../core/format/numero';
import { plural } from '../../core/format/plural';
import { IncidentStatus, UnitOperationalStatus } from '../../core/models/api-enums';
import { DashboardEquipamento, DashboardUnidade } from '../../core/models/dashboard';
import { IncidenteResponse } from '../../core/models/incidente';
import { DisponibilidadeUnidadeResponse } from '../../core/models/relatorio';
import { TipoEquipamentoResponse } from '../../core/models/tipo-equipamento';
import { DashboardApiService } from '../../core/services/dashboard-api.service';
import { DashboardStateService } from '../../core/services/dashboard-state.service';
import { EquipamentoApiService } from '../../core/services/equipamento-api.service';
import { GeoMunicipioService } from '../../core/services/geo-municipio.service';
import { IncidenteApiService } from '../../core/services/incidente-api.service';
import { RelatorioApiService } from '../../core/services/relatorio-api.service';
import { TipoEquipamentoApiService } from '../../core/services/tipo-equipamento-api.service';
import { UnidadeApiService } from '../../core/services/unidade-api.service';
import { AppIconComponent, AppIconName } from '../../shared/app-icon/app-icon.component';
import { StatusBadgeComponent, TomStatus, tomDoStatus } from '../../shared/status-badge/status-badge.component';

/** Janela usada nas colunas de disponibilidade e latência; os agregados vêm prontos da API de relatórios. */
const JANELA_DIAS = 30;
/** Teto de leitura das listas auxiliares: cadastro de equipamentos e agregados por monitor. */
const LOTE = 500;
/** Quantos incidentes abertos são descritos na segunda linha do banner antes do resumo "+N". */
const INCIDENTES_NO_BANNER = 3;

const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

type EstadoEquipamentos = 'loading' | 'success' | 'empty' | 'error';
/** Filtro de status da barra de pills: rótulos operacionais, não o enum cru da API. */
type FiltroStatus = 'ONLINE' | 'DEGRADADO' | 'OFFLINE' | 'MANUTENCAO';
type Severidade = 'ok' | 'warn' | 'down';
/** Estado de um KPI agregado, independente do estado do resumo. */
type EstadoAgregado = 'loading' | 'ok' | 'erro';

interface DetalheUnidade { estado: EstadoEquipamentos; equipamentos: DashboardEquipamento[]; total: number; disponibilidade: Map<number, number | null>; }
interface IdentidadeUnidade { sigla: string | null; municipio: string | null; }
/**
 * Única forma que abas e filtros leem do índice de cadastro: trocar a fonte do índice só mexe em carregarCadastro().
 * tipoNome existe para as abas sobreviverem à falha do catálogo de tipos.
 */
interface EntradaCadastro { unidadeId: number; tipoId: number; tipoNome: string; nome: string; hostname: string | null; ip: string | null; }
/** contagem null = desconhecida (índice parcial ou ausente): nunca vira 0 na tela. */
interface AbaTipo { id: number; nome: string; contagem: number | null; desabilitada: boolean; }

/** Ícone da marca por tom: cada tom tem forma própria, para não depender só da cor. */
const ICONE_DO_TOM: Record<TomStatus, AppIconName> = { success: 'check', warning: 'incident', danger: 'close', muted: 'minus', info: 'wrench' };

const PILLS: readonly { valor: FiltroStatus; rotulo: string; tom: Severidade | 'info' }[] = [
  { valor: 'ONLINE', rotulo: 'Online', tom: 'ok' },
  { valor: 'DEGRADADO', rotulo: 'Degradado', tom: 'warn' },
  { valor: 'OFFLINE', rotulo: 'Offline', tom: 'down' },
  { valor: 'MANUTENCAO', rotulo: 'Manutenção', tom: 'info' },
];

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, AppIconComponent, StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent {
  protected readonly plural = plural;
  private readonly api = inject(DashboardApiService);
  private readonly relatorios = inject(RelatorioApiService);
  private readonly unidadesApi = inject(UnidadeApiService);
  private readonly equipamentosApi = inject(EquipamentoApiService);
  private readonly incidentesApi = inject(IncidenteApiService);
  private readonly tiposApi = inject(TipoEquipamentoApiService);
  private readonly geo = inject(GeoMunicipioService);
  protected readonly painel = inject(DashboardStateService);

  protected readonly resumo = this.painel.resumo;
  protected readonly resumoState = this.painel.resumoState;
  protected readonly resumoError = this.painel.resumoError;
  protected readonly unidadesState = this.painel.unidadesState;
  protected readonly unidadesError = this.painel.unidadesError;

  private readonly identidades = signal<Map<number, IdentidadeUnidade>>(new Map());
  private readonly disponibilidadeUnidades = signal<Map<number, number | null>>(new Map());
  private readonly latenciaUnidades = signal<Map<number, number>>(new Map());
  private readonly disponibilidadeIndisponivel = signal(false);
  /** KPIs agregados: cada um falha sozinho, sem derrubar o restante do painel. */
  private readonly disponibilidadeGlobal = signal<number | null>(null);
  private readonly latenciaGlobal = signal<number | null>(null);
  private readonly disponibilidadeGlobalState = signal<EstadoAgregado>('loading');
  private readonly latenciaGlobalState = signal<EstadoAgregado>('loading');
  private readonly detalhes = signal<Map<number, DetalheUnidade>>(new Map());
  private readonly expandidas = signal<ReadonlySet<number>>(new Set());
  /** Indice de cadastro por unidade: alimenta as abas de tipo e a busca em unidades ainda nao expandidas. */
  private readonly cadastro = signal<Map<number, EntradaCadastro[]>>(new Map());
  /** true = o índice cobre todo o cadastro; false = parcial (contagem desconhecida); null = não carregado ou erro. */
  protected readonly cadastroCompleto = signal<boolean | null>(null);
  protected readonly cadastroTotal = signal<number | null>(null);
  protected readonly cadastroCarregados = computed(() => [...this.cadastro().values()].reduce((total, lista) => total + lista.length, 0));
  /** Catálogo de tipos: undefined = carregando, null = falhou; sem catálogo as abas saem dos tipos presentes nos dados. */
  private readonly catalogoTipos = signal<TipoEquipamentoResponse[] | null | undefined>(undefined);
  private readonly incidentes = signal<IncidenteResponse[]>([]);

  protected readonly filtroTexto = signal('');
  protected readonly filtroTipoId = signal<number | null>(null);
  protected readonly filtroStatus = signal<FiltroStatus | null>(null);
  protected readonly pills = PILLS;

  private readonly agora = signal(Date.now());

  /**
   * Visão atual sem o filtro de tipo (status e texto aplicados). Cada unidade leva as entradas do índice que
   * contam para ela: todas se o texto é vazio ou casa com a identidade da unidade, senão só as que casam no texto.
   */
  private readonly visao = computed(() => {
    const status = this.filtroStatus();
    const texto = this.filtroTexto().trim().toLowerCase();
    const visao: { unidade: DashboardUnidade; entradas: EntradaCadastro[] }[] = [];
    for (const unidade of this.painel.unidades()) {
      if (status && !combinaStatus(unidade, status)) continue;
      const todas = this.cadastro().get(unidade.id) ?? [];
      if (!texto || this.identidadeCombina(unidade, texto)) { visao.push({ unidade, entradas: todas }); continue; }
      const entradas = todas.filter((entrada) => combinaCadastro(entrada, texto));
      if (entradas.length) visao.push({ unidade, entradas });
    }
    return visao;
  });

  protected readonly unidadesNaVisao = computed(() => this.visao().map(({ unidade }) => unidade));

  protected readonly unidades = computed(() => {
    const tipoId = this.filtroTipoId();
    if (tipoId === null) return this.unidadesNaVisao();
    return this.visao().filter(({ entradas }) => entradas.some((entrada) => entrada.tipoId === tipoId)).map(({ unidade }) => unidade);
  });

  /** Total de equipamentos da visão atual; só existe com índice completo — parcial ou ausente não vira número. */
  protected readonly contagemTodos = computed<number | null>(() =>
    this.cadastroCompleto() === true ? this.visao().reduce((total, { entradas }) => total + entradas.length, 0) : null);

  /** Abas pelo catálogo; tipo inativo só aparece enquanto houver equipamento dele no índice. */
  protected readonly abasTipo = computed<AbaTipo[]>(() => {
    const noCadastro = new Set<number>();
    for (const lista of this.cadastro().values()) for (const entrada of lista) noCadastro.add(entrada.tipoId);
    const porTipo = new Map<number, number>();
    for (const { entradas } of this.visao()) for (const entrada of entradas) porTipo.set(entrada.tipoId, (porTipo.get(entrada.tipoId) ?? 0) + 1);
    const completo = this.cadastroCompleto() === true;
    const selecionado = this.filtroTipoId();
    return this.tiposConhecidos()
      .filter((tipo) => tipo.ativo || noCadastro.has(tipo.id))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((tipo) => {
        const contagem = completo ? (porTipo.get(tipo.id) ?? 0) : null;
        // A aba selecionada nunca trava: o usuário precisa conseguir sair dela mesmo com a visão zerada.
        return { id: tipo.id, nome: tipo.nome, contagem, desabilitada: contagem === 0 && selecionado !== tipo.id };
      });
  });

  protected readonly ultimaVarredura = computed(() => {
    const instante = this.painel.ultimaVarredura();
    return instante ? HORA.format(new Date(instante)) : '--:--:--';
  });

  protected readonly monitorados = computed(() => {
    const equipamentos = this.resumo()?.equipamentos;
    return equipamentos ? equipamentos.total - equipamentos.semMonitoramento : 0;
  });

  protected readonly unidadesComIncidente = computed(() => this.painel.unidades().filter((unidade) => unidade.incidentesAbertos > 0).length);
  protected readonly unidadesOffline = computed(() => this.painel.unidades().filter((unidade) => unidade.equipamentosIndisponiveis > 0).length);
  protected readonly todasExpandidas = computed(() => this.unidades().length > 0 && this.unidades().every((unidade) => this.expandidas().has(unidade.id)));
  protected readonly semDisponibilidade = this.disponibilidadeIndisponivel.asReadonly();

  /** Disponibilidade global: soma dos tempos devolvidos pelo relatório, nunca contagem de equipamento. */
  protected readonly disponibilidadeGlobalTexto = computed(() => formatarPercentual(this.disponibilidadeGlobal()));
  protected readonly latenciaGlobalTexto = computed(() => {
    const media = this.latenciaGlobal();
    return media === null ? '—' : `${Math.round(media)}`;
  });
  protected readonly disponibilidadeGlobalCarregando = computed(() => this.disponibilidadeGlobalState() === 'loading');
  protected readonly latenciaGlobalCarregando = computed(() => this.latenciaGlobalState() === 'loading');

  /** Segunda linha do banner: só existe se a API de incidentes tiver respondido com incidentes abertos. */
  protected readonly descricaoIncidentes = computed(() => {
    const abertos = this.incidentes();
    if (!abertos.length) return null;
    const exibidos = abertos.slice(0, INCIDENTES_NO_BANNER);
    const descritos = exibidos
      .map((incidente) => `${incidente.monitor.equipamentoNome} no ${incidente.monitor.unidadeNome} offline ${this.desde(incidente.iniciadoEm)}.`)
      .join(' · ');
    // O total vem do KPI (só elegíveis); o tamanho da lista não é o total.
    const restantes = Math.max(0, (this.resumo()?.incidentes.abertos ?? abertos.length) - exibidos.length);
    return restantes > 0 ? `${descritos} · +${plural(restantes, 'incidente', 'incidentes')}` : descritos;
  });

  constructor() {
    this.painel.carregarResumoSeNecessario();
    this.painel.carregarUnidadesSeNecessario();
    this.carregarIdentidades();
    this.carregarDisponibilidadeUnidades();
    this.carregarLatenciaUnidades();
    this.carregarCatalogoTipos();
    // O indice de cadastro so alimenta as abas de tipo: sai do caminho critico do primeiro render.
    afterNextRender(() => this.carregarCadastro());
    effect(() => {
      const resumo = this.painel.resumo();
      if (resumo && resumo.incidentes.abertos > 0) this.carregarIncidentes();
    });
    const relogio = setInterval(() => this.agora.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(relogio));
  }

  protected atualizar(): void {
    this.painel.atualizar();
    this.carregarDisponibilidadeUnidades();
    this.carregarLatenciaUnidades();
    this.carregarCatalogoTipos();
    this.carregarCadastro();
    for (const id of this.expandidas()) this.carregarEquipamentos(id, true);
  }

  protected expandida(id: number): boolean { return this.expandidas().has(id); }

  protected alternarUnidade(unidade: DashboardUnidade): void {
    const proximas = new Set(this.expandidas());
    if (proximas.has(unidade.id)) proximas.delete(unidade.id);
    else { proximas.add(unidade.id); this.carregarEquipamentos(unidade.id); }
    this.expandidas.set(proximas);
  }

  protected alternarTodas(): void {
    if (this.todasExpandidas()) { this.expandidas.set(new Set()); return; }
    const ids = this.unidades().map((unidade) => unidade.id);
    this.expandidas.set(new Set(ids));
    for (const id of ids) this.carregarEquipamentos(id);
  }

  protected detalhe(id: number): DetalheUnidade | undefined { return this.detalhes().get(id); }

  /** Filtro de tipo e busca são aplicados sobre o que já está em memória: nenhum refetch, nenhum query param. */
  protected equipamentosVisiveis(unidade: DashboardUnidade): DashboardEquipamento[] {
    const dados = this.detalhes().get(unidade.id);
    if (!dados) return [];
    const tipoId = this.filtroTipoId();
    const texto = this.filtroTexto().trim().toLowerCase();
    const porTipo = tipoId === null ? dados.equipamentos : dados.equipamentos.filter((equipamento) => equipamento.tipoEquipamento.id === tipoId);
    if (!texto || this.identidadeCombina(unidade, texto)) return porTipo;
    // hostname vem no proprio payload do painel desde B1: nada de cruzar com o indice de cadastro.
    return porTipo.filter((equipamento) => [equipamento.nome, equipamento.ip, equipamento.hostname].some((valor) => valor?.toLowerCase().includes(texto)));
  }

  protected selecionarTipo(id: number | null): void { this.filtroTipoId.set(id); }

  protected selecionarStatus(status: FiltroStatus | null): void { this.filtroStatus.set(status); }

  protected aoDigitar(evento: Event): void { this.filtroTexto.set((evento.target as HTMLInputElement).value); }

  protected disponibilidadeDaUnidade(id: number): string {
    return formatarPercentual(this.disponibilidadeUnidades().get(id) ?? null);
  }

  protected latenciaDaUnidade(id: number): string {
    const media = this.latenciaUnidades().get(id);
    return media === undefined ? '—' : `${Math.round(media)} ms`;
  }

  protected disponibilidadeDoEquipamento(unidadeId: number, equipamentoId: number): string {
    return formatarPercentual(this.detalhes().get(unidadeId)?.disponibilidade.get(equipamentoId) ?? null);
  }

  protected latencia(equipamento: DashboardEquipamento): string {
    const latencia = equipamento.ultimaMedicao?.latenciaMs;
    return latencia === null || latencia === undefined ? '—' : `${latencia} ms`;
  }

  protected desdeUltimaVerificacao(equipamento: DashboardEquipamento): string {
    const executadoEm = equipamento.ultimaMedicao?.executadoEm;
    return executadoEm ? this.desde(executadoEm) : 'sem leitura';
  }

  /** Barra, marca e badge leem o mesmo unidade.status: o tom vem da tabela do badge, nunca de contagem local. */
  protected tomDaUnidade(unidade: DashboardUnidade): TomStatus { return tomDoStatus(unidade.status); }
  protected iconeDoTom(tom: TomStatus): AppIconName { return ICONE_DO_TOM[tom]; }

  protected severidadeDoEquipamento(equipamento: DashboardEquipamento): Severidade {
    if (equipamento.status === 'INDISPONIVEL') return 'down';
    if (equipamento.status === 'DISPONIVEL') return 'ok';
    return 'warn';
  }

  protected identidade(id: number): IdentidadeUnidade | undefined { return this.identidades().get(id); }

  protected larguraFaixa(parte: number, total: number): string { return total > 0 ? `${(parte / total) * 100}%` : '0%'; }

  /** Manutencao parcial nao vira status de unidade: fica como marcador discreto ao lado do badge. */
  protected manutencaoParcial(unidade: DashboardUnidade): boolean {
    return unidade.equipamentosEmManutencao > 0 && unidade.status !== UnitOperationalStatus.Maintenance;
  }

  protected rotuloManutencao(unidade: DashboardUnidade): string {
    const total = unidade.equipamentosEmManutencao;
    return `${total} equipamento${total === 1 ? '' : 's'} em manutenção`;
  }

  protected readonly trackUnidade = (_: number, unidade: DashboardUnidade) => unidade.id;
  protected readonly trackEquipamento = (_: number, equipamento: DashboardEquipamento) => equipamento.id;

  private desde(instante: string): string {
    const segundos = Math.max(0, Math.round((this.agora() - new Date(instante).getTime()) / 1000));
    if (segundos < 60) return `há ${segundos} s`;
    if (segundos < 3600) return `há ${Math.floor(segundos / 60)} min`;
    if (segundos < 86_400) return `há ${Math.floor(segundos / 3600)} h`;
    return `há ${Math.floor(segundos / 86_400)} d`;
  }

  private identidadeCombina(unidade: DashboardUnidade, texto: string): boolean {
    const identidade = this.identidades().get(unidade.id);
    return [unidade.nome, identidade?.sigla, identidade?.municipio, unidade.codigoIbge].some((valor) => valor?.toLowerCase().includes(texto));
  }

  private carregarIdentidades(): void {
    this.unidadesApi.list(true).pipe(take(1)).subscribe({
      next: (unidades) => {
        const mapa = new Map<number, IdentidadeUnidade>();
        for (const unidade of unidades) mapa.set(unidade.id, { sigla: unidade.sigla, municipio: null });
        this.identidades.set(mapa);
        this.geo.getMunicipios().pipe(take(1)).subscribe({
          next: (municipios) => {
            const porCodigo = new Map(municipios.map((municipio) => [municipio.codigoIbge, municipio.nome]));
            const comMunicipio = new Map(this.identidades());
            for (const unidade of unidades) {
              const atual = comMunicipio.get(unidade.id);
              comMunicipio.set(unidade.id, { sigla: atual?.sigla ?? unidade.sigla, municipio: porCodigo.get(unidade.codigoIbge ?? '') ?? null });
            }
            this.identidades.set(comMunicipio);
          },
          error: () => undefined,
        });
      },
      error: () => undefined,
    });
  }

  /** Catálogo quando disponível; sem ele (carregando ou falha), os tipos presentes no índice e nos detalhes, como ativos. */
  private tiposConhecidos(): { id: number; nome: string; ativo: boolean }[] {
    const catalogo = this.catalogoTipos();
    if (catalogo) return catalogo;
    const presentes = new Map<number, string>();
    for (const lista of this.cadastro().values()) for (const entrada of lista) presentes.set(entrada.tipoId, entrada.tipoNome);
    for (const detalhe of this.detalhes().values()) for (const equipamento of detalhe.equipamentos) presentes.set(equipamento.tipoEquipamento.id, equipamento.tipoEquipamento.nome);
    return [...presentes].map(([id, nome]) => ({ id, nome, ativo: true }));
  }

  private carregarCatalogoTipos(): void {
    this.tiposApi.list().pipe(take(1)).subscribe({
      next: (tipos) => this.catalogoTipos.set(tipos),
      error: () => this.catalogoTipos.set(null),
    });
  }

  /** Fonte atual do índice: GET /equipamentos, que o backend limita a 100 por página — por isso o índice pode ser parcial. */
  private carregarCadastro(): void {
    this.equipamentosApi.list({ size: LOTE, sort: 'nome,asc' }).pipe(take(1)).subscribe({
      next: (pagina) => {
        const porUnidade = new Map<number, EntradaCadastro[]>();
        for (const equipamento of pagina.content) {
          const lista = porUnidade.get(equipamento.unidade.id) ?? [];
          lista.push({ unidadeId: equipamento.unidade.id, tipoId: equipamento.tipoEquipamento.id, tipoNome: equipamento.tipoEquipamento.nome, nome: equipamento.nome, hostname: equipamento.hostname, ip: equipamento.ip });
          porUnidade.set(equipamento.unidade.id, lista);
        }
        this.cadastro.set(porUnidade);
        this.cadastroTotal.set(pagina.totalElements);
        this.cadastroCompleto.set(pagina.totalElements <= pagina.content.length);
      },
      error: () => { this.cadastro.set(new Map()); this.cadastroTotal.set(null); this.cadastroCompleto.set(null); },
    });
  }

  private carregarIncidentes(): void {
    const consulta = (status: IncidentStatus) => this.incidentesApi.list({ status, size: INCIDENTES_NO_BANNER, sort: 'iniciadoEm,desc' });
    forkJoin([consulta(IncidentStatus.Open), consulta(IncidentStatus.Acknowledged)]).pipe(take(1)).subscribe({
      next: ([abertos, reconhecidos]) => this.incidentes.set(
        [...abertos.content, ...reconhecidos.content].sort((a, b) => Date.parse(b.iniciadoEm) - Date.parse(a.iniciadoEm))),
      error: () => this.incidentes.set([]),
    });
  }

  private carregarDisponibilidadeUnidades(): void {
    this.disponibilidadeGlobalState.set('loading');
    this.relatorios.getDisponibilidadeUnidades({ ...this.janela(), size: 200 }).pipe(take(1)).subscribe({
      next: (pagina) => {
        this.disponibilidadeIndisponivel.set(false);
        this.disponibilidadeUnidades.set(new Map(pagina.content.map((linha) => [linha.unidadeId, linha.disponibilidadePercentual])));
        this.disponibilidadeGlobal.set(agregarDisponibilidade(pagina.content));
        this.disponibilidadeGlobalState.set('ok');
      },
      error: (_: HttpErrorResponse) => {
        this.disponibilidadeIndisponivel.set(true);
        this.disponibilidadeUnidades.set(new Map());
        this.disponibilidadeGlobal.set(null);
        this.disponibilidadeGlobalState.set('erro');
      },
    });
  }

  /** A API já entrega a média por unidade; a agregação no cliente sobrevive apenas como plano B. */
  private carregarLatenciaUnidades(): void {
    this.latenciaGlobalState.set('loading');
    this.relatorios.getLatenciaUnidades({ ...this.janela(), size: LOTE }).pipe(take(1)).subscribe({
      next: (pagina) => {
        const medias = new Map<number, number>();
        let soma = 0, medicoes = 0;
        for (const linha of pagina.content) {
          if (linha.avgLatenciaMs === null || linha.count <= 0) continue;
          medias.set(linha.unidadeId, linha.avgLatenciaMs);
          soma += linha.avgLatenciaMs * linha.count;
          medicoes += linha.count;
        }
        this.latenciaUnidades.set(medias);
        this.latenciaGlobal.set(medicoes > 0 ? soma / medicoes : null);
        this.latenciaGlobalState.set('ok');
      },
      error: () => this.agregarLatenciaNoCliente(),
    });
  }

  /** Fallback: backends anteriores ao agregado por unidade só respondem por monitor. */
  private agregarLatenciaNoCliente(): void {
    this.relatorios.getLatencia({ ...this.janela(), size: LOTE }).pipe(take(1)).subscribe({
      next: (pagina) => {
        const acumulado = new Map<number, { soma: number; medicoes: number }>();
        let soma = 0, medicoes = 0;
        for (const linha of pagina.content) {
          if (linha.avgLatenciaMs === null || linha.count <= 0) continue;
          const atual = acumulado.get(linha.unidadeId) ?? { soma: 0, medicoes: 0 };
          acumulado.set(linha.unidadeId, { soma: atual.soma + linha.avgLatenciaMs * linha.count, medicoes: atual.medicoes + linha.count });
          soma += linha.avgLatenciaMs * linha.count;
          medicoes += linha.count;
        }
        this.latenciaUnidades.set(new Map([...acumulado].map(([id, { soma: total, medicoes: quantidade }]) => [id, total / quantidade])));
        this.latenciaGlobal.set(medicoes > 0 ? soma / medicoes : null);
        this.latenciaGlobalState.set('ok');
      },
      error: () => { this.latenciaUnidades.set(new Map()); this.latenciaGlobal.set(null); this.latenciaGlobalState.set('erro'); },
    });
  }

  /** Lazy na primeira expansão e cacheado depois; só o botão Atualizar força nova leitura. */
  private carregarEquipamentos(unidadeId: number, forcar = false): void {
    const cacheado = this.detalhes().get(unidadeId);
    if (!forcar && cacheado && cacheado.estado !== 'error') return;
    this.atualizarDetalhe(unidadeId, { estado: 'loading', equipamentos: [], total: 0, disponibilidade: new Map() });
    this.api.getEquipamentosDaUnidade(unidadeId, { size: 100, sort: 'nome' }).pipe(take(1)).subscribe({
      next: (pagina) => {
        this.atualizarDetalhe(unidadeId, { estado: pagina.content.length ? 'success' : 'empty', equipamentos: pagina.content, total: pagina.totalElements, disponibilidade: new Map() });
        this.carregarDisponibilidadeEquipamentos(unidadeId);
      },
      error: () => this.atualizarDetalhe(unidadeId, { estado: 'error', equipamentos: [], total: 0, disponibilidade: new Map() }),
    });
  }

  private carregarDisponibilidadeEquipamentos(unidadeId: number): void {
    this.relatorios.getDisponibilidadeEquipamentos({ ...this.janela(), unidadeId, size: 200 }).pipe(take(1)).subscribe({
      next: (pagina) => {
        const atual = this.detalhes().get(unidadeId);
        if (!atual) return;
        this.atualizarDetalhe(unidadeId, { ...atual, disponibilidade: new Map(pagina.content.map((linha) => [linha.equipamentoId, linha.disponibilidadePercentual])) });
      },
      error: () => this.disponibilidadeIndisponivel.set(true),
    });
  }

  private atualizarDetalhe(unidadeId: number, detalhe: DetalheUnidade): void {
    const proximos = new Map(this.detalhes());
    proximos.set(unidadeId, detalhe);
    this.detalhes.set(proximos);
  }

  private janela(): { inicio: string; fim: string } {
    const fim = new Date();
    const inicio = new Date(fim.getTime() - JANELA_DIAS * 24 * 60 * 60 * 1000);
    return { inicio: inicio.toISOString(), fim: fim.toISOString() };
  }
}

/** Manutencao e status real da unidade desde B2; o contador cobre a manutencao parcial. */
function combinaStatus(unidade: DashboardUnidade, filtro: FiltroStatus): boolean {
  switch (filtro) {
    case 'ONLINE': return unidade.status === UnitOperationalStatus.Available;
    case 'DEGRADADO': return unidade.status === UnitOperationalStatus.Degraded;
    case 'OFFLINE': return unidade.status === UnitOperationalStatus.Unavailable;
    case 'MANUTENCAO': return unidade.status === UnitOperationalStatus.Maintenance;
  }
}

function combinaCadastro(entrada: EntradaCadastro, texto: string): boolean {
  return [entrada.nome, entrada.hostname, entrada.ip].some((valor) => valor?.toLowerCase().includes(texto));
}

/** Agregado global a partir das linhas do relatório: razão entre tempo disponível e tempo monitorado. */
function agregarDisponibilidade(linhas: readonly DisponibilidadeUnidadeResponse[]): number | null {
  let disponivel = 0, monitorado = 0;
  for (const linha of linhas) {
    if (linha.tempoDisponivelSegundos === null || linha.tempoMonitoradoSegundos === null || linha.tempoMonitoradoSegundos <= 0) continue;
    disponivel += linha.tempoDisponivelSegundos;
    monitorado += linha.tempoMonitoradoSegundos;
  }
  return monitorado > 0 ? (disponivel / monitorado) * 100 : null;
}

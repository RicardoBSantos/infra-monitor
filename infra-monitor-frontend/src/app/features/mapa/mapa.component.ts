import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import * as L from 'leaflet';
import { take } from 'rxjs';

import { EquipmentOperationalStatus, UnitOperationalStatus } from '../../core/models/api-enums';
import { DashboardEquipamento, DashboardUnidade } from '../../core/models/dashboard';
import { GeoMunicipioService, Municipio, normalizeCodigoIbge } from '../../core/services/geo-municipio.service';
import { DashboardApiService } from '../../core/services/dashboard-api.service';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';

type MapState = 'loading' | 'success' | 'empty' | 'error';
export interface MapMunicipio extends Municipio { units: DashboardUnidade[]; }

/** Resultado do cruzamento entre a cartografia e as unidades operacionais. Puro: testável sem DOM. */
export interface Agrupamento { municipios: MapMunicipio[]; semLocalizacao: DashboardUnidade[]; semCorrespondencia: DashboardUnidade[]; }

/**
 * Associa cada unidade ao município pelo código IBGE.
 *
 * Duas listas de exceção saem daqui, e elas não são a mesma coisa: `semLocalizacao` é unidade sem
 * código IBGE nenhum (nunca foi georreferenciada); `semCorrespondencia` é unidade com código que a
 * cartografia carregada não conhece — tipicamente um município fora de Sergipe.
 */
export function agruparUnidades(fonte: Municipio[], unidades: DashboardUnidade[]): Agrupamento {
  const porCodigo = new Map<string, DashboardUnidade[]>();
  const semLocalizacao: DashboardUnidade[] = [];
  for (const unidade of unidades) {
    const codigo = normalizeCodigoIbge(unidade.codigoIbge);
    if (!codigo) { semLocalizacao.push(unidade); continue; }
    const grupo = porCodigo.get(codigo) ?? [];
    grupo.push(unidade);
    porCodigo.set(codigo, grupo);
  }
  const codigosMapa = new Set(fonte.map(municipio => municipio.codigoIbge));
  return {
    municipios: fonte.map(municipio => ({ ...municipio, units: porCodigo.get(municipio.codigoIbge) ?? [] })),
    semLocalizacao,
    semCorrespondencia: unidades.filter(unidade => !!normalizeCodigoIbge(unidade.codigoIbge) && !codigosMapa.has(normalizeCodigoIbge(unidade.codigoIbge))),
  };
}

/**
 * Sufixo da classe CSS do município. Mesma escala de cor do SVG anterior, sem alteração.
 *
 * A seleção NÃO entra aqui: virou uma segunda classe, somada a esta. Enquanto substituía o tom, o
 * azul do município selecionado colidia com o de `--em-manutencao` e, pior, escondia o status
 * justamente da unidade que o operador acabou de escolher.
 */
export function toneDoMunicipio(municipio: MapMunicipio): string {
  if (municipio.units.length === 0) return 'none';
  if (municipio.units.length > 1) return 'multiple';
  return municipio.units[0].status.toLowerCase().replace(/_/g, '-');
}

export function rotuloDoMunicipio(municipio: MapMunicipio): string {
  return `${municipio.nome}: ${municipio.units.length ? `${municipio.units.length} unidade(s)` : 'nenhuma unidade cadastrada'}`;
}

/** Uma linha do card "Status geográfico". `total` zerado não é omitido: a ausência é informação. */
export interface ContagemStatus { status: UnitOperationalStatus; total: number; }

/**
 * Contagem de unidades por status operacional, na ordem de severidade da leitura de plantão:
 * o que está quebrado primeiro. Deriva das mesmas unidades que colorem o mapa — nenhuma chamada
 * nova, e por construção o card não pode divergir da cor dos municípios.
 */
const ORDEM_SEVERIDADE: readonly UnitOperationalStatus[] = [
  UnitOperationalStatus.Unavailable, UnitOperationalStatus.Degraded, UnitOperationalStatus.Available,
  UnitOperationalStatus.Maintenance, UnitOperationalStatus.NoData, UnitOperationalStatus.NoEquipment,
];

export function contarPorStatus(unidades: DashboardUnidade[]): ContagemStatus[] {
  return ORDEM_SEVERIDADE
    .map(status => ({ status, total: unidades.filter(unidade => unidade.status === status).length }))
    .filter(linha => linha.total > 0);
}

/**
 * Equipamentos que justificam atenção na unidade selecionada: tudo que não está DISPONIVEL.
 *
 * DESABILITADO fica de fora de propósito — equipamento desligado por decisão administrativa não é
 * ocorrência. EM_MANUTENCAO entra, porque a janela de manutenção termina e alguém precisa ver.
 */
export function equipamentosAfetados(equipamentos: DashboardEquipamento[]): DashboardEquipamento[] {
  return equipamentos.filter(equipamento =>
    equipamento.status !== EquipmentOperationalStatus.Available
    && equipamento.status !== EquipmentOperationalStatus.Disabled);
}

@Component({ selector: 'app-mapa', imports: [StatusBadgeComponent], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './mapa.component.html', styleUrl: './mapa.component.scss' })
export class MapaComponent implements OnDestroy {
  private readonly geoMunicipio = inject(GeoMunicipioService);
  private readonly dashboardApi = inject(DashboardApiService);
  private readonly router = inject(Router);
  protected readonly state = signal<MapState>('loading');
  protected readonly municipios = signal<MapMunicipio[]>([]);
  protected readonly selected = signal<MapMunicipio | null>(null);
  protected readonly semLocalizacao = signal<DashboardUnidade[]>([]);
  protected readonly semCorrespondencia = signal<DashboardUnidade[]>([]);
  protected readonly error = signal<string | null>(null);

  /** Unidade em foco no painel. Município com uma única unidade seleciona sozinho; com várias, espera o clique. */
  protected readonly unidadeSelecionada = signal<DashboardUnidade | null>(null);
  protected readonly afetados = signal<DashboardEquipamento[]>([]);
  protected readonly afetadosState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  /** Contagem por status sobre TODAS as unidades, não só as do município selecionado. */
  protected readonly statusGeografico = computed(() => contarPorStatus(this.municipios().flatMap(municipio => municipio.units)));
  protected readonly totalUnidades = computed(() => this.municipios().reduce((soma, municipio) => soma + municipio.units.length, 0));
  private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');
  private sourceMunicipios: Municipio[] | null = null;
  private units: DashboardUnidade[] | null = null;

  private map: L.Map | null = null;
  private camada: L.GeoJSON | null = null;
  /** Elemento SVG de cada município, para trocar a classe sem reconstruir a camada. */
  private readonly elementos = new Map<string, SVGPathElement>();
  /**
   * Os listeners de teclado são nossos, não do Leaflet: `map.remove()` não sabe deles e não os
   * desfaz. O AbortController remove todos de uma vez quando a camada é reconstruída ou o
   * componente morre — sem isso, navegar para fora e voltar acumula handler sobre nó já descartado.
   */
  private teclado: AbortController | null = null;

  constructor() {
    this.load();
    // O container só existe quando o estado sai de loading/error; quando ele some, o mapa vai junto.
    effect(() => {
      const elemento = this.host()?.nativeElement;
      const municipios = this.municipios();
      if (!elemento || municipios.length === 0) { this.destruirMapa(); return; }
      this.montarMapa(elemento, municipios);
    });
    effect(() => this.aplicarTons(this.selected()?.codigoIbge ?? null));
  }

  ngOnDestroy(): void { this.destruirMapa(); }

  protected load(): void {
    this.state.set('loading'); this.error.set(null); this.selected.set(null); this.limparUnidade(); this.municipios.set([]); this.semLocalizacao.set([]); this.semCorrespondencia.set([]); this.sourceMunicipios = null; this.units = null;
    this.geoMunicipio.getMunicipios().pipe(take(1)).subscribe({ next: municipios => { this.sourceMunicipios = municipios; this.resolve(); }, error: () => this.fail('Erro ao carregar mapa: não foi possível carregar a cartografia de Sergipe.') });
    this.dashboardApi.getUnidades().pipe(take(1)).subscribe({ next: units => { this.units = units; this.resolve(); }, error: () => this.fail('Erro ao carregar dados operacionais: não foi possível consultar as unidades.') });
  }

  protected selectMunicipio(municipio: MapMunicipio): void {
    this.selected.set(municipio);
    // Com uma única unidade, exigir um segundo clique só para ver o detalhe seria atrito sem ganho.
    if (municipio.units.length === 1) { this.selectUnidade(municipio.units[0]); return; }
    this.limparUnidade();
  }

  protected selectUnidade(unidade: DashboardUnidade): void {
    this.unidadeSelecionada.set(unidade);
    this.afetados.set([]);
    this.afetadosState.set('loading');
    this.dashboardApi.getEquipamentosDaUnidade(unidade.id, { size: 200, sort: 'nome' }).pipe(take(1)).subscribe({
      next: pagina => {
        // A unidade pode ter mudado enquanto a resposta vinha: descartar resultado fora de ordem.
        if (this.unidadeSelecionada()?.id !== unidade.id) return;
        this.afetados.set(equipamentosAfetados(pagina.content));
        this.afetadosState.set('ready');
      },
      error: () => {
        if (this.unidadeSelecionada()?.id !== unidade.id) return;
        this.afetadosState.set('error');
      },
    });
  }

  protected goToUnidades(): void { void this.router.navigate(['/unidades']); }
  protected goToUnidade(unidade: DashboardUnidade): void { void this.router.navigate(['/unidades', unidade.id]); }
  /** A lista de Incidentes não aceita filtro por link; a aba da unidade já entrega o mesmo recorte. */
  protected goToIncidentes(unidade: DashboardUnidade): void { void this.router.navigate(['/unidades', unidade.id, 'incidentes']); }
  /** `/equipamentos/:id` é a lista com a gaveta de detalhe montada — não existe página cheia. */
  protected goToEquipamento(equipamento: DashboardEquipamento): void { void this.router.navigate(['/equipamentos', equipamento.id]); }

  private limparUnidade(): void { this.unidadeSelecionada.set(null); this.afetados.set([]); this.afetadosState.set('idle'); }

  private resolve(): void {
    if (!this.sourceMunicipios || !this.units || this.state() === 'error') return;
    const agrupado = agruparUnidades(this.sourceMunicipios, this.units);
    this.semLocalizacao.set(agrupado.semLocalizacao);
    this.semCorrespondencia.set(agrupado.semCorrespondencia);
    this.municipios.set(agrupado.municipios);
    this.state.set(this.units.length === 0 ? 'empty' : 'success');
  }

  private montarMapa(elemento: HTMLDivElement, municipios: MapMunicipio[]): void {
    this.destruirMapa();
    /*
     * Sem camada de tiles por decisão: a base cartográfica é o próprio GeoJSON, e o fundo continua
     * sendo o gradiente do cartão (ver `.leaflet-container { background: transparent }` no SCSS).
     * Sem tile também não há atribuição a exibir, daí `attributionControl: false`.
     *
     * `renderer: L.svg()` é obrigatório, não preferência: o renderizador Canvas não cria elemento
     * DOM por feature, e sem elemento não existe `tabindex` — a navegação por teclado, que o SVG
     * anterior tinha, seria impossível de recuperar.
     */
    const map = L.map(elemento, { renderer: L.svg(), attributionControl: false, zoomControl: true, /* zoomSnap 0 deixa o enquadramento inicial continuo: com o passo padrao o Leaflet arredonda o zoom e o mapa nao ocupa a mesma area que o SVG antigo ocupava. */ zoomSnap: 0, minZoom: 6, maxZoom: 14 });
    this.map = map;
    this.teclado = new AbortController();
    const signalAbort = this.teclado.signal;

    this.camada = L.geoJSON({ type: 'FeatureCollection', features: municipios.map(municipio => municipio.feature) } as unknown as GeoJSON.GeoJsonObject, {
      // `fillOpacity`/`opacity` em 1 porque o Leaflet, no padrão, escreve fill-opacity="0.2" como
      // atributo; ele multiplicaria o alpha das cores rgba() do tema e clarearia todo o mapa.
      style: () => ({ fillOpacity: 1, opacity: 1, weight: 1.2, className: 'map__municipio' }),
    }).addTo(map);

    /*
     * O enquadramento vem ANTES da decoração, e a ordem não é estética. `map.addLayer` adia o
     * trabalho real por `whenReady`: enquanto o mapa não tem view definida, as camadas ficam na
     * fila, sem `_path` e fora do DOM. Decorar antes disto encontra `getElement()` nulo em todos os
     * municípios e o `tabindex` simplesmente não é escrito — falha silenciosa, mapa inacessível.
     */
    map.fitBounds(this.camada.getBounds(), { padding: [34, 34] });

    this.camada.eachLayer(layer => {
      const propriedades = (layer as L.Layer & { feature?: { properties?: { id?: string } } }).feature?.properties;
      const codigo = normalizeCodigoIbge(propriedades?.id);
      const municipio = municipios.find(candidato => candidato.codigoIbge === codigo);
      if (!municipio) return;
      layer.on('click', () => { this.selectMunicipio(municipio); });
      const elementoPath = (layer as L.Path).getElement() as SVGPathElement | null;
      if (!elementoPath) return;
      this.elementos.set(codigo, elementoPath);
      // O Leaflet não torna vetor focável; o SVG manual anterior tinha tabindex e Enter/Espaço.
      elementoPath.setAttribute('tabindex', '0');
      elementoPath.setAttribute('role', 'button');
      elementoPath.setAttribute('aria-label', rotuloDoMunicipio(municipio));
      elementoPath.setAttribute('data-codigo-ibge', codigo);
      elementoPath.addEventListener('keydown', (evento: KeyboardEvent) => {
        if (evento.key !== 'Enter' && evento.key !== ' ') return;
        evento.preventDefault();
        this.selectMunicipio(municipio);
      }, { signal: signalAbort });
    });

    /*
     * `untracked` NÃO é detalhe. Este trecho roda dentro do effect de montagem, e `aplicarTons` lê
     * `selected()` e `municipios()`: sem isolar, o effect passa a depender da seleção e cada clique
     * destrói a camada e reprojeta a cartografia inteira. O nó do município selecionado saía do DOM
     * com o foco dentro, e o teclado voltava para o `body` — o município deixava de ser navegável
     * a partir de onde o operador estava. O effect de tons, logo abaixo, é quem deve seguir a
     * seleção; aqui a chamada existe só para pintar a camada recém-criada na mesma volta.
     */
    untracked(() => this.aplicarTons(this.selected()?.codigoIbge ?? null));
  }

  private aplicarTons(selecionado: string | null): void {
    let marcadoElemento: SVGPathElement | null = null;
    for (const municipio of this.municipios()) {
      const elemento = this.elementos.get(municipio.codigoIbge);
      if (!elemento) continue;
      const marcado = municipio.codigoIbge === selecionado;
      elemento.setAttribute('class', `map__municipio map__municipio--${toneDoMunicipio(municipio)}${marcado ? ' map__municipio--selected' : ''}`);
      if (marcado) marcadoElemento = elemento;
    }
    /*
     * O anel da seleção corre sobre a fronteira, que é compartilhada: o vizinho pintado depois
     * cobre metade dele. Reordenar no DOM é o que o Leaflet chama de `bringToFront`; sem isto o
     * contorno sai recortado nos municípios do meio do mapa.
     *
     * `appendChild` de um nó que já está no documento é remoção seguida de inserção, e o foco não
     * sobrevive a isso: selecionar pelo teclado devolveria o foco ao `body`. Daí devolver o foco ao
     * mesmo nó, com `preventScroll` para o mapa não saltar sob quem usa mouse.
     */
    if (!marcadoElemento) return;
    const tinhaFoco = document.activeElement === marcadoElemento;
    marcadoElemento.parentNode?.appendChild(marcadoElemento);
    if (tinhaFoco) marcadoElemento.focus({ preventScroll: true });
  }

  private destruirMapa(): void {
    this.teclado?.abort();
    this.teclado = null;
    this.elementos.clear();
    this.camada = null;
    this.map?.remove();
    this.map = null;
  }

  private fail(message: string): void { this.error.set(message); this.state.set('error'); }
}

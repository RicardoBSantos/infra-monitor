import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { LngLatBounds, Map as MaplibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl';
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

/** Cor de cada tom, em hex — o canvas WebGL nao le variavel CSS. Mesmos valores do tema escuro. */
const COR_DO_TOM: Record<string, string> = {
  'disponivel': '#34c77b', 'indisponivel': '#e5484d', 'degradada': '#e8a33d', 'em-manutencao': '#7fadff',
  'sem-dados': '#435464', 'sem-equipamentos': '#263744', 'multiple': '#38536b', 'none': '#0c1722',
};

/**
 * Colar do município selecionado. Três decisões, cada uma custou uma tentativa:
 *
 * 1. Não reaproveita `--im-primary` (#3B6EFF), a cor do anel no mapa plano: em 3D o colar encosta
 *    no bloco, e azul sobre `em-manutencao` (#7fadff) ficava ambíguo.
 * 2. Não é magenta saturado (#c05cff). Translúcido, magenta sobre verde vira cinza dessaturado —
 *    apaga o status E apaga a seleção. Lilás claro clareia sem torcer o matiz de baixo.
 * 3. É claro, não escuro: o fundo do mapa é escuro, e só um tom claro se separa dele.
 *
 * Nenhum status usa esta faixa do espectro, então o colar nunca é lido como estado operacional.
 */
const COR_SELECAO = '#f2d6ff';

/**
 * Altura da extrusão: metros por equipamento monitorado no município (decisão de produto N03).
 *
 * 400 e não os 800 do spike porque no banco real a distribuição é desigual — Aracaju soma quatro
 * unidades e 81 equipamentos, o triplo do segundo colocado. Com 800 aquele bloco virava uma parede
 * de 65 km que tapava metade do estado. A escala segue linear: a legenda promete altura
 * proporcional a equipamentos, e achatar o maior por estética quebraria essa promessa.
 */
const METROS_POR_EQUIPAMENTO = 400;

/** Espessura do anel em metros. O anel é um colar no topo da extrusão, não um traço no chão. */
const ESPESSURA_ANEL = 700;

/**
 * Opacidade do colar. Não é 1 de propósito: o mapa é visto de cima, e colar opaco apagava a face
 * superior — justamente a mais visível — deixando o município selecionado sem cor de status. Isso
 * inverteria a prioridade: status é o dado operacional, seleção é só interação. O anel do mapa
 * plano (M04) era ortogonal ao status, e essa propriedade tinha de sobreviver ao 3D.
 */
const OPACIDADE_ANEL = 0.5;

/** Inclinação padrão da experiência — não é toggle: em pitch 0 o mapa é o Leaflet de antes. */
const PITCH = 45;
const BEARING = -18;

/**
 * Offset da câmera, em pixels de tela. Com a inclinação aplicada o estado sobe e sobra faixa morta
 * na metade de baixo do cartão; este deslocamento recoloca o alvo mais abaixo. Calibrado no cartão
 * de 580px de altura, que tem proporção fixa `760/680` — então vale em qualquer largura.
 */
const OFFSET_CAMERA: [number, number] = [0, 40];

/**
 * Zoom somado ao enquadramento plano na hora de inclinar. Inclinar encolhe o desenho — a mesma
 * área passa a caber num trapézio menor — e sem esta compensação o estado fica pequeno no meio do
 * cartão, com faixa morta em cima E embaixo.
 */
const ZOOM_AO_INCLINAR = 0.55;

/** Varre coordenadas de Polygon/MultiPolygon sem alocar array intermediario. */
export function percorrerCoordenadas(geometria: { coordinates: unknown }, visitar: (ponto: number[]) => void): void {
  const anda = (no: unknown): void => {
    if (Array.isArray(no) && typeof no[0] === 'number') { visitar(no as number[]); return; }
    if (Array.isArray(no)) for (const filho of no) anda(filho);
  };
  anda(geometria.coordinates);
}

/** Centro do envelope do municipio. Nao e o polo de inacessibilidade: em municipio concavo pode cair fora. */
export function centroideAproximado(geometria: { coordinates: unknown }): [number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  percorrerCoordenadas(geometria, ([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); });
  return Number.isFinite(minX) ? [(minX + maxX) / 2, (minY + maxY) / 2] : null;
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
  /** Região viva: o painel lateral é visual, e sem isto quem navega por teclado não ouve a troca. */
  protected readonly anuncio = signal('');

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

  private map: MaplibreMap | null = null;
  /** Um Marker por municipio: unico no DOM focavel, ja que o poligono vive no canvas WebGL. */
  private readonly marcadores = new Map<string, Marker>();
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
    this.anuncio.set(`${municipio.nome} selecionado. ${municipio.units.length ? `${municipio.units.length} unidade(s).` : 'Nenhuma unidade cadastrada.'}`);
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
     * O MapLibre parseia o GeoJSON num Web Worker próprio, que o pacote publica como arquivo ESM
     * separado (`maplibre-gl-worker.mjs`). O builder do Angular NÃO emite esse arquivo: o
     * `new Worker(new URL(...))` está dentro de node_modules e passa batido. Sem isto o mapa sobe
     * inteiro — canvas, controles, marcadores — e nunca desenha nada, porque a fonte fica presa em
     * "carregando" e `isStyleLoaded()` jamais vira true. Não há erro no console.
     *
     * Por isso o worker e o módulo que ele importa são copiados como assets (ver `angular.json`) e
     * apontados aqui. `document.baseURI` em vez de caminho absoluto: a aplicação tem de continuar
     * funcionando se um dia for servida sob um sub-caminho.
     */
    setWorkerUrl(new URL('maplibre/maplibre-gl-worker.mjs', document.baseURI).href);
    this.teclado = new AbortController();
    const signalAbort = this.teclado.signal;

    const colecao = {
      type: 'FeatureCollection',
      features: municipios.map(municipio => ({
        ...municipio.feature,
        properties: {
          ...municipio.feature.properties,
          cor: COR_DO_TOM[toneDoMunicipio(municipio)],
          // Altura = equipamentos monitorados na unidade (decisao de produto N03).
          equipamentos: municipio.units.reduce((soma, unidade) => soma + unidade.equipamentosTotal, 0),
        },
      })),
    } as unknown as Record<string, unknown>;

    const map = new MaplibreMap({
      container: elemento,
      // Estilo proprio: sem tiles, sprite ou glyphs — nenhuma requisicao de rede externa.
      style: { version: 8, sources: { municipios: { type: 'geojson', data: colecao } }, layers: [
        { id: 'fundo', type: 'background', paint: { 'background-color': 'rgba(0,0,0,0)' } },
        { id: 'municipios-3d', type: 'fill-extrusion', source: 'municipios', paint: {
            'fill-extrusion-color': ['get', 'cor'],
            'fill-extrusion-height': ['*', ['get', 'equipamentos'], METROS_POR_EQUIPAMENTO],
            'fill-extrusion-opacity': 0.92 } },
        { id: 'municipios-contorno', type: 'line', source: 'municipios', paint: { 'line-color': '#294056', 'line-width': 1 } },
        /*
         * Anel de seleção como segunda extrusão, e não como `line`: camada de linha desenha no
         * nível do chão, e em município alto o anel ficava no pé do bloco, longe do topo que o
         * operador está olhando. Este colar nasce onde a extrusão termina e sobe `ESPESSURA_ANEL`.
         */
        { id: 'municipio-selecionado', type: 'fill-extrusion', source: 'municipios', filter: ['==', ['get', 'id'], ''], paint: {
            'fill-extrusion-color': COR_SELECAO,
            'fill-extrusion-base': ['*', ['get', 'equipamentos'], METROS_POR_EQUIPAMENTO],
            'fill-extrusion-height': ['+', ['*', ['get', 'equipamentos'], METROS_POR_EQUIPAMENTO], ESPESSURA_ANEL],
            'fill-extrusion-opacity': OPACIDADE_ANEL } },
      ] },
      // Nasce plano: o enquadramento é calculado sem inclinação, e o pitch entra depois (ver abaixo).
      attributionControl: false, minZoom: 6, maxZoom: 14, maxPitch: 60, pitch: 0, bearing: BEARING,
    });
    this.map = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');

    const limites = new LngLatBounds();
    for (const municipio of municipios) percorrerCoordenadas(municipio.feature.geometry, ponto => limites.extend(ponto as [number, number]));
    /*
     * Duas etapas de propósito. `fitBounds` com `pitch` junto encolhe o mapa: a câmera recua para
     * caber a área inclinada, que é maior que o retângulo. Enquadra-se plano, onde a projeção
     * cobre o cartão inteiro, e só então aplica-se a inclinação com `OFFSET_CAMERA`.
     */
    map.fitBounds(limites, { padding: 34, bearing: BEARING, duration: 0 });
    map.easeTo({ pitch: PITCH, zoom: map.getZoom() + ZOOM_AO_INCLINAR, offset: OFFSET_CAMERA, duration: 0 });

    map.on('click', 'municipios-3d', evento => {
      const codigo = normalizeCodigoIbge(evento.features?.[0]?.properties?.['id'] as string);
      const municipio = municipios.find(candidato => candidato.codigoIbge === codigo);
      if (municipio) this.selectMunicipio(municipio);
    });

    /*
     * Acessibilidade (N02): o canvas WebGL nao cria no por feature, entao o tab-stop de cada
     * municipio e um Marker — elemento DOM real que a propria lib reposiciona em pan, zoom, pitch
     * e rotate, sem sincronizacao manual por frame.
     */
    for (const municipio of municipios) {
      const centro = centroideAproximado(municipio.feature.geometry);
      if (!centro) continue;
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'map__alvo';
      botao.setAttribute('aria-label', rotuloDoMunicipio(municipio));
      botao.setAttribute('data-codigo-ibge', municipio.codigoIbge);
      botao.addEventListener('click', () => this.selectMunicipio(municipio), { signal: signalAbort });
      // Alvo fora da viewport continua focavel pelo Tab: ao receber foco, traz a camera ate ele.
      botao.addEventListener('focus', () => { if (!map.getBounds().contains(centro)) map.easeTo({ center: centro, duration: 200 }); }, { signal: signalAbort });
      /*
       * Alinhamento em `viewport` (o padrão, explícito para não se perder numa refatoração): com
       * `map` o alvo e o anel de foco deitam junto com o terreno e o foco fica ilegível.
       */
      const marcador = new Marker({ element: botao, pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat(centro).addTo(map);
      this.marcadores.set(municipio.codigoIbge, marcador);
    }

    // `aplicarTons` depende do estilo pronto, e no primeiro monte ele ainda não está.
    map.on('load', () => untracked(() => this.aplicarTons(this.selected()?.codigoIbge ?? null)));
    untracked(() => this.aplicarTons(this.selected()?.codigoIbge ?? null));
  }

  private aplicarTons(selecionado: string | null): void {
    const map = this.map;
    if (!map) return;
    /*
     * O `aria-pressed` vem primeiro, e fora da guarda de estilo. Enquanto os dois estavam depois
     * do `isStyleLoaded()`, selecionar antes de o estilo terminar de carregar deixava o marcador
     * sem estado nenhum — o painel abria, o anúncio saía, e o leitor de tela continuava dizendo
     * que nada estava selecionado. O efeito não roda de novo sozinho: a dependência não mudou.
     */
    for (const municipio of this.municipios()) {
      const marcador = this.marcadores.get(municipio.codigoIbge);
      marcador?.getElement().setAttribute('aria-pressed', String(municipio.codigoIbge === selecionado));
    }
    if (!map.isStyleLoaded()) return;
    map.setFilter('municipio-selecionado', ['==', ['get', 'id'], selecionado ?? '']);
  }

  private destruirMapa(): void {
    this.teclado?.abort();
    this.teclado = null;
    for (const marcador of this.marcadores.values()) marcador.remove();
    this.marcadores.clear();
    this.map?.remove();
    this.map = null;
  }

  private fail(message: string): void { this.error.set(message); this.state.set('error'); }
}

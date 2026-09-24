import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import type { Feature, FeatureCollection } from 'geojson';
import type { LayerSpecification } from 'maplibre-gl';
import { LngLatBounds, Map as MaplibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import { take } from 'rxjs';


import { EquipmentOperationalStatus, UnitOperationalStatus } from '../../core/models/api-enums';
import { DashboardEquipamento, DashboardUnidade } from '../../core/models/dashboard';
import { GeoMunicipioService, Municipio, divergenciaIbge, normalizeCodigoIbge } from '../../core/services/geo-municipio.service';
import { DashboardApiService } from '../../core/services/dashboard-api.service';
import { LABELS as ROTULO_STATUS, StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { EquipamentoDetalheDrawerComponent, EquipamentoResumo } from '../equipamentos/equipamento-detalhe-drawer.component';

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

/**
 * Cor de cada status operacional, em hex — o canvas WebGL nao le variavel CSS. Mesmos valores do
 * tema escuro.
 *
 * Consumida pelo marcador de unidade, por `camadasDeConexao()` (`line-color`) e pelo `--cor-ping`
 * do ping da conexão. Era `COR_DO_TOM` e pintava também o polígono do município;
 * com a coloração do polígono removida (N07), os dois tons que só existiam ali — `multiple` e
 * `none`, que não são status de unidade nenhum — saíram junto, e o que restou corresponde
 * exatamente ao enum `UnitOperationalStatus`.
 *
 * D19 clareou os dois tons neutros. Enquanto o marcador tinha ARO CLARO de 2px, o miolo podia ser
 * escuro à vontade: quem separava o marcador do município era o aro, a 13,05:1. Com o aro removido
 * (D19 item 1) o miolo virou o único portador de contraste, e os valores de N06 não sustentam o
 * papel: `sem-dados` #435464 dava 1,92:1 contra #16283a e `sem-equipamentos` #263744 dava 1,22:1 —
 * a 13px, marcador invisível. #8797a6 dá 5,01:1 e #667b8b dá 3,41:1, ambos acima dos 3:1 de
 * WCAG 1.4.11 para elemento gráfico essencial. Continuam sendo os dois tons mais dessaturados da
 * tabela, que é o que os faz ler como ausência de dado e não como estado; o que mudou foi a
 * luminância, não o matiz.
 *
 * Esse clareamento é também o que sustenta o pulso geral de D19: o argumento de N07 para pulsar só
 * dois status era, em parte, que `sem-dados` (1,92:1) e `sem-equipamentos` (1,22:1) gerariam anel de
 * pulso ilegível. Com 5,01:1 e 3,41:1 o argumento caiu — os seis pulsam com anel legível.
 */
const COR_DO_STATUS: Record<string, string> = {
  'disponivel': '#34c77b', 'indisponivel': '#e5484d', 'degradada': '#e8a33d', 'em-manutencao': '#7fadff',
  'sem-dados': '#8797a6', 'sem-equipamentos': '#667b8b',
};

/**
 * Cor do status, com queda para `sem-dados` no valor que a API venha a acrescentar.
 *
 * A conversão de valor do enum (`EM_MANUTENCAO`) para chave de `COR_DO_STATUS` (`em-manutencao`)
 * ficava numa função à parte (`chaveDeStatus`) enquanto tinha dois chamadores — marcador e
 * gradiente da conexão. O gradiente saiu em D18 (linha inteira, sem gradiente), sobrou só este
 * chamador, e a função virou inline: as chaves em kebab existem porque são as mesmas dos nomes de
 * classe e das variáveis CSS.
 */
function corDoStatus(status: string): string {
  return COR_DO_STATUS[status.toLowerCase().replace(/_/g, '-')] ?? COR_DO_STATUS['sem-dados'];
}

/**
 * Cor única do polígono de município. Fundo neutro escuro, igual em todos — o município voltou a ser
 * cartografia, e não indicador de estado.
 *
 * Por que a cor de status saiu do polígono: um município é uma área grande e irregular, e a mesma
 * cor que num marcador de 13px lê como "esta unidade está indisponível", num polígono de meia tela
 * lê como "esta REGIÃO está indisponível" — leitura que o dado não sustenta. Aracaju, com quatro
 * unidades, nem status tinha: caía no tom `multiple`, que não é estado operacional nenhum. O estado
 * passa a ter um portador só, o marcador de unidade.
 *
 * O valor fica entre o `none` antigo (#0c1722, escuro demais — o polígono sumia no gradiente do
 * cartão) e o `sem-equipamentos` (#667b8b, já encostado na faixa de status): claro o bastante para o
 * contorno recortar a forma, escuro o bastante para o marcador colorido vencer por contraste.
 */
const COR_MUNICIPIO = '#16283a';

/**
 * Contorno do município. **Clareado de #294056 para #456a8e nesta rodada**, e a razão é D15.
 *
 * Enquanto cada município tinha cor de status, a divisa entre dois deles era a diferença entre dois
 * PREENCHIMENTOS — o traço era reforço, não o separador. Com o preenchimento constante, o traço
 * virou a única coisa que separa um município do vizinho, e #294056 contra #16283a dá **1,40:1**:
 * na revisão visual da captura as divisas simplesmente não estavam lá.
 *
 * #456a8e dá 2,65:1. Não chega aos 3:1 de WCAG 1.4.11 de propósito: a 75 municípios num zoom de
 * estado, traço com contraste de controle de interface vira grade, e a divisa é contexto — o
 * conteúdo essencial (o estado operacional) está no marcador. Desde D19 o marcador não tem mais
 * aro: o miolo sozinho carrega o contraste, entre 3,41:1 (`sem-equipamentos`, o pior caso) e
 * 6,96:1 (`degradada`) contra #16283a — ver o comentário de `COR_DO_STATUS`. 2,65:1 é onde a forma
 * se lê sem a malha competir com os marcadores; medido por captura, não estimado.
 */
const COR_CONTORNO_MUNICIPIO = '#456a8e';

/**
 * Duração de uma travessia completa do ping — hub → unidade → hub.
 *
 * 4200 ms, e não os 2600 de N07. O valor antigo foi escolhido contra uma linha reta e curta; com
 * vinte pings simultâneos no estado inteiro o conjunto lia como tráfego agitado, não como um
 * batimento de sonda. O período é a ÚNICA variável do movimento (a fase de ida-e-volta e o passo
 * são funções puras dele), então desacelerar é trocar este número — nada mais muda.
 */
const PERIODO_PING_MS = 4200;

/**
 * Pings simultâneos por linha. Dois, em fase oposta: enquanto um vai, o outro volta — é isto que
 * entrega o "ida e volta" do ICMP echo sem nenhuma camada extra nem inversão periódica de animação.
 */
const PINGS_POR_LINHA = 2;

/**
 * Posição na ida-e-volta, dado o tempo em ciclos. `0 → 1 → 0` num ciclo. Pura.
 *
 * É o que torna a técnica escolhida barata: as linhas de conexão têm EXATAMENTE dois vértices
 * (hub e unidade), então "quanto do caminho já andei" é um número só, e a volta é o mesmo número
 * espelhado. Não há comprimento de arco a percorrer nem vértice intermediário a procurar.
 */
export function faseVaiEVolta(ciclos: number): number {
  const fase = ((ciclos % 1) + 1) % 1;
  return fase < 0.5 ? fase * 2 : (1 - fase) * 2;
}

/** Ponto a `u` do caminho entre dois pares [lng, lat]. Pura. */
export function interpolar(origem: [number, number], destino: [number, number], u: number): [number, number] {
  return [origem[0] + (destino[0] - origem[0]) * u, origem[1] + (destino[1] - origem[1]) * u];
}

/**
 * Preferência do sistema por menos movimento. Lida no momento de montar, e não guardada: o operador
 * pode trocar a preferência do SO com a tela aberta, e o próximo monte do mapa já respeita.
 */
function animacaoReduzida(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/*
 * O anel lilás que contornava o município selecionado SAIU.
 *
 * Ele era a última coisa que fazia o polígono participar da interação, e isso contradiz o que N07
 * já tinha decidido: o município é cartografia neutra, a unidade é quem carrega estado. Um contorno
 * de 3px em volta de uma área de meia tela afirma sobre a ÁREA — mesmo num tom que nenhum status
 * usa, ele é o elemento mais chamativo do desenho justamente no instante do clique, e o dado ali é
 * a unidade, não a região.
 *
 * A seleção continua inteira, só que no marcador: `aria-pressed` nos dois marcadores (o alvo
 * invisível do município e o da unidade), anel na cor do status em
 * `.map__unidade[aria-pressed='true']` (D19 — era lilás fixo até D18) e o
 * painel lateral. Nenhum canal saiu — e o anel de seleção continua vivo no SCSS, onde a superfície
 * embaixo dele tem 13px e não meio estado.
 *
 * Com a camada `municipio-selecionado` foi embora a única razão de a marcação de seleção esperar o
 * estilo do mapa carregar: `marcarMunicipio` mexe só em atributo de DOM.
 */

/** Inclinação padrão da experiência — não é toggle: em pitch 0 o mapa é o Leaflet de antes. */
const PITCH = 45;
const BEARING = -18;

/**
 * Offset da câmera, em pixels de tela: recentra o desenho depois da compensação de zoom.
 *
 * Recalibrado do zero — 82 vinha de N05 e 40 do spike, e os dois compensavam o encolhimento do
 * BLOCO inclinado, problema que não existe mais. Herdá-los teria mantido correção sem causa. Os
 * valores atuais saíram de medição por pixel do desenho contra o fundo do próprio cartão (o canvas
 * não é legível in-page: `preserveDrawingBuffer` está desligado), varrendo zoom e offset até topo
 * e base ficarem equilibrados: 10,9% contra 9,3% em 1500x950, 10,8% contra 10,0% em 1700x907,
 * 10,9% contra 12,4% em 1280x800.
 *
 * O `-24` em x é o único valor novo: com `bearing -18` o estado deitado desloca-se para a esquerda
 * quando a câmera sobe, e sem ele a ponta oeste ficava a 4px da borda (0,4% de folga contra 5,7%
 * do outro lado). Com ele, 2,2% contra 4,1%.
 */
const OFFSET_CAMERA: [number, number] = [-24, 60];

/**
 * Zoom somado ao enquadramento na hora de inclinar. Continua existindo porque `fitBounds` com
 * `pitch` recua a câmera para caber o trapézio inteiro — 52% da altura do cartão sobrando, medido
 * — mas o valor não é mais o de N05: 0,68, não 0,75, e agora contra a moldura já inclinada e não
 * contra o enquadramento plano.
 *
 * O teto é a largura, não a altura: acima de 0,70 a ponta oeste do estado começa a sair do cartão,
 * enquanto ainda sobram ~20% de altura. Isso é geometria de Sergipe deitado a -18°, não folga a
 * fechar. `e2e/n06-marcadores-e-conexoes` mede topo e base a cada execução e falha se
 * desequilibrarem.
 */
const ZOOM_AO_INCLINAR = 0.68;

const LARGURA_CONEXAO = 1.4;
/**
 * Linha translucida. Ela cruza o estado inteiro e passa por cima de municipios cuja cor de status e
 * o dado que importa; opaca, ela recortava o bloco em dois. Com D18 a linha inteira carrega a cor
 * do status, e a translucidez continua cumprindo o mesmo papel: deixar o município por baixo
 * legível mesmo com a linha colorida de ponta a ponta por cima dele.
 */
const OPACIDADE_CONEXAO = 0.65;

/**
 * Curvatura do arco, como fração do comprimento da corda hub→unidade.
 *
 * Fração e não valor absoluto: é isso que dá "mesmo efeito visual em todas as conexões". Com um
 * afastamento fixo em graus, a conexão curta viraria um laço e a longa ficaria visualmente reta.
 * Proporcional, todos os arcos têm a mesma barriga relativa, como as rotas de um mapa aéreo.
 *
 * 0,14 é o ponto em que o arco se lê como intenção e não como erro de geometria: abaixo de ~0,08
 * ele é indistinguível de reta na escala de Sergipe, acima de ~0,20 as conexões que saem do mesmo
 * hub começam a se cruzar entre si.
 */
const CURVATURA_ARCO = 0.14;

/**
 * Vértices do arco desenhado. O arco é matemática contínua; o GeoJSON é polilinha, e este é o
 * número de segmentos em que ela é amostrada. 32 porque abaixo de ~20 a quebra aparece no zoom
 * máximo (14) e acima disso só se paga vértice: são ~20 conexões, não milhares.
 */
const SEGMENTOS_DO_ARCO = 32;

/**
 * Ponto de controle da curva de Bézier quadrática que descreve o arco. Puro.
 *
 * Perpendicular à corda, sempre com o mesmo sinal (giro de -90°): todas as conexões arqueiam para o
 * mesmo lado. Arquear para lados diferentes conforme a direção faria o conjunto ler como ruído.
 *
 * Geometria plana em lng/lat, sem correção por cos(lat): a -10,9° o fator é 0,982, e a distorção
 * que ele introduziria no arco é menor que a espessura de 1,4px da própria linha. Isto é desenho,
 * não medida — a distância real nunca foi lida daqui.
 */
export function controleDoArco(origem: [number, number], destino: [number, number]): [number, number] {
  const [x0, y0] = origem;
  const [x1, y1] = destino;
  return [(x0 + x1) / 2 + (y1 - y0) * CURVATURA_ARCO, (y0 + y1) / 2 - (x1 - x0) * CURVATURA_ARCO];
}

/**
 * Ponto a `u` do arco entre duas pontas. Puro.
 *
 * De Casteljau sobre `interpolar`, e não a forma expandida do polinômio: três interpolações lineares
 * reaproveitam a função que o ping já usava, e o ping continua sendo uma conta de O(1) por quadro —
 * o que fazia a técnica de N07 ser barata. O arco não introduziu busca por comprimento de arco nem
 * varredura de vértice: a curva é conhecida em forma fechada, e `u` é o mesmo parâmetro de antes.
 */
export function pontoNoArco(origem: [number, number], destino: [number, number], u: number): [number, number] {
  const controle = controleDoArco(origem, destino);
  return interpolar(interpolar(origem, controle, u), interpolar(controle, destino, u), u);
}

/** O arco amostrado como polilinha, para o GeoJSON. Puro. As duas pontas são exatas. */
export function arcoEntre(origem: [number, number], destino: [number, number]): [number, number][] {
  return Array.from({ length: SEGMENTOS_DO_ARCO + 1 }, (_, i) => pontoNoArco(origem, destino, i / SEGMENTOS_DO_ARCO));
}

/**
 * Uma camada só, com a cor saindo da própria feature.
 *
 * D17 tinha dividido a conexão em seis camadas filtradas por status, e ligado `lineMetrics: true`
 * na fonte, por uma razão única: `line-gradient` é a única paint property do MapLibre que NÃO
 * aceita expressão dirigida por propriedade da feature. Sem gradiente, a restrição some junto — e
 * `['get', 'status']` num `match` é o mesmo padrão de coloração por status que o resto do sistema
 * já usa (StatusBadgeComponent, cores de KPI).
 *
 * `match` e não `case`: a chave é um enum fechado, e o fallback cobre o status que a API venha a
 * acrescentar — a mesma queda para `sem-dados` que `corDoStatus` faz.
 */
export function camadasDeConexao(): LayerSpecification[] {
  return [{
    id: 'conexoes-linha',
    type: 'line',
    source: 'conexoes',
    layout: { 'line-cap': 'round' },
    paint: {
      'line-width': LARGURA_CONEXAO,
      'line-opacity': OPACIDADE_CONEXAO,
      'line-color': ['match', ['get', 'status'],
        ...Object.values(UnitOperationalStatus).flatMap(status => [status, corDoStatus(status)]),
        COR_DO_STATUS['sem-dados']],
    },
  } as unknown as LayerSpecification];
}

/** Coordenada da unidade, quando as duas metades existem. Nunca por veracidade: 0 e valido. */
export function coordenadaDaUnidade(unidade: DashboardUnidade): [number, number] | null {
  return unidade.latitude != null && unidade.longitude != null ? [unidade.longitude, unidade.latitude] : null;
}

/**
 * Segmentos hub->unidade desenhaveis, como GeoJSON.
 *
 * So entra o par em que AMBAS as pontas tem coordenada — a guarda ja prevista em N04. Unidade com
 * pai cadastrado mas sem coordenada (a sua ou a do pai) simplesmente nao produz linha: meia linha,
 * saindo do nada ou terminando no nada, seria pior que nenhuma. Pai inexistente na lista (unidade
 * inativa, que o read-model filtra) cai no mesmo caso.
 *
 * Pura: testavel sem DOM e sem MapLibre.
 */
export function conexoesDesenhaveis(unidades: DashboardUnidade[]): Feature[] {
  const porId = new Map(unidades.map(unidade => [unidade.id, unidade]));
  const linhas: Feature[] = [];
  for (const unidade of unidades) {
    if (unidade.conectaAUnidadeId == null) continue;
    const pai = porId.get(unidade.conectaAUnidadeId);
    const origem = pai ? coordenadaDaUnidade(pai) : null;
    const destino = coordenadaDaUnidade(unidade);
    if (!origem || !destino) continue;
    /*
     * `status` é o do FILHO, não o do hub: a linha existe por causa da unidade conectada, e é o
     * estado dela que o ping carrega e que a linha inteira assume. Serve também ao `match` de
     * `camadasDeConexao`.
     *
     * A geometria deixou de ser o par de pontas e passou a ser o arco amostrado. As pontas seguem
     * sendo o primeiro e o último vértice, exatos — é de onde `montarPings` os lê.
     */
    linhas.push({
      type: 'Feature',
      properties: { de: unidade.conectaAUnidadeId, para: unidade.id, status: unidade.status },
      geometry: { type: 'LineString', coordinates: arcoEntre(origem, destino) },
    });
  }
  return linhas;
}

/**
 * Rotulo do marcador de unidade. Status por extenso: "DEGRADADA" cru nao e texto de leitor de tela.
 *
 * Os incidentes abertos entraram aqui junto com a dica de relance (N07): a dica aparece no hover E
 * no foco, mas ela é `aria-hidden` — quem usa leitor de tela não a "vê", ouve este rótulo. Se o
 * número só estivesse na dica, o mouse teria uma informação que o teclado não tem.
 */
export function rotuloDaUnidade(unidade: DashboardUnidade): string {
  return `${unidade.nome}: ${ROTULO_STATUS[unidade.status]}, ${unidade.equipamentosTotal} equipamento(s), `
    + `${unidade.incidentesAbertos} incidente(s) aberto(s)`;
}

/**
 * Dica de relance do marcador, como filho do próprio <button>.
 *
 * Elemento próprio, e NÃO `Popup` do MapLibre: o `Popup` é uma segunda entidade ancorada por
 * `LngLat`, que a lib reprojeta por conta — mas o marcador já é um elemento DOM que ela reposiciona,
 * e pendurar a dica dentro dele a faz acompanhar de graça, sem sincronizar duas coisas, sem a folha
 * do `Popup` para sobrescrever e sem o botão de fechar que ele traz.
 *
 * `aria-hidden`: o conteúdo já está no `aria-label` do botão (ver `rotuloDaUnidade`), e sem isto o
 * leitor de tela anuncia os mesmos três dados duas vezes.
 *
 * Três campos, não os sete da referência. Latência, disponibilidade, monitores e última verificação
 * não existem em `DashboardUnidade` — são de granularidade de equipamento ou de relatório. Buscar
 * no hover seria uma requisição por passagem de mouse, com a dica piscando vazia. Ver a tabela de
 * cobertura em `Docs/mapa-architecture/mapa-contexto-atual.md` §9.5.
 */
function dicaDaUnidade(unidade: DashboardUnidade): HTMLElement {
  const dica = document.createElement('span');
  dica.className = 'map__dica';
  dica.setAttribute('aria-hidden', 'true');

  const nome = document.createElement('span');
  nome.className = 'map__dica-nome';
  nome.textContent = unidade.nome;
  dica.appendChild(nome);

  for (const [rotulo, valor] of [
    ['STATUS', ROTULO_STATUS[unidade.status]],
    ['INCIDENTES ABERTOS', String(unidade.incidentesAbertos)],
  ] as const) {
    const linha = document.createElement('span');
    linha.className = 'map__dica-linha';
    const chave = document.createElement('span');
    chave.className = 'map__dica-rotulo';
    chave.textContent = rotulo;
    const dado = document.createElement('span');
    dado.className = 'map__dica-valor';
    dado.textContent = valor;
    linha.append(chave, dado);
    dica.appendChild(linha);
  }
  return dica;
}

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

/**
 * O marcador vive dentro do container do MapLibre: o mesmo clique físico chega ao botão E ao
 * `click` de camada, que consulta o polígono sob o pixel — o município da COORDENADA. Com código
 * IBGE divergente (ou município de várias unidades) esse segundo caminho trocava o município e
 * limpava a unidade recém-escolhida. O clique no marcador é sobre a unidade; o polígono não opina.
 */
export function cliqueVeioDeMarcador(alvo: EventTarget | null): boolean {
  return alvo instanceof Element && alvo.closest('.map__unidade, .map__alvo') !== null;
}

@Component({ selector: 'app-mapa', imports: [StatusBadgeComponent, EquipamentoDetalheDrawerComponent], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './mapa.component.html', styleUrl: './mapa.component.scss' })
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

  /**
   * Equipamento aberto na gaveta, por cima do mapa. Estado local, sem rota: `/equipamentos/:id`
   * já é o endereço compartilhável do equipamento, e navegar para lá destruiria o componente e
   * remontaria o mapa inteiro — canvas WebGL, cartografia e câmera — só para mostrar um painel.
   */
  protected readonly equipamentoSelecionado = signal<DashboardEquipamento | null>(null);
  /** Contagem por status sobre TODAS as unidades, não só as do município selecionado. */
  protected readonly statusGeografico = computed(() => contarPorStatus(this.municipios().flatMap(municipio => municipio.units)));
  protected readonly totalUnidades = computed(() => this.municipios().reduce((soma, municipio) => soma + municipio.units.length, 0));
  private readonly host = viewChild<ElementRef<HTMLDivElement>>('host');
  /** Cartografia carregada. Sinal, e não campo, porque o aviso de IBGE divergente deriva dela. */
  private readonly fonteMunicipios = signal<Municipio[] | null>(null);
  /** Coordenada × código IBGE da unidade em foco. A coordenada prevalece; isto só torna a divergência visível. */
  protected readonly divergencia = computed(() => {
    const unidade = this.unidadeSelecionada();
    const fonte = this.fonteMunicipios();
    return unidade && fonte ? divergenciaIbge(unidade, fonte) : null;
  });
  private units: DashboardUnidade[] | null = null;

  private map: MaplibreMap | null = null;
  /** Um Marker por municipio: unico no DOM focavel, ja que o poligono vive no canvas WebGL. */
  private readonly marcadores = new Map<string, Marker>();
  /**
   * Um Marker por unidade COM coordenada. Mesma tecnica dos marcadores de municipio (N02) e pelo
   * mesmo motivo: a lib reposiciona o elemento em pan, zoom, pitch e rotate sem sincronizacao
   * manual por frame, e um <button> real entrega Tab, Enter e Espaco de graca.
   */
  private readonly marcadoresUnidade = new Map<number, Marker>();
  /**
   * Pings em voo. Não entram em `marcadoresUnidade`: aquele mapa é indexado por id de unidade e
   * serve ao `aria-pressed`; estes não têm identidade nem estado, são desenho em movimento.
   */
  private pings: Marker[] = [];
  /** Quadro de animação dos pings. Cancelado em `destruirMapa`, junto com o AbortController. */
  private quadroPing: number | null = null;
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
    effect(() => this.marcarMunicipio(this.selected()?.codigoIbge ?? null));
    // Estado do marcador de unidade acompanha o painel, e nao o municipio: clicar na lista de
    // "varias unidades" troca a unidade sem trocar o municipio, e o marcador tem de acompanhar.
    effect(() => this.marcarUnidade(this.unidadeSelecionada()?.id ?? null));
  }

  ngOnDestroy(): void { this.destruirMapa(); }

  protected load(): void {
    this.state.set('loading'); this.error.set(null); this.selected.set(null); this.limparUnidade(); this.municipios.set([]); this.semLocalizacao.set([]); this.semCorrespondencia.set([]); this.fonteMunicipios.set(null); this.units = null;
    this.geoMunicipio.getMunicipios().pipe(take(1)).subscribe({ next: municipios => { this.fonteMunicipios.set(municipios); this.resolve(); }, error: () => this.fail('Erro ao carregar mapa: não foi possível carregar a cartografia de Sergipe.') });
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
    // Trocar de unidade com a gaveta aberta a deixaria mostrando um equipamento que não pertence
    // mais à lista atrás dela, e com o nome da unidade errada no cabeçalho.
    this.fecharEquipamento();
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

  /** A mesma gaveta de `/equipamentos/:id`, aberta aqui por cima do mapa em vez de navegar. */
  protected abrirEquipamento(equipamento: DashboardEquipamento): void { this.equipamentoSelecionado.set(equipamento); }
  protected fecharEquipamento(): void { this.equipamentoSelecionado.set(null); }

  /**
   * Os cinco campos que a gaveta precisa do pai, montados do que o painel já tem em mãos: o
   * equipamento afetado traz nome, status, tipo e `ativo`; o nome da unidade vem da unidade
   * selecionada, que é de onde a lista de afetados saiu. Nenhuma requisição a mais.
   */
  protected readonly resumoDoEquipamento = computed<EquipamentoResumo | null>(() => {
    const equipamento = this.equipamentoSelecionado();
    if (!equipamento) return null;
    return {
      nome: equipamento.nome,
      tipoNome: equipamento.tipoEquipamento.nome,
      unidadeNome: this.unidadeSelecionada()?.nome ?? '—',
      status: equipamento.status,
      ativo: equipamento.ativo,
    };
  });

  private limparUnidade(): void { this.unidadeSelecionada.set(null); this.afetados.set([]); this.afetadosState.set('idle'); this.fecharEquipamento(); }

  private resolve(): void {
    const fonte = this.fonteMunicipios();
    if (!fonte || !this.units || this.state() === 'error') return;
    const agrupado = agruparUnidades(fonte, this.units);
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
      // As features vão como vieram da cartografia. A propriedade `cor` derivada por município saiu
      // com a coloração por status (N07), como a de altura já tinha saído com a extrusão: nenhuma
      // camada lê mais nada além de `id`, que serve ao clique e ao filtro do anel de seleção.
      features: municipios.map(municipio => municipio.feature),
    } as unknown as FeatureCollection;

    const conexoes = {
      type: 'FeatureCollection',
      features: conexoesDesenhaveis(municipios.flatMap(municipio => municipio.units)),
    } as unknown as FeatureCollection;

    const map = new MaplibreMap({
      container: elemento,
      // Estilo proprio: sem tiles, sprite ou glyphs — nenhuma requisicao de rede externa.
      style: { version: 8, sources: { municipios: { type: 'geojson', data: colecao }, conexoes: { type: 'geojson', data: conexoes } }, layers: [
        { id: 'fundo', type: 'background', paint: { 'background-color': 'rgba(0,0,0,0)' } },
        /*
         * `fill` plano, e não mais `fill-extrusion`. O bloco extrudado lia como objeto solto
         * flutuando sobre o mapa, não como relevo do próprio município — o que a inclinação de
         * câmera entrega sem custo nenhum. O pitch fica; a altura por equipamento sai.
         *
         * Cor constante, e não mais `['get', 'cor']`: contorno + fundo neutro, sem distinção por
         * status (N07). A camada continua existindo — ela é a forma do estado e o alvo do clique.
         */
        { id: 'municipios-fill', type: 'fill', source: 'municipios', paint: {
            'fill-color': COR_MUNICIPIO,
            'fill-opacity': 0.92 } },
        { id: 'municipios-contorno', type: 'line', source: 'municipios', paint: { 'line-color': COR_CONTORNO_MUNICIPIO, 'line-width': 1 } },
        /*
         * Linhas da topologia (N06), depois do preenchimento na ordem das camadas. Com tudo no
         * mesmo plano a ordem passou a ser o unico criterio de quem cobre quem — e a linha tem de
         * ficar por cima: ela e o dado que atravessa varios municipios. O motivo original (o bloco
         * alto de Aracaju cobria o feixe que saia dele) deixou de existir com a extrusao.
         */
        ...camadasDeConexao(),
      ] },
      // Nasce plano: o enquadramento é calculado sem inclinação, e o pitch entra depois (ver abaixo).
      attributionControl: false, minZoom: 6, maxZoom: 14, maxPitch: 60, pitch: 0, bearing: BEARING,
    });
    this.map = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');

    const limites = new LngLatBounds();
    for (const municipio of municipios) percorrerCoordenadas(municipio.feature.geometry, ponto => limites.extend(ponto as [number, number]));
    /*
     * Agora `fitBounds` já recebe o `pitch`, em vez de enquadrar plano e inclinar depois. As duas
     * etapas de N05 existiam porque a extrusão fazia o enquadramento inclinado recuar demais; sem
     * blocos, enquadrar já inclinado dá um resultado CENTRADO (desequilíbrio de 4,1% topo-base,
     * contra 8,6% herdando a sequência antiga), e o que sobra é encolhimento uniforme — que uma
     * compensação de zoom sozinha resolve, sem o offset ter de corrigir centralização também.
     */
    map.fitBounds(limites, { padding: 34, bearing: BEARING, pitch: PITCH, duration: 0 });
    map.easeTo({ zoom: map.getZoom() + ZOOM_AO_INCLINAR, offset: OFFSET_CAMERA, duration: 0 });

    map.on('click', 'municipios-fill', evento => {
      if (cliqueVeioDeMarcador(evento.originalEvent.target)) return;
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

    /*
     * Marcador de unidade. O marcador de municipio (acima) e invisivel e existe so como tab-stop —
     * o poligono ja e o desenho. Este e visivel: e a unidade em si, na coordenada cadastrada, e ate
     * aqui o mapa nao mostrava nenhuma. Municipio com quatro unidades (Aracaju) passa a mostrar as
     * quatro, que o bloco unico nao conseguia distinguir.
     *
     * Ordem de Tab: os marcadores de unidade vem DEPOIS dos de municipio porque sao adicionados
     * depois, e essa e a leitura util — do geral para o particular.
     */
    for (const unidade of municipios.flatMap(municipio => municipio.units)) {
      const coordenada = coordenadaDaUnidade(unidade);
      if (!coordenada) continue;
      const alvo = document.createElement('button');
      alvo.type = 'button';
      alvo.className = 'map__unidade';
      alvo.setAttribute('aria-label', rotuloDaUnidade(unidade));
      alvo.setAttribute('data-unidade-id', String(unidade.id));
      // A cor de status vai por variavel CSS, e nao por classe: sao os mesmos hex do canvas, num
      // unico lugar, e nao ha classe de status para criar e manter em paralelo no SCSS.
      alvo.style.setProperty('--cor-unidade', corDoStatus(unidade.status));
      // Pulso em TODOS os marcadores — D19 reverteu o filtro de N07. Continua por classe e não por
      // `:has()` ou seletor de status: o SCSS não conhece a lista de status, e não passa a conhecer.
      alvo.classList.add('map__unidade--pulsa');
      alvo.appendChild(dicaDaUnidade(unidade));
      alvo.addEventListener('click', () => this.selecionarPeloMarcador(unidade), { signal: signalAbort });
      alvo.addEventListener('focus', () => { if (!map.getBounds().contains(coordenada)) map.easeTo({ center: coordenada, duration: 200 }); }, { signal: signalAbort });
      const marcador = new Marker({ element: alvo, pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat(coordenada).addTo(map);
      this.marcadoresUnidade.set(unidade.id, marcador);
    }

    this.montarPings(map, conexoes.features as Feature[]);

    // Marcação inicial dos dois marcadores. Sem `map.on('load')`: nada aqui depende do estilo.
    untracked(() => this.marcarMunicipio(this.selected()?.codigoIbge ?? null));
    untracked(() => this.marcarUnidade(this.unidadeSelecionada()?.id ?? null));
  }

  /**
   * Pings percorrendo as linhas de conexão — ICMP echo como desenho.
   *
   * Um `Marker` DOM por ping, reposicionado por `setLngLat` a cada quadro. Escolhido contra as duas
   * alternativas conhecidas, com medição (ver `mapa-contexto-atual.md` §9.2, cenários D/E/F):
   *
   * - `setData` de GeoJSON numa camada `circle` a cada quadro: 2,54 ms de CPU por quadro contra
   *   0,99 ms desta — 2,9x mais cara, quase toda em reparse do GeoJSON no worker.
   * - `line-dasharray` animado por `setPaintProperty`: 1,65 ms por quadro mesmo rodando a 20 Hz e
   *   não a 60, porque cada troca reconstrói a textura de tracejado. Além do custo, o movimento é
   *   em degraus e o tracejado não é bidirecional: "ida e volta" exigiria duas camadas sobrepostas
   *   em fase invertida.
   *
   * E é o padrão que N02 e N06 já fixaram: a lib reposiciona o elemento em pan, zoom, pitch e
   * rotate sem sincronização manual.
   *
   * Sob `prefers-reduced-motion` os pings não são CRIADOS — não basta parar a animação, porque um
   * ponto parado no meio de uma linha é lido como um lugar, e não há lugar nenhum ali.
   */
  private montarPings(map: MaplibreMap, linhas: Feature[]): void {
    if (linhas.length === 0 || animacaoReduzida()) return;
    const trajetos = linhas.flatMap(linha => {
      /*
       * `as unknown` no meio porque `Geometry` e uniao de sete tipos e o TS nao aceita o
       * estreitamento direto.
       *
       * Primeiro e ultimo vertice, e nao mais o par inteiro: a geometria virou o arco amostrado.
       * As PONTAS continuam exatas (`arcoEntre` avalia u=0 e u=1), entao o ping refaz a mesma curva
       * a partir delas, com a mesma conta de O(1) por quadro — ele nao percorre a polilinha. Se
       * percorresse, cada quadro viraria uma busca por segmento, que e o custo que N07 evitou.
       */
      const vertices = (linha.geometry as unknown as { coordinates: [number, number][] }).coordinates;
      const origem = vertices[0];
      const destino = vertices[vertices.length - 1];
      const status = String(linha.properties?.['status'] ?? '');
      return Array.from({ length: PINGS_POR_LINHA }, (_, indice) => {
        const elemento = document.createElement('div');
        elemento.className = 'map__ping';
        /*
         * Requisito de aceite, não detalhe: o ping é desenho puro. `aria-hidden` o tira da árvore
         * de acessibilidade, e ser um <div> sem `tabindex` o mantém fora da ordem de Tab — que
         * continua sendo município, depois unidade. Um ponto que se move e não faz nada, recebendo
         * foco, seria um tab-stop morto multiplicado por vinte.
         */
        elemento.setAttribute('aria-hidden', 'true');
        elemento.style.setProperty('--cor-ping', corDoStatus(status));
        const marcador = new Marker({ element: elemento, pitchAlignment: 'viewport', rotationAlignment: 'viewport' })
          .setLngLat(origem).addTo(map);
        this.pings.push(marcador);
        return { marcador, origem, destino, defasagem: indice / PINGS_POR_LINHA };
      });
    });

    const inicio = performance.now();
    const passo = (): void => {
      const ciclos = (performance.now() - inicio) / PERIODO_PING_MS;
      for (const { marcador, origem, destino, defasagem } of trajetos) {
        marcador.setLngLat(pontoNoArco(origem, destino, faseVaiEVolta(ciclos + defasagem)));
      }
      this.quadroPing = requestAnimationFrame(passo);
    };
    this.quadroPing = requestAnimationFrame(passo);
  }

  /**
   * Clique (ou Enter/Espaco) no marcador de unidade. Seleciona o municipio TAMBEM, e nesta ordem:
   * `selectMunicipio` desenha o colar no bloco e, em municipio de uma unidade so, ja escolhe a
   * unidade; em municipio de varias ele limpa a escolha, e o `selectUnidade` seguinte repoe
   * exatamente a que foi clicada. Invertida, a ordem apagaria a unidade recem-escolhida.
   */
  private selecionarPeloMarcador(unidade: DashboardUnidade): void {
    const municipio = this.municipios().find(candidato => candidato.units.some(u => u.id === unidade.id));
    if (municipio) this.selectMunicipio(municipio);
    this.selectUnidade(unidade);
    this.anuncio.set(`${unidade.nome} selecionada. ${ROTULO_STATUS[unidade.status]}.`);
  }

  /** Estado do marcador de unidade. Par de `marcarMunicipio`: nenhum dos dois depende do estilo do mapa. */
  private marcarUnidade(selecionada: number | null): void {
    for (const [id, marcador] of this.marcadoresUnidade) {
      marcador.getElement().setAttribute('aria-pressed', String(id === selecionada));
    }
  }

  /**
   * Estado de seleção do município. Só `aria-pressed`, desde que o anel do polígono saiu.
   *
   * Sem camada a filtrar, some também a guarda de `isStyleLoaded()` e a repetição no evento `load`
   * do mapa — que existiam porque selecionar antes de o estilo terminar de carregar deixava o
   * marcador sem estado nenhum. Atributo de DOM não espera WebGL.
   */
  private marcarMunicipio(selecionado: string | null): void {
    for (const municipio of this.municipios()) {
      const marcador = this.marcadores.get(municipio.codigoIbge);
      marcador?.getElement().setAttribute('aria-pressed', String(municipio.codigoIbge === selecionado));
    }
  }

  private destruirMapa(): void {
    this.teclado?.abort();
    this.teclado = null;
    // Antes dos marcadores: o quadro pendente chamaria `setLngLat` num Marker já removido do mapa.
    if (this.quadroPing !== null) cancelAnimationFrame(this.quadroPing);
    this.quadroPing = null;
    for (const ping of this.pings) ping.remove();
    this.pings = [];
    for (const marcador of this.marcadores.values()) marcador.remove();
    this.marcadores.clear();
    for (const marcador of this.marcadoresUnidade.values()) marcador.remove();
    this.marcadoresUnidade.clear();
    this.map?.remove();
    this.map = null;
  }

  private fail(message: string): void { this.error.set(message); this.state.set('error'); }
}

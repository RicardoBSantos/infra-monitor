import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import type { Feature, FeatureCollection } from 'geojson';
import type { LayerSpecification } from 'maplibre-gl';
import { LngLat, LngLatBounds, Map as MaplibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import { take } from 'rxjs';


import { plural } from '../../core/format/plural';
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
  return `${municipio.nome}: ${municipio.units.length ? plural(municipio.units.length, 'unidade', 'unidades') : 'nenhuma unidade cadastrada'}`;
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
 * a 13px, marcador invisível. #8797a6 dava 5,01:1 e #667b8b dava 3,41:1 (D19; D23 os subiu, ver
 * abaixo), ambos acima dos 3:1 de WCAG 1.4.11 para elemento gráfico essencial. Continuam sendo os
 * dois tons mais dessaturados da tabela, que é o que os faz ler como ausência de dado e não como
 * estado; o que mudou foi a luminância, não o matiz.
 *
 * Esse clareamento é também o que sustenta o pulso geral de D19: o argumento de N07 para pulsar só
 * dois status era, em parte, que `sem-dados` (1,92:1) e `sem-equipamentos` (1,22:1) gerariam anel de
 * pulso ilegível. Com 5,01:1 e 3,41:1 (D19) o argumento caiu: os seis pulsam com anel legível.
 *
 * D23 tornou a paleta vibrante, porque a linha agora tem halo e precisa de cor que brilhe sobre o
 * fundo escuro. Valores calculados por script em HSL: coloridos com `S×1,18+0,04` e `L+0,05` (teto
 * 0,72, sem nunca baixar); neutros com `S×1,1` e `L+0,08` (sem-dados) / `+0,04` (sem-equipamentos).
 * Contraste contra #16283a: 8,70 / 4,44 / 8,23 / 6,67 / 6,41 / 3,95 (na ordem da tabela de D23:
 * disponível, indisponível, degradada, em-manutenção, sem-dados, sem-equipamentos; eram 5,01/3,41 em D19 nos dois
 * neutros). ΔE OKLab mínimo entre quaisquer dois status: 10,5 (em-manutenção × sem-dados); sem-dados ×
 * sem-equipamentos passou de 9,7 para 12,8. `em-manutencao` já tinha saturação 100% e não mudou.
 */
const COR_DO_STATUS: Record<string, string> = {
  'disponivel': '#35e087', 'indisponivel': '#f84e54', 'degradada': '#fcb142', 'em-manutencao': '#7fadff',
  'sem-dados': '#9dabb9', 'sem-equipamentos': '#6e8698',
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
 * cartão) e o `sem-equipamentos` (#6e8698 desde D23, #667b8b em D19 — encostado na faixa de
 * status): claro o bastante para o contorno recortar a forma, escuro o bastante para o marcador
 * colorido vencer por contraste.
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
 * aro: o miolo sozinho carrega o contraste — desde D23 entre 3,95:1 (`sem-equipamentos` #6e8698, o
 * pior caso) e 8,70:1 (`disponivel`) contra #16283a; em D19 era 3,41:1 a 6,96:1 — ver o comentário
 * de `COR_DO_STATUS`. 2,65:1 é onde a forma se lê sem a malha competir com os marcadores; medido
 * por captura, não estimado.
 */
const COR_CONTORNO_MUNICIPIO = '#456a8e';

/**
 * Duração de uma travessia completa do ping — desde D23, UMA travessia hub → unidade (D16/D17
 * falavam em hub → unidade → hub).
 *
 * 4200 ms, e não os 2600 de N07. O valor antigo foi escolhido contra uma linha reta e curta; com
 * vinte pings simultâneos no estado inteiro o conjunto lia como tráfego agitado, não como um
 * batimento de sonda. O período é a ÚNICA variável do movimento (a fase de fluxo e o passo
 * são funções puras dele), então desacelerar é trocar este número — nada mais muda.
 *
 * Desde D23 é UMA travessia hub → unidade, não ida e volta: a velocidade caiu à metade, o que
 * compensa a densidade 3× (chega um ping na unidade a cada 1400 ms); mesmo argumento de D17 contra
 * "tráfego agitado".
 */
const PERIODO_PING_MS = 4200;

/**
 * Pings simultâneos por linha. Três, a ⅓ um do outro, em fluxo hub → unidade (D23 substituiu o par
 * em fase oposta de D16, que fazia o "ida e volta").
 */
const PINGS_POR_LINHA = 3;

/**
 * Posição no fluxo, dado o tempo em ciclos. `0 → 1` e recomeça no hub. Pura.
 *
 * D23 trocou o vai-e-volta de D16 por fluxo num sentido só, a pedido: três pings com espaçamento
 * REGULAR ao longo do arco. Na onda triangular de D16 isso é impossível — com duas fases opostas os
 * pings se cruzam no meio, e com fases 0/⅓/⅔ dois deles coincidem. Em dente de serra, defasar de
 * k/3 mantém a distância de ⅓ em qualquer instante. O custo continua O(1) por quadro: muda a
 * função de fase, não a técnica (`Marker` DOM + `pontoNoArco`). As linhas de conexão têm EXATAMENTE
 * dois vértices (hub e unidade), então "quanto do caminho já andei" é um número só.
 */
export function faseDeFluxo(ciclos: number): number {
  return ((ciclos % 1) + 1) % 1;
}

/** Fração do arco, em cada ponta, em que o ping nasce e some. */
const FADE_NA_PONTA = 0.08;

/**
 * Opacidade do ping na posição `u` do arco. Pura.
 *
 * Zero nas duas pontas exatas: é o que esconde a virada do dente de serra, quando o ping salta de
 * u≈1 para u=0. Linear em 8% de cada lado — o ping nasce no hub e se apaga ao chegar na unidade,
 * em vez de surgir do nada sobre o marcador.
 */
export function opacidadeNaPonta(u: number): number {
  return Math.max(0, Math.min(1, u / FADE_NA_PONTA, (1 - u) / FADE_NA_PONTA));
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
 * A seleção continua inteira, só que no marcador: `aria-pressed` só no marcador de unidade (o
 * alvo invisível do município não tem seleção desde D20), anel na cor do status em
 * `.map__unidade[aria-pressed='true']` (D19 — era lilás fixo até D18) e o
 * painel lateral. Nenhum canal saiu — e o anel de seleção continua vivo no SCSS, onde a superfície
 * embaixo dele tem 13px e não meio estado.
 *
 * Com a camada `municipio-selecionado` foi embora a única razão de a marcação de seleção esperar o
 * estilo do mapa carregar: a marcação (`marcarUnidade`) mexe só em atributo de DOM.
 */

/** Inclinação padrão da experiência — não é toggle: em pitch 0 o mapa é o Leaflet de antes. */
const PITCH = 45;
const BEARING = -18;

/**
 * Enquadramento do estado por ENCAIXE CALCULADO (D22), e não mais por regra de proporção.
 *
 * Até D21 a câmera era `cameraForBounds` + um zoom extra fixo (`ZOOM_AO_INCLINAR`) + um offset fixo
 * (`OFFSET_CAMERA`), escalados por uma rampa na proporção do cartão (`ASPECTO_MINIMO`/`PLENO`). Esses
 * números foram recalibrados QUATRO vezes por motivo alheio à câmera — N06 (proporção do cartão), N07
 * (extrusão), N07 (max-width) e D20 (tela cheia) — e D21 (painel de 420px) pediria a quinta: a prova
 * por pixel achou a ponta oeste encostando na borda em proporção 0,94–0,97 (1500x950, 1525x950,
 * 1440x864) e o desenho pequeno abaixo de 0,85. Cada número valia só para a moldura em que foi medido.
 *
 * O encaixe calculado encerra o ciclo: projeta na tela a envoltória convexa do estado (e das unidades),
 * ajusta zoom e centro até ela caber na área livre do cartão com `MARGEM_ESTADO`, e afasta o desenho
 * das sobreposições (título, controles, legenda) com `FOLGA_SOBREPOSICAO`. Não há número calibrado
 * contra uma moldura: mudar o layout não exige remedir a câmera.
 */
const MARGEM_ESTADO = 24;
const FOLGA_SOBREPOSICAO = 12;
/** Iterações do ajuste: a perspectiva torna zoom e centro só aproximadamente separáveis. */
const ITERACOES_ENCAIXE = 6;

export interface Retangulo { x0: number; y0: number; x1: number; y1: number; }
export interface Margens { top: number; right: number; bottom: number; left: number; }

/** Envoltória convexa (cadeia monótona de Andrew), sentido anti-horário, sem colineares. Pura. */
export function envoltoriaConvexa(pontos: [number, number][]): [number, number][] {
  const p = [...pontos].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cruz = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const baixo: [number, number][] = [];
  for (const q of p) { while (baixo.length >= 2 && cruz(baixo[baixo.length - 2], baixo[baixo.length - 1], q) <= 0) baixo.pop(); baixo.push(q); }
  const cima: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (cima.length >= 2 && cruz(cima[cima.length - 2], cima[cima.length - 1], q) <= 0) cima.pop(); cima.push(q); }
  return baixo.slice(0, -1).concat(cima.slice(0, -1));
}

/** Caixa envolvente de pontos de tela. Pura. */
export function caixaDosPontos(pontos: { x: number; y: number }[]): Retangulo {
  return { x0: Math.min(...pontos.map(p => p.x)), y0: Math.min(...pontos.map(p => p.y)), x1: Math.max(...pontos.map(p => p.x)), y1: Math.max(...pontos.map(p => p.y)) };
}

/**
 * Quanto escalar (em torno do centro da tela) e transladar uma caixa para ela caber centrada na área.
 * A translação vem antes da escala: aplicada a tela é deslocada por `t` e então escalada por `escala`
 * em torno de `centro`, e o centro da caixa vai parar no centro da área. Pura.
 */
export function ajusteDeEncaixe(caixa: Retangulo, area: Retangulo, centro: [number, number]): { escala: number; tx: number; ty: number } {
  const escala = Math.min((area.x1 - area.x0) / Math.max(1e-6, caixa.x1 - caixa.x0), (area.y1 - area.y0) / Math.max(1e-6, caixa.y1 - caixa.y0));
  const bx = (caixa.x0 + caixa.x1) / 2, by = (caixa.y0 + caixa.y1) / 2;
  const ax = (area.x0 + area.x1) / 2, ay = (area.y0 + area.y1) / 2;
  return { escala, tx: (ax - centro[0]) / escala - (bx - centro[0]), ty: (ay - centro[1]) / escala - (by - centro[1]) };
}

/** Polígono convexo (vértices em ordem) × retângulo: há sobreposição de área? Pura. */
export function convexoIntersectaRetangulo(poligono: { x: number; y: number }[], r: Retangulo): boolean {
  if (poligono.length === 0) return false;
  if (poligono.some(p => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1)) return true;
  // Eixos separadores: os dois do retângulo e a normal de cada aresta do polígono.
  const cantos = [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];
  const caixa = caixaDosPontos(poligono);
  if (caixa.x1 < r.x0 || caixa.x0 > r.x1 || caixa.y1 < r.y0 || caixa.y0 > r.y1) return false;
  for (let i = 0; i < poligono.length; i++) {
    const a = poligono[i], b = poligono[(i + 1) % poligono.length];
    const nx = b.y - a.y, ny = a.x - b.x;
    const proj = (p: { x: number; y: number }) => p.x * nx + p.y * ny;
    const doPoligono = poligono.map(proj), doRetangulo = cantos.map(proj);
    if (Math.max(...doRetangulo) < Math.min(...doPoligono) || Math.min(...doRetangulo) > Math.max(...doPoligono)) return false;
  }
  return true;
}

/**
 * As duas formas de afastar o desenho de uma sobreposição encostada num canto do cartão: pelo eixo
 * vertical (margem de cima ou de baixo até passar dela) ou pelo horizontal. `espelhar` repete a
 * margem no lado oposto — para sobreposições permanentes (título, controles, legenda fechada), que
 * não podem desequilibrar o enquadramento; a legenda ABERTA não espelha, o recuo é o objetivo. Pura.
 */
export function margensParaEvitar(margens: Margens, r: Retangulo, largura: number, altura: number, folga: number, espelhar: boolean): Margens[] {
  const emCima = (r.y0 + r.y1) / 2 < altura / 2, aEsquerda = (r.x0 + r.x1) / 2 < largura / 2;
  const v = emCima ? Math.max(margens.top, r.y1 + folga) : Math.max(margens.bottom, altura - r.y0 + folga);
  const h = aEsquerda ? Math.max(margens.left, r.x1 + folga) : Math.max(margens.right, largura - r.x0 + folga);
  const vertical: Margens = emCima ? { ...margens, top: v, bottom: espelhar ? Math.max(margens.bottom, v) : margens.bottom } : { ...margens, bottom: v, top: espelhar ? Math.max(margens.top, v) : margens.top };
  const horizontal: Margens = aEsquerda ? { ...margens, left: h, right: espelhar ? Math.max(margens.right, h) : margens.right } : { ...margens, right: h, left: espelhar ? Math.max(margens.left, h) : margens.left };
  return [vertical, horizontal];
}

/**
 * Tetos do zoom ao clicar num município (D20), um por caminho de enquadramento.
 *
 * Pelo polígono (município com 0–1 unidade, unidades coladas ou com coordenada fora do município):
 * 11,5. Sem teto, município pequeno iria a zoom de rua e o operador perderia a referência dos
 * vizinhos. 11,5 é a primeira medição desta rodada (D20), mantida para o caminho do polígono.
 *
 * Pelas unidades (2+ dentro do município): 12,5. Medido no e2e:n08 contra Aracaju (1600x900, as 4
 * unidades enquadradas): com 11,5 o vizinho mais próximo ficava a 34,0px (o teto mandava); com 12,5
 * ficam 62,1px, e 12,7 e 13 dão o mesmo número, porque aí o ajuste do envelope (~12,4) é que
 * limita. Só o envelope das unidades justifica o zoom maior: ele já limita pelas próprias unidades.
 */
const ZOOM_MAXIMO_MUNICIPIO = 11.5;
const ZOOM_MAXIMO_UNIDADES = 12.5;
/** Duração das transições de câmera disparadas por clique. Zero sob `prefers-reduced-motion`. */
const DURACAO_CAMERA_MS = 600;
/** Folga do enquadramento do município; topo e esquerda maiores por causa da placa do título. */
const PADDING_MUNICIPIO = { top: 110, right: 70, bottom: 50, left: 60 };

/** Largura do núcleo da linha de conexão (D23: 1,4 → 1,6, para a cor vibrante ler sobre o halo). */
const LARGURA_CONEXAO = 1.6;
/**
 * Núcleo da linha, quase opaco (D23): a translucidez passou para o halo por baixo, que carrega o
 * brilho; o núcleo fino pode ficar firme sem recortar o bloco. Antes (D18) era a linha única, 0,65.
 *
 * O papel que a translucidez de D18 cumpria continua, agora no halo: a conexão cruza o estado
 * inteiro e passa por cima de municípios; opaca e larga, recortava o bloco em dois. O halo é largo
 * e translúcido (0,28), o núcleo é fino — o município por baixo segue legível mesmo com a linha
 * colorida de ponta a ponta por cima dele.
 */
const OPACIDADE_CONEXAO = 0.85;
/**
 * Brilho no WebGL (D23): o canvas do MapLibre não aplica `filter` nem `box-shadow`. Uma segunda
 * `line` larga e borrada por baixo do núcleo é o equivalente nativo — estática, custo por quadro
 * ~0 (medido na Task 5).
 */
const LARGURA_HALO_CONEXAO = 6;
const BORRAO_HALO_CONEXAO = 4;
const OPACIDADE_HALO_CONEXAO = 0.28;

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
  // Mesma expressão no halo e no núcleo: o status desconhecido cai em `sem-dados` nos dois.
  const corDaConexao = ['match', ['get', 'status'],
    ...Object.values(UnitOperationalStatus).flatMap(status => [status, corDoStatus(status)]),
    COR_DO_STATUS['sem-dados']];
  // Halo ANTES do núcleo: a ordem do array é a ordem de desenho, e por cima ele apagaria a linha.
  return [{
    id: 'conexoes-halo', type: 'line', source: 'conexoes', layout: { 'line-cap': 'round' },
    paint: { 'line-width': LARGURA_HALO_CONEXAO, 'line-blur': BORRAO_HALO_CONEXAO, 'line-opacity': OPACIDADE_HALO_CONEXAO, 'line-color': corDaConexao },
  }, {
    id: 'conexoes-linha', type: 'line', source: 'conexoes', layout: { 'line-cap': 'round' },
    paint: { 'line-width': LARGURA_CONEXAO, 'line-opacity': OPACIDADE_CONEXAO, 'line-color': corDaConexao },
  }] as unknown as LayerSpecification[];
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
  return `${unidade.nome}: ${ROTULO_STATUS[unidade.status]}, ${plural(unidade.equipamentosTotal, 'equipamento', 'equipamentos')}, `
    + `${plural(unidade.incidentesAbertos, 'incidente aberto', 'incidentes abertos')}`;
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

/** Envelope do município, `[[minLng, minLat], [maxLng, maxLat]]`. É o que o zoom por clique enquadra (D20). */
export function limitesDoMunicipio(geometria: { coordinates: unknown }): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  percorrerCoordenadas(geometria, ([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); });
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
}

/**
 * O que o zoom por município enquadra (D20), e por qual caminho (`porUnidades`, que escolhe o teto
 * de zoom). Com 2+ unidades de coordenada conhecida, o envelope delas: é nelas que o operador clica.
 * Só vale se esse envelope estiver DENTRO do envelope do polígono: as unidades são agrupadas por
 * `codigoIbge`, e uma de IBGE divergente pode ter coordenada em outro município; o envelope
 * esticaria até lá e enquadraria dois municípios. Nesse caso, e com 0 ou 1 unidade, ou várias no
 * mesmo ponto (envelope sem largura nem altura), o polígono é a referência. Coordenada 0 é válida:
 * nunca testar por veracidade.
 */
export function limitesDoEnquadramento(municipio: MapMunicipio): { limites: [[number, number], [number, number]]; porUnidades: boolean } | null {
  const poligono = limitesDoMunicipio(municipio.feature.geometry);
  const pontos = municipio.units.map(coordenadaDaUnidade).filter((c): c is [number, number] => c !== null);
  if (poligono && pontos.length >= 2) {
    const lngs = pontos.map(p => p[0]), lats = pontos.map(p => p[1]);
    const minX = Math.min(...lngs), maxX = Math.max(...lngs), minY = Math.min(...lats), maxY = Math.max(...lats);
    const dentro = minX >= poligono[0][0] && maxX <= poligono[1][0] && minY >= poligono[0][1] && maxY <= poligono[1][1];
    if (dentro && (maxX > minX || maxY > minY)) return { limites: [[minX, minY], [maxX, maxY]], porUnidades: true };
  }
  return poligono ? { limites: poligono, porUnidades: false } : null;
}

/** Centro do envelope do municipio. Nao e o polo de inacessibilidade: em municipio concavo pode cair fora. */
export function centroideAproximado(geometria: { coordinates: unknown }): [number, number] | null {
  const limites = limitesDoMunicipio(geometria);
  return limites ? [(limites[0][0] + limites[1][0]) / 2, (limites[0][1] + limites[1][1]) / 2] : null;
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
  protected readonly plural = plural;
  private readonly geoMunicipio = inject(GeoMunicipioService);
  private readonly dashboardApi = inject(DashboardApiService);
  private readonly router = inject(Router);
  protected readonly state = signal<MapState>('loading');
  protected readonly municipios = signal<MapMunicipio[]>([]);
  protected readonly semLocalizacao = signal<DashboardUnidade[]>([]);
  protected readonly semCorrespondencia = signal<DashboardUnidade[]>([]);
  protected readonly error = signal<string | null>(null);
  /** Região viva: o painel lateral é visual, e sem isto quem navega por teclado não ouve a troca. */
  protected readonly anuncio = signal('');

  /** Unidade em foco no painel. Só o clique/Enter no marcador de unidade a define (D20): o município não seleciona nada. */
  protected readonly unidadeSelecionada = signal<DashboardUnidade | null>(null);
  protected readonly afetados = signal<DashboardEquipamento[]>([]);
  protected readonly afetadosState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');

  /**
   * Equipamento aberto na gaveta, por cima do mapa. Estado local, sem rota: `/equipamentos/:id`
   * já é o endereço compartilhável do equipamento, e navegar para lá destruiria o componente e
   * remontaria o mapa inteiro — canvas WebGL, cartografia e câmera — só para mostrar um painel.
   */
  protected readonly equipamentoSelecionado = signal<DashboardEquipamento | null>(null);
  /** Contagem por status sobre TODAS as unidades. */
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
  /** Câmera fora do enquadramento do estado inteiro: mostra o "Ver estado inteiro" (D20). */
  protected readonly foraDoEnquadramento = signal(false);
  private limitesEstado: LngLatBounds | null = null;
  /** Envoltória convexa [lng, lat] do estado e das unidades: o que `cameraDeEncaixe` faz caber (D22). */
  private envoltoriaEstado: [number, number][] = [];

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
    // Estado do marcador de unidade acompanha o painel (unidadeSelecionada), que é a única seleção (D20).
    effect(() => this.marcarUnidade(this.unidadeSelecionada()?.id ?? null));
  }

  ngOnDestroy(): void { this.destruirMapa(); }

  protected load(): void {
    this.state.set('loading'); this.error.set(null); this.foraDoEnquadramento.set(false); this.limparUnidade(); this.municipios.set([]); this.semLocalizacao.set([]); this.semCorrespondencia.set([]); this.fonteMunicipios.set(null); this.units = null;
    this.geoMunicipio.getMunicipios().pipe(take(1)).subscribe({ next: municipios => { this.fonteMunicipios.set(municipios); this.resolve(); }, error: () => this.fail('Erro ao carregar mapa: não foi possível carregar a cartografia de Sergipe.') });
    this.dashboardApi.getUnidades().pipe(take(1)).subscribe({ next: units => { this.units = units; this.resolve(); }, error: () => this.fail('Erro ao carregar dados operacionais: não foi possível consultar as unidades.') });
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
    const pontos: [number, number][] = [];
    for (const municipio of municipios) percorrerCoordenadas(municipio.feature.geometry, ponto => { limites.extend(ponto as [number, number]); pontos.push([ponto[0], ponto[1]]); });
    // Unidades entram na envoltória: uma coordenada fora do contorno (cadastro errado) não pode cair fora do cartão.
    for (const unidade of municipios.flatMap(municipio => municipio.units)) {
      if (unidade.latitude != null && unidade.longitude != null) pontos.push([unidade.longitude, unidade.latitude]);
    }
    this.envoltoriaEstado = envoltoriaConvexa(pontos);
    this.limitesEstado = limites;
    this.enquadrarEstado(false);

    // Gesto do operador (arraste, roda, botões do NavigationControl) tira a câmera do enquadramento
    // inicial: o "Ver estado inteiro" aparece. Movimento programático não tem `originalEvent`.
    map.on('movestart', evento => { if (evento.originalEvent) this.foraDoEnquadramento.set(true); });
    // Rotação/redimensionamento mantinha o zoom da moldura anterior (montado em desktop, o celular
    // abria cortado). Reenquadra o estado; se o operador já mexeu na câmera, respeita (D20).
    map.on('resize', () => { if (!this.foraDoEnquadramento()) this.enquadrarEstado(false); });
    elemento.addEventListener('keydown', evento => {
      if (evento.key !== 'Escape' || !this.foraDoEnquadramento()) return;
      evento.preventDefault();
      this.enquadrarEstado(true);
    }, { signal: signalAbort });

    map.on('click', 'municipios-fill', evento => {
      // Sem a guarda, clicar no marcador de unidade também aproximaria o município sob o pixel.
      if (cliqueVeioDeMarcador(evento.originalEvent.target)) return;
      const codigo = normalizeCodigoIbge(evento.features?.[0]?.properties?.['id'] as string);
      const municipio = municipios.find(candidato => candidato.codigoIbge === codigo);
      if (municipio) this.aproximarMunicipio(municipio);
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
      botao.addEventListener('click', () => this.aproximarMunicipio(municipio), { signal: signalAbort });
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

    // Marcação inicial do marcador de unidade. Sem `map.on('load')`: nada aqui depende do estilo.
    untracked(() => this.marcarUnidade(this.unidadeSelecionada()?.id ?? null));
  }

  /**
   * Pings percorrendo as linhas de conexão — ICMP echo como desenho. Três por linha, a ⅓ um do
   * outro, em fluxo contínuo hub → unidade (D23), com fade nas duas pontas. `style.opacity` por
   * quadro NÃO fica de graça: na bancada (D23) a tela inteira custou 1,77 ms/quadro sobre o mapa parado (mediana de 3 corridas)
   * (BD3), dos quais ~0,6 ms são recálculo de estilo — o `opacity` inline invalida estilo a cada
   * quadro em cada ping. Cabe (11,5% do orçamento; 23,8% com 5×), então fica.
   *
   * Um `Marker` DOM por ping, reposicionado por `setLngLat` a cada quadro. Escolhido contra as duas
   * alternativas conhecidas, com medição (ver `mapa-contexto-atual.md` §9.2, cenários D/E/F):
   *
   * - `setData` de GeoJSON numa camada `circle` a cada quadro: 2,54 ms de CPU por quadro contra
   *   0,99 ms desta — 2,9x mais cara, quase toda em reparse do GeoJSON no worker.
   * - `line-dasharray` animado por `setPaintProperty`: 1,65 ms por quadro mesmo rodando a 20 Hz e
   *   não a 60, porque cada troca reconstrói a textura de tracejado. Além do custo, o movimento é
   *   em degraus e o tracejado não é bidirecional: o "ida e volta" de D16 exigiria duas camadas
   *   sobrepostas em fase invertida (D23 abandonou a ida e volta, mas o custo segue valendo).
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
        elemento.style.opacity = '0';   // sem flash no primeiro quadro
        const marcador = new Marker({ element: elemento, pitchAlignment: 'viewport', rotationAlignment: 'viewport' })
          .setLngLat(origem).addTo(map);
        this.pings.push(marcador);
        return { marcador, elemento, origem, destino, defasagem: indice / PINGS_POR_LINHA };
      });
    });

    const inicio = performance.now();
    const passo = (): void => {
      const ciclos = (performance.now() - inicio) / PERIODO_PING_MS;
      for (const { marcador, elemento, origem, destino, defasagem } of trajetos) {
        const u = faseDeFluxo(ciclos + defasagem);
        marcador.setLngLat(pontoNoArco(origem, destino, u));
        elemento.style.opacity = String(opacidadeNaPonta(u));
      }
      this.quadroPing = requestAnimationFrame(passo);
    };
    this.quadroPing = requestAnimationFrame(passo);
  }

  /**
   * Enquadramento do estado inteiro — o da abertura da tela, e o destino do "Ver estado inteiro" e
   * do Escape (D20). Uma conta só para os três: se divergissem, voltar não daria no mesmo lugar.
   *
   * Um único `easeTo` para o destino calculado por `cameraDeEncaixe` (D22): animado, um segundo
   * `easeTo` cancelaria o primeiro no meio. `anunciar` separa quem mexe por pedido do operador
   * (botão, Escape) de quem só reacomoda o desenho (legenda abrindo ou fechando).
   */
  private enquadrarEstado(animado: boolean, anunciar = animado): void {
    const map = this.map;
    if (!map || !this.limitesEstado) return;
    // Voltar ao estado inteiro (botão ou Escape) acontece só no canvas: sem anúncio o leitor de tela
    // não sabe que saiu do município. Enquadramento inicial e resize (animado=false) ficam em silêncio.
    if (anunciar) this.anuncio.set('Estado inteiro.');
    const destino = this.cameraDeEncaixe();
    if (!destino) return;
    map.easeTo({ ...destino, bearing: BEARING, pitch: PITCH, duration: animado && !animacaoReduzida() ? DURACAO_CAMERA_MS : 0 });
    this.foraDoEnquadramento.set(false);
  }

  /**
   * Câmera em que a envoltória do estado cabe na área livre do cartão (D22). Itera sobre o mapa vivo
   * com `jumpTo` — a projeção com pitch é a do próprio MapLibre, sem reimplementar perspectiva — e
   * devolve a câmera como estava antes de retornar: quem anima é o `easeTo` de `enquadrarEstado`.
   *
   * Para cada sobreposição que o desenho invade, tenta afastar pelo eixo vertical e pelo horizontal e
   * fica com o que der zoom maior. Título, controles e legenda fechada espelham a margem no lado oposto
   * (o enquadramento continua centrado); a legenda aberta não — o recuo dela é o objetivo.
   */
  private cameraDeEncaixe(): { center: LngLat; zoom: number } | null {
    const map = this.map;
    const envoltoria = this.envoltoriaEstado;
    if (!map || !this.limitesEstado || envoltoria.length < 3) return null;
    const recipiente = map.getContainer();
    const largura = recipiente.clientWidth, altura = recipiente.clientHeight;
    if (largura < 2 * MARGEM_ESTADO || altura < 2 * MARGEM_ESTADO) return null;
    const inicial = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    const base = map.cameraForBounds(this.limitesEstado, { padding: MARGEM_ESTADO, bearing: BEARING, pitch: PITCH });
    if (!base?.center || base.zoom === undefined) return null;
    const centroTela: [number, number] = [largura / 2, altura / 2];
    const projetar = (camera: { center: LngLat; zoom: number }) => {
      map.jumpTo({ ...camera, bearing: BEARING, pitch: PITCH });
      return envoltoria.map(ponto => map.project(ponto));
    };
    const encaixar = (margens: Margens): { center: LngLat; zoom: number } => {
      let camera = { center: LngLat.convert(base.center!), zoom: base.zoom! };
      for (let i = 0; i < ITERACOES_ENCAIXE; i++) {
        const caixa = caixaDosPontos(projetar(camera));
        const area: Retangulo = { x0: margens.left, y0: margens.top, x1: largura - margens.right, y1: altura - margens.bottom };
        const { escala, tx, ty } = ajusteDeEncaixe(caixa, area, centroTela);
        if (!Number.isFinite(escala) || escala <= 0 || !Number.isFinite(tx) || !Number.isFinite(ty)) break;
        const centro = map.unproject([centroTela[0] - tx, centroTela[1] - ty]);
        camera = { center: centro, zoom: Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), camera.zoom + Math.log2(escala))) };
        if (Math.abs(Math.log2(escala)) < 0.002 && Math.hypot(tx, ty) < 0.5) break;
      }
      return camera;
    };
    const sobreposicoes = this.sobreposicoesDoCartao(recipiente);
    let margens: Margens = { top: MARGEM_ESTADO, right: MARGEM_ESTADO, bottom: MARGEM_ESTADO, left: MARGEM_ESTADO };
    let camera = encaixar(margens);
    for (let rodada = 0; rodada < sobreposicoes.length * 2; rodada++) {
      const poligono = projetar(camera);
      const invadida = sobreposicoes.find(s => convexoIntersectaRetangulo(poligono, s.retangulo));
      if (!invadida) break;
      // Opção que deixaria menos de um quarto do cartão para o estado é descartada (ex.: fugir do título
      // pela horizontal com a margem espelhada não deixa largura nenhuma num cartão estreito).
      const opcoes = margensParaEvitar(margens, invadida.retangulo, largura, altura, FOLGA_SOBREPOSICAO, invadida.espelhar)
        .filter(m => largura - m.left - m.right >= largura / 4 && altura - m.top - m.bottom >= altura / 4)
        .map(m => ({ margens: m, camera: encaixar(m) }));
      if (opcoes.length === 0) break;
      const melhor = opcoes.reduce((a, b) => (b.camera.zoom > a.camera.zoom ? b : a));
      margens = melhor.margens;
      camera = melhor.camera;
    }
    map.jumpTo(inicial);
    return camera;
  }

  /** Retângulos (em px do container do mapa) do que fica por cima do canvas. */
  private sobreposicoesDoCartao(recipiente: HTMLElement): { retangulo: Retangulo; espelhar: boolean }[] {
    const origem = recipiente.getBoundingClientRect();
    const cartao = recipiente.parentElement;
    const lista: { retangulo: Retangulo; espelhar: boolean }[] = [];
    const incluir = (elemento: Element | null | undefined, espelhar: boolean) => {
      if (!(elemento instanceof HTMLElement) || elemento.hidden || elemento.offsetWidth === 0) return;
      const r = elemento.getBoundingClientRect();
      lista.push({ espelhar, retangulo: { x0: r.left - origem.left, y0: r.top - origem.top, x1: r.right - origem.left, y1: r.bottom - origem.top } });
    };
    incluir(cartao?.querySelector('.map-titulo'), true);
    incluir(recipiente.querySelector('.maplibregl-ctrl-top-right'), true);
    const legenda = cartao?.querySelector('details.legend-bloco');
    incluir(legenda, !(legenda instanceof HTMLDetailsElement && legenda.open));
    return lista;
  }

  /** Legenda abriu ou fechou: reacomoda o estado inteiro em volta dela; câmera aproximada fica como está. */
  protected aoAlternarLegenda(): void {
    if (!this.foraDoEnquadramento()) this.enquadrarEstado(true, false);
  }

  /** Botão "Ver estado inteiro". O botão some ao clicar: o foco vai para o canvas, não para o body. */
  protected verEstadoInteiro(): void {
    this.enquadrarEstado(true);
    this.map?.getCanvas().focus();
  }

  /**
   * Clique (ou Enter no alvo invisível) num município: aproxima nele (D20). Com 2+ unidades dentro
   * do município enquadra o envelope delas e não o polígono: o de Aracaju é grande e deixava os
   * quatro marcadores a 15px um do outro. Unidade com coordenada fora do município (IBGE divergente)
   * não conta, senão o envelope esticaria até o vizinho; com 0–1 unidade vale o polígono, com o teto
   * de zoom menor (ver `limitesDoEnquadramento`). Não é mais seleção — o município não carrega
   * estado (D15) nem seleção (D17); o painel da unidade aberta fica como está. Município sem
   * unidade aproxima igual; o anúncio diz que não há unidade.
   */
  private aproximarMunicipio(municipio: MapMunicipio): void {
    this.anuncio.set(`${rotuloDoMunicipio(municipio)}. Mapa aproximado.`);
    const map = this.map;
    const enquadramento = limitesDoEnquadramento(municipio);
    if (!map || !enquadramento) return;
    map.fitBounds(enquadramento.limites, { padding: PADDING_MUNICIPIO, bearing: BEARING, pitch: PITCH,
      maxZoom: enquadramento.porUnidades ? ZOOM_MAXIMO_UNIDADES : ZOOM_MAXIMO_MUNICIPIO,
      linear: true, duration: animacaoReduzida() ? 0 : DURACAO_CAMERA_MS });
    this.foraDoEnquadramento.set(true);
  }

  /**
   * Clique (ou Enter/Espaço) no marcador de unidade: abre direto o detalhe da unidade (D20). Até
   * D19 passava antes por `selectMunicipio`, que em município de várias unidades mostrava a lista
   * "Escolha uma" acima do detalhe — empurrava o conteúdo e criava rolagem no painel.
   */
  private selecionarPeloMarcador(unidade: DashboardUnidade): void {
    this.selectUnidade(unidade);
    this.anuncio.set(`${unidade.nome} selecionada. ${ROTULO_STATUS[unidade.status]}.`);
  }

  /** Estado do marcador de unidade. Não depende do estilo do mapa: é atributo de DOM. */
  private marcarUnidade(selecionada: number | null): void {
    for (const [id, marcador] of this.marcadoresUnidade) {
      marcador.getElement().setAttribute('aria-pressed', String(id === selecionada));
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

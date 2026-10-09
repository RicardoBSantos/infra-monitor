/*
 * Investigação: por que o clique no marcador de unidade limpa a seleção do mapa.
 *
 *   MAPA_SENHA=<senha> [MAPA_BASE=http://127.0.0.1:4300] node e2e/mapa-marcador-investigacao.cjs
 *
 * Pré-requisitos: backend (banco de dev, motor e dispatcher DESLIGADOS) em 8080, ng serve em modo
 * de desenvolvimento (o roteiro usa `window.ng`, que só existe em dev). Não escreve nada no banco:
 * só login e cliques. NÃO corrige nada — só registra.
 *
 * Instrumentação, toda na página de teste e nenhuma no código de produção:
 *   1. Listeners de captura e bolha no `.maplibregl-canvas-container` (onde o MapLibre anexa os
 *      Markers e escuta o mouse), no próprio <button> do marcador e no `document`.
 *   2. A instância do componente vem de `ng.getComponent(app-mapa)` (dev mode); dela sai o
 *      `map` (campo privado, acessível em runtime). Nele entra um `map.on('click','municipios-fill')`
 *      extra — registrado DEPOIS do do componente, então roda logo depois dele — que grava
 *      `originalEvent.target` e a feature sob o ponto.
 *   3. `selectMunicipio`, `selectUnidade`, `limparUnidade` e `selecionarPeloMarcador` do componente
 *      são embrulhados na instância (os handlers chamam via `this.`), gravando a ordem real.
 *
 * ARMADILHAS conhecidas deste projeto:
 * 1. Sessão só existe em memória — page.goto depois do login cai em /login. Toda navegação é por clique.
 * 2. Nada de catch silencioso em seletor: seletor que não casou falha alto.
 * 3. Resultado gravado em `finally`.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = process.env.MAPA_BASE || 'http://127.0.0.1:4300';
const EMAIL = process.env.MAPA_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.MAPA_SENHA;
if (!SENHA) throw new Error('MAPA_SENHA é obrigatória');

const OUT = path.join(__dirname, 'mapa-marcador-evidence', 'investigacao');
fs.mkdirSync(OUT, { recursive: true });

/*
 * Banco de dev (SELECT em 2026-09-24):
 *   id 5 "Sesc Itabaiana" (ITA-09): codigo_ibge 2803005 (Itabaianinha), coordenada -10.6853/-37.4256,
 *     que cai DENTRO do polígono de Itabaiana (2802908) — IBGE e coordenada divergem.
 *   ids 1, 2, 3, 7: as quatro de Aracaju (2800308), IBGE coerente com a coordenada.
 */
const CASOS = [
  { rotulo: 'ITA-09-sesc-itabaiana', id: '5' },
  { rotulo: 'aracaju-1-sede-administrativa', id: '1' },
  { rotulo: 'aracaju-2-escola-sesc-aracaju', id: '2' },
  { rotulo: 'aracaju-7-centro-integrado-saude', id: '7' },
  { rotulo: 'aracaju-3-hotel-sesc-atalaia', id: '3' },
];

const registro = { base: BASE, inicio: new Date().toISOString(), casos: [], erros: [] };

/** Estado visível do painel e dos marcadores, lido do DOM. */
async function estado(page, id) {
  return page.evaluate((unidadeId) => {
    const texto = (s) => { const el = document.querySelector(s); return el ? el.innerText.replace(/\s+/g, ' ').trim() : null; };
    return {
      ariaPressedDoMarcador: document.querySelector(`.map__unidade[data-unidade-id="${unidadeId}"]`)?.getAttribute('aria-pressed') ?? null,
      marcadoresUnidadePressionados: [...document.querySelectorAll('.map__unidade[aria-pressed="true"]')].map(b => b.getAttribute('data-unidade-id')),
      municipiosPressionados: [...document.querySelectorAll('.map__alvo[aria-pressed="true"]')].map(b => b.getAttribute('data-codigo-ibge')),
      painelUnidade: texto('.unit-panel .unit-panel__nome'),
      painelMunicipio: texto('.selected-panel'),
    };
  }, id);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
  page.on('pageerror', (e) => registro.erros.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') registro.erros.push('console: ' + m.text()); });
  try {
    // ------------------------------------------------------------------ login e mapa, por clique
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
    await page.click('a[href="/mapa"]');
    await page.waitForURL(/\/mapa$/, { timeout: 20000 });
    await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
    for (const caso of CASOS) await page.waitForSelector(`.map__unidade[data-unidade-id="${caso.id}"]`, { timeout: 30000 });
    // Câmera assentar antes de clicar (a montagem faz fitBounds + easeTo com duration 0, e o
    // estilo termina de carregar depois).
    await page.waitForTimeout(2500);

    // ------------------------------------------------------------------ instrumentação na página
    const instrumentado = await page.evaluate(() => {
      const w = window;
      w.__ev = [];
      const push = (o) => w.__ev.push({ seq: w.__ev.length + 1, ...o });
      const desc = (el) => !el ? null : (el.nodeType === 1
        ? `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`
        : String(el));
      const cont = document.querySelector('.maplibregl-canvas-container');
      if (!cont) throw new Error('.maplibregl-canvas-container não encontrado');
      for (const tipo of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        document.addEventListener(tipo, e => push({ camada: 'DOM', onde: 'document', fase: 'captura', tipo, alvo: desc(e.target) }), true);
        cont.addEventListener(tipo, e => push({ camada: 'DOM', onde: 'canvas-container', fase: e.eventPhase === 2 ? 'alvo' : 'captura', tipo, alvo: desc(e.target) }), true);
        cont.addEventListener(tipo, e => push({ camada: 'DOM', onde: 'canvas-container', fase: e.eventPhase === 2 ? 'alvo' : 'bolha', tipo, alvo: desc(e.target) }), false);
        document.addEventListener(tipo, e => push({ camada: 'DOM', onde: 'document', fase: 'bolha', tipo, alvo: desc(e.target), defaultPrevented: e.defaultPrevented }), false);
      }
      for (const botao of document.querySelectorAll('.map__unidade')) {
        botao.addEventListener('click', e => push({ camada: 'DOM', onde: `button.map__unidade#${botao.getAttribute('data-unidade-id')}`, fase: e.eventPhase === 2 ? 'alvo' : 'bolha', tipo: 'click', alvo: desc(e.target),
          // Listener registrado depois do do componente: mostra o estado logo após `selecionarPeloMarcador`.
          unidadeSelecionadaNesteInstante: w.ng.getComponent(document.querySelector('app-mapa')).unidadeSelecionada()?.id ?? null }));
      }
      if (!w.ng || typeof w.ng.getComponent !== 'function') throw new Error('window.ng.getComponent indisponível — ng serve não está em modo dev?');
      const comp = w.ng.getComponent(document.querySelector('app-mapa'));
      if (!comp || !comp.map) throw new Error('instância do MapLibre não encontrada em app-mapa');
      const map = comp.map;
      // Ordem real dos métodos do componente. Embrulho na instância: os handlers chamam `this.x(...)`.
      for (const nome of ['selecionarPeloMarcador', 'selectMunicipio', 'selectUnidade', 'limparUnidade']) {
        const original = comp[nome];
        comp[nome] = function (...args) {
          const a = args[0];
          push({ camada: 'componente', metodo: nome, arg: a ? (Array.isArray(a.units) ? `municipio ${a.codigoIbge} ${a.nome} (${a.units.length} unidade(s))` : `unidade ${a.id} ${a.nome}`) : null });
          return original.apply(this, args);
        };
      }
      map.on('click', e => push({ camada: 'maplibre', handler: "map.on('click') sem camada", alvoOriginal: desc(e.originalEvent.target), ponto: [Math.round(e.point.x), Math.round(e.point.y)] }));
      map.on('click', 'municipios-fill', e => {
        const alvo = e.originalEvent.target;
        push({
          camada: 'maplibre', handler: "map.on('click','municipios-fill') (instrumentação, depois do do componente)",
          tipoDoEventoDom: e.originalEvent.type,
          alvoOriginal: desc(alvo),
          alvoEhMarcadorDeUnidade: !!(alvo && alvo.closest && alvo.closest('.map__unidade')),
          feature: e.features?.[0]?.properties ? `${e.features[0].properties.id} ${e.features[0].properties.name}` : null,
          ponto: [Math.round(e.point.x), Math.round(e.point.y)],
          unidadeSelecionadaNesteInstante: comp.unidadeSelecionada()?.id ?? null,
        });
      });
      w.__mapa = map;
      return { zoomInicial: map.getZoom() };
    });
    registro.instrumentacao = instrumentado;

    /*
     * No enquadramento inicial os quatro marcadores de Aracaju se sobrepõem (2-8 km de distância),
     * e o clique real num deles pode cair no vizinho. Registra quem recebe o clique no centro de
     * cada um e, antes dos casos de Aracaju, aproxima a câmera para cada marcador ficar clicável.
     */
    registro.sobreposicaoNoZoomInicial = await page.evaluate((ids) => ids.map((id) => {
      const b = document.querySelector(`.map__unidade[data-unidade-id="${id}"]`);
      const r = b.getBoundingClientRect();
      const topo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const dono = topo && topo.closest('.map__unidade');
      return { unidadeId: id, centroRecebidoPor: dono ? dono.getAttribute('data-unidade-id') : (topo ? String(topo.className) : null) };
    }), CASOS.map(c => c.id));

    // ------------------------------------------------------------------ um clique por marcador
    for (const caso of CASOS) {
      if (caso.rotulo.startsWith('aracaju') && !registro.zoomAracaju) {
        registro.zoomAracaju = await page.evaluate(() => {
          window.__mapa.jumpTo({ center: [-37.055, -10.945], zoom: 12 });
          return { zoom: window.__mapa.getZoom() };
        });
        await page.waitForTimeout(1500);
      }
      const seletor = `.map__unidade[data-unidade-id="${caso.id}"]`;
      const antes = await estado(page, caso.id);
      await page.evaluate(() => { window.__ev = []; });
      // Sem `force`: se outro elemento cobrir o marcador, o Playwright falha alto — é o que queremos.
      await page.locator(seletor).click({ timeout: 10000 });
      await page.waitForTimeout(600);
      const depois = await estado(page, caso.id);
      const eventos = await page.evaluate(() => window.__ev);
      const rotuloAria = await page.locator(seletor).getAttribute('aria-label');
      registro.casos.push({ rotulo: caso.rotulo, unidadeId: caso.id, rotuloAria, antes, depois, eventos });
      console.log(`${caso.rotulo}: aria-pressed=${depois.ariaPressedDoMarcador} painelUnidade=${depois.painelUnidade} painelMunicipio=${depois.painelMunicipio}`);
      await page.screenshot({ path: path.join(OUT, `${caso.rotulo}.png`) });
    }
  } catch (e) {
    registro.fatal = String(e && e.stack || e);
    console.error(registro.fatal);
    process.exitCode = 1;
  } finally {
    registro.fim = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, 'investigacao.json'), JSON.stringify(registro, null, 2));
    await browser.close();
  }
})();

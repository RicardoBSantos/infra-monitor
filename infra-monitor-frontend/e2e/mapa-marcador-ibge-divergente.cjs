/*
 * Correção do clique no marcador de unidade + aviso de IBGE divergente no painel do mapa.
 *
 *   MAPA_SENHA=<senha> [MAPA_BASE=http://127.0.0.1:4300] [MAPA_SAIDA=correcao] node e2e/mapa-marcador-ibge-divergente.cjs
 *
 * Pré-requisitos: backend (banco de dev, motor e dispatcher DESLIGADOS) em 8080, ng serve em modo
 * de desenvolvimento (a câmera é aproximada via `window.ng`, que só existe em dev). Não escreve
 * nada no banco: só login e cliques. Base da investigação: `e2e/mapa-marcador-investigacao.cjs`.
 *
 * `MAPA_SAIDA` é a subpasta de `e2e/mapa-marcador-evidence/` — `correcao` (padrão) ou `reversao/...`
 * quando a correção é desligada de propósito para provar que os casos 1 e 2 a detectam.
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

const OUT = path.join(__dirname, 'mapa-marcador-evidence', process.env.MAPA_SAIDA || 'correcao');
fs.mkdirSync(OUT, { recursive: true });

/*
 * Banco de dev (SELECT em 2026-09-24):
 *   id 5 "Sesc Itabaiana" (ITA-09): codigo_ibge 2803005 (Itabaianinha), coordenada dentro do
 *     polígono de Itabaiana (2802908).
 *   ids 1, 2, 3, 7: as quatro de Aracaju (2800308), IBGE coerente com a coordenada.
 */
const ITA09 = '5';
const ARACAJU_A = '7'; // coberto pelo marcador 2 no zoom inicial: exige aproximar a câmera
const ARACAJU_B = '1';

const resultados = [];
const registro = { base: BASE, saida: OUT, inicio: new Date().toISOString(), resultados, erros: [] };
function caso(numero, nome, ok, detalhe) {
  resultados.push({ caso: numero, nome, ok: !!ok, detalhe });
  console.log(`${ok ? 'ok  ' : 'FALHA'} caso ${numero} — ${nome}: ${JSON.stringify(detalhe)}`);
}

/** Estado visível, lido do DOM (o que o usuário vê), não do componente. */
async function estado(page, id) {
  return page.evaluate((unidadeId) => {
    const texto = (s) => { const el = document.querySelector(s); return el ? el.innerText.replace(/\s+/g, ' ').trim() : null; };
    return {
      ariaPressed: unidadeId ? document.querySelector(`.map__unidade[data-unidade-id="${unidadeId}"]`)?.getAttribute('aria-pressed') ?? null : null,
      unidadesPressionadas: [...document.querySelectorAll('.map__unidade[aria-pressed="true"]')].map(b => b.getAttribute('data-unidade-id')),
      municipiosPressionados: [...document.querySelectorAll('.map__alvo[aria-pressed="true"]')].map(b => b.getAttribute('data-codigo-ibge')),
      painelUnidade: texto('.unit-panel .unit-panel__nome'),
      painelMunicipio: texto('.selected-panel'),
      aviso: texto('.unit-panel .aviso-ibge'),
    };
  }, id);
}

/** Nome da unidade, do próprio componente — para não fixar no roteiro nomes que o cadastro pode mudar. */
async function nomeDaUnidade(page, id) {
  return page.evaluate((unidadeId) => {
    const comp = window.ng.getComponent(document.querySelector('app-mapa'));
    return comp.municipios().flatMap(m => m.units).find(u => String(u.id) === unidadeId)?.nome ?? null;
  }, id);
}

/** Espera o clique assentar: o bug trocava a seleção no MESMO evento, mas a resposta de equipamentos chega depois. */
const assentar = (page) => page.waitForTimeout(800);

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
    for (const id of [ITA09, ARACAJU_A, ARACAJU_B]) await page.waitForSelector(`.map__unidade[data-unidade-id="${id}"]`, { timeout: 30000 });
    await page.waitForTimeout(2500);
    const temNg = await page.evaluate(() => !!(window.ng && window.ng.getComponent && window.ng.getComponent(document.querySelector('app-mapa'))?.map));
    if (!temNg) throw new Error('window.ng.getComponent/map indisponível — ng serve não está em modo dev?');
    const cameraInicial = await page.evaluate(() => {
      const map = window.ng.getComponent(document.querySelector('app-mapa')).map;
      const c = map.getCenter();
      return { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    });
    registro.cameraInicial = cameraInicial;

    // ------------------------------------------------------------------ caso 1: clique no ITA-09
    {
      const nome = await nomeDaUnidade(page, ITA09);
      // Sem `force`: se outro elemento cobrir o marcador, o Playwright falha alto.
      await page.locator(`.map__unidade[data-unidade-id="${ITA09}"]`).click({ timeout: 10000 });
      await assentar(page);
      const e = await estado(page, ITA09);
      const ok = nome === 'Sesc Itabaiana' && e.painelUnidade === nome && e.ariaPressed === 'true'
        && !!e.aviso && e.aviso.includes('Itabaiana') && e.aviso.includes('2803005');
      caso(1, 'clique no marcador ITA-09 abre a unidade e mostra o aviso de IBGE', ok, { esperado: nome, ...e });
      await page.screenshot({ path: path.join(OUT, '01-ita09-clique.png') });
      // Legibilidade do aviso nos dois temas: recorte do painel, forçando cada tema — o Chromium
      // headless declara `prefers-color-scheme: light`, então o tema de partida não é o escuro.
      if (e.aviso) {
        const temaOriginal = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
        for (const tema of ['dark', 'light']) {
          await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
          await page.waitForTimeout(300);
          await page.locator('.unit-panel').screenshot({ path: path.join(OUT, `01-painel-aviso-${tema === 'dark' ? 'escuro' : 'claro'}.png`) });
        }
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), temaOriginal);
        await page.waitForTimeout(300);
      }
    }

    // Aracaju: no zoom inicial o centro do marcador 7 é coberto pelo 2 (ver investigação).
    await page.evaluate(() => {
      window.ng.getComponent(document.querySelector('app-mapa')).map.jumpTo({ center: [-37.055, -10.945], zoom: 12 });
    });
    await page.waitForTimeout(1500);

    // ------------------------------------------------------------------ caso 2: Aracaju, várias unidades
    {
      const nome = await nomeDaUnidade(page, ARACAJU_A);
      await page.locator(`.map__unidade[data-unidade-id="${ARACAJU_A}"]`).click({ timeout: 10000 });
      await assentar(page);
      const e = await estado(page, ARACAJU_A);
      const ok = !!nome && e.painelUnidade === nome && e.ariaPressed === 'true';
      caso(2, 'clique no marcador de unidade de Aracaju (município com 4) abre essa unidade', ok, { esperado: nome, ...e });
      await page.screenshot({ path: path.join(OUT, '02-aracaju-clique.png') });
    }

    // ------------------------------------------------------------------ caso 5: IBGE coerente, sem aviso
    {
      const nome = await nomeDaUnidade(page, ARACAJU_B);
      await page.locator(`.map__unidade[data-unidade-id="${ARACAJU_B}"]`).click({ timeout: 10000 });
      await assentar(page);
      const e = await estado(page, ARACAJU_B);
      const ok = !!nome && e.painelUnidade === nome && e.ariaPressed === 'true' && e.aviso === null;
      caso(5, 'unidade com IBGE coerente não mostra aviso', ok, { esperado: nome, ...e });
      await page.screenshot({ path: path.join(OUT, '05-coerente-sem-aviso.png') });
    }

    // ------------------------------------------------------------------ caso 3: área de município sem marcador
    await page.evaluate((c) => {
      window.ng.getComponent(document.querySelector('app-mapa')).map.jumpTo(c);
    }, cameraInicial);
    await page.waitForTimeout(1500);
    {
      /*
       * Ponto do canvas dentro de um município SEM unidade, longe de qualquer elemento DOM: amostra
       * a caixa do polígono, projeta, e fica com o primeiro pixel em que o topo é o próprio canvas e
       * a camada `municipios-fill` devolve esse município.
       */
      const alvo = await page.evaluate(() => {
        const comp = window.ng.getComponent(document.querySelector('app-mapa'));
        const map = comp.map;
        const canvas = map.getCanvas();
        const r = canvas.getBoundingClientRect();
        const candidatos = comp.municipios().filter(m => m.units.length === 0);
        for (const m of candidatos) {
          const pontos = [];
          const anda = (no) => { if (typeof no[0] === 'number') pontos.push(no); else for (const f of no) anda(f); };
          anda(m.feature.geometry.coordinates);
          const xs = pontos.map(p => p[0]), ys = pontos.map(p => p[1]);
          const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
          for (let i = 1; i < 8; i++) for (let j = 1; j < 8; j++) {
            const p = map.project([x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * j / 8]);
            const cx = r.left + p.x, cy = r.top + p.y;
            if (cx < r.left + 20 || cx > r.right - 20 || cy < r.top + 20 || cy > r.bottom - 20) continue;
            if (document.elementFromPoint(cx, cy) !== canvas) continue;
            const f = map.queryRenderedFeatures([p.x, p.y], { layers: ['municipios-fill'] })[0];
            if (f && String(f.properties.id).trim() === m.codigoIbge) return { x: cx, y: cy, codigoIbge: m.codigoIbge, nome: m.nome };
          }
        }
        return null;
      });
      if (!alvo) throw new Error('nenhum pixel de município sem unidade livre de marcador no enquadramento inicial');
      await page.mouse.click(alvo.x, alvo.y);
      await assentar(page);
      const e = await estado(page, null);
      const ok = !!e.painelMunicipio && e.painelMunicipio.includes(alvo.nome) && e.municipiosPressionados.length === 1
        && e.municipiosPressionados[0] === alvo.codigoIbge && e.painelUnidade === null && e.unidadesPressionadas.length === 0;
      caso(3, 'clique na área do município sem marcador continua selecionando o município', ok, { alvo, ...e });
      await page.screenshot({ path: path.join(OUT, '03-poligono-sem-marcador.png') });
    }

    // ------------------------------------------------------------------ caso 4: teclado no ITA-09
    {
      const nome = await nomeDaUnidade(page, ITA09);
      const marcador = page.locator(`.map__unidade[data-unidade-id="${ITA09}"]`);
      await marcador.focus();
      const focado = await page.evaluate((id) => document.activeElement?.getAttribute('data-unidade-id') === id, ITA09);
      if (!focado) throw new Error('marcador ITA-09 não recebeu foco');
      await page.keyboard.press('Enter');
      await assentar(page);
      const e = await estado(page, ITA09);
      const ok = e.painelUnidade === nome && e.ariaPressed === 'true' && !!e.aviso && e.aviso.includes('Itabaiana') && e.aviso.includes('2803005');
      caso(4, 'Enter no marcador ITA-09 focado dá o mesmo resultado do clique', ok, { esperado: nome, ...e });
      await page.screenshot({ path: path.join(OUT, '04-ita09-teclado.png') });
    }
  } catch (e) {
    registro.fatal = String(e && e.stack || e);
    console.error(registro.fatal);
  } finally {
    registro.fim = new Date().toISOString();
    if (registro.fatal || resultados.some(r => !r.ok)) process.exitCode = 1;
    console.log(`${resultados.filter(r => r.ok).length}/${resultados.length} casos ok${registro.fatal ? ' (interrompido)' : ''}`);
    fs.writeFileSync(path.join(OUT, 'resultados.json'), JSON.stringify(registro, null, 2));
    await browser.close();
  }
})();

/* Banco de medição N07 — custo real das animações do Mapa sobre o canvas WebGL.
 *
 * Roda FORA da aplicação (não exige login, que não estava disponível na sessão): mesma lib
 * (maplibre-gl 6.9.0 do node_modules), mesma cartografia de Sergipe, mesmo estilo de camadas,
 * mesmas 11 coordenadas de unidade e as 10 linhas hub->unidade do dev-seed.
 *
 * Duas métricas, porque só uma engana:
 *   - cadência de frame (rAF) — diz se CAIU de 60fps. Presa ao vsync, satura em 16,7ms.
 *   - CPU de main thread (CDP Performance) — diz QUANTO do orçamento de frame foi gasto.
 *     É esta que distingue "de graça" de "ainda cabe, mas come metade do orçamento".
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const FRONT = path.resolve(__dirname, '..', '..');   // raiz do infra-monitor-frontend
const SAIDA = __dirname;
const TIPOS = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.map': 'application/json' };

const servidor = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const alvo = url === '/' ? path.join(SAIDA, 'banco.html') : path.join(FRONT, url);
  fs.readFile(alvo, (erro, dados) => {
    if (erro) { res.writeHead(404); res.end('nao encontrado: ' + url); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(alvo)] || 'application/octet-stream' });
    res.end(dados);
  });
});

const CENARIOS = [
  ['A   baseline (mapa parado, sem animacao)', 'A'],
  ['B   11 marcadores pulsando — ::after, transform+opacity', 'B'],
  ['C   11 marcadores pulsando — box-shadow no elemento (idioma do sidebar)', 'C'],
  ['D   20 pings — Marker DOM, setLngLat por frame', 'D'],
  ['E   20 pings — camada circle, setData de GeoJSON por frame', 'E'],
  ['F   linha tracejada — setPaintProperty line-dasharray a 20 Hz', 'F'],
  ['BD  B + D (proposta completa, carga real)', 'BD'],
  ['B5  55 marcadores pulsando (5x a carga real) — margem', 'B5'],
  ['D5  100 pings DOM (5x) — margem', 'D5'],
  ['E5  100 pings por setData (5x) — margem', 'E5'],
];

(async () => {
  await new Promise((r) => servidor.listen(4321, r));
  const browser = await chromium.launch({ headless: false, args: ['--use-angle=default'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));

  await page.goto('http://127.0.0.1:4321/', { waitUntil: 'load' });
  try {
    await page.waitForFunction('window.pronto === true', { timeout: 30000 });
  } catch (e) {
    console.log('FALHOU: ' + e.message + '\nerros: ' + erros.join(' | '));
    await browser.close(); servidor.close(); return;
  }
  await page.waitForTimeout(2500);

  const gpu = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const d = c && c.getExtension('WEBGL_debug_renderer_info');
    return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'desconhecida';
  });
  console.log('renderizador WebGL: ' + gpu + '\n');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metricas = async () =>
    Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

  const resultados = [];
  for (const [rotulo, chave] of CENARIOS) {
    await page.evaluate((k) => window.cenario(k), chave);
    await page.waitForTimeout(1200);                       // deixa assentar antes de medir
    const antes = await metricas();
    const r = await page.evaluate(() => window.medir(6000));
    const depois = await metricas();
    const d = (k) => depois[k] - antes[k];
    const janela = d('Timestamp');
    const msFrame = (v) => +(1000 * v / r.frames).toFixed(3);
    const cpu = {
      taskMsFrame: msFrame(d('TaskDuration')),
      scriptMsFrame: msFrame(d('ScriptDuration')),
      estiloMsFrame: msFrame(d('RecalcStyleDuration')),
      layoutMsFrame: msFrame(d('LayoutDuration')),
      recalcs: Math.round(d('RecalcStyleCount')),
      layouts: Math.round(d('LayoutCount')),
      pctOrcamento: +(100 * d('TaskDuration') / janela).toFixed(1),
    };
    resultados.push({ rotulo, ...r, cpu });
    console.log(`${rotulo}
   cadencia: p50 ${r.p50}ms (${r.fps} fps) · p95 ${r.p95}ms · max ${r.max}ms · frames>20ms ${r.lentos}%
   CPU main: ${cpu.taskMsFrame}ms/frame (${cpu.pctOrcamento}% do orcamento) · script ${cpu.scriptMsFrame} · estilo ${cpu.estiloMsFrame} · layout ${cpu.layoutMsFrame} · recalcs ${cpu.recalcs} · layouts ${cpu.layouts}`);
  }

  fs.writeFileSync(path.join(SAIDA, 'bench.json'), JSON.stringify({ gpu, resultados, erros }, null, 2));
  console.log('\nerros de pagina: ' + (erros.length ? erros.join(' | ') : 'nenhum'));
  await page.evaluate(() => window.cenario('BD'));
  await page.waitForTimeout(900);
  await page.locator('#card').screenshot({ path: path.join(SAIDA, 'bench-final.png') });
  await browser.close();
  servidor.close();
})();

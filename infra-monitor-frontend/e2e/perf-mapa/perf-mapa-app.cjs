/* Custo das animações do Mapa NA APLICAÇÃO REAL, com o banco que estiver atrás do backend.
 * Complementa a bancada sintética (banco.html): lá a topologia é fixa (11 unidades, 10 arcos);
 * aqui é a do banco — dev (11 unidades) ou carga (2). Mesmas duas métricas da bancada:
 * cadência de frame (rAF, p50/fps/% > 20 ms) e CPU de main thread por quadro (CDP
 * Performance.getMetrics, TaskDuration). Chromium COM cabeça e GPU real, como a bancada: em
 * headless o WebGL cai para SwiftShader e o número deixa de valer.
 *
 *   FRONT_URL=http://127.0.0.1:4201 API_PORT=8082 E2E_EMAIL=... PERF_SENHA=... PERF_ROTULO=antes-dev \
 *     node e2e/perf-mapa/perf-mapa-app.cjs
 *
 * Grava e2e/perf-mapa/app-<PERF_ROTULO>.json só com contagens e números (nada de usuário/e-mail).
 * Sessão só em memória: depois do login, navegação por clique (page.goto cairia em /login). */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { apontarApi } = require('../api-porta.cjs');

const BASE = process.env.FRONT_URL || 'http://127.0.0.1:4200';
const EMAIL = process.env.E2E_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.PERF_SENHA;
const ROTULO = process.env.PERF_ROTULO || 'sem-rotulo';
if (!SENHA) throw new Error('PERF_SENHA é obrigatória');
const JANELA_MS = 6000, ASSENTAMENTO_MS = 1200;

/** Mesma cadência rAF da bancada (banco.html, window.medir): descarta os 2 primeiros intervalos. */
const medirQuadros = (ms) => new Promise((res) => {
  const q = []; let prev = performance.now(); const fim = prev + ms;
  const tick = (now) => {
    q.push(now - prev); prev = now;
    if (now < fim) requestAnimationFrame(tick); else {
      const s = q.slice(2).sort((a, b) => a - b);
      const p = (k) => s[Math.min(s.length - 1, Math.floor(s.length * k))];
      res({ frames: s.length, p50: +p(0.5).toFixed(2), fps: +(1000 / p(0.5)).toFixed(1),
        lentosPct: +(100 * s.filter((v) => v > 20).length / s.length).toFixed(1) });
    }
  };
  requestAnimationFrame(tick);
});

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await apontarApi(ctx);
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  let saida = null;
  try {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
    await page.click('a[href="/mapa"]');
    await page.waitForSelector('.map__unidade', { timeout: 20000 });
    await page.waitForTimeout(1600);

    const unidades = await page.locator('.map__unidade').count();
    const pings = await page.locator('.map__ping').count();
    // `linhas` fica nulo de propósito: pings por linha mudou de 2 (antes) para 3 (depois); quem
    // lê o JSON divide pelo valor da época.
    console.log(`rotulo ${ROTULO}: ${unidades} marcadores, ${pings} pings`);

    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const metricas = async () =>
      Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

    const medir = async (nome) => {
      await page.waitForTimeout(ASSENTAMENTO_MS);
      const a = await metricas();
      const r = await page.evaluate(medirQuadros, JANELA_MS);
      const b = await metricas();
      return { nome, cpuMsPorQuadro: +(1000 * (b.TaskDuration - a.TaskDuration) / r.frames).toFixed(3),
        fps: r.fps, p50: r.p50, lentosPct: r.lentosPct };
    };

    const cenarios = [];
    cenarios.push(await medir('animado'));
    /* `parado` é a BASE, não o zero absoluto: remover os .map__ping do DOM deixa o rAF chamando
     * setLngLat em elemento órfão (barato), e a câmera/camadas do canvas seguem desenhando. */
    await page.addStyleTag({ content: '*{animation:none!important}' });
    await page.evaluate(() => document.querySelectorAll('.map__ping').forEach((n) => n.remove()));
    cenarios.push(await medir('parado'));

    saida = { rotulo: ROTULO, unidades, linhas: null, pings, cenarios };
    console.log('cenario'.padEnd(10), 'cpu ms/quadro', 'fps', 'lentos%');
    for (const c of cenarios) console.log(c.nome.padEnd(10), String(c.cpuMsPorQuadro).padEnd(13), String(c.fps).padEnd(4), c.lentosPct);
    if (erros.length) console.log('erros de pagina: ' + erros.length);
  } finally {
    if (saida) fs.writeFileSync(path.join(__dirname, `app-${ROTULO}.json`), JSON.stringify(saida, null, 2));
    await ctx.unrouteAll({ behavior: 'ignoreErrors' });
    await ctx.close();
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });

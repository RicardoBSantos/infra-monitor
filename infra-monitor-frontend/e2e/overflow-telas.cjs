/*
 * Sonda de overflow horizontal por tela e largura (somente leitura: não altera dado).
 *   CV_SENHA=<senha> E2E_EMAIL=<email> E2E_BASE=http://localhost:4300 API_PORT=<porta> SAIDA=<arquivo.json> node e2e/overflow-telas.cjs
 * Variáveis: CV_SENHA (obrigatória), SAIDA (obrigatória; JSON completo), E2E_EMAIL (default admin@inframonitor.local),
 *   API_PORT (default 8080), E2E_BASE (default http://localhost:4300; usar `localhost`, o CORS não libera 127.0.0.1).
 * Imprime, por tela, as larguras com estouro além da topbar (main > 0 ou culpados não vazio).
 * Exit 1 se houver algum; 0 caso contrário (critério da spec §6).
 * Regras herdadas: depois do login, navegação SÓ por clique; sem catch em seletor.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const { apontarApi } = require('./api-porta.cjs');

const BASE = process.env.E2E_BASE || 'http://localhost:4300';
const EMAIL = process.env.E2E_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.CV_SENHA; if (!SENHA) throw new Error('CV_SENHA é obrigatória');
const SAIDA = process.env.SAIDA; if (!SAIDA) throw new Error('SAIDA é obrigatória');
const LARGURAS = [1366, 1280, 1180, 1024, 900, 768, 600, 390];
const ROTAS = ['/dashboard', '/mapa', '/unidades', 'DETALHE', '/equipamentos', '/tipos-equipamento', '/monitores', '/medicoes', '/incidentes', '/notificacoes', '/relatorios', '/usuarios'];

const medir = (page) => page.evaluate(() => {
  const d = document.documentElement;
  const main = document.querySelector('.shell__main');
  const top = document.querySelector('app-topbar, .topbar');
  const sec = main?.querySelector('section');
  const culpados = [];
  if (main) {
    const lim = main.getBoundingClientRect().right;
    for (const el of main.querySelectorAll('*')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.right <= lim + 1) continue;
      let p = el.parentElement, contido = false;
      while (p && p !== main) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') { contido = true; break; }
        p = p.parentElement;
      }
      if (contido) continue;
      if (el.parentElement.getBoundingClientRect().right > lim + 1) continue; // só a raiz do estouro
      const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      culpados.push(el.tagName.toLowerCase() + cls + ' +' + Math.round(b.right - lim));
    }
  }
  return {
    doc: d.scrollWidth - d.clientWidth,
    main: main ? main.scrollWidth - main.clientWidth : null,
    sec: sec ? Math.max(0, Math.round(sec.scrollWidth - sec.clientWidth)) : null,
    topbar: top ? Math.max(0, Math.round(top.scrollWidth - top.clientWidth)) : null,
    culpados: culpados.slice(0, 5),
  };
});

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await apontarApi(ctx);
  const page = await ctx.newPage();
  const out = {};
  try {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    out['/login'] = {};
    for (const w of LARGURAS) {
      await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250);
      out['/login'][w] = { doc: await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) };
    }
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
    for (const r of ROTAS) {
      await page.setViewportSize({ width: 1600, height: 900 });
      if (r === 'DETALHE') {
        await page.click('.navigation__item[href="/unidades"]');
        await page.waitForSelector('a[href^="/unidades/"]', { timeout: 15000 });
        await page.locator('a[href^="/unidades/"]').first().click();
      } else {
        await page.click(`.navigation__item[href="${r}"]`);
      }
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1500);
      const chave = r === 'DETALHE' ? '/unidades/:id' : r;
      out[chave] = {};
      for (const w of LARGURAS) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(400);
        out[chave][w] = await medir(page);
      }
    }
  } finally {
    fs.writeFileSync(SAIDA, JSON.stringify(out, null, 1));
    await ctx.unrouteAll({ behavior: 'ignoreErrors' });
    await browser.close();
  }
  let estouros = 0;
  for (const [tela, porLargura] of Object.entries(out)) {
    const ruins = Object.entries(porLargura).filter(([, m]) => m.main > 0 || (m.culpados && m.culpados.length > 0));
    if (!ruins.length) continue;
    estouros += ruins.length;
    console.log(`ESTOURO ${tela}: ` + ruins.map(([w, m]) => `${w}px (main=${m.main}${m.culpados.length ? ' ' + m.culpados.join(', ') : ''})`).join('; '));
  }
  console.log(estouros ? `telas/larguras com estouro: ${estouros}` : 'sem estouro além da topbar');
  if (estouros) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });

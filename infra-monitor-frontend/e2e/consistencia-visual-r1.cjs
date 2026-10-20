/*
 * Rodada 1 de consistência visual — capturas antes/depois nos dois temas + verificações de a11y.
 *   CV_SENHA=<senha> E2E_OUT=<pasta> CV_FASE=antes|depois node e2e/consistencia-visual-r1.cjs
 * Variáveis: CV_SENHA (obrigatória), E2E_EMAIL (default admin@inframonitor.local), API_PORT (default 8080),
 *   E2E_BASE (default http://127.0.0.1:4200), E2E_OUT (obrigatória; evidência fora do repo), CV_FASE (obrigatória).
 * Na fase "antes" só captura; as verificações de a11y rodam e são registradas, mas falha não muda o exit code.
 *
 * Regras herdadas: sessão só em memória (depois do login, navegação SÓ por clique); sem catch em seletor;
 * resultados gravados em `finally`.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { apontarApi } = require('./api-porta.cjs');

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4200';
const EMAIL = process.env.E2E_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.CV_SENHA; if (!SENHA) throw new Error('CV_SENHA é obrigatória');
const FASE = process.env.CV_FASE; if (!['antes', 'depois'].includes(FASE)) throw new Error('CV_FASE = antes|depois');
if (!process.env.E2E_OUT) throw new Error('E2E_OUT é obrigatória');
const OUT = path.resolve(process.env.E2E_OUT, FASE); fs.mkdirSync(OUT, { recursive: true });

const resultados = []; const errosPagina = []; const respostas5xx = [];
const checar = (caso, nome, ok, detalhe) => resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' });
const naoAplicavel = (caso, nome, motivo) => resultados.push({ caso, nome, ok: true, na: true, detalhe: 'NÃO APLICÁVEL: ' + motivo });
const pausa = (page, ms) => page.waitForTimeout(ms);

const TELAS = [ // rótulo, href do link da sidebar (.navigation__item)
  ['painel', '/dashboard'], ['equipamentos', '/equipamentos'], ['unidades', '/unidades'],
  ['medicoes', '/medicoes'], ['telegram-historico', '/notificacoes'],
];

const temaAtual = (page) => page.evaluate(() => (document.documentElement.dataset.theme === 'light' ? 'claro' : 'escuro'));

async function novoContexto(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await apontarApi(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errosPagina.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 500) respostas5xx.push(r.status() + ' ' + r.url()); });
  return { ctx, page };
}

async function capturarLogin(page, tema) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  if ((await temaAtual(page)) !== tema) await page.click('.login-theme');
  await page.waitForFunction((t) => (document.documentElement.dataset.theme === 'light') === (t === 'claro'), tema);
  await page.focus('#login-senha'); // campo vazio focado: placeholder visível
  await pausa(page, 400);
  await page.screenshot({ path: path.join(OUT, `login-${tema}.png`), fullPage: true });
}

async function entrar(page) {
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-senha', SENHA);
  await page.click('.login-submit');
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

async function aguardarCarga(page) {
  await page.waitForFunction(
    () => document.querySelectorAll('.skeleton, .kpi--carregando, .linha--carregando').length === 0,
    null, { timeout: 15000 },
  );
}

async function irPara(page, href) {
  if (await page.locator('.menu-button').isVisible()) await page.click('.menu-button');
  await page.click(`.navigation__item[href="${href}"]`);
  await page.waitForURL((u) => u.pathname.startsWith(href), { timeout: 15000 });
  await aguardarCarga(page);
  await pausa(page, 400);
}

async function trocarTema(page) {
  const antes = await temaAtual(page);
  await page.click('.theme-button');
  await page.waitForFunction((a) => (document.documentElement.dataset.theme === 'light') !== (a === 'claro'), antes);
}

/** Contraste WCAG entre a cor do texto do seletor e o fundo efetivo (sobe ancestrais até alfa 1, compondo). */
const medirContraste = (page, seletor) => page.evaluate((sel) => {
  const el = document.querySelector(sel); if (!el) return null;
  const p = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { rgb: v.slice(0, 3), a: v.length > 3 ? v[3] : 1 }; };
  const camadas = [];
  for (let n = el; n; n = n.parentElement) { const c = p(getComputedStyle(n).backgroundColor); if (c.a > 0) camadas.push(c); if (c.a === 1) break; }
  let fundo = camadas.length && camadas[camadas.length - 1].a === 1 ? camadas.pop().rgb : [255, 255, 255];
  while (camadas.length) { const c = camadas.pop(); fundo = c.rgb.map((v, i) => v * c.a + fundo[i] * (1 - c.a)); }
  const t = p(getComputedStyle(el).color); const frente = t.rgb.map((v, i) => v * t.a + fundo[i] * (1 - t.a));
  const L = (rgb) => { const c = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const a = L(frente); const b = L(fundo);
  return { razao: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), cor: getComputedStyle(el).color, fundo: fundo.map(Math.round).join(',') };
}, seletor);

/** Unidades usa botões na linha (sem action-menu): "Desativar" da primeira unidade ativa abre o app-confirm-dialog. Nunca confirma. */
async function verificarConfirm(page, tema) {
  const gatilho = page.locator('.unidades__acoes button', { hasText: 'Desativar' }).first();
  await gatilho.waitFor({ state: 'visible', timeout: 10000 });
  await gatilho.evaluate((el) => el.setAttribute('data-cv-gatilho', '1'));
  await gatilho.click();
  await page.waitForSelector('.confirm-dialog', { timeout: 5000 });
  await pausa(page, 300);
  const foco = () => page.evaluate(() => ({ texto: (document.activeElement?.textContent || '').trim(), dentro: !!document.activeElement?.closest('.confirm-dialog') }));
  const inicial = await foco();
  checar(`confirm.foco-inicial.${tema}`, 'foco inicial no Cancelar', inicial.texto === 'Cancelar', `ativo="${inicial.texto}"`);

  let todosDentro = true; const trilha = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    const f = await foco();
    todosDentro = todosDentro && f.dentro;
    trilha.push(`${f.texto || '(vazio)'}${f.dentro ? '' : ' [FORA]'}`);
  }
  checar(`confirm.tab-cicla.${tema}`, '3x Tab mantém o foco no diálogo', todosDentro, trilha.join(' > '));

  await page.locator('.confirm-dialog button').first().focus();
  await page.keyboard.press('Shift+Tab');
  const sh = await page.evaluate(() => {
    const bs = [...document.querySelectorAll('.confirm-dialog button')];
    return { ehUltimo: document.activeElement === bs[bs.length - 1], texto: (document.activeElement?.textContent || '').trim(), dentro: !!document.activeElement?.closest('.confirm-dialog') };
  });
  checar(`confirm.shift-tab.${tema}`, 'Shift+Tab de Cancelar vai ao último botão', sh.ehUltimo, `ativo="${sh.texto}" dentro=${sh.dentro}`);

  await page.screenshot({ path: path.join(OUT, `confirm-${tema}.png`) });

  await page.keyboard.press('Escape');
  await pausa(page, 400);
  const fechou = (await page.locator('.confirm-dialog').count()) === 0;
  checar(`confirm.escape.${tema}`, 'Escape remove o diálogo', fechou);
  if (!fechou) { // limpa clicando Cancelar (nunca o botão de confirmar)
    await page.locator('.confirm-dialog button').first().click();
    await page.waitForSelector('.confirm-dialog', { state: 'detached', timeout: 5000 });
  }

  const ret = await page.evaluate(() => {
    const a = document.activeElement;
    return { fora: !a?.closest('.confirm-dialog'), conectado: !!a?.isConnected, naoBody: a !== document.body, gatilho: !!a?.hasAttribute?.('data-cv-gatilho'), html: (a?.outerHTML || '').slice(0, 160) };
  });
  checar(`confirm.retorno.${tema}`, 'foco volta ao gatilho (fora do diálogo, conectado)', ret.fora && ret.conectado && ret.naoBody && ret.gatilho, `gatilho=${ret.gatilho} ${ret.html}`);
}

async function verificarMotion(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Atrasa só a API de medições para o esqueleto ser observável; depois do atraso a requisição segue
  // para a rota de redirecionamento de porta (route.fallback).
  const padraoMedicoes = /localhost:\d+\/api\/v1\/medicoes/;
  const atrasar = async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.fallback(); };
  await page.route(padraoMedicoes, atrasar);
  await page.click('.navigation__item[href="/medicoes"]');
  const vistoEsq = await page.locator('.skeleton span').first().waitFor({ state: 'attached', timeout: 3000 }).then(() => true, () => false);
  if (vistoEsq) {
    const nome = await page.locator('.skeleton span').first().evaluate((el) => getComputedStyle(el).animationName);
    checar('motion.skeleton', 'esqueleto sem animação com reduced-motion', nome === 'none', `animationName=${nome}`);
  } else naoAplicavel('motion.skeleton', 'esqueleto sem animação com reduced-motion', 'esqueleto não apareceu em 3 s mesmo com a API atrasada');
  await aguardarCarga(page);
  await page.unroute(padraoMedicoes, atrasar);

  await page.click('.refresh');
  // leitura atômica: o ícone pode deixar de estar ocupado entre a espera e a leitura
  const giro = await page.waitForFunction(() => {
    const el = document.querySelector('.refresh[aria-busy="true"] app-icon');
    return el ? getComputedStyle(el).animationName : null;
  }, null, { timeout: 2000, polling: 'raf' }).then((h) => h.jsonValue(), () => null);
  if (giro !== null) checar('motion.refresh', 'ícone de atualizar sem giro com reduced-motion', giro === 'none', `animationName=${giro}`);
  else naoAplicavel('motion.refresh', 'ícone de atualizar sem giro com reduced-motion', 'aria-busy="true" não apareceu a tempo após o clique em .refresh (resposta rápida)');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}

async function rodarTema(browser, tema) {
  const { ctx, page } = await novoContexto(browser);
  try {
    await capturarLogin(page, tema);
    await entrar(page);
    if ((await temaAtual(page)) !== tema) await trocarTema(page);
    checar(`tema.${tema}`, 'tema aplicado após login', (await temaAtual(page)) === tema);
    await aguardarCarga(page);

    for (const [rotulo, href] of TELAS) {
      if (href !== '/dashboard') await irPara(page, href); else await pausa(page, 400);
      await page.screenshot({ path: path.join(OUT, `${rotulo}-${tema}.png`), fullPage: true });

      if (rotulo === 'painel') {
        const m = await medirContraste(page, '.kpi span');
        checar(`contraste.kpi.${tema}`, 'rótulo do KPI ≥ 4,5', m && m.razao >= 4.5, m ? `${m.razao.toFixed(2)} cor=${m.cor} fundo=${m.fundo}` : 'seletor ausente');
      }
      if (rotulo === 'unidades') {
        const m = await medirContraste(page, 'table.tabela th');
        checar(`contraste.th.${tema}`, 'th da tabela ≥ 4,5', m && m.razao >= 4.5, m ? `${m.razao.toFixed(2)} cor=${m.cor} fundo=${m.fundo}` : 'seletor ausente');
        await verificarConfirm(page, tema);
      }
      if (rotulo === 'telegram-historico') {
        const h1 = await page.evaluate(() => document.querySelectorAll('h1').length);
        checar(`telegram.h1.${tema}`, 'exatamente um h1', h1 === 1, `h1=${h1}`);
        const pad = await page.evaluate(() => { const el = document.querySelector('.operational-page'); return el ? getComputedStyle(el).paddingTop : null; });
        checar(`telegram.padding.${tema}`, '.operational-page sem padding-top', pad === '0px', `paddingTop=${pad}`);
      }
    }
    await verificarMotion(page);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await ctx.unrouteAll({ behavior: 'ignoreErrors' });
    await ctx.close();
  }
}

(async () => {
  const browser = await chromium.launch();
  let erro = null;
  try {
    for (const tema of ['escuro', 'claro']) await rodarTema(browser, tema);
  } catch (e) { erro = e; } finally {
    fs.writeFileSync(path.join(OUT, 'resultados.json'), JSON.stringify({ fase: FASE, resultados, errosPagina, respostas5xx, erro: erro ? String(erro) : null }, null, 2));
    for (const r of resultados) console.log(`${r.ok ? (r.na ? 'N/A  ' : 'ok   ') : 'FALHA'} ${r.caso} — ${r.nome} ${r.detalhe}`);
    const nas = resultados.filter((r) => r.na).length;
    console.log(`aprovados: ${resultados.filter((r) => r.ok && !r.na).length}; N/A: ${nas}; falhas: ${resultados.filter((r) => !r.ok).length}`);
    console.log(`erros de página: ${errosPagina.length}; respostas 5xx: ${respostas5xx.length}`);
    await browser.close();
  }
  if (erro) { console.error(erro); process.exit(1); }
  if (FASE === 'depois' && (resultados.some((r) => !r.ok || r.na) || errosPagina.length || respostas5xx.length)) process.exit(1);
})();

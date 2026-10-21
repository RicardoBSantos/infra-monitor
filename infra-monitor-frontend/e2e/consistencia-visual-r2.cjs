/*
 * Rodada 2 de consistência visual — capturas antes/depois nos dois temas + verificações de casca, tipografia e a11y.
 *   CV_FASE=antes|depois CV_SENHA=<senha> E2E_EMAIL=<email> E2E_BASE=http://localhost:4300 API_PORT=<porta> \
 *   E2E_OUT=<pasta> node e2e/consistencia-visual-r2.cjs
 * Variáveis: CV_SENHA (obrigatória), E2E_EMAIL (default admin@inframonitor.local), API_PORT (default 8080),
 *   E2E_BASE (default http://localhost:4300; usar `localhost`, não 127.0.0.1: o CORS só libera http://localhost:4300 e :4301),
 *   E2E_OUT (obrigatória; evidência fora do repo), CV_FASE (obrigatória).
 * Saída: E2E_OUT/<fase>/<tela>-<tema>.png + resultados.json. Exit 1 só na fase "depois" com falha.
 * Na fase "antes" as verificações rodam e são registradas, mas falha não muda o exit code.
 *
 * Regras herdadas: sessão só em memória (depois do login, navegação SÓ por clique); sem catch em seletor;
 * resultados gravados em `finally`.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { apontarApi } = require('./api-porta.cjs');

const BASE = process.env.E2E_BASE || 'http://localhost:4300';
const EMAIL = process.env.E2E_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.CV_SENHA; if (!SENHA) throw new Error('CV_SENHA é obrigatória');
const FASE = process.env.CV_FASE; if (!['antes', 'depois'].includes(FASE)) throw new Error('CV_FASE = antes|depois');
if (!process.env.E2E_OUT) throw new Error('E2E_OUT é obrigatória');
const OUT = path.resolve(process.env.E2E_OUT, FASE); fs.mkdirSync(OUT, { recursive: true });

const resultados = []; const errosPagina = []; const respostas5xx = [];
const checar = (caso, nome, ok, detalhe) => resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' });
const naoAplicavel = (caso, nome, motivo) => resultados.push({ caso, nome, ok: true, na: true, detalhe: 'NÃO APLICÁVEL: ' + motivo });
const pausa = (page, ms) => page.waitForTimeout(ms);

const TELAS = [ // rótulo, href do .navigation__item
  ['painel', '/dashboard'], ['mapa', '/mapa'], ['unidades', '/unidades'], ['equipamentos', '/equipamentos'],
  ['tipos', '/tipos-equipamento'], ['monitoramento', '/monitores'], ['medicoes', '/medicoes'],
  ['incidentes', '/incidentes'], ['telegram', '/notificacoes'], ['relatorios', '/relatorios'], ['usuarios', '/usuarios'],
];

const temaAtual = (page) => page.evaluate(() => (document.documentElement.dataset.theme === 'light' ? 'claro' : 'escuro'));

async function capturarLogin(page, tema) {
  if ((await temaAtual(page)) !== tema) await page.click('.login-theme');
  await page.waitForFunction((t) => (document.documentElement.dataset.theme === 'light') === (t === 'claro'), tema);
  await page.focus('#login-senha');
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
    () => document.querySelectorAll('.skeleton, .esqueleto, .kpi--carregando, .linha--carregando').length === 0,
    null, { timeout: 15000 },
  );
}

async function irPara(page, href) {
  if (await page.locator('.menu-button').isVisible()) await page.click('.menu-button');
  await page.click(`.navigation__item[href="${href}"]`);
  await page.waitForURL((u) => u.pathname.startsWith(href), { timeout: 15000 });
  await aguardarCarga(page);
  if (href === '/mapa') { await page.waitForSelector('.map-titulo', { timeout: 15000 }); await pausa(page, 3000); } else await pausa(page, 400);
}

async function trocarTema(page) {
  const antes = await temaAtual(page);
  await page.click('.theme-button');
  await page.waitForFunction((a) => (document.documentElement.dataset.theme === 'light') !== (a === 'claro'), antes);
}

/** V1–V5: cabeçalho de página, casca e fonte. Tudo por page.evaluate; seletor ausente vira falha registrada. */
async function verificarTela(page, rotulo, tema) {
  const r = await page.evaluate(() => {
    const visivel = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const sobretitulos = ['.eyebrow:not(.unidade-form-drawer .eyebrow)', '.telegram__secao', '.map-titulo__eyebrow', 'header > div > p:first-child:not(.pagina__descricao)']
      .map((s) => [s, document.querySelectorAll(s).length]).filter(([, n]) => n > 0).map(([s, n]) => `${s} x${n}`);
    const h1 = document.querySelector('h1');
    const h1Estilo = h1 ? { tamanho: getComputedStyle(h1).fontSize, peso: getComputedStyle(h1).fontWeight } : null;
    const raiz = document.querySelector('.shell__main section');
    const raizEstilo = raiz ? { classes: raiz.className, padding: getComputedStyle(raiz).paddingLeft, maxWidth: getComputedStyle(raiz).maxWidth } : null;
    const proximo = h1 ? h1.nextElementSibling : null;
    const mono = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!visivel(el)) continue;
      const f = getComputedStyle(el).fontFamily;
      if (f.startsWith('"JetBrains Mono"') || f.startsWith('ui-monospace')) mono.push(el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : ''));
    }
    return { sobretitulos, h1Estilo, raizEstilo, proximo: proximo ? proximo.tagName.toLowerCase() : null, headerSmall: document.querySelectorAll('header small').length, mono: [...new Set(mono)].slice(0, 8), monoTotal: mono.length };
  });

  checar(`${rotulo}.v1.${tema}`, 'sem sobretítulo', r.sobretitulos.length === 0, r.sobretitulos.join('; '));
  const esperado = rotulo === 'mapa' ? { tamanho: '18px' } : { tamanho: '20px', peso: '700' };
  const h1ok = !!r.h1Estilo && r.h1Estilo.tamanho === esperado.tamanho && (!esperado.peso || r.h1Estilo.peso === esperado.peso);
  checar(`${rotulo}.v2.${tema}`, `h1 ${esperado.tamanho}${esperado.peso ? '/' + esperado.peso : ''}`, h1ok, r.h1Estilo ? `${r.h1Estilo.tamanho}/${r.h1Estilo.peso}` : 'h1 ausente');
  const c = r.raizEstilo; const temPagina = !!c && c.classes.split(/\s+/).includes('pagina');
  const v3 = !c ? false : rotulo === 'mapa' ? !temPagina : temPagina && c.padding === '22px' && c.maxWidth === '1500px';
  checar(`${rotulo}.v3.${tema}`, rotulo === 'mapa' ? 'casca: raiz sem .pagina' : 'casca: .pagina, padding 22px, max-width 1500px', v3, c ? `class="${c.classes}" padding=${c.padding} max=${c.maxWidth}` : 'section raiz ausente');
  checar(`${rotulo}.v4.${tema}`, 'subtítulo é <p> (sem header small)', (r.proximo === null || r.proximo === 'p') && r.headerSmall === 0, `apósH1=${r.proximo} headerSmall=${r.headerSmall}`);
  checar(`${rotulo}.v5.${tema}`, 'sem fonte monoespaçada visível', r.monoTotal === 0, r.monoTotal ? `${r.monoTotal} elementos: ${r.mono.join(', ')}` : '');
}

async function capturar(page, rotulo, tema) {
  await page.screenshot({ path: path.join(OUT, `${rotulo}-${tema}.png`), fullPage: true });
  await verificarTela(page, rotulo, tema);
}

async function capturarTodas(page, tema) {
  for (const [rotulo, href] of TELAS) {
    if (href !== '/dashboard' || !new URL(page.url()).pathname.startsWith('/dashboard')) await irPara(page, href); else await pausa(page, 400);
    await capturar(page, rotulo, tema);
    if (rotulo === 'unidades') {
      await page.waitForSelector('a[href^="/unidades/"]', { timeout: 15000 });
      await page.locator('a[href^="/unidades/"]').first().click();
      await page.waitForURL(/\/unidades\/[^/]+/, { timeout: 15000 });
      await aguardarCarga(page); await pausa(page, 400);
      await capturar(page, 'unidade-detalhe', tema);
      await irPara(page, '/unidades');
    }
    if (rotulo === 'telegram') {
      const aba = page.getByRole('tab', { name: /Hist/ });
      if (await aba.count()) { await aba.first().click(); await aguardarCarga(page); await pausa(page, 400); }
      const link = page.locator('a[href^="/notificacoes/detalhe/"]');
      if (await link.count()) {
        await link.first().click();
        await page.waitForURL(/\/notificacoes\/detalhe\//, { timeout: 15000 });
        await aguardarCarga(page); await pausa(page, 400);
        await capturar(page, 'notificacao-detalhe', tema);
        await irPara(page, '/notificacoes');
      } else naoAplicavel('notificacao-detalhe', 'tela de detalhe da notificação', 'sem notificações no histórico');
    }
  }
}

/** Diálogos visíveis (cobre section.modal da rodada e o modal local antigo). */
const dialogosAbertos = (page) => page.evaluate(() => [...document.querySelectorAll('[role="dialog"], section.modal')].filter((el) => el.getClientRects().length > 0).length);

/** Abre o modal pelo gatilho sem mover o foco, aperta Escape e confere fechamento e retorno do foco ao gatilho. */
async function verificarModal(page, caso, gatilho, capturaAberto) {
  await gatilho.waitFor({ state: 'visible', timeout: 10000 });
  await gatilho.evaluate((el, c) => el.setAttribute('data-cv-gatilho', c), caso);
  await gatilho.click();
  await page.waitForSelector('[role="dialog"], section.modal', { state: 'visible', timeout: 5000 });
  await pausa(page, 400);
  if (capturaAberto) await page.screenshot({ path: path.join(OUT, `${caso}-escuro.png`), fullPage: true });
  await page.keyboard.press('Escape');
  await pausa(page, 400);
  const abertos = await dialogosAbertos(page);
  checar(`${caso}.fecha`, 'Escape fecha o modal (section.modal ausente, nenhum dialog visível)', (await page.locator('section.modal').count()) === 0 && abertos === 0, `dialogs visíveis=${abertos}`);
  const ret = await page.evaluate((c) => { const a = document.activeElement; return { gatilho: a?.getAttribute?.('data-cv-gatilho') === c, naoBody: a !== document.body, html: (a?.outerHTML || '').slice(0, 140) }; }, caso);
  checar(`${caso}.foco`, 'foco volta ao botão que abriu', ret.gatilho && ret.naoBody, ret.html);
  await fecharDialogoResidual(page);
}

/** Se o Escape não fechou o diálogo (bug da linha de base), fecha pelo botão "Fechar" para não bloquear o resto do roteiro. */
async function fecharDialogoResidual(page) {
  const dialogo = page.locator('section.modal:visible, [role="dialog"]:not(.gaveta):visible').first();
  if (await dialogo.count()) {
    await dialogo.locator('.modal__fechar, button[aria-label="Fechar"]').first().click();
    await page.waitForFunction(() => ![...document.querySelectorAll('[role="dialog"]:not(.gaveta), section.modal')].some((el) => el.getClientRects().length > 0), null, { timeout: 5000 });
    await pausa(page, 300);
  }
}

async function verificarGaveta(page) {
  const caso = 'modal-gaveta';
  await page.locator('.menu-acoes__gatilho').first().click();
  await page.getByRole('menuitem', { name: 'Ver' }).first().click();
  await page.waitForSelector('.gaveta', { state: 'visible', timeout: 10000 });
  const editar = page.locator('.gaveta').getByRole('button', { name: 'Editar equipamento' });
  await editar.waitFor({ state: 'visible', timeout: 10000 });
  await pausa(page, 400);
  await editar.click();
  await pausa(page, 600);
  await page.keyboard.press('Escape');
  await pausa(page, 400);
  const foco = await page.evaluate(() => { const a = document.activeElement; return { dentro: !!a?.closest('.gaveta'), naoBody: a !== document.body, html: (a?.outerHTML || '').slice(0, 140) }; });
  checar(`${caso}.foco`, 'após Escape do modal aberto na gaveta, foco fica dentro da gaveta (não body)', foco.dentro && foco.naoBody, foco.html);
  await fecharDialogoResidual(page);
  if (await page.locator('.gaveta__fechar').count()) { await page.click('.gaveta__fechar'); await pausa(page, 400); }
}

async function verificarAbas(page) {
  const caso = 'abas-relatorios';
  const abas = page.locator('.abas .aba[role="tab"]');
  const n = await abas.count();
  if (n < 2) {
    checar(`${caso}.setas`, 'ArrowRight seleciona e foca a 2ª aba', false, `.abas .aba[role=tab] encontrados=${n}`);
    checar(`${caso}.end`, 'End seleciona e foca a última aba', false, `abas=${n}`);
    return;
  }
  await abas.first().focus();
  await page.keyboard.press('ArrowRight');
  await pausa(page, 300);
  const estado = () => page.evaluate(() => { const l = [...document.querySelectorAll('.abas .aba[role="tab"]')]; return { sel: l.map((a) => a.getAttribute('aria-selected')), foco: l.indexOf(document.activeElement) }; });
  let e = await estado();
  checar(`${caso}.setas`, 'ArrowRight seleciona e foca a 2ª aba', e.sel[1] === 'true' && e.foco === 1, `selected=${e.sel.join(',')} foco=${e.foco}`);
  await page.keyboard.press('End');
  await pausa(page, 300);
  e = await estado();
  checar(`${caso}.end`, 'End seleciona e foca a última aba', e.sel[n - 1] === 'true' && e.foco === n - 1, `selected=${e.sel.join(',')} foco=${e.foco}`);
}

async function verificarEsqueleto(page) {
  const caso = 'esqueleto';
  await irPara(page, '/incidentes'); // sai de Medições para o clique abaixo montar a tela do zero
  // Atrasa só a API de medições; depois do atraso a requisição segue para o redirecionamento de porta (route.fallback,
  // não continue: continue pularia o proxy de api-porta e iria à porta 8080).
  const padrao = /localhost:\d+\/api\/v1\/medicoes/;
  const atrasar = async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.fallback(); };
  await page.route(padrao, atrasar);
  try {
    await page.click('.navigation__item[href="/medicoes"]');
    const visto = await page.locator('.esqueleto[role="status"]').first().waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);
    checar(`${caso}.status`, '.esqueleto[role="status"] visível durante o carregamento', visto, visto ? '' : 'não apareceu em 3 s com a API atrasada');
    await aguardarCarga(page);
  } finally {
    await page.unroute(padrao, atrasar);
  }
}

/** Roda um caso extra isolado: o erro vira falha registrada (com a mensagem) e o roteiro segue; tenta fechar diálogo preso. */
async function isolado(page, caso, fn) {
  try { await fn(); } catch (e) {
    checar(caso, 'caso executou sem erro', false, String(e).split('
')[0]);
    try { await fecharDialogoResidual(page); } catch (e2) { checar(caso + '.limpeza', 'limpeza de diálogo preso', false, String(e2).split('
')[0]); }
  }
}

async function rodar(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await apontarApi(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errosPagina.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 500) respostas5xx.push(r.status() + ' ' + r.url()); });
  try {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await capturarLogin(page, 'escuro');
    await capturarLogin(page, 'claro');
    await entrar(page);
    if ((await temaAtual(page)) !== 'escuro') await trocarTema(page);
    await aguardarCarga(page);

    await capturarTodas(page, 'escuro');

    // casos extras, só no tema escuro
    await isolado(page, 'modal-equipamentos', async () => {
      await irPara(page, '/equipamentos');
      await verificarModal(page, 'modal-equipamentos', page.locator('button', { hasText: '+ Novo equipamento' }).first(), true);
    });
    await isolado(page, 'modal-gaveta', () => verificarGaveta(page));
    await isolado(page, 'modal-tipos', async () => {
      await irPara(page, '/tipos-equipamento');
      await verificarModal(page, 'modal-tipos', page.locator('button', { hasText: '+ Novo tipo' }).first(), false);
    });
    await isolado(page, 'modal-monitoramento', async () => {
      await irPara(page, '/monitores');
      await verificarModal(page, 'modal-monitoramento', page.locator('.monitor-page__topo .botao--primario').first(), false);
    });
    await isolado(page, 'abas-relatorios', async () => {
      await irPara(page, '/relatorios');
      await verificarAbas(page);
    });
    await isolado(page, 'esqueleto', () => verificarEsqueleto(page));

    await trocarTema(page);
    checar('tema.claro', 'tema claro aplicado', (await temaAtual(page)) === 'claro');
    await capturarTodas(page, 'claro');
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
    await rodar(browser);
  } catch (e) { erro = e; } finally {
    fs.writeFileSync(path.join(OUT, 'resultados.json'), JSON.stringify({ fase: FASE, resultados, errosPagina, respostas5xx, erro: erro ? String(erro) : null }, null, 2));
    for (const r of resultados) console.log(`${r.ok ? (r.na ? 'N/A  ' : 'ok   ') : 'FALHA'} ${r.caso} — ${r.nome} ${r.detalhe}`);
    console.log(`aprovados: ${resultados.filter((r) => r.ok && !r.na).length}; N/A: ${resultados.filter((r) => r.na).length}; falhas: ${resultados.filter((r) => !r.ok).length}`);
    console.log(`erros de página: ${errosPagina.length}; respostas 5xx: ${respostas5xx.length}`);
    await browser.close();
  }
  if (erro) { console.error(erro); if (FASE === 'depois') process.exit(1); }
  // Em "depois", N/A também é falha, exceto notificacao-detalhe sem dados.
  if (FASE === 'depois' && (resultados.some((r) => !r.ok || (r.na && r.caso !== 'notificacao-detalhe')) || errosPagina.length || respostas5xx.length)) process.exit(1);
})();

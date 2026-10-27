/*
 * Manutenção agendada (F3) — histórico do botão manual no drawer e origem/rótulos das notificações novas, por clique.
 *
 *   MANUT_F3_EMAIL=... MANUT_F3_SENHA=... MANUT_F3_EQUIPAMENTO="Nome exato" MANUT_F3_SESSOES=2 \
 *   MANUT_F3_JANELA=<id da janela com MANUTENCAO_INICIADA> \
 *   [BASE=http://127.0.0.1:4300] [API_PORT=8083] [MANUT_F3_OUT=<pasta>] \
 *   npm run e2e:manutencao-agendada-f3
 *
 * Só LÊ: o roteiro pressupõe que o exercício pela API já gerou as janelas, as sessões manuais e as notificações
 * (Docs/validacao-producao/manutencao-agendada-f3.md, "Exercício no clone e e2e"). Nenhum POST/PATCH/PUT/DELETE.
 *
 * Fluxo (capturas numeradas):
 *  a. Equipamentos → busca → menu "Ver" → drawer: "Manutenção manual — histórico" com as sessões encerradas
 *     (período, duração, "Iniciada por … · encerrada por …").
 *  b. Telegram (histórico) → filtro EVENTO "Manutenção iniciada" → linha com origem "Janela #N" (link para /manutencoes).
 *  c. Filtro EVENTO "Manutenção manual iniciada" → "Ver detalhe" → origem "Manutenção manual · <equipamento>".
 *  d. Relatórios → aba Notificações → filtro EVENTO "Manutenção iniciada" → Consultar → rótulo novo e "Janela #N".
 *
 * ARMADILHAS herdadas (manutencao-agendada-f2.cjs):
 * 1. Sessão só em memória: depois do login, toda navegação é por clique.
 * 2. Nada de catch silencioso em seletor.
 * 3. Log de rede e resultado gravados em `finally`; sem cabeçalhos nem corpos.
 * 4. `unrouteAll({ behavior: 'ignoreErrors' })` antes de fechar o contexto quando API_PORT reescreve.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { apontarApi } = require('./api-porta.cjs');

const BASE = process.env.BASE || 'http://127.0.0.1:4300';
const EMAIL = process.env.MANUT_F3_EMAIL;
const SENHA = process.env.MANUT_F3_SENHA;
const EQUIPAMENTO = process.env.MANUT_F3_EQUIPAMENTO;
const SESSOES = Number(process.env.MANUT_F3_SESSOES || '0');
const JANELA = Number(process.env.MANUT_F3_JANELA || '0');
if (!EMAIL || !SENHA || !EQUIPAMENTO || !SESSOES || !JANELA) {
  throw new Error('MANUT_F3_EMAIL, MANUT_F3_SENHA, MANUT_F3_EQUIPAMENTO, MANUT_F3_SESSOES e MANUT_F3_JANELA são obrigatórias');
}

const OUT = process.env.MANUT_F3_OUT || path.join(__dirname, 'manutencao-agendada-f3-evidence');
fs.mkdirSync(OUT, { recursive: true });

const resultados = [];
const checar = (caso, nome, ok, detalhe) => {
  resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' });
  console.log(`${ok ? 'OK   ' : 'FALHA'} [${caso}] ${nome}${detalhe ? ' — ' + detalhe : ''}`);
};
const rede = [];
const capturas = [];
let n = 0;
const foto = async (page, nome) => {
  const arquivo = `${String(++n).padStart(2, '0')}-${nome}.png`;
  capturas.push(arquivo);
  await page.screenshot({ path: path.join(OUT, arquivo) });
};
const exato = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
const limpo = (s) => s.replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 }, deviceScaleFactor: 1 });
  const porta = await apontarApi(ctx);
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/')) rede.push(`${new Date().toISOString()} ${r.request().method()} ${r.status()} ${r.url().replace(/^.*\/api\/v1/, '')}`);
  });
  const esperarNotificacoes = () => page.waitForResponse((r) => r.request().method() === 'GET' && /\/api\/v1\/notificacoes(\?|$)/.test(r.url()), { timeout: 20000 });
  const filtroEvento = () => page.locator('.filters label', { hasText: 'EVENTO' }).locator('select');

  let fatal = null;
  try {
    // ================================================================ login
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
    checar('login', 'login concluído', !page.url().includes('/login'), `${page.url()} (API_PORT=${porta})`);

    // ================================================================ a. drawer — histórico manual
    await page.click('a[href="/equipamentos"]');
    await page.waitForURL(/\/equipamentos$/, { timeout: 20000 });
    await page.waitForSelector('table tbody tr', { timeout: 20000 });
    await page.fill('#busca-equipamentos', EQUIPAMENTO);
    const linhaEq = () => page.locator('table tbody tr').filter({ has: page.locator('.forte', { hasText: exato(EQUIPAMENTO) }) });
    await linhaEq().first().waitFor({ timeout: 10000 });
    const historico = page.waitForResponse((r) => r.request().method() === 'GET' && /\/api\/v1\/equipamentos\/\d+\/manutencoes-manuais/.test(r.url()) && r.status() === 200, { timeout: 20000 });
    await linhaEq().locator('.menu-acoes__gatilho').click();
    const ver = page.getByRole('menuitem', { name: 'Ver', exact: true });
    await ver.waitFor({ timeout: 5000 });
    await ver.click();
    await page.waitForSelector('.gaveta', { timeout: 15000 });
    const corpoHistorico = await (await historico).json();
    const secao = page.locator('.gaveta section', { has: page.locator('#titulo-manutencao-manual') });
    await secao.waitFor({ timeout: 10000 });
    checar('a-titulo', 'drawer tem "Manutenção manual — histórico"', limpo(await secao.locator('h3').innerText()) === 'Manutenção manual — histórico');
    const itens = secao.locator('ul.sessoes-manuais > li');
    await itens.first().waitFor({ timeout: 10000 });
    const total = await itens.count();
    checar('a-quantidade', `${SESSOES} sessões listadas (API: ${corpoHistorico.totalElements})`, total === SESSOES && corpoHistorico.totalElements === SESSOES, `tela ${total}`);
    const linhasA = [];
    for (let i = 0; i < total; i += 1) {
      const periodo = limpo(await itens.nth(i).locator('.sessoes-manuais__periodo').innerText());
      const duracao = limpo(await itens.nth(i).locator('.sessoes-manuais__duracao').innerText());
      const autoria = limpo(await itens.nth(i).locator('.sessoes-manuais__autoria').innerText());
      linhasA.push({ periodo, duracao, autoria });
      checar(`a-sessao-${i + 1}`, `sessão ${i + 1}: período fechado, duração e "Iniciada por … · encerrada por …"`,
        /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} até \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(periodo) && duracao.length > 0 && duracao !== '—'
          && /^Iniciada por .+ · encerrada por .+$/.test(autoria) && !autoria.includes('—'),
        `${periodo} | ${duracao} | ${autoria}`);
    }
    await secao.scrollIntoViewIfNeeded();
    await foto(page, 'drawer-historico-manual');
    await page.locator('.gaveta__fechar').click();
    await page.locator('.gaveta').waitFor({ state: 'detached', timeout: 10000 });

    // ================================================================ b. Notificações — evento "Manutenção iniciada"
    const lista0 = esperarNotificacoes();
    await page.click('a[href="/notificacoes"]');
    await page.waitForURL(/\/notificacoes\/historico$/, { timeout: 20000 });
    await lista0;
    const listaB = esperarNotificacoes();
    await filtroEvento().selectOption({ label: 'Manutenção iniciada' });
    const respB = await listaB;
    checar('b-filtro', 'filtro pede tipoEvento=MANUTENCAO_INICIADA', /tipoEvento=MANUTENCAO_INICIADA(&|$)/.test(respB.url()), respB.url().replace(/^.*\/api\/v1/, ''));
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const linhasB = page.locator('table tbody tr');
    const eventosB = (await linhasB.locator('td:nth-child(3) small').allInnerTexts()).map(limpo);
    checar('b-so-iniciada', 'toda linha filtrada tem o rótulo "Manutenção iniciada"', eventosB.length > 0 && eventosB.every((t) => t === 'Manutenção iniciada'), JSON.stringify(eventosB));
    const linhaJanela = linhasB.filter({ has: page.locator('td.mono a', { hasText: exato(`Janela #${JANELA}`) }) });
    checar('b-origem', `linha com origem "Janela #${JANELA}"`, (await linhaJanela.count()) === 1);
    const hrefB = await linhaJanela.locator('td.mono a').getAttribute('href');
    checar('b-link', 'origem é link para /manutencoes', hrefB === '/manutencoes', String(hrefB));
    await foto(page, 'notificacoes-filtro-manutencao-iniciada');

    // ================================================================ c. detalhe de uma MANUAL
    const listaC = esperarNotificacoes();
    await filtroEvento().selectOption({ label: 'Manutenção manual iniciada' });
    await listaC;
    await page.waitForSelector('table tbody tr', { timeout: 10000 });
    const origensC = (await page.locator('table tbody tr td.mono > span').allInnerTexts()).map(limpo);
    checar('c-lista-origem', `linhas da manual com origem "Manutenção manual · ${EQUIPAMENTO}"`,
      origensC.length === SESSOES && origensC.every((t) => t === limpo(`Manutenção manual · ${EQUIPAMENTO}`)), JSON.stringify(origensC));
    await foto(page, 'notificacoes-filtro-manual-iniciada');
    const detalhe = page.waitForResponse((r) => r.request().method() === 'GET' && /\/api\/v1\/notificacoes\/\d+$/.test(r.url()), { timeout: 20000 });
    await page.locator('table tbody tr').first().locator('button', { hasText: 'Ver detalhe' }).click();
    await page.waitForURL(/\/notificacoes\/detalhe\/\d+$/, { timeout: 20000 });
    await detalhe;
    await page.locator('#notification-title').waitFor({ timeout: 10000 });
    const ddManual = page.locator('dt', { hasText: exato('Manutenção manual') }).locator('xpath=following-sibling::dd[1]');
    const origemC = limpo(await ddManual.innerText());
    checar('c-detalhe-origem', `detalhe mostra "Manutenção manual · ${EQUIPAMENTO}"`, origemC === limpo(`Manutenção manual · ${EQUIPAMENTO}`), origemC);
    const eventoC = limpo(await page.locator('dt', { hasText: exato('Evento') }).locator('xpath=following-sibling::dd[1]').innerText());
    checar('c-detalhe-evento', 'evento "Manutenção manual iniciada"', eventoC === 'Manutenção manual iniciada', eventoC);
    const mensagemC = await page.locator('article.message p').innerText();
    checar('c-detalhe-mensagem', 'mensagem registrada é a do botão manual com o rodapé de fuso',
      mensagemC.startsWith('🔧 EQUIPAMENTO EM MANUTENÇÃO MANUAL — alertas suspensos') && mensagemC.trim().endsWith('Horários: UTC-03:00 (America/Sao_Paulo)'),
      limpo(mensagemC).slice(0, 80));
    await foto(page, 'notificacao-detalhe-manual');

    // ================================================================ d. Relatórios → Notificações
    await page.click('a[href="/relatorios"]');
    await page.waitForURL(/\/relatorios/, { timeout: 20000 });
    await page.getByRole('tab', { name: 'Notificações', exact: true }).click();
    const form = page.locator('form.filters', { has: page.locator('select[formcontrolname="tipoEvento"]') });
    await form.waitFor({ timeout: 10000 });
    const historicoD = page.waitForResponse((r) => r.request().method() === 'GET' && /\/api\/v1\/relatorios\/notificacoes/.test(r.url()) && /tipoEvento=MANUTENCAO_INICIADA/.test(r.url()), { timeout: 20000 });
    await form.locator('select[formcontrolname="tipoEvento"]').selectOption({ label: 'Manutenção iniciada' });
    const respD = await historicoD;
    checar('d-resposta', 'relatório de notificações por evento responde 200', respD.status() === 200, respD.url().replace(/^.*\/api\/v1/, ''));
    const tabelaD = page.locator('table', { has: page.locator('caption', { hasText: 'Histórico de notificações' }) });
    await tabelaD.locator('tbody tr').first().waitFor({ timeout: 10000 });
    const eventosD = (await tabelaD.locator('tbody tr td:nth-child(1)').allInnerTexts()).map(limpo);
    checar('d-rotulo', 'linhas com o rótulo novo "Manutenção iniciada"', eventosD.length > 0 && eventosD.every((t) => t === 'Manutenção iniciada'), JSON.stringify(eventosD));
    const origemD = tabelaD.locator('tbody tr td:nth-child(2) a', { hasText: exato(`Janela #${JANELA}`) });
    checar('d-origem', `origem "Janela #${JANELA}" com link para /manutencoes`, (await origemD.count()) === 1 && (await origemD.getAttribute('href')) === '/manutencoes');
    await foto(page, 'relatorios-notificacoes-manutencao-iniciada');

    checar('sem-erros', 'nenhum erro de página/console', erros.length === 0, erros.join(' | '));
  } catch (e) {
    fatal = e;
    checar('fatal', 'roteiro chegou ao fim', false, e.message);
    await foto(page, 'falha').catch(() => {});
  } finally {
    const falhas = resultados.filter((r) => !r.ok).length;
    fs.writeFileSync(path.join(OUT, 'manutencao-agendada-f3.json'), JSON.stringify({
      quando: new Date().toISOString(), base: BASE, apiPort: porta, equipamento: EQUIPAMENTO, sessoes: SESSOES, janela: JANELA,
      capturas, falhas, resultados, erros,
    }, null, 2));
    fs.writeFileSync(path.join(OUT, 'rede.json'), JSON.stringify(rede, null, 2));
    await ctx.unrouteAll({ behavior: 'ignoreErrors' });
    await ctx.close();
    await browser.close();
    console.log(`\n${resultados.length - falhas}/${resultados.length} OK`);
    process.exitCode = fatal || falhas ? 1 : 0;
  }
})();

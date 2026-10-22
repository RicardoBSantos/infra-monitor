/*
 * Manutenção pela interface de Equipamentos — fluxo completo por clique, com screenshots.
 *
 *   MANUT_UI_EMAIL=... MANUT_UI_SENHA=... MANUT_UI_EQUIPAMENTO="Nome exato" \
 *   [BASE=http://127.0.0.1:4201] [API_PORT=8082] [MANUT_UI_OUT=<pasta>] npm run e2e:manutencao-interface
 *
 * Fluxo: login → Equipamentos → busca → menu "…" → Iniciar manutenção → diálogo (texto + botão
 * primário) → confirmar → badge "Em manutenção" na linha → menu → Ver → drawer (badge + "Encerrar
 * manutenção") → Encerrar → diálogo → confirmar → badge de manutenção some.
 *
 * O equipamento precisa estar ATIVO e FORA de manutenção ao começar. O roteiro escreve no banco do
 * backend apontado (inicia e encerra uma manutenção de verdade): rodar só contra banco descartável
 * ou com aval para o banco alvo.
 *
 * ARMADILHAS herdadas (N04/M06/manutencao-verificacao):
 * 1. Sessão só em memória: depois do login, toda navegação é por clique.
 * 2. Nada de catch silencioso em seletor. A busca é `#busca-equipamentos`, não o placeholder
 *    (que casa também com a busca global do cabeçalho).
 * 3. Log de rede e resultado gravados em `finally`.
 * 4. `unrouteAll({ behavior: 'ignoreErrors' })` antes de fechar o contexto quando API_PORT reescreve.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { apontarApi } = require('./api-porta.cjs');

const BASE = process.env.BASE || 'http://127.0.0.1:4200';
const EMAIL = process.env.MANUT_UI_EMAIL;
const SENHA = process.env.MANUT_UI_SENHA;
const NOME = process.env.MANUT_UI_EQUIPAMENTO;
if (!EMAIL || !SENHA || !NOME) throw new Error('MANUT_UI_EMAIL, MANUT_UI_SENHA e MANUT_UI_EQUIPAMENTO são obrigatórias');

const OUT = process.env.MANUT_UI_OUT || path.join(__dirname, 'manutencao-interface-evidence');
fs.mkdirSync(OUT, { recursive: true });

const resultados = [];
const checar = (caso, nome, ok, detalhe) => {
  resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' });
  console.log(`${ok ? 'OK   ' : 'FALHA'} [${caso}] ${nome}${detalhe ? ' — ' + detalhe : ''}`);
};
const rede = [];
const instantes = {};
let n = 0;
const foto = (page, nome) => page.screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${nome}.png`) });

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

  const linha = () => page.locator('table tbody tr').filter({ has: page.locator('.forte', { hasText: new RegExp(`^${NOME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
  const dialogo = () => page.locator('app-confirm-dialog [role="alertdialog"]');
  const esperarPatch = (sufixo) => page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith(sufixo), { timeout: 20000 });

  let fatal = null;
  try {
    // ------------------------------------------------------------ login e navegação por clique
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
    checar('login', 'login concluído', !page.url().includes('/login'), `${page.url()} (API_PORT=${porta})`);

    await page.click('a[href="/equipamentos"]');
    await page.waitForURL(/\/equipamentos$/, { timeout: 20000 });
    await page.waitForSelector('table tbody tr', { timeout: 20000 });
    await page.fill('#busca-equipamentos', NOME);
    await linha().first().waitFor({ timeout: 10000 });
    checar('linha', 'equipamento encontrado na lista', (await linha().count()) === 1, `linhas=${await linha().count()}`);

    // ------------------------------------------------------------ iniciar pela lista
    await linha().locator('.menu-acoes__gatilho').click();
    const itemIniciar = page.getByRole('menuitem', { name: 'Iniciar manutenção' });
    await itemIniciar.waitFor({ timeout: 5000 });
    checar('menu-iniciar', 'menu da linha oferece "Iniciar manutenção" e não "Encerrar"',
      (await page.getByRole('menuitem', { name: 'Encerrar manutenção' }).count()) === 0);
    await foto(page, 'menu-iniciar');

    await itemIniciar.click();
    await dialogo().waitFor({ timeout: 5000 });
    const titulo = (await dialogo().locator('h2').innerText()).trim();
    const mensagem = (await dialogo().locator('p').first().innerText()).trim();
    checar('dialogo-iniciar-titulo', 'título do diálogo', titulo === `Iniciar manutenção de ${NOME}?`, titulo);
    checar('dialogo-iniciar-texto', 'mensagem diz os efeitos (ICMP, motivo Manutenção, aviso, relatório)',
      ['deixa de ser verificado por ICMP', 'encerrados com motivo Manutenção', 'aviso de encerramento', 'não conta no relatório de disponibilidade'].every((t) => mensagem.includes(t)), mensagem);
    const confirmar = dialogo().locator('button.botao--primario');
    checar('dialogo-iniciar-tom', 'botão de confirmar é primário, não perigo',
      (await confirmar.count()) === 1 && (await dialogo().locator('button.botao--perigo').count()) === 0);
    await foto(page, 'dialogo-iniciar');

    const patchIniciar = esperarPatch('/manutencao/iniciar');
    instantes.inicioClique = new Date().toISOString();
    await confirmar.click();
    const respIniciar = await patchIniciar;
    instantes.inicioResposta = new Date().toISOString();
    checar('patch-iniciar', 'PATCH /manutencao/iniciar 200', respIniciar.status() === 200, String(respIniciar.status()));
    await page.waitForSelector('.equipamentos__aviso', { timeout: 10000 });
    await linha().locator('app-status-badge', { hasText: 'Em manutenção' }).waitFor({ timeout: 10000 });
    checar('aviso-iniciar', 'aviso de sucesso', (await page.locator('.equipamentos__aviso').innerText()).trim() === `${NOME} em manutenção.`,
      (await page.locator('.equipamentos__aviso').innerText()).trim());
    checar('badge-lista', 'linha mostra o badge "Em manutenção"', (await linha().locator('app-status-badge').innerText()).trim() === 'Em manutenção');
    await foto(page, 'lista-em-manutencao');

    // ------------------------------------------------------------ drawer e encerrar por ele
    await linha().locator('.menu-acoes__gatilho').click();
    await page.getByRole('menuitem', { name: 'Ver' }).waitFor({ timeout: 5000 });
    checar('menu-encerrar', 'menu agora oferece "Encerrar manutenção" e não "Iniciar"',
      (await page.getByRole('menuitem', { name: 'Encerrar manutenção' }).count()) === 1
      && (await page.getByRole('menuitem', { name: 'Iniciar manutenção' }).count()) === 0);
    await foto(page, 'menu-encerrar');
    await page.getByRole('menuitem', { name: 'Ver' }).click();
    const gaveta = page.locator('aside.gaveta');
    await gaveta.waitFor({ timeout: 15000 });
    await gaveta.locator('header app-status-badge', { hasText: 'Em manutenção' }).waitFor({ timeout: 10000 });
    const botaoEncerrar = gaveta.locator('footer button', { hasText: 'Encerrar manutenção' });
    checar('drawer-badge', 'drawer mostra o badge "Em manutenção" no cabeçalho', true);
    checar('drawer-encerrar', 'rodapé do drawer oferece "Encerrar manutenção"', (await botaoEncerrar.count()) === 1);
    await foto(page, 'drawer-em-manutencao');

    await botaoEncerrar.click();
    await dialogo().waitFor({ timeout: 5000 });
    const tituloEnc = (await dialogo().locator('h2').innerText()).trim();
    const mensagemEnc = (await dialogo().locator('p').first().innerText()).trim();
    checar('dialogo-encerrar-titulo', 'título do diálogo de encerramento', tituloEnc === `Encerrar manutenção de ${NOME}?`, tituloEnc);
    checar('dialogo-encerrar-texto', 'mensagem diz que volta ao ICMP', mensagemEnc.includes('volta a ser verificado por ICMP na próxima varredura'), mensagemEnc);
    await foto(page, 'dialogo-encerrar');

    const patchEncerrar = esperarPatch('/manutencao/encerrar');
    instantes.fimClique = new Date().toISOString();
    await dialogo().locator('button.botao--primario').click();
    const respEncerrar = await patchEncerrar;
    instantes.fimResposta = new Date().toISOString();
    checar('patch-encerrar', 'PATCH /manutencao/encerrar 200', respEncerrar.status() === 200, String(respEncerrar.status()));
    await gaveta.locator('footer button', { hasText: 'Iniciar manutenção' }).waitFor({ timeout: 10000 });
    checar('drawer-pos-encerrar', 'drawer volta a oferecer "Iniciar manutenção" e perde o badge',
      (await gaveta.locator('header app-status-badge', { hasText: 'Em manutenção' }).count()) === 0);
    await foto(page, 'drawer-encerrada');

    // Regressão achada por este roteiro: com dois <button> em @if/@else o elemento focado era
    // destruído quando a lista recarregava, o foco caía no <body> e o Escape parava de fechar.
    await page.waitForTimeout(1000);
    const focoNaGaveta = await page.evaluate(() => !!document.activeElement?.closest('aside.gaveta'));
    checar('foco-na-gaveta', 'depois de encerrar pelo drawer o foco continua dentro da gaveta', focoNaGaveta,
      await page.evaluate(() => `${document.activeElement?.tagName} "${(document.activeElement?.textContent || '').trim().slice(0, 30)}"`));

    // O aviso vive na lista, atrás da gaveta: conferir ANTES de fechar. Fechar navega para a rota irmã
    // /equipamentos, que recria a lista e descarta o aviso (dívida conhecida: rotas de detalhe irmãs).
    const avisoEnc = (await page.locator('.equipamentos__aviso').innerText()).trim();
    checar('aviso-encerrar', 'aviso de encerramento', avisoEnc === `Manutenção de ${NOME} encerrada.`, avisoEnc);

    await page.keyboard.press('Escape');
    await gaveta.waitFor({ state: 'detached', timeout: 10000 });
    await page.fill('#busca-equipamentos', NOME);
    await linha().first().waitFor({ timeout: 10000 });
    const badgeFinal = (await linha().locator('app-status-badge').innerText()).trim();
    checar('badge-final', 'Escape fecha a gaveta e a linha não está mais em manutenção', badgeFinal !== 'Em manutenção', badgeFinal);
    await foto(page, 'lista-encerrada');

    checar('sem-erros', 'nenhum erro de página/console', erros.length === 0, erros.join(' | '));
  } catch (e) {
    fatal = e;
    checar('fatal', 'roteiro chegou ao fim', false, e.message);
    await foto(page, 'falha').catch(() => {});
  } finally {
    const falhas = resultados.filter((r) => !r.ok).length;
    fs.writeFileSync(path.join(OUT, 'manutencao-interface.json'), JSON.stringify({
      quando: new Date().toISOString(), base: BASE, apiPort: porta, equipamento: NOME, instantes, falhas, resultados, rede, erros,
    }, null, 2));
    await ctx.unrouteAll({ behavior: 'ignoreErrors' });
    await ctx.close();
    await browser.close();
    console.log(`\n${resultados.length - falhas}/${resultados.length} OK`);
    process.exitCode = fatal || falhas ? 1 : 0;
  }
})();

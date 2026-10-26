/*
 * Manutenção agendada (F1) — fluxo completo por clique, com capturas numeradas.
 *
 *   MANUT_AG_EMAIL=... MANUT_AG_SENHA=... MANUT_AG_UNIDADE="Nome exato" MANUT_AG_EQUIPAMENTO="Nome exato" \
 *   [BASE=http://127.0.0.1:4201] [API_PORT=8082] [MANUT_AG_OUT=<pasta>] npm run e2e:manutencao-agendada
 *
 * Fluxo: login → menu "Manutenções" → "+ Agendar manutenção" (captura do modal) → Escape fecha e o foco
 * volta ao botão → reabre → unidade, escopo Equipamentos selecionados, marca o equipamento, início no
 * próximo minuto cheio depois de agora + 90 s, fim = início + 30 min, motivo "E2E F1" → Agendar → aviso +
 * linha AGENDADA → recarrega pelo filtro (Histórico → Vigentes, por clique) até a linha virar ATIVA
 * (máx. 150 s) → Equipamentos → busca → legenda "Janela #N" → Manutenções → menu da linha → "Encerrar
 * agora" → diálogo com o texto de SLA (spec §3.2) → confirmar → Histórico → linha CONCLUÍDA.
 *
 * O backend apontado precisa estar com MANUTENCAO_AGENDADA_ENABLED=true (intervalo curto, ex. 5000 ms).
 * O equipamento precisa estar ATIVO, numa unidade ativa e FORA de manutenção. O roteiro escreve no banco
 * do backend apontado (agenda, ativa e encerra uma janela de verdade): só banco descartável ou com aval.
 *
 * ARMADILHAS herdadas (manutencao-interface.cjs):
 * 1. Sessão só em memória: depois do login, toda navegação é por clique.
 * 2. Nada de catch silencioso em seletor. A busca de equipamentos é `#busca-equipamentos`.
 * 3. Log de rede e resultado gravados em `finally`.
 * 4. `unrouteAll({ behavior: 'ignoreErrors' })` antes de fechar o contexto quando API_PORT reescreve.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { apontarApi } = require('./api-porta.cjs');

const BASE = process.env.BASE || 'http://127.0.0.1:4200';
const EMAIL = process.env.MANUT_AG_EMAIL;
const SENHA = process.env.MANUT_AG_SENHA;
const EQUIPAMENTO = process.env.MANUT_AG_EQUIPAMENTO;
const UNIDADE = process.env.MANUT_AG_UNIDADE;
if (!EMAIL || !SENHA || !EQUIPAMENTO || !UNIDADE) {
  throw new Error('MANUT_AG_EMAIL, MANUT_AG_SENHA, MANUT_AG_EQUIPAMENTO e MANUT_AG_UNIDADE são obrigatórias');
}
const ESPERA_ATIVA_MS = 150_000;
const TEXTO_SLA = 'Os equipamentos voltam a ser verificados na próxima varredura. O período desde o início da janela continua fora do relatório de disponibilidade: nele não houve medição, e encerrar não o devolve ao SLA. Equipamentos que também estão em manutenção manual continuam fora até ela ser encerrada.';

const OUT = process.env.MANUT_AG_OUT || path.join(__dirname, 'manutencao-agendada-evidence');
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
const exato = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
const p2 = (x) => String(x).padStart(2, '0');
const local = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;

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

  let janelaId = null;
  const botaoAgendar = () => page.locator('button', { hasText: '+ Agendar manutenção' });
  const modal = () => page.locator('app-modal section[role="dialog"]');
  const linhaJanela = () => page.locator('table tbody tr').filter({ has: page.locator('td.mono', { hasText: exato(`#${janelaId}`) }) });
  const situacao = async () => (await linhaJanela().locator('app-status-badge').innerText()).trim();
  const filtro = (nome) => page.locator('.segmento button', { hasText: nome });
  const dialogo = () => page.locator('app-confirm-dialog [role="alertdialog"]');
  const esperarLista = () => page.waitForResponse((r) => r.request().method() === 'GET' && /\/api\/v1\/manutencoes(\?|$)/.test(r.url()), { timeout: 20000 });
  const recarregarVigentes = async () => {
    await filtro('Histórico').click();
    await esperarLista();
    const lista = esperarLista();
    await filtro('Vigentes').click();
    await lista;
    await linhaJanela().first().waitFor({ timeout: 10000 });
  };

  let fatal = null;
  try {
    // ------------------------------------------------------------ login e navegação por clique
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
    checar('login', 'login concluído', !page.url().includes('/login'), `${page.url()} (API_PORT=${porta})`);

    await page.click('a[href="/manutencoes"]');
    await page.waitForURL(/\/manutencoes$/, { timeout: 20000 });
    await page.locator('h1', { hasText: 'Janelas de manutenção' }).waitFor({ timeout: 20000 });
    await botaoAgendar().waitFor({ timeout: 20000 });
    checar('banner-ausente', 'agendador ligado: sem banner de desligado', (await page.locator('.banner-agendador').count()) === 0);
    checar('botao-habilitado', '"+ Agendar manutenção" habilitado', await botaoAgendar().isEnabled());
    await foto(page, 'lista-vigentes');

    // ------------------------------------------------------------ modal: Escape e retorno de foco
    await botaoAgendar().click();
    await modal().waitFor({ timeout: 10000 });
    checar('modal-titulo', 'modal "Agendar manutenção" aberto', (await modal().locator('h2').innerText()).trim() === 'Agendar manutenção');
    await page.waitForTimeout(300);
    const focoAoAbrir = await page.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.getAttribute('formcontrolname') ?? ''}`.trim());
    checar('modal-foco-inicial', 'foco entra no primeiro campo (select Unidade)', focoAoAbrir === 'SELECT unidadeId', focoAoAbrir);
    await foto(page, 'modal-agendar');

    await page.keyboard.press('Escape');
    await modal().waitFor({ state: 'detached', timeout: 5000 });
    await page.waitForTimeout(200);
    const focoAposEscape = await page.evaluate(() => `${document.activeElement?.tagName} "${(document.activeElement?.textContent || '').trim()}"`);
    checar('modal-escape-foco', 'Escape fecha o modal e o foco volta ao "+ Agendar manutenção"',
      focoAposEscape === 'BUTTON "+ Agendar manutenção"', focoAposEscape);

    // ------------------------------------------------------------ agendar
    await botaoAgendar().click();
    await modal().waitFor({ timeout: 10000 });
    const selectUnidade = modal().locator('select[formcontrolname="unidadeId"]');
    await selectUnidade.locator('option', { hasText: exato(UNIDADE) }).waitFor({ state: 'attached', timeout: 10000 });
    await selectUnidade.selectOption({ label: UNIDADE });
    await modal().getByLabel('Equipamentos selecionados').check();
    const caixa = modal().locator('label.checagem__item', { hasText: exato(EQUIPAMENTO) }).locator('input[type="checkbox"]');
    await caixa.waitFor({ timeout: 10000 });
    await caixa.check();
    // Próximo minuto cheio depois de agora + 90 s: o campo é datetime-local (minutos), início entre 90 e 150 s.
    const inicio = new Date(Date.now() + 90_000);
    if (inicio.getSeconds() || inicio.getMilliseconds()) { inicio.setSeconds(0, 0); inicio.setMinutes(inicio.getMinutes() + 1); }
    const fim = new Date(inicio.getTime() + 30 * 60_000);
    instantes.inicioPrevistoLocal = local(inicio);
    instantes.fimPrevistoLocal = local(fim);
    await modal().locator('input[formcontrolname="inicio"]').fill(local(inicio));
    await modal().locator('input[formcontrolname="fim"]').fill(local(fim));
    await modal().locator('textarea[formcontrolname="motivo"]').fill('E2E F1');
    // A contagem é re-renderizada depois do evento: esperar o texto em vez de ler na hora (leitura imediata deu "0 de 21").
    await modal().locator('.escopo__contagem', { hasText: /^\s*1 de / }).waitFor({ timeout: 5000 });
    checar('modal-contagem', 'um equipamento selecionado', (await modal().locator('.escopo__contagem').innerText()).trim().startsWith('1 de '),
      (await modal().locator('.escopo__contagem').innerText()).trim());
    await foto(page, 'modal-preenchido');

    const post = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/manutencoes$/.test(r.url()), { timeout: 20000 });
    instantes.agendarClique = new Date().toISOString();
    await modal().locator('button[type="submit"]').click();
    const respPost = await post;
    checar('post', 'POST /manutencoes 201', respPost.status() === 201, String(respPost.status()));
    const corpo = await respPost.json();
    janelaId = corpo.id;
    await modal().waitFor({ state: 'detached', timeout: 10000 });
    const aviso = (await page.locator('.notice').innerText()).trim();
    checar('aviso-agendada', 'aviso "Janela #N agendada."', aviso.startsWith(`Janela #${janelaId} agendada.`), aviso);
    await linhaJanela().first().waitFor({ timeout: 10000 });
    checar('linha-agendada', 'linha da janela em AGENDADA', (await situacao()) === 'Agendada', await situacao());
    // Escopo mostra a contagem; os nomes ficam no title de `.escopo-lista`.
    const escopo = linhaJanela().locator('.escopo-lista');
    const escopoTexto = (await escopo.innerText()).trim();
    const escopoNomes = await escopo.getAttribute('title');
    checar('linha-escopo', 'escopo "1 equipamento" com o nome no title', escopoTexto === '1 equipamento' && escopoNomes === EQUIPAMENTO,
      `${escopoTexto} [title=${escopoNomes}]`);
    await foto(page, 'linha-agendada');

    // ------------------------------------------------------------ job ativa (recarga por clique)
    const limite = Date.now() + Math.max(ESPERA_ATIVA_MS, inicio.getTime() - Date.now() + 30_000);
    let rodadas = 0;
    while ((await situacao()) !== 'Ativa' && Date.now() < limite) {
      await page.waitForTimeout(5000);
      await recarregarVigentes();
      rodadas++;
    }
    instantes.ativaVistaEm = new Date().toISOString();
    checar('linha-ativa', 'o job ativou a janela (linha ATIVA)', (await situacao()) === 'Ativa', `${await situacao()} após ${rodadas} recargas`);
    await foto(page, 'linha-ativa');

    // ------------------------------------------------------------ Equipamentos: legenda da origem
    await page.click('a[href="/equipamentos"]');
    await page.waitForURL(/\/equipamentos$/, { timeout: 20000 });
    await page.waitForSelector('table tbody tr', { timeout: 20000 });
    await page.fill('#busca-equipamentos', EQUIPAMENTO);
    const linhaEq = page.locator('table tbody tr').filter({ has: page.locator('.forte', { hasText: exato(EQUIPAMENTO) }) });
    await linhaEq.first().waitFor({ timeout: 10000 });
    await linhaEq.locator('.equipamentos__origem').waitFor({ timeout: 10000 });
    const origem = (await linhaEq.locator('.equipamentos__origem').innerText()).trim();
    const badgeEq = (await linhaEq.locator('app-status-badge').first().innerText()).trim();
    checar('equipamento-badge', 'linha do equipamento em "Em manutenção"', badgeEq === 'Em manutenção', badgeEq);
    checar('equipamento-origem', `legenda "Janela #${janelaId}"`, origem === `Janela #${janelaId}`, origem);
    await foto(page, 'equipamento-janela');

    // ------------------------------------------------------------ Encerrar agora
    await page.click('a[href="/manutencoes"]');
    await page.waitForURL(/\/manutencoes$/, { timeout: 20000 });
    await linhaJanela().first().waitFor({ timeout: 20000 });
    await linhaJanela().locator('.menu-acoes__gatilho').click();
    const itemEncerrar = page.getByRole('menuitem', { name: 'Encerrar agora' });
    await itemEncerrar.waitFor({ timeout: 5000 });
    await foto(page, 'menu-encerrar');
    await itemEncerrar.click();
    await dialogo().waitFor({ timeout: 5000 });
    const titulo = (await dialogo().locator('h2').innerText()).trim();
    const mensagem = (await dialogo().locator('p').first().innerText()).trim();
    const botaoConfirmar = dialogo().locator('button.botao--primario');
    checar('dialogo-titulo', 'título do diálogo', titulo === `Encerrar agora a janela #${janelaId}?`, titulo);
    checar('dialogo-sla', 'mensagem é o texto de SLA da spec §3.2', mensagem === TEXTO_SLA, mensagem);
    checar('dialogo-botao', 'botão primário "Encerrar janela"', (await botaoConfirmar.innerText()).trim() === 'Encerrar janela');
    await foto(page, 'dialogo-encerrar');

    const encerrar = page.waitForResponse((r) => r.request().method() !== 'GET' && r.url().includes(`/api/v1/manutencoes/${janelaId}/`), { timeout: 20000 });
    instantes.encerrarClique = new Date().toISOString();
    await botaoConfirmar.click();
    const respEnc = await encerrar;
    checar('encerrar', 'encerrar 200', respEnc.status() === 200, `${respEnc.request().method()} ${respEnc.status()} ${respEnc.url().replace(/^.*\/api\/v1/, '')}`);
    await dialogo().waitFor({ state: 'detached', timeout: 10000 });
    const avisoEnc = (await page.locator('.notice').innerText()).trim();
    checar('aviso-encerrada', 'aviso "Janela #N encerrada."', avisoEnc === `Janela #${janelaId} encerrada.`, avisoEnc);

    const hist = esperarLista();
    await filtro('Histórico').click();
    await hist;
    await linhaJanela().first().waitFor({ timeout: 10000 });
    checar('linha-concluida', 'linha CONCLUÍDA no Histórico', (await situacao()) === 'Concluída', await situacao());
    await foto(page, 'historico-concluida');

    checar('sem-erros', 'nenhum erro de página/console', erros.length === 0, erros.join(' | '));
  } catch (e) {
    fatal = e;
    checar('fatal', 'roteiro chegou ao fim', false, e.message);
    await foto(page, 'falha').catch(() => {});
  } finally {
    const falhas = resultados.filter((r) => !r.ok).length;
    fs.writeFileSync(path.join(OUT, 'manutencao-agendada.json'), JSON.stringify({
      quando: new Date().toISOString(), base: BASE, apiPort: porta, unidade: UNIDADE, equipamento: EQUIPAMENTO, janelaId,
      instantes, falhas, resultados, rede, erros,
    }, null, 2));
    await ctx.unrouteAll({ behavior: 'ignoreErrors' });
    await ctx.close();
    await browser.close();
    console.log(`\n${resultados.length - falhas}/${resultados.length} OK`);
    process.exitCode = fatal || falhas ? 1 : 0;
  }
})();

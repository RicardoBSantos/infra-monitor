/*
 * Manutenção agendada (F2) — atalhos de agendamento, edição, alterar fim e continuação, por clique.
 *
 *   MANUT_F2_EMAIL=... MANUT_F2_SENHA=... MANUT_F2_UNIDADE="Nome exato" MANUT_F2_EQUIPAMENTO="Nome exato" \
 *   [BASE=http://127.0.0.1:4201] [API_PORT=8081] [MANUT_F2_ORIGEM_CORS=http://127.0.0.1:4200] [MANUT_F2_OUT=<pasta>] \
 *   npm run e2e:manutencao-agendada-f2
 *
 * Fluxo (capturas numeradas):
 *  1. Equipamentos → busca → menu da linha → "Agendar manutenção": unidade travada, equipamento marcado;
 *     Escape fecha e o foco volta ao gatilho "…" da linha; reabre e agenda (início = próximo minuto cheio
 *     + 3 min, 20 min de janela, motivo "E2E F2 linha").
 *  2. Drawer (menu "Ver") → "Agendar manutenção" → Escape → foco volta ao botão do drawer.
 *  3. Link da unidade → banner "Próxima: #N" → "Agendar manutenção" → unidade travada → marcar todos →
 *     dica "Todos marcados…" → Cancelar (sem POST).
 *  4. Manutenções → Editar #N (valores carregados) → motivo "E2E F2 editada", início ≈ agora + 90 s →
 *     Salvar → "Janela #N atualizada." + "editada por … às …"; foco no gatilho da linha.
 *  5. Espera a linha virar ATIVA (recarga por clique) → Alterar fim (Escape e foco) → +15 min, com um
 *     segundo operador mudando o fim pela API no meio (409 → "Fim atual atualizado; confira e envie de
 *     novo." → segundo envio passa) → "prorrogada por …".
 *  6. Alterar fim → antecipa para ≈ agora + 70 s → reabre o diálogo e espera o job concluir com ele
 *     aberto → novo fim → tela de continuação → "Agendar continuação" (modal pré-preenchido) → Agendar.
 *  7. Mapa → gaveta do equipamento → sem "Agendar manutenção".
 *  8. Limpeza: encerra/cancela, por clique, toda janela "E2E F2" que restar em Vigentes.
 *
 * O backend apontado precisa estar com MANUTENCAO_AGENDADA_ENABLED=true e intervalo curto (5000 ms).
 * O roteiro ESCREVE no banco do backend apontado: só banco descartável ou com aval.
 *
 * ARMADILHAS herdadas (manutencao-agendada.cjs):
 * 1. Sessão só em memória: depois do login, toda navegação é por clique.
 * 2. Nada de catch silencioso em seletor. A busca de equipamentos é `#busca-equipamentos`.
 * 3. Log de rede e resultado gravados em `finally`. O log NÃO guarda cabeçalhos nem corpos de pedido:
 *    o bearer capturado para o "segundo operador" só vive em memória.
 * 4. `unrouteAll({ behavior: 'ignoreErrors' })` antes de fechar o contexto quando API_PORT reescreve.
 * 5. O campo datetime-local tem grão de minuto: todo instante pedido é arredondado para cima.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { apontarApi } = require('./api-porta.cjs');

/*
 * MANUT_F2_ORIGEM_CORS (opcional): origem que o backend apontado aceita (ex. http://127.0.0.1:4200),
 * para quando o `ng serve` do roteiro roda numa porta fora de CORS_ALLOWED_ORIGINS (4201). Só mexe no
 * cabeçalho Origin do pedido refeito e no Access-Control-Allow-Origin da resposta; o resto é o backend real.
 */
async function apontarApiComOrigem(ctx, origem, paginaOrigem) {
  const porta = process.env.API_PORT || '8080';
  await ctx.route('http://localhost:8080/**', async (route) => {
    const req = route.request();
    const url = req.url().replace('localhost:8080', `localhost:${porta}`);
    const resposta = await route.fetch({ url, headers: { ...req.headers(), origin: origem } });
    const headers = { ...resposta.headers() };
    if (headers['access-control-allow-origin']) headers['access-control-allow-origin'] = paginaOrigem;
    await route.fulfill({ response: resposta, headers });
  });
  return porta;
}

const BASE = process.env.BASE || 'http://127.0.0.1:4200';
const EMAIL = process.env.MANUT_F2_EMAIL;
const SENHA = process.env.MANUT_F2_SENHA;
const EQUIPAMENTO = process.env.MANUT_F2_EQUIPAMENTO;
const UNIDADE = process.env.MANUT_F2_UNIDADE;
if (!EMAIL || !SENHA || !EQUIPAMENTO || !UNIDADE) {
  throw new Error('MANUT_F2_EMAIL, MANUT_F2_SENHA, MANUT_F2_EQUIPAMENTO e MANUT_F2_UNIDADE são obrigatórias');
}
const ESPERA_ATIVA_MS = 150_000;

const OUT = process.env.MANUT_F2_OUT || path.join(__dirname, 'manutencao-agendada-f2-evidence');
fs.mkdirSync(OUT, { recursive: true });

const resultados = [];
const checar = (caso, nome, ok, detalhe) => {
  resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' });
  console.log(`${ok ? 'OK   ' : 'FALHA'} [${caso}] ${nome}${detalhe ? ' — ' + detalhe : ''}`);
};
const rede = [];
const instantes = {};
const capturas = [];
let n = 0;
const foto = async (page, nome) => {
  const arquivo = `${String(++n).padStart(2, '0')}-${nome}.png`;
  capturas.push(arquivo);
  await page.screenshot({ path: path.join(OUT, arquivo) });
};
const exato = (s) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
const p2 = (x) => String(x).padStart(2, '0');
const local = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
/** Próximo minuto cheio a partir de `ms` (o campo datetime-local não tem segundos). */
const minutoCheioApos = (ms) => { const d = new Date(ms); if (d.getSeconds() || d.getMilliseconds()) { d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1); } return d; };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 980 }, deviceScaleFactor: 1 });
  const origemCors = process.env.MANUT_F2_ORIGEM_CORS;
  const porta = origemCors ? await apontarApiComOrigem(ctx, origemCors, new URL(BASE).origin) : await apontarApi(ctx);
  const API = `http://localhost:${porta}/api/v1`;
  const page = await ctx.newPage();
  const erros = [];
  let bearer = null;
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
  page.on('request', (r) => {
    const h = r.headers().authorization;
    if (h && r.url().includes('/api/v1/')) bearer = h;
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/')) rede.push(`${new Date().toISOString()} ${r.request().method()} ${r.status()} ${r.url().replace(/^.*\/api\/v1/, '')}`);
  });

  let janelaId = null;
  let continuacaoId = null;
  const modal = () => page.locator('app-modal section[role="dialog"]');
  const dialogo = () => page.locator('app-confirm-dialog [role="alertdialog"]');
  const linhaDe = (id) => page.locator('table tbody tr').filter({ has: page.locator('td.mono', { hasText: exato(`#${id}`) }) });
  const situacaoDe = async (id) => (await linhaDe(id).locator('app-status-badge').innerText()).trim();
  const filtro = (nome) => page.locator('.segmento button', { hasText: nome });
  const esperarLista = () => page.waitForResponse((r) => r.request().method() === 'GET' && /\/api\/v1\/manutencoes(\?|$)/.test(r.url()), { timeout: 20000 });
  const recarregarVigentes = async () => {
    await filtro('Histórico').click();
    await esperarLista();
    const lista = esperarLista();
    await filtro('Vigentes').click();
    await lista;
  };
  const foco = () => page.evaluate(() => {
    const a = document.activeElement;
    return {
      tag: a?.tagName ?? null,
      texto: (a?.textContent ?? '').trim().slice(0, 60),
      rotulo: a?.getAttribute('aria-label') ?? null,
      classe: typeof a?.className === 'string' ? a.className : '',
      naGaveta: !!a?.closest('.gaveta'),
      ehBody: a === document.body,
    };
  });
  const menuDaLinha = async (linha, item) => {
    await linha.locator('.menu-acoes__gatilho').click();
    const opcao = page.getByRole('menuitem', { name: item, exact: true });
    await opcao.waitFor({ timeout: 5000 });
    await opcao.click();
  };
  const apiGet = async (id) => {
    const r = await fetch(`${API}/manutencoes/${id}`, { headers: { Authorization: bearer } });
    if (!r.ok) throw new Error(`GET /manutencoes/${id} → ${r.status}`);
    return r.json();
  };

  let fatal = null;
  try {
    // ================================================================ login
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
    checar('login', 'login concluído', !page.url().includes('/login'), `${page.url()} (API_PORT=${porta})`);
    instantes.inicioExercicio = new Date().toISOString();

    // ================================================================ 1. Equipamentos, menu da linha
    const parametros = page.waitForResponse((r) => /\/api\/v1\/manutencoes\/parametros/.test(r.url()), { timeout: 20000 });
    await page.click('a[href="/equipamentos"]');
    await page.waitForURL(/\/equipamentos$/, { timeout: 20000 });
    await parametros;
    await page.waitForSelector('table tbody tr', { timeout: 20000 });
    await page.fill('#busca-equipamentos', EQUIPAMENTO);
    const linhaEq = () => page.locator('table tbody tr').filter({ has: page.locator('.forte', { hasText: exato(EQUIPAMENTO) }) });
    await linhaEq().first().waitFor({ timeout: 10000 });

    await menuDaLinha(linhaEq(), 'Agendar manutenção');
    await modal().waitFor({ timeout: 10000 });
    const selUnidade = () => modal().locator('select[formcontrolname="unidadeId"]');
    const caixaEq = () => modal().locator('label.checagem__item', { hasText: exato(EQUIPAMENTO) }).locator('input[type="checkbox"]');
    await selUnidade().locator('option', { hasText: exato(UNIDADE) }).waitFor({ state: 'attached', timeout: 10000 });
    await caixaEq().waitFor({ timeout: 10000 });
    const unidadeSel = await selUnidade().evaluate((s) => ({ texto: s.selectedOptions[0]?.textContent?.trim(), disabled: s.disabled }));
    checar('1-unidade-travada', 'modal da linha: unidade pré-selecionada e travada', unidadeSel.texto === UNIDADE && unidadeSel.disabled, JSON.stringify(unidadeSel));
    checar('1-equipamento-marcado', 'modal da linha: equipamento marcado', await caixaEq().isChecked());
    await foto(page, 'modal-da-linha');

    await page.keyboard.press('Escape');
    await modal().waitFor({ state: 'detached', timeout: 5000 });
    await page.waitForTimeout(200);
    const focoLinha = await foco();
    const gatilhoLinhaEq = await linhaEq().locator('.menu-acoes__gatilho').evaluate((b) => b === document.activeElement);
    checar('1-escape-foco', 'Escape fecha e o foco volta ao gatilho "…" da linha', gatilhoLinhaEq, JSON.stringify(focoLinha));

    await menuDaLinha(linhaEq(), 'Agendar manutenção');
    await modal().waitFor({ timeout: 10000 });
    await caixaEq().waitFor({ timeout: 10000 });
    const inicio1 = minutoCheioApos(Date.now());
    inicio1.setMinutes(inicio1.getMinutes() + 3);
    const fim1 = new Date(inicio1.getTime() + 20 * 60_000);
    instantes.agendada = { inicioLocal: local(inicio1), fimLocal: local(fim1) };
    await modal().locator('input[formcontrolname="inicio"]').fill(local(inicio1));
    await modal().locator('input[formcontrolname="fim"]').fill(local(fim1));
    await modal().locator('textarea[formcontrolname="motivo"]').fill('E2E F2 linha');
    const post1 = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/manutencoes$/.test(r.url()), { timeout: 20000 });
    await modal().locator('button[type="submit"]').click();
    const resp1 = await post1;
    checar('1-post', 'POST /manutencoes 201', resp1.status() === 201, String(resp1.status()));
    janelaId = (await resp1.json()).id;
    await modal().waitFor({ state: 'detached', timeout: 10000 });
    const avisoEq = page.locator('.equipamentos__aviso');
    await avisoEq.waitFor({ timeout: 5000 });
    const avisoEqTexto = (await avisoEq.innerText()).trim();
    checar('1-aviso', 'aviso "Janela #N agendada." em Equipamentos', avisoEqTexto.startsWith(`Janela #${janelaId} agendada.`), avisoEqTexto);
    await foto(page, 'linha-agendada-aviso');

    // ================================================================ 2. Drawer
    await menuDaLinha(linhaEq(), 'Ver');
    await page.waitForSelector('.gaveta', { timeout: 15000 });
    const botaoDrawer = page.locator('.gaveta__acoes button', { hasText: 'Agendar manutenção' });
    await botaoDrawer.waitFor({ timeout: 10000 });
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('.gaveta__acoes button')].find((x) => x.textContent.trim() === 'Agendar manutenção');
      return b && !b.disabled;
    }, null, { timeout: 10000 });
    await botaoDrawer.click();
    await modal().waitFor({ timeout: 10000 });
    await caixaEq().waitFor({ timeout: 10000 });
    const unidadeSel2 = await selUnidade().evaluate((s) => ({ texto: s.selectedOptions[0]?.textContent?.trim(), disabled: s.disabled }));
    checar('2-preset', 'modal do drawer: unidade travada e equipamento marcado', unidadeSel2.texto === UNIDADE && unidadeSel2.disabled && await caixaEq().isChecked(), JSON.stringify(unidadeSel2));
    await foto(page, 'modal-do-drawer');
    await page.keyboard.press('Escape');
    await modal().waitFor({ state: 'detached', timeout: 5000 });
    await page.waitForTimeout(400);
    const focoDrawer = await foco();
    checar('2-escape-foco', 'Escape fecha o modal e o foco volta ao botão do drawer', focoDrawer.naGaveta && focoDrawer.texto === 'Agendar manutenção', JSON.stringify(focoDrawer));
    checar('2-drawer-aberto', 'drawer continua aberto depois do Escape do modal', (await page.locator('.gaveta').count()) === 1);
    await page.locator('.gaveta__fechar').click();
    await page.locator('.gaveta').waitFor({ state: 'detached', timeout: 10000 });

    // ================================================================ 3. Unidade
    await linhaEq().first().waitFor({ timeout: 10000 });
    let postsAntes = rede.filter((l) => / POST 201 \/manutencoes$/.test(l)).length;
    await linhaEq().locator('button.link', { hasText: exato(UNIDADE) }).click();
    await page.waitForURL(/\/unidades\/\d+(\/visao-geral)?$/, { timeout: 20000 });
    const banner = page.locator('.banner-janela');
    await banner.waitFor({ timeout: 20000 });
    const bannerTexto = (await banner.innerText()).replace(/\s+/g, ' ').trim();
    checar('3-banner', `banner "Próxima: #${janelaId}"`, bannerTexto.includes(`Próxima: #${janelaId}`), bannerTexto);
    await foto(page, 'unidade-banner');
    const botaoUnidade = page.locator('.unidade-detalhe__acoes button', { hasText: 'Agendar manutenção' });
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('.unidade-detalhe__acoes button')].find((x) => x.textContent.trim() === 'Agendar manutenção');
      return b && !b.disabled;
    }, null, { timeout: 15000 });
    await botaoUnidade.click();
    await modal().waitFor({ timeout: 10000 });
    await modal().locator('label.checagem__item').first().waitFor({ timeout: 10000 });
    const unidadeSel3 = await selUnidade().evaluate((s) => ({ texto: s.selectedOptions[0]?.textContent?.trim(), disabled: s.disabled }));
    checar('3-unidade-travada', 'modal da unidade: unidade travada', unidadeSel3.texto === UNIDADE && unidadeSel3.disabled, JSON.stringify(unidadeSel3));
    const caixas = modal().locator('label.checagem__item input[type="checkbox"]');
    const total = await caixas.count();
    for (let i = 0; i < total; i += 1) await caixas.nth(i).check();
    const dica = modal().locator('.escopo__dica[role="note"]');
    await dica.waitFor({ timeout: 5000 });
    const dicaTexto = (await dica.innerText()).trim();
    checar('3-todos-marcados', `marcar os ${total} mostra a dica "Todos marcados…"`, total > 1 && dicaTexto.startsWith('Todos marcados.'), dicaTexto);
    await foto(page, 'unidade-todos-marcados');
    await modal().locator('.modal-form__rodape button', { hasText: exato('Cancelar') }).click();
    await modal().waitFor({ state: 'detached', timeout: 5000 });
    await page.waitForTimeout(300);
    const postsDepois = rede.filter((l) => / POST 201 \/manutencoes$/.test(l)).length;
    checar('3-cancelar', 'Cancelar não cria janela', postsDepois === postsAntes, `${postsAntes} → ${postsDepois}`);
    const focoUnidade = await foco();
    checar('3-cancelar-foco', 'foco volta ao "Agendar manutenção" da unidade', focoUnidade.texto === 'Agendar manutenção' && !focoUnidade.naGaveta, JSON.stringify(focoUnidade));

    // ================================================================ 4. Editar AGENDADA
    await page.click('a[href="/manutencoes"]');
    await page.waitForURL(/\/manutencoes$/, { timeout: 20000 });
    await linhaDe(janelaId).first().waitFor({ timeout: 20000 });
    const getEdicao = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().endsWith(`/api/v1/manutencoes/${janelaId}`), { timeout: 20000 });
    await menuDaLinha(linhaDe(janelaId), 'Editar');
    await modal().waitFor({ timeout: 10000 });
    await getEdicao;
    await caixaEq().waitFor({ timeout: 10000 });
    const tituloEd = (await modal().locator('h2').innerText()).trim();
    const motivoEd = await modal().locator('textarea[formcontrolname="motivo"]').inputValue();
    const inicioEd = await modal().locator('input[formcontrolname="inicio"]').inputValue();
    checar('4-carregada', 'edição abre com os valores da janela', tituloEd === `Editar janela #${janelaId}` && motivoEd === 'E2E F2 linha'
      && inicioEd === instantes.agendada.inicioLocal && await caixaEq().isChecked(), `${tituloEd} | ${motivoEd} | ${inicioEd}`);
    await foto(page, 'editar-carregada');

    await page.keyboard.press('Escape');
    await modal().waitFor({ state: 'detached', timeout: 5000 });
    await page.waitForTimeout(200);
    const focoEdEsc = await linhaDe(janelaId).locator('.menu-acoes__gatilho').evaluate((b) => b === document.activeElement);
    checar('4-escape-foco', 'Escape no Editar devolve o foco ao gatilho da linha', focoEdEsc, JSON.stringify(await foco()));

    const getEdicao2 = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().endsWith(`/api/v1/manutencoes/${janelaId}`), { timeout: 20000 });
    await menuDaLinha(linhaDe(janelaId), 'Editar');
    await modal().waitFor({ timeout: 10000 });
    await getEdicao2;
    await caixaEq().waitFor({ timeout: 10000 });
    const inicio4 = minutoCheioApos(Date.now() + 90_000);
    instantes.editada = { inicioLocal: local(inicio4) };
    await modal().locator('input[formcontrolname="inicio"]').fill(local(inicio4));
    await modal().locator('textarea[formcontrolname="motivo"]').fill('E2E F2 editada');
    const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith(`/api/v1/manutencoes/${janelaId}`), { timeout: 20000 });
    await modal().locator('button[type="submit"]').click();
    const respPut = await put;
    checar('4-put', 'PUT /manutencoes/{id} 200', respPut.status() === 200, String(respPut.status()));
    await modal().waitFor({ state: 'detached', timeout: 10000 });
    const aviso4 = (await page.locator('.notice').innerText()).trim();
    checar('4-aviso', `aviso "Janela #${janelaId} atualizada."`, aviso4 === `Janela #${janelaId} atualizada.`, aviso4);
    const alteracao4 = linhaDe(janelaId).locator('small.desvio--neutro', { hasText: /^editada por / });
    await alteracao4.waitFor({ timeout: 10000 });
    const alteracao4Texto = (await alteracao4.innerText()).trim();
    checar('4-editada-por', 'linha mostra "editada por … às …"', /^editada por .+ às \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(alteracao4Texto), alteracao4Texto);
    checar('4-motivo', 'motivo novo na linha', (await linhaDe(janelaId).locator('td.motivo').innerText()).trim() === 'E2E F2 editada');
    await page.waitForTimeout(300);
    const focoSalvar = await linhaDe(janelaId).locator('.menu-acoes__gatilho').evaluate((b) => b === document.activeElement);
    checar('4-salvar-foco', 'depois de salvar, o foco está no gatilho da linha', focoSalvar, JSON.stringify(await foco()));
    await foto(page, 'editada');

    // ================================================================ 5. ATIVA + prorrogar (com segundo operador)
    const limite = Date.now() + Math.max(ESPERA_ATIVA_MS, inicio4.getTime() - Date.now() + 30_000);
    let rodadas = 0;
    while ((await situacaoDe(janelaId)) !== 'Ativa' && Date.now() < limite) {
      await page.waitForTimeout(5000);
      await recarregarVigentes();
      await linhaDe(janelaId).first().waitFor({ timeout: 10000 });
      rodadas++;
    }
    instantes.ativaVistaEm = new Date().toISOString();
    checar('5-ativa', 'o job ativou a janela (linha ATIVA)', (await situacaoDe(janelaId)) === 'Ativa', `${await situacaoDe(janelaId)} após ${rodadas} recargas`);
    await foto(page, 'linha-ativa');

    const abrirAlterarFim = async (id) => {
      const g = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().endsWith(`/api/v1/manutencoes/${id}`), { timeout: 20000 });
      await menuDaLinha(linhaDe(id), 'Alterar fim');
      await modal().waitFor({ timeout: 10000 });
      return (await g).json();
    };
    await abrirAlterarFim(janelaId);
    checar('5-titulo', 'diálogo "Alterar fim da janela #N"', (await modal().locator('h2').innerText()).trim() === `Alterar fim da janela #${janelaId}`);
    await page.keyboard.press('Escape');
    await modal().waitFor({ state: 'detached', timeout: 5000 });
    await page.waitForTimeout(200);
    checar('5-escape-foco', 'Escape no Alterar fim devolve o foco ao gatilho da linha',
      await linhaDe(janelaId).locator('.menu-acoes__gatilho').evaluate((b) => b === document.activeElement), JSON.stringify(await foco()));

    const fresca5 = await abrirAlterarFim(janelaId);
    const fimUi = new Date(Date.parse(fresca5.fimPrevisto) + 15 * 60_000);
    await modal().locator('input[type="datetime-local"]').fill(local(fimUi));
    // Segundo operador: muda o fim pela API, com a versão atual, enquanto o diálogo está aberto.
    if (!bearer) throw new Error('nenhum Authorization capturado das requisições da página');
    const atual = await apiGet(janelaId);
    const fimApi = new Date(Date.parse(atual.fimPrevisto) + 10 * 60_000);
    const patch = await fetch(`${API}/manutencoes/${janelaId}/fim`, {
      method: 'PATCH', headers: { Authorization: bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fimPrevisto: fimApi.toISOString(), versao: atual.versao }),
    });
    instantes.segundoOperador = { em: new Date().toISOString(), status: patch.status, versaoAntes: atual.versao, fimApi: fimApi.toISOString() };
    checar('5-segundo-operador', 'PATCH do segundo operador pela API 200', patch.status === 200, `${patch.status} versao ${atual.versao}`);

    const envio409 = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith(`/api/v1/manutencoes/${janelaId}/fim`), { timeout: 20000 });
    await modal().locator('button[type="submit"]').click();
    const r409 = await envio409;
    checar('5-409', 'envio com versão velha → 409', r409.status() === 409, String(r409.status()));
    const erro409 = modal().locator('.rodape-erro');
    await erro409.waitFor({ timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('app-modal .rodape-erro')?.textContent?.trim() === 'Fim atual atualizado; confira e envie de novo.', null, { timeout: 10000 });
    const erro409Texto = (await erro409.innerText()).trim();
    const fimAtualMostrado = (await modal().locator('.fim-atual strong').innerText()).trim();
    checar('5-409-mensagem', 'mensagem "Fim atual atualizado; confira e envie de novo."', erro409Texto === 'Fim atual atualizado; confira e envie de novo.', `${erro409Texto} | fim atual: ${fimAtualMostrado}`);
    await foto(page, 'alterar-fim-409');

    const envio2 = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith(`/api/v1/manutencoes/${janelaId}/fim`), { timeout: 20000 });
    await modal().locator('button[type="submit"]').click();
    const r2 = await envio2;
    checar('5-reenvio', 'segundo envio passa (200)', r2.status() === 200, String(r2.status()));
    await modal().waitFor({ state: 'detached', timeout: 10000 });
    const aviso5 = (await page.locator('.notice').innerText()).trim();
    checar('5-aviso', 'aviso "Fim da janela #N alterado para …"', aviso5.startsWith(`Fim da janela #${janelaId} alterado para `), aviso5);
    const alteracao5 = linhaDe(janelaId).locator('small.desvio--neutro', { hasText: /^prorrogada por / });
    await alteracao5.waitFor({ timeout: 10000 });
    checar('5-prorrogada-por', 'linha mostra "prorrogada por …"', true, (await alteracao5.innerText()).trim());
    await page.waitForTimeout(300);
    checar('5-foco', 'depois do Alterar fim, o foco está no gatilho da linha',
      await linhaDe(janelaId).locator('.menu-acoes__gatilho').evaluate((b) => b === document.activeElement), JSON.stringify(await foco()));
    await foto(page, 'prorrogada');

    // ================================================================ 6. Continuação
    await abrirAlterarFim(janelaId);
    const fimAntecipado = minutoCheioApos(Date.now() + 70_000);
    instantes.antecipadoPara = fimAntecipado.toISOString();
    await modal().locator('input[type="datetime-local"]').fill(local(fimAntecipado));
    const envio6 = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith(`/api/v1/manutencoes/${janelaId}/fim`), { timeout: 20000 });
    await modal().locator('button[type="submit"]').click();
    const r6 = await envio6;
    checar('6-antecipar', 'antecipar o fim → 200', r6.status() === 200, String(r6.status()));
    await modal().waitFor({ state: 'detached', timeout: 10000 });
    const alteracao6 = linhaDe(janelaId).locator('small.desvio--neutro', { hasText: /^fim antecipado por / });
    await alteracao6.waitFor({ timeout: 10000 });
    checar('6-antecipado-por', 'linha mostra "fim antecipado por …"', true, (await alteracao6.innerText()).trim());

    await abrirAlterarFim(janelaId);
    instantes.dialogoAbertoEm = new Date().toISOString();
    // Espera com o diálogo aberto até o job concluir (no mínimo 90 s, e até 20 s depois do fim previsto).
    const espera = Math.max(90_000, fimAntecipado.getTime() - Date.now() + 20_000);
    instantes.esperaComDialogoMs = espera;
    await page.waitForTimeout(espera);
    const novoFim = minutoCheioApos(Date.now() + 30 * 60_000);
    await modal().locator('input[type="datetime-local"]').fill(local(novoFim));
    const envio6b = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().endsWith(`/api/v1/manutencoes/${janelaId}/fim`), { timeout: 20000 });
    const getConcluida = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().endsWith(`/api/v1/manutencoes/${janelaId}`), { timeout: 20000 });
    await modal().locator('button[type="submit"]').click();
    const r6b = await envio6b;
    checar('6-409-concluida', 'enviar depois da conclusão → 409', r6b.status() === 409, String(r6b.status()));
    const concluida = await (await getConcluida).json();
    instantes.concluida = { situacao: concluida.situacao, encerradaEm: concluida.encerradaEm };
    const continuacao = modal().locator('.continuacao p');
    await continuacao.waitFor({ timeout: 10000 });
    const continuacaoTexto = (await continuacao.innerText()).trim();
    checar('6-texto', 'tela "concluiu às … pingados por alguns segundos"',
      continuacaoTexto.startsWith(`A janela #${janelaId} concluiu às `) && continuacaoTexto.includes('pingados por alguns segundos'), continuacaoTexto);
    checar('6-titulo', `título "Janela #${janelaId} concluída"`, (await modal().locator('h2').innerText()).trim() === `Janela #${janelaId} concluída`);
    await page.waitForTimeout(200);
    const focoCont = await foco();
    checar('6-foco-continuar', 'foco no botão "Agendar continuação"', focoCont.texto === 'Agendar continuação', JSON.stringify(focoCont));
    await foto(page, 'continuacao');

    await modal().locator('button', { hasText: 'Agendar continuação' }).click();
    await page.locator('app-modal section[role="dialog"] h2', { hasText: exato('Agendar manutenção') }).waitFor({ timeout: 10000 });
    await caixaEq().waitFor({ timeout: 10000 });
    const unidadeSel6 = await selUnidade().evaluate((s) => ({ texto: s.selectedOptions[0]?.textContent?.trim(), disabled: s.disabled }));
    const motivo6 = await modal().locator('textarea[formcontrolname="motivo"]').inputValue();
    const fim6 = await modal().locator('input[formcontrolname="fim"]').inputValue();
    checar('6-preset', 'modal de continuação pré-preenchido (unidade travada, equipamento marcado, motivo, fim pedido)',
      unidadeSel6.texto === UNIDADE && unidadeSel6.disabled && await caixaEq().isChecked() && motivo6 === 'E2E F2 editada' && fim6 === local(novoFim),
      `${JSON.stringify(unidadeSel6)} | ${motivo6} | fim ${fim6}`);
    await foto(page, 'continuacao-modal');
    const post6 = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/manutencoes$/.test(r.url()), { timeout: 20000 });
    instantes.continuacaoClique = new Date().toISOString();
    await modal().locator('button[type="submit"]').click();
    const resp6 = await post6;
    checar('6-post', 'POST da continuação 201', resp6.status() === 201, String(resp6.status()));
    const corpo6 = await resp6.json();
    continuacaoId = corpo6.id;
    instantes.continuacao = { id: corpo6.id, situacao: corpo6.situacao, ativadaEm: corpo6.ativadaEm, inicioPrevisto: corpo6.inicioPrevisto };
    if (concluida.encerradaEm) {
      const ativ = corpo6.ativadaEm ?? null;
      instantes.lacunaContinuacaoS = ativ ? (Date.parse(ativ) - Date.parse(concluida.encerradaEm)) / 1000 : null;
    }
    await modal().waitFor({ state: 'detached', timeout: 10000 });
    const aviso6 = (await page.locator('.notice').innerText()).trim();
    checar('6-aviso', `aviso "Janela #${continuacaoId} agendada."`, aviso6.startsWith(`Janela #${continuacaoId} agendada.`), aviso6);
    await page.waitForTimeout(400);
    const focoAposCont = await foco();
    const focoAceito = !focoAposCont.ehBody && (focoAposCont.classe.includes('menu-acoes__gatilho')
      || focoAposCont.texto === '+ Agendar manutenção' || focoAposCont.tag === 'H1');
    checar('6-foco-final', 'depois da continuação o foco não cai no body (gatilho da linha, "+ Agendar manutenção" ou h1)', focoAceito, JSON.stringify(focoAposCont));
    await linhaDe(continuacaoId).first().waitFor({ timeout: 10000 });
    await foto(page, 'continuacao-agendada');

    // ================================================================ 7. Mapa (gaveta sem "Agendar manutenção")
    await page.click('a[href="/mapa"]');
    await page.waitForURL(/\/mapa$/, { timeout: 20000 });
    await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
    await page.waitForSelector('.map__unidade', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const totalMarcadores = await page.locator('.map__unidade').count();
    let alvoMapa = null;
    for (let i = 0; i < totalMarcadores && !alvoMapa; i += 1) {
      const nomeClicado = await page.evaluate((k) => {
        const m = document.querySelectorAll('.map__unidade')[k];
        m.click();
        return m.getAttribute('aria-label').split(':')[0].trim();
      }, i);
      await page.waitForFunction((nome) => (document.querySelector('.unit-panel__nome')?.textContent ?? '').trim() === nome
        && !document.querySelector('.unit-panel__vazio[role="status"]'), nomeClicado, { timeout: 15000 });
      const item = page.locator('.afetados__item').filter({ has: page.locator('.afetados__nome', { hasText: exato(EQUIPAMENTO) }) });
      if (await item.count()) alvoMapa = item.first();
    }
    checar('7-afetado', `"${EQUIPAMENTO}" aparece entre os afetados do painel da unidade`, !!alvoMapa);
    if (alvoMapa) {
      await alvoMapa.click();
      await page.waitForSelector('.gaveta', { timeout: 15000 });
      await page.waitForTimeout(800);
      const titulo7 = (await page.textContent('#drawer-equipamento-titulo')).trim();
      const botoes7 = (await page.locator('.gaveta__acoes .botao').allTextContents()).map((t) => t.trim());
      checar('7-sem-agendar', 'gaveta no Mapa sem "Agendar manutenção"', titulo7 === EQUIPAMENTO && !botoes7.includes('Agendar manutenção')
        && (await page.locator('.gaveta button', { hasText: 'Agendar manutenção' }).count()) === 0, `${titulo7}: ${JSON.stringify(botoes7)}`);
      await foto(page, 'mapa-gaveta');
      await page.locator('.gaveta__fechar').click();
      await page.locator('.gaveta').waitFor({ state: 'detached', timeout: 10000 });
    }

    // ================================================================ 8. Limpeza (por clique)
    await page.click('a[href="/manutencoes"]');
    await page.waitForURL(/\/manutencoes$/, { timeout: 20000 });
    await page.locator('table tbody tr, .feedback').first().waitFor({ timeout: 20000 });
    const limpas = [];
    for (let volta = 0; volta < 6; volta += 1) {
      const linhaE2e = page.locator('table tbody tr').filter({ has: page.locator('td.motivo', { hasText: /^\s*E2E F2/ }) }).first();
      if (!(await linhaE2e.count())) break;
      const id = Number((await linhaE2e.locator('td.mono').innerText()).trim().slice(1));
      const sit = (await linhaE2e.locator('app-status-badge').innerText()).trim();
      await menuDaLinha(linhaE2e, sit === 'Ativa' ? 'Encerrar agora' : 'Cancelar');
      await dialogo().waitFor({ timeout: 5000 });
      const acao = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/api/v1/manutencoes/${id}/`), { timeout: 20000 });
      const recarga = esperarLista();
      await dialogo().locator('button.botao--primario').click();
      const respAcao = await acao;
      await dialogo().waitFor({ state: 'detached', timeout: 10000 });
      await recarga;
      await page.waitForTimeout(300);
      limpas.push(`#${id} ${sit} → ${respAcao.status()}`);
      if (id === continuacaoId) {
        const f = await foco();
        checar('8-foco-encerrar', 'linha saiu de Vigentes: foco em "+ Agendar manutenção" ou h1, nunca no body',
          !f.ehBody && (f.texto === '+ Agendar manutenção' || f.tag === 'H1'), JSON.stringify(f));
      }
    }
    instantes.limpeza = limpas;
    await recarregarVigentes();
    await page.waitForTimeout(300);
    const restantes = await page.locator('table tbody tr').filter({ has: page.locator('td.motivo', { hasText: /^\s*E2E F2/ }) }).count();
    checar('8-limpeza', 'nenhuma janela "E2E F2" em Vigentes', restantes === 0, limpas.join('; ') || 'nada a limpar');
    await foto(page, 'vigentes-limpo');

    // Os dois 409 do PATCH /fim são provocados de propósito (passos 5 e 6) e o Chromium os registra como
    // "Failed to load resource". Descontam-se exatamente esses; qualquer outro erro conta.
    const esperados409 = rede.filter((l) => / PATCH 409 \/manutencoes\/\d+\/fim$/.test(l)).length;
    let descontar = esperados409;
    const inesperados = erros.filter((e) => !(/status of 409 \(Conflict\)/.test(e) && descontar-- > 0));
    checar('sem-erros', `nenhum erro de página/console além dos ${esperados409} 409 provocados`, inesperados.length === 0 && esperados409 === 2,
      inesperados.join(' | ') || `${erros.length} registros, todos 409 esperados`);
  } catch (e) {
    fatal = e;
    checar('fatal', 'roteiro chegou ao fim', false, e.message);
    await foto(page, 'falha').catch(() => {});
    // Rede de segurança só para execução interrompida: não deixa janela E2E viva no banco apontado.
    for (const id of [janelaId, continuacaoId].filter(Boolean)) {
      try {
        const j = await apiGet(id);
        const acao = j.situacao === 'ATIVA' ? 'encerrar' : j.situacao === 'AGENDADA' ? 'cancelar' : null;
        if (!acao) continue;
        const r = await fetch(`${API}/manutencoes/${id}/${acao}`, { method: 'PATCH', headers: { Authorization: bearer } });
        console.log(`limpeza de emergência: #${id} ${acao} → ${r.status}`);
        (instantes.limpezaEmergencia ??= []).push(`#${id} ${acao} → ${r.status}`);
      } catch (erroLimpeza) { console.log(`limpeza de emergência de #${id} falhou: ${erroLimpeza.message}`); }
    }
  } finally {
    bearer = null;
    const falhas = resultados.filter((r) => !r.ok).length;
    fs.writeFileSync(path.join(OUT, 'manutencao-agendada-f2.json'), JSON.stringify({
      quando: new Date().toISOString(), base: BASE, apiPort: porta, unidade: UNIDADE, equipamento: EQUIPAMENTO, janelaId, continuacaoId,
      instantes, capturas, falhas, resultados, rede, erros,
    }, null, 2));
    await ctx.unrouteAll({ behavior: 'ignoreErrors' });
    await ctx.close();
    await browser.close();
    console.log(`\n${resultados.length - falhas}/${resultados.length} OK`);
    process.exitCode = fatal || falhas ? 1 : 0;
  }
})();

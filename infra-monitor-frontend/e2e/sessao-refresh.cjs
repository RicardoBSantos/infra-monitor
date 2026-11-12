/* Prova em navegador real da sessão com refresh token (spec 2026-11-11-sessao-refresh-token-design.md).
 *
 * Passos:
 *   1 login pela tela
 *   2 page.reload() numa tela interna não volta ao login (sintoma 2)
 *   3 link direto (page.goto) para /equipamentos não volta ao login
 *   4 uso contínuo além do prazo do access token não volta ao login (sintoma 1)
 *   5 logout revoga: o cookie antigo, reenviado depois do Sair, é recusado (204)
 *   6 a sessão termina sozinha ao fim da duração: a próxima ação cai no login com "Sua sessão expirou"
 *
 * Pré-requisitos: backend DESCARTÁVEL (nunca o banco de dev nem o da carga; motor, Telegram, dispatcher e
 * agendador desligados) com JWT_ACCESS_TOKEN_MINUTES curto e JWT_REFRESH_TOKEN_DURATION curta, e o front
 * servido com o proxy (`API_PORT=<porta> npx ng serve --port 4310`).
 *
 * Variáveis:
 *   SESSAO_E2E_SENHA      obrigatória
 *   SESSAO_E2E_EMAIL      default admin@sessao.e2e
 *   SESSAO_E2E_BASE       default http://localhost:4310
 *   SESSAO_E2E_ACCESS_S   duração do access token em segundos (default 60)
 *   SESSAO_E2E_DURACAO_S  duração da sessão em segundos (default 240)
 *   SESSAO_E2E_USO_S      tempo de uso contínuo no passo 4 (default 150)
 *   SESSAO_E2E_PASSOS     passos a rodar, ex. "1,2,3,4" (default todos)
 *   SESSAO_E2E_API_ROTA   porta para onde redirecionar http://localhost:8080 (só para o front antigo,
 *                         que tem a apiUrl cravada; usado na prova de reversão)
 *   SESSAO_E2E_OUT        pasta de evidência (default e2e/sessao-refresh-evidence)
 */
const { chromium, request: playwrightRequest } = require('playwright');
const fs = require('fs'); const path = require('path');

const SENHA = process.env.SESSAO_E2E_SENHA;
const EMAIL = process.env.SESSAO_E2E_EMAIL || 'admin@sessao.e2e';
const BASE = (process.env.SESSAO_E2E_BASE || 'http://localhost:4310').replace(/\/$/, '');
const ACCESS_S = Number(process.env.SESSAO_E2E_ACCESS_S || 60);
const DURACAO_S = Number(process.env.SESSAO_E2E_DURACAO_S || 240);
const USO_S = Number(process.env.SESSAO_E2E_USO_S || 150);
const PASSOS = (process.env.SESSAO_E2E_PASSOS || '1,2,3,4,5,6').split(',').map(Number);
const ROTA = process.env.SESSAO_E2E_API_ROTA;
const OUT = process.env.SESSAO_E2E_OUT || path.join(__dirname, 'sessao-refresh-evidence');
const ROTAS = { Equipamentos: '/equipamentos', Unidades: '/unidades', Painel: '/dashboard', Incidentes: '/incidentes', Monitoramento: '/monitores', 'Manutenções': '/manutencoes' };
const MENU = Object.keys(ROTAS);

if (!SENHA) { console.error('SESSAO_E2E_SENHA é obrigatória'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const resultado = { base: BASE, inicio: new Date().toISOString(), config: { ACCESS_S, DURACAO_S, USO_S, PASSOS, ROTA: ROTA || null }, passos: [], refresh: [], idasAoLogin: [], erros: [] };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
function checar(passo, descricao, ok, detalhe) {
  resultado.passos.push({ passo, descricao, ok: !!ok, detalhe });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${passo}] ${descricao}${detalhe ? ' — ' + detalhe : ''}`);
}
const noLogin = (page) => new URL(page.url()).pathname.startsWith('/login');
const precisaLogin = (page) => !page.url().startsWith(BASE) || noLogin(page);

async function login(page) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-senha', SENHA);
  await page.click('.login-submit');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  return Date.now();
}
async function clicarMenu(page, rotulo) {
  if (noLogin(page)) return; // sessão já perdida: quem chamou registra a queda
  await page.locator('.sidebar .navigation__item', { hasText: rotulo }).first().click();
  // Espera a rota pedida ou o login (sessão perdida); sem isso um reload logo depois pega a rota anterior.
  await page.waitForURL((u) => u.pathname === ROTAS[rotulo] || u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle');
}
async function cookieDeSessao(ctx) { return (await ctx.cookies()).find((c) => c.name === 'inframonitor_refresh') || null; }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (ROTA) {
    await ctx.route('http://localhost:8080/**', async (route) => {
      const resposta = await route.fetch({ url: route.request().url().replace('localhost:8080', `localhost:${ROTA}`) });
      await route.fulfill({ response: resposta });
    });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => resultado.erros.push(e.message));
  page.on('framenavigated', (f) => { if (f === page.mainFrame() && new URL(f.url()).pathname.startsWith('/login')) resultado.idasAoLogin.push({ quando: new Date().toISOString(), url: f.url() }); });
  page.on('response', (r) => { if (r.url().includes('/api/v1/auth/refresh')) resultado.refresh.push({ quando: new Date().toISOString(), status: r.status() }); });
  const api = await playwrightRequest.newContext();
  const refreshCom = (valor) => api.post(BASE + '/api/v1/auth/refresh', { headers: { 'X-Requested-With': 'XMLHttpRequest', Cookie: `inframonitor_refresh=${valor}` } });

  try {
    // 1 ---------------------------------------------------------------------------------------- login
    if (PASSOS.includes(1)) {
      await login(page);
      const cookie = await cookieDeSessao(ctx);
      await page.screenshot({ path: path.join(OUT, '1-pos-login.png') });
      checar(1, 'login pela tela abre área interna e grava cookie httpOnly/Strict em /api/v1/auth', !noLogin(page) && cookie && cookie.httpOnly && cookie.sameSite === 'Strict' && cookie.path === '/api/v1/auth',
        cookie ? `url=${page.url()} httpOnly=${cookie.httpOnly} sameSite=${cookie.sameSite} path=${cookie.path} secure=${cookie.secure}` : `url=${page.url()} sem cookie`);
    }

    // 2 ---------------------------------------------------------------------------------------- F5
    if (PASSOS.includes(2)) {
      if (precisaLogin(page)) await login(page);
      await clicarMenu(page, 'Equipamentos');
      const antes = resultado.idasAoLogin.length; const refreshAntes = resultado.refresh.length;
      await page.reload({ waitUntil: 'networkidle' });
      await page.screenshot({ path: path.join(OUT, '2-pos-reload.png') });
      const refreshDoReload = resultado.refresh.slice(refreshAntes).map((r) => r.status);
      checar(2, 'page.reload() mantém a sessão na tela interna, sem passar pelo login', !noLogin(page) && resultado.idasAoLogin.length === antes && new URL(page.url()).pathname === '/equipamentos',
        `url=${page.url()} refresh=${JSON.stringify(refreshDoReload)}`);
    }

    // 3 ---------------------------------------------------------------------------------------- link direto
    if (PASSOS.includes(3)) {
      if (precisaLogin(page)) await login(page);
      const antes = resultado.idasAoLogin.length;
      await page.goto(BASE + '/unidades', { waitUntil: 'networkidle' });
      await page.screenshot({ path: path.join(OUT, '3-link-direto.png') });
      checar(3, 'page.goto(/unidades) depois do login abre a tela, sem login', !noLogin(page) && resultado.idasAoLogin.length === antes && new URL(page.url()).pathname === '/unidades', `url=${page.url()}`);
    }

    // 4 ---------------------------------------------------------------------------------------- uso contínuo
    if (PASSOS.includes(4)) {
      if (precisaLogin(page)) await login(page);
      const inicio = Date.now(); const antes = resultado.idasAoLogin.length; const refreshAntes = resultado.refresh.length;
      let i = 0; let caiu = null;
      while (Date.now() - inicio < USO_S * 1000) {
        await clicarMenu(page, MENU[i++ % MENU.length]);
        if (noLogin(page)) { caiu = Math.round((Date.now() - inicio) / 1000); break; }
        await esperar(15000);
      }
      await page.screenshot({ path: path.join(OUT, '4-pos-uso-continuo.png') });
      const renovacoes = resultado.refresh.slice(refreshAntes).filter((r) => r.status === 200).length;
      checar(4, `uso contínuo por ${USO_S}s (> ${ACCESS_S}s do access token) não derruba a sessão`, caiu === null && resultado.idasAoLogin.length === antes && renovacoes >= 1,
        caiu === null ? `cliques=${i} refresh200=${renovacoes}` : `caiu no login após ${caiu}s`);
    }

    // 5 ---------------------------------------------------------------------------------------- logout revoga
    if (PASSOS.includes(5)) {
      if (precisaLogin(page)) await login(page);
      const cookie = await cookieDeSessao(ctx);
      const controle = cookie ? await refreshCom(cookie.value) : null;
      await page.locator('button[aria-label="Sair da sessão"]').click();
      await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 15000 });
      const depois = cookie ? await refreshCom(cookie.value) : null;
      const corpo = depois ? await depois.text() : '';
      await page.reload({ waitUntil: 'networkidle' });
      checar(5, 'cookie antigo reenviado depois do Sair é recusado (204, sem token) e F5 continua no login',
        controle && controle.status() === 200 && depois.status() === 204 && !corpo.includes('accessToken') && noLogin(page),
        `antes=${controle && controle.status()} depois=${depois && depois.status()} corpo="${corpo.slice(0, 40)}" url=${page.url()}`);
    }

    // 6 ---------------------------------------------------------------------------------------- fim da jornada
    if (PASSOS.includes(6)) {
      const logado = await login(page);
      const alvo = logado + (DURACAO_S + 10) * 1000;
      console.log(`passo 6: aguardando ${Math.round((alvo - Date.now()) / 1000)}s até o fim da sessão`);
      while (Date.now() < alvo) await esperar(Math.min(20000, alvo - Date.now()));
      await clicarMenu(page, 'Equipamentos');
      await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => undefined);
      const aviso = await page.locator('text=Sua sessão expirou').count();
      await page.screenshot({ path: path.join(OUT, '6-fim-da-sessao.png') });
      checar(6, `depois de ${DURACAO_S}s a próxima ação vai ao login com "Sua sessão expirou"`, noLogin(page) && aviso > 0, `url=${page.url()} aviso=${aviso}`);
    }
  } catch (e) {
    resultado.erros.push('fatal: ' + (e && e.stack || e));
    console.error(e);
    await page.screenshot({ path: path.join(OUT, 'erro.png') }).catch(() => undefined);
  } finally {
    resultado.fim = new Date().toISOString();
    resultado.ok = resultado.passos.length === PASSOS.length && resultado.passos.every((p) => p.ok) && !resultado.erros.some((e) => e.startsWith('fatal'));
    fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(resultado, null, 2));
    await api.dispose(); await browser.close();
    console.log(resultado.ok ? 'RESULTADO: PASS' : 'RESULTADO: FAIL');
    process.exitCode = resultado.ok ? 0 : 1;
  }
})();

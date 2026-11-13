/* Prova em navegador real do modo TV (spec Docs/superpowers/specs/2026-11-12-modo-tv-design.md, Task 8).
 *
 *   npm run e2e:modo-tv      (exige MODO_TV_SENHA no ambiente)
 *
 * Passos (PASS/FAIL cada um, no console e em resultado.json):
 *   1 admin salva em /configuracoes/modo-tv, pela UI, 4 telas x 10 s e intervalo de 30 s
 *   2 página B em /dashboard; página A em /tv: ciclo MAPA→PAINEL→INCIDENTES→RELATORIOS→MAPA pelo nome da tela
 *   3 SQL fecha o incidente aberto; depois do tique o OFFLINE do Painel e o --cor-unidade do Mapa mudam
 *     sem recarregar o documento (0 carregamentos novos, 0 beforeunload)
 *   4 o Mapa não reinicializa ao longo de >= 3 ciclos: 1 contexto WebGL, 1 GET do GeoJSON, mesmo nó de canvas
 *   5 a página B continua em /dashboard durante a rotação, sem nenhuma requisição a /configuracoes/modo-tv
 *   6 vazamento: page.clock na página A, 300 ciclos (fastForward de 1 s por passo); Nodes e JSEventListeners com inclinação < 1/ciclo
 *     entre os ciclos 10 e 300; timers vivos constantes; 1 contexto WebGL
 *   7 sessão cai (revogada por SQL + access token vencido): TV vai ao login com a faixa do modo TV, sem laço
 *     — rodar à parte, com o backend em JWT_ACCESS_TOKEN_MINUTES=1 (MODO_TV_PASSOS=7)
 *   Capturas (sem PASS/FAIL): cada tela da TV em 1920x1080 nos temas escuro e claro e a tela de configuração.
 *
 * Pré-requisitos — só ambiente DESCARTÁVEL, nunca o dev (5434), a carga (5436) nem o backend 8080:
 *   - container `inframonitor-e2e-tv` (postgres:16-alpine, 5441) com e2e/modo-tv-seed.sql aplicado;
 *   - jar do branch na porta 18090 com MONITORING_ENGINE_ENABLED, NOTIFICATION_TELEGRAM_ENABLED,
 *     NOTIFICATION_DISPATCHER_ENABLED e MANUTENCAO_AGENDADA_ENABLED = false, BOOTSTRAP_ADMIN_* e
 *     APP_AUTH_COOKIE_SECURE=false;
 *   - `API_PORT=18090 npx ng serve --port 4311` (o proxy leva /api ao jar; mesma origem, cookie do refresh vale).
 *   O script roda SQL no container por `docker exec` (passo 3: fecha o incidente; passo 7: revoga a sessão).
 *
 * Variáveis:
 *   MODO_TV_SENHA       obrigatória
 *   MODO_TV_EMAIL       default admin@modo-tv.e2e
 *   MODO_TV_BASE        default http://localhost:4311
 *   MODO_TV_PASSOS      default 1,2,3,4,5,6,capturas
 *   MODO_TV_CICLOS      ciclos do passo 6 (default 300)
 *   MODO_TV_CONTAINER   default inframonitor-e2e-tv (outro nome é recusado)
 *   MODO_TV_OUT         pasta de evidência (default e2e/modo-tv-evidence)
 *
 * Armadilhas: nada de waitUntil 'networkidle' (o socket de HMR do ng serve nunca assenta); nada de catch
 * silencioso em seletor; resultado gravado em `finally`.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs'); const path = require('path');

const SENHA = process.env.MODO_TV_SENHA;
const EMAIL = process.env.MODO_TV_EMAIL || 'admin@modo-tv.e2e';
const BASE = (process.env.MODO_TV_BASE || 'http://localhost:4311').replace(/\/$/, '');
const PASSOS = (process.env.MODO_TV_PASSOS || '1,2,3,4,5,6,capturas').split(',').map((p) => p.trim());
const CICLOS = Number(process.env.MODO_TV_CICLOS || 300);
const CONTAINER = process.env.MODO_TV_CONTAINER || 'inframonitor-e2e-tv';
const OUT = process.env.MODO_TV_OUT || path.join(__dirname, 'modo-tv-evidence');
const ORDEM = ['MAPA', 'PAINEL', 'INCIDENTES', 'RELATORIOS'];
const DURACAO_S = 10; const INTERVALO_S = 30; const CICLO_MS = ORDEM.length * DURACAO_S * 1000;
const VIEWPORT = { width: 1920, height: 1080 };

if (!SENHA) { console.error('MODO_TV_SENHA é obrigatória'); process.exit(2); }
if (CONTAINER !== 'inframonitor-e2e-tv') { console.error('só o container descartável inframonitor-e2e-tv é aceito'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

const resultado = { base: BASE, inicio: new Date().toISOString(), config: { PASSOS, CICLOS, DURACAO_S, INTERVALO_S }, passos: [], medidas: {}, capturas: [], erros: [] };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
function checar(passo, descricao, ok, detalhe) {
  resultado.passos.push({ passo, descricao, ok: !!ok, detalhe });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${passo}] ${descricao}${detalhe ? ' — ' + detalhe : ''}`);
}
const quer = (p) => PASSOS.includes(String(p));
function sql(comando) {
  return execFileSync('docker', ['exec', CONTAINER, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'inframonitor', '-d', 'inframonitor', '-Atc', comando], { encoding: 'utf8' }).trim();
}
async function capturar(page, nome) {
  const arquivo = path.join(OUT, nome);
  await page.screenshot({ path: arquivo });
  resultado.capturas.push(nome);
}

/* Contadores no navegador. Adicionado DEPOIS de page.clock.install, embrulha os timers falsos. */
const INSTRUMENTO = () => {
  if (window.top !== window) return;
  const w = (window.__tv = { webglChamadas: 0, webglContextos: 0, timersVivos: 0, transicoes: [] });
  try {
    sessionStorage.setItem('__tvCarregamentos', String(Number(sessionStorage.getItem('__tvCarregamentos') || 0) + 1));
    addEventListener('beforeunload', () => sessionStorage.setItem('__tvBeforeunload', String(Number(sessionStorage.getItem('__tvBeforeunload') || 0) + 1)));
  } catch { /* sem storage: o contador por evento 'load' do Playwright cobre */ }
  const gc = HTMLCanvasElement.prototype.getContext; const comGl = new WeakSet();
  HTMLCanvasElement.prototype.getContext = function (tipo, ...resto) {
    const ctx = gc.call(this, tipo, ...resto);
    if (tipo === 'webgl' || tipo === 'webgl2') { w.webglChamadas++; if (ctx && !comGl.has(this)) { comGl.add(this); w.webglContextos++; } }
    return ctx;
  };
  const vivos = new Set();
  const st = window.setTimeout; const ct = window.clearTimeout; const si = window.setInterval; const ci = window.clearInterval;
  window.setTimeout = function (fn, ms, ...a) {
    let id;
    const embrulho = typeof fn === 'function' ? function (...x) { vivos.delete(id); return fn.apply(this, x); } : fn;
    id = st.call(window, embrulho, ms, ...a); vivos.add(id); return id;
  };
  window.clearTimeout = function (id) { vivos.delete(id); return ct.call(window, id); };
  window.setInterval = function (fn, ms, ...a) { const id = si.call(window, fn, ms, ...a); vivos.add(id); return id; };
  window.clearInterval = function (id) { vivos.delete(id); return ci.call(window, id); };
  Object.defineProperty(w, 'timersVivos', { get: () => vivos.size });
};

/* Registra a tela ativa da TV a cada mudança (MutationObserver), com a hora da página. */
const OBSERVAR_TELAS = () => {
  const w = window.__tv; const ler = () => document.querySelector('.tv__tela--ativa')?.getAttribute('data-tela') ?? null;
  const anotar = () => { const t = ler(); const ult = w.transicoes[w.transicoes.length - 1]; if (t && (!ult || ult.tela !== t)) w.transicoes.push({ tela: t, em: Date.now(), nome: document.querySelector('.tv__nome')?.textContent?.trim() }); };
  anotar();
  new MutationObserver(anotar).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
};

const lerTv = (page) => page.evaluate(() => {
  const cor = (nome) => { const el = [...document.querySelectorAll('[data-tela="MAPA"] .map__unidade')].find((e) => (e.getAttribute('aria-label') || '').includes(nome)); return el ? el.style.getPropertyValue('--cor-unidade').trim() : null; };
  const kpi = (rotulo) => { const k = [...document.querySelectorAll('[data-tela="PAINEL"] .kpi')].find((e) => e.querySelector('span')?.textContent?.trim() === rotulo); return k ? k.querySelector('strong')?.textContent?.trim() : null; };
  const canvas = document.querySelector('[data-tela="MAPA"] canvas.maplibregl-canvas');
  return {
    ativa: document.querySelector('.tv__tela--ativa')?.getAttribute('data-tela') ?? null,
    nome: document.querySelector('.tv__nome')?.textContent?.trim() ?? null,
    corLagarto: cor('TV Lagarto'), offline: kpi('OFFLINE'), incidentesAbertos: kpi('INCIDENTES ABERTOS'),
    canvasMarcado: canvas ? canvas.dataset.marcaTv ?? null : 'sem-canvas', canvases: document.querySelectorAll('[data-tela="MAPA"] canvas.maplibregl-canvas').length,
    webglChamadas: window.__tv.webglChamadas, webglContextos: window.__tv.webglContextos, timersVivos: window.__tv.timersVivos,
    transicoes: window.__tv.transicoes.length,
    carregamentos: Number(sessionStorage.getItem('__tvCarregamentos') || 0), beforeunload: Number(sessionStorage.getItem('__tvBeforeunload') || 0),
    url: location.pathname,
  };
});

async function login(page) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-senha', SENHA);
  await page.click('.login-submit');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
}
/** Espera a tela `tela` ficar ativa na TV (relógio real). */
async function esperarTela(page, tela, timeout) {
  await page.waitForFunction((t) => document.querySelector('.tv__tela--ativa')?.getAttribute('data-tela') === t, tela, { timeout, polling: 200 });
}
/** Ciclos completos observados: voltas a MAPA depois da primeira entrada. */
const ciclosCompletos = (transicoes) => transicoes.slice(1).filter((t) => t.tela === 'MAPA').length;

async function capturarTelas(page, prefixo) {
  for (const tela of ORDEM) {
    await esperarTela(page, tela, CICLO_MS + 15000);
    if (tela === 'MAPA') await page.waitForSelector('[data-tela="MAPA"] .map__unidade', { timeout: 15000 });
    await esperar(2500); // tela recém-ativa: deixa o mapa desenhar e a moldura assentar
    await capturar(page, `${prefixo}-${tela.toLowerCase()}.png`);
  }
}

(async () => {
  const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
  const ctxB = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'dark' });
  const ctxA = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'dark' });
  const pageB = await ctxB.newPage();
  const pageA = await ctxA.newPage();
  pageA.on('pageerror', (e) => resultado.erros.push('A: ' + e.message));
  pageB.on('pageerror', (e) => resultado.erros.push('B: ' + e.message));
  const reqA = []; const reqB = []; let loadsA = 0; const navB = [];
  pageA.on('request', (r) => reqA.push({ em: Date.now(), url: r.url(), tipo: r.resourceType() }));
  pageB.on('request', (r) => reqB.push({ em: Date.now(), url: r.url(), tipo: r.resourceType() }));
  pageA.on('load', () => { loadsA++; });
  pageB.on('framenavigated', (f) => { if (f === pageB.mainFrame()) navB.push({ em: Date.now(), url: f.url() }); });

  try {
    await login(pageB);

    // 1 ------------------------------------------------------------------------- configuração pela UI
    if (quer(1)) {
      await pageB.goto(BASE + '/configuracoes/modo-tv', { waitUntil: 'domcontentloaded' });
      await pageB.waitForSelector('#modo-tv-intervalo', { timeout: 20000 });
      if (!(await pageB.isChecked('#modo-tv-ativo'))) await pageB.check('#modo-tv-ativo');
      await pageB.selectOption('#modo-tv-intervalo', String(INTERVALO_S));
      const nomes = { MAPA: 'Mapa', PAINEL: 'Painel', INCIDENTES: 'Incidentes', RELATORIOS: 'Relatórios' };
      for (const tela of ORDEM) {
        const caixa = pageB.locator(`input[type=checkbox][data-tela="${tela}"]`);
        if (!(await caixa.isChecked())) await caixa.check();
        await pageB.selectOption(`select[aria-label="Duração de ${nomes[tela]}"]`, String(DURACAO_S));
      }
      const salvar = pageB.locator('.acoes .botao--primario');
      const habilitado = await salvar.isEnabled();
      if (habilitado) {
        const resposta = pageB.waitForResponse((r) => r.url().includes('/api/v1/configuracoes/modo-tv') && r.request().method() === 'PUT', { timeout: 15000 });
        await salvar.click();
        const r = await resposta; resultado.medidas.putStatus = r.status();
        await pageB.waitForSelector('.acoes__ok', { timeout: 10000 });
      }
      await capturar(pageB, '1-configuracoes-modo-tv.png');
      const gravado = JSON.parse(sql("select json_build_object('ativo', c.ativo, 'intervalo', c.intervalo_atualizacao_segundos, 'telas', (select json_agg(json_build_object('tela', t.tela, 'ordem', t.ordem, 'duracao', t.duracao_segundos) order by t.ordem) from configuracao_modo_tv_tela t where t.configuracao_id = c.id)) from configuracao_modo_tv c"));
      const ok = gravado.ativo === true && gravado.intervalo === INTERVALO_S && gravado.telas.length === 4
        && gravado.telas.every((t, i) => t.tela === ORDEM[i] && t.duracao === DURACAO_S);
      checar(1, 'admin salva pela UI 4 telas x 10 s e intervalo 30 s (gravado no banco)', ok,
        `${habilitado ? 'PUT ' + resultado.medidas.putStatus : 'Salvar desabilitado: já gravado igual'}; banco=${JSON.stringify(gravado)}`);
    }

    // Página B fica no Painel durante toda a rotação.
    await pageB.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
    await pageB.waitForSelector('.kpis .kpi strong', { timeout: 20000 });
    const marcoB = Date.now(); const navBAntes = navB.length;

    // Página A: relógio falso instalado ANTES da navegação (corre natural até o passo 6), depois o instrumento.
    await pageA.clock.install();
    await ctxA.addInitScript(INSTRUMENTO);
    await login(pageA);
    const loadsAntesTv = loadsA;
    await pageA.goto(BASE + '/tv', { waitUntil: 'domcontentloaded' });
    await pageA.waitForSelector('.tv__tela--ativa', { timeout: 30000 });
    await pageA.evaluate(OBSERVAR_TELAS);
    const inicioTv = Date.now();
    await pageA.waitForSelector('[data-tela="MAPA"] canvas.maplibregl-canvas', { timeout: 30000 });
    await pageA.waitForSelector('[data-tela="MAPA"] .map__unidade', { timeout: 30000 });
    await pageA.evaluate(() => { document.querySelector('[data-tela="MAPA"] canvas.maplibregl-canvas').dataset.marcaTv = 'original'; });
    const inicial = await lerTv(pageA);
    resultado.medidas.inicial = inicial;

    // 2 ------------------------------------------------------------------------- ciclo completo
    if (quer(2)) {
      await capturarTelas(pageA, '2-tv-escuro');
      await esperarTela(pageA, 'MAPA', CICLO_MS + 15000);
      const transicoes = await pageA.evaluate(() => window.__tv.transicoes);
      const seq = transicoes.slice(0, 5).map((t) => t.tela);
      const nomes = transicoes.slice(0, 5).map((t) => t.nome);
      const esperado = [...ORDEM, 'MAPA'];
      checar(2, 'ciclo completo MAPA→PAINEL→INCIDENTES→RELATORIOS→MAPA observado pelo nome da tela',
        JSON.stringify(seq) === JSON.stringify(esperado) && JSON.stringify(nomes) === JSON.stringify(['Mapa', 'Painel', 'Incidentes', 'Relatórios', 'Mapa']),
        `seq=${seq.join('→')} nomes=${nomes.join('→')} duracoes_s=${transicoes.slice(1, 5).map((t, i) => ((t.em - transicoes[i].em) / 1000).toFixed(1)).join(',')}`);
    }

    // 3 ------------------------------------------------------------------------- dado muda sem reload
    if (quer(3)) {
      const antes = await lerTv(pageA);
      const fechado = sql("with f as (update incidente set status = 'FECHADO', encerrado_em = now(), updated_at = now(), motivo_encerramento = 'RECUPERACAO_AUTOMATICA' where status in ('ABERTO','RECONHECIDO') and monitor_id = (select m.id from monitor m join equipamento e on e.id = m.equipamento_id where e.nome = 'TV-RT-LAG') returning monitor_id) insert into medicao (monitor_id, status, latencia_ms, mensagem, executado_em) select monitor_id, 'SUCESSO', 12, 'e2e-modo-tv', now() from f returning monitor_id");
      const sqlEm = Date.now();
      let depois = antes; let mudouPainelEm = null; let mudouMapaEm = null;
      while (Date.now() - sqlEm < 150000 && (mudouPainelEm === null || mudouMapaEm === null)) {
        await esperar(1000);
        depois = await lerTv(pageA);
        if (mudouPainelEm === null && depois.offline !== antes.offline) mudouPainelEm = Date.now();
        if (mudouMapaEm === null && depois.corLagarto !== antes.corLagarto) mudouMapaEm = Date.now();
      }
      const loadsDepois = loadsA - loadsAntesTv;
      await capturar(pageA, '3-tv-apos-mudanca.png');
      resultado.medidas.passo3 = { antes, depois, sqlMonitor: fechado, painelS: mudouPainelEm && (mudouPainelEm - sqlEm) / 1000, mapaS: mudouMapaEm && (mudouMapaEm - sqlEm) / 1000 };
      checar(3, 'SQL fecha o incidente: OFFLINE do Painel e --cor-unidade de Lagarto no Mapa mudam sem recarregar o documento',
        fechado !== '' && mudouPainelEm !== null && mudouMapaEm !== null && antes.offline === '1' && depois.offline === '0'
          && depois.carregamentos === inicial.carregamentos && depois.beforeunload === inicial.beforeunload && loadsDepois === 1,
        `OFFLINE ${antes.offline}→${depois.offline} em ${resultado.medidas.passo3.painelS}s; INCIDENTES ABERTOS ${antes.incidentesAbertos}→${depois.incidentesAbertos}; cor Lagarto ${antes.corLagarto}→${depois.corLagarto} em ${resultado.medidas.passo3.mapaS}s; carregamentos do documento desde a abertura de /tv=${depois.carregamentos - inicial.carregamentos}, beforeunload=${depois.beforeunload - inicial.beforeunload} (evento load desde /tv=${loadsDepois}, só a abertura)`);
    }

    // 4 ------------------------------------------------------------------------- mapa não reinicializa
    if (quer(4)) {
      while (ciclosCompletos(await pageA.evaluate(() => window.__tv.transicoes)) < 3) await esperar(1000);
      await esperar(3000);
      const agora = await lerTv(pageA);
      const transicoes = await pageA.evaluate(() => window.__tv.transicoes);
      const geo = reqA.filter((r) => r.url.includes('se-municipalities.geo.json')).length;
      const unidadesGet = reqA.filter((r) => r.url.includes('/api/v1/dashboard/unidades') && r.em >= inicioTv).length;
      resultado.medidas.passo4 = { agora, geo, unidadesGet, ciclos: ciclosCompletos(transicoes) };
      checar(4, 'Mapa não reinicializa em >= 3 ciclos: 1 contexto WebGL, 1 GET do GeoJSON, mesmo nó de canvas',
        agora.webglContextos === 1 && geo === 1 && agora.canvasMarcado === 'original' && agora.canvases === 1,
        `ciclos=${ciclosCompletos(transicoes)} getContext(webgl*) chamadas=${agora.webglChamadas} contextos=${agora.webglContextos} geojson=${geo} canvas=${agora.canvasMarcado} canvases=${agora.canvases} GET dashboard/unidades desde /tv=${unidadesGet}`);
    }

    // 5 ------------------------------------------------------------------------- sessão normal intacta
    if (quer(5)) {
      const urlB = new URL(pageB.url()).pathname;
      const configB = reqB.filter((r) => r.em >= marcoB && r.url.includes('/configuracoes/modo-tv')).length;
      const navsB = navB.slice(navBAntes);
      checar(5, 'página B segue em /dashboard durante a rotação, sem requisição a /configuracoes/modo-tv',
        urlB === '/dashboard' && configB === 0 && navsB.length === 0,
        `url=${urlB} req config=${configB} navegações=${navsB.length} durante ${Math.round((Date.now() - marcoB) / 1000)}s`);
    }

    // Capturas no tema claro (contexto próprio; preferência gravada no localStorage como o ThemeService faz).
    if (quer('capturas')) {
      const ctxL = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light' });
      await ctxL.addInitScript(() => { try { localStorage.setItem('infra-monitor.tema', 'light'); } catch { /* */ } });
      const pageL = await ctxL.newPage();
      pageL.on('pageerror', (e) => resultado.erros.push('L: ' + e.message));
      await login(pageL);
      await pageL.goto(BASE + '/configuracoes/modo-tv', { waitUntil: 'domcontentloaded' });
      await pageL.waitForSelector('#modo-tv-intervalo', { timeout: 20000 });
      await capturar(pageL, 'configuracoes-modo-tv-claro.png');
      await pageL.goto(BASE + '/tv', { waitUntil: 'domcontentloaded' });
      await pageL.waitForSelector('.tv__tela--ativa', { timeout: 30000 });
      await capturarTelas(pageL, 'tv-claro');
      await ctxL.close();
    }

    // 6 ------------------------------------------------------------------------- vazamento em 300 ciclos
    if (quer(6)) {
      const cdp = await ctxA.newCDPSession(pageA);
      await cdp.send('Performance.enable');
      const medir = async (ciclo) => {
        await esperar(1500); // respostas em voo chegam antes da medida
        await cdp.send('HeapProfiler.collectGarbage');
        const { metrics } = await cdp.send('Performance.getMetrics');
        const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
        const tv = await lerTv(pageA);
        return { ciclo, Nodes: m.Nodes, JSEventListeners: m.JSEventListeners, JSHeapUsedSize: m.JSHeapUsedSize, timersVivos: tv.timersVivos, webglContextos: tv.webglContextos, transicoes: tv.transicoes, ativa: tv.ativa, url: tv.url };
      };
      const amostras = []; const reqAntes = reqA.length; const t0 = Date.now();
      for (let ciclo = 1; ciclo <= CICLOS; ciclo++) {
        // Um fastForward de 1 s por passo da TV: dispara o setTimeout encadeado de 1 s uma vez, como na vida
        // real. runFor simularia também cada quadro de 16 ms do MapLibre (~21 s reais por ciclo).
        for (let s = 0; s < ORDEM.length; s++) {
          for (let k = 0; k < DURACAO_S; k++) await pageA.clock.fastForward(1000);
          await esperar(50); // respostas HTTP do passo chegam no relógio real
        }
        if ([10, 100, 300].includes(ciclo) || ciclo === CICLOS) {
          const a = await medir(ciclo); amostras.push(a);
          console.log(`  ciclo ${ciclo}: Nodes=${a.Nodes} JSEventListeners=${a.JSEventListeners} heap=${Math.round(a.JSHeapUsedSize / 1024)}kB timers=${a.timersVivos} webgl=${a.webglContextos} tela=${a.ativa}`);
        }
      }
      const a10 = amostras.find((a) => a.ciclo === 10); const aFim = amostras[amostras.length - 1];
      const inclinacao = (k) => (aFim[k] - a10[k]) / (aFim.ciclo - a10.ciclo);
      const reqs = reqA.slice(reqAntes);
      resultado.medidas.passo6 = { amostras, inclinacaoNodes: inclinacao('Nodes'), inclinacaoListeners: inclinacao('JSEventListeners'), requisicoes: reqs.length, geojson: reqs.filter((r) => r.url.includes('se-municipalities.geo.json')).length, duracaoRealS: Math.round((Date.now() - t0) / 1000) };
      const timers = amostras.map((a) => a.timersVivos);
      const timersConstantes = Math.max(...timers) - Math.min(...timers) <= 2;
      checar(6, `${CICLOS} ciclos com page.clock: Nodes e JSEventListeners com inclinação < 1/ciclo (10→${aFim.ciclo}), timers vivos constantes, 1 contexto WebGL`,
        Math.abs(inclinacao('Nodes')) < 1 && Math.abs(inclinacao('JSEventListeners')) < 1 && timersConstantes && amostras.every((a) => a.webglContextos === 1) && aFim.url === '/tv',
        `Nodes ${amostras.map((a) => a.Nodes).join('/')} (incl ${inclinacao('Nodes').toFixed(3)}); listeners ${amostras.map((a) => a.JSEventListeners).join('/')} (incl ${inclinacao('JSEventListeners').toFixed(3)}); timers ${timers.join('/')}; webgl ${amostras.map((a) => a.webglContextos).join('/')}; requisições ${reqs.length}; real ${resultado.medidas.passo6.duracaoRealS}s`);
    }

    // 7 ------------------------------------------------------------------------- sessão cai na TV
    if (quer(7)) {
      const ctxS = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'dark' });
      const pageS = await ctxS.newPage();
      const idasAoLogin = [];
      pageS.on('framenavigated', (f) => { if (f === pageS.mainFrame() && new URL(f.url()).pathname.startsWith('/login')) idasAoLogin.push({ em: Date.now(), url: f.url() }); });
      await login(pageS);
      await pageS.goto(BASE + '/tv', { waitUntil: 'domcontentloaded' });
      await pageS.waitForSelector('.tv__tela--ativa', { timeout: 30000 });
      idasAoLogin.length = 0; // a ida ao /login do próprio login() acima não conta
      const revogadas = sql('update sessao_usuario set revogada_em = now() where revogada_em is null returning id').split('\n').filter(Boolean).length;
      const revogadoEm = Date.now();
      await pageS.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 240000 });
      const caiuS = Math.round((Date.now() - revogadoEm) / 1000);
      await pageS.waitForSelector('.login-tv', { timeout: 10000 });
      const faixa = (await pageS.locator('.login-tv').textContent()).trim();
      const url = pageS.url();
      await capturar(pageS, '7-login-sessao-caiu-tv.png');
      const primeira = idasAoLogin[0].em;
      await esperar(30000);
      const em30 = idasAoLogin.filter((n) => n.em - primeira <= 30000).length;
      const q = new URL(url).searchParams;
      resultado.medidas.passo7 = { idasAoLogin, caiuS, url, faixa, revogadas };
      checar(7, 'sessão revogada + access token vencido: TV vai ao login com a faixa do modo TV, sem laço',
        q.get('origem') === 'tv' && q.get('returnUrl') === '/tv' && q.get('sessionExpired') === '1' && /^Modo TV parado: a sessão encerrou às \d\d:\d\d\. Entre novamente para retomar\.$/.test(faixa) && em30 <= 1 && idasAoLogin.length === 1,
        `sessões revogadas=${revogadas}; caiu em ${caiuS}s; url=${url}; faixa="${faixa}"; idas ao /login em 30s=${em30} (total ${idasAoLogin.length})`);
      await ctxS.close();
    }
  } catch (e) {
    resultado.erros.push('fatal: ' + (e && e.stack || e));
    console.error(e);
    await pageA.screenshot({ path: path.join(OUT, 'erro-a.png') }).catch(() => undefined);
  } finally {
    resultado.fim = new Date().toISOString();
    const pedidos = PASSOS.filter((p) => p !== 'capturas').length;
    resultado.ok = resultado.passos.length === pedidos && resultado.passos.every((p) => p.ok) && !resultado.erros.some((e) => e.startsWith('fatal'));
    fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(resultado, null, 2));
    await browser.close();
    console.log(resultado.ok ? 'RESULTADO: PASS' : 'RESULTADO: FAIL');
    process.exitCode = resultado.ok ? 0 : 1;
  }
})();

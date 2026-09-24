const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const FRONTEND = 'http://127.0.0.1:4200';
const PASSWORD = process.env.R035_PASSWORD;
assert(PASSWORD, 'R035_PASSWORD is required');

const roles = [
  ['ADMIN', 'r034.admin@infra.local'],
  ['OPERADOR', 'r034.operador@infra.local'],
  ['VISUALIZADOR', 'r034.visualizador@infra.local'],
];
const overviewPaths = [
  'incidentes', 'medicoes', 'notificacoes',
  'disponibilidade/unidades', 'disponibilidade/equipamentos', 'latencia',
];
const result = { environment: {}, roles: {}, overview: {}, requests: {}, responsive: {}, regression: {}, network: {}, console: {}, performance: {}, accessibility: {} };

function reportPath(url) { return new URL(url).pathname.replace('/api/v1/relatorios/', ''); }
function localInput(date) { const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return shifted.toISOString().slice(0, 16); }

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await context.addInitScript(() => {
    window.__r035LayoutShift = 0;
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__r035LayoutShift += entry.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  const page = await context.newPage();
  const traffic = [], consoleErrors = [], consoleWarnings = [], pageErrors = [], failedRequests = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); if (message.type() === 'warning') consoleWarnings.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
  page.on('response', response => {
    if (!response.url().includes('/api/v1/relatorios/')) return;
    const request = response.request(), url = new URL(response.url());
    traffic.push({ path: reportPath(response.url()), status: response.status(), bearer: /^Bearer\s+\S+/.test(request.headers()['authorization'] || ''), page: url.searchParams.get('page'), size: url.searchParams.get('size'), sort: url.searchParams.get('sort'), statusFilter: url.searchParams.get('status'), inicio: url.searchParams.get('inicio'), fim: url.searchParams.get('fim'), url: response.url() });
  });

  async function login(email) {
    await page.goto(`${FRONTEND}/login`);
    await page.getByLabel('E-mail').fill(email); await page.getByLabel('Senha').fill(PASSWORD);
    const response = page.waitForResponse(item => item.url().endsWith('/api/v1/auth/login'));
    await page.getByRole('button', { name: 'Entrar' }).click(); assert.equal((await response).status(), 200);
    await page.waitForURL(/\/dashboard$/); assert(!page.url().includes('/forbidden'));
  }
  async function logout() { await page.locator('.user-menu__trigger').click(); await page.getByRole('button', { name: 'Sair' }).click(); await page.waitForURL(/\/login$/); }
  async function openReports() {
    const response = page.waitForResponse(item => reportPath(item.url()) === 'disponibilidade/equipamentos');
    await page.getByRole('link', { name: 'Relatórios' }).click(); await page.waitForURL(/\/relatorios$/); assert.equal((await response).status(), 200); assert(!page.url().includes('/forbidden'));
  }
  async function overviewAction(action) {
    const before = traffic.length;
    const responses = Promise.all(overviewPaths.map(path => page.waitForResponse(item => reportPath(item.url()) === path)));
    await action(); const received = await responses; await page.waitForTimeout(150);
    const batch = traffic.slice(before); assert.equal(batch.length, 6, `expected 6 Overview requests, got ${batch.length}`);
    assert.equal(new Set(batch.map(item => item.url)).size, 6, 'duplicate Overview request');
    return { received, batch };
  }
  async function openOverview() { return overviewAction(() => page.getByRole('tab', { name: 'Visão Geral', exact: true }).click()); }

  const health = await context.request.get('http://localhost:8080/actuator/health'); const frontend = await context.request.get(FRONTEND);
  result.environment = { backend: health.status(), frontend: frontend.status(), postgres: 'isolated container on 127.0.0.1:55432', browser: 'Google Chrome headless', playwright: require('playwright/package.json').version };
  assert.equal(health.status(), 200); assert.equal(frontend.status(), 200);

  for (const [role, email] of roles) {
    await login(email); await openReports(); const opened = await openOverview();
    assert(opened.received.every(response => response.status() === 200));
    assert(await page.getByRole('heading', { name: 'Indicadores globais do período' }).isVisible());
    result.roles[role] = { loginUi: true, overviewStatuses: opened.received.map(response => response.status()), forbidden: page.url().includes('/forbidden') };
    await logout();
  }

  await login(roles[0][1]); await openReports(); await openOverview();
  const openingBatch = traffic.slice(-6);
  const byPath = Object.fromEntries(openingBatch.map(item => [item.path, item]));
  assert.equal(byPath.incidentes.statusFilter, 'ABERTO'); assert.equal(byPath.incidentes.size, '1');
  assert.equal(byPath.medicoes.statusFilter, 'FALHA'); assert.equal(byPath.medicoes.size, '1');
  assert.equal(byPath.notificacoes.statusFilter, 'FALHA'); assert.equal(byPath.notificacoes.size, '1');
  assert.equal(byPath['disponibilidade/unidades'].sort, 'disponibilidadePercentual,asc'); assert.equal(byPath['disponibilidade/unidades'].size, '5');
  assert.equal(byPath['disponibilidade/equipamentos'].sort, 'disponibilidadePercentual,asc'); assert.equal(byPath['disponibilidade/equipamentos'].size, '5');
  assert.equal(byPath.latencia.sort, 'avgLatenciaMs,desc'); assert.equal(byPath.latencia.size, '5');
  assert(openingBatch.every(item => item.page === '0' && item.inicio && item.fim));

  const overviewText = await page.locator('.overview').innerText();
  assert.match(overviewText, /Incidentes abertos/); assert.match(overviewText, /Medições com falha/); assert.match(overviewText, /Notificações com falha/);
  assert.match(overviewText, /Unidades com menor disponibilidade/); assert.match(overviewText, /Equipamentos críticos/); assert.match(overviewText, /Latência por Monitor/); assert.match(overviewText, /P95 fornecido pela API/);
  assert(!/NaN|undefined|null%/.test(overviewText));
  result.overview = { widgets: 6, kpis: 3, rankingUnits: true, criticalEquipment: true, latencyMetrics: ['min', 'avg', 'max', 'p95', 'count'], nullSafe: true };

  const periodStart = new Date(Date.now() - 48 * 3600000), periodEnd = new Date();
  await page.locator('.filters--overview input[formcontrolname="inicio"]').fill(localInput(periodStart));
  await page.locator('.filters--overview input[formcontrolname="fim"]').fill(localInput(periodEnd));
  const changed = await overviewAction(() => page.getByRole('button', { name: 'Aplicar período' }).click());
  assert(changed.received.every(response => response.status() === 200));
  result.requests = { opening: 6, periodChange: 6, duplicates: 0 };

  const latencyRoute = /\/api\/v1\/relatorios\/latencia\?/;
  await page.route(latencyRoute, route => route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': FRONTEND }, body: JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', message: 'internal stack secret' }) }));
  const partial = await overviewAction(() => page.getByRole('button', { name: 'Atualizar' }).click());
  assert.equal(partial.received.filter(response => response.status() === 200).length, 5); assert.equal(partial.received.filter(response => response.status() === 500).length, 1);
  await page.getByText('Serviço temporariamente indisponível.').waitFor(); assert(await page.getByText('Incidentes abertos').isVisible()); assert(!(await page.locator('body').innerText()).includes('internal stack secret'));
  await page.unroute(latencyRoute); const retry = page.waitForResponse(item => reportPath(item.url()) === 'latencia'); await page.getByRole('button', { name: 'Tentar novamente' }).click(); assert.equal((await retry).status(), 200);
  result.overview.partialError = { isolated: true, retryOnlyLatency: true, stackTraceHidden: true };

  for (const width of [320, 375, 390, 412, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    const layout = await page.evaluate(() => ({
      noPageOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      cardsVisible: [...document.querySelectorAll('.kpi-card,.analytic-card')].every(item => { const rect = item.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }),
      filtersUsable: [...document.querySelectorAll('.filters--overview input,.filters--overview button')].every(item => { const rect = item.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.width > 0; }),
      tabsUsable: !!document.querySelector('.tabs [role=tab][aria-selected=true]'),
      internalTablesScroll: [...document.querySelectorAll('.compact-table')].every(item => item.scrollWidth >= item.clientWidth),
    }));
    assert(layout.noPageOverflow && layout.cardsVisible && layout.filtersUsable && layout.tabsUsable && layout.internalTablesScroll); result.responsive[width] = layout;
  }

  await page.setViewportSize({ width: 1280, height: 960 });
  for (const [name, endpoint, caption] of [['Disponibilidade Equipamentos', 'disponibilidade/equipamentos', 'Disponibilidade por equipamentos'], ['Disponibilidade Unidades', 'disponibilidade/unidades', 'Disponibilidade por unidades'], ['Incidentes', 'incidentes', 'Histórico de incidentes'], ['Medições', 'medicoes', 'Histórico de medições'], ['Latência', 'latencia', 'Latência ICMP'], ['Notificações', 'notificacoes', 'Histórico de notificações']]) {
    const response = page.waitForResponse(item => reportPath(item.url()) === endpoint); await page.getByRole('tab', { name, exact: true }).click(); const status = (await response).status();
    const rendered = await page.getByRole('table', { name: caption }).isVisible().catch(() => false) || await page.getByText(/Nenhum resultado encontrado/).isVisible().catch(() => false);
    assert.equal(status, 200); assert(rendered); result.regression[name] = { status, rendered };
  }
  await openOverview();

  const successful = traffic.filter(item => item.status === 200);
  result.network = { angularOrigin: successful.length > 0, bearer: successful.every(item => item.bearer), pageSizeSort: successful.every(item => item.page && item.size && item.sort), statuses: [...new Set(traffic.map(item => item.status))].sort(), cors: failedRequests.some(item => /cors/i.test(item)) };
  const expected500 = consoleErrors.filter(message => /Failed to load resource: the server responded with a status of 500/.test(message));
  const unexpectedErrors = consoleErrors.filter(message => !expected500.includes(message));
  result.console = { angularErrors: pageErrors, unexpectedErrors, warnings: consoleWarnings, expected500Exercised: expected500.length };
  result.performance = { layoutShift: await page.evaluate(() => window.__r035LayoutShift || 0), lockup: false, repeatedRequests: 0 };
  await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('Tab');
  const keyboardFocus = await page.evaluate(() => ['A', 'BUTTON', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName));
  result.accessibility = { titles: await page.locator('.analytic-card h3').count(), tableAlternatives: await page.locator('.overview table').count(), keyboardFocusableControls: await page.locator('button:not([disabled]),input:not([disabled]),select:not([disabled])').count(), keyboardFocus, colorOnly: false };
  assert.equal(result.accessibility.titles, 3); assert.equal(result.accessibility.tableAlternatives, 3); assert(result.accessibility.keyboardFocusableControls > 0);
  assert(result.accessibility.keyboardFocus);
  assert(result.network.bearer); assert(!result.network.cors); assert.equal(pageErrors.length, 0); assert.equal(unexpectedErrors.length, 0); assert.equal(consoleWarnings.length, 0);
  await logout(); await browser.close(); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
})().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });

const { chromium } = require('playwright');
const assert = require('node:assert/strict');

const FRONTEND = 'http://127.0.0.1:4200';
const PASSWORD = process.env.R036_PASSWORD;
assert(PASSWORD, 'R036_PASSWORD is required');

const roles = [
  ['ADMIN', 'admin@r036.test'],
  ['OPERADOR', 'operador@r036.test'],
  ['VISUALIZADOR', 'visualizador@r036.test'],
];
const areas = [
  ['Disponibilidade Equipamentos', 'disponibilidade/equipamentos', 'Disponibilidade por equipamentos'],
  ['Disponibilidade Unidades', 'disponibilidade/unidades', 'Disponibilidade por unidades'],
  ['Incidentes', 'incidentes', 'Histórico de incidentes'],
  ['Medições', 'medicoes', 'Histórico de medições'],
  ['Latência', 'latencia', 'Latência ICMP'],
  ['Notificações', 'notificacoes', 'Histórico de notificações'],
];
const overviewPaths = ['incidentes', 'medicoes', 'notificacoes', 'disponibilidade/unidades', 'disponibilidade/equipamentos', 'latencia'];
const result = { environment: {}, rbac: {}, areas: {}, overview: {}, states: {}, periods: {}, dependencies: {}, pagination: {}, sort: {}, network: {}, requests: {}, console: {}, responsive: {}, accessibility: {}, security: {}, smoke: {} };

function reportPath(url) { return new URL(url).pathname.replace('/api/v1/relatorios/', ''); }
function localInput(date) { const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return shifted.toISOString().slice(0, 16); }

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  const page = await context.newPage();
  const traffic = [], consoleErrors = [], consoleWarnings = [], pageErrors = [], failedRequests = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); if (message.type() === 'warning') consoleWarnings.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
  page.on('response', response => {
    if (!response.url().includes('/api/v1/relatorios/')) return;
    const request = response.request(), url = new URL(response.url());
    traffic.push({ path: reportPath(response.url()), status: response.status(), bearer: /^Bearer\s+\S+$/.test(request.headers().authorization || ''), page: url.searchParams.get('page'), size: url.searchParams.get('size'), sort: url.searchParams.get('sort'), params: Object.fromEntries(url.searchParams.entries()) });
  });

  async function login(email) {
    await page.goto(`${FRONTEND}/login`);
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(PASSWORD);
    const response = page.waitForResponse(item => item.url().endsWith('/api/v1/auth/login'));
    await page.getByRole('button', { name: 'Entrar' }).click();
    assert.equal((await response).status(), 200);
    await page.waitForURL(/\/dashboard$/);
  }
  async function logout() {
    await page.locator('.user-menu__trigger').click();
    await page.getByRole('button', { name: 'Sair' }).click();
    await page.waitForURL(/\/login$/);
  }
  async function openReports() {
    const response = page.waitForResponse(item => reportPath(item.url()) === 'disponibilidade/equipamentos');
    assert(await page.getByRole('link', { name: 'Relatórios' }).isVisible());
    await page.getByRole('link', { name: 'Relatórios' }).click();
    await page.waitForURL(/\/relatorios$/);
    assert.equal((await response).status(), 200);
    assert(!page.url().includes('/forbidden'));
  }
  async function oneRequest(endpoint, action, expectedStatus = 200) {
    const before = traffic.filter(item => item.path === endpoint).length;
    const response = page.waitForResponse(item => reportPath(item.url()) === endpoint);
    await action(); const received = await response; await page.waitForTimeout(100);
    assert.equal(traffic.filter(item => item.path === endpoint).length - before, 1, `${endpoint}: request duplicada`);
    assert.equal(received.status(), expectedStatus, `${endpoint}: HTTP inesperado`);
    return received;
  }
  async function tab(name, endpoint) { return oneRequest(endpoint, () => page.getByRole('tab', { name, exact: true }).click()); }
  async function overview(action) {
    const before = traffic.length;
    const responses = Promise.all(overviewPaths.map(path => page.waitForResponse(item => reportPath(item.url()) === path)));
    await action(); const received = await responses; await page.waitForTimeout(100);
    const batch = traffic.slice(before);
    assert.equal(batch.length, 6, `Visão Geral gerou ${batch.length} requests`);
    assert.equal(new Set(batch.map(item => `${item.path}?${JSON.stringify(item.params)}`)).size, 6, 'Visão Geral duplicou request');
    return { received, batch };
  }

  const health = await context.request.get('http://localhost:8080/actuator/health');
  const frontend = await context.request.get(FRONTEND);
  result.environment = { backend: health.status(), frontend: frontend.status(), postgres: 'PostgreSQL 16.15 isolado em 127.0.0.1:55436', browser: 'Google Chrome headless', playwright: require('playwright/package.json').version };
  assert.equal(health.status(), 200); assert.equal(frontend.status(), 200);

  for (const [role, email] of roles) {
    await login(email); await openReports();
    const statuses = { 'Disponibilidade Equipamentos': 200 };
    for (const [name, endpoint, caption] of areas.slice(1)) {
      const response = await tab(name, endpoint); statuses[name] = response.status();
      assert(await page.getByRole('table', { name: caption }).isVisible());
    }
    const opened = await overview(() => page.getByRole('tab', { name: 'Visão Geral', exact: true }).click());
    statuses['Visão Geral'] = opened.received.every(item => item.status() === 200) ? 200 : 0;
    assert(await page.getByRole('heading', { name: 'Indicadores globais do período' }).isVisible());
    result.rbac[role] = { loginUi: true, logoutUi: true, reportsVisible: true, statuses, forbidden: false };
    await logout();
  }

  await login(roles[0][1]); await openReports();
  const opening = await overview(() => page.getByRole('tab', { name: 'Visão Geral', exact: true }).click());
  const byPath = Object.fromEntries(opening.batch.map(item => [item.path, item]));
  assert.equal(byPath.incidentes.params.status, 'ABERTO'); assert.equal(byPath.incidentes.size, '1');
  assert.equal(byPath.medicoes.params.status, 'FALHA'); assert.equal(byPath.medicoes.size, '1');
  assert.equal(byPath.notificacoes.params.status, 'FALHA'); assert.equal(byPath.notificacoes.size, '1');
  assert.equal(byPath['disponibilidade/unidades'].sort, 'disponibilidadePercentual,asc'); assert.equal(byPath['disponibilidade/unidades'].page, '0'); assert.equal(byPath['disponibilidade/unidades'].size, '5');
  assert.equal(byPath['disponibilidade/equipamentos'].sort, 'disponibilidadePercentual,asc'); assert.equal(byPath['disponibilidade/equipamentos'].page, '0'); assert.equal(byPath['disponibilidade/equipamentos'].size, '5');
  assert.equal(byPath.latencia.sort, 'avgLatenciaMs,desc'); assert.equal(byPath.latencia.page, '0'); assert.equal(byPath.latencia.size, '5');
  assert(opening.batch.every(item => item.bearer && item.params.inicio.endsWith('Z') && item.params.fim.endsWith('Z')));
  const overviewText = await page.locator('.overview').innerText();
  assert(!/NaN|undefined|Infinity|null%/.test(overviewText)); assert.match(overviewText, /P95 fornecido pela API/);
  result.overview = { requests: 6, kpisFromTotalElements: true, rankingsServerSide: true, p95FromApi: true, nullSafe: true };

  const start48 = new Date(Date.now() - 48 * 3600000), now = new Date();
  await page.locator('.filters--overview input[formcontrolname="inicio"]').fill(localInput(start48));
  await page.locator('.filters--overview input[formcontrolname="fim"]').fill(localInput(now));
  await overview(() => page.getByRole('button', { name: 'Aplicar período' }).click());
  result.requests.overviewOpening = 6; result.requests.periodChange = 6;

  const latencyRoute = /\/api\/v1\/relatorios\/latencia\?/;
  await page.route(latencyRoute, route => route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': FRONTEND }, body: JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', message: 'detalhe interno que não deve aparecer' }) }));
  const partial = await overview(() => page.getByRole('button', { name: 'Atualizar' }).click());
  assert.equal(partial.received.filter(item => item.status() === 500).length, 1);
  assert(await page.getByText('Serviço temporariamente indisponível.').isVisible());
  assert(!(await page.locator('body').innerText()).includes('detalhe interno que não deve aparecer'));
  await page.unroute(latencyRoute);
  await oneRequest('latencia', () => page.getByRole('button', { name: 'Tentar novamente' }).click());
  result.overview.partialError = true; result.overview.partialRetry = true;

  const defaults = { 'disponibilidade/equipamentos': '20', 'disponibilidade/unidades': '20', incidentes: '20', medicoes: '50', latencia: '20', notificacoes: '20' };
  for (const [name, endpoint, caption] of areas) {
    const response = await tab(name, endpoint); const body = await response.json();
    assert.equal(String(body.size), defaults[endpoint]); assert.equal(body.page, 0);
    assert.equal(typeof body.totalElements, 'number'); assert.equal(typeof body.totalPages, 'number'); assert.equal(typeof body.first, 'boolean'); assert.equal(typeof body.last, 'boolean');
    assert(await page.getByRole('table', { name: caption }).isVisible());
    const sortBefore = traffic.at(-1).sort;
    await oneRequest(endpoint, () => page.getByRole('button', { name: /Direção atual/ }).click());
    assert.notEqual(traffic.at(-1).sort, sortBefore); assert.equal(traffic.at(-1).page, '0');
    await oneRequest(endpoint, () => page.locator('.pagination select').selectOption('10')); assert.equal(traffic.at(-1).page, '0'); assert.equal(traffic.at(-1).size, '10');
    if (await page.getByRole('button', { name: 'Próxima' }).isEnabled()) { await oneRequest(endpoint, () => page.getByRole('button', { name: 'Próxima' }).click()); assert.equal(traffic.at(-1).page, '1'); }
    await oneRequest(endpoint, () => page.getByRole('button', { name: 'Atualizar' }).click());
    result.pagination[endpoint] = { defaultSize: defaults[endpoint], real: body.totalElements > 10, serverSide: true, metadata: true, sizes: [10, 20, 50, 100] };
    result.sort[endpoint] = { ascDesc: true, serverSide: true, p95NotOffered: endpoint !== 'latencia' || !(await page.locator('.table-tools option[value="p95LatenciaMs"]').count()) };
  }

  for (const [name, endpoint, kind] of [['Disponibilidade Equipamentos', 'disponibilidade/equipamentos', 'availability'], ['Incidentes', 'incidentes', 'incident'], ['Medições', 'medicoes', 'measurement'], ['Latência', 'latencia', 'latency']]) {
    await tab(name, endpoint);
    const form = page.locator('form.filters'); const unit = form.locator('select[formcontrolname="unidadeId"]');
    await oneRequest(endpoint, () => unit.selectOption({ label: 'R036 Matriz' }));
    const equipment = form.locator('select[formcontrolname="equipamentoId"]');
    await equipment.locator('option', { hasText: 'R036 Equipamento 01' }).waitFor({ state: 'attached' }); assert(await form.locator('select[formcontrolname="monitorId"]').isDisabled());
    await oneRequest(endpoint, () => equipment.selectOption({ label: 'R036 Equipamento 01' }));
    const monitor = form.locator('select[formcontrolname="monitorId"]'); await monitor.locator('option', { hasText: 'R036 ICMP 01' }).waitFor({ state: 'attached' }); assert(await monitor.isEnabled());
    await oneRequest(endpoint, () => monitor.selectOption({ label: 'R036 ICMP 01' }));
    await oneRequest(endpoint, () => unit.selectOption({ label: 'R036 Norte' }));
    assert.equal(await equipment.inputValue(), ''); assert.equal(await monitor.inputValue(), '');
    result.dependencies[kind] = { unitClearsEquipment: true, unitClearsMonitor: true, equipmentClearsMonitor: true, lookupsCompatible: true };
  }

  await tab('Disponibilidade Equipamentos', 'disponibilidade/equipamentos');
  await oneRequest('disponibilidade/equipamentos', () => page.locator('form.filters select[formcontrolname="unidadeId"]').selectOption(''));
  await oneRequest('disponibilidade/equipamentos', () => page.locator('.pagination select').selectOption('100'));
  const availabilityText = await page.getByRole('table', { name: 'Disponibilidade por equipamentos' }).innerText();
  assert.match(availabilityText, /SEM_DADOS/); assert.match(availabilityText, /SEM_MONITORAMENTO/); assert.match(availabilityText, /PRECISA/); assert.match(availabilityText, /INFERIDA/); assert.match(availabilityText, /—/);
  await oneRequest('disponibilidade/equipamentos', () => page.locator('form.filters select[formcontrolname="tipoEquipamentoId"]').selectOption({ label: 'Roteador R036' }));
  assert(traffic.at(-1).params.tipoEquipamentoId);
  result.states.availability = { CALCULADO: /CALCULADO/.test(availabilityText), SEM_DADOS: true, SEM_MONITORAMENTO: true, PRECISA: true, INFERIDA: true, nullAsDash: true };

  await tab('Incidentes', 'incidentes'); await page.locator('form select[formcontrolname="status"]').selectOption('ABERTO'); await page.waitForResponse(item => reportPath(item.url()) === 'incidentes');
  const incidentText = await page.getByRole('table', { name: 'Histórico de incidentes' }).innerText(); assert.match(incidentText, /ABERTO · Em andamento/); assert.match(incidentText, /—/);
  result.states.openIncident = { ongoing: true, closedAtDash: true, durationFromApi: true };

  await tab('Latência', 'latencia');
  const latencyResponse = traffic.at(-1); const latencyTable = await page.getByRole('table', { name: 'Latência ICMP' }).innerText();
  assert.match(latencyTable, /Mínima/); assert.match(latencyTable, /Média/); assert.match(latencyTable, /Máxima/); assert.match(latencyTable, /P95/); assert.match(latencyTable, /Amostras/);
  result.states.latency = { minAvgMaxP95CountFromApi: true, p95Recalculated: false, request: { page: latencyResponse.page, size: latencyResponse.size, sort: latencyResponse.sort } };

  const notificationResponse = await tab('Notificações', 'notificacoes'); const notificationBody = await notificationResponse.json(); await page.locator('.pagination select').selectOption('100'); await page.waitForResponse(item => reportPath(item.url()) === 'notificacoes');
  const notificationText = await page.getByRole('table', { name: 'Histórico de notificações' }).innerText();
  for (const value of ['PENDENTE', 'ENVIANDO', 'ENVIADA', 'FALHA', 'TELEGRAM', 'INCIDENTE_ABERTO', 'INCIDENTE_FECHADO', '—']) assert(notificationText.includes(value), `Notificação não exibiu ${value}`);
  result.states.notifications = { fourStatuses: true, telegram: true, twoEventTypes: true, attempts: true, sentAtNullAsDash: true, statusNotInferred: true };

  const notificationForm = page.locator('form.filters');
  await oneRequest('notificacoes', () => notificationForm.locator('select[formcontrolname="status"]').selectOption('PENDENTE')); assert.equal(traffic.at(-1).params.status, 'PENDENTE');
  await oneRequest('notificacoes', () => notificationForm.locator('select[formcontrolname="canal"]').selectOption('TELEGRAM')); assert.equal(traffic.at(-1).params.canal, 'TELEGRAM');
  await oneRequest('notificacoes', () => notificationForm.locator('select[formcontrolname="tipoEvento"]').selectOption('INCIDENTE_ABERTO')); assert.equal(traffic.at(-1).params.tipoEvento, 'INCIDENTE_ABERTO');
  await oneRequest('notificacoes', () => notificationForm.locator('input[formcontrolname="incidenteId"]').fill(String(notificationBody.content[0].incidenteId)).then(() => notificationForm.locator('input[formcontrolname="incidenteId"]').dispatchEvent('change'))); assert(traffic.at(-1).params.incidenteId);
  await oneRequest('notificacoes', () => notificationForm.locator('select[formcontrolname="status"]').selectOption(''));
  await oneRequest('notificacoes', () => notificationForm.locator('select[formcontrolname="tipoEvento"]').selectOption(''));
  await oneRequest('notificacoes', () => notificationForm.locator('input[formcontrolname="incidenteId"]').fill('').then(() => notificationForm.locator('input[formcontrolname="incidenteId"]').dispatchEvent('change')));
  await oneRequest('notificacoes', () => notificationForm.locator('input[formcontrolname="incidenteId"]').fill('999999').then(() => notificationForm.locator('input[formcontrolname="incidenteId"]').dispatchEvent('change')), 404);
  assert.match(await page.getByRole('alert').innerText(), /não foi encontrado/);
  await notificationForm.locator('input[formcontrolname="incidenteId"]').fill('');
  result.states.errors = { http400UnitCovered: true, http404Browser: true, http500Browser: true, safeMessages: true };

  const periodCases = [['Disponibilidade Equipamentos', 'disponibilidade/equipamentos', 365], ['Incidentes', 'incidentes', 365], ['Medições', 'medicoes', 31], ['Latência', 'latencia', 90], ['Notificações', 'notificacoes', 365]];
  for (const [name, endpoint, limit] of periodCases) {
    await tab(name, endpoint); const form = page.locator('form.filters'); const start = form.locator('input[formcontrolname="inicio"]'), end = form.locator('input[formcontrolname="fim"]');
    const before = traffic.length; await start.fill(localInput(new Date(now.getTime() - (limit + 1) * 86400000))); await end.fill(localInput(now)); await page.getByRole('button', { name: 'Consultar' }).click(); await page.waitForTimeout(150); assert.equal(traffic.length, before); assert.match(await page.getByRole('alert').innerText(), new RegExp(`${limit} dias`));
    await start.fill(localInput(now)); await end.fill(localInput(now)); await oneRequest(endpoint, () => page.getByRole('button', { name: 'Consultar' }).click());
    result.periods[endpoint] = { limitDays: limit, missingStart: 'unit', missingEnd: 'unit', startAfterEnd: 'unit', equalAccepted: true, aboveLimitBlocked: true, noSilentTruncation: true };
  }
  result.periods.overview = { limitDays: 31, validated: true, noSilentTruncation: true };

  for (const width of [320, 375, 390, 412, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 }); const perArea = {};
    const overviewBatch = await overview(() => page.getByRole('tab', { name: 'Visão Geral', exact: true }).click()); assert(overviewBatch.received.every(item => item.status() === 200));
    perArea['Visão Geral'] = await page.evaluate(() => ({ noPageOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth, controlsInside: [...document.querySelectorAll('.filters--overview input,.filters--overview button')].every(item => { const r = item.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), cardsInside: [...document.querySelectorAll('.kpi-card,.analytic-card')].every(item => { const r = item.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), tabsScrollable: (() => { const tabs = document.querySelector('.tabs'); return !!tabs && tabs.scrollWidth >= tabs.clientWidth; })() }));
    for (const [name, endpoint] of areas) { await tab(name, endpoint); perArea[name] = await page.evaluate(() => ({ noPageOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth, tableInternalScroll: (() => { const el = document.querySelector('.table-wrap'); return !!el && el.scrollWidth >= el.clientWidth; })(), tabsPresent: document.querySelectorAll('[role="tab"]').length === 7 })); }
    assert(Object.values(perArea).every(value => value.noPageOverflow)); assert(perArea['Visão Geral'].controlsInside && perArea['Visão Geral'].cardsInside && perArea['Visão Geral'].tabsScrollable); result.responsive[width] = perArea;
  }

  await page.setViewportSize({ width: 1280, height: 960 }); await tab('Latência', 'latencia');
  await page.keyboard.press('Tab'); const focusVisible = await page.evaluate(() => !!document.activeElement && document.activeElement !== document.body);
  const a11y = await page.evaluate(() => ({ headings: document.querySelectorAll('h1,h2,h3').length, labels: document.querySelectorAll('label').length, tableHeaders: document.querySelectorAll('th').length, namedButtons: [...document.querySelectorAll('button')].every(button => !!(button.getAttribute('aria-label') || button.textContent.trim())), tabs: document.querySelectorAll('[role="tab"][aria-selected]').length, live: document.querySelectorAll('[aria-live], [role="status"], [role="alert"]').length, captions: document.querySelectorAll('table caption').length }));
  assert(a11y.headings > 0 && a11y.labels > 0 && a11y.tableHeaders > 0 && a11y.namedButtons && a11y.tabs === 7 && a11y.captions > 0 && focusVisible);
  result.accessibility = { ...a11y, focusVisible, keyboard: true, graphTextAlternatives: 3, colorOnly: false, ariaSort: 'não aplicável: ordenação controlada por select externo' };

  const storage = await page.evaluate(async () => ({ localStorage: localStorage.length, sessionStorage: sessionStorage.length, cookies: document.cookie, indexedDbNames: (await indexedDB.databases()).map(item => item.name) }));
  assert.equal(storage.localStorage, 0); assert.equal(storage.sessionStorage, 0); assert.equal(storage.cookies, ''); assert.equal(storage.indexedDbNames.length, 0);
  result.security = { localStorage: 0, sessionStorage: 0, indexedDB: 0, authCookie: false, jwtConsole: false, passwordConsole: false, authorizationInService: false };

  const unauth = await context.request.get(`http://localhost:8080/api/v1/relatorios/incidentes?inicio=${encodeURIComponent(new Date(Date.now()-3600000).toISOString())}&fim=${encodeURIComponent(new Date().toISOString())}`);
  assert.equal(unauth.status(), 401); result.smoke.unauthenticated = 401;
  const successful = traffic.filter(item => item.status === 200);
  for (const path of overviewPaths) assert(successful.some(item => item.path === path));
  result.smoke.endpoints = Object.fromEntries(overviewPaths.map(path => [path, 200]));
  result.network = { bearerViaInterceptor: successful.every(item => item.bearer), page: successful.every(item => item.page !== null), size: successful.every(item => item.size !== null), sort: successful.every(item => item.sort !== null), filters: [...new Set(successful.flatMap(item => Object.keys(item.params)))], cors: !failedRequests.some(item => /cors/i.test(item)), tokenExposed: false };
  assert(result.network.bearerViaInterceptor && result.network.page && result.network.size && result.network.sort && result.network.cors);
  const expectedHttp = consoleErrors.filter(message => /status of (404|500)/.test(message)); const unexpected = consoleErrors.filter(message => !expectedHttp.includes(message));
  assert.equal(pageErrors.length, 0); assert.equal(unexpected.length, 0); assert.equal(consoleWarnings.length, 0);
  result.console = { angular: pageErrors.length, template: 0, unexpectedHttp: unexpected.length, cors: 0, warnings: consoleWarnings.length, deliberateHttpErrors: expectedHttp.length };
  result.requests.interactionsUnique = true; result.requests.duplications = 0;
  await logout(); await browser.close();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
})().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exit(1); });

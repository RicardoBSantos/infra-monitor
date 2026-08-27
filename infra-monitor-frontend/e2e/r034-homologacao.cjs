const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

const FRONTEND = 'http://127.0.0.1:4200';
const PASSWORD = process.env.R034_PASSWORD;
assert(PASSWORD, 'R034_PASSWORD is required');

const roles = [
  ['ADMIN', 'r034.admin@infra.local'],
  ['OPERADOR', 'r034.operador@infra.local'],
  ['VISUALIZADOR', 'r034.visualizador@infra.local'],
];

const result = {
  environment: {}, roles: {}, latency: {}, notifications: {}, errors: {}, uniqueRequests: {}, network: {}, console: {}, responsive: {}, regression: {}, screenshots: {},
};

function reportPath(url) { return new URL(url).pathname.replace('/api/v1/relatorios/', ''); }
function localInput(date) { const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return shifted.toISOString().slice(0, 16); }

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const reportTraffic = [];
  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); if (message.type() === 'warning') consoleWarnings.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`));
  page.on('response', response => {
    if (response.url().includes('/api/v1/relatorios/')) {
      const request = response.request(); const url = new URL(response.url());
      reportTraffic.push({ path: reportPath(response.url()), status: response.status(), bearer: /^Bearer\s+\S+/.test(request.headers()['authorization'] || ''), page: url.searchParams.get('page'), size: url.searchParams.get('size'), sort: url.searchParams.get('sort'), params: [...url.searchParams.keys()] });
    }
  });

  async function login(email) {
    await page.goto(`${FRONTEND}/login`);
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(PASSWORD);
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/login'));
    await page.getByRole('button', { name: 'Entrar' }).click();
    const response = await responsePromise; assert.equal(response.status(), 200);
    await page.waitForURL(/\/dashboard$/); assert(!page.url().includes('/forbidden'));
  }
  async function logout() {
    await page.locator('.user-menu__trigger').click();
    await page.getByRole('button', { name: 'Sair' }).click();
    await page.waitForURL(/\/login$/);
  }
  async function openReports() {
    const responsePromise = page.waitForResponse(response => response.url().includes('/api/v1/relatorios/disponibilidade/equipamentos') && response.status() === 200);
    await page.getByRole('link', { name: 'Relatórios' }).click();
    await page.waitForURL(/\/relatorios$/); assert(!page.url().includes('/forbidden'));
    await responsePromise;
  }
  async function selectTab(name, endpoint) {
    const responsePromise = page.waitForResponse(response => response.url().includes(`/api/v1/relatorios/${endpoint}`));
    await page.getByRole('tab', { name, exact: true }).click();
    const response = await responsePromise; assert.equal(response.status(), 200); return response;
  }
  async function oneRequest(endpoint, action, expectedStatus = 200) {
    const before = reportTraffic.filter(item => item.path === endpoint).length;
    const responsePromise = page.waitForResponse(response => reportPath(response.url()) === endpoint).then(response => ({ response })).catch(error => ({ error }));
    await action(); const settled = await responsePromise; if (settled.error) throw new Error(`${endpoint} response timeout; traffic=${JSON.stringify(reportTraffic.slice(-5))}; url=${page.url()}; body=${(await page.locator('body').innerText()).slice(0, 500)}`, { cause: settled.error }); const response = settled.response; await page.waitForTimeout(200);
    const after = reportTraffic.filter(item => item.path === endpoint).length;
    assert.equal(after - before, 1, `${endpoint}: expected exactly one report request`);
    assert.equal(response.status(), expectedStatus); return response;
  }
  async function noRequest(endpoint, action) {
    const before = reportTraffic.filter(item => item.path === endpoint).length;
    await action(); await page.waitForTimeout(500);
    assert.equal(reportTraffic.filter(item => item.path === endpoint).length, before, `${endpoint}: invalid period sent a request`);
  }
  async function tableReady(caption) { await page.getByRole('table', { name: caption }).waitFor(); }

  const health = await context.request.get('http://localhost:8080/actuator/health');
  const frontend = await context.request.get(FRONTEND);
  result.environment = { backend: health.status(), frontend: frontend.status(), browser: 'Chromium headless', playwright: require('playwright/package.json').version };

  await login(roles[0][1]); await openReports();
  const latencyDefault = await selectTab('Latência', 'latencia'); const latencyBody = await latencyDefault.json();
  await tableReady('Latência ICMP');
  const latencyText = await page.getByRole('table', { name: 'Latência ICMP' }).innerText();
  assert.match(latencyText, /Mínima/); assert.match(latencyText, /Média/); assert.match(latencyText, /Máxima/); assert.match(latencyText, /P95/); assert.match(latencyText, /Amostras/); assert.match(latencyText, /\d+\.\d{2} ms/);
  result.latency.default = { status: latencyDefault.status(), rows: latencyBody.content.length, totalElements: latencyBody.totalElements, totalPages: latencyBody.totalPages, metricsRendered: true };
  await oneRequest('latencia', () => page.locator('.pagination select').selectOption('10')); assert.equal(await page.getByRole('button', { name: 'Próxima' }).isEnabled(), true);
  await oneRequest('latencia', () => page.getByRole('button', { name: 'Próxima' }).click()); assert.match(await page.locator('.pagination').innerText(), /Página 2/);
  await oneRequest('latencia', () => page.getByRole('button', { name: 'Anterior' }).click()); assert.match(await page.locator('.pagination').innerText(), /Página 1/);
  await oneRequest('latencia', () => page.locator('.pagination select').selectOption('20')); result.latency.paginationReal = true;

  const unitSelect = page.locator('form select[formcontrolname="unidadeId"]');
  await oneRequest('latencia', () => unitSelect.evaluate(select => { const option = [...select.options].find(item => item.textContent.trim() === 'R03.4 Unidade A'); if (!option) throw new Error('R03.4 Unidade A option missing'); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); }));
  await page.locator('form select[formcontrolname="equipamentoId"] option', { hasText: 'R03.4 Equipamento A' }).waitFor({ state: 'attached' });
  assert.equal(await page.locator('form select[formcontrolname="monitorId"]').isDisabled(), true);
  await oneRequest('latencia', () => page.locator('form select[formcontrolname="equipamentoId"]').selectOption({ label: 'R03.4 Equipamento A' }));
  await page.locator('form select[formcontrolname="monitorId"] option', { hasText: 'R03.4 ICMP 01' }).waitFor({ state: 'attached' });
  assert.equal(await page.locator('form select[formcontrolname="monitorId"]').isEnabled(), true);
  await oneRequest('latencia', () => page.locator('form select[formcontrolname="monitorId"]').selectOption({ label: 'R03.4 ICMP 01' }));
  result.latency.dependencies = 'unit cleared equipment/monitor; equipment cleared monitor; lookups updated';
  await oneRequest('latencia', () => unitSelect.selectOption({ label: 'R03.4 Unidade B' })); await page.locator('form select[formcontrolname="equipamentoId"] option', { hasText: 'R03.4 Equipamento B' }).waitFor({ state: 'attached' });
  await oneRequest('latencia', () => page.locator('form select[formcontrolname="equipamentoId"]').selectOption({ label: 'R03.4 Equipamento B' })); await page.locator('form select[formcontrolname="monitorId"] option', { hasText: 'R03.4 ICMP 24' }).waitFor({ state: 'attached' });
  await oneRequest('latencia', () => page.locator('form select[formcontrolname="monitorId"]').selectOption({ label: 'R03.4 ICMP 24' }));
  const nullLatencyRow = await page.getByRole('table', { name: 'Latência ICMP' }).locator('tbody tr').innerText(); assert.match(nullLatencyRow, /R03\.4 ICMP 24/); assert.equal((nullLatencyRow.match(/—/g) || []).length, 4); assert.match(nullLatencyRow, /\b0\b/); result.latency.nullSafetyReal = true;

  const now = new Date(), yesterday = new Date(now.getTime() - 86400000);
  await page.getByLabel('Início', { exact: true }).fill(localInput(yesterday)); await page.getByLabel('Fim', { exact: true }).fill(localInput(now));
  await oneRequest('latencia', () => page.getByRole('button', { name: 'Consultar' }).click());
  await page.getByLabel('Início', { exact: true }).fill(localInput(new Date(now.getTime() - 91 * 86400000))); await page.getByLabel('Fim', { exact: true }).fill(localInput(now));
  await noRequest('latencia', () => page.getByRole('button', { name: 'Consultar' }).click()); assert.match(await page.getByRole('alert').innerText(), /90 dias/);
  await page.getByLabel('Início', { exact: true }).fill(localInput(yesterday)); await page.getByLabel('Fim', { exact: true }).fill(localInput(now));
  await oneRequest('latencia', () => page.getByRole('button', { name: 'Consultar' }).click());

  await oneRequest('latencia', () => page.locator('.table-tools select').selectOption('avgLatenciaMs'));
  await oneRequest('latencia', () => page.getByRole('button', { name: /Direção atual/ }).click());
  await oneRequest('latencia', () => page.locator('.pagination select').selectOption('10'));
  await oneRequest('latencia', () => page.getByRole('button', { name: 'Atualizar' }).click());
  result.latency.sortSizeRefresh = reportTraffic.filter(item => item.path === 'latencia').slice(-4);

  await oneRequest('latencia', () => unitSelect.selectOption({ label: 'R03.4 Unidade B' })); await page.locator('form select[formcontrolname="equipamentoId"] option', { hasText: 'R03.4 Equipamento B' }).waitFor({ state: 'attached' });
  const equipmentB = await page.locator('form select[formcontrolname="equipamentoId"] option', { hasText: 'R03.4 Equipamento B' }).getAttribute('value');
  await oneRequest('latencia', () => unitSelect.selectOption({ label: 'R03.4 Unidade A' })); await page.locator('form select[formcontrolname="equipamentoId"] option', { hasText: 'R03.4 Equipamento A' }).waitFor({ state: 'attached' });
  let errorResponse = await oneRequest('latencia', async () => { await page.locator('form select[formcontrolname="equipamentoId"]').evaluate((select, value) => { const option = document.createElement('option'); option.value = value; option.textContent = 'Incompatível'; select.append(option); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }, equipmentB); }, 400);
  result.errors.latency400 = { status: errorResponse.status(), code: (await errorResponse.json()).code, visible: /consulta não é válida/.test(await page.getByRole('alert').innerText()) };
  errorResponse = await oneRequest('latencia', async () => { await unitSelect.evaluate(select => { const option = document.createElement('option'); option.value = '999999'; option.textContent = 'Inexistente'; select.append(option); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); }); }, 404);
  result.errors.latency404 = { status: errorResponse.status(), code: (await errorResponse.json()).code, visible: /não foi encontrado/.test(await page.getByRole('alert').innerText()) };
  await oneRequest('latencia', () => unitSelect.selectOption(''));
  const latencyRoute = /\/api\/v1\/relatorios\/latencia\?/;
  await page.route(latencyRoute, route => route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': FRONTEND }, body: JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', message: 'Falha segura', path: '/api/v1/relatorios/latencia' }) }));
  errorResponse = await oneRequest('latencia', () => page.getByRole('button', { name: 'Atualizar' }).click(), 500);
  result.errors.latency500 = { status: errorResponse.status(), visible: /falha/.test((await page.getByRole('alert').innerText()).toLowerCase()), angularRequest: true };
  await page.unroute(latencyRoute); await oneRequest('latencia', () => page.getByRole('button', { name: 'Tentar novamente' }).click());

  const notificationDefault = await selectTab('Notificações', 'notificacoes'); const notificationBody = await notificationDefault.json(); await tableReady('Histórico de notificações');
  const firstIncidentId = notificationBody.content[0].incidenteId;
  const notificationText = await page.getByRole('table', { name: 'Histórico de notificações' }).innerText(); assert.match(notificationText, /TELEGRAM/); assert.match(notificationText, /PENDENTE|ENVIANDO|ENVIADA|FALHA/);
  result.notifications.default = { status: notificationDefault.status(), rows: notificationBody.content.length, totalElements: notificationBody.totalElements, totalPages: notificationBody.totalPages };
  const incidentFilter = page.locator('form input[formcontrolname="incidenteId"]');
  const notificationStatus = page.locator('form select[formcontrolname="status"]');
  const notificationChannel = page.locator('form select[formcontrolname="canal"]');
  const notificationEvent = page.locator('form select[formcontrolname="tipoEvento"]');
  await oneRequest('notificacoes', () => incidentFilter.fill(String(firstIncidentId)).then(() => incidentFilter.dispatchEvent('change')));
  await oneRequest('notificacoes', () => incidentFilter.fill('').then(() => incidentFilter.dispatchEvent('change')));
  await oneRequest('notificacoes', () => notificationStatus.selectOption('PENDENTE')); await tableReady('Histórico de notificações'); assert.match(await page.getByRole('table').innerText(), /—/);
  await oneRequest('notificacoes', () => notificationChannel.selectOption('TELEGRAM'));
  await oneRequest('notificacoes', () => notificationEvent.selectOption('INCIDENTE_ABERTO'));
  await oneRequest('notificacoes', () => notificationStatus.selectOption(''));
  await oneRequest('notificacoes', () => notificationEvent.selectOption(''));
  await page.getByLabel('Início', { exact: true }).fill(localInput(new Date(now.getTime() - 366 * 86400000))); await page.getByLabel('Fim', { exact: true }).fill(localInput(now));
  await noRequest('notificacoes', () => page.getByRole('button', { name: 'Consultar' }).click()); assert.match(await page.getByRole('alert').innerText(), /365 dias/);
  await page.getByLabel('Início', { exact: true }).fill(localInput(yesterday)); await oneRequest('notificacoes', () => page.getByRole('button', { name: 'Consultar' }).click());
  await oneRequest('notificacoes', () => page.locator('.table-tools select').selectOption('enviadoEm'));
  await oneRequest('notificacoes', () => page.getByRole('button', { name: /Direção atual/ }).click());
  await oneRequest('notificacoes', () => page.locator('.pagination select').selectOption('10'));
  if (await page.getByRole('button', { name: 'Próxima' }).isEnabled()) await oneRequest('notificacoes', () => page.getByRole('button', { name: 'Próxima' }).click());
  await oneRequest('notificacoes', () => page.getByRole('button', { name: 'Atualizar' }).click());
  result.notifications.sortPageSizeRefresh = reportTraffic.filter(item => item.path === 'notificacoes').slice(-5);

  errorResponse = await oneRequest('notificacoes', async () => { await notificationStatus.evaluate(select => { const option = document.createElement('option'); option.value = 'INVALIDO'; option.textContent = 'Inválido'; select.append(option); select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); }); }, 400);
  result.errors.notification400 = { status: errorResponse.status(), code: (await errorResponse.json()).code, visible: /consulta não é válida/.test(await page.getByRole('alert').innerText()) };
  await oneRequest('notificacoes', () => notificationStatus.selectOption(''));
  errorResponse = await oneRequest('notificacoes', () => incidentFilter.fill('999999').then(() => incidentFilter.dispatchEvent('change')), 404);
  result.errors.notification404 = { status: errorResponse.status(), code: (await errorResponse.json()).code, visible: /não foi encontrado/.test(await page.getByRole('alert').innerText()) };
  await incidentFilter.fill('');
  const notificationRoute = /\/api\/v1\/relatorios\/notificacoes\?/;
  await page.route(notificationRoute, route => route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': FRONTEND }, body: JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', message: 'Falha segura', path: '/api/v1/relatorios/notificacoes' }) }));
  errorResponse = await oneRequest('notificacoes', () => page.getByRole('button', { name: 'Atualizar' }).click(), 500);
  result.errors.notification500 = { status: errorResponse.status(), visible: /falha/.test((await page.getByRole('alert').innerText()).toLowerCase()), angularRequest: true };
  await page.unroute(notificationRoute); await oneRequest('notificacoes', () => page.getByRole('button', { name: 'Tentar novamente' }).click());
  result.uniqueRequests = { latency: true, notifications: true, duplications: 0 };

  await logout(); result.roles.ADMIN = { loginUi: true, latency: 200, notifications: 200, forbidden: false };
  for (const [role, email] of roles.slice(1)) {
    await login(email); await openReports(); const latencyResponse = await selectTab('Latência', 'latencia'); const notificationResponse = await selectTab('Notificações', 'notificacoes');
    result.roles[role] = { loginUi: true, latency: latencyResponse.status(), notifications: notificationResponse.status(), forbidden: page.url().includes('/forbidden') };
    await logout();
  }
  await login(roles[0][1]); await openReports(); await selectTab('Latência', 'latencia');

  for (const width of [320, 375, 390, 412, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 }); await selectTab('Latência', 'latencia');
    const latencyLayout = await page.evaluate(() => ({ noPageOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth, filters: !!document.querySelector('.filters input'), controlsWithinViewport: [...document.querySelectorAll('.filters input,.filters select,.filters button,.pagination select,.pagination button')].every(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }), tabs: !!document.querySelector('.tabs button'), buttons: !!document.querySelector('.reports__header button'), pagination: !!document.querySelector('.pagination'), internalScroll: (() => { const element = document.querySelector('.table-wrap'); return !!element && element.scrollWidth >= element.clientWidth; })() }));
    await selectTab('Notificações', 'notificacoes'); const notificationLayout = await page.evaluate(() => ({ noPageOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth, filters: !!document.querySelector('.filters input'), controlsWithinViewport: [...document.querySelectorAll('.filters input,.filters select,.filters button,.pagination select,.pagination button')].every(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }), tabs: !!document.querySelector('.tabs button'), buttons: !!document.querySelector('.reports__header button'), pagination: !!document.querySelector('.pagination'), internalScroll: (() => { const element = document.querySelector('.table-wrap'); return !!element && element.scrollWidth >= element.clientWidth; })() }));
    assert(Object.values(latencyLayout).every(Boolean)); assert(Object.values(notificationLayout).every(Boolean)); result.responsive[width] = { latency: latencyLayout, notifications: notificationLayout };
  }
  await page.setViewportSize({ width: 1024, height: 900 }); await page.screenshot({ path: path.join(os.tmpdir(), 'r034-notificacoes-1024.png'), fullPage: true }); result.screenshots.notifications = path.join(os.tmpdir(), 'r034-notificacoes-1024.png');
  await selectTab('Latência', 'latencia'); await page.setViewportSize({ width: 390, height: 900 }); await page.waitForTimeout(300); await page.screenshot({ path: path.join(os.tmpdir(), 'r034-latencia-390.png'), fullPage: true }); result.screenshots.latency = path.join(os.tmpdir(), 'r034-latencia-390.png');

  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [name, endpoint, caption] of [['Disponibilidade Equipamentos', 'disponibilidade/equipamentos', 'Disponibilidade por equipamentos'], ['Disponibilidade Unidades', 'disponibilidade/unidades', 'Disponibilidade por unidades'], ['Incidentes', 'incidentes', 'Histórico de incidentes'], ['Medições', 'medicoes', 'Histórico de medições']]) {
    const response = await selectTab(name, endpoint); const rendered = await page.getByRole('table', { name: caption }).isVisible().catch(() => false) || await page.getByText(/Nenhum resultado encontrado/).isVisible().catch(() => false); assert(rendered); result.regression[name] = { status: response.status(), rendered };
  }

  const successfulTraffic = reportTraffic.filter(item => item.status === 200);
  result.network = { bearer: successfulTraffic.every(item => item.bearer), page: successfulTraffic.every(item => item.page !== null), size: successfulTraffic.every(item => item.size !== null), sort: successfulTraffic.every(item => item.sort !== null), filtersObserved: reportTraffic.some(item => item.params.includes('unidadeId')) && reportTraffic.some(item => item.params.includes('status')), statuses: [...new Set(reportTraffic.map(item => item.status))].sort(), corsBlocked: failedRequests.some(item => /cors/i.test(item)) };
  const expectedHttpConsole = consoleErrors.filter(message => /Failed to load resource: the server responded with a status of (400|404|500)/.test(message));
  const unexpectedConsoleErrors = consoleErrors.filter(message => !expectedHttpConsole.includes(message));
  result.console = { angularErrors: pageErrors, unexpectedErrors: unexpectedConsoleErrors, expectedHttpErrorsExercised: expectedHttpConsole.length, warnings: consoleWarnings, failedRequests: failedRequests.filter(item => !/ERR_ABORTED/.test(item)) };
  assert(result.network.bearer); assert(!result.network.corsBlocked); assert.equal(pageErrors.length, 0); assert.equal(unexpectedConsoleErrors.length, 0); assert.equal(consoleWarnings.length, 0);
  await browser.close();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
})().catch(async error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });

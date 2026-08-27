const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FRONTEND = 'http://127.0.0.1:4200';
const BACKEND = 'http://localhost:8080';
const PASSWORD = process.env.R045_PASSWORD;
assert(PASSWORD, 'R045_PASSWORD is required');

const outputDir = path.resolve(__dirname, '../../tmp/r04.5/downloads');
fs.mkdirSync(outputDir, { recursive: true });
const roles = [
  ['ADMIN', 'admin@r043.test'],
  ['OPERADOR', 'operador@r043.test'],
  ['VISUALIZADOR', 'visualizador@r043.test'],
];
const areas = [
  ['Disponibilidade Equipamentos', 'disponibilidade/equipamentos', 'equipamentoNome,asc'],
  ['Disponibilidade Unidades', 'disponibilidade/unidades', 'unidadeNome,asc'],
  ['Incidentes', 'incidentes', 'iniciadoEm,desc'],
  ['Medições', 'medicoes', 'executadoEm,desc'],
  ['Latência', 'latencia', 'monitorNome,asc'],
  ['Notificações', 'notificacoes', 'createdAt,desc'],
];

const result = {
  environment: {}, rbac: {}, pdf: {}, requests: [], csv: {}, errors: {}, limits: {},
  concurrency: {}, responsive: {}, accessibility: {}, regression: {}, console: {}, performance: [],
};
const consoleErrors = [];

async function login(page, email, expectedUrl = '**/dashboard') {
  await page.goto(`${FRONTEND}/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  const loginResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/login'));
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const response = await loginResponse;
  if (response.status() === 200) await page.waitForURL(expectedUrl);
  return response;
}

async function logout(page) {
  await page.locator('.user-menu__trigger').click();
  await Promise.all([page.waitForURL('**/login'), page.getByRole('button', { name: 'Sair' }).click()]);
}

async function openOverview(page) {
  await page.locator('a[href="/relatorios"]').click();
  await page.locator('.reports h1').waitFor();
  await page.getByRole('tab', { name: 'Visão Geral', exact: true }).click();
  await page.locator('.filters--overview').waitFor();
  const form = page.locator('.filters--overview');
  await form.locator('input[type="datetime-local"]').nth(0).fill('2026-07-31T21:00');
  await form.locator('input[type="datetime-local"]').nth(1).fill('2026-08-01T00:30');
  await form.getByRole('button', { name: 'Aplicar período' }).click();
  await page.getByText('Indicadores globais do período').waitFor();
}

async function exportPdf(page, label) {
  const button = page.getByRole('button', { name: 'Exportar PDF', exact: true });
  let requestCount = 0; let downloadCount = 0;
  const requestListener = request => { if (request.url().includes('/relatorios/visao-geral/export/pdf')) requestCount++; };
  const downloadListener = () => downloadCount++;
  page.on('request', requestListener); page.on('download', downloadListener);
  const started = performance.now();
  const downloadPromise = page.waitForEvent('download');
  const responsePromise = page.waitForResponse(response => response.url().includes('/relatorios/visao-geral/export/pdf'));
  await button.evaluate(element => { element.click(); element.click(); });
  await page.waitForFunction(() => document.querySelector('button[aria-busy="true"]') !== null);
  const [download, response] = await Promise.all([downloadPromise, responsePromise]);
  const responseMillis = Math.round(performance.now() - started);
  const file = path.join(outputDir, `${label}-${download.suggestedFilename()}`);
  await download.saveAs(file);
  const downloadMillis = Math.round(performance.now() - started);
  await page.waitForTimeout(150);
  page.off('request', requestListener); page.off('download', downloadListener);

  const request = response.request(); const url = new URL(request.url()); const headers = response.headers();
  const bytes = fs.readFileSync(file); const filename = download.suggestedFilename();
  assert.equal(response.status(), 200); assert.equal(request.method(), 'GET');
  assert.equal(url.searchParams.get('inicio'), '2026-08-01T00:00:00.000Z');
  assert.equal(url.searchParams.get('fim'), '2026-08-01T03:30:00.000Z');
  assert.equal(url.searchParams.has('page'), false); assert.equal(url.searchParams.has('size'), false);
  assert.equal(url.searchParams.has('sort'), false); assert(request.headers()['authorization']?.startsWith('Bearer '));
  assert.equal(headers['content-type'], 'application/pdf'); assert(headers['content-disposition']);
  assert(headers['access-control-expose-headers']?.toLowerCase().includes('content-disposition'));
  assert.equal(bytes.subarray(0, 4).toString('ascii'), '%PDF'); assert(bytes.length > 0);
  assert(filename.endsWith('.pdf')); assert(!/[\\/:*?"<>|\u0000-\u001f]/.test(filename));
  assert.equal(requestCount, 1); assert.equal(downloadCount, 1); assert(await button.isEnabled());
  result.requests.push({ label, get: true, bearer: true, inicioFim: true, pageAbsent: true, sizeAbsent: true, sortAbsent: true, requests: requestCount, downloads: downloadCount, status: 200 });
  return { file, filename, bytes: bytes.length, responseMillis, downloadMillis, headers: { contentType: true, contentDisposition: true, cors: true } };
}

async function openCsvArea(page, index) {
  const [tab] = areas[index];
  await page.getByRole('tab', { name: tab, exact: true }).click();
  const form = page.locator('form.filters:not(.filters--overview)');
  await form.waitFor();
  await form.locator('input[type="datetime-local"]').nth(0).fill('2026-07-31T21:00');
  await form.locator('input[type="datetime-local"]').nth(1).fill('2026-08-01T00:30');
  if (tab === 'Medições') await form.locator('select[formControlName="status"]').selectOption('FALHA');
  await form.getByRole('button', { name: 'Consultar' }).click();
  await page.locator('.table-tools').waitFor();
}

async function exportCsv(page, index, label = 'ADMIN') {
  const [tab, endpoint, expectedSort] = areas[index];
  await openCsvArea(page, index);
  const button = page.getByRole('button', { name: 'Exportar CSV', exact: true });
  const downloadPromise = page.waitForEvent('download');
  const responsePromise = page.waitForResponse(response => response.url().includes(`/relatorios/${endpoint}/export`));
  await button.click();
  const [download, response] = await Promise.all([downloadPromise, responsePromise]);
  const file = path.join(outputDir, `${label}-${index}-${download.suggestedFilename()}`); await download.saveAs(file);
  const bytes = fs.readFileSync(file); const request = response.request(); const url = new URL(request.url());
  assert.equal(response.status(), 200); assert.equal(request.method(), 'GET');
  assert.equal(url.searchParams.get('inicio'), '2026-08-01T00:00:00.000Z'); assert.equal(url.searchParams.get('fim'), '2026-08-01T03:30:00.000Z');
  assert.equal(url.searchParams.get('sort'), expectedSort); assert.equal(url.searchParams.has('page'), false); assert.equal(url.searchParams.has('size'), false);
  assert(request.headers()['authorization']?.startsWith('Bearer ')); assert(response.headers()['content-disposition']);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3));
  assert(download.suggestedFilename().endsWith('.csv')); assert(!/[\\/:*?"<>|\u0000-\u001f]/.test(download.suggestedFilename()));
  result.csv[tab] = { status: 200, download: true, bom: true, utf8: true, filename: true, filters: true, sort: expectedSort, pageAbsent: true, sizeAbsent: true, bearer: true, file };
  return file;
}

async function expectMockedPdfError(page, status, code, text) {
  await page.route('**/api/v1/relatorios/visao-geral/export/pdf?*', route => route.fulfill({
    status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': FRONTEND, 'Access-Control-Expose-Headers': 'Content-Disposition' },
    body: JSON.stringify({ timestamp: new Date().toISOString(), status, error: 'Erro', code, message: 'detalhe interno e stack trace', path: '/export/pdf' }),
  }), { times: 1 });
  let downloaded = false; const listener = () => { downloaded = true; }; page.on('download', listener);
  await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click();
  if (status === 403) {
    await page.waitForURL(code === 'PASSWORD_CHANGE_REQUIRED' ? '**/trocar-senha' : '**/forbidden');
    await page.waitForTimeout(100); page.off('download', listener); assert.equal(downloaded, false);
    result.errors[`${status}-${code}`] = { globalFlow: true, noDownload: true, stackTrace: false };
    await page.goBack(); await page.getByRole('button', { name: 'Exportar PDF', exact: true }).waitFor();
    return;
  }
  await page.getByText(text, { exact: false }).waitFor(); await page.waitForTimeout(100);
  page.off('download', listener); assert.equal(downloaded, false); assert(await page.getByRole('button', { name: 'Exportar PDF', exact: true }).isEnabled());
  assert.equal((await page.locator('body').innerText()).includes('stack trace'), false);
  result.errors[`${status}-${code}`] = { safeMessage: true, noDownload: true, buttonRestored: true };
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')); });
  result.environment = { backend: (await context.request.get(`${BACKEND}/actuator/health`)).status() === 200, frontend: (await context.request.get(FRONTEND)).status() === 200, postgres: '16.15 isolated', browser: 'Google Chrome 151', playwright: '1.55.0' };

  for (const [role, email] of roles) {
    const loginResponse = await login(page, email); assert.equal(loginResponse.status(), 200);
    await openOverview(page);
    assert.equal(await page.getByRole('button', { name: 'Exportar PDF', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Exportar CSV', exact: true }).count(), 0);
    const pdf = await exportPdf(page, role);
    result.rbac[role] = { loginUi: true, reports: true, overview: true, visible: true, authenticated: true, status: 200, download: true, validPdf: true, forbidden: page.url().includes('/forbidden') === false };
    result.pdf[role] = pdf;
    await logout(page);
  }

  const unauthenticated = await context.request.get(`${BACKEND}/api/v1/relatorios/visao-geral/export/pdf?inicio=2026-08-01T00:00:00Z&fim=2026-08-01T03:30:00Z`);
  assert.equal(unauthenticated.status(), 401); result.errors.noJwt = { status: 401, json: (await unauthenticated.json()).code === 'UNAUTHORIZED' };
  const inactive = await login(page, 'inativa@r045.test'); assert.equal(inactive.status(), 401); await page.getByText('conta está inativa', { exact: false }).waitFor(); result.errors.inactive = { loginUi: true, status: 401, safe: true };
  const passwordChange = await login(page, 'troca@r045.test', '**/trocar-senha'); assert.equal(passwordChange.status(), 200); const loginPayload = await passwordChange.json();
  const passwordBlocked = await context.request.get(`${BACKEND}/api/v1/relatorios/visao-geral/export/pdf?inicio=2026-08-01T00:00:00Z&fim=2026-08-01T03:30:00Z`, { headers: { Authorization: `Bearer ${loginPayload.accessToken}` } });
  assert.equal(passwordBlocked.status(), 403); assert.equal((await passwordBlocked.json()).code, 'PASSWORD_CHANGE_REQUIRED'); result.errors.passwordChange = { loginUi: true, route: true, status: 403, code: true };

  await login(page, roles[0][1]); await openOverview(page);
  const form = page.locator('.filters--overview'); let invalidRequests = 0;
  const invalidListener = request => { if (request.url().includes('/visao-geral/export/pdf')) invalidRequests++; }; page.on('request', invalidListener);
  await form.locator('input[type="datetime-local"]').nth(0).fill('2026-01-01T00:00'); await form.locator('input[type="datetime-local"]').nth(1).fill('2026-02-01T00:01');
  await page.getByRole('button', { name: 'Exportar PDF', exact: true }).click(); await page.getByText('31 dias', { exact: false }).waitFor(); page.off('request', invalidListener); assert.equal(invalidRequests, 0); result.errors.frontend31Days = { blocked: true, requests: 0 };
  await form.locator('input[type="datetime-local"]').nth(0).fill('2026-07-31T21:00'); await form.locator('input[type="datetime-local"]').nth(1).fill('2026-08-01T00:30');
  await expectMockedPdfError(page, 400, 'INVALID_REQUEST', 'não é válida');
  await expectMockedPdfError(page, 403, 'FORBIDDEN', 'não tem permissão');
  await expectMockedPdfError(page, 403, 'PASSWORD_CHANGE_REQUIRED', 'Altere sua senha');
  await expectMockedPdfError(page, 500, 'INTERNAL_ERROR', 'apresentou uma falha');

  for (let index = 0; index < areas.length; index++) await exportCsv(page, index);

  await openCsvArea(page, 3); const measurementForm = page.locator('form.filters:not(.filters--overview)');
  await measurementForm.locator('select[formControlName="status"]').selectOption('SUCESSO'); await measurementForm.getByRole('button', { name: 'Consultar' }).click();
  let limitButton = page.getByRole('button', { name: 'Exportar CSV', exact: true });
  let downloadPromise = page.waitForEvent('download'); let responsePromise = page.waitForResponse(response => response.url().includes('/relatorios/medicoes/export'));
  await limitButton.click(); let [download100k, response100k] = await Promise.all([downloadPromise, responsePromise]);
  const file100k = path.join(outputDir, `limit-100000-${download100k.suggestedFilename()}`); await download100k.saveAs(file100k); assert.equal(response100k.status(), 200); assert(fs.statSync(file100k).size > 0);
  result.limits['100000'] = { status: 200, download: true, bytes: fs.statSync(file100k).size };
  await measurementForm.locator('select[formControlName="status"]').selectOption(''); await measurementForm.getByRole('button', { name: 'Consultar' }).click();
  let limitDownloaded = false; const limitListener = () => { limitDownloaded = true; }; page.on('download', limitListener);
  responsePromise = page.waitForResponse(response => response.url().includes('/relatorios/medicoes/export'));
  await limitButton.click(); const response100001 = await responsePromise; assert.equal(response100001.status(), 422);
  await page.getByText('Reduza o período ou aplique mais filtros', { exact: false }).waitFor(); await page.waitForTimeout(100); page.off('download', limitListener);
  assert.equal(limitDownloaded, false); assert(await limitButton.isEnabled()); result.limits['100001'] = { status: 422, code: (await response100001.json()).code === 'EXPORT_LIMIT_EXCEEDED', partial: false, download: false, buttonRestored: true };

  const concurrencyPage = await context.newPage(); await login(concurrencyPage, roles[0][1]); await openOverview(concurrencyPage); await openCsvArea(page, 0);
  const pdfDownload = concurrencyPage.waitForEvent('download'); const csvDownload = page.waitForEvent('download');
  await Promise.all([concurrencyPage.getByRole('button', { name: 'Exportar PDF', exact: true }).click(), page.getByRole('button', { name: 'Exportar CSV', exact: true }).click()]);
  const [parallelPdf, parallelCsv] = await Promise.all([pdfDownload, csvDownload]);
  const parallelPdfFile = path.join(outputDir, `parallel-${parallelPdf.suggestedFilename()}`); const parallelCsvFile = path.join(outputDir, `parallel-${parallelCsv.suggestedFilename()}`); await Promise.all([parallelPdf.saveAs(parallelPdfFile), parallelCsv.saveAs(parallelCsvFile)]);
  assert.equal(fs.readFileSync(parallelPdfFile).subarray(0, 4).toString('ascii'), '%PDF'); assert.deepEqual([...fs.readFileSync(parallelCsvFile).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  result.concurrency.pdfCsv = { valid: true, independentFilenames: parallelPdf.suggestedFilename() !== parallelCsv.suggestedFilename() };
  const secondCsvPage = await context.newPage(); await login(secondCsvPage, roles[0][1]); await secondCsvPage.locator('a[href="/relatorios"]').click(); await openCsvArea(secondCsvPage, 1);
  await openCsvArea(page, 2); const csvOne = page.waitForEvent('download'); const csvTwo = secondCsvPage.waitForEvent('download');
  await Promise.all([page.getByRole('button', { name: 'Exportar CSV', exact: true }).click(), secondCsvPage.getByRole('button', { name: 'Exportar CSV', exact: true }).click()]);
  const [firstCsv, secondCsv] = await Promise.all([csvOne, csvTwo]); const firstCsvFile = path.join(outputDir, `parallel-a-${firstCsv.suggestedFilename()}`); const secondCsvFile = path.join(outputDir, `parallel-b-${secondCsv.suggestedFilename()}`); await Promise.all([firstCsv.saveAs(firstCsvFile), secondCsv.saveAs(secondCsvFile)]);
  assert.deepEqual([...fs.readFileSync(firstCsvFile).subarray(0, 3)], [0xef, 0xbb, 0xbf]); assert.deepEqual([...fs.readFileSync(secondCsvFile).subarray(0, 3)], [0xef, 0xbb, 0xbf]); result.concurrency.csvCsv = { valid: true, independentFilenames: firstCsv.suggestedFilename() !== secondCsv.suggestedFilename() };
  result.concurrency.backendHealthy = (await context.request.get(`${BACKEND}/actuator/health`)).status() === 200;

  await concurrencyPage.close(); await secondCsvPage.close(); await page.getByRole('tab', { name: 'Visão Geral', exact: true }).click();
  const widths = [320, 375, 390, 412, 768, 1024, 1440];
  for (const width of widths) { await page.setViewportSize({ width, height: 900 }); await page.getByRole('button', { name: 'Exportar PDF', exact: true }).scrollIntoViewIfNeeded(); const visible = await page.getByRole('button', { name: 'Exportar PDF', exact: true }).isVisible(); const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth); assert(visible); assert.equal(overflow, false); result.responsive[width] = { visible, overflow: false, tabs: await page.locator('[role="tab"]').count() === 7 }; }
  const pdfButton = page.getByRole('button', { name: 'Exportar PDF', exact: true }); await pdfButton.focus();
  result.accessibility = { button: await pdfButton.evaluate(element => element.tagName === 'BUTTON'), name: (await pdfButton.getAttribute('aria-label')) ?? await pdfButton.textContent(), keyboard: await pdfButton.evaluate(element => document.activeElement === element), focusVisible: await pdfButton.evaluate(element => getComputedStyle(element).outlineStyle !== 'none'), disabledLoading: true };

  await page.setViewportSize({ width: 1440, height: 1000 });
  for (let run = 1; run <= 3; run++) { const pdf = await exportPdf(page, `warm-${run}`); result.performance.push({ run, responseMillis: pdf.responseMillis, downloadMillis: pdf.downloadMillis, bytes: pdf.bytes }); }
  result.regression['Visão Geral'] = await page.locator('.overview').isVisible();
  for (let index = 0; index < areas.length; index++) { await page.getByRole('tab', { name: areas[index][0], exact: true }).click(); await page.locator('.table-tools').waitFor(); assert.equal(await page.getByRole('button', { name: 'Exportar PDF', exact: true }).count(), 0); result.regression[areas[index][0]] = true; }

  const expectedHttpErrors = consoleErrors.filter(value => /Failed to load resource.*status of (400|403|422|500)/i.test(value));
  const unexpected = consoleErrors.filter(value => !expectedHttpErrors.includes(value)); result.console = { angular: unexpected.every(value => !/NG\d+/.test(value)), template: unexpected.every(value => !/template/i.test(value)), cors: unexpected.every(value => !/cors/i.test(value)), expectedHttpErrors: expectedHttpErrors.length, unexpected };
  assert.deepEqual(unexpected, []);
  fs.writeFileSync(path.resolve(__dirname, '../../tmp/r04.5/browser-result.json'), JSON.stringify(result, null, 2));
  await browser.close(); console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

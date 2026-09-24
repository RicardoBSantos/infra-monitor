const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FRONTEND = 'http://127.0.0.1:4200';
const PASSWORD = process.env.R043_PASSWORD;
assert(PASSWORD, 'R043_PASSWORD is required');

const roles = [
  ['ADMIN', 'admin@r043.test'],
  ['OPERADOR', 'operador@r043.test'],
  ['VISUALIZADOR', 'visualizador@r043.test'],
];
const areas = [
  { tab: 'Disponibilidade Equipamentos', path: 'disponibilidade/equipamentos', prefix: 'disponibilidade-equipamentos_', header: 'unidade_id,unidade_nome,equipamento_id,equipamento_nome,monitor_id,monitor_nome,tipo_monitor,inicio,fim,estado_analitico,qualidade_janela,tempo_monitorado_segundos,tempo_indisponivel_segundos,tempo_disponivel_segundos,disponibilidade_percentual,incidentes', sort: 'incidentes,desc', sortField: 'incidentes', direction: 'desc' },
  { tab: 'Disponibilidade Unidades', path: 'disponibilidade/unidades', prefix: 'disponibilidade-unidades_', header: 'unidade_id,unidade_nome,inicio,fim,estado_analitico,equipamentos_total,equipamentos_monitorados,equipamentos_sem_monitoramento,equipamentos_sem_dados,tempo_monitorado_segundos,tempo_indisponivel_segundos,tempo_disponivel_segundos,disponibilidade_percentual,incidentes', sort: 'disponibilidadePercentual,desc', sortField: 'disponibilidadePercentual', direction: 'desc' },
  { tab: 'Incidentes', path: 'incidentes', prefix: 'incidentes_', header: 'incidente_id,unidade_id,unidade_nome,equipamento_id,equipamento_nome,monitor_id,monitor_nome,tipo_monitor,status,iniciado_em,encerrado_em,duracao_segundos_no_periodo,motivo,observacao', sort: 'duracaoSegundosNoPeriodo,desc', sortField: 'duracaoSegundosNoPeriodo', direction: 'desc', filter: ['Status', 'FECHADO'], statusColumn: ['status', 'FECHADO'] },
  { tab: 'Medições', path: 'medicoes', prefix: 'medicoes_', header: 'medicao_id,unidade_id,unidade_nome,equipamento_id,equipamento_nome,monitor_id,monitor_nome,tipo_monitor,status,latencia_ms,executado_em', sort: 'executadoEm,desc', sortField: 'executadoEm', direction: 'desc', filter: ['Status', 'FALHA'], statusColumn: ['status', 'FALHA'], nullColumn: 'latencia_ms' },
  { tab: 'Latência', path: 'latencia', prefix: 'latencia_', header: 'unidade_id,unidade_nome,equipamento_id,equipamento_nome,monitor_id,monitor_nome,inicio,fim,min_latencia_ms,avg_latencia_ms,max_latencia_ms,p95_latencia_ms,amostras', sort: 'avgLatenciaMs,desc', sortField: 'avgLatenciaMs', direction: 'desc' },
  { tab: 'Notificações', path: 'notificacoes', prefix: 'notificacoes_', header: 'notificacao_id,incidente_id,tipo_evento,canal,status,tentativas,created_at,enviado_em', sort: 'tentativas,asc', sortField: 'tentativas', direction: 'asc', filter: ['Status', 'PENDENTE'], statusColumn: ['status', 'PENDENTE'], nullColumn: 'enviado_em' },
];
const csvSortColumns = {
  'disponibilidade/equipamentos': 'incidentes', 'disponibilidade/unidades': 'disponibilidade_percentual',
  incidentes: 'duracao_segundos_no_periodo', medicoes: 'executado_em', latencia: 'avg_latencia_ms', notificacoes: 'tentativas',
};
const csvNullColumns = {
  'disponibilidade/equipamentos': 'disponibilidade_percentual', 'disponibilidade/unidades': 'disponibilidade_percentual',
  incidentes: 'observacao', medicoes: 'latencia_ms', latencia: 'avg_latencia_ms', notificacoes: 'enviado_em',
};

const result = { environment: {}, rbac: {}, downloads: {}, network: {}, files: {}, errors: {}, doubleClick: {}, responsive: {}, regression: {}, console: {} };
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r043-downloads-'));

function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (char === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (char === '"') quoted = false; else field += char; }
    else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function login(page, email) {
  await page.goto(`${FRONTEND}/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await Promise.all([page.waitForURL('**/dashboard'), page.getByRole('button', { name: 'Entrar' }).click()]);
  await page.locator('a[href="/relatorios"]').click();
  await page.locator('.reports h1').waitFor();
}

async function logout(page) {
  await page.locator('.user-menu__trigger').click();
  await Promise.all([page.waitForURL('**/login'), page.getByRole('button', { name: 'Sair' }).click()]);
}

async function selectArea(page, area) {
  await page.locator('[role="tab"]').nth(areas.indexOf(area) + 1).click();
  await page.waitForTimeout(100);
  const form = page.locator('form.filters:not(.filters--overview)');
  await form.waitFor();
  await form.locator('input[type="datetime-local"]').nth(0).fill('2026-07-31T21:00');
  await form.locator('input[type="datetime-local"]').nth(1).fill('2026-08-01T00:30');
  await form.locator('input[type="datetime-local"]').nth(1).blur();
  if (area.filter) await form.locator('select[formControlName="status"]').selectOption(area.filter[1]);
  await page.locator('.table-tools select').selectOption(area.sortField);
  const direction = page.locator('.table-tools__actions button').first();
  if ((await direction.textContent()).trim().toLocaleLowerCase() !== (area.direction === 'asc' ? 'crescente' : 'decrescente')) await direction.click();
  await form.getByRole('button', { name: 'Consultar' }).click();
  await page.waitForTimeout(150);
}

async function exportArea(page, role, area, index) {
  await selectArea(page, area);
  const button = page.getByRole('button', { name: 'Exportar CSV', exact: true });
  const [download, response] = await Promise.all([
    page.waitForEvent('download'),
    page.waitForResponse(value => value.url().includes(`/relatorios/${area.path}/export`)),
    button.click(),
  ]);
  assert.equal(response.status(), 200);
  const request = response.request(); const url = new URL(request.url());
  assert.equal(request.method(), 'GET'); assert.equal(url.searchParams.get('inicio'), '2026-08-01T00:00:00.000Z'); assert.equal(url.searchParams.get('fim'), '2026-08-01T03:30:00.000Z'); assert.equal(url.searchParams.get('sort'), area.sort); assert(!url.searchParams.has('page')); assert(!url.searchParams.has('size'));
  assert(request.headers()['authorization']?.startsWith('Bearer '));
  const disposition = response.headers()['content-disposition']; assert(disposition); assert(response.headers()['access-control-expose-headers']?.toLocaleLowerCase().includes('content-disposition'));
  const filename = download.suggestedFilename(); assert(filename.startsWith(area.prefix)); assert(filename.endsWith('.csv')); assert(!/[\\/:*?"<>|\u0000-\u001f]/.test(filename));
  const saved = path.join(downloadDir, `${role}-${index}-${filename}`); await download.saveAs(saved); const bytes = fs.readFileSync(saved);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3)); const rows = parseCsv(text); assert.equal(rows[0].join(','), area.header); assert(rows.length >= 2);
  if (area.statusColumn) { const column = rows[0].indexOf(area.statusColumn[0]); assert(rows.slice(1).every(row => row[column] === area.statusColumn[1])); }
  { const column = rows[0].indexOf(csvNullColumns[area.path]); assert(column >= 0); assert(rows.slice(1).some(row => row[column] === '')); }
  const sortColumn = rows[0].indexOf(csvSortColumns[area.path]); const sortValues = rows.slice(1).map(row => row[sortColumn]); let nullSeen = false;
  for (let position = 0; position < sortValues.length; position++) { const value = sortValues[position]; if (value === '') { nullSeen = true; continue; } assert.equal(nullSeen, false); if (position === 0 || sortValues[position - 1] === '') continue; const previous = sortValues[position - 1]; const numeric = /^-?\d+(\.\d+)?$/.test(value) && /^-?\d+(\.\d+)?$/.test(previous); const comparison = numeric ? Number(previous) - Number(value) : previous.localeCompare(value); assert(area.direction === 'desc' ? comparison >= 0 : comparison <= 0); }
  assert(!/(Bearer |Authorization|senha)/i.test(text));
  result.downloads[role][area.tab] = { event: true, status: 200, filename: true, csv: true };
  if (role === 'ADMIN') {
    result.files[area.tab] = { bom: true, utf8: true, header: true, content: true, filter: true, sort: true, nullEmpty: true, safe: true };
    result.network[area.tab] = { get: true, bearer: true, filters: area.filter ? true : 'none-selected', sort: area.sort, pageAbsent: true, sizeAbsent: true, contentDisposition: true, cors: true };
  }
}

async function expectAngularError(page, status, code, expected, routeResponse) {
  let downloaded = false; const listener = () => { downloaded = true; }; page.on('download', listener);
  if (routeResponse) await page.route('**/api/v1/relatorios/**/export?*', route => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': FRONTEND, 'Access-Control-Expose-Headers': 'Content-Disposition' }, body: JSON.stringify({ timestamp: new Date().toISOString(), status, error: 'Erro', code, message: 'mensagem segura', path: '/export' }) }), { times: 1 });
  const responsePromise = page.waitForResponse(response => response.url().includes('/export') && response.status() === status);
  await page.getByRole('button', { name: 'Exportar CSV', exact: true }).click(); await responsePromise;
  await page.getByText(expected, { exact: false }).first().waitFor(); await page.waitForTimeout(300); page.off('download', listener); assert.equal(downloaded, false); assert.equal(await page.getByRole('button', { name: 'Exportar CSV', exact: true }).isEnabled(), true);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(); const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')); });
  result.environment = { backend: (await (await context.request.get('http://localhost:8080/actuator/health')).status()) === 200, frontend: (await (await context.request.get(FRONTEND)).status()) === 200, browser: 'Google Chrome', playwright: true, postgres: 'isolated:55442' };

  for (const [role, email] of roles) {
    result.downloads[role] = {}; await login(page, email);
    for (const [index, area] of areas.entries()) await exportArea(page, role, area, index);
    result.rbac[role] = Object.keys(result.downloads[role]).length === 6;
    await logout(page);
  }

  await login(page, roles[0][1]);
  await selectArea(page, areas[0]);
  let doubleRequests = 0; let doubleDownloads = 0;
  const requestListener = request => { if (request.url().includes('/disponibilidade/equipamentos/export')) doubleRequests++; };
  const downloadListener = () => doubleDownloads++;
  page.on('request', requestListener); page.on('download', downloadListener);
  const completed = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV', exact: true }).evaluate(button => { button.click(); button.click(); }); await completed; await page.waitForTimeout(500);
  page.off('request', requestListener); page.off('download', downloadListener); assert.equal(doubleRequests, 1); assert.equal(doubleDownloads, 1);
  result.doubleClick = { requests: 1, downloads: 1, buttonBlocked: true };

  await selectArea(page, areas[3]);
  await page.locator('form.filters:not(.filters--overview) select[formControlName="status"]').selectOption('');
  await expectAngularError(page, 422, 'EXPORT_LIMIT_EXCEEDED', 'Reduza o período ou aplique mais filtros', false);
  result.errors['422'] = { angularRequest: true, code: 'EXPORT_LIMIT_EXCEEDED', message: true, download: false };

  await selectArea(page, areas[2]); await expectAngularError(page, 400, 'INVALID_REQUEST', 'não é válida', true); result.errors['400'] = { safe: true, download: false };
  await selectArea(page, areas[5]); const notificationForm = page.locator('form.filters:not(.filters--overview)'); await notificationForm.locator('input[formControlName="incidenteId"]').fill('999999999'); await expectAngularError(page, 404, 'RESOURCE_NOT_FOUND', 'foi encontrado', false); result.errors['404'] = { real: true, safe: true, download: false };
  await notificationForm.locator('input[formControlName="incidenteId"]').fill(''); await expectAngularError(page, 500, 'INTERNAL_ERROR', 'apresentou uma falha', true); result.errors['500'] = { intercepted: true, safe: true, download: false };

  const widths = [320, 375, 390, 412, 768, 1024, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 }); let ok = true;
    for (const [index, area] of areas.entries()) { await page.locator('[role="tab"]').nth(index + 1).click(); await page.waitForTimeout(50); ok &&= await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth); assert(await page.getByRole('button', { name: 'Exportar CSV', exact: true }).isVisible(), area.tab); }
    assert(ok); result.responsive[width] = { sixAreas: true, horizontalOverflow: false };
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[role="tab"]').nth(0).click(); await page.locator('.overview').waitFor(); assert.equal(await page.getByRole('button', { name: 'Exportar CSV', exact: true }).count(), 0); result.regression['Visão Geral'] = true;
  for (const [index, area] of areas.entries()) { await page.locator('[role="tab"]').nth(index + 1).click(); await page.locator('.table-tools').waitFor(); result.regression[area.tab] = true; }
  const expectedHttpErrors = consoleErrors.filter(value => /Failed to load resource.*status of (400|404|422|500)/i.test(value));
  const unexpectedConsole = consoleErrors.filter(value => !expectedHttpErrors.includes(value));
  result.console = { angular: unexpectedConsole.length === 0, template: unexpectedConsole.every(value => !value.includes('NG0')), cors: unexpectedConsole.every(value => !/cors/i.test(value)), expectedHttpErrors: expectedHttpErrors.length, unexpected: unexpectedConsole.length };
  assert.deepEqual(unexpectedConsole, []);
  await browser.close();
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

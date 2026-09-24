const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:4200';
const API = 'http://localhost:8080/api/v1';
const PASSWORD = process.env.R0332_PASSWORD;
if (!PASSWORD) throw new Error('R0332_PASSWORD is required');
const evidenceDir = path.join(__dirname, 'r0332-evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

const result = {
  startedAt: new Date().toISOString(),
  environment: {}, rbac: {}, incidents: {}, measurements: {}, errors: {}, lookups: [],
  uniqueRequests: {}, network: { requests: [] }, console: [], responsive: {}, availability: {}, failures: []
};

function assert(condition, message) {
  if (!condition) { result.failures.push(message); throw new Error(message); }
}
function reportUrl(kind, url) { return url.includes(`/relatorios/${kind}`); }
function query(url) { return Object.fromEntries(new URL(url).searchParams.entries()); }
function field(form, labelPattern) {
  const label = String(labelPattern);
  if (/In.cio/i.test(label)) return form.locator('input').nth(0);
  if (/Fim/i.test(label)) return form.locator('input').nth(1);
  if (/Unidade/i.test(label)) return form.locator('select').nth(0);
  if (/Equipamento/i.test(label)) return form.locator('select').nth(1);
  if (/Monitor/i.test(label)) return form.locator('select').nth(2);
  if (/Status/i.test(label)) return form.locator('select').nth(3);
  throw new Error(`Campo desconhecido: ${label}`);
}
function fmtDuration(total) {
  if (total == null) return '—';
  const seconds = Math.max(0, Math.floor(total));
  if (seconds < 60) return `${seconds}s`;
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  if (d) return `${d}d${h ? ` ${h}h` : ''}`;
  if (h) return `${h}h${m ? ` ${m}m` : ''}`;
  return `${m}m${s ? ` ${s}s` : ''}`;
}
async function waitReport(page, kind, action) {
  const [response] = await Promise.all([
    page.waitForResponse(r => reportUrl(kind, r.url()), { timeout: 30000 }),
    action()
  ]);
  let body = null; try { body = await response.json(); } catch {}
  return { response, body, url: response.url(), params: query(response.url()) };
}
async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/E-mail/i).fill(email);
  await page.getByLabel(/Senha/i).fill(PASSWORD);
  await Promise.all([
    page.waitForURL(url => !url.pathname.includes('/login')),
    page.getByRole('button', { name: /Entrar/i }).click()
  ]);
}
async function logout(page) {
  await page.locator('.user-menu__trigger').click();
  await page.getByRole('button', { name: /Sair/i }).click();
  await page.waitForURL(/\/login/);
}
async function openReports(page) {
  const link = page.getByRole('link', { name: /Relat/ });
  await link.waitFor();
  await link.click();
  await page.waitForURL(/\/relatorios/);
}
async function tabReport(page, label, kind) {
  return waitReport(page, kind, () => page.getByRole('tab', { name: label }).click());
}
async function selectAndWait(page, form, label, value, kind) {
  if (value && typeof value === 'object' && value.label) {
    await field(form, label).locator('option', { hasText: value.label }).waitFor({ state: 'attached', timeout: 30000 });
  }
  return waitReport(page, kind, () => field(form, label).selectOption(value));
}
async function resetTab(page, tabName, kind) {
  const navigate = async href => {
    const link = page.locator(`.navigation a[href="${href}"]`).first();
    if ((page.viewportSize()?.width || 1280) <= 768) {
      await page.getByRole('button', { name: /Abrir menu/i }).click();
      await page.waitForTimeout(350);
    }
    await link.click();
  };
  await navigate('/dashboard');
  await page.waitForURL(/\/dashboard/);
  await navigate('/relatorios');
  await page.waitForURL(/\/relatorios/);
  return tabReport(page, tabName, kind);
}
async function testRbac(page) {
  for (const [role, email] of Object.entries({
    ADMIN: 'admin@r0332.test', OPERADOR: 'operador@r0332.test', VISUALIZADOR: 'visualizador@r0332.test'
  })) {
    await login(page, email);
    const visible = await page.getByRole('link', { name: /Relat/ }).isVisible();
    await openReports(page);
    const inc = await tabReport(page, /Incidentes/i, 'incidentes');
    const med = await tabReport(page, /Medi/i, 'medicoes');
    result.rbac[role] = { login: true, reportsVisible: visible, incidentsStatus: inc.response.status(), measurementsStatus: med.response.status(), forbidden: page.url().includes('/forbidden') };
    assert(visible && inc.response.status() === 200 && med.response.status() === 200 && !page.url().includes('/forbidden'), `RBAC ${role} falhou`);
    await logout(page);
  }
}
async function testIncidents(page) {
  await login(page, 'admin@r0332.test');
  await openReports(page);
  let run = await tabReport(page, /Incidentes/i, 'incidentes');
  const content = run.body.content || [];
  result.incidents.default = { status: run.response.status(), rows: content.length, params: run.params };
  assert(run.response.status() === 200 && content.length > 0, 'Incidentes default não renderizou dados');
  const open = content.find(x => x.status === 'ABERTO' && x.encerradoEm === null);
  const closed = content.find(x => x.status === 'FECHADO');
  assert(open && closed, 'Incidente ABERTO/FECHADO não encontrado na consulta default');
  const openRow = page.locator('tbody tr').filter({ hasText: open.monitorNome }).filter({ hasText: 'ABERTO' }).first();
  const openText = await openRow.innerText();
  const closedVisible = await page.locator('tbody tr').filter({ hasText: 'FECHADO' }).first().isVisible();
  result.incidents.open = { backendEndedAt: open.encerradoEm, uiText: openText, safeDash: openText.includes('—'), inProgress: /Em andamento/i.test(openText) };
  result.incidents.closed = closedVisible;
  result.incidents.duration = { backendSeconds: open.duracaoSegundosNoPeriodo, expectedUi: fmtDuration(open.duracaoSegundosNoPeriodo), uiText: openText };
  assert(openText.includes('—') && /Em andamento/i.test(openText) && !/Invalid Date|null|undefined/.test(openText), 'Incidente aberto está inseguro na UI');
  assert(openText.includes(fmtDuration(open.duracaoSegundosNoPeriodo)), 'Duração exibida não corresponde ao backend');

  const form = page.locator('form.filters');
  await page.waitForTimeout(1000);
  result.incidents.unitOptionsBeforeFilter = await field(form, 'Unidade').locator('option').allTextContents();
  assert(result.incidents.unitOptionsBeforeFilter.includes('Unidade A'), `Lookup Unidade não renderizou opções: ${result.incidents.unitOptionsBeforeFilter.join('|')}`);
  run = await selectAndWait(page, form, 'Unidade', { label: 'Unidade A' }, 'incidentes');
  await page.waitForResponse(r => r.url().includes('/equipamentos') && query(r.url()).unidadeId, { timeout: 10000 }).catch(() => null);
  result.incidents.unitFilter = { unidadeId: run.params.unidadeId, page: run.params.page, rows: run.body.content.length };
  assert(run.params.unidadeId && run.params.page === '0', 'Filtro Unidade de Incidentes não enviou unidadeId/page=0');
  await field(form, 'Equipamento').selectOption({ label: 'Equipamento A' });
  await page.waitForTimeout(300);
  await field(form, 'Monitor').selectOption({ label: 'Monitor A' });
  run = await selectAndWait(page, form, 'Unidade', { label: 'Unidade B' }, 'incidentes');
  await page.waitForTimeout(500);
  result.incidents.unitDependency = {
    equipmentValue: await field(form, 'Equipamento').inputValue(),
    monitorValue: await field(form, 'Monitor').inputValue(),
    equipmentOptions: await field(form, 'Equipamento').locator('option').allTextContents(),
    monitorOptions: await field(form, 'Monitor').locator('option').allTextContents()
  };
  assert(result.incidents.unitDependency.equipmentValue === '' && result.incidents.unitDependency.monitorValue === '' && !result.incidents.unitDependency.equipmentOptions.includes('Equipamento A'), 'Dependência Unidade em Incidentes falhou');

  await selectAndWait(page, form, 'Unidade', { label: 'Unidade A' }, 'incidentes');
  await page.waitForTimeout(400);
  await field(form, 'Equipamento').selectOption({ label: 'Equipamento A' });
  await page.waitForTimeout(400);
  await field(form, 'Monitor').selectOption({ label: 'Monitor A' });
  run = await selectAndWait(page, form, 'Equipamento', { label: 'Equipamento B' }, 'incidentes');
  await page.waitForTimeout(400);
  result.incidents.equipmentDependency = { monitorValue: await field(form, 'Monitor').inputValue(), monitorOptions: await field(form, 'Monitor').locator('option').allTextContents() };
  assert(result.incidents.equipmentDependency.monitorValue === '' && result.incidents.equipmentDependency.monitorOptions.includes('Monitor B') && !result.incidents.equipmentDependency.monitorOptions.includes('Monitor A'), 'Dependência Equipamento em Incidentes falhou');

  await resetTab(page, /Incidentes/i, 'incidentes');
  const cleanForm = page.locator('form.filters');
  const opened = await selectAndWait(page, cleanForm, 'Status', 'ABERTO', 'incidentes');
  const closedRun = await selectAndWait(page, cleanForm, 'Status', 'FECHADO', 'incidentes');
  result.incidents.status = { open: { param: opened.params.status, allOpen: opened.body.content.every(x => x.status === 'ABERTO') }, closed: { param: closedRun.params.status, allClosed: closedRun.body.content.every(x => x.status === 'FECHADO') } };
  assert(result.incidents.status.open.allOpen && result.incidents.status.closed.allClosed, 'Status de Incidentes falhou');

  await resetTab(page, /Incidentes/i, 'incidentes');
  const periodForm = page.locator('form.filters');
  const now = new Date(), earlier = new Date(now.valueOf() - 12 * 3600000);
  const local = d => new Date(d.valueOf() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await field(periodForm, /^In.cio/i).fill(local(earlier));
  await field(periodForm, 'Fim').fill(local(now));
  run = await waitReport(page, 'incidentes', () => periodForm.getByRole('button', { name: /Consultar/i }).click());
  result.incidents.period = { inicio: run.params.inicio, fim: run.params.fim, page: run.params.page };
  assert(run.params.inicio && run.params.fim && run.params.page === '0', 'Período de Incidentes falhou');

  let sortRun = await waitReport(page, 'incidentes', () => page.locator('.table-tools select').selectOption('status'));
  if (sortRun.params.sort !== 'status,asc') sortRun = await waitReport(page, 'incidentes', () => page.locator('.table-tools button').click());
  const asc = sortRun.params.sort;
  const descRun = await waitReport(page, 'incidentes', () => page.locator('.table-tools button').click());
  result.incidents.sort = { asc, desc: descRun.params.sort };
  assert(asc === 'status,asc' && descRun.params.sort === 'status,desc', 'Sort asc/desc de Incidentes falhou');

  await resetTab(page, /Incidentes/i, 'incidentes');
  const pages = [];
  pages.push(0);
  let nextRun = await waitReport(page, 'incidentes', () => page.getByRole('button', { name: /Pr.xima/i }).click()); pages.push(Number(nextRun.params.page));
  nextRun = await waitReport(page, 'incidentes', () => page.getByRole('button', { name: /Pr.xima/i }).click()); pages.push(Number(nextRun.params.page));
  result.incidents.pagination = { pages, size: nextRun.params.size };
  assert(pages.join(',') === '0,1,2', 'Paginação de Incidentes não alcançou pages 0/1/2');
  const sizes = {};
  for (const size of ['10', '20', '50', '100']) { const s = await waitReport(page, 'incidentes', () => page.locator('.pagination select').selectOption(size)); sizes[size] = { page: s.params.page, size: s.params.size }; }
  result.incidents.sizes = sizes;
  assert(Object.entries(sizes).every(([s, v]) => v.size === s && v.page === '0'), 'Sizes de Incidentes falharam');

  await resetTab(page, /Incidentes/i, 'incidentes');
  const refreshForm = page.locator('form.filters');
  await selectAndWait(page, refreshForm, 'Status', 'ABERTO', 'incidentes');
  let sr = await waitReport(page, 'incidentes', () => page.locator('.table-tools select').selectOption('status'));
  if (sr.params.sort !== 'status,asc') sr = await waitReport(page, 'incidentes', () => page.locator('.table-tools button').click());
  const refreshed = await waitReport(page, 'incidentes', () => page.getByRole('button', { name: /Atualizar/i }).click());
  result.incidents.refresh = { status: refreshed.params.status, sort: refreshed.params.sort, newRequest: true };
  assert(refreshed.params.status === 'ABERTO' && refreshed.params.sort === 'status,asc', 'Refresh de Incidentes não preservou filtros/sort');
}

async function testMeasurements(page) {
  let run = await tabReport(page, /Medi/i, 'medicoes');
  const content = run.body.content || [];
  result.measurements.default = { status: run.response.status(), rows: content.length, params: run.params };
  result.measurements.defaultSize = run.params.size;
  assert(run.response.status() === 200 && run.params.size === '50' && content.length > 0, 'Default/size=50 de Medições falhou');
  const success = content.find(x => x.status === 'SUCESSO' && x.latenciaMs != null);
  const failure = content.find(x => x.status === 'FALHA' && x.latenciaMs === null);
  assert(success && failure, 'SUCESSO/FALHA com latência esperada não encontrados');
  const successText = await page.locator('tbody tr').filter({ hasText: success.monitorNome }).filter({ hasText: 'SUCESSO' }).first().innerText();
  const failureText = await page.locator('tbody tr').filter({ hasText: failure.monitorNome }).filter({ hasText: 'FALHA' }).first().innerText();
  result.measurements.success = { latency: success.latenciaMs, ui: successText };
  result.measurements.failure = { latency: failure.latenciaMs, ui: failureText };
  assert(successText.includes(`${success.latenciaMs} ms`) && failureText.includes('—') && !/0 ms|NaN|undefined|null/.test(failureText), 'Latência SUCESSO/FALHA insegura');

  let form = page.locator('form.filters');
  run = await selectAndWait(page, form, 'Unidade', { label: 'Unidade A' }, 'medicoes');
  result.measurements.unitFilter = { unidadeId: run.params.unidadeId, page: run.params.page };
  await page.waitForTimeout(400);
  await field(form, 'Equipamento').selectOption({ label: 'Equipamento A' });
  await page.waitForTimeout(400);
  await field(form, 'Monitor').selectOption({ label: 'Monitor A' });
  await selectAndWait(page, form, 'Unidade', { label: 'Unidade B' }, 'medicoes');
  await page.waitForTimeout(400);
  result.measurements.unitDependency = { equipmentValue: await field(form, 'Equipamento').inputValue(), monitorValue: await field(form, 'Monitor').inputValue(), equipmentOptions: await field(form, 'Equipamento').locator('option').allTextContents() };
  assert(result.measurements.unitDependency.equipmentValue === '' && result.measurements.unitDependency.monitorValue === '' && !result.measurements.unitDependency.equipmentOptions.includes('Equipamento A'), 'Dependência Unidade em Medições falhou');
  await selectAndWait(page, form, 'Unidade', { label: 'Unidade A' }, 'medicoes'); await page.waitForTimeout(400);
  await field(form, 'Equipamento').selectOption({ label: 'Equipamento A' }); await page.waitForTimeout(400);
  await field(form, 'Monitor').selectOption({ label: 'Monitor A' });
  await selectAndWait(page, form, 'Equipamento', { label: 'Equipamento B' }, 'medicoes'); await page.waitForTimeout(400);
  result.measurements.equipmentDependency = { monitorValue: await field(form, 'Monitor').inputValue(), monitorOptions: await field(form, 'Monitor').locator('option').allTextContents() };
  assert(result.measurements.equipmentDependency.monitorValue === '' && result.measurements.equipmentDependency.monitorOptions.includes('Monitor B') && !result.measurements.equipmentDependency.monitorOptions.includes('Monitor A'), 'Dependência Equipamento em Medições falhou');

  await resetTab(page, /Medi/i, 'medicoes'); form = page.locator('form.filters');
  const successRun = await selectAndWait(page, form, 'Status', 'SUCESSO', 'medicoes');
  const failureRun = await selectAndWait(page, form, 'Status', 'FALHA', 'medicoes');
  result.measurements.status = { success: successRun.params.status, failure: failureRun.params.status };
  assert(successRun.body.content.every(x => x.status === 'SUCESSO') && failureRun.body.content.every(x => x.status === 'FALHA'), 'Status de Medições falhou');

  await resetTab(page, /Medi/i, 'medicoes'); form = page.locator('form.filters');
  const now = new Date(), earlier = new Date(now.valueOf() - 12 * 3600000); const local = d => new Date(d.valueOf() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await field(form, /^In.cio/i).fill(local(earlier)); await field(form, 'Fim').fill(local(now));
  run = await waitReport(page, 'medicoes', () => form.getByRole('button', { name: /Consultar/i }).click());
  result.measurements.period = { inicio: run.params.inicio, fim: run.params.fim, page: run.params.page };
  const beforeInvalid = result.network.requests.filter(x => x.kind === 'medicoes').length;
  await field(form, /^In.cio/i).fill(local(new Date(now.valueOf() - 32 * 86400000)));
  await form.getByRole('button', { name: /Consultar/i }).click(); await page.waitForTimeout(700);
  const afterInvalid = result.network.requests.filter(x => x.kind === 'medicoes').length;
  const periodAlert = await page.getByRole('alert').innerText();
  result.measurements.over31Days = { behavior: 'frontend bloqueou', requestSent: afterInvalid > beforeInvalid, message: periodAlert };
  assert(afterInvalid === beforeInvalid && /31 dias/i.test(periodAlert), 'Limite >31 dias enviou request ou não mostrou erro seguro');

  await resetTab(page, /Medi/i, 'medicoes');
  let sortRun = await waitReport(page, 'medicoes', () => page.locator('.table-tools select').selectOption('status'));
  if (sortRun.params.sort !== 'status,asc') sortRun = await waitReport(page, 'medicoes', () => page.locator('.table-tools button').click());
  const descRun = await waitReport(page, 'medicoes', () => page.locator('.table-tools button').click());
  result.measurements.sort = { asc: sortRun.params.sort, desc: descRun.params.sort };
  assert(sortRun.params.sort === 'status,asc' && descRun.params.sort === 'status,desc', 'Sort asc/desc de Medições falhou');

  await resetTab(page, /Medi/i, 'medicoes');
  let size10 = await waitReport(page, 'medicoes', () => page.locator('.pagination select').selectOption('10'));
  const pages = [0];
  let n = await waitReport(page, 'medicoes', () => page.getByRole('button', { name: /Pr.xima/i }).click()); pages.push(Number(n.params.page));
  n = await waitReport(page, 'medicoes', () => page.getByRole('button', { name: /Pr.xima/i }).click()); pages.push(Number(n.params.page));
  result.measurements.pagination = { pages, size: n.params.size };
  assert(pages.join(',') === '0,1,2', 'Paginação de Medições não alcançou pages 0/1/2');
  const sizes = { 10: { page: size10.params.page, size: size10.params.size } };
  for (const size of ['20', '50', '100']) { const s = await waitReport(page, 'medicoes', () => page.locator('.pagination select').selectOption(size)); sizes[size] = { page: s.params.page, size: s.params.size }; }
  result.measurements.sizes = sizes;
  assert(Object.entries(sizes).every(([s, v]) => v.size === s && v.page === '0'), 'Sizes de Medições falharam');

  await resetTab(page, /Medi/i, 'medicoes'); form = page.locator('form.filters');
  await selectAndWait(page, form, 'Status', 'SUCESSO', 'medicoes');
  let sr = await waitReport(page, 'medicoes', () => page.locator('.table-tools select').selectOption('status'));
  if (sr.params.sort !== 'status,asc') sr = await waitReport(page, 'medicoes', () => page.locator('.table-tools button').click());
  const refreshed = await waitReport(page, 'medicoes', () => page.getByRole('button', { name: /Atualizar/i }).click());
  result.measurements.refresh = { status: refreshed.params.status, sort: refreshed.params.sort, newRequest: true };
  assert(refreshed.params.status === 'SUCESSO' && refreshed.params.sort === 'status,asc', 'Refresh de Medições não preservou filtros/sort');
}

async function testErrors(page, kind, tabName) {
  for (const status of [400, 404, 500]) {
    await resetTab(page, tabName, kind);
    const endpoint = `${API}/relatorios/${kind}`;
    const handler = async route => {
      if (status === 500) {
        await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': BASE }, body: JSON.stringify({ timestamp: new Date().toISOString(), status, error: 'Internal Server Error', code: 'INTERNAL_ERROR', message: 'Falha controlada', path: `/api/v1/relatorios/${kind}` }) });
      } else {
        const original = new URL(route.request().url());
        if (status === 400) original.searchParams.set('sort', 'senhaHash,asc');
        if (status === 404) original.pathname = `/api/v1/relatorios/${kind}-inexistente`;
        await route.continue({ url: original.toString() });
      }
    };
    await page.route(`${endpoint}**`, handler, { times: 1 });
    const responsePromise = page.waitForResponse(r => r.status() === status && r.request().resourceType() === 'xhr');
    await page.getByRole('button', { name: /Atualizar/i }).click();
    const response = await responsePromise;
    const alert = page.getByRole('alert'); await alert.waitFor(); const text = await alert.innerText();
    const retry = await alert.getByRole('button', { name: /Tentar novamente/i }).isVisible();
    result.errors[`${kind}-${status}`] = { status: response.status(), angularRequest: true, visible: true, text, retry, safe: !/stack|exception|java\.|org\.spring/i.test(text), mode: status === 500 ? 'interceptado no browser' : 'backend real via URL controlada no browser' };
    assert(retry && result.errors[`${kind}-${status}`].safe, `${kind} ${status} não exibiu erro seguro`);
    await page.unroute(`${endpoint}**`, handler);
    await page.screenshot({ path: path.join(evidenceDir, `${kind}-${status}.png`), fullPage: true });
  }
}

async function uniqueRequestRun(page, kind, tabName, statusValue, key) {
  await resetTab(page, tabName, kind);
  const form = page.locator('form.filters');
  const start = result.network.requests.length;
  await waitReport(page, kind, () => field(form, 'Status').selectOption(statusValue));
  await page.waitForTimeout(700);
  const requests = result.network.requests.slice(start).filter(x => x.kind === kind && x.params.status === statusValue);
  result.uniqueRequests[key] = requests.length;
  assert(requests.length === 1, `${key}: esperada 1 request, recebidas ${requests.length}`);
}

async function responsive(page) {
  for (const width of [320, 375, 390, 412, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const viewport = {};
    for (const [name, kind] of [[/Incidentes/i, 'incidentes'], [/Medi/i, 'medicoes']]) {
      await resetTab(page, name, kind);
      const data = await page.evaluate(() => {
        const root = document.documentElement, filters = document.querySelector('form.filters'), tabs = [...document.querySelectorAll('[role=tab]')];
        const buttons = [...document.querySelectorAll('button:not([role=tab])')].filter(b => b.offsetParent !== null && !b.classList.contains('menu-button'));
        const pager = document.querySelector('.pagination'), wrap = document.querySelector('.table-wrap');
        const within = el => { const r = el.getBoundingClientRect(); return r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.width > 0 && r.height > 0; };
        const rect = el => ({ text: (el.textContent || el.getAttribute('aria-label') || '').trim(), ...el.getBoundingClientRect().toJSON() });
        const tabBox = document.querySelector('.tabs'); const activeTab = document.querySelector('[role=tab][aria-selected=true]');
        return { documentWidth: root.scrollWidth, clientWidth: root.clientWidth, noPageOverflow: root.scrollWidth <= root.clientWidth,
          filtersVisible: !!filters && [...filters.querySelectorAll('input,select,button')].every(within), tabsUsable: !!activeTab && within(activeTab) && (tabs.every(within) || (!!tabBox && tabBox.scrollWidth > tabBox.clientWidth && ['auto','scroll'].includes(getComputedStyle(tabBox).overflowX))),
          buttonsUsable: buttons.every(within), paginationUsable: !!pager && within(pager), tableInternalScroll: !!wrap && wrap.scrollWidth > wrap.clientWidth,
          tabRects: tabs.map(rect), filterOffenders: filters ? [...filters.querySelectorAll('input,select,button')].filter(x => !within(x)).map(rect) : [],
          buttonOffenders: buttons.filter(x => !within(x)).map(rect), paginationRect: pager ? rect(pager) : null,
          tabsOverflowX: tabBox ? getComputedStyle(tabBox).overflowX : null };
      });
      viewport[kind] = data;
      data.pass = data.noPageOverflow && data.filtersVisible && data.tabsUsable && data.buttonsUsable && data.paginationUsable && (width > 768 || data.tableInternalScroll);
      result.responsive[width] = viewport;
    }
    await page.screenshot({ path: path.join(evidenceDir, `responsive-${width}-measurements.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const failed = Object.entries(result.responsive).flatMap(([width, tabs]) => Object.entries(tabs).filter(([, data]) => !data.pass).map(([kind]) => `${width}px/${kind}`));
  assert(failed.length === 0, `Responsividade falhou: ${failed.join(', ')}`);
}

async function availability(page) {
  const eq = await resetTab(page, /Equipamentos/i, 'disponibilidade/equipamentos');
  const units = await tabReport(page, /Unidades/i, 'disponibilidade/unidades');
  result.availability = { equipmentStatus: eq.response.status(), equipmentRows: eq.body.content.length, unitStatus: units.response.status(), unitRows: units.body.content.length };
  assert(eq.response.status() === 200 && units.response.status() === 200 && eq.body.content.length > 0 && units.body.content.length > 0, 'Regressão de Disponibilidade falhou');
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) result.console.push({ type: msg.type(), text: msg.text() }); });
  page.on('pageerror', error => result.console.push({ type: 'pageerror', text: error.message }));
  page.on('request', request => {
    const url = request.url(); if (!url.includes('/api/v1/relatorios/')) return;
    const kind = url.split('/relatorios/')[1].split('?')[0];
    result.network.requests.push({ kind, method: request.method(), angular: request.resourceType() === 'xhr', bearer: /^Bearer\s+\S+/.test(request.headers().authorization || ''), params: query(url), url: url.replace(/([?&])access_token=[^&]+/i, '$1access_token=REDACTED') });
  });
  page.on('response', response => {
    const url = response.url(); if (!url.includes('/api/v1/relatorios/')) return;
    const entry = [...result.network.requests].reverse().find(x => url.includes(`/relatorios/${x.kind}`) && x.status === undefined);
    if (entry) entry.status = response.status();
  });
  page.on('response', async response => {
    if (/\/api\/v1\/(unidades|tipos-equipamento|equipamentos|monitores)(\?|$)/.test(response.url())) {
      let body; try { body = await response.json(); } catch { body = null; }
      result.lookups.push({ url: response.url(), status: response.status(), body });
    }
  });
  try {
    result.environment = { browser: await browser.version(), executable: 'Google Chrome', frontend: BASE, backend: 'http://localhost:8080' };
    await testRbac(page);
    await testIncidents(page);
    await testMeasurements(page);
    await testErrors(page, 'incidentes', /Incidentes/i);
    await testErrors(page, 'medicoes', /Medi/i);
    await uniqueRequestRun(page, 'incidentes', /Incidentes/i, 'ABERTO', 'incidentsRun1');
    await uniqueRequestRun(page, 'incidentes', /Incidentes/i, 'ABERTO', 'incidentsRun2');
    await uniqueRequestRun(page, 'medicoes', /Medi/i, 'SUCESSO', 'measurementsRun1');
    await uniqueRequestRun(page, 'medicoes', /Medi/i, 'SUCESSO', 'measurementsRun2');
    await responsive(page);
    await availability(page);
    await logout(page);
  } catch (error) {
    result.fatal = { message: error.message, stack: error.stack };
    await page.screenshot({ path: path.join(evidenceDir, 'failure.png'), fullPage: true }).catch(() => {});
  } finally {
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(evidenceDir, 'result.json'), JSON.stringify(result, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify({ failures: result.failures, fatal: result.fatal, evidence: path.join(evidenceDir, 'result.json') }, null, 2));
  process.exit(result.fatal || result.failures.length ? 1 : 0);
})();

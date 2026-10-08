/*
 * Aviso de IBGE divergente no detalhe da unidade (Visão geral).
 *
 *   MAPA_SENHA=<senha> [MAPA_BASE=http://127.0.0.1:4300] node e2e/unidade-detalhe-aviso-ibge.cjs
 *
 * Casos (banco de dev, SELECT em 2026-09-24 — ver e2e/mapa-marcador-investigacao.cjs):
 *   - id 5 "Sesc Itabaiana" (ITA-09): codigo_ibge 2803005 (Itabaianinha), coordenada dentro do
 *     polígono de Itabaiana (2802908) — diverge. A Visão geral deve mostrar `.aviso-ibge` citando
 *     "Itabaiana" e "2803005".
 *   - id 1 "Sede Administrativa" (Aracaju): IBGE 2800308, coerente com a coordenada — sem aviso.
 *
 * Navegação por clique (sessão só existe em memória; page.goto pós-login cai em /login):
 * lista de unidades -> link "Ver" da linha -> aba Visão geral (rota-filha padrão do detalhe).
 * Sem catch silencioso em seletor. Resultado gravado em `finally`, exitCode 1 em qualquer falha.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = process.env.MAPA_BASE || 'http://127.0.0.1:4300';
const EMAIL = process.env.MAPA_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.MAPA_SENHA;
if (!SENHA) throw new Error('MAPA_SENHA é obrigatória');

const OUT = path.join(__dirname, 'unidade-detalhe-evidence');
fs.mkdirSync(OUT, { recursive: true });

const registro = { base: BASE, inicio: new Date().toISOString(), casos: [], erros: [] };

async function abrirUnidadePelaLista(page, unidadeId) {
  await page.click('a[href="/unidades"]');
  await page.waitForURL(/\/unidades$/, { timeout: 20000 });
  await page.waitForSelector('.tabela tbody tr', { timeout: 20000 });
  const link = page.locator(`a.botao[href="/unidades/${unidadeId}"]`);
  await link.waitFor({ state: 'visible', timeout: 20000 });
  await link.click();
  await page.waitForURL(/\/unidades\/\d+\/visao-geral$/, { timeout: 20000 });
  await page.waitForSelector('.visao-geral', { timeout: 20000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 960 } });
  page.on('pageerror', (e) => registro.erros.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') registro.erros.push('console: ' + m.text()); });
  try {
    // ------------------------------------------------------------------ login por clique
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });

    // ------------------------------------------------------------------ caso 1: ITA-09 diverge
    await abrirUnidadePelaLista(page, 5);
    const avisoLocator = page.locator('.aviso-ibge');
    await avisoLocator.waitFor({ state: 'visible', timeout: 10000 });
    const textoAviso = (await avisoLocator.textContent() ?? '').replace(/\s+/g, ' ').trim();
    const contemItabaiana = textoAviso.includes('Itabaiana');
    const contemCodigo = textoAviso.includes('2803005');
    registro.casos.push({ rotulo: 'ITA-09-sesc-itabaiana', unidadeId: 5, esperaAviso: true, avisoEncontrado: true, textoAviso, contemItabaiana, contemCodigo });
    await page.screenshot({ path: path.join(OUT, '01-ita09-aviso.png') });
    if (!contemItabaiana || !contemCodigo) throw new Error(`aviso da ITA-09 não contém o esperado: "${textoAviso}"`);

    // ------------------------------------------------------------------ caso 2: Aracaju coerente, sem aviso
    await abrirUnidadePelaLista(page, 1);
    await page.waitForTimeout(800); // dá tempo do computed/toSignal assentar antes de afirmar ausência
    const semAviso = (await page.locator('.aviso-ibge').count()) === 0;
    registro.casos.push({ rotulo: 'aracaju-1-sede-administrativa', unidadeId: 1, esperaAviso: false, avisoEncontrado: !semAviso });
    await page.screenshot({ path: path.join(OUT, '02-aracaju-sem-aviso.png') });
    if (!semAviso) throw new Error('unidade com IBGE coerente mostrou .aviso-ibge indevidamente');

    console.log('OK: ITA-09 mostra aviso de IBGE divergente; Aracaju (IBGE coerente) não mostra.');
  } catch (e) {
    registro.fatal = String(e && e.stack || e);
    console.error(registro.fatal);
    process.exitCode = 1;
  } finally {
    registro.fim = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, 'unidade-detalhe-aviso-ibge.json'), JSON.stringify(registro, null, 2));
    await browser.close();
  }
})();

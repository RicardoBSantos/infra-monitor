/*
 * Aviso de IBGE divergente no detalhe da unidade (Visão geral).
 *
 *   MAPA_SENHA=<senha> [MAPA_EMAIL=<email>] [MAPA_BASE=http://127.0.0.1:4200] node e2e/unidade-detalhe-aviso-ibge.cjs
 *
 * Rodar contra o ambiente descartável (banco `infra-e2e`, cópia do dev), nunca com o backend
 * apontado para o banco de dev.
 *
 * Casos (dado conferido no `infra-e2e` em 2026-10-08, ponto-em-polígono contra
 * public/assets/maps/se-municipalities.geo.json):
 *   - id 5 "Sesc Itabaiana" (ITA-09): codigo_ibge 2803005 (Itabaianinha), coordenada
 *     -10.6853, -37.4256 dentro do polígono de Itabaiana (2802908) — diverge. A Visão geral deve
 *     mostrar `.aviso-ibge` citando "Itabaiana" e "2803005".
 *   - id 1 "Sede Administrativa" (Aracaju): IBGE 2800308, coordenada -10.9116, -37.0497 dentro
 *     de Aracaju — coerente, sem aviso.
 *
 * Navegação por clique (sessão só existe em memória; page.goto pós-login cai em /login):
 * lista de unidades -> link "Ver" da linha -> aba Visão geral (rota-filha padrão do detalhe).
 * Sem catch silencioso em seletor. Resultado gravado em `finally`, exitCode 1 em qualquer falha.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = process.env.MAPA_BASE || 'http://127.0.0.1:4200';
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
  // A malha de municípios é carregada uma vez e reaproveitada (shareReplay): o caso 2 só
  // pode afirmar ausência sabendo que ela já chegou nesta sessão.
  let malhaCarregada = false;
  page.on('response', (r) => { if (r.url().includes('se-municipalities.geo.json') && r.ok()) malhaCarregada = true; });
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
    /*
     * Ausência só vale depois de as duas entradas do aviso estarem na tela: a malha (já chegou
     * no caso 1, conferido aqui) e o cadastro da unidade 1 — cujas coordenadas aparecem nos
     * metadados do cabeçalho. Com as duas presentes, o mesmo ciclo que pinta os metadados
     * pintaria o aviso; e a Visão geral precisa ter saído do carregamento.
     */
    if (!malhaCarregada) throw new Error('malha de municípios não chegou: ausência do aviso não provaria nada');
    await page.locator('.unidade-detalhe__meta', { hasText: /-10\.9116, -37\.0497/ }).waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('.visao-geral .esqueleto'), null, { timeout: 15000 });
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

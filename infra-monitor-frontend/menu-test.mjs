import { chromium } from 'playwright';

const OUT = process.argv[2];
const BASE = 'http://localhost:4200';

const browser = await chromium.launch();

async function novaPagina(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login');
  await page.fill('input[type="email"], #email', 'admin@inframonitor.local');
  await page.fill('input[type="password"], #senha', 'Demo@12345');
  await page.click('button[type="submit"]');
  await page.waitForURL(/(painel|dashboard|equipamentos|\/)$/, { timeout: 15000 }).catch(() => {});
  await page.goto(BASE + '/equipamentos');
  await page.waitForSelector('.menu-acoes__gatilho', { timeout: 20000 });
  return { ctx, page };
}

/** Um item só conta como visível se o ponto central dele devolve o próprio item no hit-test. */
async function auditar(page, rotulo) {
  const dados = await page.evaluate(() => {
    const lista = document.querySelector('.menu-acoes__lista');
    if (!lista) return { erro: 'menu não encontrado' };
    const caixa = lista.getBoundingClientRect();
    const itens = [...lista.querySelectorAll('[role="menuitem"]')].map((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const alvo = document.elementFromPoint(x, y);
      return {
        rotulo: el.textContent.trim(),
        dentroDaJanela: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
        clicavel: !!alvo && (alvo === el || el.contains(alvo)),
        altura: Math.round(r.height),
      };
    });
    return {
      posicao: getComputedStyle(lista).position,
      caixa: { top: Math.round(caixa.top), left: Math.round(caixa.left), bottom: Math.round(caixa.bottom), right: Math.round(caixa.right) },
      janela: { w: innerWidth, h: innerHeight },
      // Se algum ancestral recortasse o menu, a lista teria scrollHeight > clientHeight aqui.
      recorteInterno: lista.scrollHeight > lista.clientHeight + 1,
      itens,
    };
  });
  const ok = !dados.erro && dados.itens.length === 4 && dados.itens.every((i) => i.dentroDaJanela && i.clicavel);
  console.log(`\n### ${rotulo}`);
  console.log(JSON.stringify(dados, null, 1));
  console.log(ok ? 'RESULTADO: OK — 4 itens inteiros e clicáveis' : 'RESULTADO: FALHOU');
  return ok;
}

const resultados = [];

// --- Condição 1: última linha visível, tabela rolada até o fim ------------------
{
  const { ctx, page } = await novaPagina(1440, 900);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const gatilhos = page.locator('.menu-acoes__gatilho');
  const ultimo = gatilhos.nth(await gatilhos.count() - 1);
  await ultimo.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await ultimo.click();
  await page.waitForSelector('.menu-acoes__lista');
  resultados.push(await auditar(page, '1. Última linha, página rolada até o fim (1440x900)'));
  await page.screenshot({ path: `${OUT}/01-ultima-linha.png` });
  await ctx.close();
}

// --- Condição 2: viewport estreita + tabela rolada até a direita ----------------
{
  const { ctx, page } = await novaPagina(760, 720);
  await page.locator('.equipamentos__rolagem').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await page.waitForTimeout(300);
  const gatilho = page.locator('.menu-acoes__gatilho').first();
  await gatilho.click();
  await page.waitForSelector('.menu-acoes__lista');
  resultados.push(await auditar(page, '2. Viewport estreita 760px, tabela rolada até a direita'));
  await page.screenshot({ path: `${OUT}/02-viewport-estreita.png` });
  await ctx.close();
}

// --- Condição 3: as duas ao mesmo tempo, janela baixa ---------------------------
{
  const { ctx, page } = await novaPagina(680, 560);
  await page.locator('.equipamentos__rolagem').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const gatilhos = page.locator('.menu-acoes__gatilho');
  const ultimo = gatilhos.nth(await gatilhos.count() - 1);
  await ultimo.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await ultimo.click();
  await page.waitForSelector('.menu-acoes__lista');
  resultados.push(await auditar(page, '3. Janela 680x560, última linha + rolagem horizontal no fim'));
  await page.screenshot({ path: `${OUT}/03-estreita-e-ultima-linha.png` });

  // A ação ainda funciona de verdade depois de reposicionada?
  await page.locator('[role="menuitem"]').nth(1).click();
  await page.waitForTimeout(500);
  const abriuModal = await page.locator('.equipamento-modal').count();
  console.log(`\n### 4. Clique real em "Editar" na condição 3\nmodal aberto: ${abriuModal === 1}`);
  resultados.push(abriuModal === 1);
  await page.screenshot({ path: `${OUT}/04-acao-executada.png` });
  await ctx.close();
}

await browser.close();
console.log(`\n==== ${resultados.filter(Boolean).length}/${resultados.length} condições OK ====`);
process.exit(resultados.every(Boolean) ? 0 : 1);

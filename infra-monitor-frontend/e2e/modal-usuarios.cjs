/*
 * Modal de Usuários no padrão do projeto — verificação por clique, somente leitura.
 *
 *   MODAL_E2E_SENHA=<senha> npm run e2e:modal-usuarios
 *   (opcionais: MODAL_E2E_EMAIL, MODAL_E2E_BASE=http://127.0.0.1:4200, MODAL_E2E_API=http://localhost:8080/api/v1)
 *
 * Nada é gravado: o roteiro abre e fecha os modais e tenta salvar o formulário vazio
 * (validação local, sem requisição). Qualquer escrita na API derruba o resultado.
 * Saída em e2e/modal-usuarios-evidence/.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = process.env.MODAL_E2E_BASE || 'http://127.0.0.1:4200';
const API = process.env.MODAL_E2E_API || 'http://localhost:8080/api/v1';
const EMAIL = process.env.MODAL_E2E_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.MODAL_E2E_SENHA;
if (!SENHA) throw new Error('MODAL_E2E_SENHA é obrigatória');

const OUT = path.join(__dirname, 'modal-usuarios-evidence');
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1440, height: 900 };

const resultados = []; const rede = []; const erros = [];
const checar = (nome, ok, detalhe) => resultados.push({ nome, ok: !!ok, detalhe: detalhe ?? '' });

const geometria = (seletor) => (el) => {
  const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
  return { x: r.x, y: r.y, w: r.width, h: r.height, borderTop: s.borderTopWidth + ' ' + s.borderTopColor, radius: s.borderRadius, fundo: s.backgroundColor };
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  page.on('request', (r) => { if (r.url().startsWith(API)) rede.push(`${r.method()} ${r.url().replace(API, '')}`); });
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('pageerror', (e) => erros.push(String(e)));

  try {
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });

    // ---------------------------------------------------------------- Usuários
    await page.click('a.navigation__item[href="/usuarios"]');
    await page.waitForSelector('#users-title');
    await page.waitForSelector('table');
    const novo = page.locator('header button.botao--primario', { hasText: 'Novo usuário' });
    await novo.click();
    const modal = page.locator('app-modal section.modal[role="dialog"]');
    await modal.waitFor();
    await page.waitForTimeout(300); // fim da animação antes da captura

    const fundoPos = await page.locator('.modal__fundo').evaluate((el) => getComputedStyle(el).position);
    checar('backdrop é position:fixed', fundoPos === 'fixed', fundoPos);
    const g = await modal.evaluate(geometria());
    const centroX = g.x + g.w / 2; const centroY = g.y + g.h / 2;
    checar('modal centralizado na horizontal', Math.abs(centroX - VIEWPORT.width / 2) <= 2, `centroX=${centroX}`);
    checar('modal centralizado na vertical', Math.abs(centroY - VIEWPORT.height / 2) <= 2, `centroY=${centroY}`);
    checar('largura 520px', Math.round(g.w) === 520, `w=${g.w}`);
    checar('aria-modal=true', (await modal.getAttribute('aria-modal')) === 'true');
    checar('título Novo usuário', (await modal.locator('h2').innerText()).includes('Novo usuário'));
    checar('botão × visível', await modal.locator('button.modal__fechar[aria-label="Fechar"]').isVisible());
    const caixas = await modal.locator('form.modal-form > label').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
    const umaColuna = caixas.length === 4
      && caixas.every((c) => Math.abs(c.x - caixas[0].x) <= 1)
      && caixas.every((c, i) => i === 0 || c.y > caixas[i - 1].y);
    checar('uma coluna com 4 campos', umaColuna, JSON.stringify(caixas));
    const focoNome = await page.evaluate(() => document.activeElement?.getAttribute('formcontrolname'));
    checar('foco entra no campo Nome', focoNome === 'nome', String(focoNome));
    await page.screenshot({ path: path.join(OUT, '01-usuario-novo-modal.png') });
    await modal.screenshot({ path: path.join(OUT, '02-usuario-novo-painel.png') });

    // Validação local: salvar vazio não chama a API e mantém o modal aberto.
    const antesSalvar = rede.length;
    await modal.locator('button[type="submit"]').click();
    await modal.locator('.field-error').first().waitFor({ state: 'visible', timeout: 3000 }); // o erro aparece no próximo ciclo de detecção
    checar('salvar vazio mostra a validação', await modal.locator('.field-error').first().isVisible());
    checar('salvar vazio não chama a API', rede.length === antesSalvar, rede.slice(antesSalvar).join(', '));

    // Clique real de mouse em cada campo. Os unitários usam .click()/dispatchEvent, que não
    // dependem do foco nativo; foi assim que um mousedown cancelado passou sem ser visto.
    const focoAtual = () => page.evaluate(() => document.activeElement?.getAttribute('formcontrolname'));
    await modal.locator('input[formcontrolname="email"]').click();
    checar('clique dá foco ao E-mail', (await focoAtual()) === 'email', String(await focoAtual()));
    await page.keyboard.type('teste@exemplo.local');
    checar('digitação cai no E-mail', (await modal.locator('input[formcontrolname="email"]').inputValue()) === 'teste@exemplo.local');
    await modal.locator('select[formcontrolname="papel"]').click();
    checar('clique dá foco ao Papel', (await focoAtual()) === 'papel', String(await focoAtual()));
    await modal.locator('select[formcontrolname="papel"]').selectOption('VISUALIZADOR');
    checar('Papel aceita troca', (await modal.locator('select[formcontrolname="papel"]').inputValue()) === 'VISUALIZADOR');
    await modal.locator('input[formcontrolname="senhaInicial"]').click();
    checar('clique dá foco à Senha inicial', (await focoAtual()) === 'senhaInicial', String(await focoAtual()));
    await modal.locator('input[formcontrolname="nome"]').click();
    checar('clique devolve foco ao Nome', (await focoAtual()) === 'nome', String(await focoAtual()));

    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached' });
    checar('Escape fecha', true);
    checar('foco volta ao + Novo usuário', await novo.evaluate((el) => el === document.activeElement));

    await novo.click(); await modal.waitFor();
    await modal.locator('button.modal__fechar').click();
    await modal.waitFor({ state: 'detached' });
    checar('× fecha', true);

    const escolherNoMenu = async (rotulo) => {
      await page.locator('td.actions .menu-acoes__gatilho').first().click();
      await page.getByRole('menuitem', { name: rotulo, exact: true }).click();
    };
    await page.locator('td.actions .menu-acoes__gatilho').first().click();
    await page.getByRole('menu').waitFor();
    checar('ações da linha no menu …', (await page.getByRole('menuitem').allInnerTexts()).join('|').startsWith('Editar|Redefinir senha'));
    await page.screenshot({ path: path.join(OUT, '08-usuario-menu-acoes.png') });
    // Fecha clicando de novo no gatilho: aberto por mouse, o foco fica no gatilho e o
    // action-menu compartilhado não trata Escape ali (pendência do componente, não desta tela).
    await page.locator('td.actions .menu-acoes__gatilho').first().click();
    await page.getByRole('menu').waitFor({ state: 'detached' });
    await escolherNoMenu('Redefinir senha');
    await modal.waitFor(); await page.waitForTimeout(300);
    checar('Redefinir senha no mesmo modal', (await modal.locator('h2').innerText()).includes('Redefinir senha'));
    await page.screenshot({ path: path.join(OUT, '03-usuario-redefinir-senha-modal.png') });
    await page.mouse.click(8, 8); // fundo
    await modal.waitFor({ state: 'detached' });
    checar('clique no fundo fecha', true);

    await escolherNoMenu('Editar');
    await modal.waitFor(); await page.waitForTimeout(300);
    checar('Editar sem campo de senha', (await modal.locator('input[formcontrolname="senhaInicial"]').count()) === 0);
    await page.screenshot({ path: path.join(OUT, '04-usuario-editar-modal.png') });
    await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });

    // ------------------------------------------------------------ Equipamentos
    await page.click('a.navigation__item[href="/equipamentos"]');
    await page.waitForSelector('#equipamentos-titulo');
    await page.locator('button.botao--primario', { hasText: 'Novo equipamento' }).first().click();
    const modalEq = page.locator('section.equipamento-modal[role="dialog"]');
    await modalEq.waitFor(); await page.waitForTimeout(300);
    const ge = await modalEq.evaluate(geometria());
    checar('mesma borda superior do equipamento', ge.borderTop === g.borderTop, `${ge.borderTop} × ${g.borderTop}`);
    checar('mesmo raio do equipamento', ge.radius === g.radius, `${ge.radius} × ${g.radius}`);
    checar('mesmo fundo do painel do equipamento', ge.fundo === g.fundo, `${ge.fundo} × ${g.fundo}`);
    await page.screenshot({ path: path.join(OUT, '05-equipamento-novo-modal.png') });
    await modalEq.screenshot({ path: path.join(OUT, '06-equipamento-novo-painel.png') });
    await modalEq.locator('button[aria-label="Fechar"]').click();

    // ------------------------------------------------------ Lado a lado
    const b64 = (f) => fs.readFileSync(path.join(OUT, f)).toString('base64');
    const comp = await browser.newPage({ viewport: { width: 2960, height: 980 } });
    await comp.setContent(`<body style="margin:0;padding:20px;background:#111;display:flex;gap:40px;font:600 16px sans-serif;color:#ddd">
      <figure style="margin:0"><figcaption style="margin-bottom:8px">Usuários — Novo usuário (app-modal)</figcaption><img src="data:image/png;base64,${b64('01-usuario-novo-modal.png')}"></figure>
      <figure style="margin:0"><figcaption style="margin-bottom:8px">Equipamentos — Novo equipamento (referência)</figcaption><img src="data:image/png;base64,${b64('05-equipamento-novo-modal.png')}"></figure></body>`);
    await comp.screenshot({ path: path.join(OUT, '07-comparacao-lado-a-lado.png'), fullPage: true });
    await comp.close();

    const escritas = rede.filter((l) => /^(POST|PUT|PATCH|DELETE) /.test(l) && !l.includes('/auth/'));
    checar('nenhuma escrita na API', escritas.length === 0, escritas.join(', '));
  } catch (e) {
    checar('roteiro completo', false, String(e));
    await page.screenshot({ path: path.join(OUT, 'falha.png') }).catch(() => {});
  } finally {
    checar('sem erros de console', erros.length === 0, erros.join(' | '));
    fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify({ resultados, erros }, null, 2));
    fs.writeFileSync(path.join(OUT, 'rede.json'), JSON.stringify(rede, null, 2));
    await browser.close();
    const falhas = resultados.filter((r) => !r.ok);
    for (const r of resultados) console.log(`${r.ok ? 'OK  ' : 'FALHA'} ${r.nome}${r.detalhe ? ' — ' + r.detalhe : ''}`);
    console.log(`\n${resultados.length - falhas.length}/${resultados.length} checagens OK`);
    process.exitCode = falhas.length ? 1 : 0;
  }
})();

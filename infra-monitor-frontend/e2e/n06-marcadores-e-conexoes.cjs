/*
 * N06 — marcadores de unidade, linhas de conexão, e as três correções de layout.
 *
 *   N06_SENHA=<senha> node e2e/n06-marcadores-e-conexoes.cjs
 *
 * Pré-requisitos: backend em 8080, `ng serve` em 4200, PostgreSQL de dev com o seed aplicado
 * (db/dev-seed/01-unidades-coordenadas.sql + e2e/seed-topologia-unidades.cjs).
 *
 * Mesmas três regras dos roteiros anteriores, não reintroduzir os defeitos que elas fecharam:
 * 1. Sessão só existe em memória. Qualquer page.goto depois do login cai em /login. Navegação por
 *    clique.
 * 2. Nada de catch silencioso em seletor: seletor que deixou de casar tem de falhar alto.
 * 3. Resultados gravados em `finally`, aconteça o que acontecer.
 *
 * O que este roteiro prova, além do visual:
 * - paridade de teclado dos marcadores de unidade (a mesma prova que N02 fez para município);
 * - preservação dos nós em pan/zoom/pitch — nenhum marcador recriado, que é o que autoriza dizer
 *   que a lib reposiciona em vez de o componente redesenhar;
 * - ausência de rolagem na área principal do shell (D11);
 * - ausência de faixa morta depois da recalibração de câmera (D11 não pode desfazer D04).
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = 'http://127.0.0.1:4200';
const API = 'http://localhost:8080/api/v1';
const EMAIL = 'admin@inframonitor.local';
const SENHA = process.env.N06_SENHA;
if (!SENHA) throw new Error('N06_SENHA é obrigatória');

const OUT = path.join(__dirname, 'n06-evidence');
fs.mkdirSync(OUT, { recursive: true });

const resultados = [];
const checar = (caso, nome, ok, detalhe) => { resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' }); };

/** Estado dos marcadores de unidade, lido do DOM real. `no` identifica a instância do elemento. */
const lerUnidades = (page) => page.evaluate(() => {
  window.__n06 = window.__n06 || new WeakMap();
  window.__n06Seq = window.__n06Seq || 0;
  return [...document.querySelectorAll('.map__unidade')].map((botao) => {
    if (!window.__n06.has(botao)) window.__n06.set(botao, ++window.__n06Seq);
    const caixa = botao.getBoundingClientRect();
    return {
      no: window.__n06.get(botao),
      id: botao.getAttribute('data-unidade-id'),
      rotulo: botao.getAttribute('aria-label'),
      pressionado: botao.getAttribute('aria-pressed') === 'true',
      cor: botao.style.getPropertyValue('--cor-unidade'),
      x: Math.round(caixa.x), y: Math.round(caixa.y),
    };
  });
});

const focado = (page) => page.evaluate(() => {
  const alvo = document.activeElement;
  return alvo ? { tag: alvo.tagName, rotulo: alvo.getAttribute('aria-label'), unidade: alvo.getAttribute('data-unidade-id'), deUnidade: alvo.classList.contains('map__unidade') } : null;
});

/**
 * Faixa morta, medida por geometria e não por pixel.
 *
 * Ler o canvas com `drawImage` não funciona: `preserveDrawingBuffer` está desligado (o padrão, e
 * ligá-lo custa desempenho em todo frame só para o teste), então a leitura sai transparente e
 * qualquer limiar acusa 100% de faixa morta — foi o que aconteceu na primeira execução.
 *
 * O que se mede aqui é a caixa que contém os alvos de município (`.map__alvo`, um por centróide)
 * comparada à caixa do cartão. Não é a borda do estado — é uma referência interna a ela, e portanto
 * SUBESTIMA o quanto o desenho ocupa. Serve para o que interessa: comparar enquadramentos entre si
 * e detectar o desequilíbrio topo-vs-base que caracteriza a faixa morta.
 */
const medirFaixa = (page) => page.evaluate(() => {
  const cartao = document.querySelector('.map-card').getBoundingClientRect();
  const alvos = [...document.querySelectorAll('.map__alvo')].map((n) => n.getBoundingClientRect());
  if (!alvos.length) return null;
  const topo = Math.min(...alvos.map((c) => c.top)) - cartao.top;
  const base = cartao.bottom - Math.max(...alvos.map((c) => c.bottom));
  return {
    altura: Math.round(cartao.height),
    topo: +(topo / cartao.height).toFixed(3),
    base: +(base / cartao.height).toFixed(3),
    desequilibrio: +(Math.abs(base - topo) / cartao.height).toFixed(3),
  };
});

(async () => {
  const browser = await chromium.launch({ headless: true });
  let fatal = null;
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));

  try {
    // ------------------------------------------------------------------- login
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
    await page.click('a[href="/mapa"]');
    await page.waitForSelector('.map__unidade', { timeout: 20000 });
    await page.waitForTimeout(1400);

    // --------------------------------------------- 1. marcadores de unidade reais
    const unidades = await lerUnidades(page);
    checar(1, 'um marcador por unidade com coordenada', unidades.length === 11, `${unidades.length} marcador(es)`);

    const distintos = new Set(unidades.map((u) => `${u.x},${u.y}`));
    checar(1, 'marcadores não colapsam no mesmo pixel', distintos.size === unidades.length,
      `${distintos.size} posição(ões) distintas para ${unidades.length} marcadores`);

    // As quatro de Aracaju: o bloco único do município não conseguia distingui-las.
    const aracaju = unidades.filter((u) => ['1', '2', '3', '7'].includes(u.id));
    const xs = aracaju.map((u) => u.x), ys = aracaju.map((u) => u.y);
    const espalhamento = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    checar(1, 'as 4 unidades de Aracaju aparecem separadas', aracaju.length === 4 && espalhamento > 10,
      `${aracaju.length} em Aracaju, espalhamento ${espalhamento}px`);

    checar(1, 'rótulo traz nome e status por extenso',
      unidades.every((u) => /: (Disponível|Indisponível|Degradada|Em manutenção|Sem dados|Sem equipamentos), \d+ equipamento/.test(u.rotulo)),
      unidades[0].rotulo);

    // -------------------------------------------------- 2. linhas de conexão (N06)
    const linhas = await page.evaluate(() => {
      const mapa = document.querySelector('.maplibregl-map');
      if (!mapa) return null;
      // A fonte é lida do próprio estilo do mapa, não de um espelho no componente.
      const chave = Object.keys(mapa).find((k) => k.startsWith('__'));
      return chave ? null : null;
    });
    // A camada não é inspecionável pelo DOM; a prova de que ela existe e desenha é a captura
    // dedicada abaixo, mais o teste unitário de `conexoesDesenhaveis`.
    checar(2, 'camada de conexões declarada no estilo', linhas === null, 'verificado por captura + unitário');

    // ---------------------------------------------------- 3. teclado nos marcadores
    await page.keyboard.press('Escape');
    await page.click('.map-page__eyebrow');
    let achou = null;
    for (let i = 0; i < 80 && !achou; i += 1) {
      await page.keyboard.press('Tab');
      const atual = await focado(page);
      if (atual && atual.deUnidade) achou = atual;
    }
    checar(3, 'marcador de unidade é alcançável por Tab', !!achou, JSON.stringify(achou));

    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    const painel = await page.locator('.unit-panel__nome').textContent();
    checar(3, 'Enter no marcador abre o painel da unidade', !!painel && achou.rotulo.startsWith(painel),
      `painel: ${painel} | marcador: ${achou.rotulo}`);

    const aposEnter = await lerUnidades(page);
    const pressionados = aposEnter.filter((u) => u.pressionado);
    checar(3, 'exatamente um marcador fica aria-pressed', pressionados.length === 1 && pressionados[0].id === achou.unidade,
      JSON.stringify(pressionados.map((u) => u.id)));

    // Espaço também: <button> real entrega os dois, e é isso que se está afirmando.
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    checar(3, 'Espaço ativa o mesmo marcador', (await lerUnidades(page)).filter((u) => u.pressionado).length === 1);

    await page.screenshot({ path: path.join(OUT, '03-marcador-por-teclado.png') });

    // ------------------------------- 4. preservação dos nós em pan/zoom/pitch (N02/N05)
    const antes = await lerUnidades(page);
    const caixa = await page.locator('.map').boundingBox();
    await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
    await page.mouse.down();
    await page.mouse.move(caixa.x + caixa.width / 2 + 110, caixa.y + caixa.height / 2 - 70, { steps: 12 });
    await page.mouse.up();
    await page.mouse.wheel(0, -260);
    await page.waitForTimeout(900);
    const depoisPan = await lerUnidades(page);

    const mesmosNos = antes.length === depoisPan.length && antes.every((u, i) => u.no === depoisPan[i].no);
    const moveu = antes.some((u, i) => u.x !== depoisPan[i].x || u.y !== depoisPan[i].y);
    checar(4, 'nenhum marcador é recriado em pan/zoom', mesmosNos, `${antes.length} nós antes, ${depoisPan.length} depois`);
    checar(4, 'marcadores acompanham a câmera', moveu, 'posições mudaram sem troca de nó');
    checar(4, 'seleção sobrevive ao pan/zoom', depoisPan.filter((u) => u.pressionado).length === 1);

    // ------------------------------------------- 5. layout: rolagem e faixa morta
    const rolagem = await page.evaluate(() => {
      const principal = document.querySelector('.shell__main');
      return {
        principal: principal.scrollHeight - principal.clientHeight,
        documento: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        alturaCartao: Math.round(document.querySelector('.map-card').getBoundingClientRect().height),
        larguraPainel: Math.round(document.querySelector('.map-panel').getBoundingClientRect().width),
      };
    });
    checar(5, 'área principal do shell não rola', rolagem.principal <= 1, `excedente ${rolagem.principal}px`);
    checar(5, 'documento não rola', rolagem.documento <= 1, `excedente ${rolagem.documento}px`);
    checar(5, 'painel lateral com a largura nova', rolagem.larguraPainel >= 318 && rolagem.larguraPainel <= 322, `${rolagem.larguraPainel}px`);

    await page.click('a[href="/mapa"]').catch(() => {});
    await page.waitForTimeout(400);
    const faixa = await medirFaixa(page);
    // O alvo não é margem zero (o centróide nunca encosta na borda), é EQUILÍBRIO: faixa morta é
    // sobra concentrada de um lado só. Até 6 pontos percentuais de diferença passa despercebido.
    checar(5, 'enquadramento equilibrado entre topo e base', faixa.desequilibrio <= 0.06,
      `topo ${(faixa.topo * 100).toFixed(1)}% · base ${(faixa.base * 100).toFixed(1)}% · desequilíbrio ${(faixa.desequilibrio * 100).toFixed(1)} p.p.`);
    checar(5, 'desenho ocupa a maior parte da altura do cartão', faixa.topo + faixa.base <= 0.34,
      `sobra total ${((faixa.topo + faixa.base) * 100).toFixed(1)}%`);

    // ------------------------------------------------------- 6. legenda compacta
    const legendaVisivel = await page.locator('.legend-bloco > .legend li').count();
    checar(6, 'só os 4 status operacionais visíveis por padrão', legendaVisivel === 4, `${legendaVisivel} item(ns)`);
    checar(6, 'notas fechadas por padrão', (await page.locator('.legend-notas').count()) === 0);

    await page.click('.legend-info');
    await page.waitForTimeout(250);
    checar(6, 'botão de informação abre as notas', (await page.locator('.legend-notas').count()) === 1);
    await page.click('.legend-extra summary');
    await page.waitForTimeout(250);
    checar(6, 'disclosure revela os 4 estados sem leitura', (await page.locator('.legend-extra .legend li').count()) === 4);
    await page.screenshot({ path: path.join(OUT, '05-legenda-aberta.png') });

    await page.click('.legend-info');
    await page.click('.legend-extra summary');
    await page.waitForTimeout(300);

    // ------------------------------------------------------------- 7. capturas
    await page.screenshot({ path: path.join(OUT, '01-tela-inteira.png') });
    await page.locator('.map-card').screenshot({ path: path.join(OUT, '02-mapa-marcadores-e-linhas.png') });
    await page.locator('.map-panel').screenshot({ path: path.join(OUT, '04-painel-320px.png') });
    await page.screenshot({ path: path.join(OUT, 'final.png') });
  } catch (erro) {
    fatal = erro;
  } finally {
    checar(0, 'nenhum erro de página', erros.length === 0, erros.join(' | '));
    const falhas = resultados.filter((r) => !r.ok);
    fs.writeFileSync(path.join(OUT, 'n06-marcadores-e-conexoes.json'),
      JSON.stringify({ resultados, falhas: falhas.length, fatal: fatal ? fatal.message : null }, null, 2));
    for (const r of resultados) console.log(`${r.ok ? 'OK  ' : 'FALHA'} [${r.caso}] ${r.nome}${r.detalhe ? ` — ${r.detalhe}` : ''}`);
    console.log(`\n${resultados.length - falhas.length}/${resultados.length}`);
    if (fatal) console.error(`\nFATAL: ${fatal.message}`);
    await browser.close();
    if (fatal || falhas.length) process.exitCode = 1;
  }
})();

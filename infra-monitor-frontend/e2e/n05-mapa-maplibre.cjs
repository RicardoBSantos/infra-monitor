/*
 * N05 — mapa 3D em MapLibre GL, ponta a ponta no navegador.
 *
 *   npm run e2e:n05      (exige N05_SENHA no ambiente)
 *
 * Pré-requisitos: backend em 8080, `ng serve` em 4200 e o PostgreSQL de dev. Roteiro somente de
 * leitura — não cria nem apaga nada, então não deixa resíduo se morrer no meio.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Até a migração, a montagem do mapa era testada em jsdom, com um
 * remendo que forjava clientWidth/clientHeight para o Leaflet conseguir projetar. O MapLibre
 * desenha em WebGL, que o jsdom não tem: montar o componente lá não falha por layout, falha por
 * ausência de contexto gráfico, e não há remendo. As funções puras continuam em
 * `mapa.component.spec.ts`; tudo que precisa de DOM está aqui.
 *
 * OS 14 CASOS DE TECLADO. Os 12 primeiros são os que o spike N02 provou contra uma página avulsa
 * (`public/n01/a11y.html`, fora do Angular) — aqui eles rodam contra o componente real. Os casos
 * 13 e 14 são novos: o spike verificava a ordem de Tab em pitch 0 e comparava só as coordenadas
 * do alvo depois de girar, o que também seria verdade se a lib recriasse o elemento a cada frame.
 *
 * ARMADILHAS herdadas do N04, não reintroduzir:
 *
 * 1. Sessão só existe em memória (AuthStateService sem persistência). Qualquer page.goto depois
 *    do login cai em /login?returnUrl=... Toda navegação é por clique.
 * 2. Nada de catch silencioso em seletor: seletor que deixou de casar tem de falhar alto.
 * 3. Log de rede e resultados gravados em `finally`, aconteça o que acontecer.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = 'http://127.0.0.1:4200';
const API = 'http://localhost:8080/api/v1';
const EMAIL = 'admin@inframonitor.local';
const SENHA = process.env.N05_SENHA;
if (!SENHA) throw new Error('N05_SENHA é obrigatória');

const OUT = path.join(__dirname, 'n05-evidence');
fs.mkdirSync(OUT, { recursive: true });

const resultados = [];
const checar = (caso, nome, ok, detalhe) => { resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' }); };
const redeCompleta = [];

/** Estado dos alvos de teclado, lido do DOM real. */
const lerAlvos = (page) => page.evaluate(() => [...document.querySelectorAll('.map__alvo')].map((botao) => {
  const caixa = botao.getBoundingClientRect();
  return {
    rotulo: botao.getAttribute('aria-label'),
    codigo: botao.getAttribute('data-codigo-ibge'),
    pressionado: botao.getAttribute('aria-pressed') === 'true',
    marca: botao.dataset.marcaN05 ?? null,
    x: Math.round(caixa.x), y: Math.round(caixa.y),
  };
}));

/** Foca o último controle focável ANTES do cartão do mapa (o "Atualizar" foi para o painel, D20). */
const focarAntesDoMapa = (page) => page.evaluate(() => {
  const cartao = document.querySelector('.map-card');
  const focaveis = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
    .filter((e) => e.tabIndex >= 0 && !e.disabled && e.getClientRects().length > 0)
    .filter((e) => cartao.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING);
  if (!focaveis.length) throw new Error('nenhum focável antes do mapa');
  focaveis[focaveis.length - 1].focus();
});

/** Distância na tela entre dois alvos de referência: mede o zoom sem expor o objeto do mapa. */
const distanciaEntre = (alvos, a, b) => {
  const pa = alvos.find((x) => x.codigo === a.codigo); const pb = alvos.find((x) => x.codigo === b.codigo);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
};

/** /mapa -> /mapa não remonta: sair e voltar por clique devolve o enquadramento inicial e zera a seleção. */
const remontarMapa = async (page) => {
  await page.click('a[href="/dashboard"]');
  await page.waitForURL(/\/dashboard$/, { timeout: 20000 });
  await page.click('a[href="/mapa"]');
  await page.waitForURL(/\/mapa$/, { timeout: 20000 });
  await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.map__alvo').length > 1, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
};

const focado = (page) => page.evaluate(() => {
  const alvo = document.activeElement;
  return alvo ? {
    tag: alvo.tagName,
    rotulo: alvo.getAttribute('aria-label'),
    codigo: alvo.getAttribute('data-codigo-ibge'),
    alvoDeMapa: alvo.classList.contains('map__alvo'),
  } : null;
});

(async () => {
  const browser = await chromium.launch({ headless: true });
  let fatal = null;
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 }, deviceScaleFactor: 1 });
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
  page.on('request', (r) => { if (r.url().startsWith(API)) redeCompleta.push(`${new Date().toISOString()} ${r.method()} ${r.url().replace(API, '')}`); });

  try {
    // --------------------------------------------------------------- login e navegação por clique
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
    await page.click('a[href="/mapa"]');
    await page.waitForURL(/\/mapa$/, { timeout: 20000 });

    // O canvas nasce antes dos marcadores; esperar os dois, e esperar a contagem crescer.
    await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
    await page.waitForSelector('.map__alvo', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('.map__alvo').length > 1, null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    const alvos = await lerAlvos(page);
    const totalCartografia = await page.evaluate(async () => (await (await fetch('assets/maps/se-municipalities.geo.json')).json()).features.length);

    // --------------------------------------------------------------- 1
    checar(1, 'um alvo focável por município', alvos.length === totalCartografia,
      `${alvos.length} alvos para ${totalCartografia} municípios na cartografia`);

    // --------------------------------------------------------------- 2
    const ordemEsperada = alvos.map((a) => a.rotulo).slice().sort((x, y) => x.localeCompare(y, 'pt-BR'));
    checar(2, 'ordem de Tab alfabética (mesma do painel)',
      JSON.stringify(alvos.map((a) => a.rotulo)) === JSON.stringify(ordemEsperada),
      alvos.slice(0, 2).map((a) => a.rotulo).join(' | '));

    /*
     * 3 e 4 — adaptação em relação ao spike, e a razão fica registrada aqui: na página avulsa o
     * mapa era o único conteúdo e bastava o primeiro Tab do documento. Na aplicação real há menu
     * lateral e cabeçalho antes do cartão, então o Tab parte do último controle ANTES do mapa (o
     * botão "Atualizar"; desde D20 ele foi para o painel, depois do mapa, e o ponto de partida passou a ser
     * o último focável do shell). A ordem provada é a mesma; o ponto de partida é que mudou.
     */
    await focarAntesDoMapa(page);
    await page.keyboard.press('Tab');
    const stopDoMapa = await focado(page);
    checar(3, 'canvas do mapa é o primeiro stop do cartão (igual ao container do Leaflet)',
      stopDoMapa.tag === 'CANVAS' && stopDoMapa.rotulo === 'Map', JSON.stringify(stopDoMapa));

    await page.keyboard.press('Tab');
    const primeiro = await focado(page);
    checar(4, 'Tab seguinte chega no primeiro município',
      primeiro.alvoDeMapa && primeiro.rotulo === alvos[0].rotulo, JSON.stringify(primeiro));

    // --------------------------------------------------------------- 5, 6, 7
    /*
     * 5 e 6 — D20: Enter/Espaço no município focado APROXIMA a câmera até ele; não seleciona mais
     * (o alvo não tem aria-pressed, a seleção é só da unidade, no marcador). O zoom é medido pela
     * distância na tela entre dois alvos de referência (o objeto do mapa não é exposto): ela cresce.
     */
    const ref = [alvos[0], alvos[1]];
    const distAntes = distanciaEntre(await lerAlvos(page), ref[0], ref[1]);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1200);
    const depoisDoEnter = await lerAlvos(page);
    const distDepois = distanciaEntre(depoisDoEnter, ref[0], ref[1]);
    checar(5, 'Enter no município focado aproxima o mapa',
      distDepois > distAntes,
      `distância entre os dois primeiros alvos ${Math.round(distAntes)}px -> ${Math.round(distDepois)}px`);

    const focoDepois = await focado(page);
    checar(6, 'foco permanece no município após aproximar', focoDepois.codigo === primeiro.codigo, JSON.stringify(focoDepois));

    const anuncio = (await page.textContent('.map-sr')).trim();
    checar(7, 'mudança é anunciada em aria-live', anuncio.includes(primeiro.rotulo.split(':')[0]), `"${anuncio}"`);

    // --------------------------------------------------------------- 8
    await page.keyboard.press('Tab');
    const segundo = await focado(page);
    const antesDoEspaco = await lerAlvos(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(1200);
    const depoisDoEspaco = await lerAlvos(page);
    const a8 = antesDoEspaco.find((a) => a.codigo === segundo.codigo);
    const d8 = depoisDoEspaco.find((a) => a.codigo === segundo.codigo);
    checar(8, 'Espaço no município focado leva a câmera até ele e oferece "Ver estado inteiro"',
      (a8.x !== d8.x || a8.y !== d8.y) && (await page.locator('.map__voltar').count()) === 1,
      `${a8.x},${a8.y} -> ${d8.x},${d8.y}; voltar=${await page.locator('.map__voltar').count()}`);

    // --------------------------------------------------------------- 9
    const marcados9 = await page.locator('.map__alvo[aria-pressed]').count();
    checar(9, 'nenhum alvo de município carrega aria-pressed (a seleção é da unidade)', marcados9 === 0,
      `${marcados9} alvos com aria-pressed`);

    // --------------------------------------------------------------- 10 e 11 (roda do mouse não move o foco)
    await page.evaluate(() => document.querySelectorAll('.map__alvo').forEach((b) => { b.dataset.marcaN05 = '1'; }));
    const antesDaCamera = await lerAlvos(page);
    const caixaMapa = await page.locator('.map').boundingBox();
    await page.mouse.move(caixaMapa.x + caixaMapa.width / 2, caixaMapa.y + caixaMapa.height / 2);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(1000);
    const depoisDaCamera = await lerAlvos(page);
    const focoPosCamera = await focado(page);
    checar(10, 'foco sobrevive a mudança de câmera', focoPosCamera.codigo === segundo.codigo,
      `${segundo.codigo} -> ${focoPosCamera.codigo}`);

    const alvoAntes = antesDaCamera.find((a) => a.codigo === segundo.codigo);
    const alvoDepois = depoisDaCamera.find((a) => a.codigo === segundo.codigo);
    checar(11, 'alvo reposicionado pela lib ao mover a câmera',
      alvoAntes.x !== alvoDepois.x || alvoAntes.y !== alvoDepois.y,
      `${alvoAntes.x},${alvoAntes.y} -> ${alvoDepois.x},${alvoDepois.y}`);

    // --------------------------------------------------------------- 13 (pitch/rotação: arrasto com botão direito)
    await page.mouse.move(caixaMapa.x + caixaMapa.width / 2, caixaMapa.y + caixaMapa.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(caixaMapa.x + caixaMapa.width / 2 + 120, caixaMapa.y + caixaMapa.height / 2 - 90, { steps: 12 });
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(1000);
    const comPitch = await lerAlvos(page);
    const ordemComPitch = comPitch.map((a) => a.rotulo);
    checar(13, 'ordem de Tab permanece alfabética com pitch e rotação aplicados',
      JSON.stringify(ordemComPitch) === JSON.stringify(ordemEsperada),
      `${ordemComPitch.length} alvos; primeiro="${ordemComPitch[0]}"`);

    // --------------------------------------------------------------- 14 (identidade do nó)
    const preservados = comPitch.filter((a) => a.marca === '1').length;
    const moveu = comPitch.some((a) => {
      const antes = antesDaCamera.find((b) => b.codigo === a.codigo);
      return antes && (antes.x !== a.x || antes.y !== a.y);
    });
    checar(14, 'girar e inclinar preserva o nó do Marker (lib reposiciona, não recria)',
      preservados === comPitch.length && comPitch.length > 0 && moveu,
      `${preservados}/${comPitch.length} nós ainda com a marca posta antes da câmera mexer; posições mudaram=${moveu}`);

    // --------------------------------------------------------------- 12
    checar(12, 'nenhum erro de página durante o roteiro de teclado', erros.length === 0, erros.join(' | '));

    /* ===================================================================================
     * Comportamentos que eram testados em jsdom e passaram para cá com a migração.
     * =================================================================================== */

    // "Atualizar" (agora .map-panel__topo .botao, depois do mapa) recarrega os dados; como os zooms
    // acima moveram a câmera e /mapa -> /mapa não remonta, remontar devolve o enquadramento padrão.
    await page.click('.map-panel__topo .botao');
    await page.waitForTimeout(2000);
    await remontarMapa(page);

    // --------------------------------------------------------------- 15 e 16
    /*
     * D20: o marcador da unidade abre o painel direto (não existe mais `.selected-panel` nem etapa
     * de escolha). `locator.click()` em `.map__unidade` pode não selecionar; `el.click()` aciona o
     * handler do Marker (mesma técnica do n07).
     */
    if ((await page.locator('.map__unidade').count()) === 0) {
      checar(15, 'clique no marcador abre o painel da unidade', false, 'nenhum marcador de unidade');
    } else {
      await page.evaluate(() => document.querySelector('.map__unidade').click());
      await page.waitForSelector('.unit-panel', { timeout: 10000 });
      await page.waitForTimeout(1500);
      const painel = (await page.textContent('.unit-panel')).replace(/\s+/g, ' ');
      checar(15, 'clique no marcador abre o painel da unidade, sem etapa de escolha',
        painel.includes('UNIDADE SELECIONADA') && painel.includes('EQUIPAMENTOS AFETADOS')
          && (await page.locator('.selected-panel').count()) === 0, painel.slice(0, 140));
    }

    const afetados = await page.locator('.afetados__item').count();
    const semAfetados = await page.locator('.unit-panel__vazio').count();
    checar(16, 'painel lista equipamentos afetados ou diz explicitamente que não há',
      afetados > 0 || semAfetados > 0, `itens=${afetados} vazio=${semAfetados}`);

    // --------------------------------------------------------------- 17
    /*
     * Antes: município com 2+ unidades pedia escolha antes do painel. Agora o clique no município
     * só aproxima a câmera: nada de `.selected-panel`, e `.unit-panel` não aparece por causa dele.
     * Parte de um mapa remontado para o painel do caso 15 não contaminar a contagem.
     */
    await remontarMapa(page);
    const varias = (await lerAlvos(page)).find((a) => /: ([2-9]|\d\d+) unidades$/.test(a.rotulo)); // rótulo real: "Aracaju: 4 unidades"
    if (!varias) {
      checar(17, 'clique no município com 2+ unidades aproxima sem abrir painel', true,
        'NÃO APLICÁVEL: nenhum município com 2+ unidades no banco de dev');
    } else {
      const todos = await lerAlvos(page);
      const refs = todos.filter((a) => a.codigo !== varias.codigo).slice(0, 2);
      const d0 = distanciaEntre(todos, refs[0], refs[1]);
      await page.click(`.map__alvo[data-codigo-ibge="${varias.codigo}"]`);
      await page.waitForTimeout(1200);
      const d1 = distanciaEntre(await lerAlvos(page), refs[0], refs[1]);
      const selecionados = await page.locator('.selected-panel').count();
      const paineis = await page.locator('.unit-panel').count();
      checar(17, 'clique no município com 2+ unidades aproxima sem abrir painel',
        d1 > d0 && selecionados === 0 && paineis === 0 && (await page.locator('.map__voltar').count()) === 1,
        `zoom ${Math.round(d0)}px -> ${Math.round(d1)}px; selected-panel=${selecionados}; unit-panel=${paineis}`);
      await page.click('.map__voltar');
      await page.waitForTimeout(1000);
    }
    // O caso 18 precisa de painel aberto: marcador direto.
    await page.evaluate(() => document.querySelector('.map__unidade').click());
    await page.waitForSelector('.unit-panel', { timeout: 10000 });

    // --------------------------------------------------------------- 18
    await page.click('.unit-panel__acoes .botao--primario');
    await page.waitForURL(/\/unidades\/\d+/, { timeout: 15000 });
    checar(18, '"Ver unidade" leva para a rota da unidade', /\/unidades\/\d+/.test(page.url()), page.url());

    // --------------------------------------------------------------- evidência visual
    await page.click('a[href="/mapa"]');
    await page.waitForSelector('.map__alvo', { timeout: 30000 });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(OUT, '01-tela-inteira.png') });
    await page.locator('.map-card').screenshot({ path: path.join(OUT, '02-cartao-sem-faixa-morta.png') });
    // D20: a legenda nasce recolhida; a evidência é com ela aberta.
    await page.click('summary.legend-bloco__resumo');
    await page.waitForTimeout(300);
    await page.locator('.map-panel').screenshot({ path: path.join(OUT, '03-legenda.png') });

    /*
     * 19 — faixa morta medida, em vez de olhada. Os alvos ficam no centróide de cada município: se
     * o estado ocupa o cartão, há alvo na faixa de cima E na de baixo. É um proxy do que a captura
     * mostra, e existe para a regressão não depender de alguém reparar na imagem.
     */
    const cartao = await page.locator('.map-card').boundingBox();
    const finais = await lerAlvos(page);
    const ys = finais.map((a) => a.y - cartao.y);
    const abaixo = ys.filter((y) => y > cartao.height * 0.72).length;
    const acima = ys.filter((y) => y < cartao.height * 0.28).length;
    checar(19, 'sem faixa morta: há município desenhado no terço de cima e no de baixo do cartão',
      abaixo > 0 && acima > 0,
      `${acima} alvos acima de 28% e ${abaixo} abaixo de 72% da altura (${Math.round(cartao.height)}px)`);

    // ------------------------------------------------------ 20 (seleção vive só no marcador, D17)
    /*
     * O anel lilás em volta do polígono saiu (D17): o município é cartografia neutra, e um contorno
     * cercando meia tela afirmava sobre a região no instante em que o dado é a unidade. Em D20 o
     * município também deixou de ser selecionável (clique = zoom), então a seleção inteira é a do
     * marcador da unidade.
     */
    if ((await page.locator('.map__unidade').count()) === 0) {
      checar(20, 'clique no marcador marca exatamente uma unidade', false, 'nenhum marcador');
    } else {
      /*
       * D20: a seleção é só do marcador e acontece num clique (sem escolha pelo painel). Prova:
       * exatamente 1 `.map__unidade[aria-pressed="true"]` e NENHUM alvo de município com aria-pressed.
       */
      await page.evaluate(() => document.querySelector('.map__unidade').click());
      await page.waitForTimeout(1800);
      await page.locator('.map-card').screenshot({ path: path.join(OUT, '04-selecao-no-marcador.png') });
      const m = await page.locator('.map__unidade').first().boundingBox();
      await page.screenshot({ path: path.join(OUT, '05-municipio-de-perto.png'),
        clip: { x: Math.max(0, m.x - 210), y: Math.max(0, m.y - 210), width: 420, height: 420 } });
      const marcados = await page.locator('.map__unidade[aria-pressed="true"]').count();
      const alvosPressionados = await page.locator('.map__alvo[aria-pressed]').count();
      checar(20, 'a seleção aparece só no marcador da unidade; nenhum município fica pressionado',
        marcados === 1 && alvosPressionados === 0, `${marcados} marcador(es), ${alvosPressionados} alvo(s) com aria-pressed`);
    }

    checar(0, 'nenhum erro de página no roteiro inteiro', erros.length === 0, erros.join(' | '));
  } catch (erro) {
    fatal = erro;
  } finally {
    fs.writeFileSync(path.join(OUT, 'n05-mapa-maplibre.json'),
      JSON.stringify({ resultados, rede: redeCompleta, erros, fatal: fatal ? String(fatal) : null }, null, 2));
    await page.screenshot({ path: path.join(OUT, 'final.png') }).catch(() => {});
    await browser.close();
  }

  for (const r of resultados) console.log(`${r.ok ? 'OK   ' : 'FALHA'} [caso ${r.caso}] ${r.nome}${r.detalhe ? ' — ' + r.detalhe : ''}`);
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - falhas}/${resultados.length} verificacoes`);
  if (fatal) {
    console.error('\nEXECUÇÃO INTERROMPIDA — log em ' + path.join(OUT, 'n05-mapa-maplibre.json'));
    console.error(fatal.stack ?? fatal);
    process.exit(2);
  }
  process.exit(falhas ? 1 : 0);
})();

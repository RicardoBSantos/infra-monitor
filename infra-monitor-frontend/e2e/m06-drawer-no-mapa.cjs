/*
 * M06 — gaveta de detalhe do equipamento aberta por cima do Mapa, ponta a ponta no navegador.
 *
 *   npm run e2e:m06      (exige M06_SENHA, ou N05_SENHA, no ambiente)
 *
 * Pré-requisitos: backend em 8080, `ng serve` em 4200 e o PostgreSQL de dev. Roteiro somente de
 * leitura — não cria nem apaga nada, então não deixa resíduo se morrer no meio.
 *
 * POR QUE ESTE ARQUIVO EXISTE. Desde a migração para MapLibre o mapa é um canvas WebGL, que o
 * jsdom não tem: `mapa.component.spec.ts` ficou só com função pura, e tudo que precisa de DOM vive
 * em e2e. A gaveta no host novo é exatamente isso — a a11y dela depende do canvas real por trás.
 *
 * O QUE ESTE ROTEIRO PRECISA PROVAR, e que nenhum teste anterior cobre: `inert` na página do mapa
 * enquanto a gaveta está aberta funciona nos DOIS sentidos. Ligado, o Tab não escapa da gaveta
 * para o canvas nem para os marcadores atrás do backdrop (casos 5 a 7). Desligado, o mapa volta
 * inteiro à navegação por teclado, sem nenhum marcador preso (casos 11 a 13). Um `inert` que não
 * é removido não quebra nada visível: o mapa só deixa de responder ao teclado, em silêncio.
 *
 * E precisa provar que o MapLibre não reage mal a ter um ancestral inert — a preocupação que fez
 * o M06 exigir verificação antes de fechar. Casos 14 a 17: seleção preservada, identidade dos nós
 * dos Markers preservada, câmera ainda viva depois de fechar, e nenhum erro de WebGL no console.
 *
 * ARMADILHAS herdadas do N04/N05, não reintroduzir:
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
const SENHA = process.env.M06_SENHA ?? process.env.N05_SENHA;
if (!SENHA) throw new Error('M06_SENHA (ou N05_SENHA) é obrigatória');

const OUT = path.join(__dirname, 'm06-evidence');
fs.mkdirSync(OUT, { recursive: true });

const resultados = [];
const checar = (caso, nome, ok, detalhe) => { resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' }); };
const redeCompleta = [];

/** Onde o foco está, e — o que importa aqui — se está dentro da gaveta ou dentro do mapa. */
const focado = (page) => page.evaluate(() => {
  const alvo = document.activeElement;
  if (!alvo) return null;
  return {
    tag: alvo.tagName,
    rotulo: alvo.getAttribute('aria-label'),
    texto: (alvo.textContent ?? '').trim().slice(0, 40),
    classe: alvo.className && typeof alvo.className === 'string' ? alvo.className : '',
    naGaveta: !!alvo.closest('.gaveta'),
    noMapa: !!alvo.closest('.map-page'),
    ehCanvas: alvo.tagName === 'CANVAS',
    ehAlvoDeMapa: alvo.classList.contains('map__alvo'),
    ehBody: alvo === document.body,
  };
});

/**
 * Tenta focar cada marcador por programa e diz quantos aceitaram.
 *
 * É a leitura direta do que `inert` faz: um marcador sob ancestral inert não vira `activeElement`
 * nem quando `.focus()` é chamado nele. Contar Tab um por um em 75 municípios seria lento e frágil;
 * isto responde a mesma pergunta — "algum marcador ficou preso?" — em uma passada.
 */
const marcadoresFocaveis = (page) => page.evaluate(() => {
  const alvos = [...document.querySelectorAll('.map__alvo')];
  let aceitaram = 0;
  for (const alvo of alvos) { alvo.focus(); if (document.activeElement === alvo) aceitaram += 1; }
  document.activeElement?.blur?.();
  return { total: alvos.length, aceitaram };
});

const estadoDosAlvos = (page) => page.evaluate(() => [...document.querySelectorAll('.map__alvo')].map((botao) => {
  const caixa = botao.getBoundingClientRect();
  return {
    codigo: botao.getAttribute('data-codigo-ibge'),
    rotulo: botao.getAttribute('aria-label'),
    pressionado: botao.getAttribute('aria-pressed') === 'true',
    marca: botao.dataset.marcaM06 ?? null,
    x: Math.round(caixa.x), y: Math.round(caixa.y),
  };
}));

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

    await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
    await page.waitForSelector('.map__alvo', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll('.map__alvo').length > 1, null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    /*
     * Marca posta nos nós dos Markers ANTES de qualquer coisa. Se o MapLibre recriasse os
     * elementos ao sair e voltar do inert, a marca sumiria — e um teste que só comparasse
     * contagem ou posição não veria a diferença.
     */
    await page.evaluate(() => document.querySelectorAll('.map__alvo').forEach((b) => { b.dataset.marcaM06 = '1'; }));
    const alvosIniciais = await estadoDosAlvos(page);

    // --------------------------------------------------------------- chegar a um equipamento afetado
    // Município com unidade seleciona e abre o painel; o de mais unidades maximiza a chance de
    // haver algum equipamento fora de DISPONIVEL, que é o que a lista de afetados mostra.
    const comUnidade = alvosIniciais
      .map((a) => ({ ...a, unidades: Number((a.rotulo.match(/: (\d+) unidade/) ?? [])[1] ?? 0) }))
      .filter((a) => a.unidades > 0)
      .sort((x, y) => y.unidades - x.unidades);

    let afetadoEncontrado = false;
    for (const municipio of comUnidade) {
      await page.click(`.map__alvo[data-codigo-ibge="${municipio.codigo}"]`);
      await page.waitForTimeout(400);
      // Município com várias unidades pede escolha antes de abrir o painel da unidade.
      if (await page.locator('.unit-list__escolha').count()) {
        const escolhas = await page.locator('.unit-list__escolha').count();
        for (let i = 0; i < escolhas; i += 1) {
          await page.locator('.unit-list__escolha').nth(i).click();
          await page.waitForSelector('.unit-panel', { timeout: 10000 });
          await page.waitForFunction(() => !document.querySelector('.unit-panel__vazio[role="status"]'), null, { timeout: 15000 });
          if (await page.locator('.afetados__item').count()) { afetadoEncontrado = true; break; }
        }
      } else if (await page.locator('.unit-panel').count()) {
        await page.waitForFunction(() => !document.querySelector('.unit-panel__vazio[role="status"]'), null, { timeout: 15000 });
        if (await page.locator('.afetados__item').count()) afetadoEncontrado = true;
      }
      if (afetadoEncontrado) break;
    }

    if (!afetadoEncontrado) {
      checar(0, 'há equipamento afetado no banco de dev para abrir a gaveta', false,
        'nenhuma unidade com equipamento fora de DISPONIVEL — roteiro não pôde exercitar a gaveta');
      throw new Error('sem equipamento afetado: o roteiro M06 não tem o que abrir');
    }

    const municipioSelecionado = (await estadoDosAlvos(page)).find((a) => a.pressionado)?.codigo ?? null;
    const painelAntes = (await page.textContent('.unit-panel')).replace(/\s+/g, ' ');
    const urlAntes = page.url();
    const nomeDoAfetado = (await page.locator('.afetados__nome').first().textContent()).trim();

    await page.locator('.afetados__item').first().focus();
    const gatilho = await focado(page);
    await page.locator('.afetados__item').first().click();
    await page.waitForSelector('.gaveta', { timeout: 15000 });
    await page.waitForTimeout(1200);

    // --------------------------------------------------------------- 1
    checar(1, 'clicar no equipamento afetado abre a gaveta SEM sair do mapa',
      page.url() === urlAntes && /\/mapa$/.test(page.url()) && (await page.locator('.gaveta').count()) === 1,
      `${urlAntes} -> ${page.url()}`);

    // --------------------------------------------------------------- 2
    const tituloGaveta = (await page.textContent('#drawer-equipamento-titulo')).trim();
    checar(2, 'a gaveta é a do equipamento clicado', tituloGaveta === nomeDoAfetado,
      `clicado="${nomeDoAfetado}" gaveta="${tituloGaveta}"`);

    // --------------------------------------------------------------- 3
    /*
     * O status do cabeçalho é o motivo de o Mapa ter de montar a `linha`: `EquipamentoResponse`
     * não traz status, e sem o input este badge ficaria vazio para sempre, sem erro nenhum.
     */
    const badgeNoTopo = await page.locator('.gaveta__nome app-status-badge').count();
    const statusKpi = (await page.locator('.kpis .kpi').first().textContent()).replace(/\s+/g, ' ').trim();
    checar(3, 'status chega pela linha montada no mapa (badge no topo e KPI preenchido)',
      badgeNoTopo === 1 && !/Status —/.test(statusKpi), `badges=${badgeNoTopo} kpi="${statusKpi}"`);

    // --------------------------------------------------------------- 4
    const painelDepois = (await page.textContent('.unit-panel')).replace(/\s+/g, ' ');
    const painelVisivel = await page.locator('.unit-panel').isVisible();
    checar(4, 'painel da unidade continua visível atrás do backdrop, intacto',
      painelVisivel && painelDepois === painelAntes, `visível=${painelVisivel} idêntico=${painelDepois === painelAntes}`);

    // --------------------------------------------------------------- 5 (inert ligado)
    const inertLigado = await page.evaluate(() => document.querySelector('.map-page')?.hasAttribute('inert') ?? false);
    checar(5, 'inert aplicado na página do mapa enquanto a gaveta está aberta', inertLigado, `inert=${inertLigado}`);

    // --------------------------------------------------------------- 6 (a) — Tab não alcança o mapa
    /*
     * A exigência literal do M06: partir do ÚLTIMO focável de dentro da gaveta. Com
     * `acoesDeGestao=false` o rodapé tem só "Abrir histórico", e é ele o último. Cinco Tabs, não
     * um: um único Tab poderia cair fora do mapa por acaso e o próximo entrar nele.
     */
    const focaveisNaGaveta = await page.evaluate(() => {
      const seletor = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
      return [...document.querySelectorAll('.gaveta ' + seletor)].length;
    });
    await page.locator('.gaveta__acoes .botao').last().focus();
    const partida = await focado(page);
    const trajeto = [];
    for (let i = 0; i < 5; i += 1) { await page.keyboard.press('Tab'); trajeto.push(await focado(page)); }
    const vazouParaOMapa = trajeto.some((f) => f && (f.noMapa || f.ehCanvas || f.ehAlvoDeMapa));
    checar(6, '(a) Tab a partir do último focável da gaveta NÃO alcança canvas nem marcadores',
      !vazouParaOMapa && partida.naGaveta,
      `partida="${partida.texto}" (${focaveisNaGaveta} focáveis na gaveta); trajeto=${trajeto.map((f) => f ? (f.ehCanvas ? 'CANVAS' : f.ehAlvoDeMapa ? 'MARCADOR' : f.ehBody ? 'body' : f.tag) : 'nulo').join(' > ')}`);

    // --------------------------------------------------------------- 7 (a) — nem por Shift+Tab, nem por .focus()
    await page.locator('.gaveta__acoes .botao').last().focus();
    const trajetoVolta = [];
    for (let i = 0; i < 5; i += 1) { await page.keyboard.press('Shift+Tab'); trajetoVolta.push(await focado(page)); }
    const vazouDeVolta = trajetoVolta.some((f) => f && (f.noMapa || f.ehCanvas || f.ehAlvoDeMapa));
    const presosComInert = await marcadoresFocaveis(page);
    checar(7, '(a) marcadores e canvas inalcançáveis por Shift+Tab e por focus() programático',
      !vazouDeVolta && presosComInert.aceitaram === 0,
      `Shift+Tab vazou=${vazouDeVolta}; ${presosComInert.aceitaram}/${presosComInert.total} marcadores aceitaram foco`);

    // --------------------------------------------------------------- 8 (rodapé sem ações de gestão)
    const rodape = (await page.locator('.gaveta__acoes .botao').allTextContents()).map((t) => t.trim());
    checar(8, 'rodapé no Mapa traz só "Abrir histórico" (host não implementa editar/alternar)',
      rodape.length === 1 && rodape[0] === 'Abrir histórico', JSON.stringify(rodape));

    await page.screenshot({ path: path.join(OUT, '01-gaveta-sobre-o-mapa.png') });

    // --------------------------------------------------------------- 9 e 10 (Escape fecha, foco volta)
    await page.locator('.gaveta').focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    checar(9, 'Escape fecha a gaveta e mantém a rota do mapa',
      (await page.locator('.gaveta').count()) === 0 && /\/mapa$/.test(page.url()), page.url());

    const focoAoFechar = await focado(page);
    checar(10, 'foco volta ao equipamento afetado que abriu a gaveta',
      focoAoFechar && focoAoFechar.classe.includes('afetados__item') && focoAoFechar.texto.includes(nomeDoAfetado.slice(0, 12)),
      JSON.stringify(focoAoFechar));

    // --------------------------------------------------------------- 11 (b) — inert removido
    const inertDepois = await page.evaluate(() => document.querySelector('.map-page')?.hasAttribute('inert') ?? false);
    checar(11, '(b) inert removido da página do mapa ao fechar a gaveta', inertDepois === false, `inert=${inertDepois}`);

    // --------------------------------------------------------------- 12 (b) — nenhum marcador preso
    const depoisDeFechar = await marcadoresFocaveis(page);
    checar(12, '(b) todos os marcadores voltam a aceitar foco — nenhum preso',
      depoisDeFechar.total > 0 && depoisDeFechar.aceitaram === depoisDeFechar.total,
      `${depoisDeFechar.aceitaram}/${depoisDeFechar.total} marcadores focáveis`);

    // --------------------------------------------------------------- 13 (b) — ordem de Tab do mapa intacta
    // Mesma verificação do N05 (casos 3 e 4), refeita depois do ciclo de inert: o canvas volta a
    // ser o primeiro stop do cartão e o primeiro município vem logo em seguida.
    await page.locator('.map-page__header .botao').focus();
    await page.keyboard.press('Tab');
    const stopCanvas = await focado(page);
    await page.keyboard.press('Tab');
    const stopMunicipio = await focado(page);
    checar(13, '(b) mapa volta totalmente navegável: canvas e depois o primeiro município',
      stopCanvas.ehCanvas && stopMunicipio.ehAlvoDeMapa,
      `${stopCanvas.tag}/${stopCanvas.rotulo} > ${stopMunicipio.ehAlvoDeMapa ? stopMunicipio.rotulo : stopMunicipio.tag}`);

    /* ===================================================================================
     * O MapLibre reagiu bem a ter tido um ancestral inert? (exigência do M06)
     * =================================================================================== */

    // --------------------------------------------------------------- 14 (seleção preservada)
    const alvosDepois = await estadoDosAlvos(page);
    const pressionados = alvosDepois.filter((a) => a.pressionado);
    checar(14, 'seleção do município sobrevive ao ciclo de inert',
      pressionados.length === 1 && pressionados[0].codigo === municipioSelecionado,
      `antes=${municipioSelecionado} depois=${pressionados.map((a) => a.codigo).join(',') || '(nenhum)'}`);

    // --------------------------------------------------------------- 15 (identidade dos nós)
    const comMarca = alvosDepois.filter((a) => a.marca === '1').length;
    checar(15, 'inert não faz a lib recriar os Markers (marca posta antes continua nos nós)',
      alvosDepois.length === alvosIniciais.length && comMarca === alvosDepois.length,
      `${comMarca}/${alvosDepois.length} nós com a marca; ${alvosIniciais.length} alvos antes`);

    // --------------------------------------------------------------- 16 (câmera continua viva)
    const caixaMapa = await page.locator('.map').boundingBox();
    await page.mouse.move(caixaMapa.x + caixaMapa.width / 2, caixaMapa.y + caixaMapa.height / 2);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(1000);
    const alvosPosCamera = await estadoDosAlvos(page);
    const moveu = alvosPosCamera.some((a) => {
      const antes = alvosDepois.find((b) => b.codigo === a.codigo);
      return antes && (antes.x !== a.x || antes.y !== a.y);
    });
    checar(16, 'câmera e reposicionamento continuam funcionando depois do inert', moveu,
      `alvos reposicionados=${moveu}`);

    // --------------------------------------------------------------- 17 (canvas ainda desenhando)
    const canvasVivo = await page.evaluate(() => {
      const canvas = document.querySelector('.maplibregl-canvas');
      if (!canvas) return { existe: false };
      const contexto = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      return { existe: true, largura: canvas.width, altura: canvas.height, perdido: contexto ? contexto.isContextLost() : null };
    });
    checar(17, 'contexto WebGL intacto — não foi perdido nem zerado pelo inert',
      canvasVivo.existe && canvasVivo.largura > 0 && canvasVivo.altura > 0 && canvasVivo.perdido !== true,
      JSON.stringify(canvasVivo));

    await page.screenshot({ path: path.join(OUT, '02-mapa-apos-fechar.png') });

    // --------------------------------------------------------------- 18 (reabrir continua funcionando)
    await page.locator('.afetados__item').first().click();
    await page.waitForSelector('.gaveta', { timeout: 15000 });
    await page.waitForTimeout(600);
    const reabriu = (await page.locator('.gaveta').count()) === 1
      && (await page.evaluate(() => document.querySelector('.map-page')?.hasAttribute('inert') ?? false));
    await page.locator('.gaveta__fechar').click();
    await page.waitForTimeout(600);
    checar(18, 'ciclo abre/fecha é repetível: reabrir religa o inert, botão × desliga',
      reabriu && (await page.locator('.gaveta').count()) === 0
      && (await page.evaluate(() => document.querySelector('.map-page')?.hasAttribute('inert') ?? false)) === false,
      `reabriu com inert=${reabriu}`);

    // --------------------------------------------------------------- 19
    checar(19, 'nenhum erro de página no roteiro inteiro', erros.length === 0, erros.join(' | '));
  } catch (erro) {
    fatal = erro;
  } finally {
    fs.writeFileSync(path.join(OUT, 'm06-drawer-no-mapa.json'),
      JSON.stringify({ resultados, rede: redeCompleta, erros, fatal: fatal ? String(fatal) : null }, null, 2));
    await page.screenshot({ path: path.join(OUT, 'final.png') }).catch(() => {});
    await browser.close();
  }

  for (const r of resultados) console.log(`${r.ok ? 'OK   ' : 'FALHA'} [caso ${r.caso}] ${r.nome}${r.detalhe ? ' — ' + r.detalhe : ''}`);
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - falhas}/${resultados.length} verificacoes`);
  if (fatal) {
    console.error('\nEXECUÇÃO INTERROMPIDA — log em ' + path.join(OUT, 'm06-drawer-no-mapa.json'));
    console.error(fatal.stack ?? fatal);
    process.exit(2);
  }
  process.exit(falhas ? 1 : 0);
})();

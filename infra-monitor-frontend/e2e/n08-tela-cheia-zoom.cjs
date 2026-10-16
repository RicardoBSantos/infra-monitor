/*
 * N08 — mapa em tela cheia: título sobre o mapa, marcador abre a unidade direto, município aproxima
 * o zoom, legenda recolhível.
 *
 *   N08_SENHA=<senha> node e2e/n08-tela-cheia-zoom.cjs
 *
 * Pré-requisitos: backend em 8080, `ng serve` em 4200, PostgreSQL de dev com o seed aplicado.
 *
 * Regras herdadas dos roteiros anteriores:
 * 1. Sessão só existe em memória: depois do login, navegação SÓ por clique (page.goto cai em /login).
 * 2. Nada de catch silencioso em seletor: seletor que deixou de casar falha alto.
 * 3. Resultados gravados em `finally`, aconteça o que acontecer.
 *
 * O canvas WebGL não é legível (preserveDrawingBuffer desligado) e não há handle do objeto Map na
 * página. A câmera é medida pela posição, no DOM, dos marcadores (`.map__alvo`, `.map__unidade`).
 * Nenhuma contagem é cravada: tudo que depende de dados sai do payload de /dashboard/unidades,
 * capturado em `page.on('response')`.
 *
 * Desvios assumidos (decisão do orquestrador):
 * - Estouro horizontal do DOCUMENTO é só registrado ("pré-existente: topbar"): a barra do shell
 *   transborda em <=1280px em todas as páginas. Afirma-se `.map-page`/`.map-layout`.
 * - ITA-09 sem divergência de IBGE no dado: sub-verificação marcada NÃO APLICÁVEL, nunca falso verde.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = 'http://127.0.0.1:4200';
const EMAIL = 'admin@inframonitor.local';
const SENHA = process.env.N08_SENHA;
if (!SENHA) throw new Error('N08_SENHA é obrigatória');

const OUT = path.join(__dirname, 'n08-evidence');
fs.mkdirSync(OUT, { recursive: true });

const DURACAO = 600;
const ESPERA_CAMERA = DURACAO + 300;
const IBGE_ARACAJU = '2800308';

const resultados = [];
const medidas = {};
const checar = (caso, nome, ok, detalhe) => { resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' }); };
/** Sub-verificação que não se aplica ao dado atual: ok (não derruba a corrida), mas fora da contagem de aprovados. */
const naoAplicavel = (caso, nome, motivo) => { resultados.push({ caso, nome, ok: true, na: true, detalhe: 'NÃO APLICÁVEL: ' + motivo }); };
const pausa = (page, ms) => page.waitForTimeout(ms);
/** Espera as posições dos alvos ficarem estáveis por 3 amostras seguidas (a câmera parou). */
const esperarCameraParada = async (page) => {
  // Estado local por chamada: o contador no window sobrevivia entre chamadas e dava "parada" falso.
  await page.evaluate(() => { window.__n08Igual = 0; window.__n08Ult = null; });
  await page.waitForFunction(() => {
  const w = window;
  const ler = () => [...document.querySelectorAll('.map__alvo')].slice(0, 12).map((a) => { const c = a.getBoundingClientRect(); return Math.round(c.x) + ',' + Math.round(c.y); }).join(';');
  const agora = ler();
  if (w.__n08Ult === agora) w.__n08Igual = (w.__n08Igual || 0) + 1; else { w.__n08Igual = 0; w.__n08Ult = agora; }
  return w.__n08Igual >= 3;
  }, null, { polling: 100, timeout: 10000 });
};

const errosPagina = [];
const errosConsole = [];
const errosConsoleEsperados = [];
const respostas5xx = [];

/** Abre contexto + página, instala os coletores de erro e de payload. */
async function novaPagina(browser, rotulo, opcoesContexto = {}, ignorarRede = false) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, ...opcoesContexto });
  const page = await ctx.newPage();
  const estado = { payload: null, respostas: 0 };
  page.on('pageerror', (e) => errosPagina.push(`[${rotulo}] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const linha = `[${rotulo}] ${m.text()}`;
    // Contexto do caso 15: só o que vem da requisição abortada de /dashboard/unidades é esperado.
    const doAborto = (m.location().url + ' ' + m.text()).includes('dashboard/unidades');
    if (ignorarRede && doAborto) errosConsoleEsperados.push(linha); else errosConsole.push(linha);
  });
  page.on('response', async (r) => {
    if (r.status() >= 500) { const l = `[${rotulo}] HTTP ${r.status()} ${r.request().method()} ${r.url()}`; respostas5xx.push(l); }
    if (!/\/dashboard\/unidades(\?|$)/.test(r.url()) || r.request().method() !== 'GET') return;
    try {
      const j = await r.json();
      estado.payload = Array.isArray(j) ? j : (j.unidades ?? j.content ?? j.itens ?? j);
      estado.respostas += 1;
    } catch (e) { errosPagina.push(`[${rotulo}] payload ilegível: ${e.message}`); }
  });
  return { ctx, page, estado };
}

async function entrar(page, senha) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-senha', senha);
  await page.click('.login-submit');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
}

/** Em tela estreita a navegação vive numa gaveta: abre pelo botão do topo antes de clicar o link. */
async function irPara(page, href) {
  if (await page.locator('.menu-button').isVisible()) await page.click('.menu-button');
  await page.click(`.navigation__item[href="${href}"]`);
}

async function abrirMapa(page, esperarAlvos = true) {
  await irPara(page, '/mapa');
  if (esperarAlvos) {
    await page.waitForSelector('.map__alvo', { timeout: 20000 });
    await page.waitForSelector('.map__unidade', { timeout: 20000 });
    await pausa(page, 1800);
  }
}

/** Centro (px de viewport) de um elemento qualquer. */
const centro = (page, seletor) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) throw new Error('seletor sem elemento: ' + s);
  const c = e.getBoundingClientRect();
  return { x: c.x + c.width / 2, y: c.y + c.height / 2 };
}, seletor);

const distancia = async (page, a, b) => {
  const [pa, pb] = [await centro(page, a), await centro(page, b)];
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
};

const alvoSel = (codigo) => `.map__alvo[data-codigo-ibge="${codigo}"]`;
const marcSel = (id) => `.map__unidade[data-unidade-id="${id}"]`;

const alvos = (page) => page.evaluate(() => [...document.querySelectorAll('.map__alvo')].map((a) => ({
  codigo: a.getAttribute('data-codigo-ibge'), rotulo: a.getAttribute('aria-label'), temPressed: a.hasAttribute('aria-pressed'),
})));

/** Centros de todos os marcadores de unidade. */
const marcadores = (page) => page.evaluate(() => [...document.querySelectorAll('.map__unidade')].map((b) => {
  const c = b.getBoundingClientRect();
  return { id: b.getAttribute('data-unidade-id'), rotulo: b.getAttribute('aria-label'), x: c.x + c.width / 2, y: c.y + c.height / 2, l: c.width, a: c.height };
}));

const vizinhoMaisProximo = (lista) => lista.map((m, i) => ({
  ...m,
  vizinho: lista.length < 2 ? Infinity : Math.min(...lista.filter((_, j) => j !== i).map((o) => Math.hypot(o.x - m.x, o.y - m.y))),
}));

const cliqueLogico = (page, seletor) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) throw new Error('seletor sem elemento: ' + s);
  e.click();
}, seletor);

const nomePainel = async (page) => {
  const n = await page.locator('.unit-panel__nome').count();
  return n ? (await page.locator('.unit-panel__nome').first().textContent()).trim() : null;
};

const voltarVisivel = async (page) => (await page.locator('.map__voltar').count()) > 0 && await page.locator('.map__voltar').isVisible();

const caixas = (page, seletores) => page.evaluate((sels) => sels.map((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const c = e.getBoundingClientRect();
  return { l: c.left, t: c.top, r: c.right, b: c.bottom };
}), seletores);
const cruzam = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

/** Volta ao enquadramento inicial pelo botão, se estiver fora dele. */
async function voltarAoEstado(page) {
  if (await page.locator('.map__voltar').count()) {
    await page.click('.map__voltar');
    await pausa(page, ESPERA_CAMERA);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let fatal = null;
  const p1 = await novaPagina(browser, 'principal');
  const page = p1.page;

  try {
    // ------------------------------------------------------------------ login e abertura
    await entrar(page, SENHA);
    await abrirMapa(page);

    const dados = p1.estado.payload;
    if (!Array.isArray(dados) || !dados.length) throw new Error('payload de /dashboard/unidades vazio ou ilegível');
    const comCoord = dados.filter((u) => u.latitude != null && u.longitude != null);
    const aracaju = dados.filter((u) => String(u.codigoIbge ?? '') === IBGE_ARACAJU && u.latitude != null);
    medidas.unidadesNoPayload = dados.length; medidas.unidadesComCoordenada = comCoord.length; medidas.unidadesAracaju = aracaju.length;
    if (!aracaju.length) throw new Error('payload sem unidade de Aracaju (IBGE ' + IBGE_ARACAJU + ')');

    // (a) sem seleção — logo ao abrir
    await page.screenshot({ path: path.join(OUT, 'a-sem-selecao.png'), fullPage: true });
    checar(5, 'a-sem-selecao.png capturado sem seleção', (await page.locator('.unit-panel').count()) === 0, 'sem .unit-panel ao abrir');

    // Par de referência: Aracaju × o município mais distante dele no enquadramento inicial.
    const todosAlvos = await alvos(page);
    const ref = await centro(page, alvoSel(IBGE_ARACAJU));
    let longe = null;
    for (const a of todosAlvos) {
      if (a.codigo === IBGE_ARACAJU) continue;
      const d = await distancia(page, alvoSel(IBGE_ARACAJU), alvoSel(a.codigo));
      if (!longe || d > longe.d) longe = { codigo: a.codigo, d };
    }
    const PAR = [alvoSel(IBGE_ARACAJU), alvoSel(longe.codigo)];
    const dist = () => distancia(page, PAR[0], PAR[1]);
    let d0 = await dist();
    medidas.parReferencia = { aracaju: IBGE_ARACAJU, outro: longe.codigo, distanciaInicial: +d0.toFixed(1), alvosNoMapa: todosAlvos.length };

    // ------------------------------------------------------------------ 2. título (1600x900)
    const verTitulo = async (rotulo) => {
      const [cartao, placa] = await caixas(page, ['.map-card', '.map-titulo']);
      const ctrl = (await caixas(page, ['.maplibregl-ctrl-top-right']))[0];
      const ms = await marcadores(page);
      const caixasM = ms.map((m) => ({ l: m.x - m.l / 2, r: m.x + m.l / 2, t: m.y - m.a / 2, b: m.y + m.a / 2 }));
      const dentro = placa.l >= cartao.l - 0.5 && placa.r <= cartao.r + 0.5 && placa.t >= cartao.t - 0.5 && placa.b <= cartao.b + 0.5;
      const comCtrl = ctrl ? cruzam(placa, ctrl) : false;
      const comMarc = caixasM.filter((c) => cruzam(placa, c)).length;
      checar(2, `placa dentro do cartão, sem cruzar controle de zoom nem marcadores (${rotulo})`, dentro && !comCtrl && comMarc === 0,
        `dentro=${dentro} cruzaControle=${comCtrl} marcadoresCruzados=${comMarc}/${ms.length}`);
    };
    checar(2, 'sem .map-page__header', (await page.locator('.map-page__header').count()) === 0);
    checar(2, 'h1#map-title em .map-card .map-titulo diz "Mapa operacional"',
      (await page.locator('.map-card .map-titulo h1#map-title').count()) === 1 && (await page.locator('h1#map-title').innerText()).trim() === 'Mapa operacional');
    await verTitulo('1600x900');

    // ------------------------------------------------------------------ 4. rodapé fora
    const textoPainel = (await page.locator('.map-panel').innerText()).toUpperCase();
    const textoPagina = (await page.locator('.map-page').innerText()).toUpperCase();
    checar(4, 'sem .map-source', (await page.locator('.map-source').count()) === 0);
    checar(4, 'sem "BASE CARTOGRÁFICA" nem "FONTE OPERACIONAL" no painel (nem na página)',
      !/BASE CARTOGR[ÁA]FICA|FONTE OPERACIONAL/.test(textoPainel) && !/BASE CARTOGR[ÁA]FICA|FONTE OPERACIONAL/.test(textoPagina));

    // ------------------------------------------------------------------ 14. legenda (sem seleção)
    const leg = page.locator('details.legend-bloco');
    checar(14, 'legenda fechada por padrão (sem atributo open)', !(await leg.evaluate((e) => e.open)) && (await leg.getAttribute('open')) === null);
    await page.locator('.map-panel').screenshot({ path: path.join(OUT, 'd-legenda-fechada.png') });
    await page.click('summary.legend-bloco__resumo');
    await pausa(page, 250);
    const aberta = await leg.evaluate((e) => e.open);
    const notas = await page.evaluate(() => {
      const painel = document.querySelector('.map-panel');
      const itens = document.querySelectorAll('.legend-bloco > .legend li').length;
      const lista = [...document.querySelectorAll('.legend-bloco > .legend__nota')].map((n) => {
        const cs = getComputedStyle(n);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        return { texto: n.textContent.trim(), altura: n.getBoundingClientRect().height, lh };
      });
      return { itens, lista, painelOverflowX: painel.scrollWidth - painel.clientWidth };
    });
    checar(14, 'clicar o summary abre a legenda', aberta);
    checar(14, 'legenda aberta: 6 itens e 2 notas', notas.itens === 6 && notas.lista.length === 2, `${notas.itens} li, ${notas.lista.length} notas`);
    checar(14, 'notas em uma linha só (altura <= 1,5x line-height)', notas.lista.every((n) => n.altura <= n.lh * 1.5),
      notas.lista.map((n) => `${n.altura.toFixed(1)}px/lh ${n.lh.toFixed(1)}`).join(' | '));
    checar(14, 'painel sem estouro horizontal com a legenda aberta', notas.painelOverflowX <= 0, `excedente ${notas.painelOverflowX}px`);
    checar(14, 'textos exatos das duas notas',
      notas.lista[0]?.texto === 'Município é neutro: situa, não indica estado.' && notas.lista[1]?.texto === 'Arco liga unidade ao hub, na cor do status.',
      JSON.stringify(notas.lista.map((n) => n.texto)));
    await page.locator('.map-panel').screenshot({ path: path.join(OUT, 'd-legenda-aberta.png') });
    await page.click('summary.legend-bloco__resumo');
    await pausa(page, 250);
    checar(14, 'clicar de novo fecha', !(await leg.evaluate((e) => e.open)));
    await page.focus('summary.legend-bloco__resumo');
    await page.keyboard.press('Enter');
    await pausa(page, 200);
    const porEnter = await leg.evaluate((e) => e.open);
    await page.keyboard.press('Enter');
    await pausa(page, 200);
    const fechouEnter = !(await leg.evaluate((e) => e.open));
    checar(14, 'teclado: Enter no summary alterna (abre e fecha)', porEnter && fechouEnter, `abriu=${porEnter} fechou=${fechouEnter}`);

    // ------------------------------------------------------------------ 3. Atualizar no painel
    const topoPainel = await page.evaluate(() => {
      const painel = document.querySelector('.map-panel');
      const primeiro = painel.firstElementChild;
      const botao = document.querySelector('.map-panel__topo .botao');
      return { texto: botao ? botao.textContent.trim() : null, primeiroEhTopo: primeiro === botao?.closest('.map-panel__topo') };
    });
    checar(3, '"Atualizar" em .map-panel__topo, primeiro filho do painel', topoPainel.texto === 'Atualizar' && topoPainel.primeiroEhTopo, JSON.stringify(topoPainel));
    const antesResp = p1.estado.respostas;
    await Promise.all([
      page.waitForResponse((r) => /\/dashboard\/unidades(\?|$)/.test(r.url()) && r.request().method() === 'GET', { timeout: 15000 }),
      page.click('.map-panel__topo .botao'),
    ]);
    await page.waitForSelector('.map__alvo', { timeout: 20000 });
    await pausa(page, 1800);
    checar(3, 'clicar em Atualizar refaz /dashboard/unidades', p1.estado.respostas > antesResp, `respostas ${antesResp} -> ${p1.estado.respostas}`);
    d0 = await dist();
    medidas.parReferencia.distanciaInicialAposAtualizar = +d0.toFixed(1);

    // ------------------------------------------------------------------ 6. marcador abre direto
    const geometriaPainel = () => page.evaluate(() => {
      const painel = document.querySelector('.map-panel');
      const u = document.querySelector('.unit-panel');
      if (!u) return null;
      return { scrollTop: painel.scrollTop, topoRelativo: u.getBoundingClientRect().top - painel.getBoundingClientRect().top, alturaPainel: painel.clientHeight, selectedPanel: document.querySelectorAll('.selected-panel').length };
    });
    const u0 = aracaju[0];
    await cliqueLogico(page, marcSel(u0.id));
    await pausa(page, 400);
    const nomeA = await nomePainel(page);
    const gA = await geometriaPainel();
    checar(6, `marcador de Aracaju abre .unit-panel com o nome (${u0.nome})`, nomeA === u0.nome, `painel: ${nomeA}`);
    checar(6, 'Aracaju: .selected-panel inexistente e unit-panel visível sem rolar',
      gA && gA.selectedPanel === 0 && gA.scrollTop === 0 && gA.topoRelativo < gA.alturaPainel, JSON.stringify(gA));
    await page.waitForFunction(() => !document.querySelector('.unit-panel__vazio[role=status]'), null, { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'b-detalhe-por-marcador.png') });

    // ITA-09: varre todos os marcadores; quem mostra .aviso-ibge tem IBGE divergente da coordenada.
    const varredura = [];
    for (const u of comCoord) {
      if (!(await page.locator(marcSel(u.id)).count())) continue;
      await cliqueLogico(page, marcSel(u.id));
      await page.waitForFunction((nome) => document.querySelector('.unit-panel__nome')?.textContent.trim() === nome && !document.querySelector('.unit-panel__vazio[role=status]'), u.nome, { timeout: 10000 });
      varredura.push({ id: u.id, nome: u.nome, painel: await nomePainel(page), divergente: (await page.locator('.aviso-ibge').count()) > 0, g: await geometriaPainel() });
    }
    const falhaNome = varredura.filter((v) => v.painel !== v.nome);
    const falhaGeo = varredura.filter((v) => !v.g || v.g.selectedPanel !== 0 || v.g.scrollTop !== 0 || v.g.topoRelativo >= v.g.alturaPainel);
    checar(6, 'todo marcador abre o painel da própria unidade, visível sem rolar', varredura.length > 0 && !falhaNome.length && !falhaGeo.length,
      `${varredura.length} marcadores varridos; nome errado: ${falhaNome.map((v) => v.nome).join(',') || '-'}; geometria: ${falhaGeo.map((v) => v.nome).join(',') || '-'}`);
    const divergentes = varredura.filter((v) => v.divergente);
    if (!divergentes.length) {
      naoAplicavel(6, 'ITA-09 (IBGE divergente) abre direto', 'nenhuma unidade do payload tem IBGE divergente da coordenada (nenhum .aviso-ibge em ' + varredura.length + ' painéis)');
    } else {
      const ok = divergentes.every((v) => v.painel === v.nome && v.g && v.g.selectedPanel === 0 && v.g.scrollTop === 0 && v.g.topoRelativo < v.g.alturaPainel);
      checar(6, 'unidade com IBGE divergente abre direto, com aviso, visível sem rolar', ok, divergentes.map((v) => v.nome).join(', '));
    }

    // ------------------------------------------------------------------ 7. marcador não aproxima
    const ordenados = vizinhoMaisProximo(await marcadores(page)).sort((x, y) => y.vizinho - x.vizinho);
    const isolado = ordenados[0];
    d0 = await dist();
    await cliqueLogico(page, marcSel(aracaju[aracaju.length - 1].id));
    await pausa(page, ESPERA_CAMERA);
    const dApos = await dist();
    checar(7, 'clique lógico no marcador não muda a câmera (distância ±1px) nem mostra "Ver estado inteiro"',
      Math.abs(dApos - d0) <= 1 && !(await voltarVisivel(page)), `antes ${d0.toFixed(1)} depois ${dApos.toFixed(1)}`);
    const noIsolado = await page.evaluate(({ x, y, id }) => {
      const e = document.elementFromPoint(x, y);
      return e && (e.getAttribute('data-unidade-id') === id || !!e.closest(`.map__unidade[data-unidade-id="${id}"]`));
    }, { x: isolado.x, y: isolado.y, id: isolado.id });
    await page.mouse.click(isolado.x, isolado.y);
    await pausa(page, ESPERA_CAMERA);
    const dFis = await dist();
    const nomeIso = await nomePainel(page);
    const nomeEsperadoIso = dados.find((u) => String(u.id) === isolado.id).nome;
    checar(7, 'clique físico no marcador mais isolado: câmera parada, sem botão de volta, painel da unidade',
      noIsolado && Math.abs(dFis - d0) <= 1 && !(await voltarVisivel(page)) && nomeIso === nomeEsperadoIso,
      `isolado ${nomeEsperadoIso} (vizinho a ${isolado.vizinho.toFixed(0)}px) elementFromPoint=${noIsolado} distância ${d0.toFixed(1)} -> ${dFis.toFixed(1)} painel="${nomeIso}"`);

    // ------------------------------------------------------------------ 8. município aproxima
    const nomeAntesZoom = await nomePainel(page);
    const cartaoAntes = (await caixas(page, ['.map-card']))[0];
    const centroA = await centro(page, alvoSel(IBGE_ARACAJU));
    const candidatos = [];
    for (const r of [20, 28, 38, 50, 64]) for (let k = 0; k < 16; k++) { const ang = (k * Math.PI * 2) / 16; candidatos.push({ x: centroA.x + r * Math.cos(ang), y: centroA.y + r * Math.sin(ang), r }); }
    let zoomFeito = null; let tentativas = 0;
    const dInicioAracaju = d0;
    const idsAr = new Set(aracaju.map((u) => String(u.id)));
    const PAD = { top: 110, right: 70, bottom: 50, left: 60 }; // espelha PADDING_MUNICIPIO do componente
    for (const c of candidatos) {
      const ehCanvas = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return !!e && e.tagName === 'CANVAS'; }, c);
      if (!ehCanvas) continue;
      tentativas += 1;
      await page.mouse.click(c.x, c.y);
      await pausa(page, ESPERA_CAMERA);
      if (await voltarVisivel(page)) {
        // O retry existe só para achar um pixel de canvas dentro do polígono. O primeiro clique que
        // aproxima é o que vale: se caiu em município vizinho, o caso falha em vez de tentar outro.
        // O centro que importa é o das UNIDADES de Aracaju (o enquadramento é o envelope delas, D20).
        const ms = (await marcadores(page)).filter((m) => idsAr.has(m.id));
        const cc = { x: (Math.min(...ms.map((m) => m.x)) + Math.max(...ms.map((m) => m.x))) / 2, y: (Math.min(...ms.map((m) => m.y)) + Math.max(...ms.map((m) => m.y))) / 2 };
        const cartao = (await caixas(page, ['.map-card']))[0];
        const largura = cartao.r - cartao.l, altura = cartao.b - cartao.t;
        // O fitBounds centra na área útil, não no cartão: o PADDING_MUNICIPIO é assimétrico (título em
        // cima à esquerda), então o centro esperado desloca (esq-dir)/2 em x e (topo-base)/2 em y.
        const esperado = { x: cartao.l + largura / 2 + (PAD.left - PAD.right) / 2, y: cartao.t + altura / 2 + (PAD.top - PAD.bottom) / 2 };
        const dx = Math.abs(cc.x - esperado.x) / largura, dy = Math.abs(cc.y - esperado.y) / altura;
        zoomFeito = { ponto: c, dx, dy, ok: dx <= 0.1 && dy <= 0.1 };
        break;
      }
    }
    const dZoom = await dist();
    const nomeDepoisZoom = await nomePainel(page);
    medidas.zoomAracaju = { distanciaParAntes: +dInicioAracaju.toFixed(1), distanciaParDepois: +dZoom.toFixed(1), fator: +(dZoom / dInicioAracaju).toFixed(2), tentativasDeClique: tentativas, cartao: cartaoAntes };
    checar(8, 'clique no polígono de Aracaju (fora de marcador) aproxima: distância cresce e o envelope das unidades de Aracaju vai ao centro da área útil do cartão (padding assimétrico, ±10%)',
      !!zoomFeito && zoomFeito.ok && dZoom > dInicioAracaju * 1.3 && await voltarVisivel(page),
      zoomFeito ? `distância ${dInicioAracaju.toFixed(1)} -> ${dZoom.toFixed(1)} (x${(dZoom / dInicioAracaju).toFixed(2)}); desvio do centro ${(zoomFeito.dx * 100).toFixed(1)}%/${(zoomFeito.dy * 100).toFixed(1)}%; ${tentativas} tentativa(s), raio ${zoomFeito.ponto.r}px`
        : `nenhum ponto produziu o zoom em Aracaju em ${tentativas} tentativa(s)`);
    checar(8, 'painel da unidade aberta continua com o mesmo nome após o zoom', nomeAntesZoom !== null && nomeDepoisZoom === nomeAntesZoom, `"${nomeAntesZoom}" -> "${nomeDepoisZoom}"`);
    await page.screenshot({ path: path.join(OUT, 'c-zoom-municipio.png') });

    // ------------------------------------------------------------------ 9. Aracaju clicável um a um
    const todosM = vizinhoMaisProximo(await marcadores(page));
    const idsAracaju = new Set(aracaju.map((u) => String(u.id)));
    const mAracaju = vizinhoMaisProximo(todosM.filter((m) => idsAracaju.has(m.id)));
    const minimoPar = Math.min(...mAracaju.map((m) => m.vizinho));
    medidas.aracajuVizinhoMaisProximoPx = +minimoPar.toFixed(1);
    medidas.aracajuMarcadores = mAracaju.map((m) => ({ id: m.id, vizinho: +m.vizinho.toFixed(1) }));
    // Requisito do usuário (D20): "cada um fica clicável". Os 60px do plano eram número inventado; o que se
    // afirma é que nenhuma caixa de marcador de Aracaju sobrepõe outra. O vizinho mais próximo é só registrado.
    const sobrepostos = [];
    for (let i = 0; i < mAracaju.length; i++) for (let j = i + 1; j < mAracaju.length; j++) {
      const a = mAracaju[i], b = mAracaju[j];
      if (Math.abs(a.x - b.x) < (a.l + b.l) / 2 && Math.abs(a.y - b.y) < (a.a + b.a) / 2) sobrepostos.push(`${a.id}×${b.id}`);
    }
    medidas.aracajuCaixasSobrepostas = sobrepostos;
    checar(9, 'nenhum par de marcadores de Aracaju com caixas sobrepostas', mAracaju.length === aracaju.length && sobrepostos.length === 0,
      `${mAracaju.length}/${aracaju.length} marcadores; vizinho mais próximo ${minimoPar.toFixed(1)}px (registrado); caixa ${mAracaju[0]?.l}x${mAracaju[0]?.a}px; sobrepostos: ${sobrepostos.join(', ') || '-'}`);
    const falhasClique = [];
    for (const u of aracaju) {
      const m = mAracaju.find((x) => x.id === String(u.id));
      if (!m) { falhasClique.push(`${u.nome}: sem marcador`); continue; }
      const topo = await page.evaluate(({ x, y, id }) => {
        const e = document.elementFromPoint(x, y);
        return !!e && (e.getAttribute('data-unidade-id') === id || !!e.closest(`.map__unidade[data-unidade-id="${id}"]`));
      }, { x: m.x, y: m.y, id: m.id });
      await page.mouse.click(m.x, m.y);
      await pausa(page, 400);
      const nome = await nomePainel(page);
      if (!topo || nome !== u.nome) falhasClique.push(`${u.nome}: elementFromPoint=${topo} painel="${nome}"`);
    }
    // O piso de 40px vem de medida (D20): com o polígono de Aracaju o vizinho mais próximo ficava a 15,2px;
    // com o envelope das unidades e o teto de zoom atual, 62,1px. 40px é folga sobre o marcador de 13px.
    checar(9, 'vizinho mais próximo de Aracaju a >= 40px', minimoPar >= 40, `vizinho mais próximo ${minimoPar.toFixed(1)}px`);
    {
      const [cartao, placa, voltar] = await caixas(page, ['.map-card', '.map-titulo', '.map__voltar']);
      const ctrl = (await caixas(page, ['.maplibregl-ctrl-top-right']))[0];
      const fora = [];
      for (const m of mAracaju) {
        const c = { l: m.x - m.l / 2, r: m.x + m.l / 2, t: m.y - m.a / 2, b: m.y + m.a / 2 };
        const dentro = c.l >= cartao.l && c.r <= cartao.r && c.t >= cartao.t && c.b <= cartao.b;
        const sob = [placa, voltar, ctrl].some((x) => x && cruzam(c, x));
        if (!dentro || sob) fora.push(`${m.id} dentro=${dentro} sobOutroElemento=${sob}`);
      }
      checar(9, 'as unidades de Aracaju ficam todas dentro do cartão, fora da placa, do botão de volta e dos controles', mAracaju.length === aracaju.length && !fora.length, fora.join(' | ') || `${mAracaju.length}/${aracaju.length} visíveis`);
    }
    checar(9, 'cada marcador de Aracaju é o topo no seu centro e o clique físico abre a própria unidade', !falhasClique.length && aracaju.length > 0,
      falhasClique.length ? falhasClique.join(' | ') : `${aracaju.length}/${aracaju.length} ok`);

    // ------------------------------------------------------------------ 10. volta
    await page.click('.map__voltar');
    await pausa(page, ESPERA_CAMERA);
    const dVolta = await dist();
    const foco = await page.evaluate(() => ({ tag: document.activeElement?.tagName, classe: document.activeElement?.className }));
    checar(10, 'botão "Ver estado inteiro": distâncias voltam (±2px), botão some, foco no canvas',
      Math.abs(dVolta - d0) <= 2 && !(await voltarVisivel(page)) && foco.tag === 'CANVAS', `distância ${dVolta.toFixed(1)} vs inicial ${d0.toFixed(1)}; foco ${foco.tag}.${foco.classe}`);

    const outro = (await alvos(page)).find((a) => a.codigo !== IBGE_ARACAJU && / \d+ unidade/.test(a.rotulo) && !/nenhuma/.test(a.rotulo));
    if (!outro) {
      naoAplicavel(10, 'Escape com foco no canvas volta ao estado inteiro', 'nenhum outro município com unidade para aproximar');
    } else {
      await cliqueLogico(page, alvoSel(outro.codigo));
      await pausa(page, ESPERA_CAMERA);
      const dZ2 = await dist();
      await page.evaluate(() => document.querySelector('.maplibregl-canvas').focus());
      const focoCanvas = await page.evaluate(() => document.activeElement === document.querySelector('.maplibregl-canvas'));
      checar(10, 'canvas recebeu foco antes do Escape', focoCanvas);
      await page.keyboard.press('Escape');
      await pausa(page, ESPERA_CAMERA);
      const dEsc = await dist();
      checar(10, `Escape com foco no canvas desfaz o zoom em ${outro.rotulo.split(':')[0]}`,
        dZ2 > d0 + 5 && Math.abs(dEsc - d0) <= 2 && !(await voltarVisivel(page)), `inicial ${d0.toFixed(1)} · aproximado ${dZ2.toFixed(1)} · após Escape ${dEsc.toFixed(1)}`);
    }

    // ------------------------------------------------------------------ 11. município sem unidade
    const vazio = (await alvos(page)).find((a) => /nenhuma unidade cadastrada/.test(a.rotulo));
    if (!vazio) {
      naoAplicavel(11, 'município sem unidade aproxima e anuncia', 'nenhum .map__alvo com "nenhuma unidade cadastrada"');
    } else {
      await cliqueLogico(page, alvoSel(vazio.codigo));
      await pausa(page, ESPERA_CAMERA);
      const dV = await dist();
      const sr = (await page.locator('.map-sr').innerText()).trim();
      checar(11, `"${vazio.rotulo}" aproxima e a região viva anuncia`, dV > d0 + 5 && /nenhuma unidade cadastrada/.test(sr) && await voltarVisivel(page),
        `distância ${d0.toFixed(1)} -> ${dV.toFixed(1)}; .map-sr="${sr}"`);
      await voltarAoEstado(page);
    }

    // ------------------------------------------------------------------ 12. teclado
    // A placa não captura ponteiro (clicar nela cai no canvas); o ponto de partida do Tab é o próprio h1.
    await page.evaluate(() => { const h = document.querySelector('.map-titulo h1'); h.setAttribute('tabindex', '-1'); h.focus(); });
    let focoAlvo = null;
    for (let i = 0; i < 300 && !focoAlvo; i++) {
      await page.keyboard.press('Tab');
      focoAlvo = await page.evaluate(() => {
        const a = document.activeElement;
        return a && a.classList.contains('map__alvo') ? { codigo: a.getAttribute('data-codigo-ibge'), rotulo: a.getAttribute('aria-label') } : null;
      });
    }
    checar(12, 'Tab alcança um .map__alvo', !!focoAlvo, JSON.stringify(focoAlvo));
    if (focoAlvo) {
      const antesTab = await dist();
      await page.keyboard.press('Enter');
      await pausa(page, ESPERA_CAMERA);
      const depoisTab = await dist();
      const semPressed = (await alvos(page)).every((a) => !a.temPressed);
      checar(12, 'Enter no alvo aproxima o município', depoisTab > antesTab + 5 && await voltarVisivel(page), `${focoAlvo.rotulo}: ${antesTab.toFixed(1)} -> ${depoisTab.toFixed(1)}`);
      checar(12, '.map__alvo sem aria-pressed', semPressed);
      await voltarAoEstado(page);
    }

    // ------------------------------------------------------------------ viewports (1 e 2)
    const medirRolagem = () => page.evaluate(() => {
      const main = document.querySelector('main.shell__main');
      const doc = document.documentElement;
      const mp = document.querySelector('.map-page');
      const ml = document.querySelector('.map-layout');
      return {
        mainV: main.scrollHeight - main.clientHeight, docV: doc.scrollHeight - doc.clientHeight,
        docH: doc.scrollWidth - doc.clientWidth, mainH: main.scrollWidth - main.clientWidth,
        mapPageH: mp.scrollWidth - mp.clientWidth, layoutDireita: Math.round(ml.getBoundingClientRect().right), vw: doc.clientWidth,
      };
    });
    medidas.viewports = {};
    for (const [w, h] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720], [1024, 768]]) {
      await page.setViewportSize({ width: w, height: h });
      await esperarCameraParada(page);
      const r = await medirRolagem();
      medidas.viewports[`${w}x${h}`] = r;
      checar(1, `${w}x${h}: sem rolagem em main.shell__main (V e H) nem vertical no documento; .map-page sem estouro horizontal`,
        r.mainV === 0 && r.docV === 0 && r.mainH === 0 && r.mapPageH <= 0 && r.layoutDireita <= r.vw,
        `main V ${r.mainV} · doc V ${r.docV} · .map-page H ${r.mapPageH} · .map-layout direita ${r.layoutDireita}/${r.vw} · doc H ${r.docH} (registrado; ${r.docH > 0 ? 'pré-existente: topbar' : 'zero'}) · main H ${r.mainH}`);
      await page.screenshot({ path: path.join(OUT, `01-viewport-${w}x${h}.png`) });
      if (w === 1280) await verTitulo('1280x720');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await esperarCameraParada(page);
    const rm = await medirRolagem();
    medidas.viewports['390x844'] = rm;
    checar(1, '390x844: .map-page sem estouro horizontal (empilhado rola na vertical de propósito)', rm.mapPageH <= 0 && rm.layoutDireita <= rm.vw,
      `.map-page H ${rm.mapPageH} · .map-layout direita ${rm.layoutDireita}/${rm.vw} · doc H ${rm.docH} (registrado; ${rm.docH > 0 ? 'pré-existente: topbar' : 'zero'}) · rolagem vertical empilhada: main ${rm.mainV}, documento ${rm.docV}`);
    await page.screenshot({ path: path.join(OUT, '01-viewport-390x844.png'), fullPage: true });
    await page.setViewportSize({ width: 1600, height: 900 });

    // ------------------------------------------------------------------ 16. resize reenquadra (D20)
    {
      // Todo alvo (um por município) com o centro dentro do cartão: o estado inteiro cabe na moldura atual.
      const cabeTudo = async () => {
        const cartao = (await caixas(page, ['.map-card']))[0];
        const lista = await page.evaluate(() => [...document.querySelectorAll('.map__alvo')].map((a) => { const c = a.getBoundingClientRect(); return { x: c.x + c.width / 2, y: c.y + c.height / 2 }; }));
        const fora = lista.filter((a) => a.x < cartao.l || a.x > cartao.r || a.y < cartao.t || a.y > cartao.b).length;
        return { total: lista.length, fora };
      };
      // (a) montado em desktop, redimensionado SEM gesto: reenquadra sozinho.
      await page.setViewportSize({ width: 390, height: 844 });
      await esperarCameraParada(page);
      const ra = await cabeTudo();
      checar(16, '(a) 1600x900 -> 390x844 sem gesto: estado inteiro cabe e sem "Ver estado inteiro"', ra.total > 0 && ra.fora === 0 && !(await voltarVisivel(page)), `${ra.total - ra.fora}/${ra.total} alvos dentro do cartão`);
      // (b) montagem fresca em 390x844: sai do mapa e volta por clique.
      await irPara(page, '/dashboard');
      await page.waitForURL((u) => u.pathname.includes('/dashboard'), { timeout: 15000 });
      await abrirMapa(page);
      await esperarCameraParada(page);
      const rb = await cabeTudo();
      checar(16, '(b) montagem fresca em 390x844: estado inteiro cabe e sem "Ver estado inteiro"', rb.total > 0 && rb.fora === 0 && !(await voltarVisivel(page)), `${rb.total - rb.fora}/${rb.total} alvos dentro do cartão`);
      await page.screenshot({ path: path.join(OUT, '16-montagem-fresca-390x844.png'), fullPage: true });
      // (c) depois de aproximar um município, redimensionar respeita a câmera do operador.
      await page.setViewportSize({ width: 1600, height: 900 });
      await esperarCameraParada(page);
      const dEstado = await dist();
      await cliqueLogico(page, alvoSel(IBGE_ARACAJU));
      await esperarCameraParada(page);
      const dAprox = await dist();
      await page.setViewportSize({ width: 1500, height: 850 });
      await esperarCameraParada(page);
      const dRedim = await dist();
      const razao = dRedim / dAprox;
      checar(16, '(c) após zoom por município, redimensionar não reenquadra: botão continua e a escala se mantém (±10%)',
        dAprox > dEstado * 1.3 && await voltarVisivel(page) && razao >= 0.9 && razao <= 1.1,
        `estado ${dEstado.toFixed(1)} -> aproximado ${dAprox.toFixed(1)} -> redimensionado ${dRedim.toFixed(1)} (razão ${razao.toFixed(2)})`);
      await voltarAoEstado(page);
      await page.setViewportSize({ width: 1600, height: 900 });
    }

    // ------------------------------------------------------------------ 13. reduced-motion
    {
      const rp = await novaPagina(browser, 'reduced-motion', { reducedMotion: 'reduce' });
      try {
        await entrar(rp.page, SENHA);
        await abrirMapa(rp.page);
        const amostra = await rp.page.evaluate(async (ibge) => {
          const ler = () => [...document.querySelectorAll('.map__alvo')].slice(0, 6).map((a) => { const c = a.getBoundingClientRect(); return [c.x + c.width / 2, c.y + c.height / 2]; });
          const base = ler();
          document.querySelector(`.map__alvo[data-codigo-ibge="${ibge}"]`).click();
          await new Promise((r) => setTimeout(r, 50));
          const a50 = ler();
          await new Promise((r) => setTimeout(r, 850));
          const a900 = ler();
          const dm = a50.map((p, i) => Math.max(Math.abs(p[0] - a900[i][0]), Math.abs(p[1] - a900[i][1])));
          const mudou = base.map((p, i) => Math.max(Math.abs(p[0] - a900[i][0]), Math.abs(p[1] - a900[i][1])));
          return { maxDif: Math.max(...dm), maxMudanca: Math.max(...mudou) };
        }, IBGE_ARACAJU);
        medidas.reducedMotion = amostra;
        checar(13, 'reduced-motion: posições a 50ms = posições a 900ms (±2px) e o zoom de fato aconteceu',
          amostra.maxDif <= 2 && amostra.maxMudanca > 20, `diferença máx. 50ms×900ms ${amostra.maxDif.toFixed(1)}px; deslocamento total ${amostra.maxMudanca.toFixed(0)}px`);
      } finally { await rp.ctx.close(); }
    }

    // ------------------------------------------------------------------ 15. erro
    {
      const ep = await novaPagina(browser, 'erro', {}, true);
      try {
        await entrar(ep.page, SENHA);
        await ep.page.route(/\/dashboard\/unidades(\?|$)/, (r) => r.abort());
        await abrirMapa(ep.page, false);
        await ep.page.waitForSelector('.map-card > .map-feedback--error', { state: 'visible', timeout: 15000 });
        const [fb, placa] = await caixas(ep.page, ['.map-feedback--error', '.map-titulo']);
        const botaoTentar = await ep.page.locator('.map-feedback--error .botao').innerText();
        checar(15, 'falha do payload: .map-feedback--error visível, sem cruzar o título, com "Tentar novamente"',
          !cruzam(fb, placa) && /Tentar novamente/.test(botaoTentar), `feedback ${JSON.stringify(fb)} · título ${JSON.stringify(placa)} · botão "${botaoTentar}"`);
        await ep.page.screenshot({ path: path.join(OUT, 'e-erro.png') });
      } finally { await ep.ctx.close(); }
    }
  } catch (erro) {
    fatal = erro;
    try { await page.screenshot({ path: path.join(OUT, 'fatal.png') }); } catch (e) { errosPagina.push('screenshot fatal falhou: ' + e.message); }
  } finally {
    checar(0, 'nenhum erro de página nem de console', errosPagina.length === 0 && errosConsole.length === 0 && respostas5xx.length === 0,
      [...errosPagina, ...errosConsole, ...respostas5xx].join(' | ') + (errosConsoleEsperados.length ? ` (esperados no caso 15, não contados: ${errosConsoleEsperados.length})` : ''));
    const falhas = resultados.filter((r) => !r.ok);
    fs.writeFileSync(path.join(OUT, 'n08-tela-cheia-zoom.json'),
      JSON.stringify({ resultados, falhas: falhas.length, naoAplicaveis: resultados.filter((r) => r.na).length, medidas, errosConsoleEsperados, fatal: fatal ? fatal.message : null }, null, 2));
    for (const r of resultados) console.log(`${r.na ? 'N/A  ' : r.ok ? 'OK   ' : 'FALHA'} [${r.caso}] ${r.nome}${r.detalhe ? ` — ${r.detalhe}` : ''}`);
    console.log(`\n${resultados.filter((r) => r.ok && !r.na).length}/${resultados.filter((r) => !r.na).length} aprovados · ${resultados.filter((r) => r.na).length} não aplicáveis · ${falhas.length} falhas`);
    if (fatal) console.error(`\nFATAL: ${fatal.message}`);
    await browser.close();
    if (fatal || falhas.length) process.exitCode = 1;
  }
})();

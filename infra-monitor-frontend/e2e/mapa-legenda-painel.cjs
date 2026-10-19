/*
 * Mapa — legenda sobre o mapa (canto inferior esquerdo do cartão), painel de até 420px e folga de 12px.
 *
 *   LEGENDA_SENHA=<senha> node e2e/mapa-legenda-painel.cjs
 *
 * Variáveis:
 *   LEGENDA_SENHA  obrigatória; senha do usuário de login.
 *   E2E_EMAIL      default admin@inframonitor.local.
 *   API_PORT       porta do backend (default 8080). Se for outra, a API é redirecionada por rota do
 *                  Playwright (api-porta.cjs), porque o frontend tem apiUrl cravado em localhost:8080.
 *   E2E_OUT        pasta das evidências (default e2e/legenda-painel-evidence).
 *   E2E_UNIDADES   prefixos de nome de unidade, separados por vírgula. Vazio = escolhe sozinho a primeira
 *                  unidade com degradados+indisponíveis > 0 no payload de /dashboard/unidades, senão a
 *                  primeira com coordenada.
 *
 * Pré-requisitos: backend na porta indicada, `ng serve` em 4200 com a mudança visual aplicada.
 *
 * Regras herdadas dos roteiros anteriores:
 * 1. Sessão só existe em memória: depois do login, navegação SÓ por clique (page.goto cai em /login).
 * 2. Nada de catch silencioso em seletor: seletor que deixou de casar falha alto.
 * 3. Resultados gravados em `finally`, aconteça o que acontecer.
 *
 * Nenhuma contagem é cravada: tudo que depende de dados sai do payload de /dashboard/unidades.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { apontarApi } = require('./api-porta.cjs');

const BASE = 'http://127.0.0.1:4200';
const EMAIL = process.env.E2E_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.LEGENDA_SENHA;
if (!SENHA) throw new Error('LEGENDA_SENHA é obrigatória');
const PREFIXOS = (process.env.E2E_UNIDADES || '').split(',').map((s) => s.trim()).filter(Boolean);

const OUT = process.env.E2E_OUT ? path.resolve(process.env.E2E_OUT) : path.join(__dirname, 'legenda-painel-evidence');
fs.mkdirSync(OUT, { recursive: true });

const FUNDO_PIOR_CASO = [0x16, 0x28, 0x3a]; // polígono do mapa, atrás da placa
const NOTAS = ['Município é neutro: situa, não indica estado.', 'Arco liga unidade ao hub, na cor do status.'];

const resultados = [];
const medidas = {};
const checar = (caso, nome, ok, detalhe) => { resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' }); };
const naoAplicavel = (caso, nome, motivo) => { resultados.push({ caso, nome, ok: true, na: true, detalhe: 'NÃO APLICÁVEL: ' + motivo }); };
const pausa = (page, ms) => page.waitForTimeout(ms);
const perto = (a, b, tol) => Math.abs(a - b) <= tol;
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const errosPagina = [];
const errosConsole = [];
const respostas5xx = [];

/** Espera as posições dos alvos ficarem estáveis por 3 amostras seguidas (a câmera parou). */
const esperarCameraParada = async (page) => {
  await page.evaluate(() => { window.__lpIgual = 0; window.__lpUlt = null; });
  await page.waitForFunction(() => {
    const w = window;
    const ler = () => [...document.querySelectorAll('.map__alvo')].slice(0, 12).map((a) => { const c = a.getBoundingClientRect(); return Math.round(c.x) + ',' + Math.round(c.y); }).join(';');
    const agora = ler();
    if (w.__lpUlt === agora) w.__lpIgual = (w.__lpIgual || 0) + 1; else { w.__lpIgual = 0; w.__lpUlt = agora; }
    return w.__lpIgual >= 3;
  }, null, { polling: 100, timeout: 10000 });
};

async function entrar(page) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-senha', SENHA);
  await page.click('.login-submit');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
}

/** Em tela estreita a navegação vive numa gaveta: abre pelo botão do topo antes de clicar o link. */
async function irPara(page, href) {
  if (await page.locator('.menu-button').isVisible()) await page.click('.menu-button');
  await page.click(`.navigation__item[href="${href}"]`);
}

async function abrirMapa(page) {
  await irPara(page, '/mapa');
  await page.waitForSelector('.map__alvo', { timeout: 20000 });
  await page.waitForSelector('.map__unidade', { timeout: 20000 });
  await pausa(page, 1800);
}

const marcSel = (id) => `.map__unidade[data-unidade-id="${id}"]`;
const cliqueLogico = (page, seletor) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) throw new Error('seletor sem elemento: ' + s);
  e.click();
}, seletor);

/** Seleciona a unidade pelo marcador e espera o painel dela terminar de carregar os afetados. */
async function selecionarUnidade(page, u) {
  await cliqueLogico(page, marcSel(u.id));
  await page.waitForFunction((nome) => (document.querySelector('.unit-panel__nome')?.textContent ?? '').trim() === nome
    && !document.querySelector('.unit-panel__vazio[role=status]'), u.nome, { timeout: 15000 });
}

/** Caixas (viewport) dos seletores; seletor ausente vira null. */
const caixas = (page, seletores) => page.evaluate((sels) => sels.map((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const c = e.getBoundingClientRect();
  return { l: c.left, t: c.top, r: c.right, b: c.bottom, w: c.width, h: c.height };
}), seletores);
const intersecta = (a, b) => !!a && !!b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
const exigir = (caixa, nome) => { if (!caixa) throw new Error('seletor sem elemento: ' + nome); return caixa; };

const LEG = '.map-card > details.legend-bloco';
const aberta = (page) => page.locator(LEG).evaluate((e) => e.open);
async function definirLegenda(page, abrir) {
  if ((await aberta(page)) !== abrir) {
    await page.click('summary.legend-bloco__resumo');
    await page.waitForFunction(([sel, v]) => document.querySelector(sel).open === v, [LEG, abrir], { timeout: 5000 });
  }
  await pausa(page, 150);
}

/** Cor CSS qualquer -> [r,g,b,a] (a em 0..1), resolvida pelo próprio navegador. */
const resolverCor = (page, css) => page.evaluate((c) => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3] / 255];
}, css);
/** Compõe frente (rgba) sobre fundo (rgb). */
const compor = (frente, fundo) => [0, 1, 2].map((i) => frente[i] * frente[3] + fundo[i] * (1 - frente[3]));
const luminancia = (rgb) => {
  const [r, g, b] = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** Legenda aberta não toca o título nem o controle de zoom (assume legenda já aberta). */
async function legendaLivre(page) {
  const [leg, titulo, ctrl, card] = await caixas(page, [LEG, '.map-titulo', '.maplibregl-ctrl-top-right', '.map-card']);
  exigir(leg, LEG); exigir(titulo, '.map-titulo'); exigir(card, '.map-card');
  const dentro = leg.l >= card.l - 0.5 && leg.r <= card.r + 0.5 && leg.t >= card.t - 0.5 && leg.b <= card.b + 0.5;
  return { livre: !intersecta(leg, titulo) && !intersecta(leg, ctrl), dentro, ctrlAusente: !ctrl, leg, titulo };
}

const medirKpis = (page) => page.evaluate(() => {
  const kpis = document.querySelector('.unit-kpis');
  if (!kpis) return null;
  const colunas = new Set([...kpis.querySelectorAll(':scope > div')].map((d) => d.offsetLeft));
  const dts = [...kpis.querySelectorAll('dt')];
  return { colunas: colunas.size, dtEstourados: dts.filter((d) => d.scrollWidth > d.clientWidth).map((d) => d.textContent.trim()), dts: dts.length };
});

const medirViewport = (page) => page.evaluate(() => {
  const main = document.querySelector('main.shell__main');
  const doc = document.documentElement;
  const mp = document.querySelector('.map-page');
  const card = document.querySelector('.map-card').getBoundingClientRect();
  const panel = document.querySelector('.map-panel').getBoundingClientRect();
  return { painelL: panel.width, painelTop: panel.top, cardBottom: card.bottom, mainV: main.scrollHeight - main.clientHeight, docV: doc.scrollHeight - doc.clientHeight, mapPageH: mp.scrollWidth - mp.clientWidth, vw: doc.clientWidth };
});

(async () => {
  const browser = await chromium.launch({ headless: true });
  let fatal = null;
  let apiPorta = null;
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  apiPorta = await apontarApi(ctx);
  const page = await ctx.newPage();
  let payload = null;
  page.on('pageerror', (e) => errosPagina.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errosConsole.push(m.text()); });
  page.on('response', async (r) => {
    if (r.status() >= 500) respostas5xx.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`);
    if (!/\/dashboard\/unidades(\?|$)/.test(r.url()) || r.request().method() !== 'GET') return;
    try {
      const j = await r.json();
      payload = Array.isArray(j) ? j : (j.unidades ?? j.content ?? j.itens ?? j);
    } catch (e) { errosPagina.push(`payload ilegível: ${e.message}`); }
  });

  try {
    await entrar(page);
    await abrirMapa(page);
    if (!Array.isArray(payload) || !payload.length) throw new Error('payload de /dashboard/unidades vazio ou ilegível');
    const comCoord = payload.filter((u) => u.latitude != null && u.longitude != null);
    const afetadas = (u) => (u.equipamentosDegradados ?? 0) + (u.equipamentosIndisponiveis ?? 0) > 0;

    // unidades alvo do caso 4
    let alvos;
    if (PREFIXOS.length) {
      alvos = PREFIXOS.map((p) => {
        const u = comCoord.find((x) => x.nome.toLowerCase().startsWith(p.toLowerCase()));
        if (!u) throw new Error('E2E_UNIDADES: nenhuma unidade com coordenada começa com "' + p + '"');
        return { prefixo: p, u };
      });
    } else {
      const u = comCoord.find(afetadas) ?? comCoord[0];
      if (!u) throw new Error('payload sem unidade com coordenada');
      alvos = [{ prefixo: u.nome.split(/\s+/)[0], u }];
    }
    medidas.unidadesAlvo = alvos.map((a) => ({ id: a.u.id, nome: a.u.nome, degradados: a.u.equipamentosDegradados, indisponiveis: a.u.equipamentosIndisponiveis }));
    medidas.unidadesNoPayload = payload.length; medidas.unidadesComCoordenada = comCoord.length;

    // ------------------------------------------------------------------ 1. legenda no cartão, fechada
    {
      const dom = await page.evaluate(() => ({
        noCartao: !!document.querySelector('.map-card > details.legend-bloco'),
        noPainel: !!document.querySelector('.map-panel details.legend-bloco'),
        open: document.querySelector('details.legend-bloco')?.open,
        attrOpen: document.querySelector('details.legend-bloco')?.hasAttribute('open'),
      }));
      checar(1, 'legenda é filha direta de .map-card e não existe em .map-panel', dom.noCartao && !dom.noPainel, JSON.stringify(dom));
      checar(1, 'legenda fechada por padrão (sem atributo open)', dom.open === false && dom.attrOpen === false);
      const [leg, card, titulo, ctrl] = await caixas(page, [LEG, '.map-card', '.map-titulo', '.maplibregl-ctrl-top-right']);
      exigir(leg, LEG); exigir(card, '.map-card'); exigir(titulo, '.map-titulo');
      const dx = leg.l - card.l, dy = card.b - leg.b;
      medidas.legendaFechada = { insetEsquerdo: +dx.toFixed(1), insetInferior: +dy.toFixed(1), largura: +leg.w.toFixed(1), altura: +leg.h.toFixed(1) };
      checar(1, 'legenda no canto inferior esquerdo do cartão, a 12px das bordas (±2)', perto(dx, 12, 2) && perto(dy, 12, 2), `esquerda ${dx.toFixed(1)}px · inferior ${dy.toFixed(1)}px`);
      checar(1, 'legenda fechada não intersecta o título nem o controle de zoom', !intersecta(leg, titulo) && !intersecta(leg, ctrl), ctrl ? '' : '.maplibregl-ctrl-top-right ausente (só o título foi testado)');
      await page.screenshot({ path: path.join(OUT, '01-sem-selecao.png'), fullPage: true });
    }

    // ------------------------------------------------------------------ 2. legenda aberta sobre o mapa
    {
      await page.click('summary.legend-bloco__resumo');
      await page.waitForFunction((sel) => document.querySelector(sel).open === true, LEG, { timeout: 5000 });
      await pausa(page, 250);
      const info = await page.evaluate((sel) => {
        const leg = document.querySelector(sel);
        const itens = leg.querySelectorAll('.legend li').length;
        const notas = [...leg.querySelectorAll('.legend__nota')].map((n) => {
          const cs = getComputedStyle(n);
          const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
          return { texto: n.textContent.trim(), altura: n.getBoundingClientRect().height, lh };
        });
        const titulo = document.querySelector('.map-titulo');
        const cl = getComputedStyle(leg), ct = getComputedStyle(titulo);
        return {
          itens, notas, scrollW: leg.scrollWidth, clientW: leg.clientWidth,
          bgLeg: cl.backgroundColor, bgTit: ct.backgroundColor, bfLeg: cl.backdropFilter, bfTit: ct.backdropFilter,
          corItens: [...leg.querySelectorAll('.legend li')].map((x) => getComputedStyle(x).color),
        };
      }, LEG);
      checar(2, 'legenda aberta: 6 itens e 2 notas', info.itens === 6 && info.notas.length === 2, `${info.itens} li, ${info.notas.length} notas`);
      checar(2, 'textos exatos das duas notas', JSON.stringify(info.notas.map((n) => n.texto)) === JSON.stringify(NOTAS), JSON.stringify(info.notas.map((n) => n.texto)));
      checar(2, 'cada nota em uma linha (altura <= 1,5x line-height)', info.notas.every((n) => n.altura <= n.lh * 1.5),
        info.notas.map((n) => `${n.altura.toFixed(1)}px/lh ${n.lh.toFixed(1)}`).join(' | '));
      const livre = await legendaLivre(page);
      medidas.legendaAberta = { largura: +livre.leg.w.toFixed(1), altura: +livre.leg.h.toFixed(1), topo: +livre.leg.t.toFixed(1) };
      checar(2, 'legenda aberta não intersecta o título nem o controle de zoom e cabe no cartão', livre.livre && livre.dentro,
        `livre=${livre.livre} dentroDoCartao=${livre.dentro}${livre.ctrlAusente ? ' (controle de zoom ausente)' : ''}`);
      checar(2, 'legenda sem estouro horizontal (scrollWidth <= clientWidth)', info.scrollW <= info.clientW, `${info.scrollW}/${info.clientW}`);
      checar(2, 'mesma placa do título (backgroundColor e backdropFilter iguais)', info.bgLeg === info.bgTit && info.bfLeg === info.bfTit,
        `legenda ${info.bgLeg} · ${info.bfLeg} | título ${info.bgTit} · ${info.bfTit}`);
      const placa = compor(await resolverCor(page, info.bgLeg), FUNDO_PIOR_CASO);
      const cores = [];
      for (const c of info.corItens) cores.push(contraste(compor(await resolverCor(page, c), placa), placa));
      const minimo = Math.min(...cores);
      medidas.contrasteLegenda = { placaSobrePoligono: placa.map(Math.round), minimo: +minimo.toFixed(2) };
      checar(2, 'contraste do texto dos itens >= 4,5 sobre a placa composta em #16283a', cores.length > 0 && minimo >= 4.5, `mínimo ${minimo.toFixed(2)}:1 (${cores.map((c) => c.toFixed(1)).join(', ')})`);
      await page.screenshot({ path: path.join(OUT, '03-legenda-aberta.png'), fullPage: true });
      await page.locator('.map-card').screenshot({ path: path.join(OUT, '03b-legenda-aberta-cartao.png') });

      await page.focus('summary.legend-bloco__resumo');
      await page.keyboard.press('Enter');
      await pausa(page, 200);
      const fechouEnter = !(await aberta(page));
      await page.keyboard.press('Enter');
      await pausa(page, 200);
      const abriuEnter = await aberta(page);
      checar(2, 'teclado: Enter no summary fecha e abre de novo', fechouEnter && abriuEnter, `fechou=${fechouEnter} abriu=${abriuEnter}`);
      await definirLegenda(page, false);
      checar(2, 'legenda deixada fechada no fim do caso', !(await aberta(page)));
    }

    // ------------------------------------------------------------------ 3. folga do componente vs shell
    {
      const m = await page.evaluate(() => {
        const main = document.querySelector('main.shell__main');
        const mp = getComputedStyle(document.querySelector('.map-page'));
        const ml = getComputedStyle(document.querySelector('.map-layout'));
        const r = main.getBoundingClientRect();
        const direitaUtil = r.right - main.offsetWidth + main.clientWidth;
        const q = (s) => document.querySelector(s).getBoundingClientRect();
        const card = q('.map-card'), panel = q('.map-panel');
        return {
          mainPadding: getComputedStyle(main).padding,
          pad: [mp.paddingTop, mp.paddingRight, mp.paddingBottom, mp.paddingLeft], gap: ml.columnGap,
          esquerda: card.left - r.left, direita: direitaUtil - panel.right, entre: panel.left - card.right, baixo: innerHeight - card.bottom,
        };
      });
      medidas.folga = m;
      checar(3, 'shell__main sem padding (a folga é do componente)', m.mainPadding === '0px', `padding="${m.mainPadding}"`);
      checar(3, '.map-page com padding de 12px nos 4 lados', m.pad.every((p) => p === '12px'), m.pad.join(' '));
      checar(3, '.map-layout com column-gap de 12px', m.gap === '12px', m.gap);
      checar(3, 'cartão a 12px do início do main (±1)', perto(m.esquerda, 12, 1), `${m.esquerda.toFixed(1)}px`);
      checar(3, 'painel a 12px do fim útil do main, sem a barra de rolagem (±1)', perto(m.direita, 12, 1), `${m.direita.toFixed(1)}px`);
      checar(3, 'cartão e painel separados por 12px (±1)', perto(m.entre, 12, 1), `${m.entre.toFixed(1)}px`);
      checar(3, 'cartão a 12px da base da janela (±1)', perto(m.baixo, 12, 1), `${m.baixo.toFixed(1)}px`);
    }

    // ------------------------------------------------------------------ 4. unidade selecionada, painel de 420px
    for (const { prefixo, u } of alvos) {
      const tag = slug(prefixo);
      await selecionarUnidade(page, u);
      await pausa(page, 400);
      const painel = exigir((await caixas(page, ['.map-panel']))[0], '.map-panel');
      checar(4, `[${prefixo}] .map-panel com 420px de largura em 1600x900 (±1)`, perto(painel.w, 420, 1), `${painel.w.toFixed(1)}px`);
      const k = await medirKpis(page);
      checar(4, `[${prefixo}] KPIs em 2 colunas e rótulos (dt) sem estouro`, !!k && k.colunas === 2 && k.dtEstourados.length === 0,
        k ? `${k.colunas} colunas · ${k.dts} dt · estourados: ${k.dtEstourados.join(',') || '-'}` : '.unit-kpis ausente');
      const aviso = await page.evaluate(() => {
        const a = document.querySelector('.aviso-ibge');
        if (!a) return null;
        const cs = getComputedStyle(a);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        const c = a.getBoundingClientRect();
        return { altura: +c.height.toFixed(1), linhas: +(c.height / lh).toFixed(1), largura: +c.width.toFixed(1) };
      });
      if (aviso) { medidas[`avisoIbge_${tag}`] = aviso; checar(4, `[${prefixo}] .aviso-ibge registrado`, true, JSON.stringify(aviso)); }
      else naoAplicavel(4, `[${prefixo}] .aviso-ibge`, 'a unidade não tem divergência de IBGE');
      await page.screenshot({ path: path.join(OUT, `02-unidade-selecionada-${tag}.png`), fullPage: true });
      await page.locator('.map-panel').screenshot({ path: path.join(OUT, `02b-painel-${tag}.png`) });
      await definirLegenda(page, true);
      const livre = await legendaLivre(page);
      checar(4, `[${prefixo}] legenda aberta com unidade selecionada não intersecta título nem controle e cabe no cartão`, livre.livre && livre.dentro, `livre=${livre.livre} dentro=${livre.dentro}`);
      await page.screenshot({ path: path.join(OUT, `04-legenda-aberta-com-unidade-${tag}.png`), fullPage: true });
      await definirLegenda(page, false);
    }

    // ------------------------------------------------------------------ 5. viewports (com a unidade do caso 4 ainda selecionada)
    medidas.viewports = {};
    const lado = [[1920, 1080], [1600, 900], [1400, 900], [1366, 768], [1280, 720], [1133, 768], [1024, 768], [901, 768]];
    const empilhado = [[900, 768], [390, 844]];
    for (const [w, h] of lado) {
      await page.setViewportSize({ width: w, height: h });
      await esperarCameraParada(page);
      const r = await medirViewport(page);
      const esperado = Math.min(420, Math.max(340, 0.3 * w));
      await definirLegenda(page, true);
      const livre = await legendaLivre(page);
      await definirLegenda(page, false);
      medidas.viewports[`${w}x${h}`] = { ...r, esperado, livre: livre.livre };
      checar(5, `${w}x${h}: painel ${esperado.toFixed(0)}px (clamp 340/30vw/420, ±1,5)`, perto(r.painelL, esperado, 1.5), `${r.painelL.toFixed(1)}px`);
      checar(5, `${w}x${h}: sem rolagem vertical em main nem no documento; .map-page sem estouro horizontal`, r.mainV === 0 && r.docV === 0 && r.mapPageH <= 0, `main V ${r.mainV} · doc V ${r.docV} · .map-page H ${r.mapPageH}`);
      checar(5, `${w}x${h}: legenda aberta não intersecta o título nem o controle de zoom`, livre.livre && livre.dentro, `livre=${livre.livre} dentro=${livre.dentro}`);
      await page.screenshot({ path: path.join(OUT, `05-viewport-${w}x${h}.png`), fullPage: true });
      if (w === 1024) {
        if (!(await page.locator('.unit-panel').count())) await selecionarUnidade(page, alvos[0].u);
        const k = await medirKpis(page);
        checar(5, '1024x768 com unidade: KPIs em 2 colunas e dt sem estouro (piso de 340px)', !!k && k.colunas === 2 && k.dtEstourados.length === 0,
          k ? `${k.colunas} colunas · estourados: ${k.dtEstourados.join(',') || '-'}` : '.unit-kpis ausente');
      }
    }
    for (const [w, h] of empilhado) {
      await page.setViewportSize({ width: w, height: h });
      await esperarCameraParada(page);
      const r = await medirViewport(page);
      await definirLegenda(page, true);
      const livre = await legendaLivre(page);
      await page.screenshot({ path: path.join(OUT, `05-viewport-${w}x${h}.png`), fullPage: true });
      await definirLegenda(page, false);
      medidas.viewports[`${w}x${h}`] = { ...r, livre: livre.livre, dentro: livre.dentro };
      checar(5, `${w}x${h}: empilhado (painel abaixo do cartão)`, r.painelTop >= r.cardBottom - 0.5, `painel.top ${r.painelTop.toFixed(1)} · cartão.bottom ${r.cardBottom.toFixed(1)}`);
      checar(5, `${w}x${h}: .map-page sem estouro horizontal`, r.mapPageH <= 0, `${r.mapPageH}`);
      checar(5, `${w}x${h}: legenda aberta dentro do cartão e sem intersectar o título`, livre.livre && livre.dentro, `livre=${livre.livre} dentro=${livre.dentro}`);
    }
    await page.setViewportSize({ width: 1600, height: 900 });

    // ------------------------------------------------------------------ 6. gaveta: Mapa x Equipamentos
    {
      await irPara(page, '/dashboard');
      await page.waitForURL((u) => u.pathname.includes('/dashboard'), { timeout: 15000 });
      await abrirMapa(page);
      await esperarCameraParada(page);
      const candidatas = [...alvos.map((a) => a.u), ...comCoord.filter(afetadas)];
      const vistas = new Set();
      let usada = null;
      for (const u of candidatas) {
        if (vistas.has(u.id)) continue; vistas.add(u.id);
        if (!(await page.locator(marcSel(u.id)).count())) continue;
        await selecionarUnidade(page, u);
        if (await page.locator('.afetados__item').count()) { usada = u; break; }
      }
      if (!usada) {
        naoAplicavel(6, 'gaveta do equipamento no Mapa e em Equipamentos', 'sem equipamento afetado no banco');
      } else {
        const nome = (await page.locator('.afetados__nome').first().textContent()).trim();
        medidas.gaveta = { unidade: usada.nome, equipamento: nome };
        await page.locator('.afetados__item').first().click();
        await page.waitForSelector('.gaveta', { timeout: 15000 });
        await pausa(page, 1200);
        const tituloMapa = (await page.locator('.gaveta__nome h2').textContent()).trim();
        const bufMapa = await page.screenshot({ path: path.join(OUT, '06-gaveta-no-mapa.png'), fullPage: true });
        const gMapa = exigir((await caixas(page, ['.gaveta']))[0], '.gaveta');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.gaveta', { state: 'detached', timeout: 10000 });

        await irPara(page, '/equipamentos');
        // `Buscar` casa também a busca global da barra superior: o escopo é o container da lista.
        await page.waitForSelector('section.equipamentos #busca-equipamentos', { timeout: 15000 });
        const busca = page.locator('section.equipamentos #busca-equipamentos');
        try {
          await busca.fill(nome);
          const linha = page.locator('section.equipamentos tbody tr').filter({ has: page.getByText(nome, { exact: true }) }).first();
          await linha.waitFor({ state: 'visible', timeout: 15000 });
          // "Ver" vive no menu "…" da linha (app-action-menu), não num botão solto.
          await linha.locator('button.menu-acoes__gatilho').click();
          await page.locator('[role=menuitem]').filter({ hasText: /^Ver$/ }).click();
          await page.waitForSelector('.gaveta', { timeout: 15000 });
          await pausa(page, 1200);
          const tituloEq = (await page.locator('.gaveta__nome h2').textContent()).trim();
          const bufEq = await page.screenshot({ path: path.join(OUT, '07-gaveta-em-equipamentos.png'), fullPage: true });
          const gEq = exigir((await caixas(page, ['.gaveta']))[0], '.gaveta');
          medidas.gaveta.mapa = gMapa; medidas.gaveta.equipamentos = gEq;
          checar(6, 'a gaveta nas duas telas é a do mesmo equipamento', tituloMapa === nome && tituloEq === nome, `mapa="${tituloMapa}" equipamentos="${tituloEq}" esperado="${nome}"`);
          checar(6, 'gaveta com a mesma largura no Mapa e em Equipamentos (±1)', perto(gMapa.w, gEq.w, 1), `${gMapa.w.toFixed(1)} × ${gEq.w.toFixed(1)}`);
          checar(6, 'gaveta com o mesmo top e o mesmo right nas duas telas (±1)', perto(gMapa.t, gEq.t, 1) && perto(gMapa.r, gEq.r, 1),
            `top ${gMapa.t.toFixed(1)} × ${gEq.t.toFixed(1)} · right ${gMapa.r.toFixed(1)} × ${gEq.r.toFixed(1)}`);
          const comp = await browser.newPage({ viewport: { width: 3260, height: 960 } });
          try {
            const img = (b) => `data:image/png;base64,${b.toString('base64')}`;
            await comp.setContent(`<body style="margin:0;background:#0b1520;color:#fff;font:600 20px sans-serif"><div style="display:flex;gap:20px;padding:10px">`
              + `<figure style="margin:0"><figcaption style="padding:6px 0">Mapa</figcaption><img style="width:1600px" src="${img(bufMapa)}"></figure>`
              + `<figure style="margin:0"><figcaption style="padding:6px 0">Equipamentos</figcaption><img style="width:1600px" src="${img(bufEq)}"></figure></div></body>`);
            await comp.screenshot({ path: path.join(OUT, '08-gaveta-lado-a-lado.png'), fullPage: true });
          } finally { await comp.close(); }
          await page.keyboard.press('Escape');
          await page.waitForSelector('.gaveta', { state: 'detached', timeout: 10000 });
        } finally {
          // o filtro não deve vazar para outros roteiros
          if (await busca.count()) await busca.fill('');
        }
      }
    }
  } catch (erro) {
    fatal = erro;
    try { await page.screenshot({ path: path.join(OUT, 'fatal.png') }); } catch (e) { errosPagina.push('screenshot fatal falhou: ' + e.message); }
  } finally {
    checar(0, 'nenhum erro de página, de console nem resposta 5xx', errosPagina.length === 0 && errosConsole.length === 0 && respostas5xx.length === 0,
      [...errosPagina, ...errosConsole, ...respostas5xx].join(' | '));
    const falhas = resultados.filter((r) => !r.ok);
    fs.writeFileSync(path.join(OUT, 'mapa-legenda-painel.json'),
      JSON.stringify({ resultados, falhas: falhas.length, medidas, errosPagina, errosConsole, respostas5xx, apiPorta, fatal: fatal ? fatal.message : null }, null, 2));
    for (const r of resultados) console.log(`${r.na ? 'N/A  ' : r.ok ? 'OK   ' : 'FALHA'} [${r.caso}] ${r.nome}${r.detalhe ? ` — ${r.detalhe}` : ''}`);
    console.log(`\n${resultados.filter((r) => r.ok && !r.na).length}/${resultados.filter((r) => !r.na).length} ok · ${resultados.filter((r) => r.na).length} não aplicáveis · ${falhas.length} falhas`);
    if (fatal) console.error(`\nFATAL: ${fatal.message}`);
    await browser.close();
    if (fatal || falhas.length) process.exitCode = 1;
  }
})();

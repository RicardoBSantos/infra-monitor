/*
 * D23 — capturas comparativas do arco: paleta vibrante, halo da linha, três pings em orbe de 5px.
 *
 *   FRONT_URL=http://127.0.0.1:4201 API_PORT=8082 E2E_EMAIL=... CAP_SENHA=<senha> \
 *     CAP_ROTULO=depois-dev node e2e/d23-arco-capturas.cjs
 *
 * `CAP_ROTULO` = `<fase>-<banco>` (`antes-dev`, `depois-carga`…). A fase diz qual CSS está servindo
 * (`antes` = `ng serve` de origin/main, `depois` = este branch) e entra no nome de todo arquivo.
 * `CAP_SAIDA` muda a pasta (default `e2e/d23-evidence`): captura do banco da carga NUNCA entra no
 * repositório — vai para o scratchpad (memória `banco-carga-real-separado`).
 *
 * O que sai:
 * 1. `seis-status-<fase>.png` — os seis status lado a lado, sintéticos, a 4×: traço de linha da era
 *    (antes 1,4px a 0,65 sem halo; depois 1,6px a 0,85 sobre halo), os pings da era (2 em fases
 *    opostas; 3 a ⅓, o primeiro dentro do fade da ponta), o marcador e o marcador selecionado. As
 *    classes são as REAIS (`.map__ping`, `.map__unidade`) dentro de `.map-card`, para valer o
 *    `:host ::ng-deep` — então o CSS é o do servidor que respondeu, não uma cópia. Só a cor é posta
 *    por `--cor-*`, com a paleta da fase. Fundo escuro `#16283a` e claro `#f2f6fa`, as duas colunas.
 *    Só roda com banco `dev` (o sintético não depende do dado; repetir na carga seria ruído).
 * 2. `ping-7px-vs-5px.png` — só na fase `depois`: o ping de origin/main (CSS copiado inline, abaixo)
 *    ao lado do real, um status por linha, a 4×.
 * 3. `<rotulo>-{escuro,claro}-{estado,municipio}.png` — o mapa real como abre, e aproximado em
 *    Aracaju por clique no polígono (fora de marcador, mesma busca de pixel de canvas que n08), com
 *    o hub selecionado por clique nativo para mostrar o anel de seleção.
 * 4. `<rotulo>-reduced-motion-escuro.png` + checagem: nenhum ping, anel do pulso sem animação.
 *
 * Imprime e grava `<rotulo>-checagens.json`; sai com 1 se alguma checagem falhar.
 * Regras de sempre: sessão só em memória (navegação por clique), nada de catch silencioso em
 * seletor, resultado gravado em `finally`.
 */
const { chromium } = require('playwright');
const { apontarApi } = require('./api-porta.cjs');
const fs = require('fs'); const path = require('path');

const BASE = process.env.FRONT_URL || 'http://127.0.0.1:4201';
const EMAIL = process.env.E2E_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.CAP_SENHA || process.env.N07_SENHA;
if (!SENHA) throw new Error('CAP_SENHA é obrigatória');
const ROTULO = process.env.CAP_ROTULO || process.env.PERF_ROTULO || 'depois-dev';
const [FASE, BANCO] = ROTULO.split('-');
if (!['antes', 'depois'].includes(FASE) || !BANCO) throw new Error(`CAP_ROTULO inválido: ${ROTULO} (esperado antes-dev, depois-carga…)`);
const OUT = path.resolve(process.env.CAP_SAIDA || path.join(__dirname, 'd23-evidence'));
fs.mkdirSync(OUT, { recursive: true });

const IBGE_ARACAJU = '2800308';
const TEMA = { escuro: 'dark', claro: 'light' };   // valores aceitos por ThemeService

/** Paleta por fase — espelho de COR_DO_STATUS em origin/main e neste branch. */
const PALETA = {
  antes: { disponivel: '#34c77b', indisponivel: '#e5484d', degradada: '#e8a33d', 'em-manutencao': '#7fadff', 'sem-dados': '#8797a6', 'sem-equipamentos': '#667b8b' },
  depois: { disponivel: '#35e087', indisponivel: '#f84e54', degradada: '#fcb142', 'em-manutencao': '#7fadff', 'sem-dados': '#9dabb9', 'sem-equipamentos': '#6e8698' },
};
/** Linha e pings por fase: LARGURA/OPACIDADE_CONEXAO, halo (só D23) e PINGS_POR_LINHA. */
const ERA = {
  antes: { largura: 1.4, opacidade: 0.65, halo: false, pings: [{ u: 0.3, o: 1 }, { u: 0.7, o: 1 }] },
  // 3 a ⅓ com o primeiro em u=0,04: opacidadeNaPonta(0,04) = 0,5 — o fade aparece na captura.
  depois: { largura: 1.6, opacidade: 0.85, halo: true, pings: [{ u: 0.04, o: 0.5 }, { u: 0.37, o: 1 }, { u: 0.70, o: 1 }] },
};

/** `.map__ping` de origin/main (pré-D23), copiado literal para o lado a lado. */
const CSS_PING_ANTES = `
.d23-ping-antes { position:absolute; width:7px; height:7px; border:1px solid rgba(232,240,248,.8); border-radius:50%;
  background: radial-gradient(circle at 32% 28%, color-mix(in srgb, #fff 62%, var(--cor-ping, #8797a6)) 0%,
    var(--cor-ping, #8797a6) 52%, color-mix(in srgb, var(--cor-ping, #8797a6) 70%, #000) 100%);
  box-shadow: 0 0 5px 1px rgba(232,240,248,.3), inset -1.5px -1.5px 2.5px rgba(0,0,0,.38), 0 1px 2px rgba(0,0,0,.45); }`;

const checagens = [];
const checar = (nome, ok, detalhe) => checagens.push({ nome, resultado: ok ? 'ok' : 'falha', detalhe: detalhe ?? '' });

/*
 * `CAP_ORIGEM_API`: o backend dos clones só aceita a origem do `ng serve` do branch (CORS). O "antes"
 * roda num `ng serve` de outra porta, então a requisição refeita pelo Playwright se apresenta com a
 * origem aceita, e a resposta volta com `Access-Control-Allow-Origin` da página real. Sem isso o
 * login dá 403 de CORS e o roteiro estoura em `waitForURL`. Não muda nada no backend.
 */
async function apontarApiComOrigem(ctx, origemAceita) {
  const porta = process.env.API_PORT || '8080';
  const origemPagina = new URL(BASE).origin;
  await ctx.route('http://localhost:8080/**', async (route) => {
    const req = route.request();
    const url = req.url().replace('localhost:8080', `localhost:${porta}`);
    const resposta = await route.fetch({ url, headers: { ...req.headers(), origin: origemAceita } });
    await route.fulfill({ response: resposta, headers: { ...resposta.headers(), 'access-control-allow-origin': origemPagina } });
  });
}

async function entrar(browser, opcoes, tema) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ...opcoes });
  if (process.env.CAP_ORIGEM_API) await apontarApiComOrigem(ctx, process.env.CAP_ORIGEM_API);
  else await apontarApi(ctx);
  await ctx.addInitScript((t) => { try { localStorage.setItem('infra-monitor.tema', t); } catch { /* sem storage */ } }, TEMA[tema]);
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-senha', SENHA);
  await page.click('.login-submit');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
  const resposta = page.waitForResponse((r) => r.url().includes('/dashboard/unidades') && r.ok(), { timeout: 20000 });
  await page.click('a[href="/mapa"]');
  const unidades = await (await resposta).json();
  await page.waitForSelector('.map__unidade', { timeout: 20000 });
  await page.waitForTimeout(1600);
  const temaAplicado = await page.evaluate(() => document.documentElement.dataset.theme);
  checar(`tema ${tema} aplicado (${ROTULO})`, temaAplicado === TEMA[tema], `data-theme=${temaAplicado}`);
  return { ctx, page, unidades, erros };
}

async function fechar(ctx) {
  await ctx.unrouteAll({ behavior: 'ignoreErrors' });
  await ctx.close();
}

/** Linhas que a aplicação desenha — mesma fórmula do caso 7 de n07. */
const linhasDesenhaveis = (us) => us.filter((u) => u.conectaAUnidadeId != null && u.latitude != null && u.longitude != null && u.codigoIbge != null
  && us.some((p) => p.id === u.conectaAUnidadeId && p.latitude != null && p.longitude != null && p.codigoIbge != null)).length;

// ------------------------------------------------------------------------------- 1 e 2. sintético
async function sintetico(browser) {
  const { ctx, page } = await entrar(browser, { viewport: { width: 1100, height: 760 }, deviceScaleFactor: 4 }, 'escuro');
  try {
    const paleta = PALETA[FASE]; const era = ERA[FASE];
    await page.evaluate(({ paleta, era, css }) => {
      const estilo = document.createElement('style'); estilo.textContent = css; document.head.appendChild(estilo);
      const cartao = document.querySelector('.map-card');
      const painel = document.createElement('div');
      painel.id = 'd23-seis';
      // Coluna, não linha: o cartão a 1100px de viewport mede ~700px e as duas lado a lado não cabiam —
      // a primeira execução cortou a coluna clara e mostrou o mapa por trás.
      painel.style.cssText = 'position:absolute;left:0;top:0;z-index:1000;display:flex;flex-direction:column;width:max-content;font:600 10px "IBM Plex Mono",monospace;';
      for (const fundo of ['#16283a', '#f2f6fa']) {
        const col = document.createElement('div');
        col.style.cssText = `background:${fundo};padding:10px 14px;display:grid;gap:14px;color:${fundo === '#16283a' ? '#c9d6e3' : '#3a4b5c'};`;
        for (const [status, cor] of Object.entries(paleta)) {
          const linha = document.createElement('div');
          linha.style.cssText = 'display:flex;align-items:center;gap:10px;height:22px;';
          const rotulo = document.createElement('span'); rotulo.textContent = status; rotulo.style.width = '112px';
          const trilho = document.createElement('div'); trilho.style.cssText = 'position:relative;width:150px;height:22px;';
          if (era.halo) {
            const halo = document.createElement('div');
            halo.style.cssText = `position:absolute;left:0;right:0;top:8px;height:6px;border-radius:3px;background:${cor};opacity:.28;filter:blur(2px);`;
            trilho.appendChild(halo);
          }
          const traco = document.createElement('div');
          traco.style.cssText = `position:absolute;left:0;right:0;top:${11 - era.largura / 2}px;height:${era.largura}px;background:${cor};opacity:${era.opacidade};`;
          trilho.appendChild(traco);
          for (const { u, o } of era.pings) {
            const p = document.createElement('div'); p.className = 'map__ping';
            p.style.setProperty('--cor-ping', cor);
            p.style.position = 'absolute'; p.style.left = `${u * 150}px`; p.style.top = '11px'; p.style.translate = '-50% -50%'; p.style.opacity = String(o);
            trilho.appendChild(p);
          }
          const marcador = (pressionado) => {
            const b = document.createElement('button'); b.className = 'map__unidade'; b.type = 'button'; b.tabIndex = -1;
            b.setAttribute('aria-pressed', String(pressionado)); b.style.setProperty('--cor-unidade', cor);
            b.style.position = 'relative'; b.style.flex = 'none'; return b;
          };
          const slot = (el) => { const s = document.createElement('span'); s.style.cssText = 'display:grid;place-items:center;width:30px;height:22px;'; s.appendChild(el); return s; };
          linha.append(rotulo, trilho, slot(marcador(false)), slot(marcador(true)));
          col.appendChild(linha);
        }
        painel.appendChild(col);
      }
      cartao.appendChild(painel);

      // Lado a lado do ping: antes (CSS inline de origin/main) × depois (classe real), um status por linha.
      const lado = document.createElement('div');
      lado.id = 'd23-lado';
      lado.style.cssText = 'position:absolute;left:0;top:0;z-index:1000;background:#16283a;padding:10px 14px;display:grid;grid-template-columns:112px 70px 70px;gap:10px 8px;align-items:center;color:#c9d6e3;font:600 10px "IBM Plex Mono",monospace;';
      lado.innerHTML = '<span></span><span>antes 7px</span><span>depois 5px</span>';
      const antesPal = { disponivel: '#34c77b', indisponivel: '#e5484d', degradada: '#e8a33d', 'em-manutencao': '#7fadff', 'sem-dados': '#8797a6', 'sem-equipamentos': '#667b8b' };
      for (const [status, cor] of Object.entries(paleta)) {
        const r = document.createElement('span'); r.textContent = status; lado.appendChild(r);
        for (const [classe, c, larg, opac] of [['d23-ping-antes', antesPal[status], 1.4, 0.65], ['map__ping', cor, 1.6, 0.85]]) {
          const cel = document.createElement('div'); cel.style.cssText = 'position:relative;width:70px;height:18px;';
          if (classe === 'map__ping') {
            const h = document.createElement('div');
            h.style.cssText = `position:absolute;left:0;right:0;top:6px;height:6px;border-radius:3px;background:${c};opacity:.28;filter:blur(2px);`;
            cel.appendChild(h);
          }
          const t = document.createElement('div'); t.style.cssText = `position:absolute;left:0;right:0;top:${9 - larg / 2}px;height:${larg}px;background:${c};opacity:${opac};`;
          cel.appendChild(t);
          const p = document.createElement('div'); p.className = classe; p.style.setProperty('--cor-ping', c);
          p.style.position = 'absolute'; p.style.left = '35px'; p.style.top = '9px'; p.style.translate = '-50% -50%';
          cel.appendChild(p); lado.appendChild(cel);
        }
      }
      // Guardado, não anexado: entra só depois da captura dos seis (sobrepunha o painel — `hidden` perde
      // para o `display:grid` inline, e a primeira execução saiu com os dois misturados).
      window.__d23Lado = lado;
    }, { paleta, era, css: CSS_PING_ANTES });
    await page.waitForTimeout(300);
    // Prova de que o CSS real alcançou o sintético (senão o PNG mostraria div sem estilo).
    const medido = await page.evaluate(() => {
      const p = document.querySelector('#d23-seis .map__ping'); const m = document.querySelector('#d23-seis .map__unidade');
      const ep = getComputedStyle(p);
      return { ping: ep.width, borda: ep.borderTopWidth, sombra: ep.boxShadow, marcador: getComputedStyle(m).width };
    });
    const esperado = FASE === 'antes' ? { ping: '7px', borda: '1px' } : { ping: '5px', borda: '0px' };
    checar(`sintético usa o .map__ping real da fase ${FASE}`, medido.ping === esperado.ping && medido.borda === esperado.borda && medido.marcador === '13px', JSON.stringify(medido));
    await page.locator('#d23-seis').screenshot({ path: path.join(OUT, `seis-status-${FASE}.png`) });
    if (FASE === 'depois') {
      await page.evaluate(() => { document.querySelector('#d23-seis').remove(); document.querySelector('.map-card').appendChild(window.__d23Lado); });
      await page.waitForTimeout(150);
      await page.locator('#d23-lado').screenshot({ path: path.join(OUT, 'ping-7px-vs-5px.png') });
    }
  } finally { await fechar(ctx); }
}

// ------------------------------------------------------------------------------- 3. mapa real
async function mapaReal(browser, tema) {
  const { ctx, page, unidades, erros } = await entrar(browser, {}, tema);
  try {
    const porLinha = FASE === 'antes' ? 2 : 3;
    const linhas = linhasDesenhaveis(unidades);
    const contagem = await page.evaluate(() => ({ pings: document.querySelectorAll('.map__ping').length, marcadores: document.querySelectorAll('.map__unidade').length }));
    checar(`${tema}: ${porLinha} pings por linha desenhável`, contagem.pings === linhas * porLinha, `${contagem.pings} pings, ${linhas} linhas, ${contagem.marcadores} marcadores`);
    await page.locator('.map-card').screenshot({ path: path.join(OUT, `${ROTULO}-${tema}-estado.png`) });

    // Município: clique em pixel de canvas perto do centroide de Aracaju (fora de marcador).
    const c = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) throw new Error('sem alvo ' + s); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; },
      `.map__alvo[data-codigo-ibge="${IBGE_ARACAJU}"]`);
    let aproximou = false; let tentativas = 0;
    for (const r of [20, 28, 38, 50, 64]) {
      for (let k = 0; k < 16 && !aproximou; k++) {
        const ang = (k * Math.PI * 2) / 16; const p = { x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) };
        if (!(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', p))) continue;
        tentativas++;
        await page.mouse.click(p.x, p.y);
        await page.waitForTimeout(900);
        aproximou = (await page.locator('.map__voltar').count()) > 0 && await page.locator('.map__voltar').isVisible();
      }
      if (aproximou) break;
    }
    checar(`${tema}: zoom no município de Aracaju`, aproximou, `${tentativas} clique(s)`);
    // Hub selecionado (raiz com filhos) por clique nativo — o do Playwright não seleciona (n07, 9c-a).
    const hub = unidades.find((u) => u.conectaAUnidadeId == null && unidades.some((f) => f.conectaAUnidadeId === u.id));
    if (hub) {
      await page.evaluate((id) => document.querySelector(`.map__unidade[data-unidade-id="${id}"]`)?.click(), String(hub.id));
      await page.waitForTimeout(400);
    }
    const pressionado = await page.locator('.map__unidade[aria-pressed="true"]').count();
    checar(`${tema}: hub selecionado no zoom`, !!hub && pressionado === 1, hub ? `hub ${hub.nome}` : 'sem hub no dado');
    await page.locator('.map-card').screenshot({ path: path.join(OUT, `${ROTULO}-${tema}-municipio.png`) });
    checar(`${tema}: nenhum erro de página`, erros.length === 0, erros.join(' | '));
  } finally { await fechar(ctx); }
}

// ------------------------------------------------------------------------------- 4. reduced-motion
async function movimentoReduzido(browser) {
  const { ctx, page } = await entrar(browser, { reducedMotion: 'reduce' }, 'escuro');
  try {
    const r = await page.evaluate(() => ({
      pings: document.querySelectorAll('.map__ping').length,
      aneis: [...document.querySelectorAll('.map__unidade--pulsa')].map((n) => getComputedStyle(n, '::after').animationName),
    }));
    checar('reduced-motion: nenhum ping criado', r.pings === 0, `${r.pings} ping(s)`);
    checar('reduced-motion: ::after com animation-name none', r.aneis.length > 0 && r.aneis.every((a) => a === 'none'), `${r.aneis.length} anel(éis): ${[...new Set(r.aneis)].join('/')}`);
    await page.locator('.map-card').screenshot({ path: path.join(OUT, `${ROTULO}-reduced-motion-escuro.png`) });
  } finally { await fechar(ctx); }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let fatal = null;
  try {
    if (BANCO === 'dev') await sintetico(browser);
    for (const tema of ['escuro', 'claro']) await mapaReal(browser, tema);
    await movimentoReduzido(browser);
  } catch (erro) {
    fatal = erro;
  } finally {
    fs.writeFileSync(path.join(OUT, `${ROTULO}-checagens.json`), JSON.stringify({ rotulo: ROTULO, base: BASE, checagens, fatal: fatal ? String(fatal) : null }, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify({ rotulo: ROTULO, checagens, fatal: fatal ? String(fatal) : null }, null, 2));
  const falhas = checagens.filter((c) => c.resultado !== 'ok').length;
  if (fatal || falhas) process.exit(1);
})();

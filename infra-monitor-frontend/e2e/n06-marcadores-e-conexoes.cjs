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
 * - enquadramento do estado em pixel, nos dois eixos, em 9 viewports (D22).
 *
 * A camada `conexoes-linha` NÃO é verificada aqui: ela vive no WebGL do MapLibre e não é
 * inspecionável pelo DOM. Cobertura real é o teste unitário de `camadasDeConexao`
 * (mapa.component.spec.ts) mais as capturas deste próprio roteiro.
 */
const { chromium } = require('playwright');
const { apontarApi } = require('./api-porta.cjs');
const fs = require('fs'); const path = require('path');

const BASE = 'http://127.0.0.1:4200';
const API = `http://localhost:${process.env.API_PORT || 8080}/api/v1`;
const EMAIL = process.env.E2E_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.N06_SENHA;
if (!SENHA) throw new Error('N06_SENHA é obrigatória');

const OUT = path.join(__dirname, 'n06-evidence');
fs.mkdirSync(OUT, { recursive: true });

const resultados = [];
const medidas = {};
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

/** Foca o último controle focável ANTES do cartão do mapa (o "Atualizar" foi para o painel, D20). */
const focarAntesDoMapa = (page) => page.evaluate(() => {
  const cartao = document.querySelector('.map-card');
  const focaveis = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
    .filter((e) => e.tabIndex >= 0 && !e.disabled && e.getClientRects().length > 0)
    .filter((e) => cartao.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING);
  if (!focaveis.length) throw new Error('nenhum focável antes do mapa');
  focaveis[focaveis.length - 1].focus();
});

const focado = (page) => page.evaluate(() => {
  const alvo = document.activeElement;
  return alvo ? { tag: alvo.tagName, rotulo: alvo.getAttribute('aria-label'), unidade: alvo.getAttribute('data-unidade-id'), deUnidade: alvo.classList.contains('map__unidade') } : null;
});

/**
 * Enquadramento do estado, medido em PIXEL sobre screenshot do cartão.
 *
 * A medida anterior usava a posição dos `.map__alvo` (centróides) só no eixo vertical. A mutação de
 * D22 provou que ela era cega a corte e a deslocamento lateral: um corte real passou em 1500x950, e o
 * limite antigo apenas acompanhava a implementação. Aqui compara-se o cartão COM e SEM o canvas do
 * MapLibre; título, legenda, controles e marcadores (DOM) são idênticos nas duas e se cancelam, e o
 * que sobra de diferente é o desenho do mapa. Independe do tema porque só olha a diferença.
 */
const LIMIAR_PIXEL = 24;
const medirEnquadramento = async (page) => {
  const cartao = page.locator('.map-card');
  const com = await cartao.screenshot();
  await page.evaluate(() => { document.querySelector('.maplibregl-canvas').style.visibility = 'hidden'; });
  let sem;
  try { sem = await cartao.screenshot(); }
  finally { await page.evaluate(() => { document.querySelector('.maplibregl-canvas').style.visibility = ''; }); }
  const medida = await page.evaluate(async ({ a, b, limiar }) => {
    const ler = (b64) => new Promise((ok, erro) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        ok(g.getImageData(0, 0, img.width, img.height));
      };
      img.onerror = () => erro(new Error('PNG não decodificou'));
      img.src = 'data:image/png;base64,' + b64;
    });
    const [A, B] = await Promise.all([ler(a), ler(b)]);
    const { width: w, height: h } = A;
    let minX = w, maxX = -1, minY = h, maxY = -1, n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      const d = Math.max(Math.abs(A.data[k] - B.data[k]), Math.abs(A.data[k + 1] - B.data[k + 1]), Math.abs(A.data[k + 2] - B.data[k + 2]));
      if (d > limiar) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (!n) return { w, h, n };
    return { w, h, n, esq: minX, dir: w - 1 - maxX, topo: minY, base: h - 1 - maxY };
  }, { a: com.toString('base64'), b: sem.toString('base64'), limiar: LIMIAR_PIXEL });
  if (!medida.n) return { ...medida, com };
  const { w, h, esq, dir, topo, base } = medida;
  return {
    ...medida, com,
    pEsq: esq / w, pDir: dir / w, pTopo: topo / h, pBase: base / h,
    sobraV: (topo + base) / h, sobraH: (esq + dir) / w,
  };
};

/** Câmera parada: os alvos de município param de mudar de posição entre leituras sucessivas. */
const esperarCameraParada = async (page) => {
  const ler = () => page.evaluate(() => [...document.querySelectorAll('.map__alvo')]
    .map((n) => { const c = n.getBoundingClientRect(); return Math.round(c.x) + ',' + Math.round(c.y); }).join('|'));
  let anterior = null, iguais = 0;
  for (let i = 0; i < 60 && iguais < 3; i++) {
    await page.waitForTimeout(300);
    const atual = await ler();
    iguais = atual && atual === anterior ? iguais + 1 : 0;
    anterior = atual;
  }
  if (iguais < 3) throw new Error('câmera não parou');
};

const VIEWPORTS_ENQUADRAMENTO = [
  [1500, 950], [1525, 950], [1440, 864], [1366, 768], [1300, 950], [1280, 720], [1024, 768], [1600, 900], [1920, 1080],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  let fatal = null;
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
  await apontarApi(ctx);
  const page = await ctx.newPage();
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

    // As quatro de Aracaju: o polígono único do município não consegue distingui-las.
    const aracaju = unidades.filter((u) => ['1', '2', '3', '7'].includes(u.id));
    const xs = aracaju.map((u) => u.x), ys = aracaju.map((u) => u.y);
    const espalhamento = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    checar(1, 'as 4 unidades de Aracaju aparecem separadas', aracaju.length === 4 && espalhamento > 10,
      `${aracaju.length} em Aracaju, espalhamento ${espalhamento}px`);

    checar(1, 'rótulo traz nome e status por extenso',
      unidades.every((u) => /: (Disponível|Indisponível|Degradada|Em manutenção|Sem dados|Sem equipamentos), \d+ equipamento/.test(u.rotulo)),
      unidades[0].rotulo);

    // ---------------------------------------------------- 2. teclado nos marcadores
    await page.keyboard.press('Escape');
    // O cabeçalho da página saiu (D20); o Tab parte do último focável antes do cartão.
    await focarAntesDoMapa(page);
    let achou = null;
    for (let i = 0; i < 80 && !achou; i += 1) {
      await page.keyboard.press('Tab');
      const atual = await focado(page);
      if (atual && atual.deUnidade) achou = atual;
    }
    checar(2, 'marcador de unidade é alcançável por Tab', !!achou, JSON.stringify(achou));

    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
    const painel = await page.locator('.unit-panel__nome').textContent();
    checar(2, 'Enter no marcador abre o painel da unidade', !!painel && achou.rotulo.startsWith(painel),
      `painel: ${painel} | marcador: ${achou.rotulo}`);

    const aposEnter = await lerUnidades(page);
    const pressionados = aposEnter.filter((u) => u.pressionado);
    checar(2, 'exatamente um marcador fica aria-pressed', pressionados.length === 1 && pressionados[0].id === achou.unidade,
      JSON.stringify(pressionados.map((u) => u.id)));

    // Espaço também: <button> real entrega os dois, e é isso que se está afirmando.
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    checar(2, 'Espaço ativa o mesmo marcador', (await lerUnidades(page)).filter((u) => u.pressionado).length === 1);

    await page.screenshot({ path: path.join(OUT, '03-marcador-por-teclado.png') });

    // ------------------------------- 3. preservação dos nós em pan/zoom/pitch (N02/N05)
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
    checar(3, 'nenhum marcador é recriado em pan/zoom', mesmosNos, `${antes.length} nós antes, ${depoisPan.length} depois`);
    checar(3, 'marcadores acompanham a câmera', moveu, 'posições mudaram sem troca de nó');
    checar(3, 'seleção sobrevive ao pan/zoom', depoisPan.filter((u) => u.pressionado).length === 1);

    // ------------------------------------------- 4. layout: rolagem e faixa morta
    const rolagem = await page.evaluate(() => {
      const principal = document.querySelector('.shell__main');
      return {
        principal: principal.scrollHeight - principal.clientHeight,
        documento: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        alturaCartao: Math.round(document.querySelector('.map-card').getBoundingClientRect().height),
        larguraPainel: Math.round(document.querySelector('.map-panel').getBoundingClientRect().width),
      };
    });
    checar(4, 'área principal do shell não rola', rolagem.principal <= 1, `excedente ${rolagem.principal}px`);
    checar(4, 'documento não rola', rolagem.documento <= 1, `excedente ${rolagem.documento}px`);
    checar(4, 'painel lateral com 420px (D21)', rolagem.larguraPainel >= 419 && rolagem.larguraPainel <= 421, `${rolagem.larguraPainel}px`);

    /*
     * Remontagem de verdade antes de medir enquadramento. Clicar em /mapa estando em /mapa é no-op
     * no router: o componente não remonta e a câmera fica como o pan/zoom do caso 4 a deixou — o
     * que estava sendo medido era a câmera arrastada pelo teste, não a calibração. Sair para outra
     * rota e voltar destrói e recria o mapa, que é o estado que o operador vê ao abrir a tela.
     */
    await page.click('a[href="/dashboard"]');
    await page.waitForTimeout(600);
    await page.click('a[href="/mapa"]');
    await page.waitForSelector('.map__alvo', { timeout: 20000 });
    await page.waitForTimeout(1800);
    await esperarCameraParada(page);
    // Legenda fechada e nenhuma unidade selecionada: a remontagem acima garante os dois.
    const enquadramento = [];
    for (const [largura, altura] of VIEWPORTS_ENQUADRAMENTO) {
      const rotulo = `${largura}x${altura}`;
      await page.setViewportSize({ width: largura, height: altura });
      await esperarCameraParada(page);
      const m = await medirEnquadramento(page);
      if (largura === 1500 && altura === 950) fs.writeFileSync(path.join(OUT, '04-enquadramento-1500x950.png'), m.com);
      if (!m.n) {
        checar(4, `${rotulo}: desenho do mapa detectado no cartão`, false, 'nenhum pixel diferente entre com e sem canvas');
        enquadramento.push({ viewport: rotulo, erro: 'sem pixels' });
        continue;
      }
      const pct = (v) => (v * 100).toFixed(1);
      const margens = `esq ${m.esq}px (${pct(m.pEsq)}%) · dir ${m.dir}px (${pct(m.pDir)}%) · topo ${m.topo}px (${pct(m.pTopo)}%) · base ${m.base}px (${pct(m.pBase)}%)`;
      const sobra = Math.min(m.sobraV, m.sobraH);
      const desV = Math.abs(m.pTopo - m.pBase), desH = Math.abs(m.pEsq - m.pDir);
      checar(4, `${rotulo}: sem corte (margem >= 8px nos quatro lados)`, Math.min(m.esq, m.dir, m.topo, m.base) >= 8, margens);
      checar(4, `${rotulo}: sobra do eixo limitante <= 25%`, sobra <= 0.25,
        `sobraV ${pct(m.sobraV)}% · sobraH ${pct(m.sobraH)}% · limitante ${pct(sobra)}%`);
      checar(4, `${rotulo}: equilíbrio topo/base e esq/dir <= 6 p.p.`, desV <= 0.06 && desH <= 0.06,
        `topo-base ${pct(desV)} p.p. · esq-dir ${pct(desH)} p.p.`);
      enquadramento.push({ viewport: rotulo, cartao: `${m.w}x${m.h}`, esq: m.esq, dir: m.dir, topo: m.topo, base: m.base,
        pEsq: +pct(m.pEsq), pDir: +pct(m.pDir), pTopo: +pct(m.pTopo), pBase: +pct(m.pBase),
        sobraV: +pct(m.sobraV), sobraH: +pct(m.sobraH), desequilibrioV: +pct(desV), desequilibrioH: +pct(desH) });
    }
    medidas.enquadramento = enquadramento;
    // Volta ao viewport original para os casos seguintes.
    await page.setViewportSize({ width: 1500, height: 950 });
    await esperarCameraParada(page);

    // O painel não pode ter buraco: sem município selecionado o conteúdo é curto e a sobra vai para
    // as costuras entre blocos, distribuída. 307px numa costura só foi o que motivou a mudança.
    const maiorCostura = await page.evaluate(() => {
      const painel = document.querySelector('.map-panel').getBoundingClientRect();
      const blocos = [...document.querySelectorAll('.map-panel > *')].map((n) => n.getBoundingClientRect());
      let maior = 0;
      for (let i = 1; i < blocos.length; i++) maior = Math.max(maior, blocos[i].top - blocos[i - 1].bottom);
      return { maior: Math.round(maior), altura: Math.round(painel.height) };
    });
    checar(5, 'nenhuma costura vazia dominante no painel', maiorCostura.maior <= 160,
      `maior costura ${maiorCostura.maior}px em ${maiorCostura.altura}px de painel`);

    // ----------------------- 5. legenda depois da extrusão (N06) e da cor de município (N07)
    /*
     * A legenda de N06 era: 4 status visíveis, 3 notas atrás de um botão de informação, 4 estados
     * sem leitura atrás de um disclosure. Com a extrusão fora, duas notas descreviam geometria
     * inexistente e saíram, e o botão de informação foi removido com elas.
     *
     * N07 tirou a cor de status do polígono. Isso esvaziou o disclosure de razão: dois dos seus
     * quatro itens eram vocabulário só de polígono ("Município sem unidade", "Múltiplas unidades")
     * e morreram com a coloração; os outros dois são UnitOperationalStatus como os demais. Uma
     * lista de 6, sem disclosure, e uma segunda nota dizendo que o município não tem status.
     */
    /*
     * D20: a legenda nasce RECOLHIDA (details.legend-bloco sem `open`) para devolver altura ao
     * mapa; o conteúdo continua o mesmo, só atrás de um clique no summary.
     */
    checar(5, 'legenda nasce recolhida', (await page.locator('details.legend-bloco').count()) === 1
      && (await page.locator('details.legend-bloco').evaluate((d) => !d.open)));
    await page.click('summary.legend-bloco__resumo');
    await page.waitForFunction(() => document.querySelector('details.legend-bloco')?.open === true, null, { timeout: 5000 });
    checar(5, 'legenda abre ao clicar no summary (details.open)',
      await page.evaluate(() => document.querySelector('details.legend-bloco').open));
    const legendaVisivel = await page.locator('details.legend-bloco .legend li').count();
    checar(5, 'os 6 status de unidade numa lista só', legendaVisivel === 6, `${legendaVisivel} item(ns)`);
    checar(5, 'legenda anuncia que fala do marcador, não do polígono',
      (await page.locator('details.legend-bloco .legend__intro').innerText()).toLowerCase().includes('marcador'));
    checar(5, 'duas notas de gramática do mapa: município neutro e linha de hub',
      (await page.locator('details.legend-bloco .legend__nota').count()) === 2);
    checar(5, 'botão de informação removido', (await page.locator('.legend-info').count()) === 0);
    checar(5, 'disclosure "Estados sem leitura" desfeito', (await page.locator('.legend-extra').count()) === 0);
    await page.screenshot({ path: path.join(OUT, '05-legenda.png') });

    // ------------------------------------------------------------- 6. capturas
    await page.screenshot({ path: path.join(OUT, '01-tela-inteira.png') });
    await page.locator('.map-card').screenshot({ path: path.join(OUT, '02-mapa-marcadores-e-linhas.png') });
    await page.locator('.map-panel').screenshot({ path: path.join(OUT, '04-painel-420px.png') });
    await page.screenshot({ path: path.join(OUT, 'final.png') });
  } catch (erro) {
    fatal = erro;
  } finally {
    checar(0, 'nenhum erro de página', erros.length === 0, erros.join(' | '));
    const falhas = resultados.filter((r) => !r.ok);
    fs.writeFileSync(path.join(OUT, 'n06-marcadores-e-conexoes.json'),
      JSON.stringify({ medidas, resultados, falhas: falhas.length, fatal: fatal ? fatal.message : null }, null, 2));
    for (const r of resultados) console.log(`${r.ok ? 'OK  ' : 'FALHA'} [${r.caso}] ${r.nome}${r.detalhe ? ` — ${r.detalhe}` : ''}`);
    console.log(`\n${resultados.length - falhas.length}/${resultados.length}`);
    if (fatal) console.error(`\nFATAL: ${fatal.message}`);
    await browser.close();
    if (fatal || falhas.length) process.exitCode = 1;
  }
})();

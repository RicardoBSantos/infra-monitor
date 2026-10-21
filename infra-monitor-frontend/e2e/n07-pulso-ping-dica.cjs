/*
 * N07 — município neutro, pulso GERAL (D19), ping colorido e dica de relance.
 *
 *   N07_SENHA=<senha> node e2e/n07-pulso-ping-dica.cjs
 *
 * Pré-requisitos: backend em 8080, `ng serve` em 4200, PostgreSQL de dev com o seed aplicado
 * (db/dev-seed/01-unidades-coordenadas.sql + e2e/seed-topologia-unidades.cjs).
 *
 * Mesmas três regras dos roteiros anteriores:
 * 1. Sessão só em memória — qualquer page.goto depois do login cai em /login. Navegação por clique.
 * 2. Nada de catch silencioso em seletor: seletor que deixou de casar falha alto.
 * 3. Resultados gravados em `finally`, aconteça o que acontecer.
 *
 * O que este roteiro prova, e que captura de tela sozinha não provaria:
 * - o pulso é GERAL (todos os marcadores, qualquer status) — D19 reverteu o filtro de N07;
 * - o pulso vive no ::after, nunca no elemento — é a regra que DV13 deixou;
 * - o marcador não tem mais aro claro: o contraste sai do miolo (D19);
 * - o anel de seleção sai de --cor-unidade e o selecionado cresce, nos seis status;
 * - os pings são invisíveis para teclado e leitor de tela (requisito de aceite, não detalhe);
 * - a dica aparece no FOCO e não só no hover, e focar não seleciona;
 * - a conexão é inteiramente da cor do status da unidade conectada (D18);
 * - três pings por linha, a ⅓ um do outro em fluxo hub → unidade, orbe de 5px sem contorno branco,
 *   com fade de opacidade nas pontas (D23 — substituiu o par em fases opostas de D16).
 */
const { chromium } = require('playwright');
const { apontarApi } = require('./api-porta.cjs');
const fs = require('fs'); const path = require('path');

const BASE = process.env.FRONT_URL || 'http://127.0.0.1:4200';
const EMAIL = process.env.E2E_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.N07_SENHA;
if (!SENHA) throw new Error('N07_SENHA é obrigatória');

const OUT = path.join(__dirname, 'n07-evidence');
fs.mkdirSync(OUT, { recursive: true });

const resultados = [];
const checar = (caso, nome, ok, detalhe) => { resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' }); };

/** Cores do canvas, espelhadas do componente. Divergir daqui é o teste falhar, que é o certo. */
const COR = {
  disponivel: '#35e087', indisponivel: '#f84e54', degradada: '#fcb142',
  'em-manutencao': '#7fadff', 'sem-dados': '#9dabb9', 'sem-equipamentos': '#6e8698',
};

const lerUnidades = (page) => page.evaluate(() => [...document.querySelectorAll('.map__unidade')].map((botao) => {
  const depois = getComputedStyle(botao, '::after');
  return {
    id: botao.getAttribute('data-unidade-id'),
    rotulo: botao.getAttribute('aria-label'),
    status: (botao.getAttribute('aria-label').match(/: ([^,]+),/) || [])[1],
    cor: botao.style.getPropertyValue('--cor-unidade'),
    pulsa: botao.classList.contains('map__unidade--pulsa'),
    animacaoNoAfter: depois.animationName,
    animacaoNoElemento: getComputedStyle(botao).animationName,
    transformNoElemento: getComputedStyle(botao).transform,
    temDica: !!botao.querySelector('.map__dica'),
    dicaOculta: botao.querySelector('.map__dica')?.getAttribute('aria-hidden'),
  };
}));

/** Id do marcador mais distante de qualquer vizinho. Evita o aglomerado de Aracaju (DV09). */
const marcadorIsolado = (page) => page.evaluate(() => {
  const nos = [...document.querySelectorAll('.map__unidade')].map((n) => {
    const c = n.getBoundingClientRect();
    return { id: n.getAttribute('data-unidade-id'), x: c.x + c.width / 2, y: c.y + c.height / 2 };
  });
  let melhor = null;
  for (const a of nos) {
    const perto = Math.min(...nos.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y)));
    if (!melhor || perto > melhor.perto) melhor = { id: a.id, perto: Math.round(perto) };
  }
  return melhor;
});

/**
 * A `box-shadow` computada vem em rgb/rgba com o `color-mix` já resolvido pelo navegador. Comparar
 * hex com hex é impossível; o que se pode afirmar é que o primeiro anel da sombra tem o MESMO matiz
 * dominante que `--cor-unidade`, isto é, o mesmo canal RGB máximo e a mesma ordem entre canais.
 * É o que distingue "anel saiu da cor do status" de "anel é lilás fixo", que é a asserção que
 * interessa.
 */
const corBateComSombra = (hex, sombra) => {
  const n = parseInt(hex.trim().slice(1), 16);
  const alvo = [n >> 16 & 255, n >> 8 & 255, n & 255];
  // Primeira cor da sombra, nos dois formatos que o Chromium serializa: `rgb(a)(r, g, b…)` e, para
  // `color-mix`, `color(srgb r g b / a)` em 0–1. Só `rgba?\(` pulava a primeira e lia o
  // `rgba(0, 0, 0, …)` da segunda sombra — preto empata os canais, e o caso passava por acaso
  // quando o status testado tinha ordem R>G>B (degradada), e falhava com disponível.
  const m = sombra.match(/rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/);
  if (!m) return false;
  const lido = m[1]
    ? m[1].split(',').slice(0, 3).map((v) => parseInt(v.trim(), 10))
    : m[2].split('/')[0].trim().split(/\s+/).slice(0, 3).map((v) => Math.round(parseFloat(v) * 255));
  const ordem = (a) => a.map((_, i) => i).sort((i, j) => a[j] - a[i]).join('');
  return ordem(alvo) === ordem(lido);
};

const lerPings = (page) => page.evaluate(() => [...document.querySelectorAll('.map__ping')].map((no) => ({
  oculto: no.getAttribute('aria-hidden'),
  tabindex: no.getAttribute('tabindex'),
  tag: no.tagName,
  // custom property inline, não backgroundColor: o volume (D18) usa radial-gradient em `background`,
  // que não altera --cor-ping — a leitura abaixo continua válida sem mudança.
  cor: no.style.getPropertyValue('--cor-ping'),
  // Inline, escrito por quadro pelo fade das pontas (D23); o computado incluiria herança, e o que
  // se prova é o valor que o componente escreveu.
  opacidade: no.style.opacity,
  largura: getComputedStyle(no).width,
  borda: getComputedStyle(no).borderTopWidth,
  sombra: getComputedStyle(no).boxShadow,
  x: Math.round(no.getBoundingClientRect().x), y: Math.round(no.getBoundingClientRect().y),
})));

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
    // O payload que alimenta o mapa, capturado na própria navegação: é dele que sai o esperado
    // de pings e de marcadores que pulsam, em vez de números fixos que o seed pode invalidar.
    const respostaUnidades = page.waitForResponse((r) => r.url().includes('/dashboard/unidades') && r.ok(), { timeout: 20000 });
    await page.click('a[href="/mapa"]');
    const unidadesDaApi = await (await respostaUnidades).json();
    await page.waitForSelector('.map__unidade', { timeout: 20000 });
    await page.waitForTimeout(1600);

    // ------------------------------------------ 1. município neutro (item 1, verificação real)
    /*
     * O canvas não é legível in-page (`preserveDrawingBuffer` desligado), então a cor do polígono
     * não sai por `drawImage`. O que dá para provar por DOM é o que ALIMENTA a camada: nenhuma
     * feature carrega mais `cor`, e nenhuma classe de amostra de polígono sobrou na legenda. A
     * confirmação visual do tom é a captura `01-municipio-neutro.png`, revisada a olho.
     */
    // D20: a legenda nasce recolhida (details.legend-bloco); abre-se por clique no summary antes de
    // ler textos e estilos visíveis dela (caso 8 lê .legend__linha).
    await page.click('summary.legend-bloco__resumo');
    await page.waitForFunction(() => document.querySelector('details.legend-bloco')?.open === true, null, { timeout: 5000 });
    checar(1, 'legenda abre ao clicar no summary (details.open)',
      await page.evaluate(() => document.querySelector('details.legend-bloco').open));
    const legenda = await page.evaluate(() => ({
      itens: document.querySelectorAll('details.legend-bloco .legend li').length,
      disclosure: document.querySelectorAll('.legend-extra').length,
      amostrasDePoligono: document.querySelectorAll('.legend__dot--none, .legend__dot--multiple').length,
      intro: document.querySelector('.legend-bloco .legend__intro')?.textContent.trim(),
      notas: document.querySelectorAll('details.legend-bloco .legend__nota').length,
    }));
    checar(1, 'legenda descreve o marcador, não o polígono', /marcador/i.test(legenda.intro || ''), legenda.intro);
    checar(1, 'seis status numa lista só, sem disclosure',
      legenda.itens === 6 && legenda.disclosure === 0, `${legenda.itens} itens, ${legenda.disclosure} disclosure`);
    checar(1, 'amostras exclusivas de polígono removidas', legenda.amostrasDePoligono === 0);
    checar(1, 'duas notas de gramática do mapa', legenda.notas === 2, `${legenda.notas} nota(s)`);
    await page.locator('.map-card').screenshot({ path: path.join(OUT, '01-municipio-neutro.png') });

    // -------------------------------------------------------- 2. pulso geral (D19, item 2)
    const unidades = await lerUnidades(page);
    /*
     * Sem número fixo: o esperado é o dado real. Vira marcador quem tem coordenada E código IBGE —
     * o mapa agrupa por município (`municipios.flatMap(m => m.units)` em mapa.component.ts) e unidade
     * sem código IBGE não entra em município nenhum, mesmo com lat/lon válidos (banco de dev tem a
     * unidade 24, "Indiaroba", nesse caso: coordenada real, `codigoIbge: null`). Só coordenada não
     * basta — foi tentado e falhou contra o dado real; ver relato da Task 4.
     */
    const elegiveis = unidadesDaApi.filter((u) => u.latitude != null && u.longitude != null && u.codigoIbge != null).length;
    checar(2, `todas as unidades elegíveis viraram marcador (${unidades.length} no mapa)`,
      unidades.length === elegiveis && unidades.length > 0,
      `${unidades.length} marcador(es) para ${elegiveis} unidade(s) com coordenada e código IBGE`);

    const pulsando = unidades.filter((u) => u.pulsa);
    checar(2, 'todos os marcadores pulsam (D19 reverteu o filtro de N07)',
      pulsando.length === unidades.length && unidades.length > 0,
      `${pulsando.length} pulsando de ${unidades.length}`);
    checar(2, 'nenhum marcador ficou de fora por status',
      unidades.filter((u) => !u.pulsa).length === 0,
      unidades.filter((u) => !u.pulsa).map((u) => u.status).join(', ') || 'nenhum');

    /*
     * DV13: a animação tem de estar no ::after. No elemento, o inline do MapLibre a anularia.
     *
     * Casamento por sufixo: o Angular prefixa o nome do @keyframes com o id de escopo do
     * componente (`_ngcontent-ng-cNNN_map-pulsar`), e o id muda a cada build.
     */
    checar(2, 'animação no ::after, nunca no elemento (DV13)',
      pulsando.every((u) => /(^|_)map-pulsar$/.test(u.animacaoNoAfter) && u.animacaoNoElemento === 'none'),
      pulsando.map((u) => `${u.animacaoNoAfter}/${u.animacaoNoElemento}`).join(' '));

    // D19 item 1 — o aro claro de 2px saiu. Lido por borda computada, não por captura. Filtra o
    // marcador selecionado (aria-pressed) porque este mede 19px por desenho, não 13px.
    const bordas = await page.evaluate(() => [...document.querySelectorAll('.map__unidade:not([aria-pressed="true"])')]
      .map((b) => getComputedStyle(b).borderTopWidth));
    checar(2, `marcador sem aro claro: borda de 0px nos ${bordas.length}`,
      bordas.length > 0 && bordas.every((b) => b === '0px'), [...new Set(bordas)].join(' '));

    const tamanhos = await page.evaluate(() => [...document.querySelectorAll('.map__unidade:not([aria-pressed="true"])')]
      .map((b) => getComputedStyle(b).width));
    checar(2, 'miolo ocupa os 13px inteiros',
      tamanhos.length > 0 && tamanhos.every((t) => t === '13px'), [...new Set(tamanhos)].join(' '));

    // ------------------------------------------------- 3. DV13: transform é da lib, não nosso
    /*
     * A regressão que DV13 registrou: o MapLibre reescreve `style.transform` do elemento do Marker,
     * e estilo inline vence folha de autor. O hover NÃO pode depender de transform. Prova: o
     * transform computado antes e durante o hover é o mesmo, e o que muda é a largura.
     */
    /*
     * Aracaju empilha quatro marcadores a ~30px (DV09): o de cima intercepta o ponteiro do de
     * baixo, e `.first()` caía justamente num deles — o hover do Playwright tentava 56 vezes e
     * estourava. O aglomerado é assunto de DV09; o que este roteiro prova é a dica e o pulso, e
     * para isso basta um marcador isolado, escolhido por distância real.
     */
    const isolado = await marcadorIsolado(page);
    checar(3, 'há marcador isolado o bastante para hover determinístico', isolado.perto > 24,
      `unidade ${isolado.id}, vizinho mais próximo a ${isolado.perto}px`);
    const alvoHover = page.locator(`.map__unidade[data-unidade-id="${isolado.id}"]`);
    const antes = await alvoHover.evaluate((el) => ({ t: getComputedStyle(el).transform, w: getComputedStyle(el).width }));
    await alvoHover.hover();
    await page.waitForTimeout(260);
    const durante = await alvoHover.evaluate((el) => ({ t: getComputedStyle(el).transform, w: getComputedStyle(el).width }));
    /*
     * O que prova DV13 não é o transform ser IDÊNTICO — ele muda 2px em cada eixo, porque o
     * `translate(-50%, -50%)` da lib resolve contra o novo tamanho do elemento (é justamente o
     * que faz o marcador crescer centrado sem conta nenhuma). O que prova é não haver componente
     * de ESCALA: a matriz continua `matrix(1, 0, 0, 1, …)`. Se o `transform: scale()` de autor
     * tivesse efeito, a e d seriam 1,25.
     */
    const semEscala = (m) => /^matrix\(1, 0, 0, 1,/.test(m);
    checar(3, 'transform de autor não entra: a matriz nunca ganha escala',
      semEscala(antes.t) && semEscala(durante.t), `${antes.t} -> ${durante.t}`);
    checar(3, 'hover cresce por largura, e isso funciona', antes.w !== durante.w, `${antes.w} -> ${durante.w}`);

    // -------------------------------------------------- 4. dica de relance no hover (item 4)
    const dicaHover = await alvoHover.evaluate((el) => {
      const d = el.querySelector('.map__dica');
      return { visivel: getComputedStyle(d).visibility, opacidade: getComputedStyle(d).opacity, texto: d.innerText.replace(/\s+/g, ' ').trim() };
    });
    checar(4, 'dica aparece no hover', dicaHover.visivel === 'visible' && dicaHover.opacidade === '1',
      `${dicaHover.visivel}/${dicaHover.opacidade}`);
    checar(4, 'dica traz nome, status e incidentes abertos',
      /STATUS/.test(dicaHover.texto) && /INCIDENTES ABERTOS/.test(dicaHover.texto), dicaHover.texto);
    checar(4, 'dica é aria-hidden — o conteúdo vai pelo aria-label',
      unidades.every((u) => u.temDica && u.dicaOculta === 'true'));
    checar(4, 'aria-label leva os mesmos três dados da dica',
      unidades.every((u) => /: [^,]+, \d+ equipamentos?, \d+ incidentes? abertos?$/.test(u.rotulo)),
      unidades[0].rotulo);

    // ------------------------------- 5. dica no FOCO de teclado, e foco não seleciona (item 4)
    await page.mouse.move(4, 4);
    await page.waitForTimeout(200);
    const pressionadosAntes = await page.locator('.map__unidade[aria-pressed="true"]').count();

    /*
     * Tab de verdade, e não `el.focus()`.
     *
     * `:focus-visible` é heurística do navegador: foco por script depois de um movimento de mouse
     * NÃO casa, e a primeira execução deste roteiro leu a dica como `hidden` e o contorno como o
     * padrão do UA por causa disso. O falso negativo é do teste; quem navega por Tab recebe o
     * estado certo. Varrer com Tab é também a prova que o caso 7 precisa: se algum ping fosse
     * focável, ele apareceria nesta varredura.
     */
    const varredura = { passos: 0, pings: 0, unidade: null };
    while (varredura.passos < 220 && !varredura.unidade) {
      await page.keyboard.press('Tab');
      varredura.passos++;
      const atual = await page.evaluate(() => {
        const a = document.activeElement;
        return a ? {
          ping: a.classList.contains('map__ping'),
          unidade: a.classList.contains('map__unidade') ? a.getAttribute('data-unidade-id') : null,
        } : { ping: false, unidade: null };
      });
      if (atual.ping) varredura.pings++;
      if (atual.unidade) varredura.unidade = atual.unidade;
    }
    checar(5, 'Tab alcança um marcador de unidade', !!varredura.unidade,
      `unidade ${varredura.unidade} em ${varredura.passos} passo(s) de Tab`);
    checar(7, 'nenhum ping recebeu foco na varredura de Tab', varredura.pings === 0,
      `${varredura.pings} ping(s) focado(s) em ${varredura.passos} passo(s)`);

    const foco = await page.evaluate(() => {
      const alvo = document.activeElement;
      const d = alvo.querySelector('.map__dica');
      return {
        visivel: getComputedStyle(d).visibility,
        contorno: getComputedStyle(alvo).outlineColor + ' ' + getComputedStyle(alvo).outlineWidth,
        pulsa: alvo.classList.contains('map__unidade--pulsa'),
        id: alvo.getAttribute('data-unidade-id'),
      };
    });
    await page.waitForTimeout(250);
    const pressionadosDepois = await page.locator('.map__unidade[aria-pressed="true"]').count();
    checar(5, 'dica também aparece no foco de teclado', foco.visivel === 'visible', foco.visivel);
    checar(5, 'focar NÃO seleciona — relance e seleção são níveis diferentes',
      pressionadosAntes === pressionadosDepois, `${pressionadosAntes} -> ${pressionadosDepois}`);
    /*
     * Literal, e de propósito: o anel de foco sobre o canvas NÃO pode seguir o tema da aplicação.
     * Esta execução rodou no tema claro e pegou #1a56db — 2,43:1 contra o município, reprovado por
     * WCAG 2.2. Ver `--cor-foco-mapa` em mapa.component.scss. Se alguém trocar o literal pelo
     * token outra vez, é aqui que aparece.
     */
    checar(5, 'anel de foco com a cor fixa do mapa, independente do tema',
      /rgb\(59, 110, 255\)/.test(foco.contorno) && foco.contorno.endsWith('2px'), foco.contorno);

    // Enter no marcador focado seleciona — os dois níveis convivem, o segundo exige ação.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    checar(5, 'Enter no marcador focado seleciona (dica não rouba a ação)',
      (await page.locator(`.map__unidade[data-unidade-id="${foco.id}"][aria-pressed="true"]`).count()) === 1);

    // ------------------------------- 6. foco + pulso juntos, num marcador que realmente pulsa
    const idQuePulsa = pulsando[0]?.id;
    if (!idQuePulsa) {
      checar(6, 'captura de foco sobre marcador pulsando', false, 'nenhuma unidade pulsando no banco de dev');
    } else {
      const seletor = `.map__unidade[data-unidade-id="${idQuePulsa}"]`;
      // Tab a partir do marcador já focado até chegar no que pulsa: mantém `:focus-visible` vivo.
      for (let i = 0; i < 220; i++) {
        const chegou = await page.evaluate((alvo) => document.activeElement?.getAttribute('data-unidade-id') === alvo
          && document.activeElement.classList.contains('map__unidade'), idQuePulsa);
        if (chegou) break;
        await page.keyboard.press('Tab');
      }
      await page.waitForTimeout(300);
      checar(6, 'marcador que pulsa alcançado por Tab',
        (await page.evaluate((alvo) => document.activeElement?.getAttribute('data-unidade-id') === alvo, idQuePulsa)));

      const caixa = await page.locator(seletor).boundingBox();
      // Três instantes do ciclo de 1,9s: o anel nasce fora do foco, cresce e some.
      /*
       * Recorte de 210px e deslocado para baixo: no foco a dica TAMBÉM abre, e ela ocupa a faixa
       * acima do marcador. Um recorte de 120px centrado mostrava só a dica — a primeira execução
       * gerou três capturas em que o anel não aparecia. O que a evidência tem de mostrar é o anel
       * de foco e o anel de pulso convivendo, e isso fica abaixo da dica.
       */
      for (const [nome, espera] of [['a', 0], ['b', 620], ['c', 640]]) {
        await page.waitForTimeout(espera);
        await page.screenshot({
          path: path.join(OUT, `04-foco-e-pulso-${nome}.png`),
          clip: { x: Math.max(0, caixa.x - 95), y: Math.max(0, caixa.y - 58), width: 210, height: 210 },
        });
      }
      const raios = await page.locator(seletor).evaluate((el) => {
        const caixaEl = el.getBoundingClientRect();
        const depois = getComputedStyle(el, '::after');
        const deslocamento = parseFloat(getComputedStyle(el).outlineOffset);
        const larguraContorno = parseFloat(getComputedStyle(el).outlineWidth);
        return {
          raioMarcador: caixaEl.width / 2,
          raioForaDoFoco: caixaEl.width / 2 + deslocamento + larguraContorno,
          raioPulsoEmRepouso: caixaEl.width / 2 + Math.abs(parseFloat(depois.insetBlockStart || depois.top)),
        };
      });
      checar(6, 'anel de pulso NASCE fora do anel de foco, não o atravessa',
        raios.raioPulsoEmRepouso > raios.raioForaDoFoco,
        `pulso a ${raios.raioPulsoEmRepouso}px do centro, foco termina em ${raios.raioForaDoFoco}px`);
    }

    // --------------------------------------- 7. pings: invisíveis para teclado e leitor de tela
    const pings = await lerPings(page);
    /*
     * Esperado derivado do DADO, não fixado em 20. No banco de dev a unidade Lagarto está com
     * `conectaAUnidadeId` nulo — é raiz, como a Sede — então são 9 linhas e não 10, e a primeira
     * execução acusou 18 pings contra 20 esperados. Fixar o número faria o roteiro falhar por
     * mudança de seed, que não é o que ele mede.
     *
     * `codigoIbge != null` nos dois lados (achado da Task 4, pré-D19): o mapa desenha marcador,
     * linha e ping a partir de `municipios.flatMap(municipio => municipio.units)`
     * (mapa.component.ts) — unidade sem `codigoIbge` nunca entra nesse agrupamento, mesmo com
     * coordenada válida. O banco de dev tem a unidade "Indiaroba" (id 24, SEM_DADOS) nesse caso:
     * coordenada real, `codigoIbge: null`, pai com coordenada — sem o filtro, a fórmula contava
     * uma linha/dois pings que a aplicação nunca desenha.
     */
    const conexoesEsperadas = unidadesDaApi.filter((u) => u.conectaAUnidadeId != null
      && u.latitude != null && u.longitude != null && u.codigoIbge != null
      && unidadesDaApi.some((p) => p.id === u.conectaAUnidadeId && p.latitude != null && p.longitude != null && p.codigoIbge != null)).length;
    checar(7, 'três pings por linha de conexão desenhável, a ⅓ (D23)',
      pings.length === conexoesEsperadas * 3,
      `${pings.length} ping(s) para ${conexoesEsperadas} linha(s)`);
    /*
     * D23: o contorno branco eram duas camadas — `border` de 1px e a primeira sombra
     * rgba(232, 240, 248, .3). As duas saíram; o glow é na cor do status. Branco puro também é
     * barrado: o núcleo claro do orbe vive no gradiente, nunca na sombra.
     */
    const contornados = pings.filter((p) => p.largura !== '5px' || p.borda !== '0px'
      || /232,\s*240,\s*248/.test(p.sombra) || /255,\s*255,\s*255/.test(p.sombra));
    checar(7, 'todo ping é orbe de 5px sem contorno branco (D23)',
      pings.length > 0 && contornados.length === 0,
      contornados.length ? `${contornados.length} fora: ${JSON.stringify(contornados[0])}` : `${pings.length} a 5px, borda 0, sombra ${pings[0]?.sombra}`);
    checar(7, 'todo ping é aria-hidden', pings.length > 0 && pings.every((p) => p.oculto === 'true'));
    checar(7, 'nenhum ping tem tabindex', pings.every((p) => p.tabindex === null));
    checar(7, 'ping é <div>, não elemento focável por natureza', pings.every((p) => p.tag === 'DIV'));

    // Prova forte: varrer o Tab inteiro da página e conferir que nenhum ping recebe foco.
    const focaveis = await page.evaluate(() => {
      const todos = [...document.querySelectorAll('a[href],button,input,select,textarea,summary,details,[tabindex]')]
        .filter((n) => !n.closest('[inert]'));
      return {
        total: todos.length,
        pings: todos.filter((n) => n.classList.contains('map__ping')).length,
        pingsComTabindex: document.querySelectorAll('.map__ping[tabindex]').length,
      };
    });
    checar(7, 'nenhum ping na coleção de focáveis da página',
      focaveis.pings === 0 && focaveis.pingsComTabindex === 0, `${focaveis.total} focáveis na página, 0 pings`);

    /*
     * `page.accessibility` foi removido do Playwright. A prova equivalente, e mais direta: todo
     * ping está sob `aria-hidden=true` (já verificado acima), nenhum tem nome acessível, e a
     * varredura de Tab do caso 5 não encostou em nenhum.
     */
    const nomeacao = await page.evaluate(() =>
      [...document.querySelectorAll('.map__ping')].map((n) => ({
        rotulo: n.getAttribute('aria-label'), texto: n.textContent.trim(), papel: n.getAttribute('role'),
      })));
    checar(7, 'ping não tem nome acessível, texto nem papel',
      nomeacao.every((n) => !n.rotulo && !n.texto && !n.papel));

    // ------------------------------------------- 8. ping colorido, linha neutra (item 3)
    /*
     * `--cor-ping` é lida do style inline, então volta como o hex cru que o componente escreveu —
     * não como `rgb(...)` resolvido. Comparação contra a escala de `COR_DO_STATUS`, e o esperado
     * vem do dado: são as cores dos status das unidades efetivamente conectadas, que no banco de
     * dev são só duas (DISPONIVEL e DEGRADADA).
     *
     * `codigoIbge != null` pelo mesmo motivo do caso 7: sem o filtro, a unidade 24 ("Indiaroba",
     * SEM_DADOS, sem código IBGE) entrava no esperado com a cor `sem-dados`, mas nunca produz ping
     * de verdade — não tem marcador nem linha, a aplicação nunca a desenha. Pré-D19, achado na Task 4.
     */
    const cores = new Set(pings.map((p) => p.cor.trim()));
    const statusConectados = new Set(unidadesDaApi
      .filter((u) => u.conectaAUnidadeId != null && u.latitude != null && u.longitude != null && u.codigoIbge != null)
      .map((u) => COR[u.status.toLowerCase().replace(/_/g, '-')]));
    checar(8, 'ping herda a cor de status da unidade conectada',
      cores.size === statusConectados.size && [...cores].every((c) => statusConectados.has(c)),
      `pings: ${[...cores].join(' ')} · esperado: ${[...statusConectados].join(' ')}`);

    const amostraLinha = await page.evaluate(() => {
      // A camada vive no WebGL; o que da para inspecionar e o que a legenda declara sobre ela.
      const amostra = document.querySelector('.legend__linha');
      if (!amostra) return null;
      const estilo = getComputedStyle(amostra);
      return { imagem: estilo.backgroundImage, cor: estilo.backgroundColor };
    });
    /*
     * D18 removeu o gradiente: a linha do canvas e inteira da cor do status, e a amostra da legenda
     * virou traco solido — nao ha mais "ponta que tinge" para provar. O que o check protege agora e
     * que a amostra nao voltou a ser gradiente por acidente.
     */
    checar(8, 'amostra da linha e traco solido, sem gradiente',
      !!amostraLinha && amostraLinha.imagem === 'none' && amostraLinha.cor === 'rgba(124, 150, 180, 0.65)',
      JSON.stringify(amostraLinha));

    /*
     * Deslocamento acumulado em TRÊS amostras ao longo de meio ciclo, e não a diferença entre
     * duas leituras a 500ms.
     *
     * Duas leituras não bastam: a posição é arredondada ao pixel, e um ping que esteja perto do
     * ponto de retorno (fase ≈ 0 ou 1) ou numa linha curta — as quatro de Aracaju medem poucas
     * dezenas de pixels na tela — anda menos de 1px na janela. A primeira execução acusou 13 de
     * 18 por isso, com a animação funcionando. Somar o percurso em três instantes cobre o ciclo
     * inteiro: nenhum ping fica parado em duas janelas seguidas.
     */
    /* A janela acompanha o periodo: 1050ms sao ¼ de uma travessia hub -> unidade (4200ms, D23 — em
     * D17 eram ¼ do vai-e-volta). Com o fluxo em dente de serra nao ha mais ponto de retorno, mas
     * a virada u≈1 -> 0 cai dentro de uma janela de vez em quando, e somar tres amostras continua
     * sendo o que evita falso parado. O fade zera a OPACIDADE perto das pontas, nao a posicao: o
     * criterio de distancia segue valido para ping invisivel. */
    const amostras = [pings];
    for (let i = 0; i < 2; i++) { await page.waitForTimeout(1050); amostras.push(await lerPings(page)); }
    const percurso = pings.map((_, i) => amostras.slice(1).reduce((soma, atual, k) =>
      soma + Math.hypot(atual[i].x - amostras[k][i].x, atual[i].y - amostras[k][i].y), 0));
    const parados = percurso.filter((d) => d < 1).length;
    checar(8, 'todo ping percorre a linha — nenhum fica parado',
      parados === 0,
      `${pings.length - parados}/${pings.length} em movimento · percurso mínimo ${Math.min(...percurso).toFixed(1)}px em 2,1s`);
    /*
     * Fade das pontas (D23), forma simples (Ruling B): nas três amostras há ping com opacidade
     * inline < 1 — o fade está ativo — e nenhuma opacidade sai de [0, 1]. Com 27 pings defasados de
     * ⅓, 16% de cada arco está em fade a qualquer instante; não ver nenhum seria o fade morto.
     */
    const opacidades = amostras.flat().map((p) => Number(p.opacidade));
    checar(8, 'fade nas pontas ativo e opacidade sempre em [0, 1] (D23)',
      opacidades.some((o) => o < 1) && opacidades.every((o) => Number.isFinite(o) && o >= 0 && o <= 1),
      `${opacidades.filter((o) => o < 1).length}/${opacidades.length} leitura(s) abaixo de 1, mín ${Math.min(...opacidades).toFixed(3)}`);

    // ---------------------------------------- 9. prefers-reduced-motion: sem movimento nenhum
    const reduzido = await browser.newContext({ viewport: { width: 1500, height: 950 }, reducedMotion: 'reduce' });
    await apontarApi(reduzido);
    const pagina2 = await reduzido.newPage();
    await pagina2.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await pagina2.fill('#login-email', EMAIL);
    await pagina2.fill('#login-senha', SENHA);
    await pagina2.click('.login-submit');
    await pagina2.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
    await pagina2.click('a[href="/mapa"]');
    await pagina2.waitForSelector('.map__unidade', { timeout: 20000 });
    await pagina2.waitForTimeout(1600);
    const semMovimento = await pagina2.evaluate(() => ({
      pings: document.querySelectorAll('.map__ping').length,
      pulsaAinda: [...document.querySelectorAll('.map__unidade--pulsa')].length,
      animacao: [...document.querySelectorAll('.map__unidade--pulsa')]
        .map((n) => getComputedStyle(n, '::after').animationName),
      anelVisivel: [...document.querySelectorAll('.map__unidade--pulsa')]
        .map((n) => getComputedStyle(n, '::after').opacity),
    }));
    checar(9, 'sob reduced-motion nenhum ping é criado', semMovimento.pings === 0, `${semMovimento.pings} ping(s)`);
    checar(9, 'anel de pulso vira estático, não some',
      semMovimento.pulsaAinda > 0
      && semMovimento.animacao.every((a) => a === 'none')
      && semMovimento.anelVisivel.every((o) => Number(o) > 0),
      `${semMovimento.pulsaAinda} anel(éis), animação ${[...new Set(semMovimento.animacao)].join('/')}, opacidade ${[...new Set(semMovimento.anelVisivel)].join('/')}`);
    await pagina2.locator('.map-card').screenshot({ path: path.join(OUT, '05-reduced-motion.png') });
    await reduzido.close();

    // ------------------------------------- 9b. foco + pulso ampliado, para revisão a olho
    /*
     * Contexto próprio a 3x, e não um override de densidade na página já aberta: o Playwright fixa
     * as métricas do contexto e o `clip` continua em px de CSS, então `Emulation.setDeviceMetrics`
     * por CDP não muda nada no PNG — tentado, o arquivo saiu idêntico. A 1x o recorte de ~200px é
     * ilegível e a revisão precisa separar o anel de foco (azul, sólido) do anel de pulso (âmbar,
     * esmaecendo). Custa um login a mais, e é a evidência que a rodada tem de entregar.
     */
    if (idQuePulsa) {
      const ampliado = await browser.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 3 });
      await apontarApi(ampliado);
      const pagina3 = await ampliado.newPage();
      await pagina3.goto(BASE + '/login', { waitUntil: 'networkidle' });
      await pagina3.fill('#login-email', EMAIL);
      await pagina3.fill('#login-senha', SENHA);
      await pagina3.click('.login-submit');
      await pagina3.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
      await pagina3.click('a[href="/mapa"]');
      await pagina3.waitForSelector('.map__unidade', { timeout: 20000 });
      await pagina3.waitForTimeout(1600);
      const alvo3 = `.map__unidade[data-unidade-id="${idQuePulsa}"]`;
      for (let i = 0; i < 220; i++) {
        const chegou = await pagina3.evaluate((a) => document.activeElement?.getAttribute('data-unidade-id') === a
          && document.activeElement.classList.contains('map__unidade'), idQuePulsa);
        if (chegou) break;
        await pagina3.keyboard.press('Tab');
      }
      const caixa3 = await pagina3.locator(alvo3).boundingBox();
      checar(9, 'evidência ampliada: marcador que pulsa focado por teclado em 3x',
        (await pagina3.evaluate((a) => document.activeElement?.getAttribute('data-unidade-id') === a, idQuePulsa)));
      for (const [nome, espera] of [['a', 0], ['b', 620], ['c', 640]]) {
        await pagina3.waitForTimeout(espera);
        await pagina3.screenshot({
          path: path.join(OUT, `06-foco-e-pulso-3x-${nome}.png`),
          clip: { x: Math.max(0, caixa3.x - 60), y: Math.max(0, caixa3.y - 60), width: 130, height: 130 },
        });
      }
      await ampliado.close();
    }

    // ------------------------------- 9c. anel de seleção na cor do status (D19 item 3)
    const STATUS_TODOS = [
      ['disponivel', '#35e087'], ['indisponivel', '#f84e54'], ['degradada', '#fcb142'],
      ['em-manutencao', '#7fadff'], ['sem-dados', '#9dabb9'], ['sem-equipamentos', '#6e8698'],
    ];

    /*
     * O banco de dev tem só 3 status distintos (DISPONIVEL, DEGRADADA, SEM_DADOS). A prova nos seis
     * status abaixo não é conveniência: é a única via possível para EM_MANUTENCAO, INDISPONIVEL e
     * SEM_EQUIPAMENTOS, que não existem no dado hoje. 9c-b força `--cor-unidade` e `aria-pressed`
     * via DOM e prova a REGRA CSS (ela lê a variável, e é a variável que está sendo posta) — não
     * que aquele status ocorra no dado. 9c-a, que roda numa unidade real com o status que ela tiver,
     * é quem prova o caminho de ponta a ponta pela aplicação.
     */

    // 9c-a. Prova funcional: seleciona uma unidade real e confere que o anel saiu da cor dela.
    // Reaproveita `isolado` do caso 3 — marcadorIsolado(page) retorna { id, perto }, não só o id.
    const alvoReal = isolado.id;
    const seletorAlvo = `.map__unidade[data-unidade-id="${alvoReal}"]`;
    // Estado real do marcador ANTES de selecionar, para devolver depois sem `page.reload()` — a
    // sessão só vive em memória (AuthStateService), e um reload cairia em /login como um goto cairia.
    const estadoOriginalAlvo = await page.evaluate((id) => {
      const b = document.querySelector(`.map__unidade[data-unidade-id="${id}"]`);
      return { cor: b.style.getPropertyValue('--cor-unidade'), pressionado: b.getAttribute('aria-pressed') };
    }, alvoReal);
    /*
     * `locator(...).click()` (mouse sintético do Playwright) NÃO seleciona este marcador — medido:
     * fica em `aria-pressed="false"` mesmo após o clique, mouse ainda sobre o botão. `el.click()`
     * nativo por `page.evaluate` seleciona de primeira (mesma unidade, mesmo estado). A hipótese mais
     * provável é o `mousemove` intermediário do Playwright interagindo com o Marker do MapLibre
     * (mousedown+leve deslocamento+mouseup lido como intenção de arrastar); o caso 5 já prova o
     * caminho de teclado (Enter seleciona) — isto aqui é o mesmo clique, só que despachado nativo.
     */
    await page.evaluate((sel) => document.querySelector(sel).click(), seletorAlvo);
    await page.waitForTimeout(250);
    const selecionado = await page.evaluate((id) => {
      const b = document.querySelector(`.map__unidade[data-unidade-id="${id}"]`);
      const e = getComputedStyle(b);
      return { cor: b.style.getPropertyValue('--cor-unidade'), sombra: e.boxShadow, largura: e.width };
    }, alvoReal);
    checar(9, 'marcador selecionado cresce para 19px',
      selecionado.largura === '19px', selecionado.largura);
    checar(9, 'anel de seleção não é mais lilás',
      !/242,\s*214,\s*255/.test(selecionado.sombra), selecionado.sombra);
    checar(9, 'anel de seleção herda o matiz de --cor-unidade',
      corBateComSombra(selecionado.cor, selecionado.sombra),
      `${selecionado.cor} -> ${selecionado.sombra}`);

    // 9c-b. Prova visual dos seis: força cor e estado no marcador já selecionado, captura um por status.
    for (const [chave, hex] of STATUS_TODOS) {
      await page.evaluate(([id, hex]) => {
        const b = document.querySelector(`.map__unidade[data-unidade-id="${id}"]`);
        b.style.setProperty('--cor-unidade', hex);
        b.setAttribute('aria-pressed', 'true');
      }, [alvoReal, hex]);
      await page.waitForTimeout(160);
      const caixa = await page.locator(seletorAlvo).boundingBox();
      await page.screenshot({
        path: path.join(OUT, `d19-anel-${chave}.png`),
        clip: { x: caixa.x - 46, y: caixa.y - 46, width: 120, height: 120 },
      });
      const largura = await page.evaluate((id) => getComputedStyle(document.querySelector(`.map__unidade[data-unidade-id="${id}"]`)).width, alvoReal);
      checar(9, `anel visível e marcador a 19px no status ${chave}`, largura === '19px', largura);
    }
    // Devolve o marcador ao estado real de antes de 9c-a — sem reload, ver comentário acima.
    await page.evaluate(([id, cor, pressionado]) => {
      const b = document.querySelector(`.map__unidade[data-unidade-id="${id}"]`);
      if (cor) b.style.setProperty('--cor-unidade', cor); else b.style.removeProperty('--cor-unidade');
      if (pressionado === 'true') b.setAttribute('aria-pressed', 'true'); else b.setAttribute('aria-pressed', 'false');
    }, [alvoReal, estadoOriginalAlvo.cor, estadoOriginalAlvo.pressionado]);
    await page.waitForTimeout(200);

    // -------------------------------------------------- 10. captura combinada pedida na revisão
    /*
     * Tudo junto numa tela só: pulso geral (D19), linha neutra com ping colorido em movimento e a
     * dica aberta. A dica vai pelo HOVER, que é o estado que o revisor pediu para ver; o caso 5 já
     * provou por medição que o foco de teclado produz o mesmo.
     */
    await page.locator(`.map__unidade[data-unidade-id="${isolado.id}"]`).hover();
    await page.waitForTimeout(700);
    await page.locator('.map-card').screenshot({ path: path.join(OUT, '02-tudo-junto.png') });
    await page.screenshot({ path: path.join(OUT, '03-tela-inteira.png') });

    /*
     * Captura única exigida por D19: marcador sem halo, pulso em vários status, e anel de seleção em
     * três marcadores ao mesmo tempo, em três cores de status distintas.
     *
     * As TRÊS CORES são forçadas, e por isso: o banco de dev só tem dois status com marcador real
     * (Disponível e Degradada — a única unidade SEM_DADOS, "Indiaroba", fica fora do mapa por não
     * ter código IBGE, achado da Task 4). Agrupar por status real, como a primeira versão desta
     * captura fazia, dá dois anéis, não três. Para mostrar os três ao mesmo tempo força-se
     * `--cor-unidade` e `aria-pressed` em três marcadores espalhados pela tela (ordenados por x para
     * não empilhar no aglomerado de Aracaju) — o resto (halo ausente, pulso) continua no estado real,
     * sem nada forçado. A prova de que a SELEÇÃO em si funciona sem forçar nada é o caso 9a, na
     * unidade real.
     */
    await page.evaluate(() => {
      const cores = ['#35e087', '#f84e54', '#fcb142'];
      const nos = [...document.querySelectorAll('.map__unidade')]
        .map((b) => ({ b, x: b.getBoundingClientRect().x }))
        .sort((a, z) => a.x - z.x);
      const passo = Math.max(1, Math.floor(nos.length / 3));
      const escolhidos = [nos[0], nos[passo], nos[Math.min(nos.length - 1, passo * 2)]];
      escolhidos.forEach(({ b }, i) => { b.style.setProperty('--cor-unidade', cores[i]); b.setAttribute('aria-pressed', 'true'); });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'd19-tudo-junto.png'), fullPage: false });

    checar(0, 'nenhum erro de página no roteiro inteiro', erros.length === 0, erros.join(' | '));
  } catch (erro) {
    fatal = erro;
  } finally {
    fs.writeFileSync(path.join(OUT, 'n07-pulso-ping-dica.json'),
      JSON.stringify({ resultados, erros, fatal: fatal ? String(fatal) : null }, null, 2));
    await page.screenshot({ path: path.join(OUT, 'final.png') }).catch(() => {});
    await browser.close();
  }

  for (const r of resultados) console.log(`${r.ok ? 'OK   ' : 'FALHA'} [caso ${r.caso}] ${r.nome}${r.detalhe ? ' — ' + r.detalhe : ''}`);
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - falhas}/${resultados.length} verificações`);
  if (fatal) { console.error(fatal); process.exit(1); }
  process.exit(falhas ? 1 : 0);
})();

/*
 * N07 — município neutro, pulso seletivo, ping colorido na linha neutra e dica de relance.
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
 * - o pulso é SELETIVO (só INDISPONIVEL e DEGRADADA) e não decorativo;
 * - o pulso vive no ::after, nunca no elemento — é a regra que DV13 deixou;
 * - o anel de foco continua legível com o pulso rodando por cima;
 * - os pings são invisíveis para teclado e leitor de tela (requisito de aceite, não detalhe);
 * - a dica aparece no FOCO e não só no hover, e focar não seleciona;
 * - a conexão é inteiramente da cor do status da unidade conectada (D18).
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = 'http://127.0.0.1:4200';
const EMAIL = 'admin@inframonitor.local';
const SENHA = process.env.N07_SENHA;
if (!SENHA) throw new Error('N07_SENHA é obrigatória');

const OUT = path.join(__dirname, 'n07-evidence');
fs.mkdirSync(OUT, { recursive: true });

const resultados = [];
const checar = (caso, nome, ok, detalhe) => { resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' }); };

/** Cores do canvas, espelhadas do componente. Divergir daqui é o teste falhar, que é o certo. */
const COR = {
  disponivel: '#34c77b', indisponivel: '#e5484d', degradada: '#e8a33d',
  'em-manutencao': '#7fadff', 'sem-dados': '#435464', 'sem-equipamentos': '#263744',
};
const PULSAM = ['Indisponível', 'Degradada'];

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

const lerPings = (page) => page.evaluate(() => [...document.querySelectorAll('.map__ping')].map((no) => ({
  oculto: no.getAttribute('aria-hidden'),
  tabindex: no.getAttribute('tabindex'),
  tag: no.tagName,
  cor: no.style.getPropertyValue('--cor-ping'),
  x: Math.round(no.getBoundingClientRect().x), y: Math.round(no.getBoundingClientRect().y),
})));

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
    const legenda = await page.evaluate(() => ({
      itens: document.querySelectorAll('.legend-bloco > .legend li').length,
      disclosure: document.querySelectorAll('.legend-extra').length,
      amostrasDePoligono: document.querySelectorAll('.legend__dot--none, .legend__dot--multiple').length,
      intro: document.querySelector('.legend-bloco .legend__intro')?.textContent.trim(),
      notas: document.querySelectorAll('.legend-bloco > .legend__nota').length,
    }));
    checar(1, 'legenda descreve o marcador, não o polígono', /marcador/i.test(legenda.intro || ''), legenda.intro);
    checar(1, 'seis status numa lista só, sem disclosure',
      legenda.itens === 6 && legenda.disclosure === 0, `${legenda.itens} itens, ${legenda.disclosure} disclosure`);
    checar(1, 'amostras exclusivas de polígono removidas', legenda.amostrasDePoligono === 0);
    checar(1, 'duas notas de gramática do mapa', legenda.notas === 2, `${legenda.notas} nota(s)`);
    await page.locator('.map-card').screenshot({ path: path.join(OUT, '01-municipio-neutro.png') });

    // -------------------------------------------------------- 2. pulso seletivo (item 2)
    const unidades = await lerUnidades(page);
    checar(2, 'onze marcadores de unidade', unidades.length === 11, `${unidades.length}`);

    const deveriamPulsar = unidades.filter((u) => PULSAM.includes(u.status));
    const pulsando = unidades.filter((u) => u.pulsa);
    checar(2, 'pulsa exatamente quem está Indisponível ou Degradada',
      pulsando.length === deveriamPulsar.length
      && pulsando.every((u) => PULSAM.includes(u.status)),
      `${pulsando.length} pulsando de ${unidades.length}: ${pulsando.map((u) => u.status).join(', ')}`);
    checar(2, 'nem todos pulsam — é seletivo, não decorativo',
      pulsando.length > 0 && pulsando.length < unidades.length,
      `${pulsando.length}/${unidades.length}`);

    /*
     * DV13: a animação tem de estar no ::after. No elemento, o inline do MapLibre a anularia.
     *
     * Casamento por sufixo: o Angular prefixa o nome do @keyframes com o id de escopo do
     * componente (`_ngcontent-ng-cNNN_map-pulsar`), e o id muda a cada build.
     */
    checar(2, 'animação no ::after, nunca no elemento (DV13)',
      pulsando.every((u) => /(^|_)map-pulsar$/.test(u.animacaoNoAfter) && u.animacaoNoElemento === 'none'),
      pulsando.map((u) => `${u.animacaoNoAfter}/${u.animacaoNoElemento}`).join(' '));
    checar(2, 'quem não pulsa não tem anel de pulso',
      unidades.filter((u) => !u.pulsa).every((u) => u.animacaoNoAfter === 'none'));

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
      unidades.every((u) => /: [^,]+, \d+ equipamento\(s\), \d+ incidente\(s\) aberto\(s\)$/.test(u.rotulo)),
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
     */
    const conexoesEsperadas = unidadesDaApi.filter((u) => u.conectaAUnidadeId != null
      && u.latitude != null && u.longitude != null
      && unidadesDaApi.some((p) => p.id === u.conectaAUnidadeId && p.latitude != null && p.longitude != null)).length;
    checar(7, 'dois pings por linha de conexão desenhável, em fases opostas',
      pings.length === conexoesEsperadas * 2,
      `${pings.length} ping(s) para ${conexoesEsperadas} linha(s)`);
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
     */
    const cores = new Set(pings.map((p) => p.cor.trim()));
    const statusConectados = new Set(unidadesDaApi
      .filter((u) => u.conectaAUnidadeId != null && u.latitude != null && u.longitude != null)
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
    /* A janela acompanha o periodo: com D17 o ciclo passou de 2600ms para 4200ms, e 650ms deixaram
     * de ser um quarto de ciclo. 1050ms mantem as tres amostras cobrindo meio ciclo, que e a razao
     * de o check nao acusar falso parado perto do ponto de retorno. */
    const amostras = [pings];
    for (let i = 0; i < 2; i++) { await page.waitForTimeout(1050); amostras.push(await lerPings(page)); }
    const percurso = pings.map((_, i) => amostras.slice(1).reduce((soma, atual, k) =>
      soma + Math.hypot(atual[i].x - amostras[k][i].x, atual[i].y - amostras[k][i].y), 0));
    const parados = percurso.filter((d) => d < 1).length;
    checar(8, 'todo ping percorre a linha — nenhum fica parado',
      parados === 0,
      `${pings.length - parados}/${pings.length} em movimento · percurso mínimo ${Math.min(...percurso).toFixed(1)}px em 2,1s`);

    // ---------------------------------------- 9. prefers-reduced-motion: sem movimento nenhum
    const reduzido = await browser.newContext({ viewport: { width: 1500, height: 950 }, reducedMotion: 'reduce' });
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

    // -------------------------------------------------- 10. captura combinada pedida na revisão
    /*
     * Tudo junto numa tela só: pulso seletivo, linha neutra com ping colorido em movimento e a dica
     * aberta. A dica vai pelo HOVER, que é o estado que o revisor pediu para ver; o caso 5 já provou
     * por medição que o foco de teclado produz o mesmo.
     */
    await page.locator(`.map__unidade[data-unidade-id="${isolado.id}"]`).hover();
    await page.waitForTimeout(700);
    await page.locator('.map-card').screenshot({ path: path.join(OUT, '02-tudo-junto.png') });
    await page.screenshot({ path: path.join(OUT, '03-tela-inteira.png') });

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

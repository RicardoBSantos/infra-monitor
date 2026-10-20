/*
 * Painel — status coerente por unidade (barra, marca e badge) e abas de tipo, ponta a ponta.
 *
 *   npm run e2e:painel      (exige PAINEL_EMAIL e PAINEL_SENHA no ambiente)
 *
 *   PAINEL_BANCO=dev    (padrão) asserções do banco de dev; evidência em e2e/painel-status-tipos-evidence/
 *   PAINEL_BANCO=carga  asserções do banco da carga (3 tipos, 3 equipamentos, índice completo);
 *                       evidência em PAINEL_EVIDENCIA_DIR (obrigatório — fica fora do repositório)
 *
 * Pré-requisitos: `ng serve` em 4200 e a API desta branch em 8080 — NOS DOIS BANCOS. Para a carga o
 * controlador para o backend de dev e sobe o da carga na mesma porta 8080 (não há api-porta.cjs nesta
 * branch); por isso a API é uma constante única, usada também no filtro do log de rede.
 * Roteiro somente de leitura.
 *
 * O QUE ESTE ROTEIRO PROVA:
 *  1. Para cada linha `.unidade`: tom de `unidade--*` == tom de `marca--*` == tom do `.badge--*` do
 *     `app-status-badge`; o rótulo do badge corresponde ao tom; o ícone da marca (`data-icone`) é o
 *     do tom, com caixa >= 14px.
 *  2. O chip `.chip-manutencao` não encosta na `.faixa` da mesma linha e não corta texto a 1440px.
 *     A 860px a faixa some (coluna oculta) e só se registra se as reticências entraram.
 *  3. Abas de tipo: sem filtro, com pill de status e com busca. Índice parcial (`.abas__parcial`) e
 *     contadores (`.aba__contagem`) são exclusivos; com contadores, "Todos" == soma dos tipos e
 *     desabilitada <=> 0.
 *  4. Manutenção tem segmento e contador próprios (`.faixa__info`, `.contagens .info`), separados do
 *     degradado. Capturas `*-escuro.png` no tema escuro, alternado pelo botão da topbar e desfeito no fim.
 *  5. Status ausentes nos dados reais (INDISPONIVEL, SEM_DADOS, EM_MANUTENCAO, SEM_EQUIPAMENTOS)
 *     numa captura SEPARADA, com 4 linhas "[sintético]" injetadas por `page.route` em
 *     GET /dashboard/unidades. As capturas de dado real nunca usam interceptação.
 *
 * DADOS DO DEV EMBUTIDOS: as asserções `dev.*` assumem fatos do banco de dev (11 unidades, a lista
 * exata do catálogo de tipos em TIPOS_DEV, índice parcial "100 de 221"). Se o banco de dev mudar,
 * essas asserções quebram sem que o Painel esteja errado — atualize as constantes, não o código.
 *
 * Verificação vazia por construção (ex.: chip × faixa com a faixa oculta, ou sem nenhum chip) é
 * gravada com `informativo: true` e não conta como aprovação.
 *
 * ARMADILHAS herdadas (não reintroduzir):
 *  - Sessão só em memória: page.goto pós-login cai em /login. Toda navegação é por clique.
 *  - Nada de catch silencioso em seletor.
 *  - Log de rede e resultados gravados em `finally`.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const os = require('os'); const path = require('path');

const BASE = 'http://127.0.0.1:4200';
const API = 'http://localhost:8080/api/v1';
const EMAIL = process.env.PAINEL_EMAIL;
const SENHA = process.env.PAINEL_SENHA;
if (!EMAIL || !SENHA) throw new Error('PAINEL_EMAIL e PAINEL_SENHA são obrigatórias');
const BANCO = process.env.PAINEL_BANCO || 'dev';
if (!['dev', 'carga'].includes(BANCO)) throw new Error(`PAINEL_BANCO inválido: ${BANCO}`);
const DEV = BANCO === 'dev';
if (!DEV && !process.env.PAINEL_EVIDENCIA_DIR) throw new Error('PAINEL_EVIDENCIA_DIR é obrigatório na carga (evidência fora do repo)');

const OUT = DEV ? path.join(__dirname, 'painel-status-tipos-evidence') : path.resolve(process.env.PAINEL_EVIDENCIA_DIR);
fs.mkdirSync(OUT, { recursive: true });
/** Captura de falha nunca vai para a evidência versionada do dev. */
const ARQUIVO_FALHA = DEV ? path.join(os.tmpdir(), 'painel-status-tipos-final.png') : path.join(OUT, 'final.png');

const ICONE_DO_TOM = { success: 'check', warning: 'incident', danger: 'close', muted: 'minus', info: 'wrench' };
const TOM_DO_ROTULO = { 'Disponível': 'success', 'Degradada': 'warning', 'Indisponível': 'danger', 'Sem dados': 'muted', 'Sem equipamentos': 'muted', 'Em manutenção': 'info' };

/** Fatos do banco de dev. */
const TIPOS_DEV = ['Todos', 'Access Point', 'Câmera', 'Firewall', 'Impressora', 'Nobreak', 'Router', 'Servidor', 'Storage', 'Switch'];
/** Fatos do banco da carga: Sede = Access Point + Servidor; Sesc Itabaiana = Roteador. */
const CARGA = {
  abas: ['Todos', 'Access Point', 'Roteador', 'Servidor'],
  semFiltro: { Todos: 3, 'Access Point': 1, Roteador: 1, Servidor: 1 },
  busca: { termo: 'Itabaiana', unidades: ['Sesc Itabaiana'], contagens: { Todos: 1, 'Access Point': 0, Roteador: 1, Servidor: 0 } },
};

const resultados = [];
const checar = (caso, nome, ok, detalhe) => { resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' }); };
/** Registro que não prova nada por construção: fica no JSON, fora da contagem de aprovações. */
const informar = (caso, nome, detalhe) => { resultados.push({ caso, nome, ok: null, informativo: true, detalhe: detalhe ?? '' }); };
const rede = [];
const capturas = [];
const erros = [];
const medidas = {};

/** Leitura de todas as linhas visíveis: tons, ícone, badge, chip e faixa. */
const lerLinhas = (page) => page.evaluate(() => {
  const tomDe = (el, prefixo) => {
    if (!el) return null;
    const classe = [...el.classList].find((c) => c.startsWith(prefixo + '--'));
    return classe ? classe.slice(prefixo.length + 2) : null;
  };
  const caixa = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  return [...document.querySelectorAll('.tabela .unidade')].map((linha) => {
    const marca = linha.querySelector('.marca');
    const icone = marca?.querySelector('[data-icone]');
    const svg = icone?.querySelector('svg');
    const badge = linha.querySelector('app-status-badge .badge');
    const chip = linha.querySelector('.chip-manutencao');
    const chipTexto = chip?.querySelector('.chip-manutencao__texto');
    const faixa = linha.querySelector('.faixa');
    const faixaVisivel = !!faixa && getComputedStyle(faixa).display !== 'none' && faixa.getBoundingClientRect().width > 0;
    const caixaIcone = caixa(icone); const caixaSvg = caixa(svg);
    return {
      nome: (linha.querySelector('.linha__nome strong')?.textContent ?? '').trim(),
      tomLinha: tomDe(linha, 'unidade'),
      tomMarca: tomDe(marca, 'marca'),
      tomBadge: tomDe(badge, 'badge'),
      badgeTexto: (badge?.textContent ?? '').trim(),
      icone: icone?.getAttribute('data-icone') ?? null,
      iconeLado: Math.min(Math.max(caixaIcone?.w ?? 0, caixaSvg?.w ?? 0), Math.max(caixaIcone?.h ?? 0, caixaSvg?.h ?? 0)),
      chip: chip ? {
        texto: (chipTexto?.textContent ?? '').trim(),
        caixa: caixa(chip),
        scrollW: chip.scrollWidth, clientW: chip.clientWidth,
        textoScrollW: chipTexto?.scrollWidth ?? null, textoClientW: chipTexto?.clientWidth ?? null,
      } : null,
      faixa: faixaVisivel ? caixa(faixa) : null,
      // Largura renderizada de cada segmento da composição (px); só faz sentido com a faixa visível.
      segmentos: faixaVisivel ? Object.fromEntries(['ok', 'warn', 'info', 'down'].map((s) => [s, faixa.querySelector('.faixa__' + s)?.getBoundingClientRect().width ?? null])) : null,
      contagens: Object.fromEntries(['ok', 'warn', 'info', 'down'].map((s) => [s, linha.querySelector('.contagens .' + s)?.textContent.trim() ?? null])),
    };
  });
});

const intersecta = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Tom, rótulo, ícone e chip aplicados a um conjunto de linhas. */
function verificarLinhas(prefixo, linhas, { larguraTotal }) {
  const divergentes = linhas.filter((l) => !l.tomLinha || l.tomLinha !== l.tomMarca || l.tomMarca !== l.tomBadge);
  checar(`${prefixo}.1`, 'tom da linha == tom da marca == tom do badge, em toda linha', linhas.length > 0 && divergentes.length === 0,
    `${linhas.length} linhas; divergentes=${JSON.stringify(divergentes.map((l) => [l.nome, l.tomLinha, l.tomMarca, l.tomBadge]))}`);
  const rotuloErrado = linhas.filter((l) => TOM_DO_ROTULO[l.badgeTexto] !== l.tomBadge);
  checar(`${prefixo}.1b`, 'rótulo do badge corresponde ao tom (Disponível→success, Degradada→warning, Indisponível→danger, Sem dados/Sem equipamentos→muted, Em manutenção→info)',
    linhas.length > 0 && rotuloErrado.length === 0, JSON.stringify(rotuloErrado.map((l) => [l.nome, l.badgeTexto, l.tomBadge])));
  const iconeErrado = linhas.filter((l) => l.icone !== ICONE_DO_TOM[l.tomLinha]);
  checar(`${prefixo}.2`, 'ícone da marca é o do tom (check|incident|close|minus|wrench)', linhas.length > 0 && iconeErrado.length === 0,
    JSON.stringify(iconeErrado.map((l) => [l.nome, l.tomLinha, l.icone])));
  const pequenos = linhas.filter((l) => l.iconeLado < 14);
  checar(`${prefixo}.3`, 'ícone da marca com caixa >= 14px', linhas.length > 0 && pequenos.length === 0,
    `menor=${Math.min(...linhas.map((l) => l.iconeLado))}px; abaixo=${JSON.stringify(pequenos.map((l) => [l.nome, l.iconeLado]))}`);

  const comChip = linhas.filter((l) => l.chip);
  const comChipEFaixa = comChip.filter((l) => l.faixa);
  const nome4 = 'chip de manutenção não intersecta a faixa da mesma linha';
  if (comChipEFaixa.length === 0) {
    informar(`${prefixo}.4`, nome4, `vazia por construção: ${comChip.length} chips, faixa visível em 0`);
  } else {
    const encostam = comChipEFaixa.filter((l) => intersecta(l.chip.caixa, l.faixa));
    checar(`${prefixo}.4`, nome4, encostam.length === 0,
      `${comChipEFaixa.length} chips com faixa visível; encostam=${JSON.stringify(encostam.map((l) => l.nome))}`);
  }
  if (larguraTotal) {
    const nome5 = 'chip não corta texto na largura total (scrollWidth <= clientWidth+1)';
    if (comChip.length === 0) {
      informar(`${prefixo}.5`, nome5, 'vazia por construção: nenhum chip');
    } else {
      const cortados = comChip.filter((l) => l.chip.scrollW > l.chip.clientW + 1 || (l.chip.textoScrollW ?? 0) > (l.chip.textoClientW ?? 0) + 1);
      checar(`${prefixo}.5`, nome5, cortados.length === 0,
        JSON.stringify(comChip.map((l) => [l.nome, l.chip.texto, `${l.chip.scrollW}/${l.chip.clientW}`, `${l.chip.textoScrollW}/${l.chip.textoClientW}`])));
    }
  }
}

const lerAbas = (page) => page.evaluate(() => ({
  abas: [...document.querySelectorAll('.abas .aba')].map((b) => ({
    rotulo: [...b.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim(),
    contagem: b.querySelector('.aba__contagem') ? Number(b.querySelector('.aba__contagem').textContent.trim()) : null,
    desabilitada: b.disabled,
    ativa: b.classList.contains('aba--ativa'),
  })),
  // null = sem aviso; '' = aviso presente mas vazio (tem de falhar, não pode passar por "índice completo")
  parcial: document.querySelector('.abas__parcial') ? document.querySelector('.abas__parcial').textContent.trim() : null,
  linhas: document.querySelectorAll('.tabela .unidade').length,
  contagemTexto: document.querySelector('.contagem')?.textContent.trim() ?? null,
}));

/** Índice parcial e contadores são exclusivos; com contadores, Todos == soma e desabilitada <=> 0. */
function verificarAbas(prefixo, estado) {
  const comContagem = estado.abas.filter((a) => a.contagem !== null);
  if (estado.parcial !== null) {
    checar(`${prefixo}.a`, 'índice parcial: aviso presente, com texto, e NENHUMA aba com contador', estado.parcial.length > 0 && comContagem.length === 0,
      `parcial="${estado.parcial}"; abas com contador=${comContagem.length}`);
    return;
  }
  const tipos = estado.abas.filter((a) => a.rotulo !== 'Todos');
  const todos = estado.abas.find((a) => a.rotulo === 'Todos');
  const soma = tipos.reduce((t, a) => t + (a.contagem ?? 0), 0);
  const desabNaoZero = estado.abas.filter((a) => a.desabilitada && a.contagem !== 0);
  const zeroHabilitada = tipos.filter((a) => a.contagem === 0 && !a.desabilitada && !a.ativa);
  checar(`${prefixo}.a`, 'índice completo: toda aba com contador, "Todos" == soma dos tipos, desabilitada <=> contagem 0',
    comContagem.length === estado.abas.length && todos?.contagem === soma && desabNaoZero.length === 0 && zeroHabilitada.length === 0,
    `Todos=${todos?.contagem} soma=${soma}; ${JSON.stringify(estado.abas.map((a) => [a.rotulo, a.contagem, a.desabilitada ? 'desab' : 'hab']))}`);
}

/** Contagens exatas esperadas por aba (carga). Aba com 0 tem de estar desabilitada. */
function verificarContagens(caso, nome, estado, esperado) {
  const lido = Object.fromEntries(estado.abas.map((a) => [a.rotulo, a.contagem]));
  const errado = Object.entries(esperado).filter(([rotulo, n]) => lido[rotulo] !== n);
  const zeroAtiva = estado.abas.filter((a) => esperado[a.rotulo] === 0 && !a.desabilitada);
  checar(caso, nome, estado.parcial === null && errado.length === 0 && zeroAtiva.length === 0,
    `lido=${JSON.stringify(estado.abas.map((a) => [a.rotulo, a.contagem, a.desabilitada ? 'desab' : 'hab']))}; parcial=${estado.parcial ?? 'não'}`);
}

/** Espera o texto "N de M unidades" refletir N — mesmo ciclo de detecção que redesenha as linhas. */
const esperarContagem = (page, n) => page.waitForFunction((esperado) => {
  const texto = document.querySelector('.contagem')?.textContent.trim() ?? '';
  return texto.startsWith(`${esperado} de `) && document.querySelectorAll('.tabela .unidade').length === esperado;
}, n, { timeout: 5000 });

const esperarFaixa = (page, visivel) => page.waitForFunction((v) => {
  const faixa = document.querySelector('.tabela .faixa');
  return !!faixa && (getComputedStyle(faixa).display !== 'none') === v;
}, visivel, { timeout: 5000 });

/** Troca o tema pelo botão da topbar (clique) e espera o `data-theme` do <html> refletir. */
async function alternarTema(page, alvo) {
  const atual = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (atual !== alvo) await page.locator('.theme-button').click();
  await page.waitForFunction((t) => document.documentElement.getAttribute('data-theme') === t, alvo, { timeout: 5000 });
}

async function capturar(alvo, nome) {
  await alvo.screenshot({ path: path.join(OUT, nome) });
  capturas.push(nome);
}

async function entrarNoPainel(page) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-senha', SENHA);
  await page.click('.login-submit');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
  await page.click('.navigation__item[href="/dashboard"]');
  await page.waitForURL(/\/dashboard$/, { timeout: 20000 });
  await page.waitForSelector('.tabela .unidade', { timeout: 30000 });
  // Abas prontas: catálogo carregado e índice resolvido (parcial ou com contador no "Todos").
  await page.waitForFunction(() => document.querySelectorAll('.abas .aba').length > 1
    && (document.querySelector('.abas__parcial') || document.querySelector('.abas .aba .aba__contagem')), null, { timeout: 30000 });
  await page.waitForLoadState('networkidle');
}

async function novaPagina(browser, rotulo) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => erros.push(`${rotulo} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') erros.push(`${rotulo} console: ${m.text()}`); });
  page.on('request', (r) => { if (r.url().startsWith(API)) rede.push(`${new Date().toISOString()} [${rotulo}] ${r.method()} ${r.url().replace(API, '')}`); });
  page.on('response', (r) => { if (r.url().startsWith(API) && r.status() >= 400) rede.push(`${new Date().toISOString()} [${rotulo}] HTTP ${r.status()} ${r.url().replace(API, '')}`); });
  return page;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let fatal = null;
  let page = null;
  try {
    /* ============================================================ dado real, sem interceptação */
    page = await novaPagina(browser, 'real');
    await entrarNoPainel(page);

    medidas.temaInicial = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    checar('tema.0', 'tema inicial claro (capturas 01-09 sem sufixo são do tema claro)', medidas.temaInicial === 'light', String(medidas.temaInicial));
    await capturar(page, '01-tela-inteira.png');
    await page.screenshot({ path: path.join(OUT, '01-tela-inteira-completa.png'), fullPage: true });
    capturas.push('01-tela-inteira-completa.png');

    const linhas = await lerLinhas(page);
    medidas.linhas1440 = linhas;
    verificarLinhas('1440', linhas, { larguraTotal: true });
    await capturar(page.locator('.tabela'), '02-linhas-reais.png');

    if (DEV) {
      checar('dev.1', 'dev: 11 unidades no painel', linhas.length === 11, `${linhas.length} linhas`);
      const atalaia = linhas.find((l) => l.nome === 'Hotel Sesc Atalaia');
      checar('dev.2', 'dev: Hotel Sesc Atalaia = success, ícone check, badge "Disponível", chip "1 em manutenção"',
        atalaia && atalaia.tomLinha === 'success' && atalaia.icone === 'check' && atalaia.badgeTexto === 'Disponível'
        && atalaia.chip?.texto === '1 em manutenção', JSON.stringify(atalaia));
      checar('dev.2b', 'dev: Atalaia — manutenção é segmento info, não warning (faixa__warn 0, faixa__info > 0; contagens warn 0, info 1)',
        atalaia?.segmentos && atalaia.segmentos.warn === 0 && atalaia.segmentos.info > 0 && atalaia.contagens.warn === '0' && atalaia.contagens.info === '1',
        JSON.stringify({ segmentos: atalaia?.segmentos, contagens: atalaia?.contagens }));
      await capturar(page.locator('.tabela .unidade', { hasText: 'Hotel Sesc Atalaia' }), '03-linha-atalaia.png');
    }

    // --------------------------------------------------------------- tema escuro (linhas reais)
    await alternarTema(page, 'dark');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 });
    await capturar(page, '01-tela-inteira-escuro.png');
    await capturar(page.locator('.tabela'), '02-linhas-reais-escuro.png');
    if (DEV) await capturar(page.locator('.tabela .unidade', { hasText: 'Hotel Sesc Atalaia' }), '03-linha-atalaia-escuro.png');
    await alternarTema(page, 'light');

    // --------------------------------------------------------------- abas sem filtro
    const abasSemFiltro = await lerAbas(page);
    medidas.abasSemFiltro = abasSemFiltro;
    verificarAbas('abas.semFiltro', abasSemFiltro);
    const rotulos = abasSemFiltro.abas.map((a) => a.rotulo);
    if (DEV) {
      // Catálogo do dev: 9 tipos ativos, 8 com equipamento + "Storage" sem nenhum (aba ativa conta, mesmo vazia).
      checar('dev.3', 'dev: "Todos" + os 9 tipos ativos do catálogo, em ordem, todos SEM contador e nenhum desabilitado',
        JSON.stringify(rotulos) === JSON.stringify(TIPOS_DEV) && abasSemFiltro.abas.every((a) => a.contagem === null && !a.desabilitada),
        JSON.stringify(rotulos));
      checar('dev.4', 'dev: aviso de índice parcial cobre filtro e contagem, "100 de 221"',
        !!abasSemFiltro.parcial && /^Filtro e contagem por tipo consideram só 100 de 221 equipamentos.$/.test(abasSemFiltro.parcial),
        abasSemFiltro.parcial ?? '(sem aviso)');
    } else {
      checar('carga.1', 'carga: abas = Todos, Access Point, Roteador, Servidor (inclui "Servidor" e "Roteador")',
        JSON.stringify(rotulos) === JSON.stringify(CARGA.abas), JSON.stringify(rotulos));
      checar('carga.2', 'carga: índice completo — sem aviso parcial e toda aba com contador',
        abasSemFiltro.parcial === null && abasSemFiltro.abas.every((a) => a.contagem !== null), `parcial=${abasSemFiltro.parcial ?? 'não'}`);
      verificarContagens('carga.3', 'carga sem filtro: Todos 3, Access Point 1, Roteador 1, Servidor 1', abasSemFiltro, CARGA.semFiltro);
    }
    await capturar(page.locator('.filtros'), '04-abas-sem-filtro.png');

    // --------------------------------------------------------------- pill de status
    const degradadas = linhas.filter((l) => l.badgeTexto === 'Degradada');
    if (DEV) checar('pill.0', 'dev: há unidades Degradada para a pill provar algo', degradadas.length > 0, `${degradadas.length}`);
    const [pillRotulo, pillBadge] = degradadas.length > 0 ? ['Degradado', 'Degradada'] : ['Online', 'Disponível'];
    const esperadasPill = linhas.filter((l) => l.badgeTexto === pillBadge);
    await page.locator('.pills .pill', { hasText: new RegExp(`^\\s*${pillRotulo}\\s*$`) }).click();
    await page.waitForFunction((r) => document.querySelector('.pills .pill--ativa')?.textContent.trim() === r, pillRotulo, { timeout: 5000 });
    await esperarContagem(page, esperadasPill.length);
    const abasPill = await lerAbas(page);
    medidas.abasPill = { pill: pillRotulo, ...abasPill };
    verificarAbas('abas.pill', abasPill);
    const linhasPill = await lerLinhas(page);
    checar('pill.1', `pill "${pillRotulo}": ao menos uma linha, e todas com badge "${pillBadge}"`,
      linhasPill.length > 0 && linhasPill.every((l) => l.badgeTexto === pillBadge),
      `${linhasPill.length} linhas: ${JSON.stringify(linhasPill.map((l) => [l.nome, l.badgeTexto]))}`);
    checar('pill.2', `pill "${pillRotulo}": exatamente as unidades "${pillBadge}" da visão sem filtro`,
      linhasPill.length > 0 && JSON.stringify(linhasPill.map((l) => l.nome)) === JSON.stringify(esperadasPill.map((l) => l.nome)),
      JSON.stringify(esperadasPill.map((l) => l.nome)));
    await capturar(page.locator('.filtros'), DEV ? '05-abas-pill-degradado.png' : '05-abas-pill.png');
    await page.locator('.pills .pill', { hasText: /^\s*Todos\s*$/ }).click();
    await esperarContagem(page, linhas.length);

    // --------------------------------------------------------------- busca por texto
    const termo = DEV ? 'Hotel' : CARGA.busca.termo;
    const esperadasBusca = DEV ? ['Hotel Sesc Atalaia'] : CARGA.busca.unidades;
    await page.fill('.filtros__busca input', termo);
    await esperarContagem(page, esperadasBusca.length);
    const abasBusca = await lerAbas(page);
    medidas.abasBusca = { termo, ...abasBusca };
    verificarAbas('abas.busca', abasBusca);
    const linhasBusca = await lerLinhas(page);
    checar('busca.1', `busca "${termo}": exatamente ${JSON.stringify(esperadasBusca)}`,
      JSON.stringify(linhasBusca.map((l) => l.nome)) === JSON.stringify(esperadasBusca), JSON.stringify(linhasBusca.map((l) => l.nome)));
    if (!DEV) verificarContagens('carga.4', `carga busca "${termo}" (1 unidade): Roteador 1, Access Point e Servidor 0 e desabilitadas`,
      abasBusca, CARGA.busca.contagens);
    await capturar(page.locator('.filtros'), '06-abas-busca.png');
    await page.fill('.filtros__busca input', '');
    await esperarContagem(page, linhas.length);

    // --------------------------------------------------------------- 860px
    await page.setViewportSize({ width: 860, height: 900 });
    await esperarFaixa(page, false);
    const linhas860 = await lerLinhas(page);
    medidas.linhas860 = linhas860;
    verificarLinhas('860', linhas860, { larguraTotal: false });
    const chips860 = linhas860.filter((l) => l.chip).map((l) => ({
      nome: l.nome, texto: l.chip.texto,
      reticencias: (l.chip.textoScrollW ?? 0) > (l.chip.textoClientW ?? 0) + 1 || l.chip.scrollW > l.chip.clientW + 1,
      chip: `${l.chip.scrollW}/${l.chip.clientW}`, textoPx: `${l.chip.textoScrollW}/${l.chip.textoClientW}`,
    }));
    medidas.chips860 = chips860;
    informar('860.r', '860px: reticências no chip (registro)', JSON.stringify(chips860));
    await capturar(page.locator('.tabela'), '07-linhas-860.png');
    await page.setViewportSize({ width: 1440, height: 900 });
    await esperarFaixa(page, true);

    checar('erros.real', 'nenhum erro de página no roteiro com dado real', erros.length === 0, erros.join(' | '));
    await page.close();
    page = null;

    /* ============================================================ captura sintética (interceptada) */
    const errosAntes = erros.length;
    page = await novaPagina(browser, 'sintetico');
    await page.route(API + '/dashboard/unidades', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const resposta = await route.fetch();
      const reais = await resposta.json();
      const base = reais[0];
      const sintetica = (id, nome, status, c) => ({
        ...base, id, nome, status, conectaAUnidadeId: null,
        equipamentosTotal: 0, equipamentosAtivos: 0, equipamentosDisponiveis: 0, equipamentosDegradados: 0,
        equipamentosIndisponiveis: 0, equipamentosSemDados: 0, equipamentosSemMonitoramento: 0, equipamentosEmManutencao: 0,
        incidentesAbertos: 0, ...c,
      });
      const extras = [
        sintetica(990001, '[sintético] Indisponível', 'INDISPONIVEL', { equipamentosTotal: 3, equipamentosAtivos: 3, equipamentosDisponiveis: 1, equipamentosIndisponiveis: 2, incidentesAbertos: 2 }),
        sintetica(990002, '[sintético] Sem dados', 'SEM_DADOS', { equipamentosTotal: 2, equipamentosAtivos: 2, equipamentosSemDados: 2 }),
        sintetica(990003, '[sintético] Em manutenção', 'EM_MANUTENCAO', { equipamentosTotal: 2, equipamentosAtivos: 2, equipamentosEmManutencao: 2 }),
        sintetica(990004, '[sintético] Sem equipamentos', 'SEM_EQUIPAMENTOS', {}),
      ];
      await route.fulfill({ response: resposta, json: [...reais, ...extras] });
    });
    await entrarNoPainel(page);
    const linhasSint = (await lerLinhas(page)).filter((l) => l.nome.startsWith('[sintético]'));
    medidas.linhasSinteticas = linhasSint;
    checar('sint.0', 'sintético: as 4 linhas injetadas aparecem', linhasSint.length === 4, JSON.stringify(linhasSint.map((l) => l.nome)));
    verificarLinhas('sint', linhasSint, { larguraTotal: true });
    const esperado = { '[sintético] Indisponível': ['danger', 'close', 'Indisponível'], '[sintético] Sem dados': ['muted', 'minus', 'Sem dados'],
      '[sintético] Em manutenção': ['info', 'wrench', 'Em manutenção'], '[sintético] Sem equipamentos': ['muted', 'minus', 'Sem equipamentos'] };
    const foraDoEsperado = linhasSint.filter((l) => { const e = esperado[l.nome]; return !e || l.tomLinha !== e[0] || l.icone !== e[1] || l.badgeTexto !== e[2]; });
    checar('sint.6', 'sintético: tom/ícone/badge = danger/close, muted/minus, info/wrench, muted/minus', linhasSint.length === 4 && foraDoEsperado.length === 0,
      JSON.stringify(linhasSint.map((l) => [l.nome, l.tomLinha, l.icone, l.badgeTexto])));
    checar('sint.7', 'sintético: "Em manutenção" total não ganha chip (manutenção é o próprio status)',
      linhasSint.find((l) => l.nome === '[sintético] Em manutenção')?.chip === null, '');
    const manutencaoSint = linhasSint.find((l) => l.nome === '[sintético] Em manutenção');
    checar('sint.8', 'sintético: "Em manutenção" tem faixa só info (info > 0, warn 0) e contador info 2, warn 0',
      manutencaoSint?.segmentos && manutencaoSint.segmentos.info > 0 && manutencaoSint.segmentos.warn === 0
      && manutencaoSint.contagens.info === '2' && manutencaoSint.contagens.warn === '0',
      JSON.stringify({ segmentos: manutencaoSint?.segmentos, contagens: manutencaoSint?.contagens }));
    // Recorte só das 4 linhas sintéticas, em coordenadas da PÁGINA (fullPage + clip): o clique no botão de
    // tema rola a página para o topo, e um clip relativo à viewport recortaria as linhas erradas.
    const recorteSintetico = () => page.evaluate(() => {
      const rs = [...document.querySelectorAll('.tabela .unidade')].filter((e) => e.textContent.includes('[sintético]')).map((e) => e.getBoundingClientRect());
      const x = Math.min(...rs.map((r) => r.x)); const y = Math.min(...rs.map((r) => r.y));
      return { x: x + scrollX, y: y + scrollY, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.max(...rs.map((r) => r.bottom)) - y };
    });
    await page.screenshot({ path: path.join(OUT, '08-linhas-sintetico.png'), fullPage: true, clip: await recorteSintetico() });
    capturas.push('08-linhas-sintetico.png');
    await alternarTema(page, 'dark');
    await page.screenshot({ path: path.join(OUT, '08-linhas-sintetico-escuro.png'), fullPage: true, clip: await recorteSintetico() });
    capturas.push('08-linhas-sintetico-escuro.png');
    await alternarTema(page, 'light');
    await page.screenshot({ path: path.join(OUT, '09-tabela-com-sintetico.png'), fullPage: true });
    capturas.push('09-tabela-com-sintetico.png');
    checar('erros.sint', 'nenhum erro de página na passada sintética', erros.length === errosAntes, erros.slice(errosAntes).join(' | '));
  } catch (erro) {
    fatal = erro;
  } finally {
    if (page && fatal) {
      try {
        await page.screenshot({ path: ARQUIVO_FALHA });
        console.error(`captura da falha em ${ARQUIVO_FALHA}`);
      } catch (erroCaptura) {
        console.error(`não foi possível capturar a tela da falha: ${erroCaptura.message}`);
        erros.push(`captura da falha: ${erroCaptura.message}`);
      }
    }
    const resumo = {
      banco: BANCO, quando: new Date().toISOString(), viewport: '1440x900 (+860x900)',
      ok: !fatal && resultados.every((r) => r.informativo || r.ok), resultados, capturas, medidas, erros, rede,
      fatal: fatal ? String(fatal.stack ?? fatal) : null,
    };
    fs.writeFileSync(path.join(OUT, 'painel-status-tipos.json'), JSON.stringify(resumo, null, 2));
    await browser.close();
  }

  for (const r of resultados) {
    const marca = r.informativo ? 'INFO ' : r.ok ? 'OK   ' : 'FALHA';
    console.log(`${marca} [${r.caso}] ${r.nome}${r.detalhe ? ' — ' + r.detalhe.slice(0, 400) : ''}`);
  }
  const provas = resultados.filter((r) => !r.informativo);
  const falhas = provas.filter((r) => !r.ok).length;
  console.log(`\n[${BANCO}] ${provas.length - falhas}/${provas.length} verificacoes (+${resultados.length - provas.length} informativas); evidência em ${OUT}`);
  if (fatal) {
    console.error('\nEXECUÇÃO INTERROMPIDA — log em ' + path.join(OUT, 'painel-status-tipos.json'));
    console.error(fatal.stack ?? fatal);
    process.exit(2);
  }
  process.exit(falhas ? 1 : 0);
})();

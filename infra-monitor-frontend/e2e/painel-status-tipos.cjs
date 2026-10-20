/*
 * Painel — status coerente por unidade (barra, marca e badge) e abas de tipo, ponta a ponta.
 *
 *   npm run e2e:painel      (exige PAINEL_EMAIL e PAINEL_SENHA no ambiente)
 *
 *   PAINEL_BANCO=dev    (padrão) asserções específicas do banco de dev; evidência em e2e/painel-status-tipos-evidence/
 *   PAINEL_BANCO=carga  asserções genéricas + abas "Servidor" e "Roteador"; evidência em PAINEL_EVIDENCIA_DIR
 *                       (obrigatório — a evidência da carga fica fora do repositório)
 *
 * Pré-requisitos: `ng serve` em 4200 e a API desta branch em 8080. Roteiro somente de leitura.
 *
 * O QUE ESTE ROTEIRO PROVA:
 *  1. Para cada linha `.unidade`: tom de `unidade--*` == tom de `marca--*` == tom do `.badge--*` do
 *     `app-status-badge`, e o ícone da marca (`data-icone`) é o do tom, com caixa >= 14px.
 *  2. O chip `.chip-manutencao` não encosta na `.faixa` da mesma linha e não corta texto a 1440px.
 *     A 860px registra se as reticências entraram (permitido só quando não cabe).
 *  3. Abas de tipo: sem filtro, com a pill "Degradado" e com busca por texto. Índice parcial
 *     (`.abas__parcial`) e contadores (`.aba__contagem`) são mutuamente exclusivos.
 *  4. Status ausentes nos dados reais (INDISPONIVEL, SEM_DADOS, EM_MANUTENCAO, SEM_EQUIPAMENTOS)
 *     numa captura SEPARADA, com 4 linhas "[sintético]" injetadas por `page.route` em
 *     GET /dashboard/unidades. As capturas de dado real nunca usam interceptação.
 *
 * ARMADILHAS herdadas (não reintroduzir):
 *  - Sessão só em memória: page.goto pós-login cai em /login. Toda navegação é por clique.
 *  - Nada de catch silencioso em seletor.
 *  - Log de rede e resultados gravados em `finally`.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');

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

const ICONE_DO_TOM = { success: 'check', warning: 'incident', danger: 'close', muted: 'minus', info: 'wrench' };

const resultados = [];
const checar = (caso, nome, ok, detalhe) => { resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' }); };
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
    };
  });
});

const intersecta = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Caso 1-3 aplicados a um conjunto de linhas. */
function verificarLinhas(prefixo, linhas, { larguraTotal }) {
  const divergentes = linhas.filter((l) => !l.tomLinha || l.tomLinha !== l.tomMarca || l.tomMarca !== l.tomBadge);
  checar(`${prefixo}.1`, 'tom da linha == tom da marca == tom do badge, em toda linha', linhas.length > 0 && divergentes.length === 0,
    `${linhas.length} linhas; divergentes=${JSON.stringify(divergentes.map((l) => [l.nome, l.tomLinha, l.tomMarca, l.tomBadge]))}`);
  const iconeErrado = linhas.filter((l) => l.icone !== ICONE_DO_TOM[l.tomLinha]);
  checar(`${prefixo}.2`, 'ícone da marca é o do tom (check|incident|close|minus|wrench)', iconeErrado.length === 0,
    JSON.stringify(iconeErrado.map((l) => [l.nome, l.tomLinha, l.icone])));
  const pequenos = linhas.filter((l) => l.iconeLado < 14);
  checar(`${prefixo}.3`, 'ícone da marca com caixa >= 14px', pequenos.length === 0,
    `menor=${Math.min(...linhas.map((l) => l.iconeLado))}px; abaixo=${JSON.stringify(pequenos.map((l) => [l.nome, l.iconeLado]))}`);
  const comChip = linhas.filter((l) => l.chip);
  const encostam = comChip.filter((l) => l.faixa && intersecta(l.chip.caixa, l.faixa));
  checar(`${prefixo}.4`, 'chip de manutenção não intersecta a faixa da mesma linha', encostam.length === 0,
    `${comChip.length} chips; faixa visível em ${comChip.filter((l) => l.faixa).length}; encostam=${JSON.stringify(encostam.map((l) => l.nome))}`);
  if (larguraTotal) {
    const cortados = comChip.filter((l) => l.chip.scrollW > l.chip.clientW + 1 || (l.chip.textoScrollW ?? 0) > (l.chip.textoClientW ?? 0) + 1);
    checar(`${prefixo}.5`, 'chip não corta texto na largura total (scrollWidth <= clientWidth+1)', cortados.length === 0,
      JSON.stringify(comChip.map((l) => [l.nome, l.chip.texto, `${l.chip.scrollW}/${l.chip.clientW}`, `${l.chip.textoScrollW}/${l.chip.textoClientW}`])));
  }
}

const lerAbas = (page) => page.evaluate(() => ({
  abas: [...document.querySelectorAll('.abas .aba')].map((b) => ({
    rotulo: [...b.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim(),
    contagem: b.querySelector('.aba__contagem') ? Number(b.querySelector('.aba__contagem').textContent.trim()) : null,
    desabilitada: b.disabled,
    ativa: b.classList.contains('aba--ativa'),
  })),
  parcial: document.querySelector('.abas__parcial')?.textContent.trim() ?? null,
  linhas: document.querySelectorAll('.tabela .unidade').length,
  contagemTexto: document.querySelector('.contagem')?.textContent.trim() ?? null,
}));

/** Índice parcial e contadores são exclusivos; com contadores, aba desabilitada só com 0. */
function verificarAbas(prefixo, estado) {
  const comContagem = estado.abas.filter((a) => a.contagem !== null);
  if (estado.parcial) {
    checar(`${prefixo}.a`, 'índice parcial: aviso presente e NENHUMA aba com contador', comContagem.length === 0,
      `parcial="${estado.parcial}"; abas com contador=${comContagem.length}`);
  } else {
    const desabNaoZero = estado.abas.filter((a) => a.desabilitada && a.contagem !== 0);
    const zeroHabilitada = estado.abas.filter((a) => a.contagem === 0 && !a.desabilitada && !a.ativa && a.rotulo !== 'Todos');
    checar(`${prefixo}.a`, 'índice completo: toda aba com contador; desabilitada <=> contagem 0',
      comContagem.length === estado.abas.length && desabNaoZero.length === 0 && zeroHabilitada.length === 0,
      JSON.stringify(estado.abas.map((a) => [a.rotulo, a.contagem, a.desabilitada ? 'desab' : 'hab'])));
  }
}

async function capturar(alvo, nome) {
  const arquivo = path.join(OUT, nome);
  await alvo.screenshot({ path: arquivo });
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
  await page.waitForTimeout(800);
}

function novaPagina(browser, rotulo) {
  return browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }).then((page) => {
    page.on('pageerror', (e) => erros.push(`${rotulo} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') erros.push(`${rotulo} console: ${m.text()}`); });
    page.on('request', (r) => { if (r.url().startsWith(API)) rede.push(`${new Date().toISOString()} [${rotulo}] ${r.method()} ${r.url().replace(API, '')}`); });
    page.on('response', (r) => { if (r.url().startsWith(API) && r.status() >= 400) rede.push(`${new Date().toISOString()} [${rotulo}] HTTP ${r.status()} ${r.url().replace(API, '')}`); });
    return page;
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let fatal = null;
  let page = null;
  try {
    /* ============================================================ dado real, sem interceptação */
    page = await novaPagina(browser, 'real');
    await entrarNoPainel(page);

    await capturar(page, '01-tela-inteira.png');
    await page.screenshot({ path: path.join(OUT, '01-tela-inteira-completa.png'), fullPage: true });
    capturas.push('01-tela-inteira-completa.png');

    const linhas = await lerLinhas(page);
    medidas.linhas1440 = linhas;
    verificarLinhas('1440', linhas, { larguraTotal: true });
    await capturar(page.locator('.tabela'), '02-linhas-reais.png');

    const statusVistos = [...new Set(linhas.map((l) => l.badgeTexto))];
    if (DEV) {
      checar('dev.1', 'dev: 11 unidades no painel', linhas.length === 11, `${linhas.length} linhas`);
      const atalaia = linhas.find((l) => l.nome === 'Hotel Sesc Atalaia');
      checar('dev.2', 'dev: Hotel Sesc Atalaia = success, ícone check, badge "Disponível", chip "1 em manutenção"',
        atalaia && atalaia.tomLinha === 'success' && atalaia.icone === 'check' && atalaia.badgeTexto === 'Disponível'
        && atalaia.chip?.texto === '1 em manutenção', JSON.stringify(atalaia));
      await capturar(page.locator('.tabela .unidade', { hasText: 'Hotel Sesc Atalaia' }), '03-linha-atalaia.png');
    }

    // --------------------------------------------------------------- abas sem filtro
    const abasSemFiltro = await lerAbas(page);
    medidas.abasSemFiltro = abasSemFiltro;
    verificarAbas('abas.semFiltro', abasSemFiltro);
    const rotulos = abasSemFiltro.abas.map((a) => a.rotulo);
    if (DEV) {
      // Catálogo do dev: 9 tipos ativos, 8 com equipamento + "Storage" sem nenhum (aba ativa conta, mesmo vazia).
      const TIPOS_DEV = ['Todos', 'Access Point', 'Câmera', 'Firewall', 'Impressora', 'Nobreak', 'Router', 'Servidor', 'Storage', 'Switch'];
      checar('dev.3', 'dev: "Todos" + os 9 tipos ativos do catálogo, em ordem, todos SEM contador e nenhum desabilitado',
        JSON.stringify(rotulos) === JSON.stringify(TIPOS_DEV) && abasSemFiltro.abas.every((a) => a.contagem === null && !a.desabilitada),
        JSON.stringify(rotulos));
      checar('dev.4', 'dev: aviso de índice parcial "100 de 221"', !!abasSemFiltro.parcial && /100 de 221/.test(abasSemFiltro.parcial),
        abasSemFiltro.parcial ?? '(sem aviso)');
    } else {
      checar('carga.1', 'carga: abas incluem "Servidor" e "Roteador"', rotulos.includes('Servidor') && rotulos.includes('Roteador'), JSON.stringify(rotulos));
    }
    await capturar(page.locator('.filtros'), '04-abas-sem-filtro.png');

    // --------------------------------------------------------------- pill "Degradado"
    await page.locator('.pills .pill', { hasText: /^\s*Degradado\s*$/ }).click();
    await page.waitForFunction(() => document.querySelector('.pills .pill--ativa')?.textContent.trim() === 'Degradado', null, { timeout: 5000 });
    await page.waitForTimeout(300);
    const abasDegradado = await lerAbas(page);
    medidas.abasDegradado = abasDegradado;
    verificarAbas('abas.degradado', abasDegradado);
    const linhasDegradado = await lerLinhas(page);
    checar('pill.1', 'pill "Degradado": só linhas de tom warning (DEGRADADA)', linhasDegradado.every((l) => l.tomLinha === 'warning' && l.badgeTexto === 'Degradada'),
      `${linhasDegradado.length} linhas: ${JSON.stringify(linhasDegradado.map((l) => [l.nome, l.badgeTexto]))}`);
    checar('pill.2', 'pill "Degradado": quantidade de linhas == linhas Degradada sem filtro',
      linhasDegradado.length === linhas.filter((l) => l.badgeTexto === 'Degradada').length, `${linhasDegradado.length}`);
    await capturar(page.locator('.filtros'), '05-abas-pill-degradado.png');
    await page.locator('.pills .pill', { hasText: /^\s*Todos\s*$/ }).click();
    await page.waitForFunction((n) => document.querySelectorAll('.tabela .unidade').length === n, linhas.length, { timeout: 5000 });

    // --------------------------------------------------------------- busca por texto
    const termo = DEV ? 'Hotel' : linhas[0].nome.split(/\s+/)[0];
    await page.fill('.filtros__busca input', termo);
    await page.waitForTimeout(500);
    const abasBusca = await lerAbas(page);
    medidas.abasBusca = { termo, ...abasBusca };
    verificarAbas('abas.busca', abasBusca);
    const linhasBusca = await lerLinhas(page);
    const nomesComTermo = linhas.filter((l) => l.nome.toLowerCase().includes(termo.toLowerCase())).map((l) => l.nome);
    checar('busca.1', `busca "${termo}": toda unidade cujo nome casa continua visível, e a lista encolhe ou se mantém`,
      nomesComTermo.length > 0 && nomesComTermo.every((n) => linhasBusca.some((l) => l.nome === n)) && linhasBusca.length <= linhas.length,
      `${linhasBusca.length} linhas: ${JSON.stringify(linhasBusca.map((l) => l.nome))}`);
    await capturar(page.locator('.filtros'), '06-abas-busca.png');
    await page.fill('.filtros__busca input', '');
    await page.waitForFunction((n) => document.querySelectorAll('.tabela .unidade').length === n, linhas.length, { timeout: 5000 });

    // --------------------------------------------------------------- 860px
    await page.setViewportSize({ width: 860, height: 900 });
    await page.waitForTimeout(600);
    const linhas860 = await lerLinhas(page);
    medidas.linhas860 = linhas860;
    verificarLinhas('860', linhas860, { larguraTotal: false });
    const chips860 = linhas860.filter((l) => l.chip).map((l) => ({
      nome: l.nome, texto: l.chip.texto,
      reticencias: (l.chip.textoScrollW ?? 0) > (l.chip.textoClientW ?? 0) + 1 || l.chip.scrollW > l.chip.clientW + 1,
      chip: `${l.chip.scrollW}/${l.chip.clientW}`, texto_: `${l.chip.textoScrollW}/${l.chip.textoClientW}`,
    }));
    medidas.chips860 = chips860;
    checar('860.r', '860px: registro de reticências no chip (informativo)', true, JSON.stringify(chips860));
    await capturar(page.locator('.tabela'), '07-linhas-860.png');
    await page.setViewportSize({ width: 1440, height: 900 });

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
        ...base, id, nome, status, codigoIbge: base.codigoIbge, conectaAUnidadeId: null,
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
    checar('sint.6', 'sintético: tom/ícone/badge = danger/close, muted/minus, info/wrench, muted/minus', foraDoEsperado.length === 0,
      JSON.stringify(linhasSint.map((l) => [l.nome, l.tomLinha, l.icone, l.badgeTexto])));
    checar('sint.7', 'sintético: "Em manutenção" total não ganha chip (manutenção é o próprio status)',
      linhasSint.find((l) => l.nome === '[sintético] Em manutenção')?.chip === null, '');
    // Recorte só das 4 linhas sintéticas: rolagem até elas e clip pela união das caixas.
    await page.locator('.tabela .unidade', { hasText: '[sintético] Indisponível' }).scrollIntoViewIfNeeded();
    const clip = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.tabela .unidade')].filter((e) => e.textContent.includes('[sintético]'));
      const rs = els.map((e) => e.getBoundingClientRect());
      const cab = document.querySelector('.tabela__cabecalho').getBoundingClientRect();
      const x = Math.min(...rs.map((r) => r.x)); const y = Math.min(...rs.map((r) => r.y));
      return { x, y, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.max(...rs.map((r) => r.bottom)) - y, cab: cab.width };
    });
    await page.screenshot({ path: path.join(OUT, '08-linhas-sintetico.png'), clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height } });
    capturas.push('08-linhas-sintetico.png');
    await page.screenshot({ path: path.join(OUT, '09-tabela-com-sintetico.png'), fullPage: true });
    capturas.push('09-tabela-com-sintetico.png');
    checar('erros.sint', 'nenhum erro de página na passada sintética', erros.length === errosAntes, erros.slice(errosAntes).join(' | '));
  } catch (erro) {
    fatal = erro;
  } finally {
    const resumo = {
      banco: BANCO, quando: new Date().toISOString(), viewport: '1440x900 (+860x900)',
      ok: !fatal && resultados.every((r) => r.ok), resultados, capturas, medidas, erros, rede, fatal: fatal ? String(fatal.stack ?? fatal) : null,
    };
    fs.writeFileSync(path.join(OUT, 'painel-status-tipos.json'), JSON.stringify(resumo, null, 2));
    if (page && fatal) await page.screenshot({ path: path.join(OUT, 'final.png') }).catch(() => {});
    await browser.close();
  }

  for (const r of resultados) console.log(`${r.ok ? 'OK   ' : 'FALHA'} [${r.caso}] ${r.nome}${r.detalhe ? ' — ' + r.detalhe.slice(0, 400) : ''}`);
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`\n[${BANCO}] ${resultados.length - falhas}/${resultados.length} verificacoes; evidência em ${OUT}`);
  if (fatal) {
    console.error('\nEXECUÇÃO INTERROMPIDA — log em ' + path.join(OUT, 'painel-status-tipos.json'));
    console.error(fatal.stack ?? fatal);
    process.exit(2);
  }
  process.exit(falhas ? 1 : 0);
})();

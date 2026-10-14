/*
 * Carga real — passeio pelas telas com o banco de produção de duas unidades, só por clique.
 *
 *   CARGA_E2E_EMAIL=<email> CARGA_E2E_SENHA=<senha> npm run e2e:carga-real
 *   (opcionais: CARGA_E2E_BASE=http://127.0.0.1:4200, CARGA_E2E_API=http://127.0.0.1:4200/api/v1)
 *
 *   CARGA_E2E_TELEGRAM_TESTE=1  -> modo exclusivo: só abre Telegram > Configuração e clica UMA vez em
 *                                  "Testar integração". Nenhuma outra tela é visitada nesse modo, e
 *                                  fora dele o botão nunca é clicado.
 *
 * AMBIENTE ESPERADO: frontend em build de produção (apiUrl relativa `/api/v1`) servido com proxy
 * para o backend, na mesma origem. Dados reais, somente leitura no modo padrão:
 *   - SED "Sede Administrativa" (Aracaju), equipamento "Servidor AD Core" 10.79.10.6;
 *   - ITA "Sesc Itabaiana" (Itabaiana), conecta a SED, equipamento "Gateway Servidores" 10.70.10.1;
 *   - cada equipamento com o monitor ICMP "ping-principal". Só essas 2 unidades e 2 equipamentos.
 *
 * Saída em e2e/carga-real-evidence/: PNG numerados, resultado.json (checagens, leituras, erros de
 * console) e rede.json (método, url, status). Os dois JSON são gravados em `finally`.
 *
 * ARMADILHAS herdadas (n04, m06, n06, n07, rodada-curta), não reintroduzir:
 * 1. Sessão só existe em memória. Depois do login, nenhum page.goto: tudo por clique na barra
 *    lateral (`a.navigation__item[href=...]`, não `a[href=...]` solto — no Painel existe também
 *    `a.botao[href="/relatorios"]` e o logo `a.brand[href="/dashboard"]`), linhas e abas.
 * 2. Nada de catch silencioso em seletor. Seletor que deixar de casar tem de derrubar o roteiro.
 * 3. Marcador de unidade é clicado com `el.click()` nativo (n07 9c-a: o clique sintético do
 *    Playwright passa por mousemove e o Marker do MapLibre não seleciona). O clique nativo também
 *    não chega ao `click` de camada do canvas, então não há vazamento para o polígono do município;
 *    mesmo assim o roteiro confere qual município ficou aria-pressed.
 * 4. A camada `conexoes-linha` vive no WebGL e o componente não expõe o objeto do mapa em `window`.
 *    A conexão é provada pelo que o DOM tem dela: os pings (`.map__ping`, 2 por linha) com
 *    `--cor-ping`, que sai da mesma `corDoStatus(status do filho)` que pinta a `line-color` da
 *    camada (mapa.component.ts, `camadasDeConexao` e `montarPings`). A captura confirma o traço.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = process.env.CARGA_E2E_BASE || 'http://127.0.0.1:4200';
const API = process.env.CARGA_E2E_API || 'http://127.0.0.1:4200/api/v1';
const EMAIL = process.env.CARGA_E2E_EMAIL;
const SENHA = process.env.CARGA_E2E_SENHA;
if (!EMAIL || !SENHA) throw new Error('CARGA_E2E_EMAIL e CARGA_E2E_SENHA são obrigatórias');
const MODO_TELEGRAM = process.env.CARGA_E2E_TELEGRAM_TESTE === '1';

const OUT = path.join(__dirname, 'carga-real-evidence');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

const UNIDADES = {
  sed: { nome: 'Sede Administrativa', sigla: 'SED', cidade: 'Aracaju' },
  ita: { nome: 'Sesc Itabaiana', sigla: 'ITA', cidade: 'Itabaiana' },
};
const EQUIPAMENTOS = [
  { nome: 'Servidor AD Core', ip: '10.79.10.6', unidade: UNIDADES.sed.nome },
  { nome: 'Gateway Servidores', ip: '10.70.10.1', unidade: UNIDADES.ita.nome },
];
const MONITOR = 'ping-principal';

/** Espelho de COR_DO_STATUS (mapa.component.ts). Divergir daqui faz a checagem falhar, que é o certo. */
const STATUS_POR_COR = {
  '#34c77b': 'DISPONIVEL', '#e5484d': 'INDISPONIVEL', '#e8a33d': 'DEGRADADA',
  '#7fadff': 'EM_MANUTENCAO', '#8797a6': 'SEM_DADOS', '#667b8b': 'SEM_EQUIPAMENTOS',
};
const corDoStatus = (status) => Object.entries(STATUS_POR_COR).find(([, s]) => s === status)?.[0] ?? '#8797a6';

const resultados = [];
const checar = (passo, nome, ok, detalhe) => { resultados.push({ passo, nome, ok: !!ok, detalhe: detalhe ?? '' }); };
const leituras = {};
const rede = [];
const erros = [];

let sequenciaFoto = 0;
const foto = async (page, nome, alvo) => {
  sequenciaFoto += 1;
  const arquivo = `${String(sequenciaFoto).padStart(2, '0')}-${nome}.png`;
  if (alvo) await alvo.screenshot({ path: path.join(OUT, arquivo) });
  else await page.screenshot({ path: path.join(OUT, arquivo) });
  return arquivo;
};

/** Caminho da URL sem host, para casar resposta por endpoint e não por substring. */
const caminho = (url) => new URL(url).pathname;
const apiPath = caminho(API).replace(/\/$/, '');

async function login(page) {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-senha', SENHA);
  await page.click('.login-submit');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
  if (/\/trocar-senha/.test(page.url())) throw new Error('login caiu em /trocar-senha: usuário com troca de senha pendente');
}

async function clicarNoMenu(page, href) {
  await page.click(`a.navigation__item[href="${href}"]`);
}

// ================================================================ leituras do mapa (DOM real)

const lerMarcadores = (page) => page.evaluate(() => [...document.querySelectorAll('.map__unidade')].map((botao) => {
  const caixa = botao.getBoundingClientRect();
  return {
    id: botao.getAttribute('data-unidade-id'),
    rotulo: botao.getAttribute('aria-label'),
    pressionado: botao.getAttribute('aria-pressed') === 'true',
    cor: botao.style.getPropertyValue('--cor-unidade').trim(),
    pulsa: botao.classList.contains('map__unidade--pulsa'),
    animacaoNoAfter: getComputedStyle(botao, '::after').animationName,
    x: Math.round(caixa.x), y: Math.round(caixa.y),
  };
}));

const lerPings = (page) => page.evaluate(() => [...document.querySelectorAll('.map__ping')].map((no) => {
  const caixa = no.getBoundingClientRect();
  return { cor: no.style.getPropertyValue('--cor-ping').trim(), oculto: no.getAttribute('aria-hidden'), x: caixa.x, y: caixa.y };
}));

const municipioPressionado = (page) => page.evaluate(() =>
  [...document.querySelectorAll('.map__alvo[aria-pressed="true"]')].map((b) => b.getAttribute('data-codigo-ibge')));

/** Clique nativo no marcador (ver armadilha 3) e leitura do painel da unidade que abriu. */
async function selecionarMarcador(page, unidade, nomeEsperado, prefixoFoto) {
  const seletor = `.map__unidade[data-unidade-id="${unidade.id}"]`;
  await page.waitForSelector(seletor, { timeout: 20000 });
  const respostaAfetados = page.waitForResponse(
    (r) => caminho(r.url()) === `${apiPath}/dashboard/unidades/${unidade.id}/equipamentos`, { timeout: 20000 });
  await page.evaluate((sel) => document.querySelector(sel).click(), seletor);
  await respostaAfetados;
  await page.waitForSelector('.unit-panel', { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('.unit-panel__vazio[role="status"]'), null, { timeout: 15000 });
  await page.waitForTimeout(400);

  const nomePainel = (await page.locator('.unit-panel__nome').textContent()).trim();
  const kpis = await page.$$eval('.unit-panel .unit-kpis > div', (itens) =>
    itens.map((d) => ({ rotulo: d.querySelector('dt').textContent.trim(), valor: d.querySelector('dd').textContent.trim() })));
  const pressionados = (await lerMarcadores(page)).filter((m) => m.pressionado).map((m) => m.id);
  const municipios = await municipioPressionado(page);
  const afetados = await page.$$eval('.unit-panel .afetados__nome', (n) => n.map((x) => x.textContent.trim()));

  checar(2, `marcador de ${nomeEsperado} abre o painel da unidade certa`, nomePainel === nomeEsperado, `painel="${nomePainel}"`);
  checar(2, `${nomeEsperado}: só o marcador clicado fica aria-pressed`,
    pressionados.length === 1 && pressionados[0] === String(unidade.id), JSON.stringify(pressionados));
  checar(2, `${nomeEsperado}: município selecionado é o do cadastro (clique não vazou para outro polígono)`,
    municipios.length === 1 && municipios[0] === String(unidade.codigoIbge ?? '').trim(),
    `pressionado=${JSON.stringify(municipios)} esperado=${unidade.codigoIbge}`);
  // Nenhum bloco de "várias unidades" deve aparecer: cada município tem uma unidade só.
  checar(2, `${nomeEsperado}: sem bloco de escolha entre unidades`, (await page.locator('.unit-list__escolha').count()) === 0);

  leituras.painelUnidade = leituras.painelUnidade || {};
  leituras.painelUnidade[nomeEsperado] = { kpis, afetados };
  await foto(page, `${prefixoFoto}-painel`);
  await foto(page, `${prefixoFoto}-painel-recorte`, page.locator('.map-panel'));
}

/**
 * "Fechar" o painel. O mapa NÃO tem botão de fechar o painel da unidade nem trata Escape: o que
 * limpa a seleção é `load()`, disparado pelo botão "Atualizar" do cabeçalho (mapa.component.ts:
 * `load()` chama `selected.set(null)` e `limparUnidade()`). Recria o mapa — por isso espera os
 * marcadores de novo.
 */
async function fecharPainelPeloAtualizar(page) {
  const recarga = page.waitForResponse((r) => caminho(r.url()) === `${apiPath}/dashboard/unidades` && r.ok(), { timeout: 20000 });
  await page.click('.map-page__header .botao');
  await recarga;
  await page.waitForFunction(() => document.querySelectorAll('.map__unidade').length > 0
    && !document.querySelector('.unit-panel'), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  checar(2, 'painel da unidade fechado (Atualizar limpa a seleção)', (await page.locator('.unit-panel').count()) === 0);
}

// ================================================================ modo Telegram

async function modoTelegram(page) {
  await clicarNoMenu(page, '/notificacoes');
  await page.waitForURL(/\/notificacoes\/historico$/, { timeout: 20000 });
  await page.locator('.telegram .abas a.aba', { hasText: /^\s*Configuração\s*$/ }).click();
  await page.waitForURL(/\/notificacoes\/configuracao$/, { timeout: 20000 });
  await page.waitForSelector('.config', { timeout: 20000 });

  const estadoCanal = await page.$$eval('.config__estado > div', (itens) =>
    itens.map((d) => ({ rotulo: d.querySelector('dt').textContent.trim(), valor: d.querySelector('dd').textContent.trim() })));
  leituras.telegramEstadoCanal = estadoCanal;
  await foto(page, 'telegram-antes');

  const botao = page.locator('.config .cartao button.botao--primario', { hasText: /Testar integração/ });
  await botao.waitFor({ state: 'visible', timeout: 10000 });
  const habilitado = await botao.isEnabled();
  checar('T', 'botão "Testar integração" habilitado (canal ligado e destino configurado)', habilitado, JSON.stringify(estadoCanal));
  if (!habilitado) throw new Error('botão "Testar integração" desabilitado: canal desligado, sem destino ou em cooldown — nada foi enviado');

  const resposta = page.waitForResponse(
    (r) => caminho(r.url()) === `${apiPath}/notificacoes/telegram/teste` && r.request().method() === 'POST', { timeout: 30000 });
  await botao.click();
  const recebida = await resposta;
  const corpo = await recebida.json();
  fs.writeFileSync(path.join(OUT, 'telegram-teste.json'),
    JSON.stringify({ quando: new Date().toISOString(), status: recebida.status(), corpo }, null, 2));
  leituras.telegramTeste = { status: recebida.status(), corpo };

  await page.locator('.config__resultado').waitFor({ state: 'visible', timeout: 10000 });
  const mensagem = (await page.locator('.config__resultado').textContent()).trim();
  leituras.telegramMensagemTela = mensagem;
  checar('T', 'POST /notificacoes/telegram/teste respondeu 2xx', recebida.ok(), `status=${recebida.status()}`);
  checar('T', 'tela mostra o resultado do envio', mensagem.length > 0, mensagem);
  await foto(page, 'telegram-depois');
}

// ================================================================ roteiro de telas

async function roteiroTelas(page) {
  // ------------------------------------------------------------------ 2. Mapa
  const respostaUnidades = page.waitForResponse((r) => caminho(r.url()) === `${apiPath}/dashboard/unidades` && r.ok(), { timeout: 20000 });
  await clicarNoMenu(page, '/mapa');
  await page.waitForURL(/\/mapa$/, { timeout: 20000 });
  const unidadesApi = await (await respostaUnidades).json();
  await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
  await page.waitForSelector('.map__unidade', { timeout: 30000 });
  await page.waitForTimeout(1800);

  const sed = unidadesApi.find((u) => u.nome === UNIDADES.sed.nome);
  const ita = unidadesApi.find((u) => u.nome === UNIDADES.ita.nome);
  leituras.unidadesDaApi = unidadesApi.map((u) => ({
    id: u.id, nome: u.nome, status: u.status, codigoIbge: u.codigoIbge,
    latitude: u.latitude, longitude: u.longitude, conectaAUnidadeId: u.conectaAUnidadeId,
    equipamentosTotal: u.equipamentosTotal, incidentesAbertos: u.incidentesAbertos,
  }));
  checar(2, 'API do mapa devolve exatamente as 2 unidades (SED e ITA)', unidadesApi.length === 2 && !!sed && !!ita,
    unidadesApi.map((u) => u.nome).join(', '));
  if (!sed || !ita) throw new Error('SED ou ITA ausente em /dashboard/unidades — roteiro depende das duas');
  checar(2, 'ITA conecta a SED (hub) e SED é raiz', ita.conectaAUnidadeId === sed.id && sed.conectaAUnidadeId == null,
    `ITA.conectaAUnidadeId=${ita.conectaAUnidadeId} SED.id=${sed.id} SED.conectaAUnidadeId=${sed.conectaAUnidadeId}`);

  const marcadores = await lerMarcadores(page);
  leituras.marcadores = marcadores.map((m) => ({ ...m, statusPelaCor: STATUS_POR_COR[m.cor] ?? null }));
  checar(2, 'exatamente 2 marcadores de unidade', marcadores.length === 2, `${marcadores.length} marcador(es)`);
  const ids = new Set(marcadores.map((m) => m.id));
  checar(2, 'os marcadores são SED e ITA', ids.has(String(sed.id)) && ids.has(String(ita.id)), [...ids].join(','));
  for (const [unidade, rotulo] of [[sed, 'SED'], [ita, 'ITA']]) {
    const m = marcadores.find((x) => x.id === String(unidade.id));
    checar(2, `${rotulo}: aria-label começa pelo nome`, !!m && m.rotulo.startsWith(`${unidade.nome}:`), m?.rotulo);
    checar(2, `${rotulo}: cor do marcador = cor do status da API (${unidade.status})`,
      !!m && m.cor === corDoStatus(unidade.status), `cor=${m?.cor} -> ${m ? STATUS_POR_COR[m.cor] : '?'}`);
    checar(2, `${rotulo}: marcador pulsa (classe + animação no ::after)`,
      !!m && m.pulsa && /(^|_)map-pulsar$/.test(m.animacaoNoAfter), `${m?.pulsa}/${m?.animacaoNoAfter}`);
  }

  // Conexão ITA -> SED, provada pelos pings (ver armadilha 4).
  const pings = await lerPings(page);
  const corEsperada = corDoStatus(ita.status);
  leituras.conexao = {
    de: sed.id, para: ita.id, statusQueColore: ita.status, corEsperada,
    pings: pings.map((p) => ({ cor: p.cor, oculto: p.oculto })),
    legendaLinha: await page.locator('.legend-bloco .legend__linha').count(),
  };
  checar(2, 'conexão ITA→SED desenhada: 2 pings (1 linha × 2)', pings.length === 2, `${pings.length} ping(s)`);
  checar(2, 'cor da conexão = cor do status de ITA (unidade conectada)', pings.length > 0 && pings.every((p) => p.cor === corEsperada),
    `pings=${[...new Set(pings.map((p) => p.cor))].join(' ')} esperado=${corEsperada} (${ita.status})`);
  checar(2, 'pings são aria-hidden', pings.length > 0 && pings.every((p) => p.oculto === 'true'));

  // Ping animado: percurso acumulado em três amostras ao longo de ~meio ciclo (mesma técnica do n07).
  const amostras = [pings];
  for (let i = 0; i < 2; i += 1) { await page.waitForTimeout(1050); amostras.push(await lerPings(page)); }
  const percurso = pings.map((_, i) => amostras.slice(1).reduce((soma, atual, k) =>
    soma + Math.hypot(atual[i].x - amostras[k][i].x, atual[i].y - amostras[k][i].y), 0));
  leituras.conexao.percursoPx = percurso.map((d) => +d.toFixed(1));
  checar(2, 'ping animado percorre a linha (nenhum parado)', percurso.length === 2 && percurso.every((d) => d >= 1),
    percurso.map((d) => d.toFixed(1) + 'px').join(' '));

  await foto(page, 'mapa-tela');
  await foto(page, 'mapa-cartao', page.locator('.map-card'));

  await selecionarMarcador(page, sed, UNIDADES.sed.nome, 'mapa-sed');
  await fecharPainelPeloAtualizar(page);
  await selecionarMarcador(page, ita, UNIDADES.ita.nome, 'mapa-ita');

  // ------------------------------------------------------------------ 3. Painel
  await clicarNoMenu(page, '/dashboard');
  await page.waitForURL(/\/dashboard$/, { timeout: 20000 });
  await page.waitForSelector('#painel-titulo', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('.painel .kpis article.kpi').length === 9
    && !document.querySelector('.painel .kpis .kpi--carregando'), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  const kpis = await page.$$eval('.painel .kpis article.kpi', (cards) => cards.map((c) => ({
    rotulo: c.querySelector('span')?.textContent.trim(),
    valor: c.querySelector('strong')?.textContent.replace(/\s+/g, ' ').trim(),
    nota: c.querySelector('small')?.textContent.trim(),
  })));
  leituras.painelKpis = kpis;
  const kpi = (rotulo) => kpis.find((k) => k.rotulo === rotulo)?.valor;
  checar(3, 'KPI UNIDADES = 2', kpi('UNIDADES') === '2', `UNIDADES=${kpi('UNIDADES')}`);
  checar(3, 'KPI EQUIPAMENTOS = 2', kpi('EQUIPAMENTOS') === '2', `EQUIPAMENTOS=${kpi('EQUIPAMENTOS')}`);
  const linhasPainel = await page.locator('.painel .tabela .unidade').count();
  checar(3, 'lista do painel com 2 unidades', linhasPainel === 2, `${linhasPainel} linha(s)`);
  await foto(page, 'painel');

  // ------------------------------------------------------------------ 4. Unidades
  await clicarNoMenu(page, '/unidades');
  await page.waitForURL(/\/unidades$/, { timeout: 20000 });
  await page.waitForSelector('#unidades-titulo', { timeout: 20000 });
  if ((await page.inputValue('#busca-unidades')) !== '') { await page.fill('#busca-unidades', ''); await page.waitForTimeout(500); }
  await page.waitForSelector('.unidades table.tabela tbody tr', { timeout: 20000 });
  const linhasUnidades = await page.$$eval('.unidades table.tabela tbody tr', (trs) => trs.map((tr) => ({
    nome: tr.querySelector('td:nth-child(1) .forte')?.textContent.trim(),
    sigla: tr.querySelector('td:nth-child(2)')?.textContent.trim(),
    cidade: tr.querySelector('td:nth-child(3)')?.textContent.trim(),
    status: tr.querySelector('td:nth-child(5)')?.textContent.replace(/\s+/g, ' ').trim(),
    equipamentos: tr.querySelector('td:nth-child(6)')?.textContent.trim(),
    disponibilidade: tr.querySelector('td:nth-child(7)')?.textContent.trim(),
  })));
  leituras.unidadesLista = linhasUnidades;
  checar(4, 'lista de unidades com 2 linhas', linhasUnidades.length === 2, `${linhasUnidades.length} linha(s)`);
  checar(4, 'linhas são SED e ITA',
    [UNIDADES.sed, UNIDADES.ita].every((u) => linhasUnidades.some((l) => l.nome === u.nome && l.sigla === u.sigla)),
    linhasUnidades.map((l) => `${l.sigla}/${l.nome}`).join(', '));
  await foto(page, 'unidades');

  // ------------------------------------------------------------------ 5. Equipamentos
  await clicarNoMenu(page, '/equipamentos');
  await page.waitForURL(/\/equipamentos$/, { timeout: 20000 });
  await page.waitForSelector('#equipamentos-titulo', { timeout: 20000 });
  await page.waitForSelector('.equipamentos table.tabela tbody tr', { timeout: 20000 });
  const linhasEquip = await page.$$eval('.equipamentos table.tabela tbody tr', (trs) => trs.map((tr) => ({
    nome: tr.querySelector('td:nth-child(1)')?.textContent.trim(),
    unidade: tr.querySelector('td:nth-child(3)')?.textContent.trim(),
    ip: tr.querySelector('td:nth-child(5)')?.textContent.trim(),
    status: tr.querySelector('td:nth-child(6)')?.textContent.replace(/\s+/g, ' ').trim(),
    latencia: tr.querySelector('td:nth-child(7)')?.textContent.replace(/\s+/g, ' ').trim(),
  })));
  leituras.equipamentosLista = linhasEquip;
  checar(5, 'lista de equipamentos com 2 linhas', linhasEquip.length === 2, `${linhasEquip.length} linha(s)`);
  checar(5, 'nome, IP e unidade de cada equipamento batem com o cadastro',
    EQUIPAMENTOS.every((e) => linhasEquip.some((l) => l.nome === e.nome && l.ip === e.ip && l.unidade === e.unidade)),
    JSON.stringify(linhasEquip.map((l) => [l.nome, l.ip, l.unidade])));
  await foto(page, 'equipamentos-lista');

  leituras.drawers = {};
  for (const [indice, equipamento] of EQUIPAMENTOS.entries()) {
    const sufixo = indice === 0 ? 'sed' : 'ita';
    await page.locator(`.equipamentos tbody .menu-acoes__gatilho[aria-label="Ações de ${equipamento.nome}"]`).click();
    await page.locator('.menu-acoes__lista [role="menuitem"]', { hasText: /^\s*Ver\s*$/ }).click();
    await page.waitForURL(/\/equipamentos\/\d+$/, { timeout: 20000 });
    await page.waitForSelector('.gaveta', { timeout: 20000 });
    // O título nasce como o rótulo genérico "Equipamento" e só vira o nome quando o detalhe chega.
    // Sem esta espera a 1ª gaveta é lida antes da resposta (falha falsa na rodada de 2026-10-14).
    await page.waitForFunction(
      () => (document.querySelector('#drawer-equipamento-titulo')?.textContent ?? '').trim() !== 'Equipamento',
      null, { timeout: 20000 });

    const titulo = (await page.locator('#drawer-equipamento-titulo').textContent()).trim();
    checar(5, `gaveta aberta é a de ${equipamento.nome}`, titulo === equipamento.nome, `titulo="${titulo}"`);

    // Espera o fim do carregamento das medições: some o esqueleto do gráfico.
    await page.waitForFunction(() => {
      const secao = document.querySelector('.gaveta .grafico');
      return !!secao && !secao.querySelector('.esqueleto--grafico');
    }, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    const grafico = await page.evaluate(() => {
      const secao = document.querySelector('.gaveta .grafico');
      const svg = secao.querySelector('svg.grafico__svg');
      const linhas = svg ? [...svg.querySelectorAll('polyline.grafico__linha')] : [];
      const pontos = linhas.reduce((soma, l) => soma + (l.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean).length, 0);
      const caixa = svg ? svg.getBoundingClientRect() : null;
      return {
        svg: !!svg, segmentos: linhas.length, pontos,
        largura: caixa ? Math.round(caixa.width) : 0, altura: caixa ? Math.round(caixa.height) : 0,
        vazio: secao.querySelector('.vazio strong')?.textContent.trim() ?? null,
        legenda: secao.querySelector('.grafico__legenda')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      };
    });
    const kpisGaveta = await page.$$eval('.gaveta .kpis .kpi', (itens) => itens.map((k) => ({
      rotulo: k.querySelector('.kpi__rotulo')?.textContent.trim(),
      valor: k.querySelector('.kpi__valor')?.textContent.replace(/\s+/g, ' ').trim(),
    })));
    const ipGaveta = await page.evaluate(() => {
      const dts = [...document.querySelectorAll('.gaveta .dados dt')];
      return dts.find((dt) => dt.textContent.trim() === 'Endereço IP')?.nextElementSibling?.textContent.trim() ?? null;
    });
    leituras.drawers[equipamento.nome] = { grafico, kpis: kpisGaveta, ip: ipGaveta };
    checar(5, `${equipamento.nome}: gráfico de latência renderizado (svg com polilinha não vazia)`,
      grafico.svg && grafico.segmentos > 0 && grafico.pontos >= 2 && grafico.largura > 0 && grafico.altura > 0,
      JSON.stringify(grafico));
    checar(5, `${equipamento.nome}: IP no inventário da gaveta`, ipGaveta === equipamento.ip, `ip="${ipGaveta}"`);
    await foto(page, `equipamento-${sufixo}-gaveta`);

    await page.locator('.gaveta__fechar').click();
    await page.locator('.gaveta').waitFor({ state: 'detached', timeout: 10000 });
    await page.waitForURL(/\/equipamentos$/, { timeout: 20000 });
    await page.waitForSelector('.equipamentos table.tabela tbody tr', { timeout: 20000 });

    // Limpa filtro remanescente, se houver: um filtro herdado esconderia a linha do próximo passo.
    if ((await page.inputValue('#busca-equipamentos')) !== '') { await page.fill('#busca-equipamentos', ''); await page.waitForTimeout(500); }
    if (await page.locator('.equipamentos__contador-filtros').count()) {
      if (!(await page.locator('#painel-filtros').count())) await page.click('.equipamentos__filtros-gatilho');
      await page.locator('#painel-filtros button', { hasText: /^\s*Limpar filtros\s*$/ }).click();
      await page.waitForTimeout(500);
    }
    checar(5, `lista íntegra ao voltar da gaveta de ${equipamento.nome}`,
      (await page.locator('.equipamentos table.tabela tbody tr').count()) === 2);
  }

  // ------------------------------------------------------------------ 6. Relatórios
  await clicarNoMenu(page, '/relatorios');
  await page.waitForURL(/\/relatorios/, { timeout: 20000 });
  await page.waitForSelector('#reports-title', { timeout: 20000 });

  leituras.relatorios = {};
  for (const [rotuloAba, endpoint, chave, legenda] of [
    ['Disponibilidade Unidades', '/relatorios/disponibilidade/unidades', 'unidades', 'Disponibilidade por unidades'],
    ['Disponibilidade Equipamentos', '/relatorios/disponibilidade/equipamentos', 'equipamentos', 'Disponibilidade por equipamentos'],
  ]) {
    const resposta = page.waitForResponse((r) => caminho(r.url()) === `${apiPath}${endpoint}`, { timeout: 30000 });
    await page.locator('.reports .tabs button[role="tab"]', { hasText: new RegExp(`^\\s*${rotuloAba}\\s*$`) }).click();
    const recebida = await resposta;
    // Só aceita a tabela DESTA aba (caption), para não ler linhas da aba anterior.
    await page.waitForFunction((esperada) => {
      const caption = document.querySelector('.reports .table-wrap caption')?.textContent.trim();
      return (caption === esperada && !!document.querySelector('.reports .table-wrap tbody tr'))
        || !!document.querySelector('.reports .vazio, .reports .notice--error');
    }, legenda, { timeout: 20000 });
    await page.waitForTimeout(400);
    const linhas = await page.$$eval('.reports .table-wrap tbody tr', (trs) =>
      trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\s+/g, ' ').trim())));
    leituras.relatorios[chave] = { status: recebida.status(), linhas };
    checar(6, `${rotuloAba}: API ${recebida.status()} e 2 linhas na tabela`, recebida.ok() && linhas.length === 2,
      `status=${recebida.status()} linhas=${linhas.length}`);
    if (chave === 'equipamentos') {
      // Coluna 3 é Monitor (relatorios.component.html).
      checar(6, `${rotuloAba}: monitor "${MONITOR}" em cada equipamento`,
        linhas.length === 2 && linhas.every((l) => l[2] === MONITOR), JSON.stringify(linhas.map((l) => l[2])));
    }
    await foto(page, `relatorio-${chave}`);
  }
}

// ================================================================ execução

(async () => {
  const browser = await chromium.launch({ headless: true });
  let fatal = null;
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text()); });

  const pendentes = new Map();
  page.on('request', (r) => {
    const entrada = { quando: new Date().toISOString(), metodo: r.method(), url: r.url(), status: null };
    pendentes.set(r, entrada);
    if (r.url().startsWith(API)) rede.push(entrada);
  });
  page.on('response', (r) => {
    const entrada = pendentes.get(r.request());
    if (!entrada) return;
    entrada.status = r.status();
    // Fora da API, só o que falhou entra no log: assets 200 são ruído.
    if (!r.url().startsWith(API) && r.status() >= 400) rede.push(entrada);
  });
  page.on('requestfailed', (r) => {
    const entrada = pendentes.get(r) ?? { quando: new Date().toISOString(), metodo: r.method(), url: r.url() };
    entrada.status = null;
    entrada.falha = r.failure()?.errorText ?? 'desconhecida';
    if (!rede.includes(entrada)) rede.push(entrada);
  });

  try {
    await login(page);
    await foto(page, 'logado');
    checar(1, 'login concluído', !/\/login/.test(page.url()), page.url());

    if (MODO_TELEGRAM) await modoTelegram(page);
    else await roteiroTelas(page);

    checar(9, 'nenhum erro de página/console no roteiro', erros.length === 0, erros.join(' | '));
  } catch (erro) {
    fatal = erro;
  } finally {
    fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify({
      base: BASE, api: API, modo: MODO_TELEGRAM ? 'telegram-teste' : 'telas', viewport: VIEWPORT,
      quando: new Date().toISOString(), resultados, falhas: resultados.filter((r) => !r.ok).length,
      leituras, erros, fatal: fatal ? String(fatal.stack ?? fatal) : null,
    }, null, 2));
    fs.writeFileSync(path.join(OUT, 'rede.json'), JSON.stringify(rede, null, 2));
    await page.screenshot({ path: path.join(OUT, 'final.png') }).catch(() => {});
    await browser.close();
  }

  for (const r of resultados) console.log(`${r.ok ? 'OK   ' : 'FALHA'} [passo ${r.passo}] ${r.nome}${r.detalhe ? ' — ' + r.detalhe : ''}`);
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - falhas}/${resultados.length} verificações`);
  if (fatal) {
    console.error('\nEXECUÇÃO INTERROMPIDA — log em ' + path.join(OUT, 'resultado.json'));
    console.error(fatal.stack ?? fatal);
  }
  if (fatal || falhas) process.exitCode = 1;
})();

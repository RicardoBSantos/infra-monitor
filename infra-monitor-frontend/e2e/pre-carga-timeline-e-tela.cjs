/*
 * Pré-carga real — timeline por motivo de fechamento, decimal pt-BR, plural e zero neutro,
 * ponta a ponta no navegador e só por clique.
 *
 *   PRE_CARGA_EMAIL=<email> PRE_CARGA_SENHA=<senha> npm run e2e:pre-carga
 *   (opcionais: PRE_CARGA_BASE=http://127.0.0.1:4200, PRE_CARGA_API=http://localhost:8080/api/v1)
 *
 * AMBIENTE: SÓ o banco descartável `infra-e2e` (porta 5437), restaurado de um pg_dump do dev e
 * semeado com `e2e/pre-carga-seed.sql` LOGO ANTES deste roteiro (o caso 6 lê os últimos 26 min).
 * Backend com DB_PORT=5437 e motor/Telegram/dispatcher no default desligado; `ng serve` em 4200.
 * Nunca apontar para o banco de dev (o seed exige o marcador app.banco_descartavel, ver cabeçalho do SQL): o seed escreve, e o Flyway migra no boot.
 *
 * Casos:
 *   1–3  Gaveta de cada incidente seed (RECUPERACAO_AUTOMATICA, FECHAMENTO_MANUAL, MANUTENCAO):
 *        rótulo do fechamento; nenhum `.timeline__item` depois do `encerradoEm` (o seed grava
 *        FALHA depois do fechamento e o roteiro confere que a gaveta de fato as recebeu); rótulo
 *        e detalhe do fechamento sem sobreposição — por `boundingBox` e pelos retângulos do
 *        texto renderizado, porque o defeito original esmagava o rótulo a largura 0 e o texto
 *        transbordava por cima do detalhe sem que as caixas se cruzassem; screenshot.
 *   4    Painel: KPI OFFLINE diz "N unidade afetada"/"N unidades afetadas" com N igual ao da
 *        API e a forma certa para N; percentuais com vírgula.
 *   5    Relatórios (Visão geral, 24 h): disponibilidade e latência média com vírgula.
 *   6    Gaveta de equipamento com perda 0 e 0 incidentes: nenhum cartão kpi--warn/kpi--down.
 *   7    Gaveta de episódio de latência com 0 acima do limiar: cartão sem kpi--warn.
 *
 * ARMADILHAS herdadas (ver m06-drawer-no-mapa.cjs), não reintroduzir:
 *   1. Sessão só existe em memória: page.goto depois do login cai em /login. Toda navegação
 *      é por clique. A API é consultada à parte (login próprio) só para saber ids e números
 *      esperados — nunca para dirigir a tela.
 *   2. Nada de catch silencioso em seletor: seletor que deixou de casar tem de falhar alto.
 *   3. Resultados e log gravados em `finally`, aconteça o que acontecer.
 */
const { chromium, request: playwrightRequest } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = process.env.PRE_CARGA_BASE || 'http://127.0.0.1:4200';
const API = process.env.PRE_CARGA_API || 'http://localhost:8080/api/v1';
const EMAIL = process.env.PRE_CARGA_EMAIL;
const SENHA = process.env.PRE_CARGA_SENHA;
if (!EMAIL || !SENHA) throw new Error('PRE_CARGA_EMAIL e PRE_CARGA_SENHA são obrigatórias');

const OUT = path.join(__dirname, 'pre-carga-evidence');
fs.mkdirSync(OUT, { recursive: true });

const resultados = [];
const checar = (caso, nome, ok, detalhe) => { resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' }); };
const rede = [];
const erros = [];

const FECHAMENTOS = [
  { caso: 1, motivo: 'RECUPERACAO_AUTOMATICA', rotulo: 'Incidente fechado',
    detalhe: (inc) => /^2 respostas consecutivas restabeleceram o monitor$/.test(inc), arquivo: '01-recuperacao' },
  { caso: 2, motivo: 'FECHAMENTO_MANUAL', rotulo: 'Encerrado manualmente',
    detalhe: (inc, nome) => inc === `por ${nome}. Nenhuma recuperação foi medida.`, arquivo: '02-manual' },
  { caso: 3, motivo: 'MANUTENCAO', rotulo: 'Encerrado por manutenção',
    detalhe: (inc) => /Nenhuma recuperação foi medida\.$/.test(inc), arquivo: '03-manutencao' },
];

const intercepta = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Retângulos do texto como foi pintado — o que o olho vê, mesmo quando a caixa do elemento encolheu. */
const retangulosDoTexto = (locator) => locator.evaluate((el) => {
  const faixa = document.createRange();
  faixa.selectNodeContents(el);
  return [...faixa.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
});

async function apiAutenticada() {
  const contexto = await playwrightRequest.newContext();
  const login = await contexto.post(API + '/auth/login', { data: { email: EMAIL, senha: SENHA } });
  if (!login.ok()) throw new Error(`login na API falhou: ${login.status()}`);
  const { accessToken, usuario } = await login.json();
  const get = async (caminho) => {
    const resposta = await contexto.get(API + caminho, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!resposta.ok()) throw new Error(`GET ${caminho} -> ${resposta.status()}`);
    return resposta.json();
  };
  return { get, usuario, fechar: () => contexto.dispose() };
}

async function clicarNoMenu(page, href) {
  // Abaixo de 769 px a sidebar fica recolhida atrás do botão de menu.
  if ((page.viewportSize()?.width ?? 1440) < 769) await page.click('.menu-button');
  await page.click(`a.navigation__item[href="${href}"]`);
}

async function abrirIncidentes(page, aba) {
  await clicarNoMenu(page, '/incidentes');
  await page.waitForURL(/\/incidentes(\/.*)?$/, { timeout: 20000 });
  await page.locator('.aba', { hasText: aba }).click();
  await page.waitForSelector('.table-wrap tbody tr', { timeout: 20000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let fatal = null;
  let api = null;
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
  page.on('request', (r) => { if (r.url().startsWith(API)) rede.push(`${new Date().toISOString()} ${r.method()} ${r.url().replace(API, '')}`); });
  // Última resposta de medições pedida pela gaveta: prova que o recorte teve o que recortar.
  let ultimasMedicoes = null;
  page.on('response', async (r) => {
    if (r.url().includes('/relatorios/medicoes') && r.request().method() === 'GET' && r.ok()) {
      ultimasMedicoes = { url: r.url(), corpo: await r.json() };
    }
  });

  try {
    api = await apiAutenticada();
    const nomeAdmin = api.usuario.nome;
    const seed = (await api.get('/incidentes?size=100&status=FECHADO')).content
      .filter((inc) => inc.observacao === 'e2e-pre-carga');
    if (seed.length !== 3) throw new Error(`esperados 3 incidentes FECHADO do seed, achados ${seed.length}: rode e2e/pre-carga-seed.sql`);

    // --------------------------------------------------------------- login por clique
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });

    // --------------------------------------------------------------- 1–3 timeline por motivo
    await abrirIncidentes(page, 'Resolvidos');
    for (const alvo of FECHAMENTOS) {
      const incidente = seed.find((inc) => inc.motivoEncerramento === alvo.motivo);
      if (!incidente) throw new Error(`seed sem incidente ${alvo.motivo}`);
      ultimasMedicoes = null;
      await page.locator('button.link', { hasText: new RegExp(`^\\s*INC-${incidente.id}\\s*$`) }).click();
      await page.waitForSelector('.gaveta .timeline__item', { timeout: 20000 });
      const titulo = (await page.textContent('#drawer-ocorrencia-titulo')).trim();
      const item = page.locator('.timeline__item', { has: page.locator('.timeline__rotulo', { hasText: new RegExp(`^${alvo.rotulo}$`) }) });
      await item.waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForFunction(() => !!document.querySelector('.gaveta .timeline'), null, { timeout: 15000 });
      await page.waitForTimeout(300);

      const rotulo = (await item.locator('.timeline__rotulo').textContent()).trim();
      const detalhe = (await item.locator('.timeline__detalhe').textContent()).trim();
      const quantos = await item.count();

      const fim = new Date(incidente.encerradoEm).getTime();
      const horas = await page.locator('.timeline__item time').evaluateAll((els) => els.map((el) => el.getAttribute('datetime')));
      const depois = horas.filter((iso) => new Date(iso).getTime() > fim);
      const medicoesDepois = (ultimasMedicoes?.corpo?.content ?? []).filter((m) => new Date(m.executadoEm).getTime() > fim).length;

      const caixaRotulo = await item.locator('.timeline__rotulo').boundingBox();
      const caixaDetalhe = await item.locator('.timeline__detalhe').boundingBox();
      const textoRotulo = await retangulosDoTexto(item.locator('.timeline__rotulo'));
      const textoDetalhe = await retangulosDoTexto(item.locator('.timeline__detalhe'));
      const textoCruza = textoRotulo.some((a) => textoDetalhe.some((b) => intercepta(a, b)));

      await item.scrollIntoViewIfNeeded();
      await page.locator('.gaveta').screenshot({ path: path.join(OUT, `${alvo.arquivo}-gaveta.png`) });

      checar(alvo.caso, `${alvo.motivo}: gaveta INC-${incidente.id} mostra "${alvo.rotulo}" com o detalhe certo`,
        titulo === `INC-${incidente.id}` && quantos === 1 && rotulo === alvo.rotulo && alvo.detalhe(detalhe, nomeAdmin),
        `titulo=${titulo} rotulo="${rotulo}" detalhe="${detalhe}"`);
      if (alvo.motivo === 'RECUPERACAO_AUTOMATICA') {
        const recuperacoes = await page.locator('.timeline__rotulo', { hasText: /^Resposta ICMP — recuperação \d\/2$/ }).count();
        checar(alvo.caso, 'RECUPERACAO_AUTOMATICA: as 2 respostas que terminam no encerradoEm aparecem como recuperação',
          recuperacoes === 2, `recuperacoes=${recuperacoes}`);
      }
      checar(alvo.caso, `${alvo.motivo}: nenhum evento depois do fechamento (e a gaveta recebeu medição posterior para recortar)`,
        depois.length === 0 && medicoesDepois > 0,
        `eventos=${horas.length} depois=${JSON.stringify(depois)} medicoesPosterioresRecebidas=${medicoesDepois}`);
      checar(alvo.caso, `${alvo.motivo}: rótulo e detalhe do fechamento não se sobrepõem`,
        caixaRotulo.width > 0 && !intercepta(caixaRotulo, caixaDetalhe) && !textoCruza,
        `rotulo=${JSON.stringify(caixaRotulo)} detalhe=${JSON.stringify(caixaDetalhe)} textoCruza=${textoCruza}`);

      await page.locator('.gaveta__fechar').click();
      await page.locator('.gaveta').waitFor({ state: 'detached', timeout: 10000 });
    }

    // --------------------------------------------------------------- 4 Painel
    const unidadesApi = await api.get('/dashboard/unidades');
    const esperadoOffline = unidadesApi.filter((u) => u.equipamentosIndisponiveis > 0).length;
    await clicarNoMenu(page, '/dashboard');
    await page.waitForURL(/\/dashboard$/, { timeout: 20000 });
    const kpiOffline = page.locator('.kpis .kpi', { has: page.locator('span', { hasText: /^OFFLINE$/ }) });
    await kpiOffline.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForFunction(() => !document.querySelector('.kpis .kpi--carregando'), null, { timeout: 20000 });
    const legenda = (await kpiOffline.locator('small').textContent()).trim();
    const [, numeroTexto, forma] = legenda.match(/^(\d+) (.+)$/) ?? [];
    const numero = Number(numeroTexto);
    const formaCerta = numero === 1 ? 'unidade afetada' : 'unidades afetadas';
    checar(4, 'Painel: OFFLINE diz quantas unidades estão afetadas, com o número da API e a concordância certa',
      numero === esperadoOffline && forma === formaCerta, `legenda="${legenda}" esperado=${esperadoOffline} ${formaCerta}`);
    const kpis = (await page.locator('.kpis').textContent()).replace(/\s+/g, ' ');
    const disponibilidadeGlobal = (await page.locator('.kpis .kpi', { has: page.locator('span', { hasText: /^DISPONIBILIDADE$/ }) })
      .locator('strong').textContent()).trim();
    checar(4, 'Painel: percentuais com vírgula e nenhum com ponto',
      /^\d+,\d{2}%$/.test(disponibilidadeGlobal) && !/\d+\.\d{2}%/.test(kpis), `disponibilidade="${disponibilidadeGlobal}"`);
    await page.locator('.kpis').screenshot({ path: path.join(OUT, '04-painel-kpis.png') });

    // --------------------------------------------------------------- 5 Relatórios
    await clicarNoMenu(page, '/relatorios');
    await page.waitForURL(/\/relatorios/, { timeout: 20000 });
    // A aba inicial é Disponibilidade Equipamentos; a Visão geral (24 h) é a que junta os
    // rankings de disponibilidade e a latência média.
    await page.locator('button[role="tab"]', { hasText: /^Visão Geral$/ }).click();
    for (const id of ['units-ranking-title', 'equipment-ranking-title', 'latency-overview-title']) {
      await page.locator(`article[aria-labelledby="${id}"] table`).waitFor({ state: 'attached', timeout: 30000 });
    }
    const textoRelatorio = (await page.locator('article.analytic-card').allTextContents()).join(' ').replace(/\s+/g, ' ');
    const percentuais = textoRelatorio.match(/\d+,\d{2}%/g) ?? [];
    const medias = await page.locator('article[aria-labelledby="latency-overview-title"] tbody tr td:nth-child(5)').allTextContents();
    // Monitor só com FALHA na janela não tem média: o "—" é dado ausente, não número mal formatado.
    const comMedia = medias.map((m) => m.trim()).filter((m) => m !== '—');
    checar(5, 'Relatórios: disponibilidade com vírgula, nenhuma com ponto',
      percentuais.length > 0 && !/\d+\.\d{2}%/.test(textoRelatorio), `${percentuais.length} percentuais, ex.: ${percentuais.slice(0, 3).join(' ')}`);
    checar(5, 'Relatórios: latência média com vírgula, nenhuma com ponto',
      comMedia.length > 0 && comMedia.every((m) => /^\d+,\d{2} ms$/.test(m)) && !/\d+\.\d{2} ms/.test(textoRelatorio),
      JSON.stringify(medias.map((m) => m.trim())));
    await page.screenshot({ path: path.join(OUT, '05-relatorios.png'), fullPage: true });

    // --------------------------------------------------------------- 6 gaveta de equipamento
    await clicarNoMenu(page, '/equipamentos');
    await page.waitForURL(/\/equipamentos/, { timeout: 20000 });
    await page.fill('#busca-equipamentos', 'SWI-08-U8');
    const linha = page.locator('tbody tr', { has: page.locator('.mono.forte', { hasText: /^SWI-08-U8$/ }) });
    await linha.waitFor({ state: 'visible', timeout: 20000 });
    await linha.locator('.menu-acoes__gatilho').click();
    await page.locator('.menu-acoes__lista [role="menuitem"]', { hasText: /^\s*Ver\s*$/ }).click();
    await page.waitForSelector('#drawer-equipamento-titulo', { timeout: 20000 });
    const cartao = (rotulo) => page.locator('.gaveta .kpis .kpi', { has: page.locator('.kpi__rotulo', { hasText: rotulo }) });
    await page.waitForFunction(() => {
      const valores = [...document.querySelectorAll('.gaveta .kpis .kpi')].map((k) => k.textContent ?? '');
      return valores.some((t) => /Perda/.test(t) && /%/.test(t)) && valores.some((t) => /Incidentes/.test(t) && /\d/.test(t.replace(/30D/, '')));
    }, null, { timeout: 20000 });
    const perda = (await cartao(/^Perda/).locator('.kpi__valor').textContent()).trim();
    const incidentes = (await cartao(/^Incidentes/).locator('.kpi__valor').textContent()).trim();
    const classes = await page.locator('.gaveta .kpis .kpi').evaluateAll((els) => els.map((el) => ({
      rotulo: el.querySelector('.kpi__rotulo')?.textContent?.trim(), classe: el.className,
    })));
    const coloridos = classes.filter((c) => /kpi--(warn|down)/.test(c.classe));
    checar(6, 'Gaveta de equipamento: perda 0 e 0 incidentes ficam neutros (nenhum kpi--warn/kpi--down)',
      /^0(,0+)?%$/.test(perda) && incidentes === '0' && coloridos.length === 0,
      `perda="${perda}" incidentes="${incidentes}" coloridos=${JSON.stringify(coloridos)}`);
    await page.locator('.gaveta').screenshot({ path: path.join(OUT, '06-gaveta-equipamento-zero.png') });
    await page.locator('.gaveta__fechar').click();
    await page.locator('.gaveta').waitFor({ state: 'detached', timeout: 10000 });

    // --------------------------------------------------------------- 7 gaveta de episódio
    await abrirIncidentes(page, 'Todos');
    const linhaLat = page.locator('tbody tr', { hasText: 'SWI-06-U10' }).filter({ has: page.locator('button.link', { hasText: /^\s*LAT-\d+\s*$/ }) }).first();
    await linhaLat.locator('button.link', { hasText: /^\s*LAT-\d+\s*$/ }).click();
    await page.waitForSelector('#drawer-ocorrencia-titulo', { timeout: 20000 });
    const acima = page.locator('.gaveta .kpis .kpi', { has: page.locator('.kpi__rotulo', { hasText: /^Acima do limiar$/ }) });
    await page.waitForFunction(() => {
      const k = [...document.querySelectorAll('.gaveta .kpis .kpi')].find((el) => el.querySelector('.kpi__rotulo')?.textContent?.trim() === 'Acima do limiar');
      return !!k && /\d/.test(k.querySelector('.kpi__valor')?.textContent ?? '');
    }, null, { timeout: 20000 });
    const valorAcima = (await acima.locator('.kpi__valor').textContent()).trim();
    const classeAcima = await acima.getAttribute('class');
    const limiar = (await page.locator('.gaveta .kpis .kpi', { has: page.locator('.kpi__rotulo', { hasText: /^Limiar$/ }) }).locator('.kpi__valor').textContent()).replace(/\s+/g, ' ').trim();
    checar(7, 'Gaveta de episódio: 0 acima do limiar fica neutro (sem kpi--warn)',
      valorAcima === '0' && !/kpi--warn/.test(classeAcima) && /^\d+\s?ms$/.test(limiar),
      `acima="${valorAcima}" classe="${classeAcima}" limiar="${limiar}"`);
    await page.locator('.gaveta').screenshot({ path: path.join(OUT, '07-gaveta-latencia-zero.png') });
    await page.locator('.gaveta__fechar').click();

    // --------------------------------------------------------------- erros
    checar(8, 'nenhum erro de página no roteiro inteiro', erros.length === 0, erros.join(' | '));
  } catch (erro) {
    fatal = erro;
  } finally {
    fs.writeFileSync(path.join(OUT, 'pre-carga-timeline-e-tela.json'),
      JSON.stringify({ base: BASE, quando: new Date().toISOString(), resultados, rede, erros, fatal: fatal ? String(fatal.stack ?? fatal) : null }, null, 2));
    await page.screenshot({ path: path.join(OUT, 'final.png') }).catch(() => {});
    if (api) await api.fechar();
    await browser.close();
  }

  for (const r of resultados) console.log(`${r.ok ? 'OK   ' : 'FALHA'} [caso ${r.caso}] ${r.nome}${r.detalhe ? ' — ' + r.detalhe : ''}`);
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - falhas}/${resultados.length} verificacoes`);
  if (fatal) {
    console.error('\nEXECUÇÃO INTERROMPIDA — log em ' + path.join(OUT, 'pre-carga-timeline-e-tela.json'));
    console.error(fatal.stack ?? fatal);
  }
  if (fatal || falhas) process.exitCode = 1;
})();

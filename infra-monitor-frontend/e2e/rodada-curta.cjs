/*
 * Rodada curta antes da carga real — timeline só afirma o que lista, e IP só IPv4 de host.
 * Ponta a ponta no navegador, só por clique.
 *
 *   RODADA_EMAIL=<email> RODADA_SENHA=<senha> npm run e2e:rodada-curta
 *   (opcionais: RODADA_BASE=http://127.0.0.1:4200, RODADA_API=http://localhost:8080/api/v1)
 *
 * AMBIENTE: SÓ o banco descartável `infra-e2e` (porta 5437), restaurado de um pg_dump do dev e
 * semeado com `e2e/rodada-curta-seed.sql`. Backend com DB_PORT=5437 e motor/Telegram/dispatcher
 * desligados; `ng serve` em 4200. O caso 8 CRIA um equipamento (escreve no banco descartável).
 *
 * Casos:
 *   1  Incidente RECUPERACAO_AUTOMATICA sem nenhuma resposta no histórico: o fechamento não cita
 *      número de respostas e não há evento "recuperação k/N".
 *   2  Episódio encerrado por INCIDENTE: "Encerrado pela abertura de incidente"; a gaveta não diz
 *      "Latência normalizada".
 *   3  Episódio NORMALIZACAO com a sequência completa: cita "2 medições consecutivas" (controle
 *      positivo — prova que o seletor do detalhe enxerga o texto quando ele existe).
 *   4  Formulário de novo equipamento com IPv6: mensagem sob o campo e nenhum POST /equipamentos.
 *   5  Mesmo formulário com 010.0.0.1: mensagem de zero à esquerda, nenhum POST.
 *   6  API direta: POST /equipamentos com IPv6 → 400 VALIDATION_ERROR, fields.ip com o motivo.
 *   7  API direta: POST com 224.0.0.1 → 400, fields.ip com o motivo de multicast.
 *   8  Controle positivo do formulário: IP " 10.250.0.7 " (com espaços) cria o equipamento e a API
 *      devolve "10.250.0.7".
 *
 * ARMADILHAS herdadas (ver pre-carga-timeline-e-tela.cjs): sessão só em memória (navegação por
 * clique), nada de catch silencioso em seletor, resultados gravados em `finally`.
 */
const { chromium, request: playwrightRequest } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = process.env.RODADA_BASE || 'http://127.0.0.1:4200';
const API = process.env.RODADA_API || 'http://localhost:8080/api/v1';
const EMAIL = process.env.RODADA_EMAIL;
const SENHA = process.env.RODADA_SENHA;
if (!EMAIL || !SENHA) throw new Error('RODADA_EMAIL e RODADA_SENHA são obrigatórias');

const OUT = path.join(__dirname, 'rodada-curta-evidence');
fs.mkdirSync(OUT, { recursive: true });

const resultados = [];
const checar = (caso, nome, ok, detalhe) => { resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' }); };
const rede = [];
const erros = [];

const MSG_IPV6_TELA = 'Apenas IPv4 é suportado: o monitoramento ICMP não sonda IPv6';
const MSG_ZERO_TELA = 'Octeto com zero à esquerda é ambíguo (pode ser lido como octal): escreva 10.0.0.1, não 010.000.000.001';
const MSG_IPV6_API = 'apenas IPv4 e suportado: o monitoramento ICMP nao sonda IPv6';
const MSG_NAO_HOST_API = 'multicast, reservado ou broadcast (224.0.0.0 em diante) nao e endereco de host monitoravel';

async function apiAutenticada() {
  const contexto = await playwrightRequest.newContext();
  const login = await contexto.post(API + '/auth/login', { data: { email: EMAIL, senha: SENHA } });
  if (!login.ok()) throw new Error(`login na API falhou: ${login.status()}`);
  const { accessToken } = await login.json();
  const headers = { Authorization: `Bearer ${accessToken}` };
  const get = async (caminho) => {
    const resposta = await contexto.get(API + caminho, { headers });
    if (!resposta.ok()) throw new Error(`GET ${caminho} -> ${resposta.status()}`);
    return resposta.json();
  };
  const post = (caminho, data) => contexto.post(API + caminho, { headers, data });
  return { get, post, fechar: () => contexto.dispose() };
}

async function clicarNoMenu(page, href) {
  if ((page.viewportSize()?.width ?? 1440) < 769) await page.click('.menu-button');
  await page.click(`a.navigation__item[href="${href}"]`);
}

async function abrirIncidentes(page, aba) {
  await clicarNoMenu(page, '/incidentes');
  await page.waitForURL(/\/incidentes(\/.*)?$/, { timeout: 20000 });
  await page.locator('.aba', { hasText: aba }).click();
  await page.waitForSelector('.incidentes__rolagem tbody tr', { timeout: 20000 });
}

/** Abre a gaveta pelo botão do código (INC-n / LAT-n) e espera o item de fechamento com o rótulo dado. */
async function abrirGaveta(page, codigo, rotuloFechamento) {
  await page.locator('button.link', { hasText: new RegExp(`^\\s*${codigo}\\s*$`) }).click();
  await page.waitForSelector('.gaveta .timeline__item', { timeout: 20000 });
  const item = page.locator('.timeline__item', { has: page.locator('.timeline__rotulo', { hasText: new RegExp(`^${rotuloFechamento}$`) }) });
  await item.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(300);
  return item;
}

async function fecharGaveta(page) {
  await page.locator('.gaveta__fechar').click();
  await page.locator('.gaveta').waitFor({ state: 'detached', timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  let fatal = null;
  let api = null;
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
  page.on('request', (r) => { if (r.url().startsWith(API)) rede.push({ quando: Date.now(), metodo: r.method(), url: r.url().replace(API, '') }); });

  try {
    api = await apiAutenticada();
    const incidente = (await api.get('/incidentes?size=200&status=FECHADO')).content
      .find((inc) => inc.observacao === 'e2e-rodada-curta');
    if (!incidente) throw new Error('incidente do seed ausente: rode e2e/rodada-curta-seed.sql');

    // --------------------------------------------------------------- login por clique
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });

    // --------------------------------------------------------------- 1 AUTO sem sequência
    await abrirIncidentes(page, 'Resolvidos');
    const item1 = await abrirGaveta(page, `INC-${incidente.id}`, 'Incidente fechado');
    const detalhe1 = (await item1.locator('.timeline__detalhe').textContent()).trim();
    const textoGaveta1 = (await page.locator('.gaveta .timeline').textContent()).replace(/\s+/g, ' ');
    const numerados1 = await page.locator('.timeline__rotulo', { hasText: /recuperação \d+\/\d+/ }).count();
    await item1.scrollIntoViewIfNeeded();
    await page.locator('.gaveta').screenshot({ path: path.join(OUT, '01-auto-sem-sequencia.png') });
    checar(1, 'AUTO sem respostas no histórico: fechamento diz que a sequência não está carregada, sem número',
      detalhe1 === 'Recuperação automática registrada pelo motor; a sequência completa de respostas não está no histórico carregado',
      `detalhe="${detalhe1}"`);
    checar(1, 'AUTO sem respostas: nenhum "recuperação k/N" e nenhum "N respostas consecutivas" na timeline',
      numerados1 === 0 && !/\d+\s+respostas?\s+consecutivas?/.test(textoGaveta1), `numerados=${numerados1}`);
    await fecharGaveta(page);

    // --------------------------------------------------------------- 2 e 3 episódios
    await page.locator('.aba', { hasText: 'Todos' }).click();
    await page.waitForSelector('.incidentes__rolagem tbody tr', { timeout: 20000 });
    const codigoLat = async (equipamento) => {
      const linha = page.locator('tbody tr', { hasText: equipamento })
        .filter({ has: page.locator('button.link', { hasText: /^\s*LAT-\d+\s*$/ }) }).first();
      await linha.waitFor({ state: 'visible', timeout: 20000 });
      return (await linha.locator('button.link', { hasText: /^\s*LAT-\d+\s*$/ }).textContent()).trim();
    };

    const lat2 = await codigoLat('ACC-02-U8');
    const item2 = await abrirGaveta(page, lat2, 'Encerrado pela abertura de incidente');
    const detalhe2 = (await item2.locator('.timeline__detalhe').textContent()).trim();
    const textoGaveta2 = (await page.locator('.gaveta').textContent()).replace(/\s+/g, ' ');
    await item2.scrollIntoViewIfNeeded();
    await page.locator('.gaveta').screenshot({ path: path.join(OUT, '02-episodio-incidente.png') });
    checar(2, `${lat2} (INCIDENTE): rótulo e detalhe dizem que a latência não normalizou`,
      detalhe2 === 'O monitor deixou de responder e um incidente foi aberto. A latência não normalizou.', `detalhe="${detalhe2}"`);
    checar(2, `${lat2} (INCIDENTE): a gaveta não diz "Latência normalizada" nem lista normalização`,
      !textoGaveta2.includes('Latência normalizada') && !/normalização \d+\/\d+/.test(textoGaveta2), '');
    await fecharGaveta(page);

    const lat3 = await codigoLat('ACC-03-U7');
    const item3 = await abrirGaveta(page, lat3, 'Latência normalizada');
    const detalhe3 = (await item3.locator('.timeline__detalhe').textContent()).trim();
    const normalizacoes3 = await page.locator('.timeline__rotulo', { hasText: /^Dentro do limiar — normalização \d\/2$/ }).count();
    await item3.scrollIntoViewIfNeeded();
    await page.locator('.gaveta').screenshot({ path: path.join(OUT, '03-episodio-normalizacao-completa.png') });
    checar(3, `${lat3} (NORMALIZACAO completa): cita as 2 medições e lista as 2 numeradas (controle positivo)`,
      detalhe3 === '2 medições consecutivas dentro do limiar encerraram o episódio' && normalizacoes3 === 2,
      `detalhe="${detalhe3}" normalizacoes=${normalizacoes3}`);
    await fecharGaveta(page);

    // --------------------------------------------------------------- 4 e 5 formulário
    await clicarNoMenu(page, '/equipamentos');
    await page.waitForURL(/\/equipamentos/, { timeout: 20000 });
    await page.waitForSelector('tbody tr', { timeout: 20000 });
    await page.locator('button', { hasText: /^\s*\+ Novo equipamento\s*$/ }).first().click();
    const form = page.locator('form', { has: page.locator('input[formControlName="ip"]') });
    await form.waitFor({ state: 'visible', timeout: 10000 });
    await form.locator('input[formControlName="nome"]').fill('E2E-RODADA-IP');
    await form.locator('select[formControlName="tipoEquipamentoId"]').selectOption({ index: 1 });
    await form.locator('select[formControlName="unidadeId"]').selectOption({ index: 1 });

    const tentarIp = async (caso, ip, esperado, arquivo) => {
      await form.locator('input[formControlName="ip"]').fill(ip);
      const antes = Date.now();
      await form.locator('button[type="submit"]').click();
      const erro = page.locator('#equipamento-ip-erro');
      await erro.waitFor({ state: 'visible', timeout: 5000 });
      await page.waitForTimeout(500);
      const texto = (await erro.textContent()).trim();
      const posts = rede.filter((r) => r.quando >= antes && r.metodo === 'POST' && /^\/equipamentos(\?|$)/.test(r.url)).length;
      const invalido = await form.locator('input[formControlName="ip"]').getAttribute('aria-invalid');
      const repetidas = await form.locator('small.field-error', { hasText: esperado }).count();
      await form.screenshot({ path: path.join(OUT, arquivo) });
      checar(caso, `IP "${ip}": mensagem sob o campo, aria-invalid e nenhum POST enviado`,
        texto === esperado && posts === 0 && invalido === 'true' && repetidas === 1,
        `texto="${texto}" posts=${posts} aria-invalid=${invalido} ocorrencias=${repetidas}`);
    };
    await tentarIp(4, '2001:db8::1', MSG_IPV6_TELA, '04-form-ipv6.png');
    await tentarIp(5, '010.0.0.1', MSG_ZERO_TELA, '05-form-zero-a-esquerda.png');

    // --------------------------------------------------------------- 6 e 7 API direta
    const unidade = (await api.get('/unidades'))[0];
    const tipo = (await api.get('/tipos-equipamento'))[0];  // ambos devolvem lista, não página
    for (const [caso, ip, mensagem] of [[6, '2001:db8::1', MSG_IPV6_API], [7, '224.0.0.1', MSG_NAO_HOST_API]]) {
      const resposta = await api.post('/equipamentos', { unidadeId: unidade.id, tipoEquipamentoId: tipo.id, nome: `E2E-API-${caso}`, ip });
      const corpo = await resposta.json().catch(() => null);
      checar(caso, `API: POST com IP "${ip}" é recusado com o motivo em fields.ip`,
        resposta.status() === 400 && corpo?.code === 'VALIDATION_ERROR' && corpo?.fields?.ip === mensagem,
        `status=${resposta.status()} corpo=${JSON.stringify(corpo)}`);
    }

    // --------------------------------------------------------------- 8 controle positivo
    await form.locator('input[formControlName="ip"]').fill(' 10.250.0.7 ');
    const resposta8 = page.waitForResponse((r) => r.url().startsWith(API + '/equipamentos') && r.request().method() === 'POST', { timeout: 15000 });
    await form.locator('button[type="submit"]').click();
    const criado = await resposta8;
    const corpo8 = await criado.json().catch(() => null);
    await page.locator('.equipamentos__aviso').waitFor({ state: 'visible', timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, '08-form-ip-valido-criado.png') });
    checar(8, 'IP válido com espaços: o formulário envia e a API grava "10.250.0.7"',
      criado.status() === 201 && corpo8?.ip === '10.250.0.7', `status=${criado.status()} ip=${corpo8?.ip}`);

    // --------------------------------------------------------------- erros de página
    const errosRelevantes = erros.filter((e) => !/status of 400/.test(e));
    checar(9, 'nenhum erro de página no roteiro inteiro', errosRelevantes.length === 0, errosRelevantes.join(' | '));
  } catch (erro) {
    fatal = erro;
  } finally {
    fs.writeFileSync(path.join(OUT, 'rodada-curta.json'),
      JSON.stringify({ base: BASE, quando: new Date().toISOString(), resultados, rede, erros, fatal: fatal ? String(fatal.stack ?? fatal) : null }, null, 2));
    await page.screenshot({ path: path.join(OUT, 'final.png') }).catch(() => {});
    if (api) await api.fechar();
    await browser.close();
  }

  for (const r of resultados) console.log(`${r.ok ? 'OK   ' : 'FALHA'} [caso ${r.caso}] ${r.nome}${r.detalhe ? ' — ' + r.detalhe : ''}`);
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - falhas}/${resultados.length} verificacoes`);
  if (fatal) {
    console.error('\nEXECUÇÃO INTERROMPIDA — log em ' + path.join(OUT, 'rodada-curta.json'));
    console.error(fatal.stack ?? fatal);
  }
  if (fatal || falhas) process.exitCode = 1;
})();

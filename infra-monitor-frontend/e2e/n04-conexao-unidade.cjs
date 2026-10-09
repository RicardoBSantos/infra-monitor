/*
 * N04 — conexão entre unidades (hub), ponta a ponta no navegador.
 *
 * Cobre o roteiro de homologação inteiro: o select "Conecta a" na gaveta, as duas chamadas do
 * salvamento, o valor recarregado ao reabrir, o DELETE ao voltar para "Nenhuma", a ausência de
 * chamada quando o destino não muda, e a recusa 409 ao excluir um hub com unidades conectadas.
 *
 *   npm run e2e:n04     (exige N04_SENHA no ambiente)
 *
 * Pré-requisitos: backend em 8080, ng serve em 4200 e o PostgreSQL de dev. O roteiro cria uma
 * unidade descartável "ZZ Hub Descartavel <marca>" e a apaga no fim -- se a execução morrer no
 * meio, esse resíduo fica no banco e precisa ser removido à mão.
 *
 * DUAS ARMADILHAS que já custaram tempo aqui, não reintroduzir:
 *
 * 1. Sessão só existe em memória (AuthStateService sem persistência). Qualquer page.goto depois
 *    do login cai em /login?returnUrl=... Toda navegação é por clique.
 * 2. Nada de catch silencioso em seletor. 'input[placeholder*="Buscar"]' casa com a busca global
 *    do cabeçalho E com o filtro da lista; embrulhado em catch, virava filtro que nunca era
 *    aplicado e teste que passava por sorte.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = 'http://127.0.0.1:4200';
const API = 'http://localhost:8080/api/v1';
const EMAIL = 'admin@inframonitor.local';
const SENHA = process.env.N04_SENHA;
if (!SENHA) throw new Error('N04_SENHA é obrigatória');

const OUT = path.join(__dirname, 'n04-evidence');
fs.mkdirSync(OUT, { recursive: true });

const resultados = [];
const checar = (passo, nome, ok, detalhe) => { resultados.push({ passo, nome, ok: !!ok, detalhe }); };

/**
 * Chamadas da API observadas. `rede` é zerada a cada salvamento, porque as asserções falam sobre
 * "o que este salvamento disparou"; `redeCompleta` nunca é zerada e existe para a autópsia.
 *
 * A distinção não é preciosismo: uma execução deste roteiro morreu no meio e não deixou rastro
 * nenhum de rede, e provar que ela NÃO tinha escrito num registro exigiu recorrer a timestamp de
 * banco. O log agora é gravado em finally, aconteça o que acontecer.
 */
let rede = [];
const redeCompleta = [];
const soConexao = () => rede.filter((r) => r.includes('/conexao'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  let fatal = null;
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith(API)) return;
    const linha = `${r.method()} ${r.url().replace(API, '')}`;
    rede.push(linha);
    redeCompleta.push(`${new Date().toISOString()} ${linha}`);
  });
  const respostas = [];
  page.on('response', (r) => { if (r.url().startsWith(API)) respostas.push({ url: r.url().replace(API, ''), status: r.status() }); });

  try {
  // ----------------------------------------------------------------- login
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-senha', SENHA);
  await page.click('.login-submit');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, '00-logado.png') });

  // Unidade cobaia: a de id 8 (Unidade Lagarto). Não é a Sede, que será o destino.
  const ALVO = 8;
  /*
   * Filtro da lista, nao a busca global do cabecalho: 'input[placeholder*="Buscar"]' casa com
   * as DUAS e vira violacao de strict mode. O seletor generico estava embrulhado num catch que
   * engolia o erro -- a lista nunca era filtrada e o teste so passava porque o locator de linha
   * ainda achava o alvo. Sem catch aqui: se o campo mudar, o teste tem de falhar alto.
   */
  const filtrarLista = async (termo) => {
    await page.fill('input[placeholder*="Buscar unidades" i]', termo);
    await page.waitForTimeout(600);
  };

  const irParaLista = async () => {
    await page.click('a[href="/unidades"]');
    await page.waitForSelector('#unidades-titulo', { timeout: 10000 });
    // Limpa filtro remanescente: a lista guarda a busca entre visitas, e um filtro herdado
    // esconderia a linha que o passo seguinte procura.
    await page.fill('input[placeholder*="Buscar unidades" i]', '');
    await page.waitForTimeout(600);
  };
  const abrirGaveta = async () => {
    await irParaLista();
    await page.locator('tr', { hasText: 'Unidade Lagarto' }).first().locator('a:has-text("Ver")').click();
    await page.waitForSelector('button:has-text("Editar unidade")', { timeout: 10000 });
    await page.click('button:has-text("Editar unidade")');
    await page.waitForSelector('select[formControlName="conectaAUnidadeId"]', { timeout: 10000 });
  };
  const salvar = async () => {
    rede = [];
    await page.click('button:has-text("Salvar unidade")');
    await page.waitForSelector('.gaveta', { state: 'detached', timeout: 10000 });
    await page.waitForTimeout(600);
  };

  // ----------------------------------------------------------------- passo 1
  await irParaLista();
  const totalNaLista = Number((await page.textContent('body')).match(/(\d+) de (\d+) unidades/)?.[2] ?? 0);
  await abrirGaveta();
  const opcoes = await page.$$eval('select[formControlName="conectaAUnidadeId"] option',
    (os) => os.map((o) => ({ valor: o.value, texto: o.textContent.trim() })));
  /*
   * Sem número mágico: opções = (todas as unidades) - (a própria) + ("Nenhuma"), então a
   * contagem tem de bater com o total que a própria lista anuncia. Cravar 11 fazia o teste
   * falhar só porque o banco de dev tinha uma unidade a mais.
   */
  checar(1, 'select "Conecta a" existe com "Nenhuma" + as outras unidades',
    opcoes.length === totalNaLista && opcoes[0].texto === 'Nenhuma (unidade raiz)'
      && !opcoes.some((o) => o.texto.includes('Lagarto')),
    `${opcoes.length} opções para ${totalNaLista} unidades; primeira="${opcoes[0].texto}"; própria unidade ausente=${!opcoes.some((o) => o.texto.includes('Lagarto'))}`);
  await page.screenshot({ path: path.join(OUT, '01-select-conecta-a.png') });

  // ----------------------------------------------------------------- passo 2
  const sede = opcoes.find((o) => o.texto.includes('Sede Administrativa'));
  await page.selectOption('select[formControlName="conectaAUnidadeId"]', sede.valor);
  await salvar();
  checar(2, 'PUT /unidades/{id} seguido de PUT /unidades/{id}/conexao',
    rede[0] === `PUT /unidades/${ALVO}` && rede[1] === `PUT /unidades/${ALVO}/conexao`,
    rede.join(' → '));

  // ----------------------------------------------------------------- passo 3
  await abrirGaveta();
  const selecionado = await page.$eval('select[formControlName="conectaAUnidadeId"]', (s) => s.value);
  const rotuloSelecionado = await page.$eval('select[formControlName="conectaAUnidadeId"]',
    (s) => s.options[s.selectedIndex].textContent.trim());
  checar(3, 'ao reabrir, o select vem com "Sede Administrativa" marcada',
    selecionado === sede.valor, `value="${selecionado}" rótulo="${rotuloSelecionado}"`);
  await page.screenshot({ path: path.join(OUT, '03-reabre-com-sede.png') });

  // ----------------------------------------------------------------- passo 4
  await page.selectOption('select[formControlName="conectaAUnidadeId"]', '');
  await salvar();
  checar(4, 'voltar para "Nenhuma" emite DELETE /unidades/{id}/conexao',
    soConexao().length === 1 && soConexao()[0] === `DELETE /unidades/${ALVO}/conexao`,
    rede.join(' → '));

  // ----------------------------------------------------------------- passo 5
  await abrirGaveta();
  const nomeInput = page.locator('input[formControlName="nome"]');
  const nomeOriginal = await nomeInput.inputValue();
  await nomeInput.fill(nomeOriginal + ' X');
  await salvar();
  checar(5, 'salvar só o nome não dispara chamada de conexão',
    soConexao().length === 0, rede.join(' → ') || '(nenhuma)');

  // devolve o nome original
  await abrirGaveta();
  await page.locator('input[formControlName="nome"]').fill(nomeOriginal);
  await salvar();

  // ----------------------------------------------------------------- passo 6
  /*
   * Duas metades, e a distinção importa: a recusa por equipamentos associados já existia,
   * e é ela que a Sede dispara primeiro. Para provar a regra NOVA (unidades conectadas)
   * é preciso um alvo sem equipamento -- daí a unidade descartável, apagada no fim.
   */
  await irParaLista();
  await page.click('button:has-text("+ Nova unidade")');
  await page.waitForSelector('select[formControlName="conectaAUnidadeId"]');
  const marca = Date.now().toString().slice(-6);
  await page.fill('input[formControlName="nome"]', `ZZ Hub Descartavel ${marca}`);
  await page.fill('input[formControlName="sigla"]', `ZZH${marca.slice(-3)}`);
  await salvar();

  // conecta a cobaia ao hub descartável pela própria interface
  await abrirGaveta();
  const opcoes2 = await page.$$eval('select[formControlName="conectaAUnidadeId"] option',
    (os) => os.map((o) => ({ valor: o.value, texto: o.textContent.trim() })));
  const hub = opcoes2.find((o) => o.texto.includes(`ZZ Hub Descartavel ${marca}`));
  checar(6, 'unidade recém-criada aparece como destino possível', !!hub, hub ? hub.texto : 'ausente');
  await page.selectOption('select[formControlName="conectaAUnidadeId"]', hub.valor);
  await salvar();

  // tenta excluir o hub que agora tem uma unidade conectada
  await irParaLista();
  await filtrarLista(`ZZ Hub Descartavel ${marca}`);
  await page.waitForTimeout(800);
  const linhaHub = page.locator('tr', { hasText: `ZZ Hub Descartavel ${marca}` }).first();
  await linhaHub.locator('button:has-text("Excluir")').click();
  await page.click('button:has-text("Excluir unidade")');
  await page.waitForTimeout(1200);
  const respostaExclusao = respostas.filter((r) => /\/unidades\/\d+$/.test(r.url) && r.status >= 400).pop();
  const mensagemTela = await page.locator('.confirm-dialog, .dialogo, [role="alertdialog"]').innerText().catch(() => '');
  checar(6, 'excluir hub com unidade conectada responde 409, com mensagem na tela',
    respostaExclusao?.status === 409 && /conectad/i.test(mensagemTela),
    `status=${respostaExclusao?.status} | tela="${mensagemTela.replace(/\s+/g, ' ').slice(0, 160)}"`);
  await page.screenshot({ path: path.join(OUT, '06-409-conectadas.png') });

  // ----------------------------------------------------------------- limpeza
  // O ConfirmDialog fica aberto exibindo o erro do 409; fechar pelo Cancelar, nao pelo Escape
  // -- o backdrop intercepta qualquer clique enquanto estiver montado.
  await page.click('.confirm-dialog button:has-text("Cancelar")');
  await page.waitForSelector('.dialog-backdrop', { state: 'detached', timeout: 10000 });
  await abrirGaveta();
  await page.selectOption('select[formControlName="conectaAUnidadeId"]', '');
  await salvar();
  await irParaLista();
  await filtrarLista(`ZZ Hub Descartavel ${marca}`);
  await page.waitForTimeout(800);
  const linhaLimpeza = page.locator('tr', { hasText: `ZZ Hub Descartavel ${marca}` }).first();
  await linhaLimpeza.locator('button:has-text("Excluir")').click();
  await page.click('button:has-text("Excluir unidade")');
  await page.waitForTimeout(1200);
  const sumiu = await page.locator('tr', { hasText: `ZZ Hub Descartavel ${marca}` }).count();
  checar(6, 'limpeza: unidade descartável removida ao final', sumiu === 0, `linhas restantes=${sumiu}`);

  checar(0, 'nenhum erro de página durante o roteiro', erros.length === 0, erros.join(' | '));
  } catch (erro) {
    fatal = erro;
  } finally {
    // Evidência ANTES de qualquer coisa poder falhar de novo: é o único registro de quais
    // escritas o roteiro chegou a disparar.
    fs.writeFileSync(path.join(OUT, 'n04-conexao-unidade.json'),
      JSON.stringify({ resultados, rede: redeCompleta, respostas, erros, fatal: fatal ? String(fatal) : null }, null, 2));
    await page.screenshot({ path: path.join(OUT, 'final.png') }).catch(() => {});
    await browser.close();
  }

  for (const r of resultados) console.log(`${r.ok ? 'OK   ' : 'FALHA'} [passo ${r.passo}] ${r.nome}${r.detalhe ? ' — ' + r.detalhe : ''}`);
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - falhas}/${resultados.length} verificacoes`);
  if (fatal) {
    console.error('\nEXECUÇÃO INTERROMPIDA — log de rede em ' + path.join(OUT, 'n04-conexao-unidade.json'));
    console.error(fatal.message ?? fatal);
    // Resíduo provável: unidade "ZZ Hub Descartavel" e a conexão da unidade cobaia.
    process.exit(2);
  }
  process.exit(falhas ? 1 : 0);
})();

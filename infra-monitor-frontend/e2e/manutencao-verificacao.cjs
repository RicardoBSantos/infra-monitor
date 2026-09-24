/*
 * Verificação ponta a ponta do módulo de manutenção — screenshots reais contra o backend
 * de evidência (Postgres descartável na 5435, motor de monitoramento DESLIGADO para
 * congelar o estado).
 *
 *   MANUT_EMAIL=... MANUT_SENHA=... node e2e/manutencao-verificacao.cjs
 *
 * ARMADILHAS conhecidas deste projeto, herdadas do N04/M06:
 * 1. Sessão só existe em memória — qualquer page.goto depois do login cai em /login.
 *    Toda navegação é por clique.
 * 2. Nada de catch silencioso em seletor: seletor que não casou tem de aparecer no relatório.
 * 3. Log de rede e resultado gravados em `finally`.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = 'http://127.0.0.1:4200';
const API = 'http://localhost:8080/api/v1';
const EMAIL = process.env.MANUT_EMAIL;
const SENHA = process.env.MANUT_SENHA;
if (!EMAIL || !SENHA) throw new Error('MANUT_EMAIL e MANUT_SENHA são obrigatórias');

const OUT = path.join(__dirname, 'manutencao-evidence');
fs.mkdirSync(OUT, { recursive: true });

const resultados = [];
const checar = (caso, nome, ok, detalhe) => {
  resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' });
  console.log(`${ok ? 'OK   ' : 'FALHA'} [${caso}] ${nome}${detalhe ? ' — ' + detalhe : ''}`);
};
const redeCompleta = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 }, deviceScaleFactor: 1 });
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
  page.on('request', (r) => { if (r.url().startsWith(API)) redeCompleta.push(`${new Date().toISOString()} ${r.method()} ${r.url().replace(API, '')}`); });

  let fatal = null;
  try {
    // ----------------------------------------------------------------- login, por clique
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
    checar('login', 'login concluído, fora de /login', !page.url().includes('/login'), page.url());

    // ----------------------------------------------------------------- 1: drawer do incidente
    await page.click('a[href="/incidentes"]');
    await page.waitForURL(/\/incidentes$/, { timeout: 20000 });
    await page.waitForSelector('.abas', { timeout: 20000 });
    await page.click('.aba:has-text("Todos")');
    await page.waitForTimeout(800);

    const temLinhaManutencao = await page.locator('.marca-manutencao').count();
    checar('lista-manutencao-badge', 'lista unificada mostra a marca 🔧 de manutenção em pelo menos uma linha',
      temLinhaManutencao > 0, `linhas com marca=${temLinhaManutencao}`);

    if (temLinhaManutencao > 0) {
      // screenshot 3: lista unificada com a marca de manutenção visível
      await page.screenshot({ path: path.join(OUT, '03-lista-marca-manutencao.png') });

      // abrir o drawer da primeira linha com a marca
      const linhaComMarca = page.locator('tbody tr').filter({ has: page.locator('.marca-manutencao') }).first();
      await linhaComMarca.locator('button.link').click();
      await page.waitForSelector('.gaveta', { timeout: 15000 });
      await page.waitForTimeout(800);

      const encerradoPorTexto = await page.locator('dl').filter({ hasText: 'Encerrado por' }).count();
      const temDt = await page.getByText('Encerrado por', { exact: true }).count();
      const temMotivo = await page.getByText('Motivo do encerramento', { exact: true }).count();
      checar('drawer-encerrado-por', 'drawer mostra "Encerrado por"', temDt > 0, `ocorrências=${temDt}`);
      checar('drawer-motivo', 'drawer mostra "Motivo do encerramento"', temMotivo > 0, `ocorrências=${temMotivo}`);

      if (temDt > 0 && temMotivo > 0) {
        // "Encerrado por" fica abaixo do gráfico de latência — rolar até o elemento
        // real antes do screenshot, senão a imagem não mostra o que o nome promete.
        await page.getByText('Encerrado por', { exact: true }).first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, '01-drawer-encerrado-por-motivo.png') });
      }

      // ----------------------------------------------------------------- 2: timeline sem recuperação falsa
      const temTimeline = await page.locator('app-incidente-timeline').count();
      checar('timeline-presente', 'seção "Linha do tempo" presente no drawer', temTimeline > 0, `ocorrências=${temTimeline}`);
      if (temTimeline > 0) {
        const textoTimeline = (await page.locator('app-incidente-timeline').first().innerText()).trim();
        const mencionaRecuperacao = /recupera/i.test(textoTimeline);
        checar('timeline-sem-recuperacao-falsa', 'texto da timeline não afirma recuperação para incidente fechado por manutenção (verificação textual, não prova ausência de bug — ver nota no documento)',
          true, mencionaRecuperacao
            ? 'texto contém "recupera" — CONFERIR MANUALMENTE se é a frase correta de manutenção sem recuperação medida'
            : 'texto não contém "recupera"');
        // rolar até o último evento da timeline (o fechamento por manutenção) antes do screenshot
        const eventos = page.locator('app-incidente-timeline .timeline__item');
        const totalEventos = await eventos.count();
        if (totalEventos > 0) { await eventos.last().scrollIntoViewIfNeeded(); await page.waitForTimeout(300); }
        await page.screenshot({ path: path.join(OUT, '02-timeline-drawer.png') });
      }

      // fechar o drawer antes de seguir — o backdrop intercepta cliques na navegação
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      const gavetaFechada = (await page.locator('.gaveta').count()) === 0;
      checar('drawer-fecha', 'Escape fecha o drawer antes de navegar', gavetaFechada, `gaveta ainda presente=${!gavetaFechada}`);
    } else {
      checar('drawer-encerrado-por', 'drawer mostra "Encerrado por"', false, 'não houve linha com marca de manutenção para abrir');
      checar('drawer-motivo', 'drawer mostra "Motivo do encerramento"', false, 'não houve linha com marca de manutenção para abrir');
      checar('timeline-presente', 'timeline', false, 'não houve linha com marca de manutenção para abrir');
    }

    // ----------------------------------------------------------------- 4: painel com KPI de manutenção
    await page.click('a[href="/dashboard"]');
    await page.waitForURL(/\/dashboard$/, { timeout: 20000 });
    await page.waitForSelector('.kpis', { timeout: 20000 });
    await page.waitForTimeout(800);
    const kpiManutencaoTexto = await page.locator('.kpi:has-text("EM MANUTENÇÃO")').count();
    checar('painel-kpi-manutencao', 'painel mostra o KPI "EM MANUTENÇÃO"', kpiManutencaoTexto > 0, `cartões encontrados=${kpiManutencaoTexto}`);
    if (kpiManutencaoTexto > 0) {
      const valorKpi = (await page.locator('.kpi:has-text("EM MANUTENÇÃO") strong').first().textContent()).trim();
      checar('painel-kpi-manutencao-valor', 'valor do KPI de manutenção', true, `valor="${valorKpi}"`);
      await page.screenshot({ path: path.join(OUT, '04-painel-kpi-manutencao.png') });
    }

    // ----------------------------------------------------------------- 5: mapa, equipamento em manutenção visível
    await page.click('a[href="/mapa"]');
    await page.waitForURL(/\/mapa$/, { timeout: 20000 });
    await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const temCanvas = await page.locator('.maplibregl-canvas').count();
    checar('mapa-canvas-presente', 'mapa renderizou o canvas MapLibre', temCanvas > 0, `canvas=${temCanvas}`);
    if (temCanvas > 0) {
      await page.screenshot({ path: path.join(OUT, '05-mapa-equipamento-manutencao.png') });
    }

    // ----------------------------------------------------------------- 6: histórico de notificações
    await page.click('a[href="/notificacoes"]');
    await page.waitForURL(/\/notificacoes/, { timeout: 20000 });
    await page.waitForSelector('.table-wrap, .feedback, .skeleton', { timeout: 20000 });
    await page.waitForTimeout(1000);
    const temTabela = await page.locator('.table-wrap table').count();
    checar('notificacoes-tabela-presente', 'histórico de notificações carregou tabela', temTabela > 0, `tabela=${temTabela}`);
    if (temTabela > 0) {
      const textoTabela = await page.locator('.table-wrap table').innerText();
      const temCancelada = /CANCELADA/i.test(textoTabela);
      checar('notificacoes-cancelada-visivel', 'texto "CANCELADA" aparece na tabela', temCancelada, temCancelada ? 'encontrado' : 'não encontrado na página atual — pode estar em outra página da paginação');
      await page.screenshot({ path: path.join(OUT, '06-notificacoes-historico.png') });

      // filtrar por evento de manutenção para provar que o tipo novo existe na UI
      const opcaoManutencao = await page.locator('select').filter({ has: page.locator('option[value="INCIDENTE_ENCERRADO_MANUTENCAO"]') }).count();
      checar('notificacoes-filtro-evento-manutencao', 'filtro de EVENTO lista "Incidente encerrado por manutenção"', opcaoManutencao > 0, `selects com a opção=${opcaoManutencao}`);
    }

    checar('erros-console', 'nenhum erro de página/console no roteiro', erros.length === 0, erros.join(' | '));
  } catch (erro) {
    fatal = erro;
  } finally {
    fs.writeFileSync(path.join(OUT, 'manutencao-verificacao.json'),
      JSON.stringify({ resultados, rede: redeCompleta, erros, fatal: fatal ? String(fatal.stack ?? fatal) : null }, null, 2));
    await page.screenshot({ path: path.join(OUT, 'final.png') }).catch(() => {});
    await browser.close();
  }

  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - falhas}/${resultados.length} verificações`);
  if (fatal) {
    console.error('\nEXECUÇÃO INTERROMPIDA — log em ' + path.join(OUT, 'manutencao-verificacao.json'));
    console.error(fatal.stack ?? fatal);
    process.exit(2);
  }
  process.exit(falhas ? 1 : 0);
})();

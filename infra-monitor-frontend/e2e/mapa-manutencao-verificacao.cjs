/*
 * Evidência do mapa — marcador de unidade cujo ÚNICO equipamento está em manutenção.
 *
 * Refaz a tela 5 de `Docs/validacao-producao/manutencao-verificacao-ponta-a-ponta.md`, que ficou
 * sem prova porque a unidade de teste tinha sido cadastrada sem coordenadas. Aqui as duas unidades
 * de teste têm código IBGE + latitude/longitude copiados do dev-seed
 * (`infra-monitor-backend/db/dev-seed/01-unidades-coordenadas.sql`: Itabaiana e Lagarto).
 *
 * Roda contra o ambiente descartável (Postgres 5435, backend com motor e dispatcher DESLIGADOS
 * depois do cadastro, estado congelado):
 *
 *   MAPA_EMAIL=... MAPA_SENHA=... MAPA_BASE=http://127.0.0.1:4300 node e2e/mapa-manutencao-verificacao.cjs
 *
 * Cor esperada derivada do código ANTES de subir o ambiente:
 *   - OperationalStatusResolver.unidade(): unidade cujo único equipamento ativo está EM_MANUTENCAO
 *     -> `monitorados` vazio e `ativos` contém EM_MANUTENCAO -> StatusOperacionalUnidade.EM_MANUTENCAO.
 *   - mapa.component.ts, COR_DO_STATUS: 'em-manutencao': '#7fadff' -> rgb(127, 173, 255),
 *     aplicada por `alvo.style.setProperty('--cor-unidade', corDoStatus(unidade.status))` e lida em
 *     `.map__unidade { background: var(--cor-unidade, #9dabb9) }` (mapa.component.scss).
 * Se a cor obtida divergir, o roteiro REGISTRA esperado × obtido e segue — não ajusta nada.
 *
 * ARMADILHAS conhecidas deste projeto:
 * 1. Sessão só existe em memória — page.goto depois do login cai em /login. Toda navegação é por clique.
 * 2. Nada de catch silencioso em seletor: seletor que não casou aparece no resultado.
 * 3. Log de rede e resultado gravados em `finally`.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = process.env.MAPA_BASE || 'http://127.0.0.1:4200';
const API = 'http://localhost:8080/api/v1';
const EMAIL = process.env.MAPA_EMAIL;
const SENHA = process.env.MAPA_SENHA;
if (!EMAIL || !SENHA) throw new Error('MAPA_EMAIL e MAPA_SENHA são obrigatórias');

const UNIDADE_MANUTENCAO = { id: '1', nome: 'Unidade E2E Mapa Manutencao', equipamento: 'EQ-192.0.2.11' };
const UNIDADE_CONTRASTE = { id: '2', nome: 'Unidade E2E Mapa Contraste' };
const ESPERADO_MANUTENCAO = { status: 'EM_MANUTENCAO', hex: '#7fadff', rgb: 'rgb(127, 173, 255)' };
const ESPERADO_CONTRASTE = { status: 'INDISPONIVEL', hex: '#f84e54', rgb: 'rgb(248, 78, 84)' };

// MAPA_EXECUCAO separa execuções num subdiretório (a 1ª rodada, com código IBGE divergente da
// coordenada, fica guardada à parte — ver documento).
const OUT = path.join(__dirname, 'mapa-manutencao-evidence', process.env.MAPA_EXECUCAO || '');
fs.mkdirSync(OUT, { recursive: true });

const resultados = [];
const checar = (caso, nome, ok, detalhe) => {
  resultados.push({ caso, nome, ok: !!ok, detalhe: detalhe ?? '' });
  console.log(`${ok ? 'OK   ' : 'FALHA'} [${caso}] ${nome}${detalhe ? ' — ' + detalhe : ''}`);
};
const rede = [];
const cores = {};

/** Cor do marcador lida do DOM: variável inline, cor computada do miolo e da borda do pulso. */
async function corDoMarcador(page, unidadeId) {
  return page.evaluate((id) => {
    const botao = document.querySelector(`.map__unidade[data-unidade-id="${id}"]`);
    if (!botao) return null;
    return {
      corUnidadeInline: botao.style.getPropertyValue('--cor-unidade'),
      backgroundColor: getComputedStyle(botao).backgroundColor,
      pulsoBorderColor: getComputedStyle(botao, '::after').borderTopColor,
      ariaLabel: botao.getAttribute('aria-label'),
      ariaPressed: botao.getAttribute('aria-pressed'),
    };
  }, unidadeId);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 }, deviceScaleFactor: 2 });
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
  page.on('response', (r) => { if (r.url().startsWith(API)) rede.push(`${new Date().toISOString()} ${r.request().method()} ${r.url().replace(API, '')} -> ${r.status()}`); });

  let fatal = null;
  try {
    // ------------------------------------------------------------------ login, por clique
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-senha', SENHA);
    await page.click('.login-submit');
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
    checar('login', 'login concluído, fora de /login', !page.url().includes('/login'), page.url());

    // ------------------------------------------------------------------ mapa pelo menu
    await page.click('a[href="/mapa"]');
    await page.waitForURL(/\/mapa$/, { timeout: 20000 });
    await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
    const seletorMarcador = `.map__unidade[data-unidade-id="${UNIDADE_MANUTENCAO.id}"]`;
    await page.waitForSelector(seletorMarcador, { timeout: 30000 });
    // Câmera e pulso assentarem antes de ler e fotografar.
    await page.waitForTimeout(2500);
    checar('mapa-url', 'navegação por clique chegou a /mapa', /\/mapa$/.test(page.url()), page.url());

    const semLocalizacao = await page.locator('.map-feedback:has-text("Unidades sem localização")').count();
    checar('sem-localizacao-vazia', 'nenhuma unidade de teste caiu em "Unidades sem localização"', semLocalizacao === 0, `blocos=${semLocalizacao}`);

    // ------------------------------------------------------------------ cor do marcador em manutenção
    cores.manutencao = await corDoMarcador(page, UNIDADE_MANUTENCAO.id);
    checar('marcador-manutencao-existe', 'marcador da unidade em manutenção existe no DOM', !!cores.manutencao, JSON.stringify(cores.manutencao));
    if (cores.manutencao) {
      checar('marcador-manutencao-rotulo', 'aria-label do marcador diz o status "Em manutenção"',
        /manuten/i.test(cores.manutencao.ariaLabel || ''), cores.manutencao.ariaLabel);
      checar('marcador-manutencao-variavel', `--cor-unidade inline = ${ESPERADO_MANUTENCAO.hex}`,
        cores.manutencao.corUnidadeInline.trim().toLowerCase() === ESPERADO_MANUTENCAO.hex,
        `esperado=${ESPERADO_MANUTENCAO.hex} obtido=${cores.manutencao.corUnidadeInline}`);
      checar('marcador-manutencao-cor', `cor computada do miolo = ${ESPERADO_MANUTENCAO.rgb}`,
        cores.manutencao.backgroundColor === ESPERADO_MANUTENCAO.rgb,
        `esperado=${ESPERADO_MANUTENCAO.rgb} obtido=${cores.manutencao.backgroundColor}`);
      checar('marcador-manutencao-pulso', `cor do anel de pulso (::after) = ${ESPERADO_MANUTENCAO.rgb}`,
        cores.manutencao.pulsoBorderColor === ESPERADO_MANUTENCAO.rgb,
        `esperado=${ESPERADO_MANUTENCAO.rgb} obtido=${cores.manutencao.pulsoBorderColor}`);
    }

    // ------------------------------------------------------------------ contraste: a outra unidade
    cores.contraste = await corDoMarcador(page, UNIDADE_CONTRASTE.id);
    checar('marcador-contraste-cor', `unidade de contraste (.10, incidente aberto) = ${ESPERADO_CONTRASTE.rgb}`,
      !!cores.contraste && cores.contraste.backgroundColor === ESPERADO_CONTRASTE.rgb,
      `esperado=${ESPERADO_CONTRASTE.rgb} obtido=${cores.contraste && cores.contraste.backgroundColor}`);

    // ------------------------------------------------------------------ screenshots 01 (de perto) e 02 (inteiro)
    const caixa = await page.locator(seletorMarcador).boundingBox();
    checar('marcador-visivel', 'marcador tem caixa na tela', !!caixa, JSON.stringify(caixa));
    if (caixa) {
      const cx = caixa.x + caixa.width / 2; const cy = caixa.y + caixa.height / 2; const r = 90;
      await page.screenshot({ path: path.join(OUT, '01-marcador-em-manutencao.png'),
        clip: { x: Math.max(0, cx - r), y: Math.max(0, cy - r), width: 2 * r, height: 2 * r } });
    }
    await page.screenshot({ path: path.join(OUT, '02-mapa-inteiro.png') });

    // ------------------------------------------------------------------ clique no marcador -> painel
    await page.locator(seletorMarcador).click();
    // Espera QUALQUER reação do painel: o da unidade, ou o do município. Se só o do município
    // aparecer, o clique no marcador foi sobrescrito — isto é registrado, não contornado.
    await page.waitForSelector('.unit-panel, .selected-panel', { timeout: 15000 });
    await page.waitForTimeout(1200);
    const temPainelUnidade = (await page.locator('.unit-panel').count()) === 1;
    const painelMunicipio = (await page.locator('.selected-panel').count())
      ? (await page.locator('.selected-panel').innerText()).replace(/\s+/g, ' ').trim() : null;
    checar('clique-abre-painel-unidade', 'clique no marcador abre o painel da unidade', temPainelUnidade,
      temPainelUnidade ? 'painel da unidade aberto' : `só o painel do município apareceu: "${painelMunicipio}"`);
    if (!temPainelUnidade) {
      await page.screenshot({ path: path.join(OUT, '03-clique-no-marcador-sem-painel-da-unidade.png') });
      throw new Error('clique no marcador não abriu o painel da unidade — ver checagem clique-abre-painel-unidade');
    }
    await page.waitForSelector('.afetados__item, .unit-panel__vazio', { timeout: 15000 });
    await page.waitForTimeout(600);

    const nomePainel = (await page.locator('.unit-panel__nome').innerText()).trim();
    checar('painel-unidade', 'painel mostra a unidade clicada', nomePainel === UNIDADE_MANUTENCAO.nome, `nome="${nomePainel}"`);
    const badgeUnidade = (await page.locator('.unit-panel > app-status-badge').first().innerText()).trim();
    checar('painel-badge-unidade', 'badge da unidade = "Em manutenção"', badgeUnidade === 'Em manutenção', `badge="${badgeUnidade}"`);
    const kpiManut = (await page.locator('.unit-kpis div:has(dt:text-is("EM MANUTENÇÃO")) dd').innerText()).trim();
    checar('painel-kpi-manutencao', 'KPI EM MANUTENÇÃO da unidade = 1', kpiManut === '1', `valor="${kpiManut}"`);

    const item = page.locator('.afetados__item').filter({ hasText: UNIDADE_MANUTENCAO.equipamento });
    const itens = await item.count();
    checar('painel-equipamento', `equipamento ${UNIDADE_MANUTENCAO.equipamento} listado em "Equipamentos afetados"`, itens === 1, `itens=${itens}`);
    if (itens === 1) {
      const badgeEquip = (await item.locator('app-status-badge').innerText()).trim();
      checar('painel-badge-equipamento', 'badge do equipamento = "Em manutenção"', badgeEquip === 'Em manutenção', `badge="${badgeEquip}"`);
    }
    cores.manutencaoSelecionado = await corDoMarcador(page, UNIDADE_MANUTENCAO.id);
    checar('marcador-selecionado-cor', 'marcador selecionado mantém a cor de manutenção',
      !!cores.manutencaoSelecionado && cores.manutencaoSelecionado.ariaPressed === 'true'
        && cores.manutencaoSelecionado.backgroundColor === ESPERADO_MANUTENCAO.rgb,
      JSON.stringify(cores.manutencaoSelecionado));
    await page.screenshot({ path: path.join(OUT, '03-painel-equipamento-em-manutencao.png') });

    checar('sem-erros-pagina', 'nenhum erro de página/console durante o roteiro', erros.length === 0, erros.join(' | '));
  } catch (e) {
    fatal = e.stack || String(e);
    console.error('FATAL', fatal);
  } finally {
    const aprovados = resultados.filter((r) => r.ok).length;
    fs.writeFileSync(path.join(OUT, 'mapa-manutencao-verificacao.json'), JSON.stringify({
      executadoEm: new Date().toISOString(), base: BASE,
      esperado: { manutencao: ESPERADO_MANUTENCAO, contraste: ESPERADO_CONTRASTE },
      obtido: cores,
      resumo: `${aprovados}/${resultados.length}`, fatal, resultados, erros, rede,
    }, null, 2));
    console.log(`\n${aprovados}/${resultados.length} verificações${fatal ? ' — FATAL' : ''}`);
    await browser.close();
    if (fatal || aprovados !== resultados.length) process.exitCode = 1;
  }
})();

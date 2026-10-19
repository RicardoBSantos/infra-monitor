# Mapa — legenda sobre o mapa, painel de 420px, folga mínima (D21) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover a legenda recolhível do painel lateral para cima do mapa (canto inferior esquerdo), alargar o painel para ~420px e reduzir a folga do Mapa para 12px uniformes — mudanças só visuais.

**Architecture:** Tudo vive em `features/mapa/mapa.component.{html,scss}`. O `<details class="legend-bloco">` sai do `<aside class="map-panel">` e entra no `<section class="map-card">`, posicionado em absoluto com a mesma placa translúcida do `.map-titulo`. A grade `.map-layout` troca a coluna fixa de 320px por `clamp(340px, 30vw, 420px)`. Padding/gap 16px → 12px. O shell comum NÃO é tocado.

**Tech Stack:** Angular (standalone, signals, control flow `@if`), SCSS, MapLibre GL, Playwright (roteiros `.cjs` em `infra-monitor-frontend/e2e/`).

**Spec:** design bounded aprovado em chat (2026-10-19), resumido aqui:
- Investigação: `.shell__main` não tem padding (`application-shell.component.scss:3`). Toda folga vem do Mapa: `.map-page { padding:16px }` e `.map-layout { gap: var(--im-space-4) }` (16px). Logo, é do componente.
- Legenda no canto **inferior esquerdo** do cartão: sup. esq. = título; sup. dir. = NavigationControl + "Ver estado inteiro" (top 104px); inf. dir. encosta no painel. Ancorada em `bottom`, cresce para cima ao abrir. Fechada por padrão. Mesma placa do título (legibilidade).
- Painel `clamp(340px, 30vw, 420px)`: 420 a partir de 1400px de viewport; piso 340 em ≤1133px; empilha ≤900px (breakpoint mantido). Mínimo suportado: 390px de viewport (empilhado).
- Espaçamento: `padding` e `gap` = `var(--im-space-3)` (12px) em todas as larguras.

## Global Constraints

- Sem tocar `src/app/layout/**` (shell, sidebar, topbar) nem `src/styles/**`.
- Seletores que os e2e usam continuam: `details.legend-bloco`, `summary.legend-bloco__resumo`, `.legend-bloco > .legend li`, `.legend-bloco > .legend__nota`, `.map-panel`, `.map-panel__topo .botao`, `.map-card`, `.map-titulo`.
- Textos da legenda inalterados (as duas notas exatas: `Município é neutro: situa, não indica estado.` / `Arco liga unidade ao hub, na cor do status.`).
- Comentários em português, no tom dos existentes; decisão nova do Mapa é **D21** em `Docs/mapa-architecture/mapa-decisoes.md` + `mapa-contexto-atual.md`, no mesmo commit da mudança (regra do projeto).
- e2e: navegação só por clique após login; sem `catch` silencioso em seletor; resultados gravados em `finally`.
- Nunca gravar senha em arquivo versionado. Capturas da carga (rede real) ficam FORA do repositório.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Cartão baixo (1024x768, 1280x720, empilhado 390x844): legenda aberta não pode cobrir o título — `max-height` + rolagem própria.
2. Legenda aberta não pode sobrepor NavigationControl nem "Ver estado inteiro" (zoom aproximado).
3. Tema claro: placa segue o tema (como o título); texto continua legível sobre o canvas escuro.
4. Painel de 340px (1024–1133px): KPIs em duas colunas sem `dt` estourando (`scrollWidth <= clientWidth`).
5. Câmera calibrada contra a proporção do cartão (`OFFSET_CAMERA`): cartão mais estreito pode desequilibrar o enquadramento — `e2e:n06` caso 4 e `e2e:n08` têm de seguir verdes.

Cada item tem verificação no roteiro novo da Task 2 (itens 1–4) ou na regressão da Task 3/Task 4 (item 5).

---

### Task 1: Componente — legenda no cartão, painel clamp, folga 12px

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.html:18-22, 67-85`
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.scss:225, 239, 243 (media queries), 282-292, 306`

**Interfaces:**
- Produces: DOM `section.map-card > details.legend-bloco` (filho direto do cartão); `.map-panel` sem legenda. Largura do painel = `clamp(340px, 30vw, 420px)`. `.map-page` padding 12px; `.map-layout` gap 12px.

- [ ] **Step 1: Mover o `<details>` no HTML**

Remover o bloco das linhas 67–85 (comentário + `<details class="legend-bloco">…</details>`) de dentro do `<aside>`. Inserir dentro do `.map-card`, logo depois do `@if (... foraDoEnquadramento()) { … map__voltar … }` e antes do `<p class="map-sr">`:

```html
    <!-- Legenda SOBRE o mapa (D21), canto inferior esquerdo. Sup. esq. é do título, sup. dir. do zoom
         e do "Ver estado inteiro"; inf. dir. encostaria no painel. Ancorada em `bottom`, ela cresce
         para cima ao abrir e não empurra nada. Fechada por padrão (D20). A legenda descreve a cor do
         MARCADOR DE UNIDADE, não a do polígono: o município é contorno + fundo neutro (N07). -->
    @if (state() === 'success' || state() === 'empty') {
      <details class="legend-bloco">
        <summary class="legend-bloco__resumo"><span class="panel-label">LEGENDA DE STATUS</span></summary>
        <p class="legend__intro">Cor do marcador de unidade.</p>
        <ul class="legend">
          <li><span class="legend__dot legend__dot--success"></span>Disponível</li>
          <li><span class="legend__dot legend__dot--danger"></span>Indisponível</li>
          <li><span class="legend__dot legend__dot--warning"></span>Degradada</li>
          <li><span class="legend__dot legend__dot--info"></span>Em manutenção</li>
          <li><span class="legend__dot legend__dot--neutral"></span>Sem dados</li>
          <li><span class="legend__dot legend__dot--muted"></span>Sem equipamentos</li>
        </ul>
        <p class="legend__nota"><span class="legend__municipio"></span>Município é neutro: situa, não indica estado.</p>
        <p class="legend__nota"><span class="legend__linha"></span>Arco liga unidade ao hub, na cor do status.</p>
      </details>
    }
```

Atualizar o `aria-label` do `<aside>` de `"Legenda e detalhes da unidade"` para `"Status geográfico e detalhes da unidade"`.

- [ ] **Step 2: Folga e largura do painel no SCSS**

Linha 225 `.map-page`: `padding:16px` → `padding:var(--im-space-3)`. Trocar o comentário imediatamente acima (`Sem max-width…`) não; acrescentar ao comentário da `.map-layout` (linha 237) uma linha:

```scss
/* D21: folga de 12px (--im-space-3) no padding da página e no gap, iguais em todas as larguras. É do
 * componente, não do shell: `.shell__main` não tem padding nenhum. Painel em clamp: 420px a partir de
 * 1400px de viewport, encolhe com 30vw até o piso de 340px (≤1133px) e empilha em ≤900px. */
```

Linha 239 `.map-layout`: `grid-template-columns:minmax(0,1fr) 320px` → `grid-template-columns:minmax(0,1fr) clamp(340px, 30vw, 420px)`; `gap:var(--im-space-4)` → `gap:var(--im-space-3)`.

Na linha 243, dentro de `@media (max-width:900px)`:
- `.map-card { height:calc(100svh - var(--im-topbar-height) - 32px); …}` → `- 24px`.
- `.map-panel__topo,.legend-bloco { grid-column:1/-1; }` → `.map-panel__topo { grid-column:1/-1; }`.

Dentro de `@media (max-width:600px)`: remover `.map-page { padding:12px; }`, o comentário `/* Padding de 12px: … */` e a regra `.map-card { height:calc(100svh - var(--im-topbar-height) - 24px); }` (agora iguais à de 900px). Manter `.map-panel { grid-template-columns:1fr; }`.

- [ ] **Step 3: Legenda como placa sobre o canvas**

Substituir as linhas 282–283 (comentário + `.legend-bloco { … }`) e 287–288 (chevron) por:

```scss
/* Legenda sobre o mapa (D21), fechada por padrão (D20). MESMA placa do `.map-titulo` — translúcida,
 * blur, tema da aplicação — pelo mesmo motivo: o canvas é escuro nos dois temas e só a placa garante
 * contraste. z-index 5 como o título (acima dos Markers; a dica de unidade, 6, ainda vence).
 * Fechada vira um rótulo do tamanho do conteúdo; aberta tem largura fixa para as notas caberem numa
 * linha. `max-height` deixa 120px livres no topo (título 12px + placa ~90px + folga): em cartão baixo
 * a legenda rola por dentro em vez de cobrir o título. */
.legend-bloco { position:absolute; left:12px; bottom:12px; z-index:5; max-width:calc(100% - 24px); max-height:calc(100% - 120px); overflow-y:auto; padding:9px 12px; border:1px solid var(--im-border); border-radius:var(--im-radius); background:color-mix(in srgb, var(--im-surface) 86%, transparent); backdrop-filter:blur(6px); box-shadow:0 4px 14px rgba(0,0,0,.18); }
.legend-bloco[open] { width:min(292px, calc(100% - 24px)); padding:12px; }
```

```scss
.legend-bloco__resumo { display:flex; align-items:center; justify-content:space-between; gap:12px; list-style:none; cursor:pointer; }
/* Abre para CIMA (ancorada no rodapé do cartão): fechada, a seta aponta para cima; aberta, para baixo. */
.legend-bloco__resumo::after { content:''; width:7px; height:7px; margin-top:4px; border-right:1.5px solid var(--im-text-muted); border-bottom:1.5px solid var(--im-text-muted); transform:rotate(-135deg); transition:transform .15s ease; }
.legend-bloco[open] > .legend-bloco__resumo::after { margin-top:-4px; transform:rotate(45deg); }
```

(substitui a regra `.legend-bloco__resumo { … }` da linha 284 também — gap novo.) O foco `.legend-bloco__resumo:focus-visible` (linha 290) passa a ficar sobre a placa, não sobre o canvas: manter `var(--im-primary)` (o fundo é tema, como o resto do painel).

Linha 306, comentário de `.legend__nota`: trocar `no painel de 320px (D20)` por `na placa de 292px (D21)`.

- [ ] **Step 4: Testes unitários e build**

Run: `cd infra-monitor-frontend && npx ng test --watch=false` — Expected: todos passam (o spec do mapa só cobre funções puras).
Run: `cd infra-monitor-frontend && npx ng build` — Expected: build ok, sem erro de budget.

- [ ] **Step 5: Commit**

```bash
git add infra-monitor-frontend/src/app/features/mapa/mapa.component.html infra-monitor-frontend/src/app/features/mapa/mapa.component.scss
git commit -m "feat(mapa): legenda sobre o mapa, painel de 420px e folga de 12px (D21)"
```

---

### Task 2: Roteiro e2e novo `mapa-legenda-painel.cjs` + reescrita de porta da API

**Files:**
- Create: `infra-monitor-frontend/e2e/api-porta.cjs`
- Create: `infra-monitor-frontend/e2e/mapa-legenda-painel.cjs`
- Modify: `infra-monitor-frontend/package.json` (script `"e2e:legenda-painel": "node e2e/mapa-legenda-painel.cjs"`)

**Interfaces:**
- Consumes: DOM da Task 1.
- Produces: `e2e/api-porta.cjs` exportando `async function apontarApi(ctx)` — se `process.env.API_PORT` existir e for ≠ `8080`, instala `ctx.route('http://localhost:8080/**', …)` que refaz a requisição em `localhost:<API_PORT>` com `route.fetch({ url })` e devolve com `route.fulfill({ response })`; senão, não faz nada. Retorna a porta efetiva (string). O frontend tem `apiUrl` cravado em `http://localhost:8080/api/v1` (`src/environments/environment.ts:3`); isto permite rodar contra o backend da carga em 8081 sem derrubar o de dev.

```js
/* Aponta o frontend do `ng serve` (apiUrl cravado em localhost:8080) para outro backend, sem tocar
 * no código nem derrubar o backend de dev: a requisição é refeita pelo Playwright na porta pedida. */
async function apontarApi(ctx) {
  const porta = process.env.API_PORT || '8080';
  if (porta === '8080') return porta;
  await ctx.route('http://localhost:8080/**', async (route) => {
    const url = route.request().url().replace('localhost:8080', `localhost:${porta}`);
    const resposta = await route.fetch({ url });
    await route.fulfill({ response: resposta });
  });
  return porta;
}
module.exports = { apontarApi };
```

Roteiro novo — modelo de estrutura, helpers de login (`entrar`), navegação (`irPara`, `abrirMapa`), espera de câmera (`esperarCameraParada`) e clique em marcador: copiar de `e2e/n08-tela-cheia-zoom.cjs` (linhas 1–130 e o helper `cliqueLogico`/`marcSel`). Variáveis: `LEGENDA_SENHA` (obrigatória), `E2E_EMAIL` (default `admin@inframonitor.local`), `API_PORT`, `E2E_OUT` (default `e2e/legenda-painel-evidence`), `E2E_UNIDADES` (lista de prefixos de nome separados por vírgula; default vazio = escolher automaticamente a primeira unidade com degradados+indisponíveis > 0 do payload de `/dashboard/unidades`, senão a primeira com coordenada). Contexto 1600x900, DSF 1. Chamar `apontarApi(ctx)` antes de `ctx.newPage()`.

Casos (cada `checar(caso, nome, ok, detalhe)`):

- [ ] **Step 1: Caso 1 — legenda no cartão, fechada, canto inferior esquerdo**
  - `document.querySelector('.map-card > details.legend-bloco')` existe; `.map-panel details.legend-bloco` não existe.
  - fechada (`!open`, sem atributo).
  - rect: `|leg.left - card.left - 12| <= 2` e `|card.bottom - leg.bottom - 12| <= 2`.
  - não intersecta `.map-titulo`, `.maplibregl-ctrl-top-right` (função `intersecta(a,b)` por rects).
  - Screenshot página inteira `01-sem-selecao.png`.

- [ ] **Step 2: Caso 2 — legenda aberta sobre o mapa**
  - clique em `summary.legend-bloco__resumo`, espera `open === true`.
  - 6 `li`, 2 notas com textos exatos, cada nota em uma linha (`altura <= 1.5 * lineHeight`).
  - legenda aberta não intersecta `.map-titulo` nem `.maplibregl-ctrl-top-right`; `leg.scrollWidth <= leg.clientWidth`.
  - legibilidade: `getComputedStyle(leg).backgroundColor === getComputedStyle(titulo).backgroundColor` e mesmo `backdropFilter` (mesma placa do título). Mais: contraste do texto do item (`.legend li` color) contra a cor de fundo resolvida da placa, composta sobre `#16283a` (pior caso: polígono) — função `contraste(rgbA, rgbB)` WCAG; exigir ≥ 4.5. Ler o alfa da cor de fundo (`color(srgb r g b / a)` ou `rgba(...)`) e compor `a*placa + (1-a)*#16283a`.
  - Screenshot página inteira `03-legenda-aberta.png` e do cartão `03b-legenda-aberta-cartao.png`.
  - Enter no summary fecha (foco + `keyboard.press('Enter')`), e abre de novo; deixar FECHADA no fim.

- [ ] **Step 3: Caso 3 — folga do componente vs shell**
  - `getComputedStyle(main.shell__main).padding` = `0px` (registrar: shell sem padding).
  - `.map-page` padding computado 12px nos 4 lados; `.map-layout` `columnGap` 12px.
  - `card.left - main.left === 12` (±1), `main.right - panel.right === 12` (±1, `main.getBoundingClientRect().right - main.offsetWidth + main.clientWidth` para descontar barra de rolagem), `panel.left - card.right === 12` (±1), `innerHeight - card.bottom === 12` (±1).

- [ ] **Step 4: Caso 4 — unidade selecionada, painel de 420px**
  - Para cada unidade alvo (`E2E_UNIDADES` ou auto): clicar o marcador (`.map__unidade[data-unidade-id="<id>"]` — conferir o atributo real no n08 `marcSel`), esperar `.unit-panel__nome` com o nome.
  - `.map-panel` largura 420 (±1) em 1600x900.
  - KPIs: `.unit-kpis > div` → conjunto de `offsetLeft` distintos tem tamanho 2; todo `dt` com `scrollWidth <= clientWidth`.
  - Se `.aviso-ibge` existir: registrar altura e nº de linhas (`altura / lineHeight`), e largura; senão `naoAplicavel`.
  - Screenshot `02-unidade-selecionada-<prefixo>.png` (página inteira) e do painel `02b-painel-<prefixo>.png`.
  - Com unidade selecionada, abrir legenda: `04-legenda-aberta-com-unidade.png`; não intersecta título; fechar.

- [ ] **Step 5: Caso 5 — viewports**
  Para `[[1920,1080],[1600,900],[1400,900],[1366,768],[1280,720],[1133,768],[1024,768],[901,768]]`: largura esperada do painel = `clamp(340, 0.3*vw, 420)` (±1.5); sem rolagem vertical em `main.shell__main` nem no documento; `.map-page` sem estouro horizontal; legenda aberta não intersecta título (abrir, medir, fechar). Screenshot `05-viewport-<w>x<h>.png`.
  Para `[900,768]` e `[390,844]`: empilhado (`panel.top >= card.bottom`), `.map-page` sem estouro H, legenda aberta dentro do cartão e sem intersectar título. Screenshot.
  Para `[1024,768]` com unidade selecionada: KPIs 2 colunas e `dt` sem estouro (piso 340px).

- [ ] **Step 6: Caso 6 — gaveta do equipamento: Mapa × Equipamentos (lado a lado)**
  - De volta a 1600x900 (sair para `/dashboard` e voltar ao `/mapa` por clique para remontar). Selecionar unidade com afetado; se não houver nenhum `.afetados__item` em nenhuma unidade, `naoAplicavel(6, …, 'sem equipamento afetado no banco')` e pular.
  - Clicar o primeiro `.afetados__item`; esperar `.gaveta` visível; anotar nome; screenshot `06-gaveta-no-mapa.png` (página inteira); medir rect de `.gaveta`.
  - Fechar (Escape), navegar por clique para `/equipamentos`, filtrar pela busca DA LISTA (não a do topo — ver a armadilha de strict mode; usar o input dentro da página de equipamentos, conferir seletor real em `features/equipamentos`), clicar o botão "Ver" da linha com o mesmo nome, esperar `.gaveta`; screenshot `07-gaveta-em-equipamentos.png`; medir rect.
  - `checar`: mesma largura (±1) e mesmo `top`/`right` das duas gavetas.
  - Compor `08-gaveta-lado-a-lado.png`: nova página `setContent` com dois `<img src="data:image/png;base64,…">` lado a lado (legenda "Mapa" / "Equipamentos"), screenshot `fullPage`.
  - Limpar o filtro da lista ao sair.

- [ ] **Step 7: finally + saída**
  Em `finally`: gravar `${OUT}/mapa-legenda-painel.json` com `{ resultados, medidas, errosPagina, errosConsole, respostas5xx, apiPorta }`; imprimir `N/M ok` e cada falha; `process.exitCode = 1` se houver falha, erro de página ou 5xx.

- [ ] **Step 8: Commit** (só os arquivos de código; evidências entram depois, na Task 4)

```bash
git add infra-monitor-frontend/e2e/api-porta.cjs infra-monitor-frontend/e2e/mapa-legenda-painel.cjs infra-monitor-frontend/package.json
git commit -m "test(e2e): roteiro da legenda sobre o mapa e do painel de 420px"
```

---

### Task 3: Ajustar roteiros existentes à legenda no cartão e ao painel novo

**Files:**
- Modify: `infra-monitor-frontend/e2e/n05-mapa-maplibre.cjs:316`
- Modify: `infra-monitor-frontend/e2e/n06-marcadores-e-conexoes.cjs:191-195, 222-231, 262-267`
- Modify: `infra-monitor-frontend/e2e/n07-pulso-ping-dica.cjs` (só `apontarApi`)
- Modify: `infra-monitor-frontend/e2e/n08-tela-cheia-zoom.cjs:234-256`
- Modify: `infra-monitor-frontend/e2e/m06-drawer-no-mapa.cjs` (só `apontarApi`)

**Interfaces:**
- Consumes: `apontarApi(ctx)` de `e2e/api-porta.cjs` (Task 2). Nos roteiros que usam `browser.newPage(...)`, trocar por `const ctx = await browser.newContext({...mesmas opções}); await apontarApi(ctx); const page = await ctx.newPage();`. No n08 (`novaPagina`), chamar `await apontarApi(ctx)` logo após criar o contexto. No m06, também reescrever a constante `API` se ela for usada por `fetch` direto do Node: `const API = \`http://localhost:${process.env.API_PORT || 8080}/api/v1\``.

- [ ] **Step 1: n05** — screenshot da legenda: `.map-panel` → `.map-card`.
- [ ] **Step 2: n06 caso 4** — `'painel lateral com a largura nova'`: viewport 1500 → `clamp(340, 450, 420)` = 420; trocar faixa `318..322` por `419..421` e o nome para `'painel lateral com 420px (D21)'`. Screenshot `04-painel-320px.png` → `04-painel-420px.png` (apagar o PNG antigo da pasta de evidências no commit). Caso 5 "costura": continua sobre `.map-panel > *` (agora sem legenda) — manter.
- [ ] **Step 3: n08 caso 14** — screenshots `d-legenda-fechada.png`/`d-legenda-aberta.png` de `.map-panel` → `.map-card`. `painelOverflowX` passa a medir a legenda: `const leg = document.querySelector('details.legend-bloco'); … legendaOverflowX: leg.scrollWidth - leg.clientWidth`, nome `'legenda sem estouro horizontal aberta'`. Acrescentar `checar(14, 'legenda é filha do cartão do mapa, fora do painel', !!document.querySelector('.map-card > details.legend-bloco') && !document.querySelector('.map-panel details.legend-bloco'))`.
- [ ] **Step 4: Rodar `node --check` em cada roteiro alterado** — Expected: sem erro de sintaxe.
- [ ] **Step 5: Commit**

```bash
git add infra-monitor-frontend/e2e/n05-mapa-maplibre.cjs infra-monitor-frontend/e2e/n06-marcadores-e-conexoes.cjs infra-monitor-frontend/e2e/n07-pulso-ping-dica.cjs infra-monitor-frontend/e2e/n08-tela-cheia-zoom.cjs infra-monitor-frontend/e2e/m06-drawer-no-mapa.cjs
git commit -m "test(e2e): roteiros do mapa seguem a legenda para o cartao e aceitam API_PORT"
```

---

### Task 4: Validação (controlador) + documentação D21

Executado pelo controlador, não por subagente (portas e processos compartilhados).

- [ ] **Step 1:** `npx ng test --watch=false` e `npx ng build` verdes.
- [ ] **Step 2 (dev, 8080/5434):** `LEGENDA_SENHA=… npm run e2e:legenda-painel`; `N05/N06/N07/N08/M06_SENHA=…` nos cinco roteiros. Conferir cada PNG com Read.
- [ ] **Step 3 (carga, 5436):** subir jar (`infra-monitor-backend/target/*.jar`, reconstruir se mais velho que o último commit do backend) com `~/.inframonitor-carga/env.sh` (SERVER_PORT=8081, motor/Telegram/dispatcher desligados). Rodar `API_PORT=8081 E2E_EMAIL=$BOOTSTRAP_ADMIN_EMAIL LEGENDA_SENHA=$BOOTSTRAP_ADMIN_PASSWORD E2E_UNIDADES='Sede,Sesc Itabaiana' E2E_OUT=<scratchpad>/carga-evidence npm run e2e:legenda-painel`, mais n05/n07/n08 com `API_PORT=8081`. Conferir PNGs. Matar o java por PID e provar 8081 livre.
- [ ] **Step 4:** Se a câmera desequilibrar (n06 caso 4 / n08), remedir antes de mexer em `OFFSET_CAMERA` (ver comentário em `mapa.component.ts:240`).
- [ ] **Step 5: Docs** — `Docs/mapa-architecture/mapa-decisoes.md`: nova `## D21 — Legenda sobre o mapa, painel de 420px, folga de 12px` (motivo do canto, clamp e números por viewport, investigação do shell: `.shell__main` sem padding, folga era do componente; o que seria preciso para mexer no shell: nada hoje — cada tela declara o próprio padding (ex.: `.painel` do dashboard 18px 20px 28px, `.monitor-page` 16px) e o shell não contribui; uniformizar seria mover um padding para `.shell__main` e tirar das telas, rodada própria; números do e2e). `mapa-contexto-atual.md`: atualizar painel 320→clamp e legenda. Commit junto com as evidências do dev (`e2e/*-evidence`).

```bash
git add Docs/mapa-architecture infra-monitor-frontend/e2e
git commit -m "docs(mapa): D21 legenda sobre o mapa, painel de 420px e folga de 12px"
```

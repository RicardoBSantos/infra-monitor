# Mapa em tela cheia — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/mapa` ocupa a altura da viewport sem rolagem, clique no marcador abre direto o detalhe da unidade, clique no município aproxima nele, legenda recolhível fechada, rodapé de fontes removido.

**Architecture:** Só frontend, só `features/mapa/` (+ roteiros e2e e docs). O município deixa de ser seleção (sinal `selected`, `selectMunicipio`, `marcarMunicipio` e `.selected-panel` saem) e vira ação de câmera; o enquadramento inicial do estado vira um método reutilizado pelo "Ver estado inteiro" e pelo Escape. Layout: página em coluna flex com altura `100dvh - --im-topbar-height`, título sobre o mapa numa placa translúcida.

**Tech Stack:** Angular (signals, OnPush, control flow `@if`), MapLibre GL 6.9.0, SCSS, Vitest via `npx ng test --watch=false`, Playwright (`.cjs` em `e2e/`).

**Spec:** `docs/superpowers/specs/2026-10-16-mapa-tela-cheia-design.md`

## Global Constraints

- Nenhuma mudança de backend, de chamada HTTP, de modelo (`DashboardUnidade`) ou de serviço. Se surgir necessidade, PARAR e reportar.
- `transform` no elemento de um `Marker` pertence ao MapLibre (DV13): nunca escrever `transform` em `.map__unidade`, `.map__alvo`, `.map__ping`.
- Cores sobre o canvas são hex literais; foco sobre o canvas usa `--cor-foco-mapa`. Fora do canvas (placa do título, botões, painel) usar tokens de tema.
- `prefers-reduced-motion: reduce` ⇒ toda animação de câmera com `duration: 0`.
- Comentários no estilo do arquivo: português, explicando o PORQUÊ, citando a decisão (D20 para esta rodada).
- Roteiros e2e: navegação só por clique depois do login (sessão em memória); nunca `catch` silencioso em seletor; resultados gravados em `finally`.
- Pitch 45 / bearing -18 continuam padrão em todo enquadramento (D04/D13).
- Copy exata: placa "OPERAÇÕES · SERGIPE" / "Mapa operacional" / "Visão cartográfica das unidades monitoradas no estado de Sergipe."; botão "Ver estado inteiro"; notas "Município é neutro: situa, não indica estado." e "Arco liga a unidade ao hub, na cor do status dela."

## Review Focus

1. Clique no marcador de unidade NÃO pode disparar o zoom do município (o handler de `municipios-fill` recebe o mesmo clique) — inclusive em ITA-09 (IBGE divergente) e nos 4 marcadores de Aracaju. Teste: n08 caso de propagação.
2. Clique no município com uma unidade já aberta no painel não pode fechar nem trocar o painel. Teste: n08.
3. "Ver estado inteiro" some ao clicar: o foco não pode cair no `body`. Teste: n08 (foco no canvas depois).
4. Viewport baixa/estreita (1024×768, 1280×720, 390×844): sem rolagem horizontal nunca; vertical 0 em desktop; título não cobre marcador nem o `NavigationControl`. Teste: n08 viewports.
5. Estado de erro/carregando: placa do título não cobre a mensagem de erro nem o "Tentar novamente". Teste: n08 com rota de API abortada (`page.route` para `/dashboard/unidades` → abort) e captura.

---

### Task 1: Interação — marcador direto, zoom por município, volta ao estado

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.ts`
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.html` (linha 25 sai; botão novo no cartão)
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.scss` (sai `.unit-list__escolha*`; entra `.map__voltar`)
- Test: `infra-monitor-frontend/src/app/features/mapa/mapa.component.spec.ts`

**Interfaces:**
- Produces: `export function limitesDoMunicipio(geometria: { coordinates: unknown }): [[number, number], [number, number]] | null` (envelope `[[minLng,minLat],[maxLng,maxLat]]`); sinal `protected readonly foraDoEnquadramento = signal(false)`; métodos `protected verEstadoInteiro(): void`, `private aproximarMunicipio(municipio: MapMunicipio): void`, `private enquadrarEstado(animado: boolean): void`. Classe CSS `.map__voltar` (botão "Ver estado inteiro"). `.selected-panel` e `.unit-list__escolha` deixam de existir no DOM.

- [ ] **Step 1: Teste falhando de `limitesDoMunicipio`** — no spec, acrescentar `limitesDoMunicipio` e `centroideAproximado` ao import de `./mapa.component` e:

```ts
describe('limites do municipio (zoom por clique)',()=>{
  it('devolve o envelope de um Polygon como [[minLng,minLat],[maxLng,maxLat]]',()=>{
    expect(limitesDoMunicipio(geoJson.features[0].geometry)).toEqual([[-38,-11],[-37,-10]]);
  });
  it('cobre todas as partes de um MultiPolygon',()=>{
    const multi={coordinates:[[[[-38,-10],[-37.5,-10],[-37.5,-10.5],[-38,-10]]],[[[-37,-11],[-36.5,-11],[-36.5,-11.5],[-37,-11]]]]};
    expect(limitesDoMunicipio(multi)).toEqual([[-38,-11.5],[-36.5,-10]]);
  });
  it('geometria vazia nao tem envelope',()=>{
    expect(limitesDoMunicipio({coordinates:[]})).toBeNull();
  });
  it('o centroide continua sendo o centro do mesmo envelope',()=>{
    expect(centroideAproximado(geoJson.features[0].geometry)).toEqual([-37.5,-10.5]);
  });
});
```

- [ ] **Step 2:** `cd infra-monitor-frontend && npx ng test --watch=false` → FAIL (`limitesDoMunicipio` não exportado).

- [ ] **Step 3: Implementar a função pura** — substituir `centroideAproximado` por:

```ts
/** Envelope do município, `[[minLng, minLat], [maxLng, maxLat]]`. É o que o zoom por clique enquadra (D20). */
export function limitesDoMunicipio(geometria: { coordinates: unknown }): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  percorrerCoordenadas(geometria, ([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); });
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
}

/** Centro do envelope do municipio. Nao e o polo de inacessibilidade: em municipio concavo pode cair fora. */
export function centroideAproximado(geometria: { coordinates: unknown }): [number, number] | null {
  const limites = limitesDoMunicipio(geometria);
  return limites ? [(limites[0][0] + limites[1][0]) / 2, (limites[0][1] + limites[1][1]) / 2] : null;
}
```

- [ ] **Step 4:** `npx ng test --watch=false` → PASS (suíte inteira).

- [ ] **Step 5: Constantes da câmera de município** — ao lado de `ZOOM_AO_INCLINAR`:

```ts
/**
 * Teto do zoom ao clicar num município (D20). Sem ele, município pequeno iria a zoom de rua e o
 * operador perderia a referência dos vizinhos. Medido no e2e:n08 contra Aracaju: com o teto, os
 * quatro marcadores ficam a >= 60px do vizinho mais próximo — clicáveis um a um (DV09).
 */
const ZOOM_MAXIMO_MUNICIPIO = 11.5;
/** Duração das transições de câmera disparadas por clique. Zero sob `prefers-reduced-motion`. */
const DURACAO_CAMERA_MS = 600;
/** Folga do enquadramento do município; topo e esquerda maiores por causa da placa do título. */
const PADDING_MUNICIPIO = { top: 110, right: 70, bottom: 50, left: 60 };
```

- [ ] **Step 6: Estado e enquadramento do estado** — no componente:
  - remover `selected` (sinal), `selectMunicipio`, `marcarMunicipio`, o `effect(() => this.marcarMunicipio(...))`, o `untracked(() => this.marcarMunicipio(...))` e `this.selected.set(null)` de `load()`;
  - acrescentar `protected readonly foraDoEnquadramento = signal(false);` e `private limitesEstado: LngLatBounds | null = null;`;
  - em `montarMapa`, trocar as duas linhas `map.fitBounds(...)` / `map.easeTo(...)` por `this.limitesEstado = limites; this.enquadrarEstado(false);` (manter o comentário de D13 acima, movido para o método) e, DEPOIS dele, registrar:

```ts
    // Gesto do operador (arraste, roda, botões do NavigationControl) tira a câmera do enquadramento
    // inicial: o "Ver estado inteiro" aparece. Movimento programático não tem `originalEvent`.
    map.on('movestart', evento => { if (evento.originalEvent) this.foraDoEnquadramento.set(true); });
    elemento.addEventListener('keydown', evento => {
      if (evento.key !== 'Escape' || !this.foraDoEnquadramento()) return;
      evento.preventDefault();
      this.enquadrarEstado(true);
    }, { signal: signalAbort });
```

  - novo método (substitui a sequência antiga sem mudar a conta: mesmo pitch, bearing, padding 34, `+ZOOM_AO_INCLINAR`, `OFFSET_CAMERA`):

```ts
  /**
   * Enquadramento do estado inteiro — o da abertura da tela, e o destino do "Ver estado inteiro" e
   * do Escape (D20). Uma conta só para os três: se divergissem, voltar não daria no mesmo lugar.
   *
   * `cameraForBounds` + um único `easeTo`, e não mais `fitBounds` seguido de `easeTo`: animado, o
   * segundo `easeTo` cancelaria o primeiro no meio. A conta é a mesma — câmera que cabe o estado
   * já inclinado, mais `ZOOM_AO_INCLINAR`, mais `OFFSET_CAMERA` (ver D13).
   */
  private enquadrarEstado(animado: boolean): void {
    const map = this.map;
    if (!map || !this.limitesEstado) return;
    const camera = map.cameraForBounds(this.limitesEstado, { padding: 34, bearing: BEARING, pitch: PITCH });
    if (!camera) return;
    map.easeTo({ ...camera, zoom: (camera.zoom ?? map.getZoom()) + ZOOM_AO_INCLINAR, bearing: BEARING, pitch: PITCH,
      offset: OFFSET_CAMERA, duration: animado && !animacaoReduzida() ? DURACAO_CAMERA_MS : 0 });
    this.foraDoEnquadramento.set(false);
  }

  /** Botão "Ver estado inteiro". O botão some ao clicar: o foco vai para o canvas, não para o body. */
  protected verEstadoInteiro(): void {
    this.enquadrarEstado(true);
    this.map?.getCanvas().focus();
  }

  /**
   * Clique (ou Enter no alvo invisível) num município: aproxima nele (D20). Não é mais seleção —
   * o município não carrega estado (D15) nem seleção (D17); o painel da unidade aberta fica como
   * está. Resolve o aglomerado de Aracaju: aproximado, cada marcador fica clicável. Município sem
   * unidade aproxima igual; o anúncio diz que não há unidade.
   */
  private aproximarMunicipio(municipio: MapMunicipio): void {
    this.anuncio.set(`${rotuloDoMunicipio(municipio)}. Mapa aproximado.`);
    const map = this.map;
    const limites = limitesDoMunicipio(municipio.feature.geometry);
    if (!map || !limites) return;
    map.fitBounds(limites, { padding: PADDING_MUNICIPIO, bearing: BEARING, pitch: PITCH, maxZoom: ZOOM_MAXIMO_MUNICIPIO,
      linear: true, duration: animacaoReduzida() ? 0 : DURACAO_CAMERA_MS });
    this.foraDoEnquadramento.set(true);
  }
```

  - no `map.on('click', 'municipios-fill', …)` e no `click` do `.map__alvo`: `this.selectMunicipio(municipio)` → `this.aproximarMunicipio(municipio)`. A guarda `cliqueVeioDeMarcador` FICA (atualizar o comentário dela: agora, sem a guarda, clicar no marcador também aproximaria o município);
  - `.map__alvo` não recebe mais `aria-pressed` (não existe mais quem o escreva);
  - `selecionarPeloMarcador` vira:

```ts
  /**
   * Clique (ou Enter/Espaço) no marcador de unidade: abre direto o detalhe da unidade (D20). Até
   * D19 passava antes por `selectMunicipio`, que em município de várias unidades mostrava a lista
   * "Escolha uma" acima do detalhe — empurrava o conteúdo e criava rolagem no painel.
   */
  private selecionarPeloMarcador(unidade: DashboardUnidade): void {
    this.selectUnidade(unidade);
    this.anuncio.set(`${unidade.nome} selecionada. ${ROTULO_STATUS[unidade.status]}.`);
  }
```

  - atualizar o comentário de `unidadeSelecionada` ("Município com uma única unidade seleciona sozinho…" deixa de valer) e o do `effect` de `marcarUnidade`; o bloco-comentário sobre o anel lilás que cita "`aria-pressed` nos dois marcadores" passa a dizer que só o marcador de unidade tem `aria-pressed`.

- [ ] **Step 7: Template** — `mapa.component.html`: apagar a linha 25 inteira (`@if (selected(); as municipio) { … }`) e o comentário das linhas 23–24. Dentro de `.map-card`, logo depois do `@else { <div #host …> }`:

```html
    <!-- Caminho de volta do zoom por município (D20). Só aparece fora do enquadramento inicial.
         Escape com foco no mapa faz o mesmo. Duplo clique descartado: é o zoom nativo do MapLibre. -->
    @if (state() === 'success' && foraDoEnquadramento()) { <button class="botao map__voltar" type="button" (click)="verEstadoInteiro()">Ver estado inteiro</button> }
```

  (`state()==='empty'` também tem mapa; usar `(state() === 'success' || state() === 'empty')`.)

- [ ] **Step 8: SCSS** — remover as três regras `.unit-list__escolha`, `.unit-list__escolha:hover,…`, `.unit-list__escolha--ativa`. Acrescentar (fora do `::ng-deep`, o botão é do template):

```scss
/* "Ver estado inteiro" (D20): abaixo do NavigationControl (3 botões de 26px a 10px do topo). Fundo
 * de tema e não literal: está sobre o cartão, não sobre o canvas desenhado. */
.map__voltar { position:absolute; top:104px; right:10px; z-index:5; box-shadow:0 2px 8px rgba(0,0,0,.25); }
```

- [ ] **Step 9:** `npx ng test --watch=false` PASS e `npx ng build` sem erro (aviso de budget do SCSS do mapa é pré-existente, DV04). `grep -n "selected()\|selectMunicipio\|marcarMunicipio\|unit-list__escolha\|selected-panel" src/app/features/mapa/*` → vazio.

- [ ] **Step 10: Verificação manual rápida** (app em 4200 já roda com `ng serve`; login `admin@inframonitor.local` / `infrestrutura26`): clicar num marcador abre `.unit-panel`; clicar num município aproxima; botão aparece; Escape volta. Script Playwright descartável no scratchpad, se preciso.

- [ ] **Step 11: Commit**

```bash
git add src/app/features/mapa/
git commit -m "feat(mapa): marcador abre a unidade direto e municipio aproxima o zoom"
```

---

### Task 2: Layout — tela cheia, título sobre o mapa, Atualizar no painel, legenda recolhível, sem rodapé

Usar a skill `frontend-design` para o acabamento da placa do título, do topo do painel e do `summary` da legenda, dentro das restrições abaixo (tokens do sistema, mesma tipografia IBM Plex Mono para rótulos).

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.html`
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.scss`
- Modify (só se a remedição exigir): `mapa.component.ts` (`OFFSET_CAMERA`, `ZOOM_AO_INCLINAR` e seus comentários)

**Interfaces:**
- Consumes: Task 1 (`.map__voltar`, sem `.selected-panel`).
- Produces (seletores que os roteiros e2e usam): `.map-card .map-titulo` contém `h1#map-title`; `.map-panel__topo .botao` = "Atualizar"; `details.legend-bloco` (fechado por padrão) com `summary.legend-bloco__resumo`, `.legend-bloco > .legend li` (6), `.legend-bloco > .legend__nota` (2), `.legend-bloco .legend__intro`; `.map-page__header` e `.map-source` NÃO existem.

- [ ] **Step 1: Template — cabeçalho para dentro do cartão.** Apagar `<header class="map-page__header">…</header>`. Primeiro filho de `<section class="map-card">`:

```html
    <!-- Título sobre o mapa (D20), e não numa faixa acima: a faixa custava ~90px de altura de mapa.
         Placa translúcida própria: o canvas é escuro nos dois temas mas o fundo do cartão segue o
         tema, então só uma placa garante contraste independente do que estiver atrás. -->
    <header class="map-titulo"><p class="map-titulo__eyebrow">OPERAÇÕES · SERGIPE</p><h1 id="map-title">Mapa operacional</h1><p class="map-titulo__sub">Visão cartográfica das unidades monitoradas no estado de Sergipe.</p></header>
```

- [ ] **Step 2: Template — Atualizar no topo do painel.** Primeiro filho do `<aside class="map-panel">`:

```html
    <div class="map-panel__topo"><button class="botao" type="button" (click)="load()" [disabled]="state() === 'loading'">Atualizar</button></div>
```

- [ ] **Step 3: Template — legenda recolhível.** Substituir `<div class="legend-bloco">…</div>` (e reescrever o comentário acima dele: D15 desfez o disclosure; D20 o traz de volta para a legenda INTEIRA, fechada, a pedido, para o detalhe da unidade caber sem rolagem):

```html
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
      <p class="legend__nota"><span class="legend__linha"></span>Arco liga a unidade ao hub, na cor do status dela.</p>
    </details>
```

- [ ] **Step 4: Template — rodapé.** Apagar `<dl class="map-source">…</dl>`.

- [ ] **Step 5: SCSS — página na altura da viewport.** Reescrever `.map-page`, `.map-page__header*` (sai), `.map-layout`, `.map-card`, `.map-panel` e as media queries. Manter o comentário de `max-width` (D14) e reescrever o da altura (D11 → D20). Alvo:

```scss
.map-page { display:flex; flex-direction:column; height:calc(100dvh - var(--im-topbar-height)); min-height:480px; padding:16px; color:var(--im-text); }
.panel-label { margin:0 0 4px; color:var(--im-text-muted); font:600 10px 'IBM Plex Mono',monospace; letter-spacing:.12em; }
/* `minmax(0,1fr)` na LINHA, não só nas colunas: sem isso o item de grade tem `min-height:auto` e o
 * painel com unidade selecionada esticaria a linha — volta a rolagem que D11 fechou. */
.map-layout { flex:1; min-height:0; display:grid; grid-template-columns:minmax(0,1fr) 320px; grid-template-rows:minmax(0,1fr); gap:var(--im-space-4); }
.map-card { position:relative; height:100%; overflow:hidden; /* + border/background atuais */ }
.map-panel { display:flex; height:100%; flex-direction:column; justify-content:flex-start; gap:var(--im-space-4); padding:15px; overflow-y:auto; }
@media (max-width:900px) {
  .map-page { height:auto; min-height:0; }
  .map-layout { grid-template-columns:1fr; grid-template-rows:auto; }
  .map-card { height:calc(100dvh - var(--im-topbar-height) - 32px); min-height:360px; }
  .map-panel { display:grid; height:auto; grid-template-columns:1fr 1fr; overflow:visible; }
  .map-feedback { align-self:start; }
}
@media (max-width:600px) { .map-page { padding:12px; } .map-panel { grid-template-columns:1fr; } }
```

  Explicar no comentário do `.map-panel` que `space-between` (D14) saiu: com legenda fechada e rodapé fora ele abriria vãos entre blocos; a sobra fica no fim da coluna. `.map-panel__topo` e `.legend-bloco` com `grid-column:1/-1` no ≤900px.

- [ ] **Step 6: SCSS — placa do título, topo do painel, summary.**

```scss
/* z-index 5: acima dos Markers (até 4) — o canto superior esquerdo é vazio no enquadramento, e se
 * algum dia não for, a placa vence (o título é a referência da página). pointer-events none: não
 * rouba arraste nem clique do mapa. */
.map-titulo { position:absolute; top:12px; left:12px; z-index:5; max-width:min(330px, calc(100% - 110px)); padding:10px 14px 11px; border:1px solid var(--im-border); border-radius:var(--im-radius); background:color-mix(in srgb, var(--im-surface) 86%, transparent); backdrop-filter:blur(6px); box-shadow:0 4px 14px rgba(0,0,0,.18); pointer-events:none; }
.map-titulo__eyebrow { margin:0 0 3px; color:var(--im-text-muted); font:600 10px 'IBM Plex Mono',monospace; letter-spacing:.12em; }
.map-titulo h1 { margin:0; color:var(--im-text-strong); font-size:18px; font-weight:600; line-height:1.25; }
.map-titulo__sub { margin:3px 0 0; color:var(--im-text-secondary); font-size:12px; line-height:1.4; }
.map-panel__topo { display:flex; justify-content:flex-end; }
.legend-bloco { padding:12px; border:1px solid var(--im-border); border-radius:var(--im-radius); background:var(--im-surface-raised); }
.legend-bloco__resumo { display:flex; align-items:center; justify-content:space-between; list-style:none; cursor:pointer; }
.legend-bloco__resumo::-webkit-details-marker { display:none; }
.legend-bloco__resumo .panel-label { margin:0; }
.legend-bloco__resumo::after { content:''; width:7px; height:7px; border-right:1.5px solid var(--im-text-muted); border-bottom:1.5px solid var(--im-text-muted); transform:rotate(45deg); transition:transform .15s ease; }
.legend-bloco[open] > .legend-bloco__resumo::after { transform:rotate(-135deg); }
.legend-bloco[open] > .legend-bloco__resumo { margin-bottom:9px; }
.legend-bloco__resumo:focus-visible { outline:2px solid var(--im-primary); outline-offset:3px; border-radius:2px; }
@media (prefers-reduced-motion: reduce) { .legend-bloco__resumo::after { transition:none; } }
.legend__nota { white-space:nowrap; } /* uma linha por nota (D20); o e2e confere */
@media (max-width:600px) { .map-titulo { max-width:calc(100% - 70px); padding:8px 11px; } .map-titulo h1 { font-size:16px; } }
```

  Apagar `.map-source*` e `.map-page__eyebrow`. Garantir que `.map-card > .map-feedback--error` fique centrado e fora da placa:

```scss
.map-card > .map-feedback--error { position:absolute; top:50%; left:50%; width:min(420px, calc(100% - 48px)); transform:translate(-50%,-50%); }
```

- [ ] **Step 7:** `npx ng test --watch=false` e `npx ng build` sem erro.

- [ ] **Step 8: Remedir a câmera (DV11).** Com o app em 4200, rodar `N06_SENHA=infrestrutura26 npm run e2e:n06` e ler o caso 5 (desequilíbrio ≤6 p.p., sobra ≤34%) e a rolagem (0). Medir também por captura do `.map-card` em 1500×950, 1700×907, 1280×800 (método da memória: cartão com `.map` em `visibility:hidden` vs desenhado; excluir `.maplibregl-ctrl-top-right` e `.map-titulo`). Se fora, ajustar `OFFSET_CAMERA`/`ZOOM_AO_INCLINAR` e reescrever os números no comentário. Conferir que nenhum marcador cai sob a `.map-titulo` (bounding boxes) nas três viewports; se cair, compensar por `OFFSET_CAMERA`. Registrar os números medidos para o Task 5.

- [ ] **Step 9: Commit**

```bash
git add src/app/features/mapa/
git commit -m "feat(mapa): tela cheia com titulo sobre o mapa e legenda recolhivel"
```

---

### Task 3: Roteiros e2e existentes ajustados (n05, n06, n07, m06)

Paralelo ao Task 4 (arquivos distintos). Ler cada roteiro inteiro antes de editar. Não afrouxar o que cada caso prova: reescrever para o comportamento novo e manter o porquê no comentário do caso.

**Files:** Modify `infra-monitor-frontend/e2e/n05-mapa-maplibre.cjs`, `e2e/n06-marcadores-e-conexoes.cjs`, `e2e/n07-pulso-ping-dica.cjs`, `e2e/m06-drawer-no-mapa.cjs`.

**Interfaces:** Consumes os seletores do Task 1/2 (acima).

- [ ] **Step 1: Helper de ponto de partida do Tab** (n05 linha ~109, m06 linha ~257), no lugar de `.map-page__header .botao`. O "Atualizar" foi para depois do mapa; o último focável antes do cartão está no shell:

```js
/** Foca o último controle focável ANTES do cartão do mapa (o "Atualizar" foi para o painel, D20). */
const focarAntesDoMapa = (page) => page.evaluate(() => {
  const cartao = document.querySelector('.map-card');
  const focaveis = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
    .filter((e) => e.tabIndex >= 0 && !e.disabled && e.getClientRects().length > 0)
    .filter((e) => cartao.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING);
  if (!focaveis.length) throw new Error('nenhum focável antes do mapa');
  focaveis[focaveis.length - 1].focus();
});
```

- [ ] **Step 2: n05.** Casos 5/6: "Enter no município focado aproxima o mapa" (zoom lido de `.map__alvo` espalhamento ou `window` não expõe o map — medir pela distância entre dois alvos vizinhos antes/depois: aumenta) e "foco permanece no município". `.map__alvo` não tem mais `aria-pressed` — onde o roteiro conta pressionados de alvo, trocar pela prova correspondente (nenhum alvo com `aria-pressed`). Linha ~196: `.map-page__header .botao` → `.map-panel__topo .botao`. Caso 15: clicar num `.map__unidade` (via `page.evaluate(el => el.click())`, ver nota de n07 linha 545) e exigir `.unit-panel` com "UNIDADE SELECIONADA". Caso 17: município com 2+ unidades → clique aproxima, `.selected-panel` count 0, `.unit-panel` não aparece por isso. Caso 20: clique no marcador → exatamente 1 `.map__unidade[aria-pressed="true"]`, nenhum `.map__alvo[aria-pressed]`. Evidências `03-legenda.png` com a legenda aberta (`summary` clicado).
- [ ] **Step 3: n06.** Caso 5 (legenda): exigir `details.legend-bloco` sem `open` por padrão; clicar no `summary`; então 6 itens, intro com "marcador", 2 notas; manter as ausências (`.legend-info`, `.legend-extra`). Rolagem: manter, exigir 0. Onde clicar alvo de município esperava seleção, adaptar ao zoom. Calibração (caso 5 de faixa morta) não muda de critério.
- [ ] **Step 4: n07.** Caso 1 continua valendo (contagem por DOM); abrir a legenda antes de ler textos/estilos visíveis (caso 8 lê `.legend__linha`). Conferir que nenhum caso usa `.selected-panel`/`.unit-list__escolha`.
- [ ] **Step 5: m06.** Chegar ao equipamento afetado pelos marcadores de unidade (`.map__unidade`, `el.click()`), iterando até achar `.afetados__item`, em vez de `.map__alvo` + `.unit-list__escolha`. Foco inicial do caso 13 pelo helper do Step 1.
- [ ] **Step 6: Rodar os quatro** (`N05_SENHA=… npm run e2e:n05`, idem n06, n07, m06; senha `infrestrutura26`), todos verdes. Ler os JSON de resultado.
- [ ] **Step 7: Commit** `git add e2e/n05-mapa-maplibre.cjs e2e/n06-marcadores-e-conexoes.cjs e2e/n07-pulso-ping-dica.cjs e2e/m06-drawer-no-mapa.cjs e2e/n0{5,6,7}-evidence e2e/m06-evidence && git commit -m "test(e2e): roteiros do mapa no clique direto, zoom por municipio e legenda recolhivel"`

---

### Task 4: Roteiro novo `e2e/n08-tela-cheia-zoom.cjs` + `npm run e2e:n08`

Paralelo ao Task 3. Modelo de estrutura: `e2e/n06-marcadores-e-conexoes.cjs` (login, `checar`, `finally`, evidências em `e2e/n08-evidence/`). Senha por `N08_SENHA`. Viewport padrão 1600×900.

**Files:** Create `infra-monitor-frontend/e2e/n08-tela-cheia-zoom.cjs`; Modify `infra-monitor-frontend/package.json` (`"e2e:n08": "node e2e/n08-tela-cheia-zoom.cjs"`).

**Interfaces:** Consumes seletores do Task 1/2. Payload de `/dashboard/unidades` capturado por `page.on('response')` para derivar esperados (nada de contagem cravada).

Casos (cada um é um `checar`):

- [ ] **1 — sem rolagem:** para 1920×1080, 1600×900, 1366×768, 1280×720, 1024×768: `main.shell__main` `scrollHeight - clientHeight === 0` e `document.documentElement` idem; `scrollWidth - clientWidth === 0` também. Captura `01-viewport-<w>x<h>.png` de cada. Em 390×844: só horizontal 0 (empilhado rola de propósito) + captura.
- [ ] **2 — título sobre o mapa:** `.map-page__header` count 0; `.map-card .map-titulo h1#map-title` texto "Mapa operacional"; caixa da placa dentro da caixa do cartão; sem interseção com `.maplibregl-ctrl-top-right` nem com nenhum `.map__unidade` (bounding boxes) em 1600×900 e 1280×720.
- [ ] **3 — Atualizar no painel:** `.map-panel__topo .botao` texto "Atualizar", é o primeiro elemento do `.map-panel`; clicar recarrega (aguardar `/dashboard/unidades` de novo).
- [ ] **4 — rodapé fora:** `.map-source` count 0; texto do painel não contém "BASE CARTOGRÁFICA" nem "FONTE OPERACIONAL".
- [ ] **5 — (a) sem seleção:** captura `a-sem-selecao.png` (página inteira) logo ao abrir.
- [ ] **6 — marcador abre direto:** para um marcador de Aracaju (unidade cujo `codigoIbge` = 2800308, do payload) e para ITA-09 (sigla/nome do payload; IBGE divergente): `el.click()` → `.unit-panel` com o nome da unidade, `.selected-panel` count 0, `unit-panel` visível sem rolar o painel (`.map-panel.scrollTop === 0` e topo do `.unit-panel` < altura do painel). Captura `b-detalhe-por-marcador.png`.
- [ ] **7 — marcador não aproxima (propagação):** antes/depois do clique no marcador, distância em px entre dois `.map__alvo` fixos não muda (±1px), e `.map__voltar` count 0. Repetir com clique físico do mouse (`page.mouse.click` no centro do marcador mais isolado) — mesmo resultado.
- [ ] **8 — município aproxima:** clicar no polígono de Aracaju num ponto fora de marcador (centro do `.map__alvo[data-codigo-ibge="2800308"]` deslocado até um pixel cujo `elementFromPoint` é o canvas), aguardar `DURACAO + 300ms`: distância entre alvos aumentou; centro de Aracaju (`.map__alvo` dele) perto do centro do cartão (±20% largura/altura); `.map__voltar` visível; painel da unidade aberta (do caso 6) continua com o mesmo nome. Captura `c-zoom-municipio.png`.
- [ ] **9 — Aracaju clicável um a um:** para cada marcador das unidades de Aracaju, `elementFromPoint(centro)` é o próprio botão (ou filho dele); distância mínima entre vizinhos ≥ 60px (registrar o valor). Clicar fisicamente (`page.mouse.click`) em cada um → `.unit-panel` mostra o nome daquela unidade.
- [ ] **10 — volta:** clicar `.map__voltar` → após animação, distâncias entre alvos voltam às do início (±2px), botão some, `document.activeElement` é o `canvas`. Repetir via zoom em outro município + `Escape` com foco no canvas.
- [ ] **11 — município sem unidade:** escolher do `aria-label` de `.map__alvo` um com "nenhuma unidade cadastrada"; `el.click()` no alvo → aproxima (distância aumenta), região viva `.map-sr` contém "nenhuma unidade cadastrada".
- [ ] **12 — teclado:** Tab até um `.map__alvo`, Enter → aproxima; `.map__alvo` sem atributo `aria-pressed`.
- [ ] **13 — reduced-motion:** contexto novo com `reducedMotion: 'reduce'`, login, abrir mapa, clicar município: posições já finais em 50ms (amostra a 50ms ≈ amostra a 900ms, ±2px).
- [ ] **14 — legenda:** `details.legend-bloco` sem `open`; captura `d-legenda-fechada.png` (do `.map-panel`); clicar `summary` → `open`, 6 `li`, 2 notas, cada `.legend__nota` com altura ≤ 1,5× `line-height` (uma linha) e `scrollWidth <= clientWidth` do painel; textos exatos das duas notas; captura `d-legenda-aberta.png`; clicar de novo fecha. Teclado: foco no `summary`, Enter alterna.
- [ ] **15 — erro:** contexto novo, `page.route('**/dashboard/unidades', r => r.abort())` instalado após login, abrir mapa: `.map-feedback--error` visível, sem interseção com `.map-titulo`; captura `e-erro.png`.
- [ ] **0 — nenhum erro de console/página** no roteiro inteiro.

- [ ] **Run:** `N08_SENHA=infrestrutura26 npm run e2e:n08` → todos verdes; JSON em `e2e/n08-evidence/n08-tela-cheia-zoom.json`. Se `ZOOM_MAXIMO_MUNICIPIO` não der ≥60px em Aracaju, reportar o número medido (não mudar código de produção neste task — o orquestrador decide).
- [ ] **Commit:** `git add e2e/n08-tela-cheia-zoom.cjs e2e/n08-evidence package.json && git commit -m "test(e2e): n08 tela cheia, clique direto e zoom por municipio"`

---

### Task 5: Verificação final e documentação (orquestrador)

**Files:** `Docs/mapa-architecture/mapa-decisoes.md` (D20), `mapa-contexto-atual.md` (§13 + data), `mapa-dividas.md` (DV09/DV11/DV15 notas), `mapa-architecture.md` (tabela de estado + `e2e:n08`).

- [ ] `npx ng test --watch=false`, `npx ng build`, `e2e:n05`, `n06`, `n07`, `m06`, `n08` verdes, na mesma árvore final.
- [ ] Abrir e conferir pessoalmente cada captura (a, b, c, d aberta/fechada, viewports, erro).
- [ ] D20: o que mudou, o que reverte (D10 ordem, D15 disclosure, D14 space-between, M03 município-seleção), descartados (duplo clique, `aria-pressed` no alvo, legenda com estado lembrado), números da câmera remedidos e do zoom de Aracaju.
- [ ] DV09/DV15: nota — zoom por município é o desempate por interação; clustering continua decisão de produto. DV11: quarta remedição.
- [ ] Commit docs; atualizar memória.

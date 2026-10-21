# Mapa — arco com três pings, orbe e paleta vibrante (D24) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Três pings por arco em fluxo contínuo a ⅓, pings menores em orbe luminoso sem contorno branco, linha com halo WebGL e marcador com glow, todos na mesma paleta vibrante — medido, capturado e documentado.

**Architecture:** Tudo em `features/mapa/`. TS: paleta `COR_DO_STATUS`, duas camadas em `camadasDeConexao()`, funções puras de fase/opacidade consumidas por `montarPings`. SCSS: `.map__ping` (orbe) e `.map__unidade` (glow). Bancada `e2e/perf-mapa/` ganha cenários com o CSS real; script novo mede a app real. Docs D24 no mesmo commit final.

**Tech Stack:** Angular 20 standalone, MapLibre GL 6.9.0, Karma/Jasmine (`ng test`), Playwright (roteiros `.cjs` em `e2e/`), CDP `Performance.getMetrics`.

**Spec:** `Docs/superpowers/specs/2026-10-21-mapa-arco-brilho-design.md`

## Global Constraints

- Worktree: `C:\Users\rbfilho\Documents\infra-monitor-wt-arco`, branch `feat/mapa-arco-brilho`. `node_modules` do frontend é junção para o repo principal — **nunca** `npm install` aqui; `rmdir` da junção antes de `git worktree remove`.
- Não tocar no repo principal (`C:\Users\rbfilho\Documents\infra-monitor`, branch com mudanças não commitadas do usuário), nem no backend de dev em 8080, nem no `ng serve` em 4200, nem nos containers `inframonitor-postgres` (5434) e `inframonitor-carga` (5436) além de `pg_dump` de leitura.
- Paleta (literal, exata): `disponivel #35e087`, `indisponivel #f84e54`, `degradada #fcb142`, `em-manutencao #7fadff`, `sem-dados #9dabb9`, `sem-equipamentos #6e8698`.
- `PINGS_POR_LINHA = 3`; `PERIODO_PING_MS = 4200` (uma travessia hub→unidade); fade nas pontas `0.08`.
- Ping: caixa 5px, `border: 0`, sem branco em `box-shadow`.
- Linha núcleo: `LARGURA_CONEXAO = 1.6`, `OPACIDADE_CONEXAO = 0.85`. Halo: id `conexoes-halo`, `line-width 6`, `line-blur 4`, `line-opacity 0.28`, ANTES de `conexoes-linha`.
- Marcador: miolo opaco; `box-shadow` de repouso `0 0 6px 1px color-mix(in srgb, var(--cor-unidade, #9dabb9) 55%, transparent), 0 1px 3px rgba(0, 0, 0, .6)`. Selecionado mantém o anel de 3px como **primeira** sombra (e2e `corBateComSombra` lê a primeira cor).
- `transform` no elemento do `Marker` pertence ao MapLibre (DV13): nunca escrever `transform` em `.map__ping`/`.map__unidade`.
- Sem `box-shadow` animado; glow é estático.
- `prefers-reduced-motion`: pings não criados (já é assim — não regredir).
- Comentários e docs em português, no estilo denso existente (o porquê, com número medido). Sem Lombok/irrelevante; sem abstração nova.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Usar `git commit -- <arquivos>` (agentes paralelos compartilham index).
- Docs D24 (decisões, contexto, dívidas, índice) entram no commit da própria mudança visual (regra de `Docs/mapa-architecture/mapa-architecture.md`) — Task 7.

## Review Focus

1. **Ping na virada do ciclo** — ao voltar de u≈1 para u=0 o ping não pode "riscar" visível de volta pelo arco: opacidade tem de ser 0 nas duas pontas exatas. Teste em Task 3 (`opacidadeNaPonta(0) === 0`, `opacidadeNaPonta(1) === 0`, e `faseDeFluxo(0.9999)` → perto de 1, `faseDeFluxo(1)` → 0).
2. **Três pings coincidentes** — defasagem `k/3` com `faseDeFluxo` dá separação de exatamente ⅓ em qualquer instante, inclusive depois da virada. Teste em Task 3 (diferença circular entre fases = 1/3 para vários `ciclos`, inclusive negativo).
3. **Status desconhecido da API** — a nova camada de halo usa o mesmo `match` com fallback `sem-dados`; teste em Task 2 compara o corpo do `match` das duas camadas.
4. **Ordem de camadas** — halo desenhado por cima do núcleo apagaria a linha; teste em Task 2 exige `[0].id === 'conexoes-halo'` e `[1].id === 'conexoes-linha'`, e Task 4 confere a ordem no `style.layers` de `montarMapa` (halo antes de linha, ambas depois dos municípios).
5. **Marcador selecionado com glow** — o glow não pode virar a primeira sombra, senão o e2e n07 caso 9 lê a cor errada; Task 4 Step 3 e Task 6 conferem.

---

### Task 1: Ambiente, script de medição da app real e linha de base

**Files:**
- Create: `infra-monitor-frontend/e2e/perf-mapa/perf-mapa-app.cjs`
- Modify: `infra-monitor-frontend/e2e/n06-marcadores-e-conexoes.cjs`, `e2e/n07-pulso-ping-dica.cjs`, `e2e/n08-tela-cheia-zoom.cjs` (só a linha `const BASE = ...`)
- Modify: `infra-monitor-frontend/package.json` (script `perf:mapa-app`)

**Interfaces:**
- Produces: `node e2e/perf-mapa/perf-mapa-app.cjs` com env `FRONT_URL` (default `http://127.0.0.1:4200`), `API_PORT`, `E2E_EMAIL`, `PERF_SENHA`, `PERF_ROTULO` (nome do arquivo de saída). Grava `e2e/perf-mapa/app-<PERF_ROTULO>.json` com `{ rotulo, unidades, linhas, pings, cenarios: [{ nome, cpuMsPorQuadro, fps, lentosPct }] }`.
- Produces: e2e n06/n07/n08 aceitam `FRONT_URL`.

- [ ] **Step 1: `FRONT_URL` nos roteiros.** Em cada um dos três `.cjs`, trocar `const BASE = 'http://127.0.0.1:4200';` por:

```js
const BASE = process.env.FRONT_URL || 'http://127.0.0.1:4200';
```

- [ ] **Step 2: Escrever `perf-mapa-app.cjs`.** Reaproveitar a medição de `perf-mapa-animacoes.cjs` (ler o arquivo inteiro antes; copiar a mesma função de CPU por CDP `Performance.getMetrics` com `TaskDuration`/quadros e a mesma cadência rAF). Roteiro:

```js
/* Custo das animações do Mapa NA APLICAÇÃO REAL, com o banco que estiver atrás do backend.
 * Complementa a bancada sintética (banco.html): lá a topologia é fixa (11 unidades, 10 arcos);
 * aqui é a do banco — dev (11 unidades) ou carga (2). Mesmas duas métricas da bancada. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { apontarApi } = require('../api-porta.cjs');

const BASE = process.env.FRONT_URL || 'http://127.0.0.1:4200';
const EMAIL = process.env.E2E_EMAIL || 'admin@inframonitor.local';
const SENHA = process.env.PERF_SENHA;
const ROTULO = process.env.PERF_ROTULO || 'sem-rotulo';
const JANELA_MS = 6000, ASSENTAMENTO_MS = 1200;
```

  Fluxo: `chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] })` (mesmos args da bancada — copiar de lá), viewport 1600×900, `apontarApi(ctx)`, login pela tela (`/login`, preencher e-mail/senha, submeter — copiar o login de `n07-pulso-ping-dica.cjs`), navegar **por clique** no link do Mapa (memória: `page.goto` pós-login cai em /login), esperar `.map__unidade`. Contar `unidades = .map__unidade`, `pings = .map__ping`, `linhas = pings / 3` (depois) ou `/2` (antes) — gravar só os dois contadores brutos e deixar `linhas` como `null`. Cenários:
  - `animado`: estado como aberto (pulso + pings).
  - `parado`: injetar `<style>*{animation:none!important}</style>` e cancelar o rAF dos pings removendo os `.map__ping` do DOM (`document.querySelectorAll('.map__ping').forEach(n=>n.remove())` — o rAF continua chamando `setLngLat` em elemento órfão, que é barato; documentar no comentário que isso é a base, não o zero absoluto).
  Para cada um: assentar `ASSENTAMENTO_MS`, medir `JANELA_MS`. Fechar com `ctx.unrouteAll({ behavior: 'ignoreErrors' })` antes de `ctx.close()`. Gravar JSON e imprimir tabela.

- [ ] **Step 3: Script npm.** Em `package.json`, ao lado de `perf:mapa`:

```json
"perf:mapa-app": "node e2e/perf-mapa/perf-mapa-app.cjs",
```

- [ ] **Step 4: Subir os dois clones descartáveis** (receita da memória `e2e-clone-descartavel-do-dev`; senhas geradas com `openssl rand -hex 16`, guardadas em `<scratchpad>/d23-env.sh`, nunca no repo):

```bash
SCR="C:/Users/rbfilho/AppData/Local/Temp/claude/C--Users-rbfilho-Documents-infra-monitor/c923377d-0d17-43a1-86af-bf2de7fdf628/scratchpad"
# dev → 5440
docker run -d --name d23-dev -e POSTGRES_DB=inframonitor -e POSTGRES_USER=inframonitor -e POSTGRES_PASSWORD=$PG_DEV -p 127.0.0.1:5440:5432 postgres:16-alpine
docker exec inframonitor-postgres pg_dump -U inframonitor -d inframonitor --no-owner | docker exec -i d23-dev psql -q -U inframonitor -d inframonitor
# carga → 5441 (db/usuário inframonitor_carga no origem)
docker run -d --name d23-carga -e POSTGRES_DB=inframonitor -e POSTGRES_USER=inframonitor -e POSTGRES_PASSWORD=$PG_CARGA -p 127.0.0.1:5441:5432 postgres:16-alpine
docker exec inframonitor-carga pg_dump -U inframonitor_carga -d inframonitor_carga --no-owner | docker exec -i d23-carga psql -q -U inframonitor -d inframonitor
```

  Jar: `git archive HEAD infra-monitor-backend | tar -x -C $SCR/d23-backend` e `./mvnw -q -DskipTests package` lá. Subir dois `java -jar` em background: `DB_PORT=5440 SERVER_PORT=8082` e `DB_PORT=5441 SERVER_PORT=8083`, ambos com `DB_NAME=inframonitor DB_USERNAME=inframonitor DB_PASSWORD=<respectiva> JWT_SECRET=<64 hex> BOOTSTRAP_ADMIN_ENABLED=true BOOTSTRAP_ADMIN_EMAIL=d23.perf@inframonitor.local BOOTSTRAP_ADMIN_PASSWORD=$ADMIN CORS_ALLOWED_ORIGINS=http://127.0.0.1:4201,http://localhost:4201` e motor/Telegram/dispatcher desligados (default). Conferir `GET /actuator/health` UP nos dois e `GET /api/v1/dashboard/unidades` (autenticado) com 11 e 2 unidades.

- [ ] **Step 5: `ng serve` do worktree em 4201** (background): `cd infra-monitor-frontend && npx ng serve --port 4201 --host 127.0.0.1`. Esperar "Local:" no log.

- [ ] **Step 6: Linha de base da app real** (código ainda igual a `origin/main`):

```bash
cd infra-monitor-frontend
FRONT_URL=http://127.0.0.1:4201 API_PORT=8082 E2E_EMAIL=d23.perf@inframonitor.local PERF_SENHA=$ADMIN PERF_ROTULO=antes-dev node e2e/perf-mapa/perf-mapa-app.cjs
FRONT_URL=http://127.0.0.1:4201 API_PORT=8083 E2E_EMAIL=d23.perf@inframonitor.local PERF_SENHA=$ADMIN PERF_ROTULO=antes-carga node e2e/perf-mapa/perf-mapa-app.cjs
```

  Expected: dev 11 marcadores / 20 pings; carga 2 marcadores / 2 pings. 0% lentos.

- [ ] **Step 7: Linha de base da bancada:** `npm run perf:mapa` (grava `bench.json`); copiar para `e2e/perf-mapa/bench-antes.json`.

  Capturas "antes" não são feitas aqui: a Task 6 as gera contra um worktree temporário de `origin/main`.

- [ ] **Step 8: Commit**

```bash
git add infra-monitor-frontend/e2e/perf-mapa/perf-mapa-app.cjs infra-monitor-frontend/e2e/perf-mapa/app-antes-dev.json infra-monitor-frontend/e2e/perf-mapa/app-antes-carga.json infra-monitor-frontend/e2e/perf-mapa/bench-antes.json infra-monitor-frontend/package.json infra-monitor-frontend/e2e/n06-marcadores-e-conexoes.cjs infra-monitor-frontend/e2e/n07-pulso-ping-dica.cjs infra-monitor-frontend/e2e/n08-tela-cheia-zoom.cjs
git commit -m "test(mapa): medicao das animacoes na app real e linha de base de D24" -- <mesmos arquivos>
```

  Antes de commitar o JSON da carga: conferir que não contém nome de usuário/e-mail (só contagens e números).

---

### Task 2: Paleta vibrante e halo da linha

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.ts` — `COR_DO_STATUS` (~l.106), comentário acima dele, `LARGURA_CONEXAO`/`OPACIDADE_CONEXAO` (~l.325-332) e seus comentários, `camadasDeConexao()` (~l.389-415)
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.scss` — linha 246 (`.legend__dot--success/danger/warning/info/neutral/muted`)
- Test: `infra-monitor-frontend/src/app/features/mapa/mapa.component.spec.ts` (~l.207-235)

**Interfaces:**
- Produces: `camadasDeConexao(): LayerSpecification[]` com 2 itens, `[0].id === 'conexoes-halo'`, `[1].id === 'conexoes-linha'`. `corDoStatus(status)` devolve a paleta nova.

- [ ] **Step 1: Teste que falha.** Substituir o `describe('camada de conexao (D18)'...)` por:

```ts
describe('camadas de conexao (D18, halo de D24)',()=>{
  const CORES_ESPERADAS = ['match', ['get','status'],
    'DISPONIVEL', '#35e087',
    'INDISPONIVEL', '#f84e54',
    'DEGRADADA', '#fcb142',
    'SEM_DADOS', '#9dabb9',
    'SEM_EQUIPAMENTOS', '#6e8698',
    'EM_MANUTENCAO', '#7fadff',
    '#9dabb9'];
  const paintDe=(i:number)=>(camadasDeConexao()[i] as unknown as {paint:Record<string,unknown>}).paint;

  it('desenha o halo antes do nucleo, sem filtro por status',()=>{
    const camadas=camadasDeConexao();
    expect(camadas.map(c=>c.id)).toEqual(['conexoes-halo','conexoes-linha']);
    for(const c of camadas) expect((c as {filter?:unknown}).filter).toBeUndefined();
  });

  it('pinta nucleo e halo com a mesma cor vibrante do status',()=>{
    // Corpo inteiro do match, na ordem exata: um toContain isolado passaria com o par invertido.
    expect(paintDe(0)['line-color']).toEqual(CORES_ESPERADAS);
    expect(paintDe(1)['line-color']).toEqual(CORES_ESPERADAS);
    expect(paintDe(1)['line-gradient']).toBeUndefined();
  });

  it('halo largo, borrado e translucido; nucleo fino e quase opaco',()=>{
    expect(paintDe(0)).toEqual(jasmine.objectContaining({'line-width':6,'line-blur':4,'line-opacity':0.28}));
    expect(paintDe(1)).toEqual(jasmine.objectContaining({'line-width':1.6,'line-opacity':0.85}));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.** `cd infra-monitor-frontend && npx ng test --watch=false --include=src/app/features/mapa/mapa.component.spec.ts` → FAIL (1 camada, cores antigas).

- [ ] **Step 3: Implementar.**
  - `COR_DO_STATUS` com a paleta de Global Constraints. Acrescentar ao comentário um parágrafo "D24": valores vibrantes calculados por script (HSL: coloridos `S×1,18+0,04`, `L+0,05` com teto 0,72 sem baixar; neutros `S×1,1`, `L+0,08`/`+0,04`); contraste × `#16283a`: 8,70 / 4,44 / 8,23 / 6,67 / 6,41 / 3,95; ΔE OKLab mínimo 10,5 (manutenção × sem-dados), sem-dados × sem-equipamentos 9,7 → 12,8; `em-manutencao` já tinha saturação 100%. Atualizar os números de D19 citados no comentário existente sem apagar o histórico (dizer "eram 5,01/3,41 em D19").
  - `LARGURA_CONEXAO = 1.6`, `OPACIDADE_CONEXAO = 0.85`, comentário: o halo carrega a translucidez, o núcleo pode ficar mais opaco.
  - Constantes novas logo abaixo: `LARGURA_HALO_CONEXAO = 6`, `BORRAO_HALO_CONEXAO = 4`, `OPACIDADE_HALO_CONEXAO = 0.28`, com comentário: brilho no WebGL — o canvas não aplica `filter`/`box-shadow`; uma segunda `line` larga e borrada por baixo é o equivalente nativo, estática, custo por quadro ~0 (medido na Task 5).
  - `camadasDeConexao()`: extrair a expressão de cor para uma `const corDaConexao = [...]` local e devolver:

```ts
return [{
  id: 'conexoes-halo', type: 'line', source: 'conexoes', layout: { 'line-cap': 'round' },
  paint: { 'line-width': LARGURA_HALO_CONEXAO, 'line-blur': BORRAO_HALO_CONEXAO, 'line-opacity': OPACIDADE_HALO_CONEXAO, 'line-color': corDaConexao },
}, {
  id: 'conexoes-linha', type: 'line', source: 'conexoes', layout: { 'line-cap': 'round' },
  paint: { 'line-width': LARGURA_CONEXAO, 'line-opacity': OPACIDADE_CONEXAO, 'line-color': corDaConexao },
}] as unknown as LayerSpecification[];
```

  - Conferir com `grep -n "camadasDeConexao()" src/app/features/mapa/mapa.component.ts` que `montarMapa` espalha (`...camadasDeConexao()`) no array de camadas; se indexar `[0]`, corrigir para espalhar.
  - SCSS linha 246: trocar `background:var(--im-success)` → `#35e087`, `var(--im-danger)` → `#f84e54`, `var(--im-warning)` → `#fcb142`, `var(--im-info-soft)` → `#7fadff`, `#8797a6` → `#9dabb9`, `#667b8b` → `#6e8698`; o comentário inline existente passa a dizer "Hex literal e não token: espelha `COR_DO_STATUS` em mapa.component.ts (D19 para os neutros, D24 para os seis) — muda junto." (um comentário só, removendo o "Idem").
  - `grep -rn "8797a6\|667b8b\|34c77b\|e5484d\|e8a33d" src/app/features/mapa` — os fallbacks `var(--cor-unidade, #8797a6)`/`var(--cor-ping, #8797a6)` no SCSS passam a `#9dabb9`.

- [ ] **Step 4: Rodar e passar.** Mesmo comando → PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mapa): paleta vibrante e halo WebGL na conexao (D24)" -- infra-monitor-frontend/src/app/features/mapa/mapa.component.ts infra-monitor-frontend/src/app/features/mapa/mapa.component.scss infra-monitor-frontend/src/app/features/mapa/mapa.component.spec.ts
```

---

### Task 3: Três pings em fluxo contínuo com fade nas pontas

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.ts` — `PERIODO_PING_MS`/`PINGS_POR_LINHA` (~l.157-171) e comentários, `faseVaiEVolta` (~l.173-183, sai), `montarPings` (~l.862-924)
- Test: `infra-monitor-frontend/src/app/features/mapa/mapa.component.spec.ts` (import l.3; `describe('movimento do ping...')` l.130-160)

**Interfaces:**
- Produces: `export function faseDeFluxo(ciclos: number): number` (em [0,1)); `export function opacidadeNaPonta(u: number): number` (em [0,1]); `export const FADE_NA_PONTA = 0.08` não exportado é ok — exportar só as duas funções.

- [ ] **Step 1: Testes que falham.** No import da linha 3 trocar `faseVaiEVolta` por `faseDeFluxo, opacidadeNaPonta`. Substituir os três primeiros `it` do `describe('movimento do ping na linha de conexao')` (manter o `it` de `interpolar`) por:

```ts
  it('avanca sempre no mesmo sentido, hub -> unidade, e recomeca no hub',()=>{
    expect(faseDeFluxo(0)).toBe(0);
    expect(faseDeFluxo(0.25)).toBe(0.25);
    expect(faseDeFluxo(0.75)).toBe(0.75);
    expect(faseDeFluxo(0.9999)).toBeCloseTo(0.9999, 10);
    expect(faseDeFluxo(1)).toBe(0);
    expect(faseDeFluxo(2.5)).toBe(0.5);
  });

  /* D24: tres pings por linha, a 1/3 um do outro EM QUALQUER instante — inclusive depois que um
   * deles recomecou no hub. Distancia circular, porque 0,9 e 0,23 estao a 1/3 pela virada. */
  it('mantem os tres pings da mesma linha a 1/3 um do outro',()=>{
    const circular=(a:number,b:number)=>{const d=Math.abs(a-b)%1;return Math.min(d,1-d);};
    for(const ciclos of [0,0.1,0.5,0.73,1.2,-0.4]){
      const fases=[0,1,2].map(k=>faseDeFluxo(ciclos+k/3));
      expect(circular(fases[0],fases[1])).toBeCloseTo(1/3,10);
      expect(circular(fases[1],fases[2])).toBeCloseTo(1/3,10);
      expect(circular(fases[2],fases[0])).toBeCloseTo(1/3,10);
    }
  });

  it('aceita ciclo negativo sem inverter o sentido',()=>{
    expect(faseDeFluxo(-0.25)).toBeCloseTo(0.75,10);
  });

  /* A virada 1 -> 0 teleporta o ping pela corda inteira. Opacidade zero nas DUAS pontas exatas e o
   * salto acontece invisivel; sem isto um risco atravessaria o arco a cada 1400 ms. */
  it('some nas duas pontas e fica inteiro no meio do arco',()=>{
    expect(opacidadeNaPonta(0)).toBe(0);
    expect(opacidadeNaPonta(1)).toBe(0);
    expect(opacidadeNaPonta(0.04)).toBeCloseTo(0.5,10);
    expect(opacidadeNaPonta(0.96)).toBeCloseTo(0.5,10);
    expect(opacidadeNaPonta(0.08)).toBeCloseTo(1,10);
    expect(opacidadeNaPonta(0.5)).toBe(1);
  });
```

- [ ] **Step 2: Rodar e ver falhar** (`npx ng test --watch=false --include=src/app/features/mapa/mapa.component.spec.ts`) → erro de compilação: `faseDeFluxo` não exportado.

- [ ] **Step 3: Implementar.**
  - Apagar `faseVaiEVolta` e seu comentário. No lugar:

```ts
/**
 * Posição no fluxo, dado o tempo em ciclos. `0 → 1` e recomeça no hub. Pura.
 *
 * D24 trocou o vai-e-volta de D16 por fluxo num sentido só, a pedido: três pings com espaçamento
 * REGULAR ao longo do arco. Na onda triangular de D16 isso é impossível — com duas fases opostas os
 * pings se cruzam no meio, e com fases 0/⅓/⅔ dois deles coincidem. Em dente de serra, defasar de
 * k/3 mantém a distância de ⅓ em qualquer instante. O custo continua O(1) por quadro: muda a
 * função de fase, não a técnica (`Marker` DOM + `pontoNoArco`).
 */
export function faseDeFluxo(ciclos: number): number {
  return ((ciclos % 1) + 1) % 1;
}

/** Fração do arco, em cada ponta, em que o ping nasce e some. */
const FADE_NA_PONTA = 0.08;

/**
 * Opacidade do ping na posição `u` do arco. Pura.
 *
 * Zero nas duas pontas exatas: é o que esconde a virada do dente de serra, quando o ping salta de
 * u≈1 para u=0. Linear em 8% de cada lado — o ping nasce no hub e se apaga ao chegar na unidade,
 * em vez de surgir do nada sobre o marcador.
 */
export function opacidadeNaPonta(u: number): number {
  return Math.max(0, Math.min(1, u / FADE_NA_PONTA, (1 - u) / FADE_NA_PONTA));
}
```

  - `PINGS_POR_LINHA = 3` com comentário: três, a ⅓ um do outro, fluxo hub → unidade (D24 substituiu o par em fase oposta de D16).
  - `PERIODO_PING_MS` continua 4200; acrescentar ao comentário: desde D24 é UMA travessia hub → unidade, não ida e volta — a velocidade caiu à metade, o que compensa a densidade 3× (chega um ping na unidade a cada 1400 ms); mesmo argumento de D17 contra "tráfego agitado".
  - Em `montarPings`: no `return { marcador, origem, destino, defasagem }` incluir `elemento`; o laço vira:

```ts
      for (const { marcador, elemento, origem, destino, defasagem } of trajetos) {
        const u = faseDeFluxo(ciclos + defasagem);
        marcador.setLngLat(pontoNoArco(origem, destino, u));
        elemento.style.opacity = String(opacidadeNaPonta(u));
      }
```

    e o `setLngLat(origem)` inicial ganha `elemento.style.opacity = '0'` antes do `addTo` (sem flash no primeiro quadro). Atualizar o comentário JSDoc de `montarPings` ("Dois pings…"/"ida e volta") para três e fluxo; acrescentar: `style.opacity` por quadro é propriedade de compositor — não repinta o glow.
  - `grep -n "faseVaiEVolta\|ida e volta\|ida-e-volta\|fase oposta" src/app/features/mapa` → só ocorrências históricas explicitamente marcadas como D16.

- [ ] **Step 4: Rodar e passar.** Mesmo comando → PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(mapa): tres pings em fluxo continuo a 1/3 com fade nas pontas (D24)" -- infra-monitor-frontend/src/app/features/mapa/mapa.component.ts infra-monitor-frontend/src/app/features/mapa/mapa.component.spec.ts
```

---

### Task 4: Orbe luminoso no ping e glow no marcador (CSS)

Use `frontend-design:frontend-design` para o acabamento visual; os valores abaixo são o ponto de partida aprovado — ajuste fino (±1px de glow, ±10% de mistura) só se a captura 4× da Task 6 mostrar defeito, e registrando o motivo no comentário.

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.scss` — `.map__unidade` (l.74), `.map__unidade[aria-pressed='true']` (l.120), bloco `.map__ping` e comentário (l.144-181)

**Interfaces:**
- Consumes: `--cor-ping`, `--cor-unidade` (inline, do componente); `elemento.style.opacity` escrito pela Task 3.

- [ ] **Step 1: `.map__ping`.** Substituir o bloco inteiro por:

```scss
  .map__ping {
    width: 5px; height: 5px; border: 0; border-radius: 50%;
    background: var(--cor-ping, #9dabb9);
    background: radial-gradient(circle,
      color-mix(in srgb, #fff 55%, var(--cor-ping, #9dabb9)) 0%,
      var(--cor-ping, #9dabb9) 45%,
      color-mix(in srgb, var(--cor-ping, #9dabb9) 0%, transparent) 100%);
    box-shadow: 0 0 4px 1px color-mix(in srgb, var(--cor-ping, #9dabb9) 70%, transparent);
    pointer-events: none; z-index: 1;
  }
```

  Reescrever o comentário acima: (a) D24 — orbe luminoso substitui a esfera de D18-B a pedido: núcleo claro, cor, borda que some no fundo; glow NA COR do status; (b) o contorno branco eram DUAS camadas — `border: 1px solid rgba(232,240,248,.8)` e a primeira sombra `0 0 5px 1px rgba(232,240,248,.3)` — ambas saíram; (c) 7px → 5px: com 3 pings por arco, 7px enchia a linha; 5px + glow de 4px lê como ponto de luz, não como bola; (d) sem stop escuro: fecha DV16 (o `70% + #000` não existe mais); (e) mantém a nota da declaração plana antes do gradiente; (f) `--cor-ping` continua o contrato do e2e; (g) glow estático, nunca animado (§9.2: `box-shadow` animado é 45% mais caro) — o que muda por quadro é `transform` (lib) e `opacity` (Task 3), ambos de compositor.

- [ ] **Step 2: `will-change`** — NÃO adicionar agora. A Task 5 mede `D3` × `D3w`; se `D3w` ganhar > 10% de CPU, a Task 5 acrescenta `will-change: transform` aqui com o número no comentário.

- [ ] **Step 3: `.map__unidade`.** No l.74 trocar `box-shadow: 0 1px 3px rgba(0, 0, 0, .6)` por:

```scss
box-shadow: 0 0 6px 1px color-mix(in srgb, var(--cor-unidade, #9dabb9) 55%, transparent), 0 1px 3px rgba(0, 0, 0, .6);
```

  e no selecionado (l.120), mantendo o anel como PRIMEIRA sombra:

```scss
.map__unidade[aria-pressed='true'] { width: 19px; height: 19px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--cor-unidade, #9dabb9) 78%, transparent), 0 0 9px 2px color-mix(in srgb, var(--cor-unidade, #9dabb9) 45%, transparent), 0 1px 3px rgba(0, 0, 0, .6); }
```

  Comentário curto antes de `.map__unidade`: D24 — glow translúcido na cor do status; o miolo continua OPACO porque desde D19 é ele quem carrega o contraste (pior caso sem-equipamentos 3,95:1); translucidez no miolo derrubaria esse número abaixo de 3:1. Glow começa no raio do miolo e se espalha 6px — fica por baixo do anel de foco (que é `outline`, pinta por cima) e não altera a geometria de D19. No selecionado: o anel vem primeiro de propósito (o e2e `corBateComSombra` lê a primeira cor da `box-shadow`).

- [ ] **Step 4: Build e testes.** `npx ng build` (aviso de budget `anyComponentStyle` do mapa é pré-existente — aceitar só esse) e `npx ng test --watch=false` (suíte inteira) → PASS.

- [ ] **Step 5: Conferência visual rápida** em `http://127.0.0.1:4201/mapa` com o backend 8082 (Playwright, uma captura da tela inteira em `<scratchpad>/d23-rascunho.png`) — olhar a imagem: pings visíveis, 3 por arco, sem contorno branco, glow presente, linha com halo.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(mapa): ping em orbe luminoso sem contorno branco e glow no marcador (D24)" -- infra-monitor-frontend/src/app/features/mapa/mapa.component.scss
```

---

### Task 5: Bancada `perf:mapa` com o CSS real e medição depois

**Files:**
- Modify: `infra-monitor-frontend/e2e/perf-mapa/banco.html`, `infra-monitor-frontend/e2e/perf-mapa/perf-mapa-animacoes.cjs`, `infra-monitor-frontend/e2e/perf-mapa/README.md`
- Output: `e2e/perf-mapa/bench.json`, `e2e/perf-mapa/app-depois-dev.json`, `e2e/perf-mapa/app-depois-carga.json`

**Interfaces:**
- Consumes: CSS final de `.map__ping` e `.map__unidade` (Task 4), `faseDeFluxo`/`opacidadeNaPonta` (copiadas literalmente para o `banco.html`, que não importa o componente).

- [ ] **Step 1: Ler `banco.html` e `perf-mapa-animacoes.cjs` inteiros.** Manter os cenários A–F, BD, B5, D5, E5 intactos (comparabilidade com §9.2).

- [ ] **Step 2: Classes novas em `banco.html`:**
  - `.ping-d18` = CSS de `.map__ping` em `origin/main` (7px, `border: 1px solid rgba(232,240,248,.8)`, gradiente D18-B, três sombras — copiar de `git show origin/main:infra-monitor-frontend/src/app/features/mapa/mapa.component.scss`).
  - `.ping-d24` = CSS final da Task 4.
  - `.ping-d24w` = `.ping-d24` + `will-change: transform`.
  - `.u-glow` = glow do marcador da Task 4 aplicado aos marcadores do banco.
  - Cada ping recebe `--cor-ping` da paleta nova, ciclando pelos 6 status.
  - Camada `conexoes-halo` nova (mesmos parâmetros da Task 2) antes da camada de linha do banco, visível só nos cenários `H` e `BD3` (`setLayoutProperty(..., 'visibility', ...)`).

- [ ] **Step 3: Cenários novos** (em `window.cenario` e em `CENARIOS`):
  - `D2r` — 20 pings `.ping-d18`, vai-e-volta (a produção ANTES).
  - `BD2r` — B + D2r (a tela inteira ANTES).
  - `D3` — 30 pings `.ping-d24`, `faseDeFluxo` + `opacidadeNaPonta` por quadro.
  - `D3w` — D3 com `.ping-d24w`.
  - `H` — mapa parado com halo visível.
  - `BD3` — B com `.u-glow` + D3 + halo (a tela inteira DEPOIS).
  - `BD3x5` — 5× BD3 (150 pings, 55 marcadores) — margem.
  O pool de pings sobe de 100 para 150.

- [ ] **Step 4: Rodar** `npm run perf:mapa`. **Gate:** 0% de frames > 20 ms em todos os cenários; Δ CPU de `BD3` sobre `A` ≤ 2,35 ms. Se falhar: medir `D3w`; se ainda falhar, reduzir glow do ping para `0 0 3px 0` e remedir; registrar o que foi feito. Se `D3w` < `D3` em mais de 10%, adicionar `will-change: transform` em `.map__ping` (Task 4 Step 2) com o número no comentário; senão, não adicionar e registrar o porquê.

- [ ] **Step 5: App real depois** (backends 8082/8083 e `ng serve` 4201 da Task 1 ainda no ar; reiniciar `ng serve` se tiver overlay de erro):

```bash
FRONT_URL=http://127.0.0.1:4201 API_PORT=8082 E2E_EMAIL=d23.perf@inframonitor.local PERF_SENHA=$ADMIN PERF_ROTULO=depois-dev npm run perf:mapa-app
FRONT_URL=http://127.0.0.1:4201 API_PORT=8083 E2E_EMAIL=d23.perf@inframonitor.local PERF_SENHA=$ADMIN PERF_ROTULO=depois-carga npm run perf:mapa-app
```

  Expected: dev 11 marcadores / 30 pings; carga 2 / 3. 0% lentos.

- [ ] **Step 6: README** — tabela de cenários ganha as 7 linhas novas e uma seção "App real (`perf:mapa-app`)" com o comando e as variáveis.

- [ ] **Step 7: Commit**

```bash
git commit -m "test(mapa): bancada com CSS real do ping e cenarios de D24" -- infra-monitor-frontend/e2e/perf-mapa/
```

  (mais `mapa.component.scss` se `will-change` entrou.)

---

### Task 6: E2E ajustados e capturas comparativas

**Files:**
- Modify: `infra-monitor-frontend/e2e/n07-pulso-ping-dica.cjs`
- Create: `infra-monitor-frontend/e2e/d24-arco-capturas.cjs`
- Output: `infra-monitor-frontend/e2e/d24-evidence/` (só capturas do banco de dev; as da carga vão para `<scratchpad>/d23-carga/`, fora do repo — memória `banco-carga-real-separado`)
- Modify: `infra-monitor-frontend/package.json` (`"e2e:d24": "node e2e/d24-arco-capturas.cjs"`)

**Interfaces:**
- Consumes: classes `.map__ping`, `.map__unidade`, `[data-unidade-id]`, `--cor-ping`, `--cor-unidade`; tema por `localStorage['infra-monitor.tema'] = 'escuro'|'claro'` (conferir os valores aceitos em `src/app/core/services/theme.service.ts` antes) e `document.documentElement.dataset.theme`.

- [ ] **Step 1: n07.**
  - `STATUS_TODOS`: hex da paleta nova.
  - Caso 7: `pings.length === conexoesEsperadas * 3`, mensagem "três pings por linha de conexão desenhável, a ⅓ (D24)".
  - Caso 7, novo: todo ping com `getComputedStyle(n).width === '5px'`, `borderTopWidth === '0px'` e `boxShadow` sem `232, 240, 248` e sem `255, 255, 255` ("sem contorno branco, D24").
  - Caso 8 ("nenhum ping fica parado"): o fade zera a opacidade perto das pontas, mas a posição continua mudando — o critério de distância segue válido. Mudar o rótulo da janela: 1050 ms são ¼ de uma travessia (4200 ms); manter.
  - Caso 8, novo: nas 3 amostras, nenhum ping com opacidade `> 0.05` a menos de 2px do centro do marcador hub ou do filho — se ficar complexo, trocar por: em alguma das amostras existe ping com `style.opacity < 1` (fade ativo) e todos `style.opacity` ∈ [0,1].
  - Atualizar comentários de cabeçalho que dizem "dois pings"/"fases opostas".
- [ ] **Step 2: Rodar n07 contra o clone dev:** `FRONT_URL=http://127.0.0.1:4201 API_PORT=8082 E2E_EMAIL=d23.perf@inframonitor.local N07_SENHA=$ADMIN npm run e2e:n07` → todos os casos verdes. Depois `e2e:n06` e `e2e:n08` (`N06_SENHA`, `N08_SENHA`) → verdes. Corrigir o roteiro se a falha for de expectativa antiga de D16/D18; corrigir o código se for regressão.
- [ ] **Step 3: `d24-arco-capturas.cjs`.** Login + navegação por clique (copiar de n07), `apontarApi`. Gera:
  1. `seis-status-{antes,depois}.png` — `.map-card` com 6 linhas horizontais sintéticas: para cada status, injetar um `<div>` com o CSS do ping (antes: CSS de `origin/main` inline; depois: `.map__ping` real com `--cor-ping`) dentro de `.map-card` (para valer o `:host ::ng-deep`), sobre fundo `#16283a`, ao lado de um marcador (`.map__unidade` sintético) e de um traço de linha simulado (div de 1,6px com a cor a 0,85 sobre halo de 6px blur 4 a 0,28). Escala 4× (`deviceScaleFactor: 4`, clip pequeno). Rótulo de texto com o nome do status.
  2. `ping-7px-vs-5px.png` — antes e depois lado a lado a 4×, um status por linha.
  3. Mapa real: `{escuro,claro}-{estado,municipio}.png` — estado = tela como abre; município = clique no município de Aracaju (centroide) ou do hub; esperar 900 ms. Rótulo `PERF_ROTULO`/`CAP_ROTULO` no nome (`dev`/`carga`) e saída em `CAP_SAIDA` (default `e2e/d24-evidence`).
  4. `reduced-motion-{escuro}.png` com `reducedMotion: 'reduce'` + checagem: 0 `.map__ping`, `::after` com `animation-name: none`.
  Imprime JSON de checagens (`ok`/`falha`) e sai com código 1 se alguma falhar.
- [ ] **Step 4: "Antes" do mapa real.** Worktree temporário de `origin/main` em `<scratchpad>/wt-main` (com junção de `node_modules`), `ng serve --port 4202`; rodar `d24-arco-capturas.cjs` com `FRONT_URL=http://127.0.0.1:4202 CAP_ROTULO=antes-dev` (API 8082) e `antes-carga` (API 8083, `CAP_SAIDA=<scratchpad>/d23-carga`). Parar o `ng serve` 4202 por PID, `rmdir` a junção, `git worktree remove`.
- [ ] **Step 5: "Depois"**: mesmo roteiro com `FRONT_URL=http://127.0.0.1:4201`, `CAP_ROTULO=depois-dev`/`depois-carga`.
- [ ] **Step 6: Conferir as imagens (Read de cada PNG).** Critérios: 3 pings por arco; nenhum contorno branco; 6 status distinguíveis lado a lado (em especial sem-dados × sem-equipamentos × em-manutenção); glow visível e não "borrão" no tema claro sobre o fundo `#f2f6fa`; halo da linha visível sem apagar o município; marcador selecionado legível. Anotar o que se vê em `e2e/d24-evidence/LEIA.md` (uma linha por imagem).
- [ ] **Step 7: Commit**

```bash
git commit -m "test(mapa): e2e de tres pings sem contorno e capturas comparativas de D24" -- infra-monitor-frontend/e2e/n07-pulso-ping-dica.cjs infra-monitor-frontend/e2e/d24-arco-capturas.cjs infra-monitor-frontend/e2e/d24-evidence/ infra-monitor-frontend/package.json
```

  Antes: conferir que nenhum JSON/PNG do repo contém dado da carga (`grep -rl "Itabaiana\|carga" e2e/d24-evidence` só pode achar nome de unidade que também existe no dev — provar pelo número de marcadores, 11).

---

### Task 7: Documentação D24, encerramento e PR

**Files:**
- Modify: `Docs/mapa-architecture/mapa-decisoes.md` (nova `## D24` ao fim), `Docs/mapa-architecture/mapa-contexto-atual.md` (nova seção §17 D24 com números; §9.2 ganha nota apontando para §17), `Docs/mapa-architecture/mapa-dividas.md` (DV16 → **Fechada (D24)** com o porquê, sem apagar o histórico), `Docs/mapa-architecture/mapa-architecture.md` (linha D24 na tabela "Estado do ciclo"; `D01–D22` → `D01–D24`)

- [ ] **Step 1: D24 em `mapa-decisoes.md`**, no formato das anteriores: pedido; o que entrou (paleta com tabela de contraste e ΔE; halo WebGL e por que não `filter`; três pings em fluxo; orbe 5px; glow do marcador com miolo opaco); **reversões** explícitas: D16 (ida e volta → fluxo, com a prova de que espaçamento regular é incompatível com a onda triangular) e D18-B (esfera → orbe); origem do contorno branco (as duas camadas, código antes); o que não mudou (técnica `Marker` DOM, `pontoNoArco` O(1), DV13, geometria de D19, reduced-motion); verificado (números da bancada A/D2r/BD2r/D3/D3w/H/BD3/BD3x5, app real antes/depois dev e carga, `ng test` N/N, `e2e:n06/n07/n08` X/X, capturas); descartado (`filter`/`drop-shadow` no DOM, `circle-blur` em camada WebGL = cenário E, miolo translúcido, `will-change` se não entrou).
- [ ] **Step 2: Contexto §17** com as tabelas de números reais copiadas de `bench.json` e `app-*.json`; **DV16 fechada**: stop escuro não existe; pior núcleo sem-equipamentos 3,95:1; captura `seis-status-depois.png`.
- [ ] **Step 3: `ng test --watch=false` e `ng build` finais**, contagem anotada.
- [ ] **Step 4: Commit**

```bash
git commit -m "docs(mapa): D24 — tres pings em fluxo, orbe, halo e paleta vibrante; DV16 fechada" -- Docs/mapa-architecture/
```

- [ ] **Step 5: Encerramento do ambiente.** `Get-CimInstance Win32_Process` filtrando `d23-backend` e `ng.js serve --port 4201`/`4202`; `Stop-Process` por PID; `netstat` provando 8082/8083/4201/4202 livres; `docker rm -f d23-dev d23-carga`; apagar `<scratchpad>/d23-env.sh` e o dump, se houver. Conferir que 8080, 4200, 5434, 5436 continuam como estavam.
- [ ] **Step 6: Push e PR** para `main`: `git push -u origin feat/mapa-arco-brilho`; `gh pr create` com resumo, tabela de números, links das capturas e a nota de que o PR #13 (visual r2) foi mergeado no branch do #12 depois do #12 já estar no `main` (conteúdo do r2 ausente do `main`; `mapa.component.scss` l.246 vai conflitar trivialmente quando r2 entrar). Corpo termina com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

# Rodada final antes da carga real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clique no marcador sempre abre a unidade (com aviso de IBGE divergente), CAS no fechamento manual de incidente e na normalização de episódio de latência (+ filtro A2b), publicação da `main`, e script de carga real pronto sem execução.

**Architecture:** Frontend Angular 21 (signals, standalone) com MapLibre; funções puras testadas em Vitest, comportamento em Playwright `.cjs`. Backend Spring Boot 4.1 / JPA; guardas de concorrência como bulk update JPQL condicional (CAS) no idioma de `fecharAutomaticamenteSeEmAberto`; provas com Testcontainers + `CyclicBarrier`. Script Node ≥18 sem dependências.

**Tech Stack:** Java 21, Spring Boot 4.1, PostgreSQL 16, Testcontainers, Angular, Vitest, Playwright, MapLibre GL, Node.

**Spec:** `Docs/superpowers/specs/2026-09-24-rodada-final-carga-real-design.md`

## Global Constraints

- Árvore de trabalho: `C:/Users/rbfilho/Documents/infra-monitor-merge` (branch `main`). **Nunca** trabalhar em `C:/Users/rbfilho/Documents/infra-monitor` (outra branch, mudanças locais alheias). Nenhum `merge`, `rebase`, `reset`, `checkout` de branch.
- Stage **sempre por caminho explícito** (`git add <arquivos>`); nunca `git add -A`/`.`. Se `index.lock` existir (outro agente commitando), esperar e tentar de novo — nunca apagar o lock.
- Banco de dev (container `inframonitor-postgres`, porta 5434, usuário/db `inframonitor`): só `SELECT` de conferência e a subida do backend em modo leitura. Nenhum INSERT/UPDATE/DELETE/DDL. Baseline: `Docs/..` não; arquivo `C:/Users/rbfilho/AppData/Local/Temp/claude/C--Users-rbfilho-Documents-infra-monitor/e6dda588-f276-45d4-a9f1-4ea7ee4ed8e6/scratchpad/baseline-dev.txt` (flyway 18, episódio 2, tipo 8, equipamento 222, medição 317080, unidade 12, monitor 222, incidente 76, notificação 10, janela 224, usuários 1).
- Backend contra o banco de dev só com `MONITORING_ENGINE_ENABLED=false` equivalente: propriedades `monitoring.engine.enabled=false`, `notification.dispatcher.enabled=false`, `notification.telegram.enabled=false`. **Nunca** exportar `infra-monitor-backend/.env`.
- Maven: **um processo Maven por vez** no worktree (compartilham `target/`). Tarefas backend são sequenciais.
- Sem Lombok; sem abstração especulativa; comentários em português no estilo do arquivo; datas `Instant`.
- Cada commit inclui a atualização correspondente em `Docs/validacao-producao/` (mesmo commit).
- Rodapé de todo commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Credencial de dev do e2e: `admin@inframonitor.local`, senha por env `MAPA_SENHA` (valor documentado em `Docs/Front-End-Docs/F11 - Alinhamento do Painel ao Mockup.md:207`). Nunca gravar a senha em arquivo versionado.

## Ordem e paralelismo

- Onda A (paralelo): Task 1 (investigação do mapa) ‖ Task 2 (funções geo puras) ‖ Task 5 (A1) ‖ Task 7 (script de carga).
- Onda B: Task 3 (correção do mapa + aviso + e2e) depois de 1 e 2 ‖ Task 6 (A2/A2b) depois de 5.
- Onda C: Task 4 (aviso no detalhe da unidade) depois de 2 — pode ir junto com a onda B.
- Onda D: Task 8 (publicação) depois de todas.

Pré-requisito do e2e (controlador, antes da onda A): empacotar o backend atual e copiar o jar para o scratchpad, para que o backend do e2e não dispute `target/` com os testes Maven:
```bash
cd /c/Users/rbfilho/Documents/infra-monitor-merge/infra-monitor-backend && ./mvnw -q -DskipTests package && cp target/*.jar "$SCRATCH/backend-e2e.jar"
```
Subida (controlador) quando o e2e precisar:
```bash
DB_PORT=5434 DB_USERNAME=inframonitor DB_PASSWORD=<do docker inspect> JWT_SECRET=<32+ bytes> \
java -jar "$SCRATCH/backend-e2e.jar" --monitoring.engine.enabled=false \
  --notification.dispatcher.enabled=false --notification.telegram.enabled=false
```
e `npx ng serve --port 4200` em `infra-monitor-frontend/`.

---

### Task 1: Investigação do clique do marcador (evidência, sem correção)

**Files:**
- Create: `infra-monitor-frontend/e2e/mapa-marcador-investigacao.cjs`
- Create: `Docs/validacao-producao/mapa-marcador-e-ibge.md` (seção "Investigação")

**Interfaces:**
- Produces: conclusão escrita sobre (a) qual evento DOM o MapLibre usa para o `click` de camada, (b) `evento.originalEvent.target` no handler `municipios-fill` quando o clique é no marcador (é o `<button class="map__unidade">`?), (c) ordem real dos dois handlers, (d) se Aracaju (várias unidades, IBGE coerente) também perde a seleção. Task 3 escolhe o mecanismo da correção a partir disto.

- [ ] **Step 1: Ler o código envolvido** — `infra-monitor-frontend/src/app/features/mapa/mapa.component.ts:520-540` (`selectMunicipio`/`selectUnidade`/`limparUnidade`), `:655-731` (montagem: `map.on('click','municipios-fill')` em `:667`, marcadores de unidade em `:706-725`), `:804-810` (`selecionarPeloMarcador`); e em `node_modules/maplibre-gl/dist/maplibre-gl-dev.js` (ou `.mjs`) procurar `class Marker` e `_onMapClick`/`addEventListener` para ver onde o elemento do marker é anexado (`getCanvasContainer()`) e quais listeners de mouse o `HandlerManager` registra no container (e se com `capture`).

- [ ] **Step 2: Escrever o roteiro de investigação** — Playwright, mesmas três regras dos roteiros existentes (sessão só em memória → navegar por clique; sem catch silencioso em seletor; resultados em `finally`). Esqueleto:

```js
/*
 * Investigação: por que o clique no marcador de unidade limpa a seleção.
 *   MAPA_SENHA=<senha> node e2e/mapa-marcador-investigacao.cjs
 * Pré-requisitos: backend (banco de dev, motor e dispatcher DESLIGADOS) em 8080, ng serve em 4200.
 * Não escreve nada no banco: só login e cliques.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const BASE = 'http://127.0.0.1:4200';
const EMAIL = 'admin@inframonitor.local';
const SENHA = process.env.MAPA_SENHA; if (!SENHA) throw new Error('MAPA_SENHA é obrigatória');
const OUT = path.join(__dirname, 'mapa-marcador-evidence', 'investigacao'); fs.mkdirSync(OUT, { recursive: true });
const registro = [];
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(`${BASE}/login`);
    await page.getByLabel(/e-?mail/i).fill(EMAIL);
    await page.getByLabel(/senha/i).fill(SENHA);
    await page.getByRole('button', { name: /entrar/i }).click();
    await page.getByRole('link', { name: /mapa/i }).click();
    await page.locator('.map__unidade').first().waitFor();
    // Instrumentação SÓ na página de teste: registra cada evento de mouse/pointer que chega ao
    // container do mapa, com alvo e fase, e cada mudança do painel.
    await page.evaluate(() => {
      window.__ev = [];
      const cont = document.querySelector('.maplibregl-canvas-container') || document.querySelector('.maplibregl-map');
      for (const tipo of ['pointerdown','mousedown','pointerup','mouseup','click']) {
        cont.addEventListener(tipo, e => window.__ev.push({ tipo, fase: 'captura', alvo: e.target.className?.toString() }), true);
        cont.addEventListener(tipo, e => window.__ev.push({ tipo, fase: 'bolha', alvo: e.target.className?.toString() }), false);
      }
    });
    for (const [rotulo, seletor] of [['ITA-09', '.map__unidade[aria-label*="Itabaiana"]'], ['Aracaju-1', '.map__unidade[aria-label*="Aracaju"]']]) {
      await page.evaluate(() => { window.__ev = []; });
      const alvo = page.locator(seletor).first();
      await alvo.click();
      await page.waitForTimeout(400);
      const painel = await page.locator('.selected-panel, .unit-panel, [class*="painel"]').allInnerTexts();
      const pressed = await alvo.getAttribute('aria-pressed');
      const eventos = await page.evaluate(() => window.__ev);
      registro.push({ rotulo, pressed, painel, eventos });
      await page.screenshot({ path: path.join(OUT, `${rotulo}.png`) });
    }
  } finally {
    fs.writeFileSync(path.join(OUT, 'investigacao.json'), JSON.stringify(registro, null, 2));
    await browser.close();
  }
})();
```
Ajustar seletores ao DOM real (ler `mapa.component.html` e o `aria-label` gerado por `rotuloDaUnidade`) — seletor que não casa tem de falhar alto. Para descobrir se o handler `municipios-fill` roda e com qual `originalEvent.target`, usar `page.exposeFunction` + um `map.on('click', ...)` adicional **não é possível** sem acesso à instância; em vez disso, observar o efeito (painel/`aria-pressed`) e a sequência de eventos DOM, e confirmar o alvo lendo o código do MapLibre (Step 1).

- [ ] **Step 3: Rodar** (controlador sobe backend-jar + ng serve): `MAPA_SENHA=... node e2e/mapa-marcador-investigacao.cjs`. Esperado: ITA-09 → painel sem ITA-09 / `aria-pressed="false"`; registrar o que acontece com Aracaju.

- [ ] **Step 4: Escrever a seção "Investigação" em `Docs/validacao-producao/mapa-marcador-e-ibge.md`** com: mecanismo com `arquivo:linha`, a sequência de eventos observada (colar trecho do JSON), resultado ITA-09 e Aracaju, e a resposta à pergunta "o que prevalece": **a coordenada** (posiciona o marcador; IBGE pode vir errado/ausente na carga; o clique no marcador é sobre a unidade, não sobre o polígono).

- [ ] **Step 5: Commit**
```bash
git add infra-monitor-frontend/e2e/mapa-marcador-investigacao.cjs infra-monitor-frontend/e2e/mapa-marcador-evidence/investigacao Docs/validacao-producao/mapa-marcador-e-ibge.md
git commit -m "test(e2e): investigacao do clique no marcador que limpa a selecao do mapa"
```

---

### Task 2: Funções geo puras — município da coordenada e divergência de IBGE

**Files:**
- Modify: `infra-monitor-frontend/src/app/core/services/geo-municipio.service.ts`
- Create: `infra-monitor-frontend/src/app/core/services/geo-municipio.spec.ts` (se já existir spec do serviço, acrescentar nele)

**Interfaces:**
- Consumes: `Municipio { codigoIbge: string; nome: string; uf: string; feature: GeoJsonFeature }` e `normalizeCodigoIbge` do mesmo arquivo.
- Produces:
  - `export function pontoNoPoligono(ponto: [number, number], geometria: { type: string; coordinates: unknown }): boolean` — `[lng, lat]`; Polygon e MultiPolygon; anéis internos são buracos.
  - `export function municipioDaCoordenada(ponto: [number, number], municipios: Municipio[]): Municipio | null`
  - `export interface DivergenciaIbge { codigoCadastro: string; nomeCadastro: string | null; codigoCoordenada: string; nomeCoordenada: string; }`
  - `export function divergenciaIbge(unidade: { codigoIbge: string | null; latitude: number | null; longitude: number | null }, municipios: Municipio[]): DivergenciaIbge | null` — `null` se faltar IBGE ou coordenada (testar `!= null`, `0` é válido), se a coordenada cair fora de todo município, ou se os códigos baterem.

- [ ] **Step 1: Teste que falha**

```ts
import { divergenciaIbge, municipioDaCoordenada, pontoNoPoligono, Municipio } from './geo-municipio.service';

const quadrado = (x0: number, y0: number, x1: number, y1: number) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const mun = (codigoIbge: string, nome: string, geometry: { type: string; coordinates: unknown }): Municipio =>
  ({ codigoIbge, nome, uf: 'SE', feature: { type: 'Feature', properties: { id: codigoIbge, name: nome }, geometry } as never });
const itabaiana = mun('2802908', 'Itabaiana', { type: 'Polygon', coordinates: [quadrado(-38, -11, -37, -10)] });
const itabaianinha = mun('2803005', 'Itabaianinha', { type: 'Polygon', coordinates: [quadrado(-38, -12, -37, -11.001)] });
const comBuraco = mun('2800001', 'Anel', { type: 'Polygon', coordinates: [quadrado(-40, -12, -39, -11), quadrado(-39.6, -11.6, -39.4, -11.4)] });
const multi = mun('2800002', 'Ilhas', { type: 'MultiPolygon', coordinates: [[quadrado(-36, -10, -35.5, -9.5)], [quadrado(-35, -10, -34.5, -9.5)]] });
const todos = [itabaiana, itabaianinha, comBuraco, multi];

describe('pontoNoPoligono', () => {
  it('dentro e fora de Polygon', () => {
    expect(pontoNoPoligono([-37.5, -10.5], itabaiana.feature.geometry as never)).toBe(true);
    expect(pontoNoPoligono([-36.5, -10.5], itabaiana.feature.geometry as never)).toBe(false);
  });
  it('buraco não conta como dentro', () => {
    expect(pontoNoPoligono([-39.5, -11.5], comBuraco.feature.geometry as never)).toBe(false);
    expect(pontoNoPoligono([-39.9, -11.9], comBuraco.feature.geometry as never)).toBe(true);
  });
  it('MultiPolygon: qualquer parte', () => {
    expect(pontoNoPoligono([-34.7, -9.7], multi.feature.geometry as never)).toBe(true);
    expect(pontoNoPoligono([-35.2, -9.7], multi.feature.geometry as never)).toBe(false);
  });
});

describe('municipioDaCoordenada', () => {
  it('acha o município que contém o ponto', () => { expect(municipioDaCoordenada([-37.4256, -10.6853], todos)?.codigoIbge).toBe('2802908'); });
  it('fora de tudo devolve null', () => { expect(municipioDaCoordenada([0, 0], todos)).toBeNull(); });
});

describe('divergenciaIbge', () => {
  const ita09 = { codigoIbge: '2803005', latitude: -10.6853, longitude: -37.4256 };
  it('ITA-09: IBGE Itabaianinha, coordenada em Itabaiana', () => {
    expect(divergenciaIbge(ita09, todos)).toEqual({ codigoCadastro: '2803005', nomeCadastro: 'Itabaianinha', codigoCoordenada: '2802908', nomeCoordenada: 'Itabaiana' });
  });
  it('coerente devolve null', () => { expect(divergenciaIbge({ ...ita09, codigoIbge: '2802908' }, todos)).toBeNull(); });
  it('sem IBGE ou sem coordenada devolve null', () => {
    expect(divergenciaIbge({ ...ita09, codigoIbge: null }, todos)).toBeNull();
    expect(divergenciaIbge({ ...ita09, latitude: null }, todos)).toBeNull();
  });
  it('coordenada fora de SE devolve null', () => { expect(divergenciaIbge({ ...ita09, latitude: 0, longitude: 0 }, todos)).toBeNull(); });
  it('IBGE fora da cartografia: nome do cadastro null', () => {
    expect(divergenciaIbge({ ...ita09, codigoIbge: '9999999' }, todos)?.nomeCadastro).toBeNull();
  });
  it('IBGE com espaços é normalizado', () => { expect(divergenciaIbge({ ...ita09, codigoIbge: ' 2802908 ' }, todos)).toBeNull(); });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd infra-monitor-frontend && npx ng test --watch=false --include=src/app/core/services/geo-municipio.spec.ts` (se `--include` não existir no builder, rodar `npx ng test --watch=false` e ler a falha). Esperado: FAIL, funções não exportadas.

- [ ] **Step 3: Implementar** (no fim de `geo-municipio.service.ts`):

```ts
/** Ray casting num anel [lng, lat]. Ponto exatamente na aresta pode cair para qualquer lado — irrelevante para marcador. */
function dentroDoAnel(ponto: [number, number], anel: number[][]): boolean {
  const [x, y] = ponto; let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const [xi, yi] = anel[i]; const [xj, yj] = anel[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function dentroDoPoligono(ponto: [number, number], aneis: number[][][]): boolean {
  if (!aneis.length || !dentroDoAnel(ponto, aneis[0])) return false;
  return !aneis.slice(1).some(buraco => dentroDoAnel(ponto, buraco));
}

export function pontoNoPoligono(ponto: [number, number], geometria: { type: string; coordinates: unknown }): boolean {
  if (geometria.type === 'Polygon') return dentroDoPoligono(ponto, geometria.coordinates as number[][][]);
  if (geometria.type === 'MultiPolygon') return (geometria.coordinates as number[][][][]).some(p => dentroDoPoligono(ponto, p));
  return false;
}

export function municipioDaCoordenada(ponto: [number, number], municipios: Municipio[]): Municipio | null {
  return municipios.find(m => pontoNoPoligono(ponto, m.feature.geometry as { type: string; coordinates: unknown })) ?? null;
}

/**
 * Coordenada e código IBGE apontando municípios diferentes. A coordenada é o que posiciona o
 * marcador e prevalece; isto só existe para tornar a divergência visível a quem corrige o cadastro.
 */
export interface DivergenciaIbge { codigoCadastro: string; nomeCadastro: string | null; codigoCoordenada: string; nomeCoordenada: string; }

export function divergenciaIbge(unidade: { codigoIbge: string | null; latitude: number | null; longitude: number | null }, municipios: Municipio[]): DivergenciaIbge | null {
  const codigo = normalizeCodigoIbge(unidade.codigoIbge);
  if (!codigo || unidade.latitude == null || unidade.longitude == null) return null;
  const daCoordenada = municipioDaCoordenada([unidade.longitude, unidade.latitude], municipios);
  if (!daCoordenada || daCoordenada.codigoIbge === codigo) return null;
  const doCadastro = municipios.find(m => m.codigoIbge === codigo);
  return { codigoCadastro: codigo, nomeCadastro: doCadastro?.nome ?? null, codigoCoordenada: daCoordenada.codigoIbge, nomeCoordenada: daCoordenada.nome };
}
```
Conferir o tipo real de `Municipio.feature.geometry` no arquivo e ajustar os casts (sem `any`).

- [ ] **Step 4: Rodar e ver passar** — mesmo comando; esperado PASS. Rodar também com as coordenadas reais do GeoJSON: acrescentar um teste que carrega `src/assets/maps/se-municipalities.geo.json` via `fs` (Vitest roda em Node) e afirma que `[-37.4256, -10.6853]` cai em `2802908` e que `divergenciaIbge` da ITA-09 real devolve Itabaiana/Itabaianinha. Se o carregamento por `fs` não for possível no runner, registrar e manter só o sintético.

- [ ] **Step 5: Commit** (docs: acrescentar em `Docs/validacao-producao/mapa-marcador-e-ibge.md` seção "Regra: coordenada prevalece" com as funções e casos cobertos; se o arquivo ainda não existir porque a Task 1 corre em paralelo, criar só esta seção — a Task 1 acrescenta a dela)
```bash
git add infra-monitor-frontend/src/app/core/services/geo-municipio.service.ts infra-monitor-frontend/src/app/core/services/geo-municipio.spec.ts Docs/validacao-producao/mapa-marcador-e-ibge.md
git commit -m "feat(mapa): municipio da coordenada e divergencia de codigo IBGE como funcoes puras"
```

---

### Task 3: Correção do clique + aviso no painel do mapa + e2e + reversão

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.ts` (handler `:667-671`, painel)
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.html` (painel da unidade, bloco `@if (unidadeSelecionada(); as unidade)` em `:26`)
- Modify: `infra-monitor-frontend/src/app/features/mapa/mapa.component.spec.ts`
- Create: `infra-monitor-frontend/e2e/mapa-marcador-ibge-divergente.cjs`
- Modify: `Docs/validacao-producao/mapa-marcador-e-ibge.md`, `Docs/validacao-producao/dividas-fechamento-branches.md` (§7 → "Corrigido em <hash>, ver mapa-marcador-e-ibge.md")

**Interfaces:**
- Consumes: Task 1 (mecanismo confirmado), Task 2 (`divergenciaIbge`, `DivergenciaIbge`).
- Produces: `export function cliqueVeioDeMarcador(alvo: EventTarget | null): boolean` em `mapa.component.ts`.

- [ ] **Step 1: Teste puro que falha** (em `mapa.component.spec.ts`; jsdom tem `document`):

```ts
import { cliqueVeioDeMarcador } from './mapa.component';
describe('cliqueVeioDeMarcador', () => {
  it('botão de unidade, filho dele e alvo de município contam como marcador', () => {
    const unidade = document.createElement('button'); unidade.className = 'map__unidade';
    const dica = document.createElement('span'); unidade.appendChild(dica);
    const municipio = document.createElement('button'); municipio.className = 'map__alvo';
    expect(cliqueVeioDeMarcador(unidade)).toBe(true);
    expect(cliqueVeioDeMarcador(dica)).toBe(true);
    expect(cliqueVeioDeMarcador(municipio)).toBe(true);
  });
  it('canvas e null não são marcador', () => {
    expect(cliqueVeioDeMarcador(document.createElement('canvas'))).toBe(false);
    expect(cliqueVeioDeMarcador(null)).toBe(false);
  });
});
```
Rodar: FAIL (não exportado).

- [ ] **Step 2: Implementar a correção** — mecanismo padrão (ajustar se a Task 1 provou que `originalEvent.target` não é o botão; nesse caso usar o que a evidência sustentar, p.ex. `stopPropagation` nos eventos que o MapLibre escuta, e registrar o porquê):

```ts
/**
 * O marcador vive dentro do container do MapLibre: o mesmo clique físico chega ao botão E ao
 * `click` de camada, que consulta o polígono sob o pixel — o município da COORDENADA. Com código
 * IBGE divergente (ou município de várias unidades) esse segundo caminho trocava o município e
 * limpava a unidade recém-escolhida. O clique no marcador é sobre a unidade; o polígono não opina.
 */
export function cliqueVeioDeMarcador(alvo: EventTarget | null): boolean {
  return alvo instanceof Element && alvo.closest('.map__unidade, .map__alvo') !== null;
}
```
e no handler:
```ts
map.on('click', 'municipios-fill', evento => {
  if (cliqueVeioDeMarcador(evento.originalEvent.target)) return;
  const codigo = normalizeCodigoIbge(evento.features?.[0]?.properties?.['id'] as string);
  const municipio = municipios.find(candidato => candidato.codigoIbge === codigo);
  if (municipio) this.selectMunicipio(municipio);
});
```

- [ ] **Step 3: Aviso no painel** — em `mapa.component.ts` guardar a fonte de municípios já carregada (`this.sourceMunicipios`) e expor:
```ts
/** Coordenada × código IBGE da unidade em foco. A coordenada prevalece; isto só torna a divergência visível. */
protected readonly divergencia = computed(() => {
  const unidade = this.unidadeSelecionada();
  return unidade && this.fonteMunicipios() ? divergenciaIbge(unidade, this.fonteMunicipios()!) : null;
});
```
(`fonteMunicipios` = `signal<Municipio[] | null>(null)` preenchido onde hoje `sourceMunicipios` é atribuído; manter `sourceMunicipios` se outros pontos usam, ou substituir consistentemente.) No HTML, dentro do painel da unidade, logo após o cabeçalho:
```html
@if (divergencia(); as d) {
  <p class="aviso-ibge" role="note"><strong>Localização divergente.</strong> A coordenada cai em {{ d.nomeCoordenada }}, mas o código IBGE aponta {{ d.nomeCadastro ?? 'um município fora do mapa' }} ({{ d.codigoCadastro }}). O mapa posiciona pela coordenada.</p>
}
```
Estilo: reutilizar tokens existentes (`--im-warning` se existir em `src/styles`, senão `--im-text-secondary` + borda `--im-border`); regra `.aviso-ibge` no `mapa.component.scss` com 3-4 declarações, sem cor hex nova. Conferir contraste nos dois temas por screenshot no e2e.

- [ ] **Step 4: `npx ng test --watch=false`** — todos verdes (anotar contagem).

- [ ] **Step 5: E2E de comportamento** `e2e/mapa-marcador-ibge-divergente.cjs` (mesmas três regras; evidência em `e2e/mapa-marcador-evidence/correcao/`; JSON de resultados `{caso,nome,ok,detalhe}` e `process.exitCode = 1` se qualquer `ok=false`). Casos:
  1. Clicar marcador ITA-09 → painel mostra "Sesc Itabaiana", marcador `aria-pressed="true"`, aviso contém "Itabaiana" e "2803005".
  2. Clicar marcador de uma unidade de Aracaju (município com várias) → painel mostra essa unidade, `aria-pressed="true"`.
  3. Clicar numa área de município sem marcador (clicar no canvas num ponto do polígono longe dos marcadores; ou Tab até `.map__alvo` + Enter) → seleção de município continua funcionando.
  4. Teclado: focar marcador ITA-09 e Enter → mesmo resultado do caso 1.
  5. Unidade com IBGE coerente (qualquer outra) → sem `.aviso-ibge`.
  Rodar: `MAPA_SENHA=... node e2e/mapa-marcador-ibge-divergente.cjs` → todos `ok`.

- [ ] **Step 6: Prova de reversão** — comentar a linha `if (cliqueVeioDeMarcador(...)) return;`, esperar o `ng serve` recompilar, rodar o e2e: casos 1 (e 2 se a Task 1 confirmou Aracaju) têm de FALHAR; salvar a saída em `e2e/mapa-marcador-evidence/reversao/`. Restaurar a linha, rodar de novo: verde. Remover `cliqueVeioDeMarcador` do corpo da função (fazê-la retornar `false`) e rodar o spec: o teste puro FALHA; restaurar. Registrar as quatro saídas no doc. `git diff` final do `mapa.component.ts` tem de conter a correção.

- [ ] **Step 7: Docs + commit** — `mapa-marcador-e-ibge.md`: seções "Correção", "Aviso: por que não silêncio" (carga real com IBGE errado ficaria invisível; aviso não bloqueia e diz qual dado prevalece), "Testes" (contagens), "Reversão" (saídas). `dividas-fechamento-branches.md` §7: marcar corrigido.
```bash
git add infra-monitor-frontend/src/app/features/mapa/mapa.component.ts infra-monitor-frontend/src/app/features/mapa/mapa.component.html infra-monitor-frontend/src/app/features/mapa/mapa.component.scss infra-monitor-frontend/src/app/features/mapa/mapa.component.spec.ts infra-monitor-frontend/e2e/mapa-marcador-ibge-divergente.cjs infra-monitor-frontend/e2e/mapa-marcador-evidence Docs/validacao-producao/mapa-marcador-e-ibge.md Docs/validacao-producao/dividas-fechamento-branches.md
git commit -m "fix(mapa): clique no marcador sempre abre a unidade; aviso de IBGE divergente"
```

---

### Task 4: Aviso de IBGE divergente no detalhe da unidade

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/unidades/detalhe/visao-geral.component.ts` / `.html` / `.scss`
- Test: spec existente do detalhe (`abas.spec.ts` ou `unidade-detalhe.component.spec.ts` — usar o que já monta a Visão geral)
- Modify: `Docs/validacao-producao/mapa-marcador-e-ibge.md`

**Interfaces:**
- Consumes: `divergenciaIbge`, `GeoMunicipioService.getMunicipios(): Observable<Municipio[]>` (cacheado), `UnidadeDetalheStore.cadastro: Signal<UnidadeResponse | null>` (tem `codigoIbge`, `latitude`, `longitude`).

- [ ] **Step 1: Teste que falha** — no spec que monta `VisaoGeralComponent`, prover `GeoMunicipioService` falso com `getMunicipios: () => of([itabaiana, itabaianinha])` (mesmas geometrias sintéticas da Task 2) e store com `cadastro` ITA-09 → esperar texto "A coordenada cai em Itabaiana"; com `getMunicipios: () => throwError(() => new Error('x'))` → sem aviso e sem erro na tela; com IBGE coerente → sem aviso.

- [ ] **Step 2: Implementar** — no componente:
```ts
private readonly geo = inject(GeoMunicipioService);
/** Falha ao carregar a cartografia só apaga o aviso; nunca derruba a visão geral. */
private readonly municipios = toSignal(this.geo.getMunicipios().pipe(catchError(() => of(null))), { initialValue: null });
protected readonly divergencia = computed(() => {
  const cadastro = this.store.cadastro(); const municipios = this.municipios();
  return cadastro && municipios ? divergenciaIbge(cadastro, municipios) : null;
});
```
HTML: mesmo `<p class="aviso-ibge" role="note">…</p>` da Task 3, no topo da Visão geral. SCSS: mesma regra (duplicação de 3-4 linhas aceitável; não criar primitiva global — ver memória do `.skeleton`).

- [ ] **Step 3: `npx ng test --watch=false`** verde. E2E: acrescentar ao roteiro da Task 3 o caso 6 "detalhe da ITA-09 mostra aviso", navegando por clique (lista de unidades → ITA-09) — se a Task 3 já tiver commitado, este caso entra neste commit.

- [ ] **Step 4: Commit**
```bash
git add infra-monitor-frontend/src/app/features/unidades/detalhe/visao-geral.component.ts infra-monitor-frontend/src/app/features/unidades/detalhe/visao-geral.component.html infra-monitor-frontend/src/app/features/unidades/detalhe/visao-geral.component.scss <spec tocado> infra-monitor-frontend/e2e/mapa-marcador-ibge-divergente.cjs Docs/validacao-producao/mapa-marcador-e-ibge.md
git commit -m "feat(unidades): aviso de IBGE divergente da coordenada na visao geral"
```

---

### Task 5: A1 — CAS no fechamento manual de incidente

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/repository/IncidenteRepository.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/service/IncidenteService.java:150-162`
- Create: `infra-monitor-backend/src/test/java/br/com/inframonitor/incidente/FechamentoManualConcorrenciaPostgresIntegrationTest.java`
- Modify: testes unitários de `IncidenteService` que mockam `saveAndFlush` no `fechar` (achar com `grep -rn "fechar(" src/test`)
- Modify: `Docs/validacao-producao/auditoria-concorrencia-ciclo-de-vida.md` (linha A1 → corrigido), Create: `Docs/validacao-producao/a1-a2-cas-fechamento.md` (seção A1)

**Interfaces:**
- Produces: `int fecharManualmenteSeEmAberto(Long id, Instant encerradoEm, String observacao, Usuario usuario, Instant agora)`.

- [ ] **Step 1: Teste de integração que falha** — copiar cabeçalho/fixtures de `ManutencaoPostgresIntegrationTest` (anotações, container, `limparBanco`, `montarEquipamento`, `montarMonitor`, `insert`, `causaRaiz`). Cinco testes:

  a) `@Test fecharManualComInstanciaVelhaNaoSobrescreveFechamentoAutomatico` — determinístico: thread única, `TransactionTemplate` externo: `incidenteRepository.findById(id)` (carrega na sessão), depois — em outra thread, com `join` — `incidenteService.fecharAutomaticamente(carregado2, T0+300s, 2)` commita; então, ainda dentro da transação externa, `incidenteService.fechar(id, new CloseIncidenteRequest(T0+600s, "manual"), operadorId)` (participa da transação externa e enxerga a instância velha em cache). Esperado com CAS: motivo `RECUPERACAO_AUTOMATICA`, `fechado_por` NULL, exatamente 1 `INCIDENTE_FECHADO`. Sem CAS: motivo `FECHAMENTO_MANUAL` (ilegítimo).
  b) `@Test fecharManualComInstanciaVelhaNaoSobrescreveManutencao` — idem com `equipamentoService.entrarEmManutencao` no lugar do motor e `INCIDENTE_ABERTO` ENVIADA: esperado MANUTENCAO, 1 `INCIDENTE_ENCERRADO_MANUTENCAO`, 0 `INCIDENTE_FECHADO`.
  c) `@Test fecharManualComInstanciaVelhaNaoApagaReconhecimento` — idem com `reconhecer`: esperado `reconhecido_por = operador`.
  d) `@RepeatedTest(30) fecharManualEFecharAutomaticamenteConcorrentes` — barreira, jitter aleatório 0..N ms no motor (calibrar N como em `ManutencaoPostgresIntegrationTest` para que os dois desfechos apareçam), `System.out.println("[corrida-manual-motor] desfecho=" + (manual ? "MAN" : motor ? "AUTO" : "ILEGITIMO") ...)`. Legítimos: MAN = `FECHAMENTO_MANUAL` + `fechado_por = operador`; AUTO = `RECUPERACAO_AUTOMATICA` + `fechado_por` NULL + observação começando por "Recuperacao detectada"; ambos com exatamente 1 `INCIDENTE_FECHADO`.
  e) `@RepeatedTest(30) doisFechamentosManuaisConcorrentes` — dois operadores (inserir segundo usuário), legítimo: `fechado_por` ∈ {op1, op2}, observação do mesmo vencedor (cada thread manda observação com o próprio nome), 1 `INCIDENTE_FECHADO`.
  f) `@RepeatedTest(30) fecharManualEEntrarEmManutencaoConcorrentes` — legítimos: MANUTENCAO só com `INCIDENTE_ENCERRADO_MANUTENCAO`; FECHAMENTO_MANUAL só com `INCIDENTE_FECHADO`; nunca as duas.

  Rodar `./mvnw -q test -Dtest=FechamentoManualConcorrenciaPostgresIntegrationTest` — esperado: (a)(b)(c) FALHAM contra o código atual (prova de que o teste discrimina). Salvar a saída.

- [ ] **Step 2: Implementar o CAS** — `IncidenteRepository`:
```java
/**
 * Fechamento humano como CAS, irmao de fecharAutomaticamenteSeEmAberto: so colunas de
 * fechamento, entao reconhecido_* sobrevive, e 0 linhas quando motor, manutencao ou outro
 * operador ja fechou entre a leitura e aqui.
 */
@Modifying(clearAutomatically = true, flushAutomatically = true)
@Query("update Incidente i set i.status = br.com.inframonitor.incidente.entity.StatusIncidente.FECHADO, "
        + "i.encerradoEm = :encerradoEm, i.observacao = :observacao, "
        + "i.motivoEncerramento = br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente.FECHAMENTO_MANUAL, "
        + "i.fechadoPor = :usuario, i.updatedAt = :agora "
        + "where i.id = :id and i.status in (br.com.inframonitor.incidente.entity.StatusIncidente.ABERTO, "
        + "br.com.inframonitor.incidente.entity.StatusIncidente.RECONHECIDO)")
int fecharManualmenteSeEmAberto(@Param("id") Long id, @Param("encerradoEm") Instant encerradoEm,
        @Param("observacao") String observacao, @Param("usuario") Usuario usuario, @Param("agora") Instant agora);
```
`IncidenteService.fechar`:
```java
@Transactional
public IncidenteResponse fechar(Long id, CloseIncidenteRequest requisicao, Long usuarioId) {
    Incidente incidente = obterIncidente(id);
    if (incidente.getStatus() == StatusIncidente.FECHADO) {
        return paraResposta(incidente);
    }
    if (requisicao.encerradoEm().isBefore(incidente.getIniciadoEm())) {
        throw new IllegalArgumentException("encerradoEm deve ser maior ou igual a iniciadoEm");
    }
    // CAS: a leitura acima pode estar velha (motor, manutencao ou outro operador fecharam
    // depois dela). Quem perde devolve o estado atual, sem segunda notificacao.
    if (incidenteRepository.fecharManualmenteSeEmAberto(id, requisicao.encerradoEm(),
            normalizar(requisicao.observacao()), autor(usuarioId), Instant.now()) == 0) {
        return paraResposta(obterIncidente(id));
    }
    Incidente fechado = obterIncidente(id);
    notificacaoService.criarParaIncidenteFechado(fechado);
    return paraResposta(fechado);
}
```
Conferir tipos reais de `autor(...)` e se `Incidente.fechar(...)` fica sem uso (se ficar, não remover se outro caminho usa; se nenhum usa, remover). Ajustar testes unitários com mock que verificavam `saveAndFlush`.

- [ ] **Step 3: Rodar a classe nova** — todos verdes; copiar as linhas `[corrida-...] desfecho=` e contar a distribuição (`grep -o "desfecho=[A-Z-]*" | sort | uniq -c`). Se algum `@RepeatedTest` só mostrar um desfecho legítimo em 30, recalibrar o jitter e documentar.

- [ ] **Step 4: Prova de reversão** — `git stash push -- <IncidenteService.java>` (só o service), rodar a classe: (a)(b)(c) falham e ≥1 repetição ILEGITIMO nos repetidos (registrar quantas); `git stash pop`; rodar de novo: verde. Registrar saídas resumidas no doc.

- [ ] **Step 5: `./mvnw test` completo** — anotar `Tests run/Failures/Errors/Skipped`.

- [ ] **Step 6: Docs + commit** — `a1-a2-cas-fechamento.md` seção A1 (correção, testes, distribuição, reversão); auditoria: linha A1 com "corrigido nesta rodada" e referência.
```bash
git add infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/repository/IncidenteRepository.java infra-monitor-backend/src/main/java/br/com/inframonitor/incidente/service/IncidenteService.java infra-monitor-backend/src/test/java/br/com/inframonitor/incidente/FechamentoManualConcorrenciaPostgresIntegrationTest.java <testes unitarios ajustados> Docs/validacao-producao/a1-a2-cas-fechamento.md Docs/validacao-producao/auditoria-concorrencia-ciclo-de-vida.md
git commit -m "fix(incidente): fechamento manual como CAS contra motor, manutencao e reconhecer"
```

---

### Task 6: A2 + A2b — CAS na normalização do episódio e filtro na releitura da manutenção

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/latency/MonitorEpisodioLatenciaRepository.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/latency/LatencyEpisodeProcessor.java` (`processarNormalizacao`)
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/equipamento/service/EquipamentoService.java` (releitura de episódios, hoje `:177-178`)
- Modify: `LatencyEpisodeProcessorTest` (mocks de `saveAndFlush`)
- Create: `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/latency/EpisodioLatenciaConcorrenciaPostgresIntegrationTest.java`
- Modify: `Docs/validacao-producao/a1-a2-cas-fechamento.md` (seção A2/A2b), `auditoria-concorrencia-ciclo-de-vida.md` (A2, A2b corrigidos; A3, A4, A5 com "documentado, sem correção nesta rodada — decisão de escopo 2026-09-24")

**Interfaces:**
- Consumes: nada da Task 5 (independente em código), mas roda depois dela (Maven único).
- Produces: `int encerrarPorNormalizacaoSeAberto(Long id, Instant encerradoEm, Instant agora)`.

- [ ] **Step 1: Teste de integração que falha** — cabeçalho/fixtures como na Task 5, mais `@Autowired LatencyEpisodeProcessor processor; MedicaoRepository medicaoRepository;` e `@MockitoSpyBean MonitorEpisodioLatenciaRepository`/`MedicaoRepository` só se o gancho determinístico precisar (ver abaixo). Setup comum: equipamento+monitor; episódio aberto (`insert into monitor_episodio_latencia (monitor_id, iniciado_em, limiar_ms) ... returning id`), notificação `LATENCIA_ALTA` ENVIADA do episódio (conferir colunas: `episodio_id`), janela aberta; duas medições SUCESSO com latência abaixo do limiar configurado (ler `monitoring.latencia-limiar-ms` ou equivalente no `application.yml`; ciclos = 2) com `executado_em` crescente; `Medicao ultima = medicaoRepository.findById(idDaUltima)`.

  a) Determinístico A2 (motor com leitura velha, manutenção commita no meio): gancho no processor entre a leitura do episódio e a escrita — `@MockitoSpyBean MedicaoRepository` com `doAnswer` em `findByMonitorIdOrderByExecutadoEmDescIdDesc` que, **só na thread "motor"**, chama o método real, sinaliza `leu.countDown()` e espera `manutencaoCommitou.await(10s)`. Thread "motor": `processor.process(ultima)`. Main: espera `leu`, roda `equipamentoService.entrarEmManutencao` (commita), `manutencaoCommitou.countDown()`, `join`. Esperado com CAS: motivo `MANUTENCAO`, `encerrado_em` = o da manutenção, 1 `LATENCIA_ENCERRADA_MANUTENCAO`, 0 `LATENCIA_NORMALIZADA`. (Com a entidade velha e lock no equipamento, o motor pode bloquear/deadlock — `lock_timeout` de 2s do motor; se o gancho produzir espera em lock em vez de intercalação, registrar e mover o gancho.)
  b) Determinístico A2b (manutenção com leitura velha, motor normaliza no meio): spy em `MonitorEpisodioLatenciaRepository.abertosDoEquipamento` que, só na thread "manutencao", chama o real, sinaliza e espera o motor commitar. Esperado com filtro: motivo `NORMALIZACAO`, 0 `LATENCIA_ENCERRADA_MANUTENCAO`. Sem filtro: 1 `LATENCIA_ENCERRADA_MANUTENCAO` (ilegítimo).
  c) `@RepeatedTest(30) normalizacaoEEntrarEmManutencaoConcorrentes` — barreira + jitter, legítimos: M = MANUTENCAO + só `LATENCIA_ENCERRADA_MANUTENCAO` (1) + 0 `LATENCIA_NORMALIZADA`; N = NORMALIZACAO + `LATENCIA_NORMALIZADA` conforme a regra de `criarParaLatenciaNormalizada` (ler e afirmar exatamente) + 0 `LATENCIA_ENCERRADA_MANUTENCAO`. `System.out.println("[corrida-latencia-manutencao] desfecho=...")`.

  Rodar a classe: (a) e (b) FALHAM no código atual.

- [ ] **Step 2: Implementar**
Repositório:
```java
/**
 * Normalizacao como CAS: 0 linhas quando a manutencao (ou outro ciclo) encerrou o episodio
 * entre a leitura do processor e aqui. So colunas de encerramento.
 */
@Modifying(clearAutomatically = true, flushAutomatically = true)
@Query("update MonitorEpisodioLatencia e set e.encerradoEm = :encerradoEm, "
        + "e.motivoEncerramento = br.com.inframonitor.monitoring.latency.MotivoEncerramentoEpisodio.NORMALIZACAO, "
        + "e.updatedAt = :agora where e.id = :id and e.encerradoEm is null")
int encerrarPorNormalizacaoSeAberto(@Param("id") Long id, @Param("encerradoEm") Instant encerradoEm,
        @Param("agora") Instant agora);
```
Processor:
```java
if (episodioRepository.encerrarPorNormalizacaoSeAberto(episodio.getId(), atual.getExecutadoEm(), Instant.now()) == 0) {
    log.debug("Latency episode {} already closed before normalization for monitor {}", episodio.getId(), monitorId);
    return;
}
// Bulk update nao repropaga para a instancia carregada: releitura antes de notificar.
MonitorEpisodioLatencia normalizado = episodioRepository.findById(episodio.getId()).orElseThrow();
notificacaoService.criarParaLatenciaNormalizada(normalizado);
log.info("Latency episode {} normalized for monitor {}", episodio.getId(), monitorId);
```
(Se a releitura precisar do grafo largo usado pela mensagem, usar o mesmo método de releitura que `EquipamentoService` usa para episódios — ver javadoc em `MonitorEpisodioLatenciaRepository.java:60`.)
EquipamentoService:
```java
//    Mesmo filtro dos incidentes: um episodio lido no passo 3 pode ter sido normalizado
//    pelo motor (CAS) antes do bulk update, que entao o pula.
episodioRepository.findAllById(episodiosAfetadosIds).stream()
        .filter(episodio -> episodio.getMotivoEncerramento() == MotivoEncerramentoEpisodio.MANUTENCAO)
        .forEach(episodio -> notificacaoService.tratarEncerramentoPorManutencao(episodio, agora));
```
(`findAllById` pode ser o método de releitura de grafo largo existente — manter o que já está lá.)

- [ ] **Step 3: Rodar a classe nova** — verde; distribuição de desfechos das 30.
- [ ] **Step 4: Reversão** — separadamente: `git stash push -- LatencyEpisodeProcessor.java` → (a) falha, (c) mostra ILEGITIMO ou registrar honestamente que não mostrou; pop. `git stash push -- EquipamentoService.java` → (b) falha; pop. Verde de novo.
- [ ] **Step 5: `./mvnw test` completo** — contagens.
- [ ] **Step 6: Docs + commit**
```bash
git add <repo> <processor> <EquipamentoService> <LatencyEpisodeProcessorTest> infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/latency/EpisodioLatenciaConcorrenciaPostgresIntegrationTest.java Docs/validacao-producao/a1-a2-cas-fechamento.md Docs/validacao-producao/auditoria-concorrencia-ciclo-de-vida.md
git commit -m "fix(latencia): normalizacao do episodio como CAS e releitura da manutencao filtrada"
```

---

### Task 7: Script de carga real (não executado)

**Files:**
- Create: `tools/carga-real/carga.mjs`, `tools/carga-real/lib/*.mjs` (csv, validacao, geo, grafo, api), `tools/carga-real/test/*.test.mjs`
- Create: `tools/carga-real/modelo/{tipos,unidades,equipamentos,monitores,conexoes}.csv`, `tools/carga-real/modelo/modelo.json`, `tools/carga-real/README.md`
- Create: `Docs/validacao-producao/carga-real-procedimento.md`

**Interfaces:**
- Consumes (API real — conferir cada rota e payload em `infra-monitor-backend/src/main/java/.../*/controller/*.java` e `dto/*`): login `POST /api/v1/auth/login` (conferir rota e forma do token; conferir se `troca_senha_obrigatoria` bloqueia), `GET/POST /api/v1/tipos-equipamento`, `GET/POST /api/v1/unidades`, `PUT /api/v1/unidades/{id}/conexao` `{conectaAUnidadeId}`, `GET/POST /api/v1/equipamentos` (`CreateEquipamentoRequest`: unidadeId, tipoEquipamentoId, nome, ip, hostname, descricao, localizacao, numeroSerie, fabricante, modelo), `GET/POST /api/v1/monitores` (`CreateMonitorRequest`: equipamentoId, tipo, nome, intervaloSegundos 10..86400, timeoutMs 100..60000, falhasParaIncidente 1..100, sucessosParaRecovery 1..100). Paginação dos GET: ler o formato `Page` e percorrer todas as páginas. `CreateUnidadeRequest`: nome, sigla (≤30), descricao, codigoIbge (7 dígitos), endereco, cidade, uf, latitude, longitude.
- GeoJSON: `infra-monitor-frontend/src/assets/maps/se-municipalities.geo.json` (caminho configurável `--geojson`).

- [ ] **Step 1: Testes (`node --test tools/carga-real/test`) que falham** para: parser CSV (aspas, vírgula dentro de aspas, BOM, linhas vazias); validação por linha (obrigatórios, par de coordenadas, IBGE 7 dígitos e existente, IBGE × coordenada → aviso, IPv4 válido/`999.1.1.1` inválido/IPv6 recusado, IP repetido na mesma unidade → erro, entre unidades → aviso, nome de equipamento repetido na unidade (case-insensitive) → erro, referência a tipo/unidade/equipamento inexistente → erro); ciclo de hub (A→B→A, A→B→C→A, auto-referência, grafo combinando conexões do arquivo com as existentes na API); plano de idempotência (dado estado "API" em memória: igual → pula, diferente → divergente, ausente → cria). Nenhum teste usa rede: a camada `api` recebe um `fetch` injetado.

- [ ] **Step 2: Implementar** — `carga.mjs --entrada <arquivo.json|diretorio> [--aplicar] [--relatorio saida.json] [--geojson caminho]`. Padrão é simulação (`dry-run`): lê a API (GET) e valida, não escreve. Sem `--aplicar` **nenhum** POST/PUT. Env: `CARGA_API_URL` (ex. `https://host/api/v1`), `CARGA_EMAIL`, `CARGA_SENHA`; ausente → erro claro e saída 2. Fases em ordem tipo → unidade → equipamento → monitor → conexão; linha com erro de validação não é enviada e seus dependentes são marcados "pulado: dependência falhou". Chaves naturais: tipo = nome (case-insensitive); unidade = sigla (case-insensitive); equipamento = (sigla da unidade, nome case-insensitive); monitor = (equipamento, nome case-insensitive); conexão = sigla origem → sigla hub. Existente: comparar campos do arquivo com os da API; igual → `pulado`; diferente → `divergente` (lista de campos), **não** sobrescreve. Relatório: `{ iniciadoEm, modo, api, resumo: {criados, pulados, divergentes, falhas, avisos}, itens: [{ fase, chave, acao, motivo, http?: {status, corpo} }] }`, e resumo no console. Erro HTTP 409/400 vira `falha` com o corpo `ErroResposta`; 401 no meio → aborta com relatório parcial gravado.

- [ ] **Step 3: Modelo e README** — CSVs com cabeçalho + 1 linha fictícia (sigla `EX-01`, IP `192.0.2.10` da faixa de documentação), `modelo.json` equivalente; README com tabela por arquivo: coluna, obrigatória?, formato, exemplo; seção "O que o script verifica antes de enviar" e "O que NÃO valida" (IP responde? coordenada é a real? IBGE certo quando coerente; unicidade global de IP; regras futuras do backend; concorrência com outro operador; dados já existentes não são corrigidos — divergência só é relatada); "Credencial": env vars, papel mínimo **OPERADOR** (confirmado em `SecurityConfiguration.java:14-17`: POST/PUT/PATCH de unidades, tipos, equipamentos, monitores são `ADMIN` ou `OPERADOR`; confirmar que `PUT /unidades/{id}/conexao` cai na regra de PUT de `/api/v1/unidades/**`), usuário sem troca de senha pendente; nunca em arquivo.

- [ ] **Step 4: `node --test tools/carga-real/test`** verde (contagem). Rodar `node tools/carga-real/carga.mjs --entrada tools/carga-real/modelo` **sem** env → confirma mensagem de erro e saída 2 (não toca rede).

- [ ] **Step 5: Docs + commit** — `carga-real-procedimento.md`: passo a passo operacional (preparar arquivo, rodar simulação, ler relatório, rodar com `--aplicar`, rodar de novo e ver tudo "pulado" = idempotência), verificações, não-verificações, credencial.
```bash
git add tools/carga-real Docs/validacao-producao/carga-real-procedimento.md
git commit -m "feat(carga): script idempotente de carga real pela API, com modelo e validacoes"
```

---

### Task 8: Publicação (controlador)

- [ ] **Step 1:** `cd infra-monitor-backend && ./mvnw test` → anotar contagem. `cd infra-monitor-frontend && npx ng test --watch=false` → contagem. `npx ng build` (produção) → tamanhos e warnings. `node --test tools/carga-real/test` → contagem. E2E final `mapa-marcador-ibge-divergente.cjs` contra o build atual → todos ok.
- [ ] **Step 2:** contagens do banco de dev (mesma query do baseline) → idênticas ao baseline (exceto nada). Se divergir, PARAR sem push.
- [ ] **Step 3:** atualizar `Docs/validacao-producao/validacao-producao.md` (índice: links para os três docs novos) e `topologia-git-e-estrategia-de-merge.md` §8 "Publicação" com as contagens; commit.
- [ ] **Step 4:** `git status` limpo no worktree (evidências e2e commitadas ou fora do repositório); `git push origin main`; `git fetch origin`; `git rev-parse main origin/main` iguais.
- [ ] **Step 5:** encerrar backend e ng serve; `git worktree remove ../infra-monitor-merge` (sem `--force`; se recusar por mudanças, parar e reportar); `git worktree list`; na árvore principal `git rev-parse main origin/main` iguais.
- [ ] **Step 6:** contagens do banco de dev de novo; relatório final.

O registro do push/remoção do worktree não cabe em commit (aconteceria depois do push) — vai no relatório final ao usuário e, se desejado, em commit futuro.

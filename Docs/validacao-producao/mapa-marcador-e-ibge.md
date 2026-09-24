# Mapa: marcador e divergência de código IBGE

## Regra: coordenada prevalece

A coordenada (`latitude`/`longitude`) é o que posiciona o marcador no mapa e é considerada a fonte de
verdade geográfica. O `codigoIbge` cadastrado na unidade é só um campo de cadastro que pode divergir —
por exemplo, uma unidade cadastrada com o IBGE de um município mas cuja coordenada real cai dentro do
território de outro. Essas funções tornam essa divergência visível a quem for corrigir o cadastro, sem
decidir automaticamente qual está certo.

Implementado em `infra-monitor-frontend/src/app/core/services/geo-municipio.service.ts` como funções
puras (sem estado, sem HTTP):

- `pontoNoPoligono(ponto: [number, number], geometria): boolean` — ray casting sobre `Polygon` e
  `MultiPolygon`; anéis internos (índice > 0) são buracos e não contam como "dentro".
- `municipioDaCoordenada(ponto, municipios): Municipio | null` — primeiro município da lista cujo
  polígono contém o ponto; `null` se a coordenada não cair em nenhum.
- `interface DivergenciaIbge { codigoCadastro; nomeCadastro: string | null; codigoCoordenada;
  nomeCoordenada }`.
- `divergenciaIbge(unidade, municipios): DivergenciaIbge | null` — compara o `codigoIbge` (normalizado)
  da unidade com o município encontrado pela coordenada. Devolve `null` quando:
  - falta `codigoIbge` ou falta `latitude`/`longitude` (checagem `!= null`; `0` é coordenada válida);
  - a coordenada não cai em nenhum município da cartografia;
  - os dois códigos batem (cadastro coerente com a coordenada).
  Quando o `codigoIbge` cadastrado não existe na cartografia carregada, `nomeCadastro` vem `null` (o
  código ainda aparece em `codigoCadastro`).

### Caso real coberto (ITA-09)

Unidade com `codigo_ibge = 2803005` (Itabaianinha) e coordenada `latitude -10.6853, longitude -37.4256`,
que na cartografia de Sergipe (`public/assets/maps/se-municipalities.geo.json`) cai dentro do polígono
de **Itabaiana** (`2802908`). `divergenciaIbge` devolve
`{ codigoCadastro: '2803005', nomeCadastro: 'Itabaianinha', codigoCoordenada: '2802908', nomeCoordenada: 'Itabaiana' }`.

### Testes

`infra-monitor-frontend/src/app/core/services/geo-municipio.service.spec.ts` (TDD, RED confirmado antes
da implementação — funções não exportadas — depois GREEN):

- `pontoNoPoligono`: dentro/fora de `Polygon`, buraco não conta como dentro, `MultiPolygon` com match em
  qualquer parte.
- `municipioDaCoordenada`: acha o município certo; fora de tudo devolve `null`.
- `divergenciaIbge`: caso ITA-09 sintético, caso coerente (`null`), IBGE ausente ou coordenada ausente
  (`null`), coordenada fora da cartografia (`null`), IBGE fora da cartografia (`nomeCadastro: null`),
  normalização de espaços no `codigoIbge`.

Um teste com o GeoJSON real via `fs` não foi possível: o builder `@angular/build:unit-test` empacota o
spec para bundle de browser (esbuild) mesmo executando sobre Vitest, e `fs`/`path`/`__dirname` do Node
não resolvem nesse bundle (`TS2307: Cannot find module 'fs'`). O caso real do ITA-09 acima está coberto
com dados sintéticos equivalentes (mesmas coordenadas e mesmo par de municípios divergentes), não com o
arquivo real.

## Investigação do clique no marcador (Task 1, sem correção)

Dívida reportada em `3a316db`: clicar no marcador de uma unidade abre o painel dela por um instante
e em seguida a seleção some. Esta seção registra a investigação (Task 1, sem correção) e é a
base para a escolha do mecanismo da correção (Task 3).

Data: 2026-09-24. Branch `main` (worktree `infra-monitor-merge`). MapLibre GL **6.9.0**
(`infra-monitor-frontend/node_modules/maplibre-gl/package.json`). Banco de dev só em leitura,
backend em 8080 com motor/dispatcher desligados, `ng serve` do worktree em `127.0.0.1:4300`.

Roteiro: `infra-monitor-frontend/e2e/mapa-marcador-investigacao.cjs`
(`MAPA_SENHA=<senha> node e2e/mapa-marcador-investigacao.cjs`).
Evidência: `infra-monitor-frontend/e2e/mapa-marcador-evidence/investigacao/` (`investigacao.json` +
uma captura por caso).

### Conclusão em uma linha

O clique no `<button class="map__unidade">` é **o mesmo evento DOM `click`** que, ao borbulhar até o
`.maplibregl-canvas-container`, vira o `click` do mapa; o handler `map.on('click','municipios-fill')`
recebe `evento.originalEvent.target === <button class="map__unidade ...">`, roda **depois** do
handler do botão e chama `selectMunicipio` do polígono que está sob o pixel — que desfaz a unidade
recém-escolhida. Acontece **também em Aracaju** (IBGE coerente), não só quando IBGE e coordenada
divergem.

### Mecanismo, pelo código

Componente (`infra-monitor-frontend/src/app/features/mapa/mapa.component.ts`):

| Linha | O quê |
|---|---|
| 526-532 | `selectMunicipio`: com 1 unidade chama `selectUnidade`; com 0 ou 2+ chama `limparUnidade` |
| 534 | `selectUnidade` |
| 581 | `limparUnidade`: `unidadeSelecionada.set(null)` (e fecha a gaveta) |
| 667-671 | `map.on('click', 'municipios-fill', ...)` → `selectMunicipio(municipio sob o ponto)` |
| 721 | `alvo.addEventListener('click', () => this.selecionarPeloMarcador(unidade))` no `<button>` |
| 723 | `new Marker({ element: alvo, ... }).addTo(map)` |
| 804-809 | `selecionarPeloMarcador`: `selectMunicipio(municipio do IBGE)` e depois `selectUnidade(unidade)` |

MapLibre (`node_modules/maplibre-gl/dist/maplibre-gl-dev.mjs`, 6.9.0):

| Linha | O quê |
|---|---|
| 26967 | `this._canvasContainer = DOM.create("div", "maplibregl-canvas-container", container)` |
| 27929 | `Marker.addTo`: `map.getCanvasContainer().appendChild(this._element)` — o elemento do Marker é **filho** do canvas container |
| 27906-27908 | o Marker faz `preventDefault()` no `mousedown` do próprio elemento, mas **não** `stopPropagation` em nada de mouse/click |
| 22405 / 22414-22507 | `HandlerManager`: `this._el = map.getCanvasContainer()`; registra `mousedown`, `mouseup`, `click`, `dblclick`... **nesse elemento**, em fase de **bolha** (opções `void 0`; só o `mousemove` do `document` é `capture`) |
| 20478-20481 | `MapEventHandler.click(e, point)`: `this._map.fire(new MapMouseEvent(e.type, this._map, e))` — o `click` do mapa **é derivado do `click` DOM** e carrega o evento DOM como `originalEvent` (só é suprimido se o mouse andou ≥ `clickTolerance` desde o `mousedown`) |
| 25428-25436 | `_createDelegatedListener` (o `map.on(tipo, camada, fn)`): `queryRenderedFeatures(e.point, { layers })` e chama o listener se houver feature — **não olha o alvo DOM** |
| 27813-27817 | `Marker._onMapClick` usa `e.originalEvent.target === this._element` para decidir o popup: a própria lib conta com o `click` do mapa disparando quando o clique é no marcador |

Consequência: não há nada no MapLibre que separe "clique no marcador" de "clique no polígono". O
ponto do clique (`DOM.mousePos(canvas, e)`) é o centro do marcador, e o polígono renderizado sob
esse pixel é consultado normalmente.

### Sequência observada (ITA-09, trecho de `investigacao.json`)

Instrumentação **só na página de teste** (nenhuma edição em código de produção, nem temporária): a
instância do componente veio de `window.ng.getComponent(app-mapa)` (ng serve em modo dev) e dela o
`map` (campo privado, acessível em runtime). Nela o roteiro embrulhou `selecionarPeloMarcador`,
`selectMunicipio`, `selectUnidade` e `limparUnidade`, e registrou um `map.on('click','municipios-fill')`
extra (depois do do componente). Listeners DOM de captura/bolha no `document`, no canvas container
e em cada `<button>`. Os eventos `pointerdown`…`mouseup` (seq 1-16) têm todos o botão como alvo;
o `mousedown` chega ao `document` com `defaultPrevented: true` (o `preventDefault` do Marker).

```json
{"seq":17,"camada":"DOM","onde":"document","fase":"captura","tipo":"click","alvo":"button.map__unidade.map__unidade--pulsa.maplibregl-marker.maplibregl-marker-anchor-center"}
{"seq":18,"camada":"DOM","onde":"canvas-container","fase":"captura","tipo":"click","alvo":"button.map__unidade..."}
{"seq":19,"camada":"componente","metodo":"selecionarPeloMarcador","arg":"unidade 5 Sesc Itabaiana"}
{"seq":20,"camada":"componente","metodo":"selectMunicipio","arg":"municipio 2803005 Itabaianinha (1 unidade(s))"}
{"seq":21,"camada":"componente","metodo":"selectUnidade","arg":"unidade 5 Sesc Itabaiana"}
{"seq":22,"camada":"componente","metodo":"selectUnidade","arg":"unidade 5 Sesc Itabaiana"}
{"seq":23,"camada":"DOM","onde":"button.map__unidade#5","fase":"alvo","tipo":"click","unidadeSelecionadaNesteInstante":5}
{"seq":24,"camada":"componente","metodo":"selectMunicipio","arg":"municipio 2802908 Itabaiana (0 unidade(s))"}
{"seq":25,"camada":"componente","metodo":"limparUnidade","arg":null}
{"seq":26,"camada":"maplibre","handler":"map.on('click') sem camada","alvoOriginal":"button.map__unidade...","ponto":[395,387]}
{"seq":27,"camada":"maplibre","handler":"map.on('click','municipios-fill') (instrumentação, depois do do componente)","tipoDoEventoDom":"click","alvoOriginal":"button.map__unidade.map__unidade--pulsa.maplibregl-marker.maplibregl-marker-anchor-center","alvoEhMarcadorDeUnidade":true,"feature":"2802908 Itabaiana","ponto":[395,387],"unidadeSelecionadaNesteInstante":null}
{"seq":28,"camada":"DOM","onde":"canvas-container","fase":"bolha","tipo":"click","alvo":"button.map__unidade..."}
{"seq":29,"camada":"DOM","onde":"document","fase":"bolha","tipo":"click","defaultPrevented":false}
```

Ordem real dos dois handlers, num único `click` DOM:

1. **Fase alvo** — listener do `<button>` (linha 721): `selecionarPeloMarcador` → unidade 5
   selecionada (seq 19-23; `unidadeSelecionadaNesteInstante: 5`).
2. **Fase bolha no canvas container** — `HandlerManager` → `MapEventHandler.click` → `map.fire('click')`
   → listener delegado de `municipios-fill` (linha 667) → `selectMunicipio(Itabaiana, 0 unidades)`
   → `limparUnidade` (seq 24-25). Logo depois a seleção é `null` (seq 27).

O `originalEvent.target` visto pelo handler de camada é o próprio
`button.map__unidade.map__unidade--pulsa.maplibregl-marker.maplibregl-marker-anchor-center`
(`alvoEhMarcadorDeUnidade: true`) — ou seja, a informação para distinguir o clique no marcador
**está disponível** dentro do handler de camada.

Observação lateral: em município de uma unidade só, `selecionarPeloMarcador` chama `selectUnidade`
duas vezes (seq 21 via `selectMunicipio`, seq 22 direto) — duas consultas de equipamentos para a
mesma unidade. Inofensivo (a segunda descarta a primeira), mas é trabalho repetido.

### Resultado por unidade

| Caso | IBGE cadastrado | Polígono sob a coordenada | `selecionarPeloMarcador` escolheu | Handler de camada chamou | Estado final |
|---|---|---|---|---|---|
| ITA-09 Sesc Itabaiana (id 5) | 2803005 Itabaianinha | 2802908 Itabaiana | Itabaianinha + unidade 5 | `selectMunicipio(Itabaiana, 0)` → `limparUnidade` | painel "Itabaiana — Nenhuma unidade cadastrada", `aria-pressed="false"` |
| Aracaju Sede Administrativa (id 1) | 2800308 Aracaju | 2800308 Aracaju | Aracaju + unidade 1 | `selectMunicipio(Aracaju, 4)` → `limparUnidade` | painel "Aracaju — 4 unidades… Escolha uma", `aria-pressed="false"` |
| Aracaju Escola Sesc (id 2) | idem | idem | Aracaju + unidade 2 | idem | idem |
| Aracaju Centro Integrado de Saúde (id 7) | idem | idem | Aracaju + unidade 7 | idem | idem |
| Aracaju Hotel Sesc Atalaia (id 3) | idem | idem | Aracaju + unidade 3 | idem | idem |

**Aracaju também perde a seleção**, com IBGE coerente: o polígono sob o marcador é o mesmo
município, mas como ele tem 4 unidades `selectMunicipio` chama `limparUnidade`. O defeito não é
causado pela divergência de IBGE — ela só muda *qual* município aparece no painel. O único cenário
em que o clique "funciona" hoje é o de município com exatamente uma unidade cuja coordenada cai
dentro do polígono do próprio IBGE (o handler de camada reescolhe a mesma unidade). E um clique
em marcador cuja coordenada cai fora de todo polígono (mar) não passaria pelo handler de camada.

Sobreposição no enquadramento inicial (zoom 8,29): no centro do marcador 7 (Centro Integrado de
Saúde) o `elementFromPoint` devolve o marcador 2 (Escola Sesc Aracaju) — o clique real nele cai no
vizinho. Para os casos de Aracaju o roteiro aproximou a câmera (`jumpTo` zoom 12 em Aracaju) antes
de clicar. É um problema à parte (densidade de marcadores), registrado para não ser confundido com
este.

### O que prevalece quando coordenada e IBGE divergem

**A coordenada.** Ela é o que posiciona o marcador; o usuário clica no marcador para falar da
*unidade*, não do polígono embaixo dele. O IBGE pode vir errado ou ausente na carga real (ITA-09 já
chega com o município vizinho), então não pode ser ele a decidir o que o clique no marcador
seleciona. O clique no marcador tem de terminar com aquela unidade selecionada,
independentemente do polígono sob o pixel e do IBGE cadastrado.

### Insumo para a Task 3

- O handler de camada tem, em `evento.originalEvent.target`, o `<button class="map__unidade">`
  (ou um descendente dele, se o clique cair na dica) — `closest('.map__unidade')` identifica o caso.
- O listener do botão roda **antes** do handler de camada, no mesmo evento DOM; `stopPropagation`
  no listener do botão impediria o `click` de chegar ao `HandlerManager` (que escuta em bolha no
  container), com o efeito colateral de o `Marker._onMapClick` e qualquer outro `map.on('click')`
  também não verem esse clique.
- A correção precisa cobrir o caso de IBGE **coerente** com várias unidades (Aracaju), não só o de
  IBGE divergente.

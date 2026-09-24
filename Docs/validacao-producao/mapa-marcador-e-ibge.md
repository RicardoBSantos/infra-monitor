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

## Aviso no detalhe da unidade

Task 4: a mesma divergência (`divergenciaIbge`, de `geo-municipio.service.ts`, Task 2) agora também
aparece na aba **Visão geral** do detalhe da unidade
(`infra-monitor-frontend/src/app/features/unidades/detalhe/visao-geral.component.ts/.html/.scss`),
no topo, acima dos três cartões — mesmo texto e mesma classe `.aviso-ibge` do painel do mapa (Task 3),
para as duas telas lerem igual:

```html
<p class="aviso-ibge" role="note"><strong>Localização divergente.</strong> A coordenada cai em {{ d.nomeCoordenada }}, mas o código IBGE aponta {{ d.nomeCadastro ?? 'um município fora do mapa' }} ({{ d.codigoCadastro }}). O mapa posiciona pela coordenada.</p>
```

`divergencia` é um `computed` sobre `UnidadeDetalheStore.cadastro` e um `toSignal` de
`GeoMunicipioService.getMunicipios()` com `catchError(() => of(null))`: falha ao carregar a
cartografia apenas apaga o aviso (`municipios` fica `null`, o `computed` devolve `null`), nunca
derruba a Visão geral. Sem primitiva nova: a regra CSS de `.aviso-ibge` é duplicada localmente no
`visao-geral.component.scss` (3 linhas), usando só tokens existentes (`--im-warning`,
`--im-surface-raised`, `--im-radius-lg`, `--im-text-secondary`) — mesma decisão do `.skeleton`
duplicado em 6 telas (ver memória do projeto): não é primitiva global.

### Prova por reversão

Editando `divergencia` para sempre devolver `null` (em vez de `divergenciaIbge(cadastro, municipios)`):

- `npx ng test --watch=false --include ".../abas.spec.ts"` — o teste
  "mostra o aviso de IBGE divergente quando a coordenada cai em outro município (ITA-09)" falha:
  `AssertionError: expected null not to be null` (o `querySelector('.aviso-ibge')` não encontra nada).
- `node e2e/unidade-detalhe-aviso-ibge.cjs` — falha com `exitCode 1`:
  `locator.waitFor: Timeout 10000ms exceeded` esperando `.aviso-ibge` visível na ITA-09.

Restaurando a chamada a `divergenciaIbge(cadastro, municipios)` (confirmado com `git diff` — nenhum
resíduo do trecho temporário), o mesmo teste unitário volta a passar (suíte completa: 47 arquivos,
387 testes verdes) e o e2e volta a passar (ITA-09 mostra o aviso citando "Itabaiana" e "2803005";
a unidade 1 de Aracaju, com IBGE coerente, não mostra `.aviso-ibge`).

### Testes

- Spec: `infra-monitor-frontend/src/app/features/unidades/detalhe/abas.spec.ts` — três casos novos na
  descrição "Visão geral": ITA-09 com aviso (Itabaiana/2803005), IBGE coerente sem aviso, e falha no
  `getMunicipios()` (erro) sem aviso e sem derrubar a tela (incidentes recentes continuam renderizando).
  Usa as mesmas geometrias sintéticas de `geo-municipio.service.spec.ts` (Itabaiana/Itabaianinha) via
  um `GeoMunicipioService` falso injetado por teste.
- E2E: `infra-monitor-frontend/e2e/unidade-detalhe-aviso-ibge.cjs` (arquivo próprio, não anexado ao
  roteiro da Task 3) — login por clique, depois lista de unidades → link "Ver" da linha → Visão geral,
  para a unidade 5 (ITA-09, espera aviso) e a unidade 1 (Aracaju, IBGE coerente, espera ausência de
  aviso). Evidência em `infra-monitor-frontend/e2e/unidade-detalhe-evidence/` (duas screenshots e um
  JSON com os dois casos). Base `MAPA_BASE` (padrão `http://127.0.0.1:4300`), senha via `MAPA_SENHA`.

## Correção (Task 3)

Mecanismo escolhido: o sustentado pela investigação — `evento.originalEvent.target` no handler de
camada é o `<button>` do marcador. Em
`infra-monitor-frontend/src/app/features/mapa/mapa.component.ts`:

- `export function cliqueVeioDeMarcador(alvo: EventTarget | null): boolean` —
  `alvo instanceof Element && alvo.closest('.map__unidade, .map__alvo') !== null`. Cobre o botão, um
  descendente dele (a dica) e também o alvo invisível de município (`.map__alvo`), cujo clique já
  seleciona o município pelo próprio listener e não precisa que o polígono sob o centróide opine.
- `map.on('click', 'municipios-fill', ...)` começa com
  `if (cliqueVeioDeMarcador(evento.originalEvent.target)) return;`. Clique no canvas (área do
  polígono sem marcador) continua selecionando o município.
- `stopPropagation` no botão foi descartado: tiraria o clique também do `Marker._onMapClick` e de
  qualquer outro `map.on('click')` futuro. A guarda no handler de camada só tira o polígono da decisão.

Aviso no painel: `divergencia = computed(...)` sobre `unidadeSelecionada()` e a cartografia carregada
(o antigo campo `sourceMunicipios` virou o sinal `fonteMunicipios`, porque o `computed` precisa
reagir a ele). No painel da unidade, logo abaixo do nome e do status, `<p class="aviso-ibge"
role="note">` com o mesmo texto do detalhe da unidade (Task 4). Estilo: régua lateral de 3px em
`--im-warning` (a mesma linguagem do `.map-feedback`), texto `--im-text-secondary` 11px — só tokens,
nenhum hex novo. Legível nos dois temas: `e2e/mapa-marcador-evidence/correcao/01-painel-aviso-escuro.png`
e `01-painel-aviso-claro.png`.

Observação: ao clicar no ITA-09, o município marcado (`aria-pressed`) é o do **código IBGE**
(2803005 Itabaianinha), porque `selecionarPeloMarcador` escolhe o município pelo cadastro. O painel
de município não aparece (1 unidade) e o aviso diz exatamente essa divergência. Não mudado nesta rodada.

## Aviso: por que não silêncio

A coordenada prevalece — é ela que posiciona o marcador e é sobre a unidade que o clique fala. Mas
calar a divergência esconderia um cadastro errado: na carga real, uma unidade com IBGE trocado
apareceria no lugar certo do mapa e contada no município errado da lista/relatório, sem nenhum sinal.
O aviso não bloqueia nada, não corrige nada sozinho e diz qual dado o mapa usou ("O mapa posiciona
pela coordenada"), para que quem mantém o cadastro decida qual dos dois está errado.

## Testes (Task 3)

- `mapa.component.spec.ts`: `cliqueVeioDeMarcador` (botão, filho e `.map__alvo` → `true`; canvas e
  `null` → `false`). RED antes da implementação (`TS2305: ... no exported member`), GREEN depois.
- `npx ng test --watch=false`: **47 arquivos, 387 testes, todos verdes** (inclui o que havia no
  disco da Task 4 no mesmo momento).
- E2E `infra-monitor-frontend/e2e/mapa-marcador-ibge-divergente.cjs`
  (`MAPA_SENHA=<senha> node e2e/mapa-marcador-ibge-divergente.cjs`), evidência em
  `e2e/mapa-marcador-evidence/correcao/` (`resultados.json` + capturas). **5/5 ok**:
  1. clique no marcador ITA-09 → painel "Sesc Itabaiana", `aria-pressed="true"`, aviso com
     "Itabaiana" e "2803005";
  2. clique no marcador 7 de Aracaju (câmera em zoom 12, ver sobreposição acima) → painel dessa
     unidade, `aria-pressed="true"`;
  3. clique no canvas dentro de município sem unidade, num pixel sem nenhum elemento DOM por cima
     (Amparo de São Francisco) → município selecionado, nenhuma unidade;
  4. foco no marcador ITA-09 + Enter → igual ao caso 1;
  5. unidade 1 de Aracaju (IBGE coerente) → painel dela, sem `.aviso-ibge`.

## Reversão (Task 3)

Por edição do arquivo (sem `git stash`), `ng serve` recompilando a cada passo. Saídas em
`infra-monitor-frontend/e2e/mapa-marcador-evidence/reversao/`:

| Passo | Saída | Resultado |
|---|---|---|
| Guarda comentada no handler de camada | `1-e2e-sem-correcao.txt` (+ `sem-correcao/`) | **2/5** — casos 1, 2 e 5 FALHAM (painel "Itabaiana — Nenhuma unidade cadastrada" / "Aracaju — 4 unidades", `aria-pressed="false"`); 3 e 4 passam |
| Guarda restaurada | `2-e2e-restaurada.txt` (+ `restaurada/`) | **5/5**, exit 0 |
| `cliqueVeioDeMarcador` devolvendo `false` | `3-spec-sem-funcao.txt` | spec do mapa: 1 falha (`expected false to be true`), 21 passam |
| Função restaurada | `4-spec-restaurado.txt` | 47 arquivos, 387 testes verdes |

O caso de teclado (4) passa mesmo sem a correção: o `click` sintetizado pelo Enter não reproduziu a
troca de seleção. O defeito era só do clique de ponteiro; o caso 4 fica como guarda de regressão do
caminho por teclado, não como prova da correção — quem prova são 1, 2 e 5.

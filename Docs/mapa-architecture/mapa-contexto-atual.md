# Mapa — contexto atual

Estado da rodada em curso. Atualizado como parte do commit que muda o Mapa, nunca depois.

Última atualização: 2026-10-19, branch `feat/mapa-legenda-sobre-mapa` (§15).

> **§16 (D22) substitui a câmera de §5, §8 e §13** por encaixe calculado: `OFFSET_CAMERA`,
> `ZOOM_AO_INCLINAR` e `ASPECTO_*` não existem mais.
>
> **§15 (D21) revê legenda, largura do painel e folga de §13.** Legenda sobre o mapa, painel em
> `clamp(340px, 30vw, 420px)`, padding e gap de 12px.

> **§13 (D20) revê layout, câmera e interação.** Os números de câmera de §5 e §8, a legenda de §8
> e o fluxo "município seleciona e lista unidades" das seções anteriores ficam como registro.

> **§5 (layout e câmera) e §7 (suítes) foram revistos na rodada N07 — ver §8.** Os números de
> câmera e de legenda das seções anteriores valem para a versão com extrusão e ficam como registro
> do que foi medido na época, não como estado atual.
>
> **As linhas de marcador, pulso e seleção em §10.2 e §11 foram revistas na rodada D19 — ver §12.**
> Aro claro, pulso seletivo e anel lilás valeram para as rodadas D16/D17 e ficam como registro do que
> foi implementado na época, não como estado atual.

---

## 1. Dados de demonstração — agora persistentes

**Antes:** o banco de dev tinha 11 unidades com nome, sigla, cidade e código IBGE, inseridas à mão
(linhas 3 a 11 com `created_at` idêntico ao microssegundo). `endereco` estava **nulo nas 11** — a
suposição de que já havia endereço realista não se confirmou. Nenhum script, seed Flyway ou
`data.sql`. Nenhuma coordenada. Nenhuma topologia.

**Agora:**

| O quê | Mecanismo | Arquivo |
|---|---|---|
| `latitude`, `longitude`, `endereco` | SQL aplicado à mão, versionado | `infra-monitor-backend/db/dev-seed/01-unidades-coordenadas.sql` |
| `conecta_a_unidade_id` | `PUT /unidades/{id}/conexao` | `infra-monitor-frontend/e2e/seed-topologia-unidades.cjs` |

A divisão é deliberada — ver D09 em [mapa-decisoes.md](mapa-decisoes.md). O `README.md` da pasta
`db/dev-seed/` registra o porquê de cada escolha e os comandos.

Coordenadas: centro do município, com ponto distinto por unidade nas quatro de Aracaju (Centro,
Siqueira Campos, São José, Atalaia) para que os marcadores não colidam no mesmo pixel. Casamento por
`sigla`, não por `id`. Ambos os scripts são idempotentes — verificado: a segunda execução do seed de
topologia reporta `escritas: 0 | já corretas: 10`.

Topologia: estrela, `Sede Administrativa` (id 1) na raiz, as outras 10 conectadas a ela.

---

## 2. M04 com dado real — o que a verificação revelou

A verificação pedida partia de duas premissas que não se sustentaram, e as duas viraram trabalho:

**"Os marcadores aparecem nas posições certas, não mais no centróide do município."**
Não havia marcador de unidade. Os únicos `Marker` eram os alvos **invisíveis** de teclado, um por
município, no centróide do polígono (N02). O mapa não usava `latitude`/`longitude` para nada.
Preencher as coordenadas, sozinho, não mudaria um pixel. Daí o item novo aprovado — ver §3.

**"O painel 'Unidades sem localização' deve mostrar 0."**
Esse painel nunca dependeu de coordenada: `agruparUnidades` classifica por **código IBGE ausente**, e
as 11 unidades já tinham código. O painel já mostrava 0 antes do seed e continua mostrando 0. O
extremo oposto que faltava testar não existia — os dois extremos eram o mesmo.

---

## 3. Marcador de unidade — item novo

Primeiro uso real da coordenada no mapa. `Marker` nativo do MapLibre com `<button>` real, mesma
técnica provada em N02 para os alvos de município.

Verificado em `e2e/n06-marcadores-e-conexoes.cjs`:

| Verificação | Resultado |
|---|---|
| Um marcador por unidade com coordenada | 11/11 |
| Marcadores não colapsam no mesmo pixel | 11 posições distintas |
| As 4 unidades de Aracaju aparecem separadas | espalhamento 30 px |
| Rótulo com nome + status por extenso + contagem | `Centro Integrado de Saúde: Disponível, 16 equipamento(s)` |
| Alcançável por Tab | sim |
| Enter abre o painel da unidade | sim, painel bate com o rótulo |
| Espaço ativa o mesmo marcador | sim |
| Exatamente um `aria-pressed` por vez | sim |
| **Nenhum nó recriado em pan/zoom/pitch** | **11 nós antes, 11 depois** |
| Marcadores acompanham a câmera | posições mudaram sem troca de nó |
| Seleção sobrevive ao pan/zoom | sim |

A prova de preservação de nó é a mesma de N05 para município (75/75), aplicada aos marcadores de
unidade: a identidade do elemento é registrada num `WeakMap` antes do gesto e conferida depois. Nó
preservado é o que autoriza dizer que a lib reposiciona, em vez de o componente redesenhar.

---

## 4. N06 — linhas de conexão

Camada `line` sobre GeoJSON gerado de `conexoesDesenhaveis()`, função pura com 4 testes unitários.

- Só desenha o par em que **ambas** as pontas têm coordenada.
- Cor `#4a6c8c`, largura `1.4`, opacidade `0.65`. Fora da escala de status de propósito.
- Camada depois da extrusão na ordem do estilo — antes dela o bloco de Aracaju cobria o feixe
  inteiro que sai dele.

Dependência resolvida no backend: `conectaAUnidadeId` entrou no read-model do dashboard
(`DashboardUnidadeResponse`, `UnidadeCounts`, a query nativa e o `group by`). Aditivo, anulável, no
**fim** do record — a projeção nativa é lida por posição em `Object[]`, e inserir no meio trocaria
colunas em silêncio. `longOrNull` em vez de `longValue` porque a raiz tem pai nulo e `longValue`
devolveria `0`, que seria lido como id de unidade.

---

## 5. Layout

**Rolagem da página (4a).** Duas causas, não uma:

1. `.map` tinha `aspect-ratio: 760/680`, herança do SVG antigo — ~1074 px de altura numa coluna de
   ~1200 px. Substituído por altura presa à viewport.
2. Descoberta ao medir: **o painel lateral também estourava**. Com unidade selecionada ele passa dos
   1200 px e, como as duas colunas dividem a mesma linha da grade, era ele quem esticava a página —
   o cartão já cabia. Preso à mesma altura do cartão, com rolagem própria.

Resultado medido: excedente de rolagem `0 px` na área principal do shell **e** no documento.

**Recalibração de câmera.** A altura nova invalidava a calibração de N05, então os dois valores foram
refeitos contra ela — não herdados:

| | Antes | Depois |
|---|---|---|
| `OFFSET_CAMERA` | `[0, 40]` | `[0, 82]` |
| `ZOOM_AO_INCLINAR` | `0.55` | `0.75` |
| Folga no topo | 13,9% | **3,6%** |
| Folga na base | 25,1% | **8,2%** |
| Desequilíbrio | 11,1 p.p. | **4,6 p.p.** |
| Sobra total | 39,0% | **11,8%** |

As duas correções convivem: `e2e/n05-mapa-maplibre.cjs` continua **21/21**, incluindo a própria
verificação de faixa morta do N05 (`4 alvos acima de 28% e 8 abaixo de 72% da altura`).

**Legenda (4c).** Quatro status operacionais visíveis; os quatro estados de ausência de dado atrás
de `<details>` nativo; as três notas de leitura atrás de botão de informação com `aria-expanded`.

**Painel (4d).** 270 → **320 px**. Medido em tela: 320 px.

**Texto "em azul" (4b).** Retirado do escopo pelo próprio pedido, após a varredura não encontrar
nenhum texto azul na página. Cabeçalho da página intocado.

---

## 6. Custo de bundle

| | Antes | Depois |
|---|---|---|
| Bundle inicial | 96,94 kB gz | 96,35 kB gz |
| Chunk do Mapa | 244,51 kB gz | 246,09 kB gz |

O aviso de budget de `mapa.component.scss` continua (94,95 kB contra os 6 kB do
`anyComponentStyle`), como previsto em D04 — é a folha do MapLibre dentro do chunk lazy.

---

## 7. Suítes

| Suíte | Resultado |
|---|---|
| Backend (`./mvnw test`) | 241/241 |
| Frontend (`ng test`) | 353/353 |
| `e2e:n04` — conexão entre unidades | 9/9 |
| `e2e:n05` — MapLibre | 21/21 |
| `e2e:n06` — marcadores, conexões e layout | 22/22 |

Revalidadas em N07 — ver §8.

---

## 8. N07 — reversão da extrusão e preenchimento das colunas

Decisões em [D13 e D14](mapa-decisoes.md). O que está no código depois desta rodada:

**Mapa.** Uma camada `fill` por município (cor **constante** `#16283a`, opacidade 0,92), contorno,
linhas de topologia e o anel de seleção como `line` de 3px em `#f2d6ff`, nesta ordem — o anel é a
última camada porque seleção precisa vencer tanto o preenchimento quanto a linha de topologia que
cruze o município. Nenhuma `fill-extrusion`. `METROS_POR_EQUIPAMENTO`, `ESPESSURA_ANEL` e
`OPACIDADE_ANEL` saíram do arquivo com a extrusão; `toneDoMunicipio()` e a propriedade `cor` por
feature saíram com a coloração de status (D15). O GeoJSON não carrega mais nenhuma propriedade
derivada — só o `id`, que serve ao clique e ao filtro do anel.

**Câmera, recalibrada e não herdada.** Medida por diferença de pixel entre o cartão desenhado e o
cartão com o mapa oculto — o canvas não é legível in-page (`preserveDrawingBuffer` desligado), e o
controle de navegação é excluído da varredura para não entrar na caixa do desenho.

| | Extrusão (N05/N06) | Plano (N07) |
|---|---|---|
| Sequência | `fitBounds` plano → `easeTo` com pitch | `fitBounds` **com** pitch → `easeTo` só de zoom |
| `ZOOM_AO_INCLINAR` | `0.75` | `0.68` |
| `OFFSET_CAMERA` | `[0, 82]` | `[-24, 60]` |
| Folga topo / base @1500×950 | — | 10,9% / 9,3% |
| Folga topo / base @1700×907 | — | 10,8% / 10,0% |
| Folga topo / base @1280×800 | — | 10,9% / 12,4% |
| Desequilíbrio (métrica de centróide do e2e) | 4,6 p.p. | **3,2 p.p.** |

O teto do zoom é a **largura**, não a altura: acima de ~0,70 a ponta oeste do estado sai do cartão
com ~20% de altura ainda sobrando. Isso é geometria de Sergipe deitado a `bearing -18`, não folga a
fechar. O `-24` em x existe porque a subida da câmera desloca o estado para a esquerda: sem ele a
ponta oeste ficava a 4px da borda (0,4% contra 5,7% do outro lado); com ele, 2,2% contra 4,1%.

**Colunas.** `.map-page` perde o `max-width: 1500px` (só ele — o valor é literal por página, e o
`.shell__main` não limita nada). Painel com `justify-content: space-between` e disclosure aberto por
padrão: a maior costura vazia cai de **307px para 110px** num painel de 754px.

**Marcador de unidade.** N06 introduziu um halo claro de 1,5px entre o miolo de status e a borda
escura, para corrigir a camuflagem de unidade Degradada sobre município Degradado — o "círculo
branco" relatado na revisão. D16 trocou esse halo pelo aro claro por fora (ver
[D16](mapa-decisoes.md)), e D19 removeu o aro — ver §12: o marcador de hoje não tem halo nem aro, é
um disco chapado.

**Legenda.** Subtítulo "Cor do marcador de unidade" + **6 status numa lista só** + 2 notas de
gramática do mapa (município neutro, linha de hub). Sem botão de informação e **sem disclosure**: os
dois itens que o justificavam eram vocabulário de polígono e morreram com a coloração (D15).

**Cor de status tem um portador só.** `COR_DO_STATUS` (ex-`COR_DO_TOM`) é lida apenas pelo marcador
de unidade, e suas seis chaves correspondem exatamente a `UnitOperationalStatus`. O painel
"STATUS GEOGRÁFICO · SERGIPE" **não foi afetado**: ele sempre agregou unidades
(`contarPorStatus(municipios().flatMap(m => m.units))`), sem passar pela coloração de município.

**Custo de bundle** (build de produção, contra a rodada anterior):

| | N06 | N07 |
|---|---|---|
| Chunk do Mapa | 246,09 kB gz | **245,60 kB gz** |
| `mapa.component.scss` | 94,95 kB | **94,14 kB** |

O aviso de budget continua, como previsto em D04.

**Suítes nesta rodada:** `ng test` **352/352** (−1: o teste de `toneDoMunicipio` saiu com a função;
o que ele protegia de fato — o agrupamento não recalcular status — segue coberto pelo teste de
`agruparUnidades`) · `e2e:n05` **21/21** · `e2e:n06` **23/23** · `e2e:m06` 19/19.

**Pendência de verificação visual de D15:** a escolha de `#16283a` foi feita por raciocínio de
contraste (entre o `none` antigo #0c1722, que sumia no gradiente do cartão, e `sem-equipamentos`
#263744, já dentro da escala de status), **não medida em tela** — `e2e:n05`/`n06` exigem a senha do
admin em `N0X_SENHA`, que não estava disponível na sessão. Build de produção e `ng test` passaram.
Reexecutar os dois roteiros regenera as capturas e confirma o tom.

**Correção de instrumento, achada aqui.** A verificação de faixa morta do `e2e:n06` media a câmera
**depois** do pan/zoom do caso 4: clicar em `/mapa` estando em `/mapa` é no-op do router, o
componente não remonta e a câmera fica como o teste a deixou. Passava por coincidência de valores.
Agora o roteiro sai para `/dashboard` e volta, forçando remontagem, e mede o enquadramento que o
operador vê ao abrir a tela.

---

## 9. N07 — investigação: pulso, ping na linha e tooltip (aguardando OK)

Nada desta seção está implementado. É o resultado da investigação pedida antes de escrever a versão
final dos itens 2, 3 e 4. O item 1 (município neutro) já está no código — ver [D15](mapa-decisoes.md).

### 9.1 Como foi medido

A medição **não** passa pela aplicação — não precisa de login nem de backend. É um banco de prova
isolado que usa a **mesma** `maplibre-gl 6.9.0` do `node_modules`, a mesma cartografia
`se-municipalities.geo.json`, o mesmo estilo de camadas, a mesma câmera (`pitch 45`, `bearing -18`,
`zoom +0,68`, `offset [-24,60]`), as 11 coordenadas de `db/dev-seed/` e a topologia em estrela do
`seed-topologia-unidades` (SED como raiz, 10 raios).

**É suíte permanente, não medição de uma vez.** Vive em `infra-monitor-frontend/e2e/perf-mapa/` e
roda com:

```bash
cd infra-monitor-frontend
npm run perf:mapa          # abre Chromium com GPU real; grava perf-mapa/bench.json
```

**Mexeu em animação do Mapa? Rode e compare com a tabela abaixo — não remeça do zero.** O que
importa é a coluna Δ sobre a base, não o absoluto: o absoluto depende da máquina, e entre duas
execuções na mesma máquina os valores variam ~20%. A ordem entre os cenários é que é estável, e é
ela que sustentou a escolha (D/E/F).

Chromium com GPU real (headless desligado). Os números da tabela abaixo são de
`ANGLE (Intel UHD Graphics 770, D3D11)`, janela de 6s por cenário e 1,2s de assentamento.

**Duas métricas, porque uma sozinha engana.** A cadência de frame (`requestAnimationFrame`) está
presa ao vsync: satura em 16,7 ms e só diz se *caiu* de 60fps. O que distingue "de graça" de "ainda
cabe, mas come o orçamento" é a **CPU de main thread** (`Performance.getMetrics` via CDP).

### 9.2 Números

Nenhum cenário perdeu frame: **59,9 fps, 0% de frames acima de 20 ms, em todos**. A diferença está
no custo.

| Cenário | CPU/frame | Δ sobre a base | % do orçamento de 16,7 ms |
|---|---|---|---|
| A — mapa parado (base) | 0,188 ms | — | 1,1% |
| **B — 11 marcadores pulsando, `::after` com `transform`+`opacity`** | **0,475 ms** | **+0,29** | **2,8%** |
| C — 11 marcadores pulsando, `box-shadow` (idioma do `.sidebar__pulse`) | 0,618 ms | +0,43 | 3,7% |
| **D — 20 pings como `Marker` DOM, `setLngLat` por frame** | **0,991 ms** | **+0,80** | **5,9%** |
| E — 20 pings como camada `circle`, `setData` de GeoJSON por frame | 2,535 ms | +2,35 | 15,1% |
| F — `line-dasharray` animado por `setPaintProperty` a 20 Hz | 1,649 ms | +1,46 | 9,9% |
| **BD — B + D juntos (a proposta inteira)** | **1,296 ms** | **+1,11** | **7,7%** |
| B5 — 55 marcadores pulsando (5×) | 1,125 ms | +0,94 | 6,7% |
| D5 — 100 pings DOM (5×) | 2,362 ms | +2,17 | 14,1% |
| E5 — 100 pings por `setData` (5×) | 2,612 ms | +2,42 | 15,6% |

**O que os números dizem, e que a estimativa não diria:**

- **`setData` por frame custa 2,9× o `Marker` DOM** na carga real (E 2,54 ms × D 0,99 ms), e o custo
  é quase todo `ScriptDuration` (1,36 ms contra 0,33 ms) — é o reparse do GeoJSON no worker a cada
  frame. Curiosidade útil: a 5× a distância some (2,61 × 2,36 ms), porque o `setData` paga um custo
  quase fixo por chamada enquanto o DOM paga por elemento. Com 10 linhas, o DOM ganha com folga.
- **`line-dasharray` é a mais cara das três técnicas de ping** (1,65 ms/frame) mesmo rodando a 20 Hz,
  não a 60. Cada `setPaintProperty` de `line-dasharray` reconstrói a textura de tracejado.
- **A animação de CSS custa ~1 recálculo de estilo por frame (361 em 6s) independentemente da
  quantidade de marcadores** — 11 e 55 marcadores dão o mesmo número de recalcs, e o custo sobe de
  0,137 para 0,377 ms. Escala bem.
- `box-shadow` (C) é 45% mais caro que `::after` com `transform` (B) e não compõe no compositor.

### 9.3 Achado que decide o item 2: o `transform` do marcador é do MapLibre, não nosso

Medido, não deduzido:

```
repouso  inline    = "translate(-50%, -50%) translate(676px, 447px) rotateX(0deg) rotateZ(0deg)"
         computado = matrix(1, 0, 0, 1, 669.5, 440.5)
:hover   computado = matrix(1, 0, 0, 1, 669.5, 440.5)   <- idêntico
```

O MapLibre reescreve `element.style.transform` a cada reposicionamento (`maplibre-gl-dev.mjs:27832`).
Estilo inline vence regra de folha de autor, então **qualquer `transform` que a gente escreva no
elemento do `Marker` é ignorado**.

Consequência imediata: `.map__unidade:hover { transform: scale(1.25) }` e
`.map__unidade[aria-pressed='true'] { transform: scale(1.15) }`, que estão no código desde N06,
**nunca aplicaram** — assim como o `transition: transform .12s ease` da mesma regra. O que se vê
hoje no hover e na seleção é só a mudança de `border-color` e `box-shadow`, que funcionam porque não
são `transform`. Dívida registrada em [DV13](mapa-dividas.md).

Para o pulso isso é decisivo: **a animação tem de viver num pseudo-elemento** (`::after`), não no
elemento do `Marker`. O `::after` tem `transform` próprio e não é tocado pelo inline do pai. E o
elemento já é `position: absolute` (o `.maplibregl-marker` da folha da lib), então `inset` no
`::after` posiciona sem que a gente precise mexer em `position` — mexer quebraria o
posicionamento da lib.

### 9.4 Anel de foco × pulso: convivem, com duas ressalvas

Capturado a 5× de escala, com um marcador focado enquanto todos pulsam:

- O anel de foco (`outline: 2px solid var(--im-primary)`, sólido e opaco) **continua legível** por
  cima do anel de pulso (traço de cor de status que esmaece até zero). São desenhos de natureza
  diferente — um constante, outro transitório — e não se confundem.
- **Ressalva 1 — raio.** Com o pulso começando em `inset: -5px`, há um instante do ciclo em que o
  anel do pulso passa exatamente sobre o raio do `outline` (que tem `outline-offset: 3px`). O pulso
  precisa **nascer fora** do anel de foco, não atravessá-lo.
- **Ressalva 2 — cor.** O anel de pulso na cor do status funciona nos quatro status vivos, mas some
  nos dois escuros: `sem-dados` (#435464) e `sem-equipamentos` (#263744) sobre o município #16283a
  quase não têm contraste. Pulso com cor de status só faz sentido para os estados que alguém
  precisa notar.

Isso leva à pergunta de produto que **não** está respondida e é a primeira do item 2: **11
marcadores pulsando ao mesmo tempo é 11 coisas disputando atenção.** Um indicador "live" pulsa
porque é o único na tela. A proposta técnica abaixo assume que o pulso é *seletivo* — só
`INDISPONIVEL` e `DEGRADADA`, os dois estados que pedem ação —, mas isso muda o pedido e precisa
de OK explícito.

### 9.5 Abordagem proposta por item

**Item 2 — pulso.** `::after` no `.map__unidade`, anel de 2px em cor de status, `@keyframes` de
`transform: scale()` + `opacity`, nascendo fora do anel de foco. `prefers-reduced-motion: reduce`
zera a `animation` e deixa o anel estático (mesmo padrão de `.sidebar__pulse` e das três gavetas).
Custo medido: **+0,29 ms/frame**. Pendente de decisão: pulsar todos ou só os estados que pedem ação.

**Item 3 — cor da linha.** Colorir pela unidade **conectada** é a leitura certa (a linha existe por
causa do filho, não do hub), mas **contradiz D15, que acabou de ser aprovado nesta mesma rodada**, e
contradiz o comentário de `COR_CONEXAO` escrito em N06: *"a linha é topologia, não estado
operacional, e qualquer tom da escala de status seria lido como um"*. Uma linha que cruza meio
estado em vermelho diz "este caminho está indisponível" — e o caminho não é monitorado; o que está
indisponível é a ponta. É exatamente o mesmo erro de leitura que tirou a cor do polígono, num
elemento também grande. **Isto precisa de decisão, não de implementação.** Alternativas que dizem a
mesma coisa sem afirmar o que o dado não sustenta: pintar só o **trecho junto ao marcador filho**
(gradiente para neutro ao longo da linha), ou manter a linha neutra e dar a cor de status ao
**ping** que corre nela.

**Item 3 — animação do ping.** Escolha: **`Marker` DOM, um por ping, `setLngLat` por frame** (D).
Motivos, todos medidos: 2,9× mais barato que `setData` (E) na carga real; 1,7× mais barato que
`line-dasharray` (F), que ainda por cima é *stepped* e não é bidirecional por natureza — "ida e
volta" exigiria duas camadas sobrepostas em fase invertida. O `Marker` DOM dá bidirecionalidade de
graça: as linhas têm **exatamente 2 vértices**, então a posição é um `lerp` simples, sem percorrer
comprimento de arco, e a volta é o mesmo `lerp` com `t` espelhado. E é o padrão que N02 e N06 já
fixaram. Cuidados obrigatórios: os elementos de ping são `<div aria-hidden="true">` sem
`tabindex` (não podem entrar na ordem de Tab, que hoje é município → unidade), e o `rAF` tem de ser
cancelado em `destruirMapa()` junto com o `AbortController`. Sob `prefers-reduced-motion`, os pings
simplesmente não são criados.

**Item 4 — tooltip.** A parte técnica é a mais simples da lista e a de dado é a mais bloqueada.

*Qual API.* Elemento próprio, **não** `Popup` do MapLibre. O `Popup` é posicionado por `LngLat` e
reprojetado a cada frame de câmera — mas o marcador já é um elemento DOM que a lib reposiciona, e
pendurar o tooltip nele como filho o faz acompanhar de graça, sem uma segunda entidade a sincronizar,
sem a folha de estilo do `Popup` para sobrescrever e sem o `close button` que ele traz.

*Acessibilidade e o conflito com Enter/Espaço.* Os dois níveis **convivem sem conflito**, e a razão
é que são eventos diferentes: o tooltip aparece em `:hover` e `:focus-visible` (CSS puro, ou
`mouseenter`/`focusin`), e a seleção continua no `click`, que é o que Enter e Espaço disparam num
`<button>`. Focar não é acionar. O tooltip deve ser `aria-hidden="true"` e o conteúdo ir também para
o `aria-label` do botão, senão o leitor de tela ouve duas vezes.

*Dado — aqui está o bloqueio.* O mapa tem em mãos só `DashboardUnidade`, de uma chamada única a
`GET /dashboard/unidades`. Confrontando com os sete campos da imagem de referência:

| Campo do tooltip | Está em `DashboardUnidade`? |
|---|---|
| Nome | **sim** (`nome`) |
| Status | **sim** (`status`) |
| Incidentes abertos | **sim** (`incidentesAbertos`) |
| Monitores | **não** — existe em `DashboardUnidadeDetalhe.monitores`, que é `GET /dashboard/unidades/{id}` |
| Latência | **não** — só por equipamento, em `DashboardEquipamento.ultimaMedicao.latenciaMs` |
| Disponibilidade | **não** — só em `GET /relatorios/disponibilidade/unidades`, que exige janela de período |
| Última verificação | **não** — só por equipamento, em `ultimaMedicao.executadoEm` |

Ou seja: **três dos sete campos existem; quatro não**, e os quatro que faltam são de granularidade
de equipamento ou de relatório, não de unidade. A imagem de referência é um cartão de **equipamento**,
e o marcador do mapa é de **unidade**. Os três caminhos, em ordem de preferência:

1. **Tooltip com o que existe** (nome, status, equipamentos por status, incidentes abertos) — zero
   requisição nova, entrega hoje, e é informação que o painel lateral já mostra ao clicar.
2. **Ampliar `DashboardUnidade`** no read-model do backend com latência agregada, monitores ativos e
   última verificação. Uma chamada só continua servindo o mapa inteiro. É mudança de backend.
3. **Buscar por unidade no hover** — descartado: 11 requisições em passagem de mouse, com o tooltip
   piscando vazio enquanto a resposta não chega.

Disponibilidade percentual fica fora dos três: ela depende de janela (`JANELA_DIAS`) e vem de
`/relatorios`, não do dashboard — misturá-la aqui reabre a divergência que a lista de Unidades já
teve de acertar.

---

## 10. N07 — estado final da rodada, verificado na aplicação real

Decisões em [D15 e D16](mapa-decisoes.md). A §9 acima é a investigação que precedeu; esta seção é o
que ficou no código e como foi conferido.

### 10.1 Verificação visual do município neutro, em contexto real

A §9 mediu num banco de prova isolado porque a senha de admin não estava disponível. Ela está em
`Docs/Front-End-Docs/F11`, e a rodada foi refeita **contra a aplicação real** — backend em 8080,
`ng serve` em 4200, banco de dev com o seed. Evidência em `e2e/n07-evidence/01-municipio-neutro.png`.

**O contraste do `#16283a` se sustenta**, com uma ressalva que a captura revelou e que não estava na
análise: o preenchimento estava certo, a **divisa** não. Ver D16, quarta correção — contorno
clareado de `#294056` (1,40:1) para `#456a8e` (2,65:1).

Tabela de contraste contra `#16283a`, medida e não estimada:

| | antes | depois |
|---|---|---|
| divisa municipal | 1,40:1 (`#294056`) | **2,65:1** (`#456a8e`) |
| marcador `sem-equipamentos` | 1,22:1 (miolo contra o mapa) | **13,05:1** (aro claro) |
| marcador `sem-dados` | 1,92:1 | **13,05:1** (aro claro) |
| anel de foco, tema escuro | 3,47:1 | 3,47:1 (literal) |
| anel de foco, **tema claro** | **2,43:1** ✗ | **3,47:1** (literal) |
| anel de pulso (só os dois que pulsam) | — | 3,84:1 e 6,96:1 |

### 10.2 O que está no código

| | |
|---|---|
| Polígono | `fill` constante `#16283a`, contorno `#456a8e` |
| Linha de conexão | `#4a6c8c`, 1,4px, opacidade 0,65 — **neutra**, sem status |
| Marcador | 13px, aro claro 2px, miolo = `COR_DO_STATUS`; 17px no hover (largura, nunca `transform`) |
| Pulso | `::after`, `transform`+`opacity`, 1,9s, só `INDISPONIVEL` e `DEGRADADA` |
| Ping | `Marker` DOM `aria-hidden`, 2 por linha em fase oposta, `setLngLat` por quadro, cor do filho |
| Dica | filha do `<button>`, `:hover` + `:focus-visible`, nome / status / incidentes abertos |
| Foco sobre o canvas | `--cor-foco-mapa: #3B6EFF`, literal nos três alvos |
| `prefers-reduced-motion` | pings **não são criados**; anel de pulso vira estático (`opacity .55`) |

**Custo de bundle** (produção, contra a rodada anterior):

| | N06 | N07 (D15) | N07 final (D16) |
|---|---|---|---|
| Chunk do Mapa | 246,09 kB gz | 245,60 kB gz | **246,27 kB gz** |
| `mapa.component.scss` | 94,95 kB | 94,14 kB | **95,48 kB** |

Pulso, ping e dica custaram **+0,67 kB gz** no chunk. O aviso de budget do SCSS continua, como
previsto em D04.

### 10.3 Suítes

`ng test` **356/356** (+4: as funções puras do movimento do ping) · `e2e:n05` **21/21** ·
`e2e:n06` **24/24** · `e2e:m06` **19/19** · `e2e:n07` **37/37** (novo).

**`e2e:n07` é o roteiro que trava os requisitos de aceite desta rodada**, e cada caso existe por um
motivo que captura de tela não cobre:

| Caso | O que trava |
|---|---|
| 1 | legenda fala do marcador; 6 itens, sem disclosure; amostras de polígono removidas |
| 2 | pulso seletivo — e a animação no `::after`, **nunca** no elemento (DV13) |
| 3 | a matriz de `transform` do marcador nunca ganha escala; o hover cresce por largura |
| 4 | dica com os três campos, `aria-hidden`, e o `aria-label` com os mesmos dados |
| 5 | dica no **foco de teclado**; focar não seleciona; `Enter` seleciona |
| 6 | o anel de pulso **nasce fora** do anel de foco; evidência ampliada em 3x |
| 7 | pings fora do Tab, sem nome acessível, sem papel; contagem derivada do dado |
| 8 | ping colorido pelo filho, linha neutra, e todo ping realmente percorre a linha |
| 9 | `prefers-reduced-motion`: zero pings, anel estático e ainda visível |

### 10.4 Cinco falsos negativos que o roteiro produziu antes de fechar

Registrados porque são armadilhas de instrumento, não de código, e a próxima pessoa vai bater nelas:

1. **`:focus-visible` não casa com `el.focus()` por script** depois de um movimento de mouse. A
   primeira execução leu a dica como `hidden` e o contorno como o padrão do UA. O roteiro passou a
   navegar com **Tab de verdade** — que é também a prova de que nenhum ping é focável.
2. **O Angular prefixa o nome do `@keyframes`** com o id de escopo do componente
   (`_ngcontent-ng-cNNN_map-pulsar`), e o id muda a cada build. Casar por sufixo.
3. **`page.accessibility` não existe mais no Playwright.** A prova equivalente é `aria-hidden` +
   ausência de nome/papel + a varredura de Tab.
4. **Números fixos de seed quebram.** O roteiro esperava 20 pings e achou 18: a unidade Lagarto está
   com `conectaAUnidadeId` nulo no banco de dev — é raiz, como a Sede. O esperado passou a ser
   derivado do payload de `/dashboard/unidades`, capturado na própria navegação.
5. **Posição de ping arredondada ao pixel**: duas leituras a 500ms davam 13 de 18 "parados", porque
   ping perto do ponto de retorno, ou em linha curta (as quatro de Aracaju), anda menos de 1px. Vale
   o percurso **acumulado** em três amostras ao longo de meio ciclo.

Duas outras, de produto e não de instrumento:

6. **O aglomerado de Aracaju (DV09) intercepta o ponteiro**: `.first()` caía num marcador coberto e
   o `hover` do Playwright estourava depois de 56 tentativas. O roteiro escolhe o marcador mais
   isolado por distância real. O aglomerado continua sendo DV09.
7. **`Emulation.setDeviceMetricsOverride` por CDP não muda a densidade da captura** — o Playwright
   fixa as métricas do contexto e o `clip` segue em px de CSS. A evidência ampliada exigiu um
   contexto próprio com `deviceScaleFactor: 3`.

---

## 11. D17 — estado final do desenho da conexão e da seleção

Rodada de quatro ajustes sobre N07, verificada na aplicação real. Detalhe e razões em
[D17](mapa-decisoes.md).

### O que mudou no canvas

| Antes (N07) | Agora (D17) |
|---|---|
| Camada `municipio-selecionado`, traço lilás de 3px no contorno | **removida** — seleção só no marcador |
| `.map__alvo[aria-pressed]` com disco lilás no centroide | **removido** — só `:focus-visible` pinta |
| Camada única `conexoes-linha`, cor neutra constante | **seis camadas** `conexoes-linha-<status>`, filtradas por status |
| Linha reta de dois vértices | **arco** de 33 vértices, curvatura 0,14 do comprimento |
| Ping a cada 2600 ms | **4200 ms** |

### Estado das fontes e camadas

```
sources
  municipios  geojson
  conexoes    geojson
layers
  fundo · municipios-fill · municipios-contorno
  conexoes-linha
```

D18 reverteu o gradiente de D17: uma camada só, `line-color` por
`['match', ['get', 'status'], ...]` — a linha inteira assume a cor do status da unidade
conectada, o mesmo padrão de coloração por status usado no resto do sistema.

### Funções puras novas (`mapa.component.ts`, cobertas por unitário)

- `controleDoArco(origem, destino)` — ponto de controle da Bézier, perpendicular à corda, sinal fixo.
- `pontoNoArco(origem, destino, u)` — De Casteljau sobre `interpolar`; **é o que o ping usa**.
- `arcoEntre(origem, destino)` — a mesma curva amostrada como polilinha, para o GeoJSON.

Desenho e animação saem da mesma conta: se divergissem, o ping flutuaria ao lado da linha. Há
unitário para isso (`pontos[8] === pontoNoArco(hub, filha, 8/32)`).

### Renomeações

`aplicarTons` → `marcarMunicipio`: com o anel fora, o método não aplica tom nenhum, só
`aria-pressed`. Sumiram a guarda `isStyleLoaded()` e a repetição no evento `load` do mapa.

### Suítes

`ng test` 361/361 · `e2e:n05` 22/22 · `e2e:n06` 24/24 · `e2e:n07` 37/37.
Ajustes nos roteiros: n05 caso 20 passou a provar a **ausência** do anel (e que o lilás estava no
marcador, até D19 — ver §12); n07 caso 8 lê a amostra da legenda como gradiente e a janela de
amostragem do movimento subiu para 1050 ms, acompanhando o período novo.

---

## 12. D19 — marcador final: sem aro, pulso geral, seleção por status

Decisão em [D19](mapa-decisoes.md). Três mudanças na mesma rodada, e duas delas revertem escolhas de
N07 — ver D19 para o raciocínio completo de cada uma. Esta seção substitui, para marcador, pulso e
seleção, as linhas equivalentes de §10.2 e §11 (que ficam como registro das rodadas D16/D17).

### O que está no código

| | Antes (N07/D16, D17) | Agora (D19) |
|---|---|---|
| Marcador | 13px, aro claro 2px (`rgba(232,240,248,.92)`), miolo = `COR_DO_STATUS`; 17px no hover | **sem aro** — disco chapado, 13px, miolo = `COR_DO_STATUS`; 17px no hover |
| `COR_DO_STATUS['sem-dados']` | `#435464` (1,92:1) | **`#8797a6`** (5,01:1) |
| `COR_DO_STATUS['sem-equipamentos']` | `#263744` (1,22:1) | **`#667b8b`** (3,41:1) |
| Pulso | `::after`, `transform`+`opacity`, só `INDISPONIVEL` e `DEGRADADA` (`STATUS_QUE_PULSA`) | **todos os marcadores** pulsam — `STATUS_QUE_PULSA` removida |
| Seleção (`aria-pressed`) | `box-shadow` 3px `#f2d6ff` (D17), marcador cresce a 13px → 17px | `color-mix(in srgb, var(--cor-unidade) 78%, transparent)`, marcador cresce **13px → 19px** |

Os outros quatro status (`DISPONIVEL`, `DEGRADADA`, `INDISPONIVEL`, `EM_MANUTENCAO`) não mudam de
cor: 6,86:1, 3,84:1, 6,96:1 e 6,67:1 contra `#16283a`, os mesmos números de N07/D16.

`prefers-reduced-motion` não muda: pings continuam não sendo criados, e o anel de pulso continua
estático e **visível**, nunca ausente.

### Geometria dos anéis do marcador selecionado

Do centro para fora — mudar qualquer um dos números exige refazer a conta inteira:

| anel | raio |
|---|---|
| miolo | 9,5px |
| seleção (`box-shadow` 3px) | 9,5 → 12,5px |
| foco (`outline` 2px, offset 3px) | 12,5 → 14,5px |
| pulso nasce (`::after`, `inset: -6px`) | 15,5px |

Seleção e foco continuam **tangentes**, nunca sobrepostos, pelo mesmo motivo de D17: o `outline`
pinta por cima e recortaria o anel de seleção no estado selecionado + focado.

### Verificado

- Contraste dos seis status contra `#16283a`, calculado por script (fórmula WCAG 2.x de luminância
  relativa), não estimado: 6,86 / 3,84 / 6,96 / 6,67 / 5,01 / 3,41 — todos ≥ 3:1.
- `ng test` (suíte completa) e `npx ng build` sem erro. O aviso de budget `anyComponentStyle` do
  SCSS do mapa é pré-existente.
- `e2e/n07-pulso-ping-dica.cjs`: caso 2 lê `borderTopWidth === '0px'` e `width === '13px'` nos onze
  marcadores e exige `map__unidade--pulsa` em todos; caso 9 confere 19px no selecionado, ausência do
  lilás na `box-shadow` computada e coincidência de matiz com `--cor-unidade`, mais captura por
  status. Evidência em `e2e/n07-evidence/d19-anel-*.png` e `d19-tudo-junto.png`.

---

## 13. D20 — tela cheia, clique direto, zoom por município, legenda recolhível

Decisão em [D20](mapa-decisoes.md). Esta seção substitui, para layout, câmera, seleção e legenda,
o que §5, §8 e §10–§12 dizem sobre esses pontos.

### O que está no código

| | Antes (D19) | Agora (D20) |
|---|---|---|
| Cabeçalho | faixa acima do cartão, "Atualizar" à direita | placa `.map-titulo` no canto sup. esquerdo do cartão; "Atualizar" em `.map-panel__topo` |
| Altura | `clamp(460px, 100dvh - 196px, 780px)` | `100dvh - --im-topbar-height`, linha `minmax(0,1fr)`, sem teto |
| Clique no marcador | `selectMunicipio` → lista "Escolha uma" → `selectUnidade` | `selectUnidade` direto |
| Clique no município | seleciona e lista unidades | aproxima (polígono, ou envelope das unidades se 2+ dentro dele) |
| Volta | — | "Ver estado inteiro" (`.map__voltar`) + Escape |
| `.map__alvo` | `aria-pressed` | sem `aria-pressed` (ação, não estado) |
| `OFFSET_CAMERA` / `ZOOM_AO_INCLINAR` | `[-24,60]` (sem efeito em y) / `0.68` | `[0,-28]` / `0.42`, escalados pela proporção do cartão |
| Resize | não reenquadra | reenquadra enquanto a câmera não foi tocada |
| Legenda | 6 itens + 2 notas sempre abertos | `<details>` fechado por padrão; notas de uma linha |
| Rodapé de fontes | `.map-source` | removido |

### Números medidos

- Folga topo/base por pixel: 1920×1080 15,8/14,7 · 1500×950 15,8/15,9 · 1366×768 15,9/18,4 ·
  1280×800 15,9/17,8 · 1280×720 15,8/19,1. Estreito (compensação zero): 390×844 37,3/38,6 ·
  600×900 30,8/31,2 · 768×1024 27,0/27,5.
- Aracaju aproximado: vizinho mais próximo 15,2px pelo polígono → 34,0px com teto 11,5 → **62,1px**
  pelo envelope das unidades com teto 12,5.
- Rolagem vertical da página: 0 em todas as viewports de desktop. Horizontal: 0 dentro do Mapa; o
  documento estoura 16–65px em ≤1280 pela topbar (DV18).

### Suítes

`ng test` 469/469 · `e2e:n05` 21/21 · `e2e:n06` 25/25 · `e2e:n07` 48/48 · `e2e:m06` 19/19 ·
`e2e:n08` 48/48 (novo — `npm run e2e:n08`, senha em `N08_SENHA`).

`e2e:n08` trava os requisitos desta rodada: sem rolagem em 5 viewports; placa sem cobrir marcador
nem controle; marcador abre a unidade sem lista e sem disparar zoom (clique lógico e físico, IBGE
divergente); município aproxima e não fecha o painel; Aracaju 4/4 clicável sem sobreposição e
vizinho ≥40px; volta por botão e por Escape com foco no canvas; município sem unidade; teclado;
reduced-motion; legenda fechada/aberta com notas de uma linha; erro de API sem a placa por cima;
resize reenquadra só sem gesto; nenhum erro de console nem 5xx.

## 14. Fechamento da rodada D20 (2026-10-16)

### `main` com os PRs #7 e #8 juntos

Os dois PRs nunca tinham rodado juntos. No `main` combinado (`e0d0078`), banco de dev:
`ng test` 493/493 · `e2e:n05` 21/21 · `e2e:n06` 25/25 · `e2e:n07` 48/48 · `e2e:n08` 51/51 ·
`e2e:m06` 19/19. (O §13 diz `e2e:n08` 48/48; o número final do PR #8 foi 51/51.)

### Banco da carga (5436), com as unidades reais

Sede Administrativa (Aracaju) e Sesc Itabaiana (hub: Sede), 3 equipamentos. Backend do `main` contra
o banco da carga, motor, Telegram e dispatcher desligados. Login por `E2E_EMAIL`, variável nova nos
cinco roteiros (default continua `admin@inframonitor.local`).

| Roteiro | Resultado | Leitura |
|---|---|---|
| `e2e:n05` | 21/21 | — |
| `e2e:n08` | 50/50, 1 não aplicável | sem unidade de IBGE divergente na carga (caso 6) |
| `e2e:n07` | 48/48 | depois de corrigir o caso 9 (abaixo) |
| `e2e:n06` | falha por dado | espera 11 marcadores e 4 unidades em Aracaju: é roteiro do seed do dev |
| `e2e:m06` | não executa | precisa de equipamento fora de DISPONIVEL; a carga só tem disponíveis |

Capturas conferidas uma a uma (fora do repositório, por mostrarem a rede real): tela cheia sem
rolagem, título sobre o mapa, Atualizar no painel, clique na Sede abrindo a unidade direto, zoom em
Aracaju com "Ver estado inteiro", legenda aberta e fechada.

### Dois defeitos de roteiro, achados só com o dado real

- **`e2e:n07` caso 9 dava falso verde no dev.** `corBateComSombra` procurava `rgba?\(` e pulava a
  primeira cor da sombra, que o Chromium serializa como `color(srgb …)` por causa do `color-mix`;
  lia o `rgba(0, 0, 0, .6)` da segunda sombra. Preto empata os canais, e a comparação por ordem de
  canal passava por acaso com a degradada (R>G>B) do dev; com a disponível da carga, falhou. A cor
  real do anel batia exata. O parser agora lê os dois formatos.
- **`e2e:n08` caso 8 supunha Aracaju com várias unidades.** Com uma só, o componente enquadra o
  polígono (`limitesDoEnquadramento`), e o roteiro media o centro do envelope das unidades. Agora mede
  o do polígono quando há menos de 2, pelo alvo `.map__alvo`: desvio de 0,0%/1,0% na carga.

### DV16 e decisões de produto

Comparação do ping nos seis status montada, sem mudança no gradiente (DV16 em `mapa-dividas.md`).
Decisões do usuário registradas com data em DV02, DV09, DV10, DV14, DV15 e DV18; DV17 resolvida;
DV19 nova.

## 15. D21 — legenda sobre o mapa, painel de 420px, folga de 12px

Decisão em [D21](mapa-decisoes.md). Substitui, para legenda, painel e folga, o que §13 descreve.

| Item | Antes (D20) | Agora (D21) |
|---|---|---|
| Legenda | `<details>` no fim do painel | `<details>` filho do `.map-card`, inferior esquerdo, placa do título; abre para cima |
| Painel | 320px fixos | `clamp(340px, 30vw, 420px)`; empilha ≤900px |
| Folga | padding 16px, gap 16px (12px em ≤600px) | padding 12px, gap 12px em todas as larguras |
| Shell | — | intocado; `.shell__main` sem padding (a folga sempre foi do componente) |
| `e2e:n06` caso 4 | sobra ≤40% | sobra ≤42% (cartão mais estreito, câmera intacta) |

Roteiro novo `e2e:legenda-painel` (`LEGENDA_SENHA`, `E2E_EMAIL`, `API_PORT`, `E2E_OUT`,
`E2E_UNIDADES`): legenda no cartão, fechada, no canto, sem cruzar título nem zoom (fechada e aberta,
em 10 viewports, e com "Ver estado inteiro" visível), contraste ≥4,5:1 nos dois temas, alvo de
toque ≥32px, legenda aberta sobrevive ao Atualizar, folga de 12px medida, painel por viewport, KPIs em 2 colunas,
gaveta Mapa × Equipamentos lado a lado. Números em D21.

## 16. D22 — encaixe calculado, n06 em pixels, recuo da legenda, IBGE em todas

Decisão em [D22](mapa-decisoes.md).

| Item | Antes | Agora |
|---|---|---|
| Câmera do estado | `cameraForBounds` + zoom/offset fixos × rampa por proporção | `cameraDeEncaixe`: envoltória convexa projetada, margem 24px, afasta título/controles/legenda (folga 12px) |
| Legenda aberta | cobria até 3 marcadores (1024x768) | o estado recua; 0 cobertos em 10 tamanhos; instantâneo com reduced-motion |
| `e2e:n06` caso 4 | sobra vertical por centróide ≤ 42% | pixels, 9 tamanhos: margem ≥ 8px, sobra do eixo limitante ≤ 25%, equilíbrio ≤ 6 p.p.; as 4 mutações falham em todos |
| `e2e:legenda-painel` IBGE | só a unidade selecionada; N/A em silêncio | todas as unidades; conjunto exato via `E2E_IBGE_ESPERADO` |

Execução no dev com as cinco divergências do cadastro:
`E2E_IBGE_ESPERADO='Unidade Propriá:2805307,Sesc Itabaiana:2803005,Unidade Estância:2802205,Unidade Simão Dias:2806800,Unidade Socorro:2804607'`.
Na carga: `E2E_IBGE_ESPERADO=nenhuma`.

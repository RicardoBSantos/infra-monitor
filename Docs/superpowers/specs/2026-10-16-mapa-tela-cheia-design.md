# Mapa — tela cheia, clique direto, zoom por município, legenda recolhível

Data: 2026-10-16 · Branch: `feat/mapa-tela-cheia` (a partir de `origin/main` 801005f)

## Intenção

Cinco mudanças visuais e de interação na tela `/mapa`. Nenhuma muda o que a tela sabe ou busca da
API: mesmas duas chamadas (`/dashboard/unidades`, cartografia GeoJSON) e a mesma chamada de
equipamentos ao selecionar unidade. Se alguma esbarrar em dado ou arquitetura, parar e reportar.

Sucesso = o operador vê mapa e painel na altura inteira da viewport, sem rolagem de página; clica
num marcador e lê o detalhe da unidade na hora; clica num município e o mapa aproxima nele, o que
torna clicável cada marcador de Aracaju.

## Conflitos com `Docs/mapa-architecture/` (verificados)

| Mudança | Decisão registrada | Relação |
|---|---|---|
| 1. cabeçalho sobre o mapa, altura da viewport | D11 / DV11 — câmera calibrada contra a altura do cartão | **não contradiz, exige remedir** `OFFSET_CAMERA`/`ZOOM_AO_INCLINAR` |
| 2. clique no marcador abre o detalhe | D10 — marcador chama `selectMunicipio` e depois `selectUnidade` | **reverte a ordem de D10** (o município deixa de ser selecionado) |
| 3. clique no município dá zoom | M03/D10 — município seleciona e lista unidades | **reverte o papel do município**; reforça D15/D17 (município não carrega estado nem seleção) |
| 4. legenda recolhível fechada | D15 — "seis itens numa lista só, sem disclosure" | **reverte D15 nesse ponto**, a pedido; D12 já usou `<details>` nativo |
| 5. tirar fonte cartográfica/operacional | D14 — `space-between` no painel | sem conflito; `space-between` revisto (ver §4) |

Reversões viram D20 em `mapa-decisoes.md`, sem apagar D10/D15.

## 1. Aproveitamento de tela

- `<header class="map-page__header">` sai do topo. Eyebrow "OPERAÇÕES · SERGIPE", `h1#map-title`
  "Mapa operacional" e subtítulo vão para `.map-titulo`, **dentro** de `.map-card`, posição absoluta
  no canto **superior esquerdo** (o direito é do `NavigationControl`; o canto esquerdo superior fica
  vazio no enquadramento atual — a ponta noroeste do estado cai no centro-topo).
- Legibilidade: o canvas é escuro nos dois temas, mas o fundo do cartão segue o tema. O título vai
  sobre uma placa própria — fundo `color-mix(in srgb, var(--im-surface) 84%, transparent)` com
  `backdrop-filter: blur(6px)`, borda `--im-border`, raio do sistema — e texto com tokens de tema.
  Contraste então independe do que está atrás. `pointer-events: none`: não rouba arraste nem
  clique do mapa.
- Ordem de DOM: o título vem antes do `#host`, então o `h1` continua sendo o primeiro conteúdo da
  página e `aria-labelledby="map-title"` da `section` continua válido. Visível em loading/erro também.
- "Atualizar" vai para `.map-panel__topo`, primeiro filho do `aside`, alinhado à direita, mesma
  classe `botao`, mesmo `disabled` em loading.
- Altura: `.map-page` passa a ser coluna flex com altura `calc(100dvh - <altura do topbar>)` e
  `.map-layout` `flex: 1; min-height: 0`; cartão e painel ocupam 100% da linha. Sai o
  `clamp(460px, calc(100dvh - 196px), 780px)` com o teto de 780px. Piso de altura mantido (~420px)
  para viewport muito baixa — abaixo dele a rolagem é aceita e reportada. A altura real do topbar
  é lida no código do shell, não chutada.
- ≤900px (painel empilhado): cartão com altura da viewport útil, painel abaixo, rolagem do
  documento é o comportamento esperado (já era). ≤600px: placa do título compacta (subtítulo
  quebra em até 2 linhas, sem esconder).
- **Câmera remedida** (DV11): altura nova invalida a calibração. Remedir por captura em 3
  viewports, `e2e:n06` caso 5 (desequilíbrio ≤6 p.p., sobra ≤34%) e `e2e:n05` caso 19. Se o título
  cobrir marcador em alguma viewport, o offset leva isso em conta.

## 2. Clique no marcador abre direto o detalhe

- `selecionarPeloMarcador` passa a chamar só `selectUnidade(unidade)` + anúncio. Sem
  `selectMunicipio`, sem lista intermediária.
- O bloco `.selected-panel` (lista "N unidades neste município. Escolha uma…") sai do template e do
  SCSS (`unit-list__escolha*`). A `.unit-list` continua para "Unidades sem localização" e
  "Associação geográfica não encontrada".
- `cliqueVeioDeMarcador` continua guardando o handler de `click` em `municipios-fill` — agora mais
  importante: sem ele, clicar no marcador também dispararia o zoom do município. Prova em e2e com
  unidade de IBGE divergente (ITA-09) e com unidade de Aracaju.

## 3. Clique no município dá zoom

Respostas às perguntas do pedido:

- **Enquadramento pelos limites do polígono:** sim. `limitesDoMunicipio(geometria)` (pura, sobre
  `percorrerCoordenadas`) devolve o envelope; `map.fitBounds(envelope, { padding, pitch: PITCH,
  bearing: BEARING, maxZoom: ZOOM_MAXIMO_MUNICIPIO })`. Pitch e bearing preservados (pitch é padrão
  da experiência, D04). `maxZoom` evita que município pequeno vá a zoom de rua; valor medido em
  e2e contra o espalhamento dos 4 marcadores de Aracaju (alvo: ≥ 60px entre vizinhos mais próximos).
  Padding do lado esquerdo-superior inclui a placa do título.
- **Animação:** sim, ~600 ms. Com `prefers-reduced-motion: reduce`, `duration: 0` — lido no momento
  do clique pela `animacaoReduzida()` que já existe.
- **Caminho de volta:** botão "Ver estado inteiro" sobreposto no cartão (abaixo do
  `NavigationControl`, canto superior direito), visível só quando a câmera saiu do enquadramento
  inicial (zoom por município, zoom manual ou arraste), e tecla **Escape** com foco dentro do mapa.
  Ambos chamam `enquadrarEstado(animado)`, que é a mesma rotina do enquadramento inicial extraída
  (fitBounds com pitch + compensação de zoom + offset). Duplo clique **descartado**: é o gesto
  nativo de aproximar do MapLibre, e o primeiro clique de um duplo clique já dispara o zoom do
  município.
- **Município sem unidade:** faz o mesmo (zoom). O anúncio da região viva diz "Itabaiana: nenhuma
  unidade cadastrada", então a informação que a lista dava não se perde para leitor de tela.
- **Teclado:** o alvo invisível `.map__alvo` (Enter/Espaço) faz o mesmo zoom. Ele perde
  `aria-pressed`: não é mais seleção, é ação; `aria-label` continua "Aracaju: 4 unidades".
- **Seleção da unidade não muda** com o zoom: o painel da unidade aberta continua. O sinal
  `selected` (município) e `marcarMunicipio` deixam de existir.

## 4. Legenda recolhível

- `.legend-bloco` vira `<details class="legend-bloco">` com `<summary>` "LEGENDA DE STATUS",
  **fechado por padrão**, sem persistência. `<details>` nativo: Enter/Espaço e estado exposto ao
  leitor de tela sem JS (mesmo argumento de D12).
- Dentro: intro "Cor do marcador de unidade.", os 6 itens de cor, e duas notas de uma linha cada:
  - "Município é neutro: situa, não indica estado."
  - "Arco liga a unidade ao hub, na cor do status dela."
  Uma linha conferida em e2e (altura de cada nota = uma linha) a 320px de painel.
- Painel: `justify-content: space-between` sai (D14 o usava para distribuir sobra entre blocos
  fixos; com legenda fechada e rodapé fora, ele abriria dois vãos). Fluxo natural de cima para
  baixo; a sobra fica no fim da coluna, não no meio. Ordem: Atualizar, status geográfico, unidade
  selecionada, legenda, avisos.

## 5. Rodapé do painel

`<dl class="map-source">` sai, com as regras `.map-source*` do SCSS.

## Testes

- `ng test`: unitários para `limitesDoMunicipio` (Polygon e MultiPolygon). Funções que saem
  (nenhuma pura sai) — conferir spec.
- Roteiros existentes ajustados ao comportamento novo, sem afrouxar o que provam: `n05` (Tab parte
  do último controle antes do cartão; casos 5/6/15/17/20 reescritos para zoom e clique direto),
  `n06` (legenda dentro de `<details>`, rolagem 0), `n07` (legenda), `m06` (afetados por marcador).
- Roteiro novo `e2e/n08-tela-cheia-zoom.cjs` (`npm run e2e:n08`), por clique, com:
  rolagem 0 em 1920×1080, 1366×768, 1280×720 e 1024×768; título dentro do cartão sem cobrir
  marcador nem controle; clique no marcador abre `.unit-panel` sem `.selected-panel`; marcador de
  Aracaju e ITA-09 não disparam zoom; clique em município muda zoom e centro para o envelope dele;
  Aracaju com zoom tem os 4 marcadores clicáveis (cada um, por `elementFromPoint`, é o próprio);
  município sem unidade também aproxima; "Ver estado inteiro" e Escape voltam ao enquadramento
  inicial; reduced-motion = câmera final no primeiro quadro; legenda fechada por padrão, abre e
  fecha, 6 itens, notas de uma linha; rodapé ausente; nenhum erro de console.
- Capturas: (a) mapa sem seleção, (b) detalhe aberto por marcador, (c) zoom após clique no
  município, (d) legenda aberta e fechada — mais as viewports. Conferidas uma a uma por mim.

## Fora de escopo

Clustering (DV09/DV15), persistência do estado da legenda, qualquer mudança de backend, tokens
órfãos (DV12).

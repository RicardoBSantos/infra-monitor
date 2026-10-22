# Mapa — log de decisões

Ordem cronológica. Cada entrada registra o que foi decidido, o que foi descartado e por quê.
Fonte: mensagens dos commits do ciclo (`git log --grep` em `feat(mapa)`, `feat(dashboard)`,
`feat(unidades): conexão`, `fix(mapa)`, `test(e2e)`), mais os spikes N01/N02, que rodaram em
worktree fora do repositório e por isso não têm commit aqui.

---

## D01 — Coordenada da unidade é eixo independente do município
`e8642d8 feat(dashboard): expõe coordenadas da unidade na leitura operacional`

`latitude` e `longitude` passam a sair na projeção de unidades, ao lado do `codigo_ibge` que já
existia. São dois eixos **independentes**: o município posiciona a unidade no mapa coroplético, a
coordenada posiciona o marcador.

**Descartado:** derivar a posição do marcador do centróide do município. Colapsa as quatro unidades
de Aracaju num ponto só e mente sobre onde elas estão.

**Descartado:** `coalesce(latitude, 0)`. `0` é latitude e longitude válida — converter o nulo
plantaria unidades no Golfo da Guiné, indistinguíveis de dado real. Nulo continua nulo, e quem
consome testa com `!= null`, nunca por veracidade.

As colunas já existiam desde a `V2`; não houve migration.

---

## D02 — Cartografia real em GeoJSON, sem camada de tiles
`a2f2e71 feat(mapa): cartografia real de Sergipe com painel lateral e seleção`

O SVG desenhado à mão sai; entra o GeoJSON dos municípios de Sergipe, ligado aos dados operacionais
pelo código IBGE.

**Descartado: tiles de servidor externo (opção A).** A base passa a ser o próprio GeoJSON, e o fundo
é o gradiente do cartão. Duas razões: identidade visual — tile de terceiro traz a paleta de outra
pessoa para dentro do painel — e independência de conectividade, já que a aplicação é interna e não
deve depender de rede externa para desenhar a tela.

**Decisões do Leaflet que custaram tempo:**

- `renderer: L.svg()` obrigatório. O renderizador Canvas não cria elemento por município, e sem
  elemento não há foco de teclado nem classe de status.
- `fitBounds` **antes** de decorar. O Leaflet adia o trabalho real por `whenReady`; decorar antes
  encontra `getElement()` nulo e o `tabindex` não é escrito — em silêncio, o mapa fica inacessível.
- `aplicarTons` sob `untracked` dentro da montagem. Sem isso o effect passa a depender de
  `selected()`, cada clique destrói a camada e reprojeta a cartografia, e o município focado sai do
  DOM levando o foco para o `body`: o operador de teclado perdia a posição a cada seleção.

**Seleção é anel, não preenchimento.** Enquanto a seleção substituía o tom do município, o azul
colidia com o de "Em manutenção" e escondia justamente o status da unidade recém-escolhida. O
`fill` continua sendo o status; o contorno é a seleção. `--im-map-select` ficou órfão e saiu.

---

## D03 — Acessibilidade por Marker nativo, não por lista paralela
Spike N02, fora do repositório. Consolidado em `f6b5eb6`.

O polígono do município vive dentro do canvas WebGL, que não cria nó por feature. O tab-stop de cada
município é um `<button>` real, posicionado pelo MapLibre como `Marker`.

**Descartado: canvas + lista paralela de municípios ao lado do mapa.** Duas representações do mesmo
conjunto, que divergem assim que uma das duas mudar, e navegação por teclado que nunca é a mesma
coisa que a navegação do mouse. O spike provou 12/12 casos de teclado com `Marker`.

**Descartado: sincronizar posições de elementos DOM por frame.** O `Marker` já é reposicionado pela
própria lib em pan, zoom, pitch e rotate.

Achados do spike que sobreviveram: MapLibre 6 não tem export default, e o canvas é o primeiro
tab-stop da região do mapa.

---

## D04 — Leaflet → MapLibre GL, com extrusão 3D
`f6b5eb6 feat(mapa): substitui Leaflet por MapLibre GL com extrusão 3D`

**Por que trocar:** pitch e extrusão reais exigem WebGL. O Leaflet projeta em 2D; qualquer
"3D" nele seria desenho fingindo profundidade.

**Pitch é padrão da experiência, não toggle.** Em pitch 0 o mapa volta a ser o Leaflet de antes — um
botão para desligar a única coisa que a troca trouxe não é opção, é desfazer a decisão.

**Altura do bloco = equipamentos monitorados no município.**

> **Descartado: altura = incidentes abertos.** Num dia bom o mapa ficaria plano — exatamente o
> oposto do que o plantão precisa ver. A altura tem de descrever a massa monitorada, que é estável;
> a cor descreve o estado, que muda.

Escala linear, 400 m por equipamento (e não os 800 do spike): no banco real Aracaju soma quatro
unidades e 81 equipamentos, o triplo do segundo colocado, e com 800 aquele bloco virava uma parede
de 65 km que tapava metade do estado. **Descartado achatar o maior por estética** — a legenda promete
altura proporcional a equipamentos, e quebrar essa promessa é pior que um bloco alto.

**Enquadramento em duas etapas.** `fitBounds` com `pitch` junto encolhe o mapa, porque a câmera
recua para caber a área inclinada, que é maior que o retângulo. Enquadra-se plano e só então se
aplica a inclinação, com `OFFSET_CAMERA` e `ZOOM_AO_INCLINAR` explícitos — sem isso sobra faixa
morta em cima e embaixo do cartão.

**CSS do MapLibre pelo chunk lazy da rota**, via `meta.load-css` sob `::ng-deep`.
**Descartado `styles[]` do `angular.json`**: é bundle inicial, ~8,6 kB gz cobrados de quem nunca
abre o Mapa. **Descartado `import` de CSS no `.ts`**: o builder emite a folha e nada a carrega em
runtime — ela sai órfã do `dist`. Custo aceito e registrado: a folha do componente passa dos 6 kB, e
o erro do budget `anyComponentStyle` subiu para 100 kB.

**Anel de seleção como segunda `fill-extrusion`, não como camada `line`.** Camada de linha desenha
no nível do chão, e em município alto o anel ficava no pé do bloco, longe do topo que o operador
está olhando. O colar nasce onde a extrusão termina e sobe `ESPESSURA_ANEL`.

**Colar translúcido (#f2d6ff a 0.5), não opaco.**

> **Descartado opaco:** apaga a face superior — a mais visível vista de cima — deixando o município
> selecionado sem cor de status. Isso inverteria a prioridade: status é o dado operacional, seleção
> é só interação.
>
> **Descartado magenta saturado (#c05cff):** translúcido, magenta sobre verde vira cinza
> dessaturado — apaga o status **e** apaga a seleção. Lilás claro clareia sem torcer o matiz de
> baixo.
>
> **Descartado `--im-primary` (#3B6EFF):** em 3D o colar encosta no bloco, e azul sobre
> `em-manutencao` (#7fadff) fica ambíguo.

**Marker com `pitchAlignment`/`rotationAlignment` em `viewport`.** Com `map`, o alvo e o anel de
foco deitam junto com o terreno e o foco fica ilegível.

**Worker do MapLibre entra como asset.** O builder do Angular não emite `maplibre-gl-worker.mjs`: o
`new Worker(new URL(...))` está dentro de `node_modules` e passa batido. Sem correção o mapa sobe
inteiro — canvas, controles, marcadores — e nunca desenha, porque a fonte fica presa em "carregando"
e `isStyleLoaded()` jamais vira true. **Não há erro no console.** Os dois `.mjs` entram como assets e
são apontados por `setWorkerUrl`.

**Testes de DOM saem do jsdom.** Sem WebGL, montar o componente falha na criação do contexto
gráfico. As funções puras continuam no spec; o resto virou `e2e/n05-mapa-maplibre.cjs`, com 21
verificações.

Custo medido: bundle inicial 99,49 → 96,94 kB gz; chunk do Mapa 43,27 → 244,51 kB gz.

---

## D05 — Hub como FK auto-referência, não booleano
`8cd4e28 feat(unidades): conexão entre unidades por auto-referência`

`unidade.conecta_a_unidade_id` aponta para a unidade-pai.

**Descartado: booleano `principal`.** O que a tela desenha é enlace, e enlace tem duas pontas
identificadas. Um booleano só diria **quem é a sede**, e obrigaria o frontend a assumir "todas ligam
nela" — topologia estrela cravada em código, impossível de mudar sem reescrever a tela.

Unidade raiz é `conecta_a_unidade_id IS NULL`, derivado. **Descartado: segunda coluna marcando a
raiz** — duas fontes para o mesmo fato divergem.

**Conexão tem recurso próprio (`PUT`/`DELETE /unidades/{id}/conexao`).** Fica fora de
`UpdateUnidadeRequest` de propósito: no `PUT` da unidade `null` significa "preserva o valor atual", e
não existe "número vazio" equivalente à string vazia. Pelo corpo da unidade seria possível **definir**
um hub, nunca **desconectar** — a opção "Nenhuma" do formulário não gravaria, em silêncio.

**Ciclo é regra de serviço, não constraint.** `ck_unidade_conexao_nao_reflexiva` só cobre `id = id`;
`A → B → A` nenhuma constraint alcança. A varredura da cadeia fica no serviço, com teto de
profundidade que protege inclusive contra ciclo gravado direto no PostgreSQL.

Excluir unidade com filhas passa a ser 409 antes de a FK estourar 500.

---

## D06 — "Conecta a" na gaveta, com duas chamadas ordenadas
`e008504 feat(unidades): campo "Conecta a" na gaveta de cadastro`

Select abaixo de Latitude/Longitude. A própria unidade em edição é filtrada da lista.

Salvar faz duas chamadas em sequência, e **a ordem não é opcional**: a unidade precisa existir antes
de receber conexão — no cadastro novo o id só nasce na resposta do `POST`. A segunda chamada só sai
quando o destino mudou. Voltar para "Nenhuma" emite `DELETE`.

A gaveta busca a própria lista de destinos em vez de recebê-la do pai: ela também vive no cabeçalho
do detalhe, onde essa lista não existe. Falha nessa busca esvazia o select sem derrubar o formulário.

---

## D07 — Roteiro e2e como teste permanente
`3aa79fb test(e2e): roteiro de conexão entre unidades, executável em clone limpo`

`playwright` entra em `devDependencies` e o roteiro vira `npm run e2e:n04`. Os cinco roteiros que já
viviam em `e2e/` dependiam de instalação global e **não rodavam em clone limpo**; este roda.

Dois defeitos do próprio roteiro entraram corrigidos, porque são o que o torna confiável:

- **Nada de catch silencioso em seletor.** `input[placeholder*="Buscar"]` casa com a busca global do
  cabeçalho **e** com o filtro da lista; embrulhado em catch, virava filtro nunca aplicado e teste
  que passava por sorte.
- **Nada de contagem cravada.** "11 opções" falhava quando o banco de dev ganhava uma unidade. A
  asserção passou a ser relativa ao total anunciado pela própria lista.

O log de rede é gravado em `finally`: uma execução morreu no meio sem deixar rastro, e provar que
ela não havia escrito num registro exigiu recorrer a timestamp de banco.

---

## D08 — Gaveta de equipamento em dois pais, sem rota
`M06`, nesta rodada.

Clicar num equipamento afetado no painel do Mapa abre a **mesma** gaveta de `/equipamentos/:id` por
cima do mapa.

**Descartado: navegar para `/equipamentos/:id`.** Destruiria o componente e remontaria o mapa
inteiro — canvas WebGL, cartografia e câmera — só para mostrar um painel.

**`inert` vai na página do mapa, e a gaveta fica fora dessa seção** — o contrário da lista de
Equipamentos, onde o `inert` vai na gaveta porque quem abre por cima dela é um modal. Aqui o que
fica atrás é um canvas que o MapLibre põe na ordem de Tab (`tabindex=0`), mais um Marker focável por
município: sem `inert`, o Tab a partir do último controle da gaveta cai direto no mapa por trás do
backdrop. **`aria-hidden` sozinho não resolve** — esconde do leitor de tela e deixa o foco passar.

Verificado que MapLibre tolera ancestral `inert`: seleção, Markers, câmera e WebGL sobrevivem.

---

## D09 — Dado de demonstração vira mecanismo versionado
Esta rodada.

O dado de demo do banco de dev (11 unidades) havia sido inserido à mão — as linhas 3 a 11 têm
`created_at` idêntico ao microssegundo. Não havia script, seed Flyway nem `data.sql`, e `endereco`
estava nulo nas 11. Reproduzir o ambiente em outra máquina era impossível.

**Coordenadas e endereços: SQL versionado em `infra-monitor-backend/db/dev-seed/`, aplicado à mão.**

> **Descartado `V19__seed_demo.sql`:** rodaria em produção no primeiro boot e plantaria 11 unidades
> fictícias num ambiente real. Schema é do Flyway; carga de vitrine não é schema.
>
> **Descartado seed pela API (`PUT /unidades/{id}`):** o `PUT` aplica o corpo inteiro, e campo
> ausente vira nulo. Um seed que só quisesse preencher coordenada apagaria `nome`, `sigla` e
> `cidade` das 11 unidades — a mesma armadilha do `aplicarSePresente` já corrigida antes.
>
> **Descartado `src/main/resources/db/dev-seed/`:** entraria no jar e viajaria para produção como
> bagagem morta.

**Topologia: pelo endpoint `PUT /unidades/{id}/conexao`, não por SQL.** É a exceção deliberada à
regra acima. O endpoint carrega a detecção de ciclo multi-hop (ver D05), que o `CHECK` do banco não
faz. Um erro de digitação no seed que criasse `A → B → A` passaria batido no SQL e é recusado pelo
endpoint. Script: `infra-monitor-frontend/e2e/seed-topologia-unidades.cjs`.

---

## D10 — Marcador de unidade, e a linha que ele tornou possível
`N06`, esta rodada.

Até aqui o mapa **não usava `latitude`/`longitude` para nada**: os únicos `Marker` eram os alvos
invisíveis de teclado, um por município, no centróide do polígono. O marcador de unidade é o
primeiro uso real da coordenada.

Mesma técnica do alvo de município (D03) e pelo mesmo motivo — `Marker` nativo com `<button>` real,
`pitchAlignment`/`rotationAlignment` em `viewport`. A cor vai por variável CSS escrita pelo
componente com **o mesmo hex que o canvas usa no bloco**: uma fonte só de cor, sem classe de status
paralela no SCSS. A borda escura existe porque o marcador pousa sobre o bloco da mesma cor — sem
ela, unidade disponível some dentro de município verde.

Clicar no marcador seleciona o município **e** a unidade, nesta ordem: `selectMunicipio` desenha o
colar e, em município de uma unidade só, já a escolhe; em município de várias ele limpa a escolha, e
o `selectUnidade` seguinte repõe a que foi clicada. Invertida, a ordem apagaria a unidade
recém-escolhida.

**Linha hub→unidade só quando as DUAS pontas têm coordenada.** Meia linha, saindo do nada ou
terminando no nada, seria lida como ligação para fora do estado — pior que nenhuma linha.

**Cor da linha: cinza-azulado dessaturado (#4a6c8c), translúcida.** **Descartado qualquer tom da
escala de status** (verde, âmbar, vermelho, azul claro): a linha é topologia, não estado, e seria
lida como um. **Descartada opaca:** ela cruza o estado inteiro e recortava em dois os blocos cuja
cor de status é o dado que importa.

**Camada da linha depois da extrusão na ordem do estilo.** Antes dela, o bloco de Aracaju — o mais
alto do estado — cobria o feixe inteiro que sai dele.

`conectaAUnidadeId` entra no read-model do dashboard (aditivo, anulável, no fim do record).
**Descartada a segunda chamada a `/unidades`** só para descobrir o pai de cada unidade já carregada.

---

## D11 — Altura do cartão presa à viewport
`N06`, esta rodada.

`aspect-ratio: 760/680` era herança do SVG antigo, que tinha `viewBox` e portanto proporção
intrínseca. Num `<div>` de ~1200 px de largura ela impunha ~1074 px de altura, e a área principal do
shell ganhava barra de rolagem — numa tela cujo ponto inteiro é ser vista de uma vez.

O que a proporção protegia era a calibração de câmera de D04. Trocar a altura sem mais nada
reabriria a faixa morta que D04 fechou, então `OFFSET_CAMERA` e `ZOOM_AO_INCLINAR` foram
**recalibrados contra a altura nova**, e não herdados. As duas correções convivem porque a segunda
foi refeita em cima da primeira.

`100dvh` e não `100vh`: no navegador móvel a barra de endereço entra e sai da conta.

---

## D12 — Legenda compacta por relevância operacional
`N06`, esta rodada.

Oito itens sempre abertos mais dois parágrafos empurravam o resto da coluna para fora da dobra.

Visíveis por padrão ficam os quatro status **operacionais reais** — Disponível, Indisponível,
Degradada, Em manutenção — os que mudam de um dia para o outro. Os outros quatro descrevem ausência
de dado e nunca mudam sozinhos: vão para um `<details>` nativo, que entrega Enter/Espaço e estado
exposto ao leitor de tela sem uma linha de JS. As notas descrevem a gramática do mapa, que se
aprende uma vez: vão para um botão de informação.

**Descartado tooltip em `:hover`:** exclui teclado e toque. O botão tem `aria-expanded` e
`aria-controls`.

---

## D13 — Reversão da extrusão: polígonos planos, câmera inclinada
`N07`, esta rodada. **Reverte a geometria de D04 e a codificação de altura de N03. Não apaga as
duas: elas foram executadas como pedidas, e o que mudou foi a leitura do resultado.**

Os blocos `fill-extrusion` liam como objetos soltos flutuando sobre o mapa, não como relevo do
território. Feedback visual direto, depois de ver a tela pronta com dado real: o que a extrusão
entregava não era profundidade do mapa, era um segundo mapa pairando acima do primeiro. A
inclinação de câmera (`pitch: 45`, `bearing: -18`) já entrega a leitura tridimensional pretendida, e
entrega sem descolar o desenho do chão. Fica o `pitch`; sai a altura por município.

**Aprendizado, não falha de execução.** N03 escolheu a escala (400 m por equipamento, medida contra
a distribuição real do banco) e N05 resolveu tudo que a extrusão exigia — colar de seleção no topo,
offset de câmera, ordem de camadas. Os dois cumpriram o que foi pedido. O que não dava para saber
antes de ver era como o recurso lê com os dados reais na tela.

**Consequências revistas, não apagadas:**

- **Altura = equipamentos some sem substituto ambiente.** O número continua no painel lateral (KPI
  "Equipamentos" da unidade, contagem na lista de município com várias unidades). Descartado número
  dentro do polígono: a 75 municípios em zoom de estado, vira ruído tipográfico.
- **Anel de seleção volta à geometria de M04** — camada `line`, 3px no contorno do polígono. A razão
  de ele ter virado um colar de extrusão em D04 era ficar no topo do bloco em vez do pé; sem bloco,
  a razão some. **A cor de D04 fica:** `#f2d6ff`. O `--im-primary` do anel de M04 não volta porque
  lá os `fill` eram translúcidos sobre fundo escuro e hoje são hex sólidos — azul encostado em
  `em-manutencao` (#7fadff) é a colisão que D04 já tinha registrado.
- **Câmera recalibrada do zero, não herdada.** `OFFSET_CAMERA` e `ZOOM_AO_INCLINAR` compensavam o
  encolhimento do bloco inclinado. Além dos valores, mudou a sequência: `fitBounds` agora recebe o
  `pitch` direto, em vez de enquadrar plano e inclinar depois. Sem blocos, enquadrar já inclinado
  sai centrado (desequilíbrio topo-base de 4,1% contra 8,6% herdando a sequência de D04), e o que
  resta é encolhimento uniforme, que a compensação de zoom resolve sozinha. Valores em vigor:
  `pitch 45`, `bearing -18`, `zoom +0,68`, `offset [-24, 60]`. Medidos por diferença de pixel do
  desenho contra o fundo do próprio cartão, em três viewports.
- **Legenda perde duas notas** ("altura do bloco", "colar translúcido"), que descreviam geometria
  inexistente. Com uma nota só, o botão de informação de D12 custava mais interação do que o texto
  que escondia: nota promovida ao corpo, botão removido.

**Marcador de unidade, dois sintomas corrigidos junto.** A revisão visual apontou um "círculo
branco" no meio de um município alaranjado. Não era artefato de renderização: era o marcador de uma
unidade Degradada sobre um município Degradado — mesmo hex no miolo e no fundo, sobrando só o aro
escuro, que lê como furo. A borda escura de D10 protegia contra fundo de status diferente, não
contra o mesmo. Entra um halo claro de 1,5px entre miolo e borda, que não é cor de status e por isso
separa o marcador dos seis tons. O segundo sintoma — o `Marker` projeta na coordenada de chão
enquanto o bloco flutuava acima, deixando o marcador visualmente deslocado do topo que deveria
marcar — desaparece sozinho com o polígono plano. Achados em momentos diferentes da investigação,
corrigidos no mesmo commit.

---

## D14 — `/mapa` sem `max-width`, e painel sem buraco
`N07`, esta rodada.

`max-width: 1500px` é a convenção das seis telas de tabela e formulário, onde linha longa demais
prejudica a leitura. O Mapa é cartografia presa à viewport: cada pixel de gutter é área que não se
desenha. Em 1700px sobravam ~100px mortos de cada lado, e a coluna do mapa passa de 1119 para
~1320px sem o limite.

**Verificado antes de mexer:** o valor não é token nem classe compartilhada — é literal repetido em
cada componente de página, e o `.shell__main` não tem largura máxima. Tirar de `.map-page` não
alarga nada além do Mapa, e nenhuma media query usa 1500px como ponto de quebra.

**O vazio do painel era conteúdo curto, não grade quebrada.** O painel é item de grade esticado e já
tinha exatamente a altura do cartão; o que havia era `margin-top:auto` na fonte cartográfica,
empilhando toda a sobra numa costura só — 307px de buraco no meio da coluna. Duas mudanças, nesta
ordem: o disclosure "Estados sem leitura" volta a abrir por padrão (conteúdo que já existia e
estava escondido — a razão de D12 para fechá-lo eram oito itens mais duas notas, e as notas saíram
com a extrusão), e a sobra restante é distribuída com `justify-content: space-between`. Maior
costura: 110px. Com unidade selecionada o painel enche e a regra fica inerte.

**Descartado esticar os cards para preencher a altura** e **descartado inventar conteúdo novo** para
o espaço: o painel mostra o que há, e o que há é curto quando nada está selecionado.


---

## D15 — Município perde a cor de status; o marcador vira o portador único
`N07`, esta rodada. **Aprovado direto, sem investigação prévia.**

O polígono de município passa a ser **contorno `#294056` + fundo `#16283a`, igual em todo o
estado**. Só o marcador de unidade carrega cor de status daqui pra frente.

**Por que a cor sai do polígono.** Um município é uma área grande e irregular; a mesma cor que num
marcador de 13px lê como "esta unidade está indisponível", num polígono de meia tela lê como "esta
REGIÃO está indisponível" — leitura que o dado não sustenta. O caso que expõe isso é Aracaju: com
quatro unidades ela nunca teve status no mapa, caía no tom `multiple` (#38536b), que não é estado
operacional nenhum e existia só para dizer "não dá para resumir isto numa cor".

**O código encolheu, como previsto no pedido:**

| Fora | Onde estava |
|---|---|
| `toneDoMunicipio()` e seu teste | `mapa.component.ts` / `.spec.ts` |
| Tons `multiple` e `none` | `COR_DO_TOM` |
| Propriedade `cor` por feature no GeoJSON | montagem da `FeatureCollection` |
| `['get','cor']` na camada `municipios-fill` | estilo do mapa |
| `.legend__dot--none`, `.legend__dot--multiple` | `mapa.component.scss` |
| `<details class="legend-extra">` e suas 9 regras de estilo | HTML + SCSS |

`COR_DO_TOM` virou `COR_DO_STATUS`: sem os dois tons de polígono, o que resta corresponde
**exatamente** ao enum `UnitOperationalStatus`, e o mapa passa a ter uma fonte de cor de status só,
consumida por um consumidor só.

**Legenda reescrita, não só re-rotulada.** Ganha o subtítulo "Cor do marcador de unidade" — sem ele,
"LEGENDA DE STATUS" num painel ao lado de um mapa cheio de polígonos continua apontando para o
polígono. E ganha uma segunda nota de gramática, dizendo que o município é neutro de propósito: a
ausência de cor é uma decisão, e sem dizê-la o operador pode ler o cinza uniforme como "nenhum dado
chegou".

**O disclosure "Estados sem leitura" foi desfeito, e essa foi a pergunta menos óbvia da mudança.**
Ele agrupava quatro itens. Dois — "Município sem unidade" e "Múltiplas unidades" — eram vocabulário
**exclusivo da coloração de polígono**: nenhum marcador jamais os usou, e morreram com ela. Os dois
que sobraram, "Sem dados" e "Sem equipamentos", são `UnitOperationalStatus` de verdade, do mesmo
enum dos outros quatro. Guardar dois irmãos legítimos atrás de um `<details>` que já abria por
padrão (D14) custava uma linha de interface para esconder nada. Uma lista de seis.

**Descartado:** manter o disclosure com dois itens (separação sem conteúdo); usar `#0c1722` (o
`none` antigo) como fundo neutro — é escuro demais, o polígono some no `radial-gradient` do cartão;
usar `#263744` — já é o hex de `sem-equipamentos`, e reaproveitá-lo como "neutro" recria em cinza a
ambiguidade que a mudança existe para tirar.

**Confirmado, não assumido — o painel "STATUS GEOGRÁFICO · SERGIPE" não dependia disto.**
`statusGeografico` é `contarPorStatus(municipios().flatMap(m => m.units))`: agrega as **unidades**,
sem passar por `toneDoMunicipio` nem por `COR_DO_TOM`. Os contadores continuam idênticos. O que
mudou é que a antiga garantia "por construção o card não pode divergir da cor dos municípios"
(comentário de `ORDEM_SEVERIDADE`) deixou de ter objeto — não há mais cor de município com que
divergir.

**Nenhum e2e verificava cor de município**, ao contrário do que o pedido supunha: o canvas roda com
`preserveDrawingBuffer` desligado e não é legível in-page, então a coloração do polígono só existia
como **captura de evidência**. O que existia e mudou são contagens de legenda no `e2e:n06` (4 → 6
itens, disclosure ausente, subtítulo presente, 2 notas) e o texto do caso 20 do `e2e:n05`, que
prometia mostrar "a cor de status intacta dentro do anel". O `--cor-unidade` lido pelo `e2e:n06`
continua valendo: é marcador, não polígono.

---

## D16 — Pulso seletivo, ping colorido na linha neutra, dica de relance
`N07`, esta rodada. Fecha a investigação registrada em
[mapa-contexto-atual §9](mapa-contexto-atual.md).

### O que entrou

**Pulso seletivo.** Anel no `::after` do marcador, `transform` + `opacity`, só em `INDISPONIVEL` e
`DEGRADADA`. Pulsar os onze seria onze coisas disputando atenção — um indicador "live" pulsa porque
é o único na tela. `EM_MANUTENCAO` fica fora: é estado planejado, não chamado. Os dois de ausência
de dado também: não há o que atender.

Efeito colateral que não foi projetado e vale registrar: **a seletividade resolve sozinha o problema
de contraste do anel**. Os dois tons que pior contrastam com o município (`sem-dados` 1,92:1 e
`sem-equipamentos` 1,22:1) simplesmente não pulsam; os que pulsam dão 3,84:1 e 6,96:1.

**Linha neutra, ping colorido.** A linha continua `#4a6c8c`. A cor de status vai no **ping**, e é a
da unidade **conectada** (o filho), porque a linha existe por causa dela. Foi a contraproposta feita
na investigação e aprovada: colorir a linha inteira repetiria em outro elemento grande o erro de
leitura que D15 acabou de tirar do polígono — uma linha vermelha cruzando meio estado afirma "este
caminho está indisponível", e o caminho não é monitorado. Um ponto de 7px não afirma sobre a área
que atravessa.

**Técnica do ping: `Marker` DOM com `setLngLat` por quadro.** Escolhida por medição, contra
`setData` de GeoJSON (2,9× mais caro) e `line-dasharray` animado (1,7× mais caro, em degraus e não
bidirecional). Dois pings por linha em fase oposta entregam o "ida e volta" sem camada extra: as
linhas têm exatamente dois vértices, então a posição é um `lerp` e a volta é o mesmo `lerp`
espelhado. Números na [§9.2](mapa-contexto-atual.md).

**Dica de relance.** Filha do `<button>` do marcador, não `Popup` do MapLibre — a lib já reposiciona
o pai, e a dica acompanha de graça. Três campos: **nome, status, incidentes abertos**. Os outros
quatro da imagem de referência (latência, disponibilidade, monitores, última verificação) não
existem em `DashboardUnidade`: são de granularidade de equipamento ou de relatório. A referência é
um cartão de equipamento; o marcador é de unidade. Ampliar o read-model fica para quando for pedido
— ver [DV14](mapa-dividas.md).

Aparece em `:hover` **e** em `:focus-visible`. Não há conflito com Enter/Espaço, e a razão é que são
eventos diferentes: a dica reage a foco e ponteiro, a seleção reage a `click`, que é o que Enter e
Espaço disparam num `<button>`. **Focar não é acionar.** Provado no `e2e:n07` caso 5: com a dica
aberta por Tab, a contagem de `aria-pressed=true` não muda; o `Enter` seguinte seleciona.

`aria-hidden` na dica, e os mesmos três dados no `aria-label` do botão (`rotuloDaUnidade` ganhou os
incidentes). Sem isso o leitor de tela anunciaria tudo duas vezes — ou, pior, o mouse teria um dado
que o teclado não tem.

**Pings invisíveis para teclado e leitor de tela.** `<div aria-hidden="true">` sem `tabindex`, sem
nome acessível, sem papel. Verificado por **varredura de Tab real** no `e2e:n07`: 92 paradas de Tab
na página, zero pings.

### Três correções exigidas na revisão, todas resolvidas nesta rodada

**1. `transform` morto — DV13 fechada.** O MapLibre reescreve `element.style.transform` do `Marker`,
e estilo inline vence folha de autor: os `transform: scale()` de N06 nunca aplicaram. A regra que
fica é **`transform` no elemento do `Marker` pertence à lib**. Duas consequências, e não uma:

- o **pulso** vai no `::after`, que tem `transform` próprio (é o que a revisão pediu);
- o **hover e a seleção** crescem por `width`/`height`, não por pseudo-elemento. Não é desvio da
  regra — é a mesma regra aplicada a um caso diferente. O pseudo-elemento serve quando se precisa de
  `transform`; quando o que se quer é o **elemento** maior, largura e altura funcionam, e funcionam
  porque o `translate(-50%, -50%)` da própria lib é relativo ao tamanho: o marcador cresce centrado
  sozinho, e o `outline` de foco acompanha a caixa sem conta nenhuma. Um `::before` crescendo teria
  colidido de raio com o anel de foco e com o anel de pulso, que já disputam os mesmos 15px.

O `e2e:n07` caso 3 trava a regra: a matriz de `transform` do elemento nunca ganha componente de
escala, e é a largura que muda no hover.

**2. Contraste dos status escuros — regressão do item 1, corrigida.** A borda escura do marcador
(N06) foi desenhada contra um fundo que **mudava** de cor. Com D15 o fundo é um tom só, e a borda
escura passou a valer 1,28:1 — deixou de existir. Sem ela, os dois status escuros encostavam no
município: `sem-dados` 1,92:1 e `sem-equipamentos` **1,22:1**.

Trocado por **aro claro por fora** (`rgba(232,240,248,.92)`, 13,05:1) e o halo interno de 1,5px
removido. O marcador passa a se separar do mapa pelo **aro**, não pelo miolo, e o miolo fica livre
para ser só a cor de status. Duas declarações de borda viram uma.

**3. Anel de foco seguia o tema da aplicação — achado novo, mesmo caso.** Perseguindo o contraste do
item 2, apareceu um defeito maior: `--im-primary` muda com o tema, mas **o canvas não tem tema**.
Todas as cores desenhadas nele são hex literais, porque o WebGL não lê variável CSS. No tema claro
`--im-primary` é `#1a56db`, e contra o `#16283a` do município isso dá **2,43:1** — reprovado por
WCAG 2.2, que exige 3:1 para indicador de foco. No escuro passava (3,47:1). O anel de foco do mapa
estava dependendo de qual tema o operador escolheu.

Antes de D15 o defeito existia mas era intermitente, porque o polígono tinha cor variável. Com fundo
constante dá para fechar: `--cor-foco-mapa: #3B6EFF`, literal, aplicado aos três focos que vivem
sobre o canvas (`.map__unidade`, `.map__alvo`, `.maplibregl-canvas`). **É o único lugar do sistema
onde um literal vence o token — e vence porque a superfície embaixo dele também é literal.**

### Quarta correção, achada na revisão visual das próprias capturas

**Divisa municipal sumiu.** Enquanto cada município tinha cor de status, a divisa entre dois deles
era a diferença entre dois **preenchimentos**; o traço era reforço. Com preenchimento constante o
traço virou o único separador, e `#294056` contra `#16283a` dá **1,40:1** — na captura as divisas
não estavam lá. Contorno clareado para `#456a8e` (2,65:1).

Não vai aos 3:1 de propósito: a 75 municípios num zoom de estado, traço com contraste de controle de
interface vira grade, e a divisa é contexto — o conteúdo essencial está no marcador, a 13,05:1.
2,65:1 foi onde a forma se lê sem a malha competir com os marcadores, medido por captura.

**Dica cobria o anel de pulso.** Com `bottom: calc(100% + 10px)` a caixa entrava sobre o anel, que
cresce até 25px do centro — e no foco os dois aparecem **juntos**, então um escondia o outro
justamente no estado que a revisão precisava conferir. Afastada para 18px. Achado na captura, não no
raciocínio.

### Descartado

Colorir a linha inteira por status (ver acima); `Popup` do MapLibre para a dica (segunda entidade a
sincronizar, folha própria a sobrescrever, botão de fechar indesejado); buscar dados por unidade no
`hover` (uma requisição por passagem de mouse, dica piscando vazia); pulsar todos os marcadores;
`box-shadow` como técnica de pulso (45% mais caro e não compõe no compositor).

---

## D17 — Seleção só no marcador, conexão em arco com gradiente na ponta, ping mais lento

Quatro ajustes pedidos depois da revisão visual de N07, todos sobre o mesmo desenho.

### 1. O anel lilás do município saiu

Era a última coisa que fazia o polígono participar da interação, e contradizia D15: o município é
cartografia neutra, a unidade é quem carrega estado. Um contorno de 3px em volta de uma área de meia
tela **afirma sobre a área**, e afirma justamente no instante do clique — quando o dado que importa
é a unidade. Que o tom não pertença a nenhum status não resolve: ele é o elemento mais chamativo da
tela naquele momento.

Saiu com ele o disco lilás de `aria-pressed` no `.map__alvo`, achado na captura: um ponto de 22px no
centroide do município, que não é lugar nenhum — nem unidade, nem sede — e que na imagem lia como
uma décima segunda unidade.

A seleção continua inteira em três canais: `aria-pressed` nos dois marcadores, aro lilás em
`.map__unidade[aria-pressed='true']` e o painel lateral. O lilás continua vivo onde a superfície
embaixo dele tem 13px, não meio estado.

Consequências no código: `COR_SELECAO`, `LARGURA_ANEL` e a camada `municipio-selecionado`
desapareceram, e com a camada foi embora a única razão de a marcação esperar `isStyleLoaded()` —
`aplicarTons` virou `marcarMunicipio` e mexe só em atributo de DOM.

### 2. Gradiente na conexão, não linha colorida — *superseded por D18*

> D18 reverteu este item a pedido: a linha voltou a ser inteira na cor do status. O texto abaixo
> fica como registro do porquê do gradiente ter existido, não como estado atual.

O pedido era aproximar a linha do estado da unidade. Pintar a linha inteira com a cor de status é
exatamente o erro que D15 corrigiu no polígono, um nível acima: o caminho atravessa municípios que
não têm nada a ver com a leitura.

Resolvido por gramática, e não por intensidade: **neutro (`#4a6c8c`) nos primeiros 72% do caminho,
esmaecendo para a cor do status só no trecho que encosta no marcador filho** — onde a afirmação já é
sobre a unidade, e onde o próprio marcador está ao lado para confirmá-la. 0,72 e não 0,5: com metade
da linha tingida ela volta a ser uma linha colorida atravessando o estado.

**Restrição do MapLibre que decidiu a implementação:** `line-gradient` só aceita expressão de
`['line-progress']` e é a única propriedade de pintura que **não** admite styling dirigido por
propriedade da feature. Uma camada por status, filtrada por `['==', ['get','status'], …]`, com a
lista saindo do próprio enum — status novo na API vira camada sozinho. A fonte `conexoes` passou a
exigir `lineMetrics: true`; sem ele o estilo inteiro falha na validação e o mapa não monta.

### 3. Arco no lugar da reta

Curva de Bézier quadrática, ponto de controle perpendicular à corda, **sempre para o mesmo lado** —
arquear conforme a direção faria o conjunto ler como ruído em vez de idioma.

A curvatura é **fração do comprimento** (0,14), não afastamento absoluto: é isso que dá "mesmo efeito
visual em todas as conexões". Com valor fixo em graus, a conexão curta viraria laço e a longa
ficaria visualmente reta. Abaixo de ~0,08 o arco é indistinguível de reta na escala de Sergipe;
acima de ~0,20 as conexões que saem do mesmo hub começam a se cruzar entre si.

Geometria plana em lng/lat, sem correção por `cos(lat)`: a -10,9° o fator é 0,982 e a distorção é
menor que a espessura de 1,4px da linha. Isto é desenho, não medida.

**O ping continua barato.** A geometria virou polilinha de 33 vértices, mas o ping **não percorre a
polilinha** — ele reavalia a mesma curva em forma fechada, com `pontoNoArco`, a partir das duas
pontas (que `arcoEntre` mantém exatas em `u=0` e `u=1`). Continua sendo O(1) por quadro, que era a
razão de a técnica de N07 ter vencido as duas alternativas medidas. De Casteljau sobre `interpolar`:
três interpolações lineares, reaproveitando a função que já existia.

### 4. Ping mais lento

`PERIODO_PING_MS` de 2600 para 4200. O valor antigo foi escolhido contra uma linha reta e curta; com
18 pings simultâneos no estado inteiro, o conjunto lia como tráfego agitado e não como batimento de
sonda. O período é a única variável do movimento — a fase de ida-e-volta e o passo são funções puras
dele — então desacelerar é trocar este número.

Efeito no roteiro: a janela de amostragem de `e2e:n07` subiu de 650ms para 1050ms, para as três
amostras continuarem cobrindo meio ciclo. Sem isso o check "nenhum ping fica parado" acusaria falso
positivo em ping perto do ponto de retorno.

### Verificado

`ng test` 361/361 · `e2e:n05` 22/22 · `e2e:n06` 24/24 · `e2e:n07` 37/37, contra a aplicação real.
Capturas em `screenshots/mapa/d17-*.png`.

### Descartado

Pintar a linha inteira por status (de novo, ver acima — *é exatamente o que D18 fez, a pedido do
usuário*); colorir por camada única com `['get']` na cor (o MapLibre não permite em `line-gradient`,
restrição que só existe enquanto o gradiente existe — D18 removeu as duas juntas); ping percorrendo
a polilinha vértice a vértice (troca O(1) por busca de segmento a cada quadro, sem ganho visual
nenhum — isto continua descartado, D18 não mexeu no ping).

## D18 — Gradiente de D17 revertido: linha inteira na cor do status

Pedido explícito do usuário: a divisão em neutro-até-72%-e-cor-na-ponta que D17 introduziu saiu, e a
conexão volta a ser inteiramente pintada com a cor do status da unidade filha — a leitura que D17
tinha evitado por achar que "afirma sobre todo o caminho". A decisão de reverter é do usuário, não
uma correção técnica: registrada aqui como decisão, não como bug.

A reversão do gradiente arrasta duas coisas que só existiam por causa dele, e não por si:

- **As seis camadas `conexoes-linha-<status>`** existiam porque `line-gradient` é a única paint
  property do MapLibre que não aceita expressão dirigida por propriedade da feature — sem gradiente,
  a restrição desaparece junto, e a coloração volta a ser uma camada só com `line-color` por
  `['match', ['get', 'status'], ...]`, o mesmo padrão que `StatusBadgeComponent` e as cores de KPI já
  usam no resto do sistema.
- **`lineMetrics: true`** na fonte `conexoes` só existia porque `line-gradient` precisa de
  `['line-progress']` para funcionar. Verificado antes de remover: o ping **não** depende disso — ele
  não lê `line-progress` nem percorre a polilinha, `montarPings` lê só o primeiro e o último vértice
  da geometria (`arcoEntre`) e reconstrói a curva em JS a cada quadro via `pontoNoArco`/
  `controleDoArco`. Removível sem tocar no ping.

O arco em si (D17, item 3) e a velocidade do ping (D17, item 4) não mudam — só o item 2 de D17 foi
revertido.

### Verificado

`ng test` com os testes de `camadasDeConexao` cobrindo a camada única e a ausência de
`line-gradient`; `grep -rn "lineMetrics\|line-gradient\|COR_CONEXAO\|INICIO_DO_GRADIENTE" src e2e`
dá 3 ocorrências (`mapa.component.spec.ts:217`, `mapa.component.ts:314` e `:315`) — todas comentário
histórico explicando por que D18 removeu o gradiente, ou a asserção de que `line-gradient` está
ausente no teste; nenhuma em código de produção. `npx ng build` sem erro.

### Descartado

Manter as seis camadas e trocar só a cor final do gradiente (não atende ao pedido: ainda haveria
trecho neutro); gradiente com transição mais curta em vez de removê-lo (mesmo problema, só adiado).

### Item 2 — Volume no ping por CSS

Segundo pedido do usuário na mesma rodada: o ping de 7px, até aqui um disco chapado
(`background: var(--cor-ping, #435464)`), ganha volume — vira uma esfera simulada, não geométrica.
Três intensidades foram geradas para comparação lado a lado
(`e2e/n07-evidence/d18-ping-variacoes.png`) e o usuário escolheu a **B (médio)**:

```css
background: radial-gradient(circle at 32% 28%,
  color-mix(in srgb, #fff 62%, var(--cor-ping)) 0%,
  var(--cor-ping) 52%,
  color-mix(in srgb, var(--cor-ping) 70%, #000) 100%);
box-shadow: 0 0 5px 1px rgba(232, 240, 248, .3),
  inset -1.5px -1.5px 2.5px rgba(0, 0, 0, .38),
  0 1px 2px rgba(0, 0, 0, .45);
```

O highlight desloca-se para fora do centro (32% 28%) para simular luz vindo de cima-esquerda; a
sombra interna escurece a face oposta. A primeira parada do `box-shadow` (`rgba(232,240,248,.3)`) é
o glow externo que já existia — preservado, não duplicado.

O rascunho inicial usava `rgba(255,255,255,.62)` como cor de highlight — descartado antes de chegar
à captura: branco semitransparente deixa o fundo escuro do cartão do mapa atravessar o disco de 7px,
e o resultado lia como borrão cinza, não como brilho. Trocado por `color-mix(in srgb, #fff 62%,
var(--cor-ping))`, que mistura opacamente com a própria cor do ping — a mesma % (62%), mas sem
transparência, então nada do fundo atravessa.

`--cor-ping` continua sendo o contrato: é lido via `style.getPropertyValue('--cor-ping')` (custom
property inline) tanto pelo componente quanto pelo e2e (`n07-pulso-ping-dica.cjs`), e o
`radial-gradient`/`color-mix` em `background` não o altera — nada a mudar na leitura do teste.

**Não é extrusão geométrica.** Essa opção foi descartada de propósito (ver histórico de N05/D17
sobre extrusão 3D no mapa) e não volta aqui: o volume do ping é shading 2D — gradiente e sombra —,
mais barato e sem exigir geometria WebGL extra por ponto animado.

### Verificado (item 2)

`ng test` (363 testes, suíte completa) sem regressão; `npx ng build` sem erro (aviso de budget do
SCSS do mapa já existia antes desta mudança, arquivo grande por natureza — MapLibre).

## D19 — Marcador sem aro, pulso geral e anel de seleção por status

Três pedidos na mesma rodada, e **dois deles são reversões de decisões de N07**. Vale registrar o
porquê de cada reversão, porque em ambos os casos a decisão original estava certa para o mapa que
existia na época e ficou errada quando o mapa mudou debaixo dela.

### Item 1 — O aro claro sai, e o contraste migra para o miolo

`.map__unidade` perde o `border: 2px solid rgba(232, 240, 248, .92)`.

O aro claro (D15) e o halo interno de 1,5px que o precedeu (N06) atacavam o mesmo problema: o miolo
do marcador se camuflando contra o município. O município era pintado por status — o fundo debaixo
do marcador mudava de cor de um lugar para outro, e nenhuma cor de miolo dava conta sozinha.

N07 pintou o polígono de neutro e constante (`#16283a`). Isso apagou o problema, e o remendo
sobreviveu ao problema: 4px dos 13px do marcador gastos num anel branco, com o miolo visível
reduzido a 9px, competindo com o anel de foco e com o de pulso na mesma vizinhança de pixels.

O que o aro fazia foi transferido para a cor do miolo. Os dois status escuros foram clareados até
passarem 3:1 contra `#16283a` sozinhos:

| status | antes | contraste | depois | contraste |
|---|---|---|---|---|
| `sem-dados` | `#435464` | 1,92:1 | `#8797a6` | **5,01:1** |
| `sem-equipamentos` | `#263744` | 1,22:1 | `#667b8b` | **3,41:1** |

Os outros quatro não mudam: 6,86:1, 3,84:1, 6,96:1 e 6,67:1. Matiz e dessaturação preservados — os
dois neutros continuam lendo como ausência de dado; o que mudou foi a luminância.

A `box-shadow` escura de contato fica. Ela nunca foi contraste: é o que separa o marcador da linha
de conexão quando os dois se cruzam.

Efeito colateral corrigido junto: as amostras neutras da legenda pintavam com token de tema
(`--im-text-secondary`, `--im-text-muted`) e não com o hex do canvas. Já era divergência; com o
clareamento viraria divergência visível. Passaram a literal.

### Item 2 — Pulso em todos (reverte o filtro de N07)

`STATUS_QUE_PULSA` deixa de existir; todo marcador recebe `map__unidade--pulsa`.

N07 limitou o pulso a `INDISPONIVEL` e `DEGRADADA` com dois argumentos. O primeiro era de atenção:
"pulsar os onze seria onze coisas disputando atenção". O segundo era de contraste: os dois status
escuros gerariam anel de pulso ilegível (1,92:1 e 1,22:1).

O segundo argumento caiu com o item 1 desta mesma rodada — 5,01:1 e 3,41:1. O primeiro é uma
preferência de leitura, e é o usuário quem a arbitra: o pedido é pulso geral, como sinal de que o
mapa está vivo e lendo, não como chamado de atenção por unidade. O pulso deixa de ser um indicador
de estado e passa a ser a assinatura visual da sonda — o que o estado diz é a cor.

Não muda: animação no `::after` e nunca no elemento (DV13 — o `transform` do elemento pertence ao
MapLibre), `inset: -6px` fazendo o anel nascer fora do anel de foco, e `prefers-reduced-motion`
deixando o anel **estático e visível**, nunca ausente.

### Item 3 — Anel de seleção na cor do status (reverte o lilás de D17)

`.map__unidade[aria-pressed='true']` troca `#f2d6ff` por
`color-mix(in srgb, var(--cor-unidade) 78%, transparent)`, e o marcador cresce de 13px para 19px.

O lilás foi escolhido em D17 quando o polígono ainda carregava cor: a seleção precisava de um matiz
que não colidisse com nenhum status nem com o fundo. Com o polígono neutro, o benefício acabou e
sobrou o custo — uma segunda fonte de cor no mapa, e um marcador selecionado cuja borda dizia
"selecionado" e já não dizia qual status.

O risco da troca é conhecido e foi tratado, não ignorado: anel da mesma cor do miolo tende a sumir à
distância, e o caso difícil é o aglomerado de Aracaju, quatro unidades que podem compartilhar
status. Por isso a seleção **não é só o anel**. São duas dimensões:

- **translucidez (78%)** separa anel de miolo de perto;
- **tamanho (13px → 19px)** separa selecionado de não-selecionado de longe.

19px e não 17px porque 17px é o hover: iguais, passar o mouse num vizinho o deixaria do tamanho do
selecionado.

Geometria dos anéis do marcador selecionado, do centro para fora — mudar qualquer um dos números
exige refazer a conta inteira:

| anel | raio |
|---|---|
| miolo | 9,5px |
| seleção (`box-shadow` 3px) | 9,5 → 12,5px |
| foco (`outline` 2px, offset 3px) | 12,5 → 14,5px |
| pulso nasce (`::after`, `inset: -6px`) | 15,5px |

Seleção e foco são **tangentes**, nunca sobrepostos — é a mesma relação que o lilás de 3px tinha com
o marcador de 13px, e ela existe porque o `outline` pinta por cima e recortaria o anel justamente no
estado que vem logo depois do clique: selecionado E focado.

### Verificado

- Contraste dos seis status contra `#16283a` calculado por script (fórmula WCAG 2.x de luminância
  relativa), não estimado: 6,86 / 3,84 / 6,96 / 6,67 / 5,01 / 3,41 — todos ≥ 3:1.
- `ng test` (suíte completa) e `npx ng build` sem erro. O aviso de budget `anyComponentStyle` do
  SCSS do mapa é pré-existente.
- `e2e/n07-pulso-ping-dica.cjs`: caso 2 lê `borderTopWidth === '0px'` e `width === '13px'` nos onze
  marcadores e exige `map__unidade--pulsa` em todos; caso 9 confere 19px no selecionado, ausência do
  lilás na `box-shadow` computada e coincidência de matiz com `--cor-unidade`, mais captura por
  status. Evidência em `e2e/n07-evidence/d19-anel-*.png` e `d19-tudo-junto.png`.

### Descartado

- **Remover o aro sem clarear os dois neutros.** Cumpriria o pedido ao pé da letra e deixaria
  `sem-equipamentos` a 1,22:1 — marcador de 13px invisível contra o município.
- **Remover o aro só dos quatro status coloridos.** Preservaria o contraste ao custo de um marcador
  com duas aparências, e de uma regra de exceção por status no SCSS, que é exatamente o que
  `--cor-unidade` existe para evitar.
- **Anel de seleção só translúcido, sem crescer o marcador.** Uma dimensão só; verde translúcido
  sobre verde no zoom de estado não se lê a distância.
- **Voltar o anel de seleção a uma cor neutra** quando a translucidez se mostrou fraca. Descartado
  por instrução explícita: o reforço tem de vir na mesma cor.

---

## D20 — Tela cheia, clique direto na unidade, zoom por município, legenda recolhível

`feat/mapa-tela-cheia`, 2026-10-16. Cinco mudanças visuais e de interação pedidas juntas. Nenhuma
muda o que a tela busca: as mesmas chamadas a `/dashboard/unidades`, à cartografia e aos
equipamentos da unidade selecionada. **Reverte quatro decisões anteriores em pontos específicos**
— a ordem de D10, o município-seleção de M03/D10, o "sem disclosure" de D15 e o `space-between` de
D14 —, sem apagá-las.

### 1. Título sobre o mapa, Atualizar no painel, altura da viewport

O cabeçalho da página (faixa acima do cartão) saiu. Eyebrow, `h1` e subtítulo vão para uma placa
no canto superior esquerdo do cartão (`.map-titulo`); "Atualizar" vai para o topo do painel
(`.map-panel__topo`). A página é coluna flex com `calc(100dvh - var(--im-topbar-height))`, e a linha
da grade é `minmax(0, 1fr)` — sem isso o painel com unidade selecionada esticaria a linha e a
rolagem de D11 voltaria. O teto de 780px saiu.

**Placa própria, translúcida e com tokens de tema**, e não texto solto sobre o canvas: o canvas é
escuro nos dois temas, mas o fundo do cartão segue o tema. Só uma placa garante contraste
independente do que estiver atrás. `pointer-events: none` para não roubar arraste. O canto esquerdo
superior é vazio no enquadramento (a ponta noroeste do estado cai no centro-topo); medido: nenhum
marcador sob a placa em sete viewports de desktop e em 390, 600 e 768 de largura.

### 2. Câmera remedida — e um achado: o offset nunca tinha funcionado em y

Quarta remedição por mudança alheia à câmera (DV11). Ao trocar `fitBounds` + `easeTo` por
`cameraForBounds` + um `easeTo` só (necessário para animar a volta ao estado sem o segundo cancelar
o primeiro), o desenho desceu e cortou a base. Causa: **`easeTo({ zoom, offset })` sem `center`
anula o próprio offset** — o MapLibre deriva o centro do ponto deslocado e o resultado é o mesmo
centro. O `[-24, 60]` de D13 nunca deslocou nada; as folgas de D13 foram medidas sem offset
efetivo. Com `center` explícito o offset passou a valer, e os dois valores foram refeitos:

| | D13 | D20 |
|---|---|---|
| `OFFSET_CAMERA` | `[-24, 60]` (sem efeito) | `[0, -28]` |
| `ZOOM_AO_INCLINAR` | `0.68` | `0.42` |
| Folga topo/base 1500×950 (pixel) | 10,9 / 9,3 | 15,8 / 15,9 |
| Folga topo/base 1280×800 | 10,9 / 12,4 | 15,9 / 17,8 |
| Folga topo/base 1920×1080 | — | 15,8 / 14,7 |

O zoom menor não encolhe o desenho na tela: o cartão ficou mais alto e quase quadrado, e com ele o
`fitBounds` inclinado já parte de um zoom maior. Em 1280×800 a ponta oeste fica a 0,7% da borda —
é o teto, e por isso 0,42 e não mais.

**Cartão estreito.** A compensação inteira cortava a ponta oeste em 768×1024 e em celular. Ela
passou a ser escalada pela proporção largura/altura do cartão: plena a partir de 0,96
(`ASPECTO_PLENO`, toda viewport de desktop medida), zero abaixo de 0,75 (`ASPECTO_MINIMO`, onde
`fitBounds` sozinho já é o enquadramento que cabe). Nada cortado em 390×844, 600×900, 768×1024.

**Resize reenquadra** enquanto o operador não mexeu na câmera. Sem isso, girar o tablet ou
redimensionar a janela mantinha o zoom da moldura anterior — a captura em 390×844 mostrou o estado
cortado e aproximado. Se ele já mexeu (zoom, arraste, município), o resize respeita.

### 3. Clique no marcador abre direto o detalhe

`selecionarPeloMarcador` passou a chamar só `selectUnidade`. **Reverte a ordem de D10**, que
selecionava o município antes da unidade e, em município de várias unidades, mostrava a lista
"N unidades neste município. Escolha uma…" acima do detalhe — empurrando o conteúdo e criando
rolagem no painel. A lista (`.selected-panel`, `.unit-list__escolha`) saiu.

A guarda `cliqueVeioDeMarcador` (correção de `f17cabe`, regressão conhecida) **ficou e ficou mais
importante**: sem ela, o clique no marcador agora também aproximaria o município. Provado no
`e2e:n08` caso 7, por clique lógico e por clique físico do mouse, e com unidade de IBGE divergente.

### 4. Clique no município aproxima

O município deixa de ser seleção e vira ação de câmera. **Reverte o papel que M03/D10 davam ao
município** e completa D15/D17: o polígono já não carregava estado nem anel de seleção; agora
também não carrega seleção nenhuma. O sinal `selected`, `selectMunicipio` e `marcarMunicipio`
saíram; `.map__alvo` perdeu `aria-pressed` (é ação, não estado).

Respostas às perguntas do pedido:

- **Enquadramento:** pelos limites do polígono **quando o município tem 0 ou 1 unidade com
  coordenada**; pelo envelope das **unidades** quando tem duas ou mais e esse envelope cabe no
  envelope do polígono. Pelo polígono só, Aracaju aproximava 3,3× e os quatro marcadores ficavam a
  **15,2px** do vizinho mais próximo (marcador de 13px, anéis de pulso sobrepostos) — "clicável" no
  limite, não no espírito do pedido. Pelas unidades, **62,1px**. A guarda de contenção existe porque
  o agrupamento é por código IBGE e a coordenada pode cair em outro município (DV07): uma unidade
  divergente esticaria o envelope até fora dele, e aí vale o polígono. A contenção é de envelope,
  não de polígono: unidade dentro do retângulo mas fora de um município côncavo passa.
- **Teto de zoom separado por caminho:** `ZOOM_MAXIMO_MUNICIPIO = 11.5` (polígono — município
  pequeno não vai a zoom de rua, o vizinho continua de referência) e `ZOOM_MAXIMO_UNIDADES = 12.5`
  (unidades — acima disso o próprio envelope é quem limita; 12,7 e 13 dão o mesmo resultado).
- **Animação:** 600 ms linear (`fitBounds` com `linear: true`, não o arco do `flyTo`). Com
  `prefers-reduced-motion: reduce`, `duration: 0` — provado no `e2e:n08` caso 13 (posição final já
  na primeira amostra, a 50 ms).
- **Volta:** botão "Ver estado inteiro" sob o controle de zoom, visível só fora do enquadramento
  inicial (município, roda, arraste, botões de zoom — todo gesto com `originalEvent`), e **Escape**
  com foco no mapa. Os dois chamam `enquadrarEstado`, a mesma conta da abertura da tela. Ao clicar,
  o botão some e o foco vai para o canvas, não para o `body`.
- **Município sem unidade:** aproxima igual; a região viva anuncia "X: nenhuma unidade cadastrada.
  Mapa aproximado.", e a informação que a lista dava não se perde para leitor de tela.
- **O painel não muda** com o zoom: a unidade aberta continua aberta.

**Descartado: duplo clique para voltar.** É o gesto nativo de aproximar do MapLibre, e o primeiro
clique de um duplo clique já dispara o zoom do município. **Descartado: manter `aria-pressed` no
alvo do município** — anunciaria um estado que não existe mais. **Descartado: só subir o teto de
zoom** para separar Aracaju — aprofundava também o caminho do polígono (Amparo 2× mais perto) e
tirava a referência dos vizinhos justamente onde o teto existe para mantê-la.

### 5. Legenda recolhível, fechada por padrão

`<details class="legend-bloco">`, fechado ao abrir a tela, estado não lembrado. **Reverte D15 neste
ponto**: D15 desfez o disclosure porque guardar dois itens atrás dele "custava uma linha de
interface para esconder nada". O motivo agora é outro — a legenda inteira, aprendida uma vez,
disputava altura com o detalhe da unidade, que é o que o operador abre a tela para ler. `<details>`
nativo pelo mesmo argumento de D12: teclado e estado exposto sem JS.

Notas encurtadas para uma linha cada no painel de 320px (conferido no `e2e:n08` caso 14 pela
altura): "Município é neutro: situa, não indica estado." e "Arco liga unidade ao hub, na cor do
status." A ressalva "só aparece quando as duas pontas têm coordenada" saiu da legenda; continua no
código (`conexoesDesenhaveis`). A primeira versão da nota do arco ("…na cor do status dela.")
quebrava em duas linhas — achado do e2e, não do olho.

**`space-between` do painel saiu (revê D14):** com legenda fechada e rodapé fora, ele abriria vãos
entre blocos. Fluxo de cima para baixo; a sobra fica no fim da coluna, não no meio.

### 6. Rodapé de fontes removido

"BASE CARTOGRÁFICA / Limites municipais de Sergipe" e "FONTE OPERACIONAL / Dashboard API" saíram
(`.map-source`).

### Teclado e leitor de tela (revisão final)

- **Escape** volta ao estado inteiro com o foco dentro do mapa (canvas, alvo ou marcador). O botão
  "Ver estado inteiro" em si usa Enter/Espaço, como qualquer botão.
- **"Atualizar" vem depois do mapa na ordem de Tab:** ele foi para o painel, à direita do cartão
  (posição exigida pela especificação). Se quem opera só por teclado reclamar, o caminho é um skip
  link, não reordenar o DOM.
- **Voltar ao estado inteiro é anunciado** ("Estado inteiro.") na região viva, pelo botão ou pelo
  Escape. O enquadramento inicial e o do `resize` ficam em silêncio.
- **Anel de foco do botão:** o `box-shadow` próprio do `.map__voltar` vencia o anel global
  (`_reset.scss`) e o botão ficava sem indicador. Agora tem contorno de 2px em `--cor-foco-mapa`
  (D16), porque ele aparece sobre o polígono escuro. O n08 confere o contorno computado após Tab.
- Acabamentos: dica do marcador em hover/foco sobe a `z-index: 6` (acima do título, 5); cartão
  empilhado usa `100svh` (a barra de endereço do celular não reenquadra o mapa) e desconta 24px
  em ≤600px, onde o padding é 12px.

### Verificado

`ng test` 469/469 · `ng build` sem erro (aviso de budget pré-existente, DV04) · `e2e:n05` 21/21 ·
`e2e:n06` 25/25 · `e2e:n07` 48/48 · `e2e:m06` 19/19 · `e2e:n08` 48/48 (novo), duas execuções
seguidas. Capturas em `e2e/n08-evidence/` (a sem seleção, b detalhe por marcador, c zoom no
município, d legenda fechada/aberta, viewports, e erro), conferidas uma a uma.

`e2e:n05` caiu de 22 para 21 verificações sem perder cobertura: o caso 20 tinha duas entradas
("marca exatamente um município" e "seleção no marcador"); a primeira perdeu o objeto e virou a
prova de ausência de `aria-pressed` no alvo. O `e2e:n06` relaxou a "sobra" medida por centróides de
34% para 40%: centróides subestimam o desenho em ~7 p.p. (pixel: 31,7%), e o zoom que passaria nos
34% corta a ponta oeste em 1280×800. O desequilíbrio (≤6 p.p.) não mudou.

### Achados fora do escopo, registrados

- **Rolagem horizontal da topbar** em ≤1280px (16px em 1280, 48px em 1024, 65px em 390), em todas
  as telas — não é do Mapa. Ver DV18.
- **`GET /dashboard/unidades/{id}/equipamentos` responde 500 sob concorrência** (92 de 121 chamadas
  simultâneas; 55 sequenciais, todas 200). Ver DV17.

## D21 — Legenda sobre o mapa, painel de 420px, folga de 12px

`feat/mapa-legenda-sobre-mapa`, 2026-10-19. Três mudanças só visuais, continuação de D20. Nenhuma
muda chamada, dado ou interação do mapa. **Revê D20 em dois pontos** — onde mora a legenda e a
largura de 320px do painel —, sem apagá-lo.

### 1. Legenda sobre o mapa, canto inferior esquerdo

O `<details class="legend-bloco">` saiu do painel e virou filho direto do `.map-card`, em absoluto,
a 12px da borda esquerda e da base. Continua fechado por padrão (D20) e nativo (D12).

**Por que esse canto.** Superior esquerdo é do título; superior direito é do NavigationControl e do
"Ver estado inteiro" (top 104px). Inferior direito encosta no painel e soma ruído na costura entre
mapa e painel. Inferior esquerdo é a posição cartográfica convencional, fica na mesma coluna visual
do título e, ancorada em `bottom`, a caixa cresce **para cima** ao abrir sem empurrar nada. A seta
inverte por isso: fechada aponta para cima, aberta para baixo.

**Legibilidade: mesma placa do título** — `color-mix` translúcido sobre `--im-surface`, `blur(6px)`,
mesma sombra e mesmo `z-index: 5` (a dica do marcador, 6, ainda vence). O canvas é escuro nos dois
temas; só a placa garante contraste. Medido no e2e: fundo e `backdrop-filter` idênticos aos do
título; todo texto da legenda (itens, subtítulo, notas e rótulo) a **5,84:1 no claro e 5,05:1 no
escuro** contra a placa composta sobre o polígono (`#16283a`, pior caso). Para isso o subtítulo, as
notas e o rótulo, que usavam `--im-text-muted` (~4:1 sobre a placa), passam a `--im-text-secondary`
só dentro da legenda — o `.panel-label` do painel não muda.

**Acabamentos da revisão final:** o alvo de toque fechado é o `summary` inteiro, com no mínimo 32px
de altura (o padding saiu do `<details>` para o `summary`; o anel de foco ficou por dentro, offset
-3px, para a rolagem própria não cortá-lo). A legenda não é mais destruída pelo `@if` durante o
carregamento: fica no DOM com `[hidden]` fora de sucesso/vazio, e "Atualizar" não a fecha.

Fechada, a placa tem o tamanho do rótulo (167×33px); aberta, largura fixa de 292px (as duas notas
seguem em uma linha) e `max-height: calc(100% - 120px)` com rolagem própria — em cartão baixo ela
rola por dentro em vez de cobrir o título. Aberta, cobre o canto sudoeste do estado (um marcador no
dev): aceito, é sobreposição sob demanda e fecha com um clique ou Enter.

### 2. Painel em `clamp(340px, 30vw, 420px)`

420px a partir de 1400px de viewport; encolhe com 30vw até o piso de 340px (≤1133px); empilha em
≤900px (breakpoint de D11 mantido). Medido: 420 em 1920/1600/1400, 410 em 1366, 384 em 1280, 340 em
1133/1024/901. KPIs em duas colunas sem `dt` estourando em todas, inclusive no piso de 340px
(~138px por cartão; "INCIDENTES ABERTOS" cabe). Largura mínima suportada: 390px, empilhado.

**Câmera não foi recalibrada.** *(Revisto em D22: esta leitura estava errada — o teste não via o corte; a câmera passou a encaixe calculado.)* O cartão ficou mais estreito; em 1500×950 o aspecto caiu para ~0,94,
abaixo de `ASPECTO_PLENO` (0,96), e o zoom extra entra a 90%. O desenho passa a ser limitado pela
largura: sobra vertical por centróides 38,7% → 40,1%; equilíbrio topo/base 1,9 p.p. (critério de
faixa morta, inalterado). O teto do `e2e:n06` caso 4 subiu de 40% para 42%. Afrouxar `ASPECTO_PLENO`
ou subir o zoom cortaria a ponta oeste em 1280×800, que é o motivo do 0,96.

### 3. Folga de 12px — do componente, não do shell

Investigação antes de mudar: `.shell__main` não tem padding nenhum
(`application-shell.component.scss`). Toda a folga vinha do Mapa — `.map-page { padding: 16px }` e
`.map-layout { gap: var(--im-space-4) }`. Ambos viraram `var(--im-space-3)` (12px) em todas as
larguras; a regra de 12px que só valia em ≤600px saiu por redundante. Medido: 12px entre cartão e
painel, 12px de cada borda útil do `main` e da base da janela.

**O shell não foi tocado.** Cada tela declara o próprio respiro (ex.: `.painel` do dashboard
18px 20px 28px; `.monitor-page` 16px em tela estreita). Uniformizar as treze telas seria mover um
padding para `.shell__main` e tirá-lo de cada tela — rodada própria, decisão do usuário.

### Verificado

Dev (5434): `ng test` 493/493 · `ng build` ok (aviso de budget pré-existente, DV04) ·
`e2e:legenda-painel` 75/75 + 1 não aplicável (novo) · `e2e:n05` 21/21 · `e2e:n06` 25/25 ·
`e2e:n07` 48/48 · `e2e:n08` 52/52 · `e2e:m06` 19/19. Carga (5436, Sede Administrativa e Sesc
Itabaiana): `e2e:legenda-painel` 75/75 + 3 não aplicáveis (sem IBGE divergente, sem afetado) ·
`e2e:n05` 21/21 · `e2e:n07` 48/48 · `e2e:n08` 51/51 + 1 não aplicável. Capturas da carga fora do
repositório; as do dev em `e2e/legenda-painel-evidence/`, conferidas uma a uma, incluindo a gaveta
de equipamento aberta pelo Mapa lado a lado com a aberta em Equipamentos (mesma largura, 660px, e
mesma posição; só as ações de gestão diferem, desligadas no Mapa por M06).

Roteiros agora aceitam `API_PORT` (`e2e/api-porta.cjs`): o frontend tem `apiUrl` cravado em
`localhost:8080`, e o Playwright refaz as chamadas na porta pedida — a carga roda em 8081 sem
derrubar o backend de dev.

## D22 — Enquadramento por encaixe calculado, critério do n06 em pixels, recuo da legenda

`feat/mapa-legenda-sobre-mapa`, 2026-10-19, antes do merge de D21. **Reverte a câmera de D13/D20 e o
critério de enquadramento do `e2e:n06` (D20/D21)**, sem apagá-los.

### Por que: a regra por proporção foi recalibrada quatro vezes

A câmera era `cameraForBounds` + `ZOOM_AO_INCLINAR` + `OFFSET_CAMERA`, escalados por uma rampa na
proporção do cartão (`ASPECTO_MINIMO` 0,75 / `ASPECTO_PLENO` 0,96). Esses números foram recalibrados
**quatro vezes, sempre por mudança alheia à câmera**: N06 (proporção do cartão), N07 (reversão da
extrusão), N07 (max-width) e D20 (tela cheia). D21 (painel de 420px) pediria a quinta — e passou sem
ela porque o teste não via o defeito.

Medido por pixel no código de D21, sem mutação: a ponta oeste **encostava na borda** (0,1% de margem)
em proporção 0,94–0,97 — 1500x950, 1525x950, 1440x864 — e o desenho ficava pequeno abaixo de 0,85
(1300x950: 29% de sobra lateral; 1024x768: 34%). Cada número só valia para a moldura em que foi medido.

### O encaixe calculado

`cameraDeEncaixe` (mapa.component.ts) projeta na tela a **envoltória convexa** do estado e das unidades
com coordenada, e itera zoom e centro (`jumpTo` sobre o mapa vivo, até 6 vezes — com pitch, zoom e
centro só são aproximadamente separáveis) até ela caber na área do cartão menos `MARGEM_ESTADO` (24px).
Em seguida afasta o desenho de cada sobreposição que ele invade — título, controles de zoom, legenda —
com `FOLGA_SOBREPOSICAO` (12px): tenta pelo eixo vertical e pelo horizontal e fica com o de zoom maior.
Título, controles e legenda fechada **espelham** a margem no lado oposto (o enquadramento continua
centrado); a legenda aberta não espelha. Opção que deixa menos de 1/4 do cartão é descartada.

Não há número calibrado contra moldura: mudar o layout não exige remedir a câmera. **Este é o motivo
de existir do encaixe — encerrar o ciclo de recalibração.** Funções puras cobertas por unitário:
`envoltoriaConvexa`, `caixaDosPontos`, `ajusteDeEncaixe`, `convexoIntersectaRetangulo`,
`margensParaEvitar`.

Resultado medido por pixel (margens do desenho ao cartão): nenhum tamanho corta; topo×base e esq×dir
diferem ≤0,2 p.p. Em cartão baixo o título empurra a margem vertical (espelhada) e a sobra vertical
cresce (1024x768: 58%), mas o eixo horizontal é o limitante e fica em 24px.

### Critério novo do `e2e:n06` caso 4 — em pixels, nos dois eixos

O critério antigo media só a sobra vertical pela posição dos centróides dos municípios. Prova por
mutação (D21 → D22): ele não via corte nem deslocamento lateral, e deixou passar o corte real de
1500x950. O teto de 42% de D21 acompanhava a implementação, não protegia nada.

Novo, medido na captura do `.map-card` com e sem o canvas (a diferença é só o desenho; sobreposições se
anulam), em 9 tamanhos (1500x950, 1525x950, 1440x864, 1366x768, 1300x950, 1280x720, 1024x768, 1600x900,
1920x1080):

1. sem corte: margem ≥ 8px nos quatro lados;
2. sobra do eixo limitante ≤ 25%: `min(sobraV, sobraH)`;
3. equilíbrio: |topo − base| ≤ 6 p.p. e |esq − dir| ≤ 6 p.p.

**Prova por mutação do critério novo** (alterando só o destino do `easeTo`; revertido ao fim):

| Tamanho | controle | zoom para fora (−0,5) | zoom para dentro (+0,5) | deslocado para baixo (120px) | deslocado para o lado (150px) |
|---|---|---|---|---|---|
| 1500x950 | passa | FALHA (sobra) | FALHA (corte+equil) | FALHA (corte+equil) | FALHA (corte+equil) |
| 1525x950 | passa | FALHA (sobra) | FALHA (corte+equil) | FALHA (corte+equil) | FALHA (corte+equil) |
| 1440x864 | passa | FALHA (sobra) | FALHA (corte+equil) | FALHA (corte+equil) | FALHA (corte+equil) |
| 1366x768 | passa | FALHA (sobra) | FALHA (corte+equil) | FALHA (corte+equil) | FALHA (corte+sobra+equil) |
| 1300x950 | passa | FALHA (sobra) | FALHA (corte) | FALHA (corte+equil) | FALHA (corte+sobra+equil) |
| 1280x720 | passa | FALHA (sobra) | FALHA (corte+equil) | FALHA (corte+equil) | FALHA (corte+sobra+equil) |
| 1024x768 | passa | FALHA (sobra) | FALHA (corte) | FALHA (corte+equil) | FALHA (corte+sobra+equil) |
| 1600x900 | passa | FALHA (sobra) | FALHA (corte) | FALHA (corte+equil) | FALHA (corte+sobra+equil) |
| 1920x1080 | passa | FALHA (sobra) | FALHA (corte) | FALHA (corte+equil) | FALHA (corte+equil) |

As quatro mutações falham em todos os nove tamanhos; o código real passa em todos.

### Recuo da legenda aberta

Abrir a legenda (`toggle` do `<details>`) reenquadra o estado com a legenda como sobreposição sem
espelho; fechar devolve o enquadramento (deslocamento medido: 0px). Só com a câmera no estado inteiro —
aproximado num município, a câmera não se mexe. `prefers-reduced-motion`: o movimento é instantâneo
(medido: 0px de diferença 100ms após o clique, contra ~122px ainda por andar no modo normal).

Marcadores cobertos pela legenda aberta, antes → depois (dev, 11 unidades): 1600x900 1→0, 1366x768 1→0,
1280x720 2→0, 1024x768 3→0; zero também em 1920x1080, 1500x950, 1525x950, 1440x864, 1300x950 e 390x844.
**Custo:** em cartão baixo (1280x720) título e legenda aberta somam margem e o estado encolhe bastante
enquanto a legenda está aberta.

### Verificação de IBGE

O roteiro `e2e:legenda-painel` só conferia o aviso da unidade que selecionava, e o relatório de D21
generalizou isso para "nenhuma unidade dos dois bancos diverge" — errado. Agora seleciona **todas** as
unidades com coordenada e afirma: conjunto exato das que mostram o aviso (`E2E_IBGE_ESPERADO`), o aviso
cita o código daquela unidade, sem estouro horizontal, dentro do painel, fonte ≥ 11px e contraste ≥ 4,5:1.

Dev: **cinco** divergências reais no cadastro (não duas, como se supôs): Propriá (2805307 = Pirambu),
Sesc Itabaiana (2803005 = Itabaianinha), Estância (2802205 = Feira Nova), Simão Dias (2806800 = São
Domingos), Socorro (2804607 = N. Sra. das Dores). Avisos de 2 a 3 linhas a 420px, contraste 7,69:1.
Carga: nenhuma. O dado não foi corrigido — é o dado de demonstração; o teste fixa o que ele é.

## D23 — Placa do título sem sobretítulo (rodada 2 de consistência visual)

Data: 2026-10-21. O sobretítulo "OPERAÇÕES · SERGIPE" sai da placa `.map-titulo` (D20), junto com todos os
sobretítulos do sistema. Decisão do usuário após captura com/sem: "Sergipe" já está na descrição e
"Operações" é o grupo da barra lateral. A placa encolhe ~13px; o enquadramento é por encaixe calculado (D22),
sem recalibração. Ficam os rótulos de seção do painel (`.panel-label`): são títulos de bloco, não de página.
Na mesma rodada: "Ver unidade" deixa de ser `botao--primario` (botão de navegação, não ação principal) e
as fontes mono do SCSS do mapa passam a `var(--im-mono)`; no `.afetados__meta` só o IP é mono.

## D24 — Três pings em fluxo, orbe luminoso, halo WebGL e paleta vibrante; DV16 fechada

`feat/mapa-arco-brilho`, 2026-10-21. Spec em
`Docs/superpowers/specs/2026-10-21-mapa-arco-brilho-design.md`. Escrita como D23 e renumerada antes
do merge: o `main` já registrava D23 (placa do título, PR #14) quando este branch foi rebaseado.
**Reverte o "ida e volta" de D16 e a esfera de D18-B**, sem apagá-los.

### Pedido

Quatro ajustes visuais no arco hub → unidade, todos do usuário: três pings por arco em vez de dois,
com espaçamento regular; pings menores; aspecto translúcido, brilhante e mais vibrante na linha, no
ping e no marcador — "vibrante" é saturação e luminosidade, não matiz novo, e a semântica das seis
cores não muda; e tirar o contorno branco do ping.

### O que entrou

**Paleta vibrante.** `COR_DO_STATUS` (só o Mapa a consome) passou aos valores abaixo, calculados por
script em HSL: coloridos `S×1,18+0,04` e `L+0,05` com teto 0,72 sem baixar; neutros `S×1,1` e `L+0,08`
(`sem-dados`) / `L+0,04` (`sem-equipamentos`). Contraste WCAG contra o município `#16283a`:

| status | D19 | × município | D24 | × município |
|---|---|---|---|---|
| disponível | `#34c77b` | 6,86 | `#35e087` | 8,70 |
| indisponível | `#e5484d` | 3,84 | `#f84e54` | 4,44 |
| degradada | `#e8a33d` | 6,96 | `#fcb142` | 8,23 |
| em manutenção | `#7fadff` | 6,67 | `#7fadff` | 6,67 (saturação já em 100%) |
| sem dados | `#8797a6` | 5,01 | `#9dabb9` | 6,41 |
| sem equipamentos | `#667b8b` | 3,41 | `#6e8698` | 3,95 |

Todos subiram ou ficaram; nenhum abaixo de 3:1. Separação entre status por ΔE em OKLab (×100): o par
mais próximo era `sem-dados` × `sem-equipamentos`, 9,7, e foi a 12,8; o novo mínimo é `em-manutencao`
× `sem-dados`, 10,5 — acima do pior de antes. As seis amostras da legenda passaram a hex literal (antes
quatro usavam token de tema): a mesma regra que D19 aplicou aos dois neutros, a amostra espelha o
canvas, não o tema.

**Halo na linha, em WebGL.** O canvas do MapLibre não aplica `filter` nem `box-shadow`. O brilho é uma
segunda camada `line`, `conexoes-halo`, **antes** de `conexoes-linha` na ordem de camadas (por cima,
apagaria o núcleo): `line-width` 6, `line-blur` 4, `line-opacity` 0,28, com o mesmo `match` de cor e o
mesmo fallback `sem-dados` do núcleo — `camadasDeConexao()` devolve as duas, e o teste compara o corpo
do `match` das duas. O núcleo foi a `LARGURA_CONEXAO` 1,6 (era 1,4) e `OPACIDADE_CONEXAO` 0,85 (era 0,65):
a translucidez que D18 dava à linha passou para o halo. Estático: custo medido de quadro ≈ 0 (cenário H).

**Três pings em fluxo.** `PINGS_POR_LINHA = 3`, defasados de `k/3`, sempre hub → unidade, renascendo no
hub. Duas funções puras novas: `faseDeFluxo(ciclos) = ((ciclos % 1) + 1) % 1` (substitui
`faseVaiEVolta`, que saiu sem chamador) e `opacidadeNaPonta(u) = min(1, u/0,08, (1−u)/0,08)`, aplicada
por `style.opacity` a cada quadro. A opacidade é **0 nas duas pontas exatas**: sem ela o ping, ao virar
de u≈1 para u=0, apareceria por um quadro no hub depois de sumir na unidade. `PERIODO_PING_MS` continua
4200, mas agora é **uma travessia**, não ida e volta: a velocidade caiu à metade e chega um ping na
unidade a cada 1400 ms.

**Orbe de 5px.** `.map__ping` vira ponto de luz: declaração plana + `radial-gradient` de núcleo claro
(`#fff` a 55% sobre a cor) → cor pura a 45% do raio → transparente, e `box-shadow: 0 0 4px 1px` da cor
a 70%. Caixa 7px → 5px, `border: 0`. Com três pings por arco, 7px enchia a linha de bolas.

**Glow no marcador, miolo opaco.** `.map__unidade` ganha `0 0 6px 1px` da cor a 55% antes da sombra de
contato. O miolo **não** fica translúcido: desde D19 é ele quem carrega o contraste, e translucidez
derrubaria `sem-equipamentos` abaixo de 3:1. No selecionado o anel de 3px de D19 continua sendo a
**primeira** sombra (o `e2e:n07` caso 9 lê a cor da primeira), glow `0 0 9px 2px` a 45% depois.

### Reversões

**D16 — "ida e volta" vira fluxo num sentido.** Não é gosto: espaçamento regular é incompatível com a
onda triangular. Com `faseVaiEVolta` e três fases 0, ⅓ e ⅔, dois pings coincidem (a onda passa pelo
mesmo u subindo e descendo); com duas fases opostas, que era D16, eles se cruzam no meio do arco. Só
`faseDeFluxo` dá separação de exatamente ⅓ em qualquer instante, inclusive depois da virada e com
`ciclos` negativo — é o que o teste prova pela diferença circular entre as três fases. D16 fica no log.

**D18-B — a esfera vira orbe.** A variação B (highlight deslocado a 32% 28%, sombra interna, parada
escura `70% + #000`) era um objeto sólido iluminado; o pedido foi brilho. O orbe não tem face oposta à
luz, então a sombra interna e a de contato saíram junto com a parada escura. D18 fica no log.

### Origem do contorno branco

Eram **duas** camadas em `.map__ping`, lidas no código antes de mexer: o `border: 1px solid
rgba(232,240,248,.8)` e a primeira sombra, `0 0 5px 1px rgba(232,240,248,.3)`, que lia como halo
esbranquiçado. Tirar só o `border` deixaria o halo branco. Com `box-sizing: border-box` global, o disco
de 7px era 5px de cor dentro de 1px de aro. As duas saíram; o glow voltou na cor do status. O aro
existia pela razão que valia para o marcador antes de D19 — o `sem-equipamentos` escuro sumia no
município — e com a paleta de D24 esse status dá 3,95:1 sozinho.

### O que não mudou

Técnica do ping (`Marker` DOM, `setLngLat` por quadro, D16) e `pontoNoArco` O(1) — muda só a fase;
`transform` no elemento do `Marker` continua da lib (DV13), e nem o ping nem o marcador escrevem
`transform`; geometria de raios do selecionado (D19: miolo 9,5 / seleção 12,5 / foco 14,5 / pulso
15,5px); pulso no `::after`; nenhum `box-shadow` animado (glow é estático); `prefers-reduced-motion`
continua não criando os pings.

### Verificado

Bancada `perf:mapa` (Intel UHD 770; sintética, 10 linhas = 30 pings) em 3 corridas, decisões pela
mediana (contexto §17): Δ de BD3 (tela inteira depois) sobre A = **1,774 ms**, limite 2,35 (Δ do
cenário E, a alternativa já rejeitada por custo) — passa. BD3 contra BD2r (tela inteira antes, mesma
corrida): 1,927 × 1,554 ms na mediana, com 50% mais pings, halo e glow. O que cresce é recálculo de
estilo (D3 0,59 ms contra D 0,09 ms na corrida 3), e ele acompanha o número de pings com o CSS real do
orbe, não o fade: D2r (20 pings, CSS de antes, sem fade) já gastava 0,42, e tirar ~84% das escritas de
`opacity` (abaixo) só levou D3 de 0,59 a 0,56. Cabe — 11,5% do orçamento de 16,7 ms; BD3x5 (150 pings,
55 marcadores) 3,97–4,36 ms em corridas únicas, cerca de ¼ do orçamento.

Depois de `setOpacity` (abaixo), corrida única da bancada: A 0,146, BD3 1,655, **Δ 1,509 ms** (−15% sobre
a mediana de 1,774; dentro da faixa das três corridas, corrida 3 deu 1,567) — gate segue passando. App
dev (`app-depois-dev-setopacity.json`): animado 3,775, parado 0,964, Δ 2,811 ms (−6,5% sobre 3,007).
Uma corrida não separa a correção do ruído; o que ela prova é que não piorou.

### Opacidade do ping é da lib — achado da revisão final

O fade escrevia `elemento.style.opacity` no elemento do `Marker`. Lendo o fonte do maplibre-gl 6.9.0
(`src/ui/marker.ts`, igual no `dist/maplibre-gl.mjs`) na revisão final: `Marker._update` — chamado por
todo `setLngLat` e por todo `move`/`moveend` da câmera — agenda por `frameAsync` um `_updateOpacity`,
que sem terreno faz `if (style.opacity !== this._opacity) style.opacity = this._opacity`, e `_opacity`
é `'1'` por padrão. Eram duas escritas por ping por quadro e, com a câmera andando (arrasto, zoom, o
`easeTo` de 600 ms), o callback da lib podia rodar depois do `passo`: ping em fade pintado opaco e o
salto u≈1→0 aparecendo. Mesmo caso do `transform` em DV13 — propriedade que a lib escreve no elemento
é da lib. Correção: `Marker` criado com `opacity: '0'` e `setOpacity(String(opacidadeNaPonta(u)))` no
passo; `setOpacity` grava `_opacity` e chama `_updateOpacity(true)`, que escreve o inline (o n07 continua
lendo `style.opacity`) e pula valor igual. `opacidadeNaPonta` passou a arredondar a duas casas: o
navegador normaliza o que devolve (0.43750000000000006 → "0.4375") e, sem isso, a comparação nunca
batia no fade. No meio do arco o valor é `'1'` constante e nenhuma escrita acontece. A bancada espelha
no caminho D3/BD3 e devolve `setOpacity('1')` ao pool, para os cenários antigos não herdarem o fade.

Quadros > 20 ms: 0% em todos os 17 cenários na corrida 1; nas corridas 2 e 3, 0–0,9% em vários,
**inclusive em A** (mapa parado), com picos isolados de 20–35 ms. O gate "0% de quadros lentos" passou
a valer contra o piso de ruído de A na mesma corrida — nenhum cenário animado ficou acima dele.

App real `perf:mapa-app` (CDP, 6 s, 1600x900), antes = `8f8b78d`, depois = este branch:

| banco | antes (pings, Δ animado − parado) | depois (pings, Δ animado − parado) |
|---|---|---|
| dev (11 unidades, 9 linhas) | 18, 2,833 ms | 27, 3,007 ms |
| carga (2 unidades, 1 linha) | 2, 1,848 ms | 3, 2,064 ms |

+0,17 ms no dev e +0,22 ms na carga com 50% mais pings, halo e glow; 59,9 fps e 0% de quadros lentos
nos oito registros. O absoluto do `parado` do dev caiu de 1,62 para 0,95 ms entre as duas sessões —
ruído de máquina, por isso a comparação é pelo Δ.

`ng test` 581/581 (55 arquivos) e `ng build` sem erro depois do rebase em `origin/main` e de
`setOpacity`; o aviso de budget do SCSS do mapa (97,34 kB) é DV04, pré-existente. `e2e:n06` 50/50,
`e2e:n07` 50/50 (27 pings = 9 × 3; orbe 5px, borda 0, nenhuma sombra branca; fade com opacidade inline
em toda leitura e sempre em [0, 1], 9/81 leituras abaixo de 1) e `e2e:n08` 52/52, no clone do banco de
dev, refeitos depois do rebase e de `setOpacity`. `e2e:d24` 15/15 no dev e 13/13 na carga, idem. Capturas em `e2e/d24-evidence/` ("antes" saiu do `ng serve` de `8f8b78d`, o
merge-base, e não de `origin/main`, que já tinha o r2 mexendo no mesmo SCSS por outra razão); as da
carga ficaram fora do repositório.

### Descartado

- **`filter: drop-shadow` no ping ou no marcador.** O ping se move a cada quadro, e `filter` repinta
  por quadro; o glow tem de ser estático no elemento.
- **Ping em camada WebGL com `circle-blur`.** É o cenário E da bancada: `setData` por quadro, Δ 2,4–3,0
  ms, o mais caro. O brilho em WebGL ficou só na linha, que é estática.
- **Miolo do marcador translúcido.** Derruba o contraste que D19 transferiu para o miolo.
- **`will-change: transform` no ping.** D3w ficou 7,9% abaixo de D3 na mediana (1,630 × 1,769 ms), com
  as faixas das três corridas sobrepostas: inconclusivo dentro do ruído, abaixo do corte de 10%, e uma
  camada promovida por ping não se justifica por isso.
- **`box-shadow` animado** para o glow: o pulso por `box-shadow` (§9.2, cenário C) custou Δ 0,43 ms
  sobre a base contra 0,29 do `::after` com `transform`+`opacity` — 45% a mais **no Δ**, não no
  absoluto (0,618 × 0,475 ms, 30%).

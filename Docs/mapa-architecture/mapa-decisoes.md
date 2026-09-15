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

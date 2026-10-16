# Mapa — dívidas em aberto

Nada aqui está quebrado a ponto de impedir uso. Tudo aqui foi decidido conscientemente, e a decisão
tem prazo de validade.

---

## DV01 — Zoom BRASIL/REGIÃO é decorativo
**Origem:** M05.

Os níveis de zoom acima do estado existem na interface mas não mudam o que é mostrado: toda unidade
cadastrada está em Sergipe, e a cartografia carregada é só a de Sergipe.

**Quando cobrar:** na primeira unidade fora de Sergipe. Aí o controle passa a prometer algo que a
cartografia não entrega, e é preciso decidir entre carregar a malha de outros estados sob demanda ou
remover os níveis.

---

## DV02 — `AuthStateService` sem persistência de sessão
**Origem:** A03. **Já mordeu automação real pelo menos duas vezes.**

A sessão vive só em memória. Qualquer `page.goto` depois do login cai em `/login?returnUrl=...`, e
todo roteiro e2e é obrigado a navegar por clique — inclusive o N06 desta rodada, que repete a
advertência no cabeçalho pela terceira vez.

Custo para o usuário, não só para o teste: **deep link compartilhável abre e derruba a sessão**. Um
link para `/unidades/7` mandado a um colega o joga no login e perde o destino.

**Por que continua aberta:** é mudança de autenticação, com implicação de segurança (onde guardar o
token, por quanto tempo, o que fazer no logout de outra aba). Não entra de carona numa rodada de
mapa.

---

## DV03 — +15 nós residuais por visita ao Mapa
**Origem:** M02.

Cada visita à rota do Mapa deixa ~15 nós para trás. A direção é de melhora em relação ao que era
antes, mas **não é zero**: uma sessão de plantão que alterne entre telas o dia inteiro acumula.

**Quando cobrar:** se aparecer queixa de degradação em sessão longa, ou antes disso se alguém for
mexer no ciclo de vida do mapa por outro motivo.

---

## DV04 — Aviso de budget permanente em `mapa.component.scss`
**Origem:** N05 (D04). **Custo aceito, não defeito.**

A folha do componente tem 94,95 kB contra os 6 kB do `anyComponentStyle`, porque carrega o CSS do
MapLibre via `meta.load-css` — que é justamente o que mantém esses bytes **fora do bundle inicial**.
O erro do budget foi elevado para 100 kB para o build passar.

**O risco real:** o aviso é permanente, então um estouro *novo* e legítimo nessa folha passa
despercebido no meio do ruído. Quem mexer no SCSS do mapa não pode confiar no budget como rede.

---

## DV05 — Cinco roteiros e2e antigos não rodam em clone limpo
**Origem:** anterior a N04.

`r034`, `r035`, `r036`, `r043`, `r045` dependem de uma instalação global do Playwright. Só `n04`,
`n05` e `n06` foram formalizados com script em `package.json` e dependência em `devDependencies`.

**Consequência:** a suíte e2e do repositório é parcial e ninguém sabe disso olhando a pasta — os
cinco arquivos estão lá, parecendo executáveis.

**Quando cobrar:** ao formalizar o próximo roteiro, converter os cinco de uma vez; ou removê-los, se
o que cobriam já estiver coberto em outro lugar.

---

## DV06 — `numero_serie` nulo nos 220 equipamentos do banco de dev
**Origem:** busca de equipamentos.

O campo é buscável na tela, mas não há um único valor preenchido no banco de dev. A busca por série
"funciona" e nunca retorna nada — indistinguível de busca quebrada.

**Candidato natural:** o mecanismo de `db/dev-seed/` criado nesta rodada (D09) resolve isso com um
`02-equipamentos-serie.sql`.

---

## DV07 — `cidade` é texto livre e diverge do código IBGE
**Origem:** cadastro de unidades.

`cidade` é digitada à mão; `codigo_ibge` é referência da cartografia. As duas podem discordar, e o
mapa acredita no código. `uf` já foi unificada; `cidade` ficou.

---

## DV08 — `PUT /unidades/{id}` não distingue "ausente" de "limpar"
**Origem:** gaveta de unidades.

No `PUT` da unidade, campo ausente é gravado como nulo. Atinge `latitude`, `longitude` e atingia a
conexão — só a conexão ganhou contorno, com recurso próprio (D05).

**Efeito nesta rodada:** foi o motivo de o seed de coordenadas ser SQL direto e não chamada de API
(D09). A dívida não foi paga; foi contornada mais uma vez.

---

## DV09 — Marcador de unidade não desempata sobreposição em zoom baixo
**Origem:** N06, esta rodada.

As quatro unidades de Aracaju ficam a 30 px umas das outras no enquadramento padrão. Dá para
distinguir e clicar. Em zoom mais fechado, melhora; em estado com mais unidades por município, ou
com duas unidades no mesmo quarteirão, os marcadores se sobrepõem e o de cima ganha o clique.

**Não resolvido de propósito:** clustering muda o que o mapa mostra (um marcador que não é uma
unidade) e é decisão de produto, não ajuste. Fica registrado para quando o dado exigir.

**Nota (D20), não fecha a dívida:** o desempate passou a existir **por interação**. Clicar no
município aproxima, e município de várias unidades enquadra as próprias unidades: em Aracaju o
vizinho mais próximo vai de 15,2px (zoom pelo polígono) para 62,1px, e o clique físico abre cada uma
das quatro (`e2e:n08` caso 9). No zoom de estado elas continuam a ~30px. Clustering continua sendo
a resposta se o dado crescer — duas unidades no mesmo quarteirão empatam mesmo aproximadas, porque o
teto `ZOOM_MAXIMO_UNIDADES` (12,5) para antes da escala de rua.

---

## DV10 — Contagem de equipamentos perdeu o sinal ambiente no mapa
**Origem:** N07 (D13). **Decidido, não esquecido.**

A altura do bloco codificava "equipamentos monitorados no município" direto no desenho. Com a
extrusão fora, esse número só aparece **sob demanda**: KPI "Equipamentos" ao selecionar a unidade, e
a contagem na lista de município com várias unidades. Olhar o mapa não diz mais onde está a massa
de equipamentos.

**Descartado por ora:** número dentro do polígono (75 municípios em zoom de estado viram ruído
tipográfico) e escala de tamanho no marcador de unidade (colide com a leitura de status, que é a
função do marcador).

**Quando cobrar:** se aparecer pedido concreto de "onde está a maior concentração" que hoje obrigue
a clicar município por município. Aí a pergunta é qual canal — coroa proporcional no marcador,
coluna na lista, ou um modo de visualização alternativo — e não ressuscitar a extrusão.

**Nota (D20):** a "contagem na lista de município com várias unidades" saiu junto com a lista — o
clique no marcador abre direto a unidade. Sob demanda, o número agora está no KPI do painel e no
`aria-label` do marcador. O sinal ambiente ficou mais fraco, não mais forte.

---

## DV11 — Folga vertical de ~20% no cartão do mapa
**Origem:** N07 (D13).

O enquadramento é limitado pela **largura**: Sergipe deitado a `bearing -18` enche a largura do
cartão antes de encher a altura. Sobram ~10% de altura em cima e ~10% embaixo, equilibrados — não é
faixa morta (que é sobra concentrada de um lado), é proporção entre a forma do estado e a do cartão.

**Quando cobrar:** se o cartão mudar de proporção outra vez, ou se a cartografia deixar de ser só
Sergipe (ver DV01). Nos dois casos, `ZOOM_AO_INCLINAR` e `OFFSET_CAMERA` têm de ser **remedidos**,
nunca herdados — é a terceira vez que esses dois valores mudam por mudança alheia a eles.

**Nota (D20) — quarta remedição.** O cartão passou a ocupar a altura da viewport e ficou quase
quadrado; a folga vertical subiu para ~16% em cima e embaixo, equilibrada. E a remedição achou que
o `OFFSET_CAMERA` em y nunca tinha agido (`easeTo` com offset e sem `center` se anula): valores em
vigor `[0, -28]` e `0.42`, agora escalados pela proporção do cartão (zero abaixo de 0,75). Ver D20.


---

## DV12 — Tokens de mapa órfãos em `_tokens.scss`
**Origem:** N07 (D15).

`--im-map-water`, `--im-map-land`, `--im-map-land-alt`, `--im-map-stroke` e `--im-map-active` são
herança do mapa em SVG anterior a M04. O último consumidor real eram as amostras
`.legend__dot--none` e `.legend__dot--multiple`, que saíram com a coloração de município. Hoje só
`--im-map-glow` é usado (fundo do `.map-card`). Os outros cinco continuam definidos nos dois temas.

**Não removidos nesta rodada de propósito:** `_tokens.scss` é arquivo compartilhado por todo o
sistema, e a mudança pedida era do Mapa. São ~10 linhas mortas, custo zero em runtime.

**Quando cobrar:** na próxima limpeza de tokens, ou se alguém for tentado a reusar um deles achando
que ainda descreve o mapa atual — não descreve. O canvas WebGL **não lê variável CSS**: as cores do
mapa são hex literais em `mapa.component.ts` (`COR_DO_STATUS`, `COR_MUNICIPIO`,
`COR_CONTORNO_MUNICIPIO`), e é lá que elas vivem.

---

## DV13 — `transform` no elemento do `Marker` é código morto — **RESOLVIDA (D16)**
**Origem:** N07, achado na investigação do pulso (ver `mapa-contexto-atual.md` §9.3). **Medido.**
**Fechada na mesma rodada**, por decisão da revisão: mesma causa raiz do pulso, resolver separado
seria mexer duas vezes no mesmo seletor.

O MapLibre reescreve `element.style.transform` do `Marker` a cada reposicionamento
(`maplibre-gl-dev.mjs:27832`). Estilo inline vence regra de folha de autor, então estas três
declarações em `mapa.component.scss`, escritas em N06, **nunca aplicaram**:

```scss
.map__unidade            { transition: transform .12s ease; }
.map__unidade:hover      { transform: scale(1.25); }
.map__unidade[aria-pressed='true'] { transform: scale(1.15); }
```

Confirmado por medição: com `.u:hover{transform:scale(1.25)}` ativo, o `transform` computado no
hover é **idêntico** ao de repouso (`matrix(1,0,0,1,669.5,440.5)`). O hover e a seleção funcionam
hoje só pelo que **não** é `transform` — `border-color` e `box-shadow`.

**Como foi corrigido (D16).** A regra tem dois lados, e a correção usou os dois:

- **Pulso** → `::after`. Pseudo-elemento tem `transform` próprio, intocado pelo inline do pai.
- **Hover e seleção** → `width`/`height`, não pseudo-elemento. O que se queria ali era o **elemento**
  maior, e largura funciona porque o `translate(-50%, -50%)` da própria lib é relativo ao tamanho:
  o marcador cresce centrado sozinho e o `outline` de foco acompanha a caixa. Um `::before` a
  crescer teria colidido de raio com o anel de foco e com o anel de pulso, que já disputam os
  mesmos ~15px.

As três declarações mortas (`transition: transform`, `:hover { scale(1.25) }`,
`[aria-pressed] { scale(1.15) }`) saíram do arquivo.

**Travado por teste:** `e2e:n07` caso 3 verifica que a matriz de `transform` do elemento nunca ganha
componente de escala (`matrix(1, 0, 0, 1, …)` antes e durante o hover) e que é a **largura** que muda.
Caso 2 verifica que o `animation-name` está no `::after` e é `none` no elemento.

**Regra geral que fica:** no elemento de um `Marker`, `transform` pertence à lib. O que precisar de
`transform` vai num pseudo-elemento ou filho; o que precisar do elemento maior usa caixa, não escala.

---

## DV14 — Dica de relance entrega 3 dos 7 campos da referência
**Origem:** N07 (D16). **Decidido, não esquecido.**

A imagem de referência da revisão traz nome, status, latência, disponibilidade, monitores,
incidentes abertos e última verificação. A dica entrega **nome, status e incidentes abertos** —
os três que existem em `DashboardUnidade`, o payload único que alimenta o mapa inteiro.

Os outros quatro não faltam por esquecimento: **a referência é um cartão de equipamento e o
marcador é de unidade.** Latência e última verificação só existem por equipamento
(`DashboardEquipamento.ultimaMedicao`); monitores só em `DashboardUnidadeDetalhe`, que é uma
requisição por unidade; disponibilidade percentual só em `/relatorios/disponibilidade/unidades`, e
depende de janela de período.

**Descartado:** buscar por unidade no `hover` — onze requisições em passagem de mouse, com a dica
piscando vazia enquanto a resposta não chega. E trazer disponibilidade do módulo de relatórios,
que reabriria a divergência de janela que a lista de Unidades já teve de acertar.

**Quando cobrar:** quando houver pedido concreto de ver latência ou última verificação sem clicar.
Aí o caminho é **ampliar `DashboardUnidade`** no read-model do backend (latência agregada,
monitores ativos, última verificação), não somar requisições no front — uma chamada continua
servindo o mapa inteiro.

---

## DV15 — Aglomerado de Aracaju piora com o anel de pulso
**Origem:** N07 (D16). Agrava [DV09](#dv09--marcador-de-unidade-não-desempata-sobreposição-em-zoom-baixo).

DV09 registrou que as quatro unidades de Aracaju ficam a ~30px e o marcador de cima ganha o clique.
O anel de pulso cresce até **25px do centro**, então nos marcadores do aglomerado os anéis se
sobrepõem, e um marcador que pulsa pode cobrir visualmente o vizinho parado.

Medido de lado, e não de propósito: o `e2e:n07` bateu nisso na primeira execução — `.first()` caiu
num marcador coberto e o `hover` do Playwright estourou depois de 56 tentativas. O roteiro passou a
escolher o marcador mais isolado por distância real, porque o aglomerado não é o que ele mede.

**Não resolvido aqui pelo mesmo motivo de DV09:** a saída é clustering, que muda o que o mapa
mostra (um marcador que não é uma unidade) e é decisão de produto.

**Quando cobrar:** junto com DV09. Se vier antes, o paliativo barato é reduzir o raio final do
pulso de `scale(2)` para `scale(1.6)` — encolhe a sobreposição sem tirar o sinal.

**Nota (D19):** o pulso deixou de ser seletivo — hoje **todos** os marcadores pulsam, inclusive os
quatro do aglomerado de Aracaju ao mesmo tempo. A frase "um marcador que pulsa pode cobrir
visualmente o vizinho parado" descrevia um cenário misto que não existe mais: não há mais vizinho
parado, os quatro anéis se cruzam sempre. A dívida **permanece aberta** — o problema não some, fica
mais frequente — e o paliativo (`scale(1.6)`) continua válido.

---

## DV16 — Stop escuro do ping quase apaga o disco em `sem-equipamentos`
**Origem:** D18 (volume por CSS no ping), achado na revisão final.

O stop escuro do `radial-gradient`, `color-mix(in srgb, var(--cor-ping) 70%, #000)`, se aplica aos
seis status por igual. Para `sem-equipamentos` (#263744), a borda do disco cai para ≈#1a2730 contra
o município #16283a — o contraste do par, já registrado em 1,22:1 no código (o mesmo par miolo × mapa
que [DV15](#dv15--aglomerado-de-aracaju-piora-com-o-anel-de-pulso) cita para o marcador), vai para
≈1,05:1. O ping passa a ler como anel vazio, salvo pelo aro claro de 1px.

A variação foi escolhida sobre uma captura do banco de dev, onde só existem conexões `DISPONIVEL` e
`DEGRADADA` — os dois tons mais claros da paleta. O caso `sem-equipamentos` não apareceu na
comparação que decidiu os números.

**Não resolvido aqui de propósito:** os valores do gradiente (`32% 28%`, `#fff 62%`, `52%`, `70%`, as
três sombras) são decisão do usuário sobre captura comparativa, e não serão alterados sem ele ver uma
nova comparação com os seis status forçados.

**Quando cobrar:** antes de qualquer conexão real chegar a `sem-equipamentos` em produção, ou na
próxima rodada de captura comparativa do ping — force os seis status e leve esse par ao usuário.

**Nota (D19), não fecha a dívida:** a cor-base de `sem-equipamentos` (`COR_DO_STATUS`, a mesma fonte
de `--cor-ping`) mudou de `#263744` para `#667b8b` — ver [D19](mapa-decisoes.md#d19--marcador-sem-aro-pulso-geral-e-anel-de-seleção-por-status).
O par miolo × mapa que esta dívida citava (1,22:1) virou 3,41:1. Isso muda o insumo do
`color-mix(in srgb, var(--cor-ping) 70%, #000)` que esta dívida mede, mas o **stop escuro do
gradiente em si não foi remedido** nesta rodada — não há número novo para o par disco × mapa depois
do `color-mix`. Continua **aberta** até a próxima captura comparativa, agora com a cor-base já
clareada.

---

## DV17 — Equipamentos da unidade respondem 500 sob concorrência
**Origem:** D20, achado do `e2e:n08` na primeira execução. **Backend, fora do escopo do Mapa.**

`GET /dashboard/unidades/{id}/equipamentos?size=200&sort=nome` — a chamada que o painel faz ao
selecionar uma unidade — devolveu 500 (`INTERNAL_ERROR`, "Erro interno do servidor") em 92 de 121
chamadas disparadas ao mesmo tempo; as mesmas 55 chamadas em sequência deram 200. Depende de
concorrência, não de unidade. A causa não foi lida: o log do backend em execução não estava
disponível. Hipótese a conferir primeiro: esgotamento do pool (`DB_POOL_SIZE`).

**Na tela:** cada clique de marcador faz uma chamada e descarta a resposta fora de ordem, então o
uso normal não chega perto disso; clicar rápido em vários marcadores pode mostrar "Não foi possível
consultar os equipamentos desta unidade" com "Tentar novamente".

**Quando cobrar:** antes da carga real, ou na primeira queixa de painel de unidade falhando.

---

## DV18 — Topbar estoura a largura em ≤1280px
**Origem:** D20, medido pelo `e2e:n08`. **Layout compartilhado, fora do escopo do Mapa.**

Rolagem horizontal do documento: 16px em 1280, 48px em 1024, 65px em 390 — em todas as telas, não
só no Mapa (reproduzido em `/dashboard`). Causa: os itens da topbar (relógio, chips, botão de sair)
não encolhem. O `e2e:n08` prova que o Mapa em si não estoura (`.map-page` e `.shell__main` com
excedente horizontal 0) e registra o do documento como pré-existente, sem falhar.

**Quando cobrar:** na próxima rodada de layout do shell, ou antes de uso em tablet.

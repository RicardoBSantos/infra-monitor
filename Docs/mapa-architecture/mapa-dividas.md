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

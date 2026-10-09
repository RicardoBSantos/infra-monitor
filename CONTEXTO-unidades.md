# Contexto — Redesign da área de Unidades

Documento de referência para a implementação. Leia inteiro antes de tocar em código.

---

## 0. Regras de escopo

Diferente das tarefas anteriores, **backend está liberado** — mas apenas para os itens
listados na seção 7. Nada além disso.

- Proibido alterar regras de negócio de monitoramento, cálculo de status operacional,
  resolver de disponibilidade ou lógica de ICMP.
- Proibido remover ou renomear campos/endpoints existentes. Só adição.
- Toda migration deve ser aditiva e não destrutiva.
- Antes de editar: mapear os endpoints existentes, listar arquivos que pretende tocar,
  apresentar plano e **esperar OK**.
- Os dados dos screenshots são mockados. Ignore valores, nomes e códigos —
  use apenas como referência de layout, hierarquia e comportamento.

### Tokens visuais
Já consolidados em `src/styles/_ui.scss` na tarefa anterior. Reutilize as primitivas
existentes (`.botao`, `.kpi`, `.pill`, `.aba`, `.ponto`, utilitários `.mono` etc.).
**Atenção ao budget de SCSS por componente (8 kB).** Se precisar de estilo novo
compartilhado entre a lista e o detalhe, promova para o global em vez de duplicar.

### Componente existente
`features/unidades/unidade-detalhe.component` foi criado na tarefa A3 como uma versão
mínima. **Este trabalho expande esse componente, não cria outro.** A rota
`painel/unidades/:id` permanece.

---

## 1. Decisões de produto (já tomadas, não questionar)

| Tema | Decisão |
|---|---|
| Ação Excluir | **Mantida** na lista administrativa |
| Abas Todos/Ativos/Inativos | **Removidas** |
| Unidade inativa | Sem filtro próprio; aparece na lista com linha esmaecida + chip "Inativa" |
| Ação em unidade inativa | "Desativar" vira "Ativar" |
| Paginação | 20 itens por página |
| Sidebar | **Fora de escopo.** Não alterar navegação nem adicionar itens |
| Agendar manutenção | Botão placeholder desabilitado (ver seção 6) |
| Endereço, UF, Lat, Long | Adicionar ao cadastro (ver seção 7) |
| Descrição | **Manter.** O mockup omitiu, mas o campo existe e está em uso |

---

## 2. Lista administrativa (`/unidades`)

Substitui a tela atual de tabela + formulário inline.

### Cabeçalho
- Título "Unidades"
- Subtítulo: "Locais físicos monitorados pela plataforma. Todo equipamento pertence
  a exatamente uma unidade."
- Botão primário "+ Nova unidade" à direita

### Barra de busca
- Input "Buscar unidades por nome, código ou cidade"
- Busca em memória sobre a página carregada, sem refetch a cada tecla
- Contador à direita: "{n} de {total} unidades"
- **Sem abas de status administrativo**

### Tabela
Colunas, nesta ordem:

`UNIDADE · CÓDIGO · CIDADE · ENDEREÇO · STATUS · EQUIPAMENTOS · DISPONIBILIDADE · INCIDENTES · AÇÕES`

- CÓDIGO em fonte mono
- STATUS é **operacional** (ONLINE / DEGRADADO / OFFLINE / MANUTENÇÃO), não administrativo.
  Reutilizar o badge de status já existente. O estado MANUTENÇÃO depende do enum
  `EM_MANUTENCAO` (tarefa B2) — se ainda não estiver mergeado, trate como pendência
  e não quebre a tela.
- EQUIPAMENTOS, DISPONIBILIDADE e INCIDENTES: números em mono, alinhados à direita.
  Incidentes > 0 em vermelho.
- Linha de unidade inativa: opacidade reduzida + chip "Inativa" ao lado do nome.
  Status operacional dessa linha exibe "—".

### Ações por linha
Três ações, como botões pequenos (não links de texto soltos):
- **Ver** → navega para `painel/unidades/{id}`
- **Desativar** / **Ativar** → conforme o estado atual
- **Excluir** → destrutivo (ver abaixo)

### Confirmação de ações destrutivas — obrigatório
- **Excluir** exige modal de confirmação nomeando a unidade e informando a quantidade
  de equipamentos vinculados. Botão de confirmação em tom destrutivo.
  Se o backend impede exclusão com equipamentos vinculados, exiba a mensagem real
  da API, não uma genérica.
- **Desativar** exige confirmação explicando a consequência: interrompe o
  monitoramento ICMP dos N dispositivos e suprime alertas do Telegram; o histórico
  é preservado.
- Reativar não precisa de confirmação.

### Paginação
- 20 itens por página, rodapé com contador à esquerda e controles à direita
- Só renderizar controles quando houver mais de uma página

### Formulário de cadastro/edição
- **Sai do fluxo inline abaixo da tabela.** Vira drawer lateral (não modal — o
  cadastro agora tem 8 campos e o usuário se beneficia de ver a lista atrás).
- Abre por "+ Nova unidade" e por "Editar unidade" (no detalhe)
- Campos: Nome*, Sigla*, Descrição, Endereço, Cidade, UF, Latitude, Longitude
- **O `<select>` nativo de Município deve ser substituído por componente estilizado.**
  Hoje ele renderiza com fundo branco e seta do SO, quebrando o tema escuro.
- Fechar por Esc, clique fora e botão Cancelar. Confirmar descarte se houver
  alteração não salva.
- Foco vai para o primeiro campo ao abrir e retorna ao gatilho ao fechar.

---

## 3. Detalhe da unidade — estrutura comum

Rota `painel/unidades/:id`. Breadcrumb: `Operações / Painel / {Nome da unidade}`.

### Header
- Link "← Voltar ao painel"
- H1 com nome + badge de status operacional ao lado
- Linha de metadados em mono, separada por " · ":
  `{código} · {cidade}/{UF} · {endereço} · {lat}, {long}`
  Omitir os segmentos ausentes em vez de exibir vazio.
- Botões à direita: "+ Novo equipamento" (primário), "Agendar manutenção"
  (placeholder — seção 6), "Editar unidade" (abre o drawer da seção 2)

### KPIs
7 cards, mesmo padrão visual do painel (borda superior 2px na cor semântica,
número em mono):

`DISPONIBILIDADE · EQUIPAMENTOS · ONLINE · DEGRADADOS · OFFLINE · INCIDENTES ABERTOS · LATÊNCIA MÉDIA`

- Cores: online verde, degradados âmbar, offline e incidentes vermelho, demais brancos
- Latência: número grande + "ms" menor e apagado
- Falha em um KPI não pode derrubar os outros nem a página

### Abas
`Visão geral · Equipamentos · Incidentes · Histórico · Configurações`

- Aba ativa refletida na URL (query param ou child route) para permitir link direto
  e sobreviver a refresh
- Conteúdo de cada aba carregado sob demanda, com skeleton
- Navegável por teclado (setas), com `role="tablist"`

---

## 4. Abas — especificação

### 4.1 Visão geral
Duas colunas.

**Esquerda — "DISPOSITIVOS COM MAIOR LATÊNCIA"**
- Lista ordenada por latência decrescente
- Cada linha: dot de status · nome (mono, bold) · tipo · barra horizontal
  proporcional · valor à direita
- Equipamento offline: barra em vermelho ocupando a largura total e valor "timeout"
- Limitar a ~6 itens

**Direita — dois cards empilhados**

"EQUIPAMENTOS POR TIPO": barra horizontal por tipo + contagem à direita,
ordenado por contagem decrescente. Agregação client-side sobre a lista de
equipamentos da unidade.

"INCIDENTES RECENTES": código do incidente (mono) · descrição do evento ·
badge de status. Limitar a ~5. Estado vazio explícito quando não houver.

### 4.2 Equipamentos
- Filtros: input de busca + select "Tipo: todos" + select "Status: todos"
  (**selects estilizados, não nativos**)
- Contador "{n} de {total} dispositivos" + botão "+ Novo equipamento"
- Tabela: `NOME · TIPO · HOSTNAME · ENDEREÇO IP · STATUS · LATÊNCIA · DISPONIBILIDADE · ÚLTIMA VERIFICAÇÃO · AÇÕES`
- NOME com dot de status, em mono bold. HOSTNAME e IP em mono.
- ÚLTIMA VERIFICAÇÃO: tempo relativo formatado no client ("há 15 s", "há 12 min")
- AÇÕES: menu "…" — reutilizar as ações de equipamento que já existem no CRUD.
  Não criar operações novas.
- Filtros aplicados em memória, sem refetch
- `hostname` depende da tarefa B1. Se ainda não estiver no response do dashboard,
  a coluna exibe "—" e você reporta.

### 4.3 Incidentes
- Tabela: `INCIDENTE · EQUIPAMENTO · EVENTO · INÍCIO · DURAÇÃO · STATUS`
- Código do incidente em mono, linkando para a página de Incidentes existente
- INÍCIO: data e hora completas, mono
- **DURAÇÃO é derivada no client**: `fim - inicio`, ou `agora - inicio` se ainda
  aberto. Não criar campo no backend.
- Ordenar por início decrescente
- Estado vazio explícito

### 4.4 Histórico
- Card "DISPONIBILIDADE DIÁRIA · ÚLTIMOS 30 DIAS"
- Gráfico de barras, uma por dia, altura proporcional à disponibilidade
- Cor por faixa: verde acima do limiar, âmbar em atenção, vermelho crítico.
  Definir os limiares como constantes nomeadas no componente, não mágicas.
- Eixo X com poucas labels (primeira, intermediárias, última)
- Tooltip no hover: data + percentual
- **Requer endpoint novo** — ver seção 7.3
- Se o range não tiver 30 dias de dados, renderizar só o que existe. Não preencher
  com zero (zero significa indisponível, ausência significa não monitorado).

### 4.5 Configurações
Duas colunas.

**Esquerda — "CADASTRO DA UNIDADE"**
Lista de leitura em pares label/valor: Nome, Código interno, Endereço, Cidade,
UF, Latitude, Longitude, Descrição, Ativa. Valores em mono.
Somente leitura — a edição acontece pelo drawer via "Editar unidade" no header.

**Direita — "ZONA DE RISCO"**
- Texto explicando a consequência da desativação, com a contagem real de dispositivos
- Botão "Desativar unidade" em tom destrutivo, com a mesma confirmação da seção 2
- Se a unidade estiver inativa, o card mostra "Ativar unidade"
- Incluir também "Excluir unidade" aqui, com a mesma confirmação da lista

---

## 5. Estados vazios e de erro

Toda tabela e todo card precisa de tratamento explícito para:
- **Carregando** — skeleton, nunca spinner de página inteira
- **Vazio** — mensagem específica ("Nenhum equipamento cadastrado nesta unidade"),
  não um genérico "Sem dados"
- **Vazio por filtro** — mensagem distinta da anterior, com ação de limpar filtro
- **Erro** — mensagem + botão de tentar novamente, isolado ao card

Unidade inexistente ou id inválido em `painel/unidades/:id` → tela de não encontrado
com link de volta ao painel. Não deixar quebrar.

---

## 6. Agendar manutenção (placeholder)

Feature futura. Nesta entrega:
- Botão presente no header do detalhe, **desabilitado**
- `title`/tooltip: "Em breve"
- Sem rota, sem modal, sem endpoint, sem entrada de menu
- Marcar no código com `// TODO: feature de janelas de manutenção`
- **Não** implementar CRUD de janelas nem qualquer lógica relacionada

---

## 7. Backend — escopo autorizado

Apenas os três itens abaixo.

### 7.1 Campos de cadastro da unidade
**Verificar primeiro se já existem.** Latitude e longitude provavelmente já estão na
entidade por causa do mapa — não duplicar.

Adicionar o que faltar a `Unidade`: `endereco` (texto), `uf` (2 caracteres),
`latitude`, `longitude` (decimal).

- Migration aditiva, todos os campos **nullable** (as unidades existentes não têm esses dados)
- Incluir no request e response de criação/edição
- Validação: UF contra a lista de siglas brasileiras; latitude entre -90 e 90;
  longitude entre -180 e 180. Todos opcionais.
- **Não** tornar obrigatório nenhum campo que hoje seja opcional
- **Não** alterar `descricao`

### 7.2 Dados operacionais na listagem de unidades
A lista administrativa precisa de status operacional, contagem de equipamentos,
disponibilidade e incidentes por unidade.

**Antes de criar qualquer coisa:** verificar se o endpoint de dashboard já entrega
isso. Se entregar, consumir o existente e não mexer no backend.
Se não, expor os agregados no endpoint de listagem de unidades, sem alterar o
formato dos campos atuais.

### 7.3 Histórico de disponibilidade diária
Endpoint novo autorizado: disponibilidade agregada por dia, por unidade,
últimos 30 dias.

- Sugestão: `GET /relatorios/disponibilidade/unidades/{id}/diaria`
- DTO próprio: `{ data, disponibilidadePercentual, tempoMonitoradoSegundos }`
- Reutilizar a lógica de cálculo de disponibilidade já existente. **Não** criar
  fórmula nova nem duplicar regra.
- Dias sem monitoramento não entram no array (ausência ≠ zero)
- Mesmo guard/permissão dos demais endpoints de relatório
- Range fixo de 30 dias nesta entrega; parametrizar só se for trivial

---

## 8. Ordem de execução sugerida

1. **Backend** (7.1, 7.2, 7.3) com testes — desbloqueia o resto
2. **Detalhe · abas Visão geral, Equipamentos, Incidentes** — maior valor, menor risco
3. **Detalhe · Histórico e Configurações**
4. **Lista administrativa** + drawer de cadastro
5. **Confirmações destrutivas** — não deixar por último e não cortar

---

## 9. Entrega

Ao final, reportar:

1. Diff resumido por arquivo, separando backend e frontend
2. Tamanho de cada SCSS tocado (limite de 8 kB por componente)
3. Resultado dos testes — backend e suíte do front
4. Quais campos de 7.1 já existiam e quais foram criados
5. Se 7.2 exigiu backend ou foi resolvido com endpoint existente
6. Lista de pendências: qualquer coisa que ficou com "—" ou estado vazio por
   falta de dado, e qual campo resolveria
7. Confirmação de que nenhuma regra de negócio de monitoramento foi alterada
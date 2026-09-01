# Contexto — Redesign da área de Equipamentos

Documento de referência para a implementação. Leia inteiro antes de tocar em código.
Segue o mesmo padrão de Unidades: análise e verificação antes de codar, plano
apresentado e aprovado antes de editar.

---

## 0. Regras de escopo

- Backend liberado apenas para o que a seção 6 autorizar. Fora dela: proibido
  alterar regra de negócio de monitoramento, resolver de status, cálculo de
  disponibilidade/latência ou lógica ICMP.
- Proibido remover ou renomear campo/endpoint existente. Só adição.
- Antes de editar: mapear endpoints e componentes existentes, listar arquivos a
  tocar, apresentar plano e esperar OK.
- Dados dos screenshots são mockados (220 vs 187, IPs de exemplo). Use só como
  referência de layout e comportamento.
- Budget de 8 kB por componente SCSS. `_ui.scss` está em 9,33 kB (global, fora do
  budget) — reutilize as primitivas existentes antes de criar estilo novo.

---

## 1. Decisões de produto (já tomadas, não questionar)

| Tema | Decisão |
|---|---|
| Filtros (Unidade/Tipo/Status/Ordenar) | Não somem. Vão para um painel expansível/recolhível |
| Busca | Única, ampliada (nome/hostname/IP/MAC/patrimônio), sempre visível |
| Editar / Excluir | Saem de botões soltos e vão para um menu "..." por linha |
| Localização / Descrição | Permanecem no formulário de cadastro |
| Tipo de equipamento | Continua CRUD próprio em Administração. O formulário de equipamento só *seleciona* um tipo já cadastrado — nenhuma mudança de modelo |
| Paginação | Consistente com Unidades: carregar o inventário inteiro uma vez, filtrar/ordenar/paginar em memória, 20 por página |

---

## 2. Topbar e header — reuso direto

Mesmo shell já construído para Painel e Unidades: breadcrumb, busca compacta,
chips de status, pill de refresh com timestamp, relógio, tema, avatar, logout.
Breadcrumb: `Administração / Equipamentos`.

Header da página:
- Título "Equipamentos"
- Subtítulo: "Inventário completo de todas as unidades. O tipo de equipamento é
  um atributo, não um módulo separado." (mantém — é descrição de comportamento,
  não anúncio de remoção do CRUD)
- Botão primário "+ Novo equipamento" à direita

---

## 3. Verificações obrigatórias antes de implementar

Não assumir nenhum destes — checar e reportar:

1. **Campos de busca.** O placeholder do mockup diz "Buscar nome, hostname, IP,
   MAC, patrimônio". Confirmar se `mac` e `patrimonio` (ou nome equivalente)
   existem na entidade/response de equipamento. Se não existirem, remover do
   escopo de busca e do placeholder, e reportar — não criar campo novo sem
   autorização (ver seção 6).
2. **Exclusão de equipamento.** Antes de escrever qualquer texto de confirmação:
   o backend recusa exclusão de equipamento com vínculos (medições, incidentes,
   histórico) ou faz cascade? Reproduzir como foi feito para unidade (grep do
   service + teste ao vivo). Se recusar, qual é a mensagem real? Se fizer
   cascade, PARAR e reportar antes de desenhar o modal — é decisão de produto,
   não de texto.
   Isso é repetição deliberada da investigação de Unidades: lá o modal chegou a
   prometer uma exclusão que a API sempre recusava. Não repetir o erro aqui.
3. **Status operacional e latência por equipamento.** `DashboardEquipamentoResponse`
   já expõe status e latência (confirmado nas tarefas B1/B2 de Unidades). Validar
   que o mesmo endpoint cobre os 187+ equipamentos sem paginação forçada, e que
   `hostname` e `emManutencao` já vêm populados.
4. **Toggle de monitoramento.** A coluna MONITORAMENTO ("Ativado"/"Desativado")
   mapeia para o campo administrativo que hoje aparece como "Status: Ativo" no
   cadastro. Confirmar que é o mesmo campo, não um novo.

---

## 4. Lista de equipamentos

### Busca
Input único no topo, sempre visível: "Buscar nome, hostname, IP, MAC,
patrimônio" (ajustar aos campos confirmados na seção 3.1). Filtragem em memória,
sem refetch por tecla.

### Painel de filtros (novo padrão — primeira vez no projeto)
- Botão/toggle que expande e recolhe um painel com os 4 controles: Unidade,
  Tipo, Status, Ordenar.
- Fechado por padrão.
- Indicar visualmente quando há filtro ativo (ex.: badge com contagem no botão
  que abre o painel), para o usuário não esquecer um filtro esquecido aberto.
- Os 4 selects usam a primitiva `.campo-select` do `_ui.scss` (já criada e em
  uso no drawer de Unidades) — não usar `<select>` nativo.
- Unidade e Tipo populados a partir dos dados já carregados (mesma lógica de
  "abas dinâmicas a partir dos dados" usada no Painel), não de uma chamada
  própria nova.
- Status: os mesmos 4 estados operacionais já padronizados (Online, Degradado,
  Offline, Manutenção).
- Ordenar: por nome (A-Z/Z-A) no mínimo; adicionar por status e por latência se
  for trivial, mas não é obrigatório nesta rodada.
- Todos os filtros combinam com a busca e entre si, em memória.

### Contador
"{n} de {total} dispositivos", junto à tabela — mesmo padrão de Unidades.

### Tabela
Colunas: `NOME · TIPO · UNIDADE · HOSTNAME · ENDEREÇO IP · STATUS · LATÊNCIA · MONITORAMENTO · AÇÕES`

- NOME em mono bold.
- UNIDADE: usar o nome (não o código) — mockup mostra nome por extenso.
  Considerar tornar clicável para `painel/unidades/{id}` se a informação de id
  estiver disponível na composição; se não estiver, não forçar chamada extra
  só para isso.
- HOSTNAME e ENDEREÇO IP em mono.
- STATUS: badge operacional reutilizando o `StatusBadgeComponent` já existente
  (mesmo componente usado no painel e no detalhe de unidade, já cobre
  `EM_MANUTENCAO`).
- LATÊNCIA: número mono + "ms" apagado; equipamento offline mostra "timeout"
  em vermelho, como no mockup.
- MONITORAMENTO: badge simples "Ativado"/"Desativado", mapeando o campo
  administrativo confirmado na seção 3.4.
- AÇÕES: menu "..." (seção 5).

### Estados
Vazio, vazio-por-filtro, erro e carregando, conforme o padrão já estabelecido
em Unidades (mensagens específicas, skeleton, nunca spinner de página inteira).

### Paginação
20 por página, client-side, mesmo padrão de Unidades. Só renderizar controles
com mais de uma página. Contador de itens junto à paginação, não isolado como
está hoje.

---

## 5. Menu de ações "..." (componente novo, compartilhado)

Este é o primeiro menu de ações do projeto — construir como componente
compartilhado (`shared/`), não local à tela de Equipamentos, porque:
- A aba Equipamentos do detalhe de unidade (`unidade-detalhe/equipamentos-tab`)
  tem uma dívida registrada exatamente por não ter esse componente disponível
  na época. Ela deve passar a usá-lo também, se o tempo desta rodada permitir —
  senão, ao menos deixar pronto para reuso imediato depois.

Requisitos de acessibilidade (não são opcionais):
- Abre por clique ou Enter/Espaço no botão gatilho.
- Fecha por Esc, clique fora, ou seleção de um item.
- Navegação por setas entre os itens, `role="menu"`/`role="menuitem"`.
- Foco retorna ao botão gatilho ao fechar.
- Posicionamento que não deixa o menu cortado nas últimas linhas da tabela
  (abre para cima quando não houver espaço abaixo).

Itens do menu, nesta ordem: Ver · Editar · Desativar/Ativar · Excluir
(divisor visual antes de Excluir, por ser destrutivo).

- **Ver**: navega para a tela de detalhe do equipamento, se existir; se não
  existir, reportar como pendência — não inventar rota.
- **Editar**: abre o formulário (seção 7) preenchido com os valores atuais.
  Mesmo cuidado de Unidades: se o backend usar `aplicarSePresente` ou padrão
  equivalente, confirmar que o form carrega todos os campos antes de permitir
  salvar, para não repetir a regressão de dado que ocorreu em Unidades.
- **Desativar/Ativar**: alterna o campo de monitoramento (seção 3.4). Exige
  confirmação curta explicando a consequência (para de monitorar, alertas
  suprimidos) — mesmo padrão do "Desativar unidade".
- **Excluir**: só depois de resolvida a verificação da seção 3.2. Usa o
  `ConfirmDialogComponent` já existente e já usado em Unidades (com o input
  `erro` para mensagem real da API).

---

## 6. Backend — escopo autorizado

Apenas o que a verificação da seção 3 revelar como faltante. Não antecipar.

- Se `mac`/`patrimonio` não existirem e você achar que deveriam: **não
  implementar**. Reportar como proposta e esperar decisão — pode ser que a
  busca simplesmente não cubra esses campos por ora.
- Se a exclusão de equipamento hoje faz cascade sem proteção: **não
  implementar correção ainda**. Reportar o comportamento atual primeiro; a
  decisão de adicionar proteção (como a FK RESTRICT de unidade) é de produto.
- Qualquer outra necessidade de backend que a implementação revelar: parar e
  reportar antes de codar, como nas rodadas anteriores.

---

## 7. Formulário de cadastro/edição

### Container
**Modal centralizado com backdrop**, não drawer — diferente do padrão adotado
em Unidades. Isso é intencional no mockup (formulário mais curto, ação única) e
deve ser seguido como está, não normalizado para drawer. Fecha por X, Esc,
clique no backdrop ou Cancelar.

### Conteúdo
- Título "Novo equipamento" / "Editar equipamento"
- Subtítulo: "O monitoramento ICMP começa na próxima varredura após a criação."
  (ajustar texto no modo edição, se fizer sentido)
- Campos, no layout do mockup:
    - Linha 1: Nome* · Tipo (select `.campo-select`, populado pelo CRUD de tipos
      existente — não hardcode)
    - Linha 2: Unidade (select `.campo-select`, largura total)
    - Linha 3: Hostname · Endereço IP*
    - Localização (mantido — decisão da seção 1)
    - Descrição (mantido — decisão da seção 1, textarea)
- Validação inline do IP: classificar e mostrar helper text abaixo do campo
  (ex.: "IPv4 · faixa privada"), client-side, ao perder foco ou parar de digitar.
  Não bloquear submit por isso — é informativo, a validação de formato continua
  sendo a existente.
- Nota de rodapé: "O monitoramento herda os padrões globais de ICMP." (texto
  estático, referência à tela de Monitoramento existente)
- Botões: Cancelar / Criar equipamento (ou "Salvar alterações" em edição)

### Modo edição
Carregar valores atuais em todos os campos, incluindo os que a tela atual já
tinha (Localização, Descrição) e os que hoje já existem no cadastro. Mesmo
cuidado de round-trip que foi aplicado ao drawer de Unidades: teste específico
de "abrir em edição → salvar sem alterar nada → nenhum campo perdido".

---

## 8. Estados vazios e de erro

Mesmo padrão de Unidades (seção 5 daquele contexto): carregando com skeleton,
vazio com mensagem específica, vazio-por-filtro distinto, erro com retry
isolado ao componente que falhou.

---

## 9. Ordem de execução sugerida

1. Verificações da seção 3 (nenhuma linha de código ainda)
2. Reportar achados e esperar OK antes de prosseguir
3. Header + topbar (reuso) + tabela com composição de dados (sem filtros/menu ainda)
4. Painel de filtros expansível
5. Menu de ações "..." como componente compartilhado
6. Modal de cadastro/edição
7. Ligar exclusão só depois do resultado da verificação 3.2

---

## 10. Entrega

Ao final, reportar:

1. Resultado das 4 verificações da seção 3, com evidência (não só afirmação)
2. Diff por arquivo, separando backend (se houver) e frontend
3. Tamanho de cada SCSS tocado
4. Se o menu "..." foi também retrofitado na aba Equipamentos do detalhe de
   unidade, ou se ficou como dívida registrada
5. Resultado dos testes
6. Confirmação de que nenhuma regra de monitoramento foi alterada
7. Qualquer campo que ficou "—" ou vazio por falta de dado, e o que resolveria
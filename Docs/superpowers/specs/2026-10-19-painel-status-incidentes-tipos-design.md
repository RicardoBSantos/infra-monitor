# Painel — linha coerente com o status, incidentes elegíveis e filtro de tipos

Data: 2026-10-19 · Branch: `feat/painel-status-incidentes-tipos` (a partir de `origin/main` cc56f37)

Escopo deste documento: itens 2, 3 e 4 do pedido de 2026-10-19. O item 1 (teto de 100 itens
e truncamento silencioso) teve a investigação reportada e aguarda decisão de escopo; o item 4
depende dele apenas na **fonte** do índice de cadastro, isolada aqui atrás de um tipo mínimo.

## Diagnóstico que motivou

- Barra lateral e ícone da linha de unidade vinham de `severidade()` (front: qualquer offline →
  vermelho; degradado **ou manutenção** → amarelo). O badge vem de `unidade.status` (backend:
  offline parcial → `DEGRADADA`; manutenção parcial → `DISPONIVEL`). Hotel Sesc Atalaia
  (17 disponíveis, 1 em manutenção) aparecia com badge "Disponível" e barra amarela com ⚠.
- O "●1" ao lado do badge é o chip de manutenção parcial, não contador de incidentes; ícone
  `circle` é um ponto (`M12 12h.01`), ilegível. O chip transborda a coluna de 116px e encosta na
  faixa de composição.
- `incidentesAbertos` por unidade soma incidentes de monitor desativado, equipamento inativo e
  equipamento em manutenção — que o status ignora. Desativar monitor/equipamento não fecha o
  incidente (só a manutenção fecha), e `POST /incidentes` manual não valida elegibilidade.
- Abas de tipo derivam de `GET /equipamentos?size=500`, cortado em 100 pelo backend: 5 de 8 tipos.

## Item 2 — fonte única para barra, ícone e badge

- `status-badge.component.ts` passa a exportar `tomDoStatus(status: DisplayStatus): TomStatus`
  (`'success' | 'warning' | 'danger' | 'muted' | 'info'`), lido do mesmo `TONES` que o badge usa.
  É a única tabela status→tom do front.
- Linha de unidade: `severidade()` sai do Painel. Classe `unidade--{tom}` e `marca--{tom}` vêm de
  `tomDoStatus(unidade.status)`. Toda linha tem barra lateral colorida, inclusive `success`.
  Cores: `success → --im-success`, `warning → --im-warning`, `danger → --im-danger`,
  `info → --im-info-soft`, `muted → --im-text-muted` — os mesmos tokens do badge. Nenhuma cor nova.
- `_ui.scss` ganha `.marca--muted` e `.marca--info` (o fundo translúcido segue o padrão de
  `.marca--ok/warn/down` e dos fundos do badge).
- Ícones (legíveis, 16px numa caixa de 28px):
  `success → check`, `warning → incident`, `danger → close`, `info → wrench`, `muted → minus`.
  `app-icon` ganha os paths `check`, `wrench`, `minus` (traço único, mesmo estilo dos demais).
- Chip de manutenção parcial: ícone `wrench`, rótulo `N em manutenção`, posicionado **abaixo** do
  badge dentro da coluna de status (não transborda para a composição). `title`/`aria-label` mantidos.
  Só aparece quando `equipamentosEmManutencao > 0` e status ≠ `EM_MANUTENCAO` (regra atual).
- Faixa de composição e contagens por equipamento continuam como estão: são composição, não status.
- Pills de status e linhas de equipamento (`severidadeDoEquipamento` com `.ponto`) ficam fora.

Critério: Hotel Sesc Atalaia renderiza badge Disponível, barra verde, ícone check, chip
"1 em manutenção" sem encostar na faixa. Nenhuma linha tem barra/ícone de tom diferente do badge.

## Item 3 — incidentes abertos elegíveis

**Regra:** um incidente `ABERTO`/`RECONHECIDO` conta como operacional só se o monitor está ativo,
o equipamento está ativo e o equipamento não está em manutenção.

Backend (`DashboardReadRepository.ESTADOS`):
- `monitor_estado` junta `equipamento` e define `incidente_elegivel = i.id is not null and m.ativo
  and e.ativo and not e.em_manutencao`. `status = 'INDISPONIVEL'` e `incidente_aberto` passam a
  usar essa condição (status do monitor e contador ficam na mesma regra).
- Resumo: KPI `incidentes.abertos` sai de `sum(incidente_aberto)` do mesmo CTE, não mais do
  `count(*)` cru. Sem filtro por unidade ativa: o resumo inteiro já cobre todas as unidades; a
  diferença em relação à soma das linhas (que só lista ativas) existe apenas se unidade inativa
  tiver incidente — registrado como pendência (unidade inativa continua monitorada).
- `DashboardService.operacional`: `incidentesAbertos` por equipamento é 0 quando o equipamento
  está inativo ou em manutenção.

Frontend (banner do Painel): o "+N" deriva do KPI do resumo, não de `content.length`; a lista
descritiva busca `ABERTO` e `RECONHECIDO` (hoje só `ABERTO`).

Classificação completa dos 13 pontos que contam/listam incidentes abertos fica em
`infra-monitor-backend/docs/contagem-incidentes-abertos.md` (operacional → ignora; registro/
histórico → mantém; KPI de período do PDF/Relatórios mantém bruto, divergência intencional).

Teste: integração com Postgres real (`@RequerDocker`) cobrindo os quatro casos (normal conta;
monitor inativo, equipamento inativo, equipamento em manutenção não contam) em linha de unidade,
detalhe da unidade, resumo e equipamentos da unidade. Os incidentes inelegíveis são inseridos por
JDBC — é exatamente o estado órfão que a operação produz.

## Item 4 — filtro de tipos

- Fonte das abas: `TipoEquipamentoApiService.list()` (todos, ativos e inativos).
- Contagem por tipo sobre o índice de cadastro, restrita à **visão atual**: unidades que passam no
  filtro de status e na busca de texto (o próprio filtro de tipo não restringe a contagem).
- Exibição: tipo ativo sempre aparece; tipo inativo só aparece se houver equipamento dele no
  cadastro inteiro. Contador 0 → aba visível e `disabled` (exceto a aba selecionada, que continua
  clicável para poder voltar). "Todos" mostra o total da visão.
- Índice indisponível ou parcial: abas aparecem habilitadas **sem contador** — nunca "0" quando a
  contagem é desconhecida. Falha de `/tipos-equipamento`: cai para os tipos presentes no índice.
- O índice passa a ser um tipo mínimo `EntradaCadastro { unidadeId, tipoId, nome, hostname, ip }`,
  para que a troca de fonte decidida no item 1 não toque na lógica das abas.

Critério: no dev, 8 abas; na carga, Servidor e Roteador (+ ativos sem equipamento desabilitados).

## Verificação

- Backend: `./mvnw test` com Docker (contagem completa, sem aviso `!!`).
- Frontend: `npm test` (specs do Painel, status-badge, app-icon).
- e2e Playwright por clique nos dois bancos (dev 5434 / API 8080; carga 5436 / API 8081),
  capturas: linhas em cada status presente, Atalaia, abas sem filtro e com filtro de status/busca.
  Capturas conferidas visualmente.

## Fora de escopo (registrado)

- Fechar incidente ao desativar monitor/equipamento; validar `POST /incidentes` manual.
- Unidade inativa continua sendo pingada e abrindo incidente.
- Item 1 até a decisão do usuário.

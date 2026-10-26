# Auditoria F3 — notificações ancoradas em janela agendada e em manutenção manual

Data: 2026-10-26. Branch: `feat/manutencao-f3`.

A F3 acrescenta duas âncoras à notificação (`manutencao_agendada_id`, `manutencao_manual_id`, V23) e
novos `TipoEventoNotificacao`. Desde a F1 uma notificação já podia ter `incidente` nulo (âncora
`episodio_latencia_id`); agora são **quatro** âncoras mutuamente exclusivas
(`ck_notificacao_ancora_exclusiva`). Todo código que lê `getIncidente()` / `incidente_id` de uma
notificação precisa tratar "incidente nulo" como caso normal, não como erro.

O documento é montado por seção, uma `##` por área. Cada ponto de leitura foi aberto e lido; o grep
(`getIncidente|incidente_id|incidenteId`) foi só o ponto de partida. Classificação:
**muda** (corrigido ou a corrigir na F3) / **não muda** (com o porquê).

## Dispatcher, sender, telegram

Escopo lido por inteiro: `notificacao/dispatcher/*` (4 arquivos), `notificacao/sender/*` (2),
`notificacao/telegram/*` (9), `NotificacaoController`, `NotificacaoTelegramController`.

| Ponto | O que faz com a âncora | Classificação | Por quê |
|---|---|---|---|
| `NotificationDispatcher.process`, log de sucesso (`Telegram enviado`) | lia `notification.getIncidente().getId()` | **muda (corrigido na Task 2)** | NPE para toda notificação sem incidente, **depois** de `complete(success)`: o `catch` chamava `complete(failure)`, que não acha mais `ENVIANDO` e sai; a notificação ficava `ENVIADA` e o log dizia "Erro interno". Agora loga `ancora=` com `Notificacao.descreverAncora()` (`incidente=12`, `episodioLatencia=3`, `manutencao=41`, `manutencaoManual=7`). |
| `NotificationDispatcher.process`, log de falha (`Telegram falhou`) | idem | **muda (corrigido na Task 2)** | Mesmo NPE, agora num caminho que mascarava a falha real do envio. |
| `NotificationDispatcher.dispatchReadyNotifications` / `submit` | só ids, `CanalNotificacao`, `StatusNotificacao` | não muda | Não olha âncora. A fila (`findIdsReadyForDispatch`) é do repositório e tem auditoria própria. |
| `NotificationDispatchStateService` (`reserve`, `loadSending`, `complete`, `releaseStaleReservations`) | status, tentativas, `retryAfter` | não muda | Nenhuma referência a incidente ou âncora; as transições de estado independem de qual âncora a linha tem. |
| `NotificationDispatcherConfiguration`, `NotificationDispatcherProperties` | executor, relógio, parâmetros | não muda | Sem acesso à entidade. |
| `NotificationSender` / `SendResult` | contrato `send(Notificacao)` → resultado | não muda | A interface não menciona âncora. |
| `TelegramNotificationSender.send` | `client.sendMessage(notificacao.getMensagem())` | não muda | Usa só o texto já montado; a âncora não chega ao canal. |
| `TelegramClient`, `RestTelegramClient`, `TelegramProperties`, `TelegramIdentityCache`, `TelegramBotInfo`, `TelegramIdentidade`, `StatusIdentidadeBot` | HTTP e identidade do bot | não muda | Não recebem `Notificacao`. |
| `TelegramTestService` (mensagem de teste) | não passa pela tabela `notificacao`; o texto diz "não corresponde a um incidente" | não muda | Não cria linha, logo não tem âncora. A menção a incidente é só contraste. |
| `NotificacaoTelegramController` | configuração e teste do bot | não muda | Sem `Notificacao`. |
| `NotificacaoController.listar` (`incidenteId`, `episodioLatenciaId`) | filtros por âncora | não muda **nesta seção** | Só repassa ao `NotificacaoService`; filtro e resposta (`paraResposta`, `findAll` com `EntityGraph`) são auditados na seção do serviço/repositório. Os dois parâmetros continuam válidos e os eventos novos aparecem na listagem sem filtro por âncora. |
| `NotificacaoController.buscarPorId` | `findById` → `paraResposta` | não muda **nesta seção** | A leitura da âncora está em `NotificacaoService.paraResposta` (seção própria). |

### Ponto de atenção registrado (não alterado nesta tarefa)

`NotificacaoRepository.findById` (usado por `NotificationDispatchStateService.loadSending`) carrega por
`EntityGraph` apenas `incidente` e `episodioLatencia`. `manutencaoAgendada` e `manutencaoManual` ficam
como proxy lazy e a entidade chega ao dispatcher **desanexada** (a transação do `loadSending` já
terminou). `descreverAncora()` só chama `getId()` nelas, e o Hibernate responde `getId()` de um proxy
sem inicializá-lo, então não há `LazyInitializationException` no log. Qualquer outro acesso a atributo
dessas âncoras fora de transação (montar texto, `paraResposta` de listagem) **falharia**; isso
pertence à seção de repositório/serviço. O teste unitário desta tarefa usa mocks e não prova o
comportamento do proxy; a prova com banco real fica para um teste de integração do dispatcher com
âncora de janela.

### Evidência de teste

Testes em `NotificationDispatcherTest` (`OutputCaptureExtension`):
`envioDeLatenciaNaoLogaErroInterno`, `falhaDeLatenciaLogaAncora`, `envioDeJanelaNaoLogaErroInterno`.
Sem a correção os três falham com
`ERROR ... NotificationDispatcher -- Erro interno ao processar notificacao 1: NullPointerException`.
Com a correção passam (5/5 na classe) e o log traz `ancora=episodioLatencia=3` /
`ancora=manutencao=41`. A reversão local da correção voltou a deixar os três vermelhos (3 falhas em
5), e a correção foi restaurada em seguida.

## Listagem de notificações (`NotificacaoService.listar`, `paraResposta`, controller, graphs)

| Ponto | O que faz | Classificação | Por quê |
|---|---|---|---|
| `NotificacaoController.listar` | recebia `incidenteId`, `episodioLatenciaId`; repassa ao serviço | **muda** | Ganha `manutencaoId` e `manutencaoManualId` (opcionais), repassados logo depois de `episodioLatenciaId`. `CAMPOS_ORDENAVEIS` não muda: nenhuma coluna nova é ordenável. |
| `NotificacaoController.buscarPorId` | `findById` → `paraResposta` | não muda | Só a resposta ganha campos (abaixo). |
| `NotificacaoService.listar`, validação de âncora | recusava `incidenteId` + `episodioLatenciaId` com mensagem própria | **muda** | Quatro âncoras exclusivas (`ck_notificacao_ancora_exclusiva`): qualquer par nunca casaria. Conta as informadas e recusa mais de uma com `IllegalArgumentException("informe apenas uma ancora: incidenteId, episodioLatenciaId, manutencaoId ou manutencaoManualId")`, que o `TratadorGlobalDeErros` devolve como 400 no formato `ErroResposta`. |
| `NotificacaoService.listar`, filtros `Specification` | `root.get("incidente").get("id")` e `episodioLatencia` | **muda** | Dois filtros novos: `manutencaoAgendada.id` e `manutencaoManual.id`. O `cb.equal` sobre `get("x").get("id")` não faz join (o Hibernate usa a FK), então não duplica linha nem distorce o `count` da página. |
| `NotificacaoService.listar`, `status`/`canal`/`tipoEvento`/`inicio`/`fim` | filtros por coluna própria | não muda | Independem da âncora; `tipoEvento` aceita os valores novos sem código (enum em `@RequestParam`). |
| `NotificacaoService.paraResposta`, blocos `incidente` e `episodioLatencia` | monta os blocos de âncora | não muda | Já tratava âncora nula. |
| `NotificacaoService.paraResposta`, `monitor`/`equipamento`/`unidade` | lia tudo de `incidente.monitor` ou `episodio.monitor`; sem monitor, tudo `null` | **muda** | Sem a correção, notificação de janela/manual sairia com `equipamentoNome` e `unidadeNome` nulos e a tela não saberia de que unidade é o aviso. Agora: monitor da âncora de monitor; equipamento = o do monitor ou o da sessão manual; unidade = a do equipamento ou a da janela. Janela: `equipamentoNome` e `monitorNome` nulos, `unidadeNome` da janela. Manual: equipamento e unidade do equipamento, monitor nulo. |
| `NotificacaoService.paraResposta`, blocos novos | — | **muda** | `manutencao {id, unidadeNome}` e `manutencaoManual {id, equipamentoId, equipamentoNome}` entram depois de `episodioLatencia`. Leem `getUnidade()` e `getEquipamento()` das âncoras, seguro porque os `EntityGraph` de `findById`/`findAll` já trazem `manutencaoAgendada.unidade` e `manutencaoManual.equipamento.unidade`. Provado em `NotificacaoListagemManutencaoPostgresIntegrationTest` (leitura fora de transação, sem `LazyInitializationException`). |
| `NotificacaoRepository.findById` / `findAll` (graphs) | joins das âncoras | não muda nesta tarefa | Já cobriam as âncoras novas (T1). Fecha o ponto de atenção da seção do dispatcher para o caminho da listagem: `paraResposta` acessa atributos das âncoras e funciona. |
| `NotificacaoRepository.findByIncidenteId` | `@EntityGraph("incidente")`, por incidente | não muda | Âncora de incidente apenas. |
| `NotificacaoResponse` (DTO) | contrato com o front | **muda** | Dois campos novos depois de `episodioLatencia`; o JSON do front (`notificacao.ts`) confere campo a campo. |

## Relatório de histórico (`RelatorioService.notificacoes`, `HistoricoNotificacaoResponse`)

| Ponto | O que faz | Classificação | Por quê |
|---|---|---|---|
| `RelatorioService.notificacoes`, SQL | `select ... incidente_id ... from notificacao` sem join | **muda** | Lê também `manutencao_agendada_id` e `manutencao_manual_id`. Sem join com monitor, então não perde linha de janela/manual (um `join incidente` perderia). |
| `RelatorioService.notificacoes`, mapper | `r.getLong("incidente_id")` | **muda** | **Bug latente que a F3 expõe:** `ResultSet.getLong` devolve `0` para `NULL`. Desde a F1 uma notificação de latência já saía com `incidenteId: 0`; com janela/manual seria a maioria. Passa a `(Long) r.getObject(...)` e o histórico devolve `null`. Teste: `historicoTrazAsDuasColunasNovasEIncidenteNuloNaoViraZero`. |
| `RelatorioService.notificacoes`, filtros (`incidenteId`, `status`, `canal`, `tipo`) | `incidente_id = :incidenteId` | não muda | Filtrar por incidente continua filtrando só âncora de incidente. O histórico não ganha filtro por janela/sessão: o brief só pede as colunas. |
| `RelatorioService.filters(... incidenteId)` | 404 se o incidente não existe | não muda | Só vale quando o filtro é informado. |
| `RelatorioService.validarExportacaoNotificacoes` e mapa de ordenação | `order(sort, ...)` | não muda | Ordena por colunas que já existiam; as novas não são ordenáveis. |
| `HistoricoNotificacaoResponse` | record | **muda** | `Long manutencaoId, Long manutencaoManualId` no **fim** (contrato do front). `incidenteId` já era `Long`. |
| `RelatorioController.notificacoes` | repassa parâmetros | não muda | Assinatura do endpoint intacta. |

## Export CSV de notificações (`RelatorioExportService.notificacoes`)

| Ponto | O que faz | Classificação | Por quê |
|---|---|---|---|
| `NOTIFICACOES` (SQL) | `select id,incidente_id,...` | **muda** | Acrescenta as duas colunas no fim do `select`. |
| Cabeçalho e linha do CSV | `notificacao_id,incidente_id,tipo_evento,canal,status,tentativas,created_at,enviado_em` | **muda** | `manutencao_id,manutencao_manual_id` no **fim**, para não deslocar as colunas que planilhas e scripts já consomem. |
| `lng(r, "incidente_id")` | `getObject` + `Number.longValue` | não muda | Já era null-safe: o CSV nunca teve o bug do `0` do histórico. Célula vazia para âncora ausente. |
| Filtros e ordenação do export | `incidenteId`, `status`, `canal`, `tipo` | não muda | Mesmos do relatório. |
| `RelatorioExportController.notificacoes` | repassa | não muda | Sem parâmetro novo. |
| Colunas `mensagem` e `erro` | fora do CSV por desenho | não muda | Continuam excluídas (teste existente: `doesNotContain("mensagem fora do CSV", "erro", ...)`). A mensagem de janela carrega motivo e nome de usuário; ficar fora do CSV é o que já a protege. |

## PDF Visão Geral (`VisaoGeralPdfRepository.KPIS`) e indicadores

| Ponto | O que faz | Classificação | Por quê |
|---|---|---|---|
| `KPIS`, `notificacoes_falha` | `count(*) from notificacao where status='FALHA' and created_at between` | não muda | Sem filtro de âncora nem de tipo: conta falha de entrega no canal, e falha de anúncio de janela/manual é exatamente isso (saúde do canal, spec §2.8). Teste: `falhaDeAnuncioDeManutencaoContaEmNotificacoesFalha` (25 → 27 no indicador). |
| `KPIS`, `incidentes_abertos` e `medicoes_falha` | tabelas `incidente` e `medicao` | não muda | Sem relação com `notificacao`. |
| `RelatorioService.indicadoresVisaoGeral` | chama `coletarKpis` | não muda | O PDF (`coletar`) e o endpoint de indicadores usam o mesmo `coletarKpis`: o número da tela e o do PDF não divergem. |
| Demais blocos do PDF (unidades, equipamentos, latência) | disponibilidade e latência | não muda | Não leem `notificacao`. |

## Dashboard (`DashboardIncidenteReadRepository`, `DashboardIncidenteResponse`)

| Ponto | O que faz | Classificação | Por quê |
|---|---|---|---|
| Braço `INCIDENTE` do `EVENTO`, LATERAL em `notificacao` | `where nn.incidente_id = i.id order by created_at desc, id desc limit 1` | não muda | Só olha notificação ancorada naquele incidente; as âncoras novas têm `incidente_id` nulo e nunca casam. O `LATERAL ... LIMIT 1` continua sendo a proteção do `count` contra linha duplicada. |
| Braço `LATENCIA`, LATERAL | `where nn.episodio_latencia_id = ep.id` | não muda | Mesmo raciocínio. |
| `notificacaoCanal`/`Status`/`EnviadoEm` | último aviso do incidente/episódio | não muda | O dashboard é de incidentes e latência; aviso de janela/sessão não é evento deles e não deve aparecer ali. Incidente encerrado por manutenção mostra como último aviso o `INCIDENTE_ENCERRADO_MANUTENCAO`, que já existia e continua ancorado no incidente. |
| `MAPPER` | `r.getLong("monitor_id")` etc. | não muda | Colunas do join interno com monitor/equipamento/unidade, nunca nulas. |
| `DashboardIncidenteResponse` | record | não muda | Sem campo de âncora. |

## `EfeitosManutencao` (entrada em manutenção)

| Ponto | O que faz | Classificação | Por quê |
|---|---|---|---|
| `aplicarEntrada`, passo 5: `tratarEncerramentoPorManutencao(incidente\|episodio, agora)` | cancela abertura pendente e avisa `INCIDENTE_ENCERRADO_MANUTENCAO` / `LATENCIA_ENCERRADA_MANUTENCAO` | não muda | Os dois eventos têm âncora de monitor e seguem por `inserirPendenteSeAusente(incidenteId, episodioId, null, null, ...)`. O aviso novo da F3 (`MANUTENCAO_MANUAL_INICIADA`) é criado por `AnuncioManutencaoManual.anunciarInicio`, chamado em `EstadoManutencaoEquipamento`, **fora** deste método e na transação do chamador (lock do equipamento, MA31). |
| `aplicarSaida` | `cicloJanela.abrirEquipamento` | não muda | Sem notificação. |
| Releitura por id e filtro `MotivoEncerramento == MANUTENCAO` | evita notificar o que o motor fechou | não muda | Regra de incidente/episódio; independe das âncoras novas. |

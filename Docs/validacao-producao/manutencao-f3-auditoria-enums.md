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

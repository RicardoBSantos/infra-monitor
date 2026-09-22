# Auditoria dos enums novos — `StatusNotificacao.CANCELADA`, `TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO`, `LATENCIA_ENCERRADA_MANUTENCAO`

Data: 2026-09-22. Branch: `feat/manutencao-equipamento`.

## Estado encontrado no momento da auditoria

Os três valores **já existem no código** quando esta auditoria foi feita — não é um exercício
hipotético "antes de escrever em qualquer lugar". `StatusNotificacao.CANCELADA` e os dois
`TipoEventoNotificacao` novos estão declarados, a `V19__add_motivo_encerramento_e_eventos_manutencao.sql`
já alterou as duas `CHECK` do banco, e o backend já tem `Notificacao.cancelar()`,
`NotificacaoRepository.cancelarPendentesDoIncidente/Episodio`, `NotificacaoService.tratarEncerramentoPorManutencao(...)`
(dois overloads) e os dois ramos novos em `NotificacaoMessageBuilder`. Isso é trabalho de outra
tarefa rodando em paralelo neste mesmo branch (ver aviso do orquestrador sobre `.git/index.lock`).
Esta auditoria documenta o estado **real** de cada ponto de leitura, não presume que nada foi feito.

O frontend continua **sem** os valores novos: `NotificationStatus` e `NotificationEventType` em
`api-enums.ts` não têm `Cancelled`/`CANCELADA` nem os dois eventos de manutenção — conferido por
leitura direta do arquivo nesta data. É esperado: o frontend está fora do escopo de commit desta
tarefa (`infra-monitor-frontend/` é "trabalho alheio na árvore").

## Como a tabela foi montada

Os três comandos do brief foram executados a partir da raiz do repo (não de `infra-monitor-backend/src`
e `infra-monitor-frontend/src` separadamente, para não perder contexto de caminho):

```
grep -rn "StatusNotificacao\|'PENDENTE'\|'ENVIANDO'\|'ENVIADA'\|'FALHA'\|status *= *'FALHA'" infra-monitor-backend/src/main
grep -rn "TipoEventoNotificacao\|INCIDENTE_ABERTO\|INCIDENTE_FECHADO\|LATENCIA_ALTA\|LATENCIA_NORMALIZADA" infra-monitor-backend/src/main
grep -rn "NotificationStatus\|NotificationEventType\|PENDENTE\|ENVIADA\|ENVIANDO" infra-monitor-frontend/src/app
```

O grep trouxe mais pontos do que a lista mínima do brief (esperado — a lista do brief é o piso, não
o teto). Duas categorias de acerto foram descartadas da tabela por não pertencerem ao domínio
auditado, apesar de casarem com o padrão textual:

- `medicao.status = 'FALHA'`/`'SUCESSO'` (V6, `RelatorioExportService.MEDICOES`/`LATENCIA`,
  `VisaoGeralPdfRepository.LATENCIA`) — é `StatusMedicao`, um enum diferente, sem valor novo nesta
  mudança. Fora do escopo.
- Comentários e mensagens de exceção que citam `INCIDENTE_ABERTO`/`INCIDENTE_FECHADO` só como texto
  (ex.: `IncidenteService.MENSAGEM_INCIDENTE_ABERTO`, comentários do `LatencyEpisodeProcessor`) — não
  leem o enum, não decidem nada a partir dele.

Arquivos de teste (`*.spec.ts`) aparecem no grep do frontend porque fixam os valores atuais dos
enums. Não entram na tabela de classificação (ela é sobre comportamento de produção), mas ficam
registrados na seção de observações: vão quebrar/precisar de novos casos quando o enum do frontend
for estendido, e essa é a tarefa que vai fazer isso, não esta.

## Tabela de classificação

Legenda: **F** = fica de fora, **E** = entra, **T** = tratamento próprio.

### Backend — `StatusNotificacao`

| Ponto | Classe | Justificativa |
|---|---|---|
| `NotificationDispatcher.java:49` `findIdsReadyForDispatch(..., StatusNotificacao.PENDENTE, ...)` | F | Filtra `PENDENTE` explicitamente; `CANCELADA` nunca é lida por aqui. É o argumento central de que o valor novo é seguro: o dispatcher não vê notificação cancelada. |
| `NotificacaoRepository.java:70-76` query de `findIdsReadyForDispatch` | F | Recebe `status` como parâmetro, mas quem chama sempre passa `PENDENTE` (linha 49). A query em si é genérica; o contrato de uso é que fecha o círculo. |
| `NotificacaoRepository.java:78-81` `reserveForDispatch` (CAS `PENDENTE`→`ENVIANDO`) | F | CAS contra `PENDENTE`. Uma linha `CANCELADA` nunca casa a cláusula `where ... status = PENDENTE`, então 0 linhas afetadas — o dispatcher desiste silenciosamente, que é o comportamento certo. |
| `NotificacaoRepository.java:83-86` `releaseStaleSending` | F | Só toca `ENVIANDO`. `CANCELADA` é terminal e nunca passou por `ENVIANDO` vindo de um cancelamento, então não é candidata a essa recuperação. |
| `NotificationDispatchStateService.java:20` `loadSending` (`filter(status == ENVIANDO)`) | F | Mesma razão: só aceita a linha se ainda estiver `ENVIANDO`. Uma corrida cancelamento-vs-reserva que perdeu para a reserva já não é mais `PENDENTE` (virou `ENVIANDO`) quando o cancelamento roda, então o cancelamento simplesmente não encontra nada para atualizar — ver `NotificacaoRepository.java:88-98`. |
| `NotificationDispatchStateService.java:22` `complete` (`filter(status == ENVIANDO)`) | F | Idem: só fecha o ciclo de uma linha que está `ENVIANDO`. |
| `Notificacao.java:52` campo `status` (`@Enumerated(EnumType.STRING)`) | F | Declaração de tipo; Hibernate persiste qualquer constante do enum pelo nome automaticamente. Não há lista para atualizar aqui. |
| `Notificacao.java:92` construtor privado (`this.status = PENDENTE`) | F | Toda notificação nasce `PENDENTE`; `CANCELADA` nunca é o estado inicial, então este ponto não precisa saber que ela existe. |
| `Notificacao.java:123-129` `marcarEnviada` | F | Atribuição incondicional para `ENVIADA`; não lê nem ramifica sobre o valor atual de `status`. Chamado só pelo dispatcher sobre uma linha que ele mesmo confirmou `ENVIANDO`. |
| `Notificacao.java:131-136` `agendarRetry` | F | Mesma razão: atribuição incondicional para `PENDENTE` (retry), sem ramificação por status novo. |
| `Notificacao.java:138-143` `marcarFalha` | F | Atribuição incondicional para `FALHA`, mesma razão. |
| `Notificacao.java:145-151` `cancelar()` | **T** | Método novo (já implementado): valida `status == PENDENTE` antes de transicionar para `CANCELADA`, e lança `IllegalStateException` fora disso. É o ponto de escrita do valor novo — precisa da regra "só `PENDENTE` cancela, `CANCELADA` é terminal", não é consumidor passivo. |
| `NotificacaoRepository.java:88-104` `cancelarPendentesDoIncidente` | **T** | Já implementado. `UPDATE ... SET status = CANCELADA WHERE status = PENDENTE`, com CAS deliberado contra a corrida do dispatcher (comentário no próprio arquivo, linhas 88-98: quem chega primeiro define o resultado, e as duas ordens são aceitáveis). É o segundo ponto de escrita do valor novo (via JPQL, não via entidade — o `cancelar()` de `Notificacao.java` não é chamado por este caminho em lote). |
| `NotificacaoRepository.java:106-110` `cancelarPendentesDoEpisodio` | **T** | Espelho do anterior para episódios de latência. |
| `NotificacaoRepository.java:112-118` `existeAberturaJaDespachada` | **T** | Novo: decide se a abertura já chegou ao Telegram (`ENVIANDO`/`ENVIADA`) antes de cancelar, para saber se um aviso de encerramento por manutenção é devido. Lógica nova sobre o conjunto de status, não passthrough. |
| `NotificacaoRepository.java:120-124` `existeAberturaJaDespachadaDoEpisodio` | **T** | Espelho do anterior para latência. |
| `NotificacaoController.java:41` `@RequestParam StatusNotificacao status` | E | Filtro de listagem exposto na API (`GET /api/v1/notificacoes?status=...`). O binding do Spring aceita `CANCELADA` automaticamente, sem mudança de código, (é o enum Java direto, não uma lista escrita à mão) — mas o ponto "entra" porque é onde um consumidor da API descobre que `CANCELADA` é um valor de filtro válido; sem documentação/teste, ninguém sabe que existe. |
| `NotificacaoService.java:110-128` `listar(...)` (filtro `Specification`) | E | Mesmo raciocínio do brief: filtro por status exposto ao usuário. `cb.equal(root.get("status"), status)` é genérico — funciona com `CANCELADA` sem alteração —, mas classificar como "entra" porque é o ponto que decide quais notificações aparecem na tela de histórico. |
| `NotificacaoResponse.java:16` campo `status` no DTO | F | Carrega o enum para serialização; Jackson grava o `name()` automaticamente. Não enumera nem ramifica. |
| `RelatorioController.java:22` `@RequestParam StatusNotificacao status` | E | Mesmo padrão do controller de notificações, agora em `/api/v1/relatorios/notificacoes`. |
| `RelatorioExportController.java:62` `@RequestParam StatusNotificacao status` | E | Mesmo padrão, na exportação CSV `/notificacoes/export`. |
| `RelatorioExportService.java:68-75` SQL `NOTIFICACOES` (`status=:status`) | F | Comparação de igualdade genérica com o parâmetro; `status='CANCELADA'` filtra corretamente sem qualquer mudança. |
| `RelatorioExportService.java:134-141` `notificacoes(...)` (linha do CSV) | F | `r.getString("status")` — passthrough de texto cru para a coluna do CSV. O CSV mostra `CANCELADA` literal, que é o comportamento correto para um export bruto: não há rótulo amigável a manter aqui. |
| `RelatorioService.java:82` `notificacoes(...)` (SQL + mapeamento) | F | Mesmo padrão: `status=:status` genérico e `r.getString("status")` cru no `HistoricoNotificacaoResponse`. Nenhuma lista de valores para atualizar. |
| `VisaoGeralPdfRepository.java:20-27` (`KPIS`, `notificacoes_falha`) | F | **Confirma o ponto do brief.** `count(*) ... where n.status='FALHA'` é um filtro literal, não uma enumeração; uma notificação `CANCELADA` nunca teria virado `FALHA`, então não é contada aqui — e é exatamente esse comportamento que justifica não tocar neste arquivo. Continua correto tanto para o "KPI de falhas" quanto para não inflar indevidamente esse número com cancelamentos, que são uma categoria semanticamente diferente de falha. |
| `DashboardIncidenteReadRepository.java:43-44,51-53,60,66-68` (CTE `EVENTO`, `notificacao_status`) | F (backend) | O `LEFT JOIN LATERAL` seleciona `nn.status` como texto cru para a coluna `notificacao_status`; o `MAPPER` (linha 92) faz `r.getString("notificacao_status")`, também passthrough. Nenhuma lista de valores no backend. A leitura do valor (rótulo/badge) acontece no frontend — ver `incidente-unificado-list.component.ts` abaixo. |
| `V9__create_notificacao.sql:19-22` `ck_notificacao_status`/`ck_notificacao_tipo_evento` originais | F / histórico | Já substituída pela `V19` (`DROP CONSTRAINT` + `ADD CONSTRAINT` com os valores novos). Migration executada: **nunca editar**; listada só para explicar a origem da constraint que a V19 recria. |
| `V10__add_notification_dispatch_queue.sql:3-5` `UPDATE ... WHERE status='PENDENTE'` | F / histórico | Backfill de execução única (`proxima_tentativa_em`) no momento em que essa coluna nasceu. Não roda de novo; `CANCELADA` não existia quando essa migration rodou e não precisa existir para ela continuar correta hoje. |
| `V19__...sql:62-65` `ck_notificacao_status` recriada com `'CANCELADA'` | **T** | O ponto de escrita da constraint do banco. Já executado (branch atual). Qualquer migration futura que precise tocar essa constraint de novo é uma nova versão — nunca editar a V19. |

### Backend — `TipoEventoNotificacao`

| Ponto | Classe | Justificativa |
|---|---|---|
| `TipoEventoNotificacao.java:4-10` declaração do enum | **T** | Fonte da verdade; já contém os dois valores novos com Javadoc explícito ("NUNCA usar INCIDENTE_FECHADO: ninguém resolveu nada"). |
| `Notificacao.java:47-48` campo `tipoEvento` | F | Mesma razão do campo `status`: `@Enumerated(EnumType.STRING)`, sem lista para manter. |
| `NotificacaoService.java:38-40,42-44,47-50,52-54` `criarParaIncidenteAberto/Fechado/LatenciaAlta/Normalizada` | F | Cada método fixa um `TipoEventoNotificacao` constante específico e nenhum dos quatro é um dos dois valores novos — eles continuam corretos sem saber que os dois novos existem, porque quem cria notificação de manutenção é um caminho separado (linha abaixo). |
| `NotificacaoService.java:65-72` `tratarEncerramentoPorManutencao(Incidente)` | **T** | Já implementado: decide, a partir do estado de despacho da abertura (`existeAberturaJaDespachada`), se cria uma notificação `INCIDENTE_ENCERRADO_MANUTENCAO` — com a matriz de decisão documentada em comentário (linhas 57-64: `PENDENTE`→cancela sem aviso, `ENVIANDO`/`ENVIADA`→aviso, `FALHA`→nada). É o ponto central de negócio dos dois enums novos juntos. |
| `NotificacaoService.java:74-81` `tratarEncerramentoPorManutencao(MonitorEpisodioLatencia)` | **T** | Espelho do anterior para `LATENCIA_ENCERRADA_MANUTENCAO`. |
| `NotificacaoMessageBuilder.java:15-47` `construir(Incidente, TipoEventoNotificacao)` | **T** | Já implementado com ramo próprio (linhas 19-27): `INCIDENTE_ENCERRADO_MANUTENCAO` usa cabeçalho "🔧 Incidente encerrado: equipamento entrou em manutenção", explicitamente **não** reaproveitando o texto de `INCIDENTE_FECHADO`. Ponto de atenção que sobrevive à implementação atual: o bloco de `Fim`/`Duração` (linhas 39-45) só dispara para `tipoEvento == INCIDENTE_FECHADO` — uma notificação de manutenção não carrega esses dois campos na mensagem do Telegram, mesmo quando `incidente.getEncerradoEm()` já está preenchido. Isso pode ser proposital (o texto já deixa claro que não houve resolução) ou uma lacuna; registrar para quem for validar o conteúdo da mensagem em produção. |
| `NotificacaoMessageBuilder.java:53-83` `construirParaEpisodio(...)` | **T** | Mesmo padrão para `LATENCIA_ENCERRADA_MANUTENCAO` (linhas 57-65), mesmo ponto de atenção sobre `Fim`/`Duração` ausentes (linhas 75-81 só disparam para `LATENCIA_NORMALIZADA`). |
| `NotificacaoController.java:43` `@RequestParam TipoEventoNotificacao tipoEvento` | E | Filtro de listagem exposto na API; mesmo raciocínio do `status` acima — binding automático, mas é o ponto de descoberta do valor pelo consumidor da API. |
| `NotificacaoService.java:110-128` filtro `tipoEvento` em `listar(...)` | E | Mesma razão do filtro por `status`. |
| `NotificacaoResponse.java:15` campo `tipoEvento` | F | DTO passthrough. |
| `RelatorioController.java:22`, `RelatorioExportController.java:62` `tipoEvento` | E | Mesmo padrão dos dois pontos de `status` já classificados acima, agora para `tipoEvento`. |
| `RelatorioExportService.java` SQL `NOTIFICACOES` + linha do CSV | F | `tipo_evento=:tipo` genérico e `r.getString("tipo_evento")` cru — mesmo raciocínio do `status`. |
| `RelatorioService.java:82` | F | Mesmo raciocínio. |
| `V9__create_notificacao.sql:19` `ck_notificacao_tipo_evento` original (só 2 valores) | F / histórico | Substituída pela V19. Nunca editar. |
| `V15__create_episodio_latencia.sql:48-58` `ck_notificacao_tipo_evento`/`ck_notificacao_evento_coerente` (4 valores) | F / histórico | Também substituída pela V19; documentada só como origem. |
| `V19__...sql:59` `ALTER COLUMN tipo_evento TYPE VARCHAR(40)` | **T** | Alargamento de coluna motivado especificamente por `INCIDENTE_ENCERRADO_MANUTENCAO` ter 30 caracteres, no limite exato do `VARCHAR(30)` anterior (comentário da própria migration, linhas 57-58). Sem essa mudança, a inserção do valor novo estouraria em runtime, não em CHECK — é o tipo de ponto que "buscar-e-substituir cego" ignoraria. |
| `V19__...sql:67-72` `ck_notificacao_tipo_evento` recriada | **T** | Adiciona os dois valores novos à lista permitida. |
| `V19__...sql:74-82` `ck_notificacao_evento_coerente` recriada | **T** | Amarra cada tipo novo à âncora certa (`INCIDENTE_ENCERRADO_MANUTENCAO`→`incidente_id`, `LATENCIA_ENCERRADA_MANUTENCAO`→`episodio_latencia_id`). Comentário da migration (linhas 74-76) explicita por que dois tipos novos e não um só: um tipo servindo as duas âncoras afrouxaria a constraint nas duas direções. |
| `DashboardIncidenteReadRepository.java` (comentário linha 32, CTE) | F | O comentário cita `INCIDENTE_ABERTO`/`INCIDENTE_FECHADO` só para explicar por que a notificação vem por `LATERAL` (evitar duplicar linha). Não lê o enum em código executável; a query real (`nn.status`, não `nn.tipo_evento`) nem filtra por tipo de evento. |

### Frontend — `NotificationStatus` / `NotificationEventType`

> Os enums do frontend **ainda não têm** os valores novos (conferido nesta data). As linhas abaixo
> descrevem o que acontece **quando** a tarefa que estende `api-enums.ts` rodar — é a razão de
> existirem nesta auditoria mesmo sem o valor presente ainda: a tarefa 5+ precisa saber, antes de
> tocar o enum, exatamente quais arquivos o TypeScript vai forçar a mudar e quais vão passar em
> silêncio.

| Ponto | Classe | Justificativa |
|---|---|---|
| `core/models/api-enums.ts:34-39` `NotificationEventType` | E | Fonte do enum no frontend; ainda faltam `IncidentClosedMaintenance`/`INCIDENTE_ENCERRADO_MANUTENCAO` e `LatencyNormalizedMaintenance`/`LATENCIA_ENCERRADA_MANUTENCAO`. |
| `core/models/api-enums.ts:47-52` `NotificationStatus` | E | Ainda falta `Cancelled`/`CANCELADA`. |
| **`shared/status-badge/status-badge.component.ts:7`** `type DisplayStatus = ... \| NotificationStatus \| ...` | **E — ponto em destaque** | Ver seção dedicada abaixo. |
| **`shared/status-badge/status-badge.component.ts:11`** `LABELS: Record<DisplayStatus, string>` | **E — ponto em destaque** | Idem. |
| **`shared/status-badge/status-badge.component.ts:12`** `TONES: Record<DisplayStatus, string>` | **E — ponto em destaque** | Idem. |
| `features/notificacoes/notificacao-detail.component.ts:11-16` `ROTULOS_EVENTO: Record<NotificationEventType, string>` | E | Mesmo padrão de proteção do compilador que o `status-badge`, mas restrito a `NotificationEventType`: acrescentar os dois valores novos ao enum quebra a compilação deste arquivo até as duas chaves novas entrarem no `Record`. |
| `features/notificacoes/notificacao-list.component.ts:12-17` `ROTULOS_EVENTO` (duplicado) | E | Mesmo `Record` exhaustivo, mesma proteção, arquivo diferente — os dois mapas de rótulo de evento estão duplicados entre `notificacao-detail` e `notificacao-list`; qualquer tarefa futura que preencha um precisa lembrar do outro (o TypeScript não vai lembrar por ela, são dois `Record`s independentes). |
| `features/incidentes/timeline/timeline.ts:313-321` `rotuloDaNotificacao(tipo)` | E | Enumera rótulo por `switch`, mas **tem `default`** (`return \`Notificação: ${tipo}\`;`) — ver seção "ponto sem rede de proteção" abaixo. Precisa de rótulo amigável mesmo assim; só não quebra build se ninguém adicionar. |
| `features/incidentes/timeline/timeline.ts:323-326` `detalheDaNotificacao(notificacao)` | F | `` `${notificacao.canal} · ${notificacao.status.toLowerCase()}` `` — usa o valor bruto do status, não uma tabela. Funciona para `CANCELADA` sem mudança (mostra "cancelada"); não é ponto de enumeração. |
| `features/incidentes/incidente-unificado-list.component.ts:296-301` `statusNotificacao(linha)` | F | Valida a string crua contra `Object.values(NotificationStatus)` e devolve `null` (→ "—") se estiver fora do domínio conhecido — comentário do próprio arquivo confirma a intenção. Uma vez que `CANCELADA` entrar no enum do frontend, esta função passa a aceitá-la **sem qualquer edição própria**; é o `status-badge` (acima) que precisa do rótulo, não esta função. |
| `features/incidentes/incidente-unificado-list.component.html:61,64,71` `<app-status-badge [status]="...">` | E | Consumidor do componente compartilhado; depende de `LABELS`/`TONES` já cobertos acima — não precisa de mudança própria além do que o `status-badge` já exige. |
| `features/notificacoes/notificacao-list.component.html` (linha única, filtro `STATUS`/`EVENTO`) | E | `<option>` escritas à mão (`PENDENTE`, `ENVIANDO`, `ENVIADA`, `FALHA` / `INCIDENTE_ABERTO`, `INCIDENTE_FECHADO`, `LATENCIA_ALTA`, `LATENCIA_NORMALIZADA`). Sem proteção do compilador — é HTML, não `Record` tipado; adicionar o valor ao enum não obriga a adicionar a opção aqui. Precisa de edição manual deliberada, ou o filtro "Todos" continua funcionando mas o usuário nunca consegue filtrar só por `CANCELADA`/eventos de manutenção pela combo. |
| `features/relatorios/relatorios.component.html:52` filtros de notificação (`Status`, `Evento`) | E | Mesmo padrão de `<option>` manuais, e **já hoje incompletas** mesmo para os valores atuais: o filtro `Evento` só lista `IncidentOpened`/`IncidentClosed`, faltando `HighLatency`/`LatencyNormalized` que já existem no enum. Pré-existente, independente desta mudança, mas relevante: se o padrão for "esquecer de atualizar o `<select>`", os dois eventos novos entram na mesma lacuna. |
| `features/relatorios/relatorios.component.ts:149,151` `protected readonly NotificationStatus/NotificationEventType` | F | Apenas reexporta o enum para o template usar `[value]="NotificationStatus.X"`; não enumera nada por si — a enumeração real está no `.html` (linha acima). |
| `core/models/relatorio.ts:90,92,205-206` campos `status`/`tipoEvento` em DTOs de relatório | F | Tipagem de campo (`NotificationStatus \| null`, etc.), sem lógica. Aceita o valor novo assim que o tipo TS for estendido, sem mudança própria. |
| `core/models/notificacao.ts:13,15` `NotificacaoResponse`/`NotificacaoListQuery` | F | Mesma razão: tipagem de campo/parâmetro, sem enumeração nem ramo. |

## Ponto em destaque: `status-badge.component.ts` quebra o build de propósito

`shared/status-badge/status-badge.component.ts:7-12` declara:

```ts
type DisplayStatus = MonitorOperationalStatus | EquipmentOperationalStatus | UnitOperationalStatus
  | MeasurementStatus | IncidentStatus | NotificationStatus | BotVerificationStatus
  | AnalyticState | MonitoringWindowQuality;
export const LABELS: Record<DisplayStatus, string> = { ... };
const TONES: Record<DisplayStatus, string> = { ... };
```

`Record<DisplayStatus, string>` no TypeScript é **exaustivo**: o compilador exige uma chave para
cada membro de cada enum da união. No dia em que `NotificationStatus.Cancelled = 'CANCELADA'` for
acrescentado a `api-enums.ts`, `status-badge.component.ts` para de compilar até `CANCELADA` ganhar
uma entrada em `LABELS` e outra em `TONES` — nas duas, porque são dois `Record`s independentes e o
TypeScript checa cada um separadamente.

Isso não é um obstáculo a contornar, é a rede de proteção que sustenta a regra "não crie badge
local" registrada na memória do projeto (`badges-fora-do-componente-compartilhado.md`, que já
documenta a mesma dinâmica para `CALCULADO`/`PRECISA`/`INFERIDA`). Sem essa quebra de build, seria
possível — e, por experiência do próprio projeto, aconteceria — alguém precisar de um badge para
`CANCELADA` em alguma tela, não encontrar a entrada no componente compartilhado, e criar um badge
local ad-hoc só para aquela tela. Com o `Record` exaustivo, isso é literalmente impossível: o build
já quebrou antes de qualquer tela nova existir, e a única correção possível é estender o
componente compartilhado.

O mesmo mecanismo protege `NotificationEventType` em dois lugares (`notificacao-detail.component.ts`
e `notificacao-list.component.ts`, ambos com `Record<NotificationEventType, string>`), mas **não**
em `timeline.ts` — ver próxima seção.

## Ponto sem rede de proteção: `timeline.ts:313-321`

`rotuloDaNotificacao` é a única função de rótulo, das quatro encontradas no frontend, que usa
`switch` com `default` em vez de um `Record` exaustivo:

```ts
export function rotuloDaNotificacao(tipo: NotificationEventType): string {
  switch (tipo) {
    case NotificationEventType.IncidentOpened: return 'Notificação: incidente aberto';
    case NotificationEventType.IncidentClosed: return 'Notificação: incidente fechado';
    case NotificationEventType.HighLatency: return 'Notificação: latência alta';
    case NotificationEventType.LatencyNormalized: return 'Notificação: latência normalizada';
    default: return `Notificação: ${tipo}`;
  }
}
```

Quando os dois eventos de manutenção entrarem no enum, este arquivo **continua compilando e
continua rodando** sem erro — a timeline do incidente mostraria literalmente
"Notificação: INCIDENTE_ENCERRADO_MANUTENCAO" para o usuário, em vez de travar o build como os
outros três pontos. É "entra" na classificação (precisa de rótulo amigável), mas quem for
implementar a tarefa 5+ precisa tratá-lo como item de checklist manual — o TypeScript não vai
lembrar por ela aqui.

## Observações sobre os arquivos de teste

Os specs abaixo fixam os valores atuais dos dois enums e vão precisar de novos casos quando a
tarefa que estende `api-enums.ts` rodar. Não entram na tabela de classificação (são sobre
comportamento de teste, não de produção), mas ficam registrados porque o grep os trouxe e a
instrução é não descartar sem examinar:

- `notificacao-list.component.spec.ts` — fixture cobre as 4 combinações atuais de `status`.
- `notificacao-detail.component.spec.ts`, `timeline.spec.ts` — usam `NotificationEventType`/`NotificationStatus` atuais como dado de fixture.
- `notificacao-api.service.spec.ts`, `relatorio-api.service.spec.ts` — verificam serialização de query params com os valores atuais.
- `relatorios.component.spec.ts` — cobre os filtros de notificação da tela de Relatórios com os valores atuais.

Nenhum desses precisa mudar **agora** (o frontend está fora do escopo desta tarefa), mas a tarefa
que estender `api-enums.ts` deveria tocar todos eles, não só os arquivos de produção.

## Contagem

Contagem por linha de tabela (as duas tabelas do backend somadas + a do frontend), conferida por
grep nas próprias marcações da classificação:

- **fica de fora**: 27 pontos (a maioria no backend — dispatcher, CAS de status, DTOs passthrough,
  SQL de relatório/export genérico, migrations históricas já substituídas pela V19 — e 3 no
  frontend: `detalheDaNotificacao`, `statusNotificacao`, e os DTOs de tipagem em `relatorio.ts`/`notificacao.ts`).
- **entra**: 18 pontos (7 no backend — filtros de `status`/`tipoEvento` em `NotificacaoController`,
  `RelatorioController`, `RelatorioExportController`, `NotificacaoService.listar` — e 11 no
  frontend, incluindo os 3 pontos em destaque de `status-badge.component.ts` e os dois
  `Record<NotificationEventType, string>` duplicados).
- **tratamento próprio**: 14 pontos, todos no backend, e **todos já implementados** no estado atual
  do branch (não são lacunas a fechar, são o que a tarefa em paralelo já fechou): `cancelar()`,
  `cancelarPendentesDoIncidente/Episodio`, `existeAberturaJaDespachada(DoEpisodio)`,
  `tratarEncerramentoPorManutencao` (dois overloads), os dois ramos novos de
  `NotificacaoMessageBuilder`, e os elementos da `V19` (alargamento de coluna, as duas `CHECK`
  recriadas, e a migration em si como ponto de escrita histórico).

## Preocupações a observar

1. **Mensagem de manutenção sem `Fim`/`Duração`.** Em `NotificacaoMessageBuilder`, tanto
   `construir` quanto `construirParaEpisodio` só anexam `Fim`/`Duração` quando o tipo é exatamente
   `INCIDENTE_FECHADO`/`LATENCIA_NORMALIZADA` — os dois ramos de manutenção não incluem essas
   linhas mesmo quando `encerradoEm` já está preenchido. Pode ser proposital; não é possível
   confirmar pela leitura do código sozinha. Quem validar o texto real da mensagem do Telegram em
   produção deveria decidir explicitamente se isso fica assim.
2. **`timeline.ts:319` não vai quebrar quando devia chamar atenção.** É o único dos quatro pontos de
   rótulo do frontend sem proteção de compilador; precisa entrar num checklist manual explícito da
   tarefa que estender os enums do frontend, porque nada vai lembrar sozinho.
3. **Dois `Record<NotificationEventType, string>` duplicados** (`notificacao-detail.component.ts` e
   `notificacao-list.component.ts`) fazem a mesma tradução tipo→rótulo com o mesmo texto. Cada um
   quebra o build independentemente, então a tarefa 5+ vai precisar tocar nos dois — não é um lugar
   só. Não é escopo desta auditoria propor extrair um helper comum, só registrar que existem dois.
4. **Filtro de eventos de `relatorios.component.html` já está incompleto hoje**, antes de qualquer
   valor novo: só lista `IncidentOpened`/`IncidentClosed`, faltando os dois de latência que já
   existem. Se o padrão de "esquecer o `<select>`" se repetir, os dois eventos de manutenção somam a
   uma lacuna pré-existente, não criam uma nova.
5. **Frontend está atualmente inconsistente com o backend já implementado**: o backend já cria
   notificações `INCIDENTE_ENCERRADO_MANUTENCAO`/`LATENCIA_ENCERRADA_MANUTENCAO` e pode marcar
   `CANCELADA` (via `tratarEncerramentoPorManutencao`, já mergeado neste branch), mas o frontend
   ainda não reconhece nenhum dos três valores. Até a tarefa do frontend rodar, essas notificações
   apareceriam nas telas atuais como: badge de status inexistente (bloqueado hoje só porque o
   backend ainda não grava `CANCELADA` em produção — mas já pode gravar em qualquer ambiente que
   suba este branch) e rótulo de evento cru em `timeline.ts` (`INCIDENTE_ENCERRADO_MANUTENCAO`
   literal). Isso não é um bug desta auditoria nem desta tarefa, mas é uma janela real entre "backend
   grava o valor" e "frontend sabe exibi-lo" que quem for sequenciar as tarefas 5-14 precisa
   considerar — idealmente o frontend não fica muito tempo atrás em ambientes onde o dispatcher e o
   motor de manutenção já estão ativos.

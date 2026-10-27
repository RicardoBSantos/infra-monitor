# Manutenção agendada F3 — Evidências da F3

Spec: `Docs/superpowers/specs/2026-10-26-manutencao-agendada-f3-design.md` (§5 corridas, §6 auditoria, §9 exercício).
Decisões: MA27–MA36 em `Docs/manutencao-agendada-architecture/manutencao-agendada-decisoes.md`.
Auditoria dos call sites: [`manutencao-f3-auditoria-enums.md`](manutencao-f3-auditoria-enums.md).

Datas de 2026-10-26, Docker local, worktree `infra-monitor-wt-f3` (branch `feat/manutencao-f3`). Onde um número vem de
uma tarefa específica, a tarefa está citada.

## Bug do log do dispatcher (Task 2) — saída vermelha e reversão

`NotificationDispatcher.process` lia `notification.getIncidente().getId()` nos dois logs (sucesso e falha). Com âncora que
não é incidente (latência desde a F1, janela e sessão manual agora) o `getIncidente()` é nulo: NPE **depois** de
`complete(success)`. O `catch` chamava `complete(failure)`, que não acha mais a linha ENVIANDO e sai: a notificação ficava
ENVIADA e o log dizia "Erro interno". Correção: `ancora={}` com `Notificacao.descreverAncora()`.

Teste: `NotificationDispatcherTest` (`OutputCaptureExtension`): `envioDeLatenciaNaoLogaErroInterno`,
`falhaDeLatenciaLogaAncora`, `envioDeJanelaNaoLogaErroInterno`.

```
$ ./mvnw test -Dtest=NotificationDispatcherTest        # RED, antes da correção
09:11:22.594 [pool-2-thread-1] ERROR ...NotificationDispatcher -- Erro interno ao processar notificacao 1: NullPointerException
09:11:22.786 [pool-3-thread-1] ERROR ...NotificationDispatcher -- Erro interno ao processar notificacao 1: NullPointerException
09:11:22.823 [pool-5-thread-1] ERROR ...NotificationDispatcher -- Erro interno ao processar notificacao 1: NullPointerException
[ERROR] NotificationDispatcherTest.envioDeJanelaNaoLogaErroInterno:123
[ERROR] NotificationDispatcherTest.envioDeLatenciaNaoLogaErroInterno:92
[ERROR] NotificationDispatcherTest.falhaDeLatenciaLogaAncora:104
  not to contain: "Erro interno ao processar notificacao"
[ERROR] Tests run: 5, Failures: 3, Errors: 0, Skipped: 0

$ ./mvnw test -Dtest=NotificationDispatcherTest        # GREEN, com a correção
INFO  NotificationDispatcher -- Telegram enviado: notificationId=1, ancora=manutencao=41, tipoEvento=MANUTENCAO_INICIADA, tentativa=1
INFO  NotificationDispatcher -- Telegram enviado: notificationId=1, ancora=episodioLatencia=3, tipoEvento=LATENCIA_ALTA, tentativa=1
WARN  NotificationDispatcher -- Telegram falhou: notificationId=1, ancora=episodioLatencia=3, tipoEvento=LATENCIA_ALTA, tentativa=1
INFO  NotificationDispatcher -- Telegram enviado: notificationId=1, ancora=incidente=20, tipoEvento=INCIDENTE_ABERTO, tentativa=1
[INFO] Tests run: 5, Failures: 0, Errors: 0, Skipped: 0
```

Reversão (correção guardada com `git stash push -- NotificationDispatcher.java`, mesmo comando, `git stash pop` em
seguida): `Tests run: 5, Failures: 3` com as mesmas três linhas `Erro interno ... NullPointerException`.

Limite do teste: usa mocks. A prova com a entidade real e o proxy lazy da âncora de janela está em
`FilaAnuncioManutencaoPostgresIntegrationTest.dispatcherLogaAncoraDeJanelaComEntidadeReal` (Task 5).

## Fila e entrega do início (Task 5) — provas de reversão

Teste: `notificacao/FilaAnuncioManutencaoPostgresIntegrationTest` (PostgreSQL 16 real, `@RequerDocker`, 16 casos). Cobre
a ordem da fila (MA33), as quatro saídas de `EntregaInicio` (MA32) para janela e para sessão manual, a reserva vencida e o
`ON CONFLICT` das âncoras novas.

Revisão da Task 5 achou que `releaseStaleSending` não gasta tentativa, então uma reserva vencida voltava com
`tentativas = 0` e o fim diria "não foi entregue" com falsa certeza (spec §2.4, correção de 2026-10-26). A correção grava
a marca em `erro`; as reversões abaixo valem para o código **depois** dela.

Cada reversão aplicada localmente, restaurada em seguida, `./mvnw -q test -Dtest=FilaAnuncioManutencaoPostgresIntegrationTest`:

| Reversão | Resultado |
|---|---|
| (a) `NOT EXISTS` de `findIdsReadyForDispatch` neutralizado | `Tests run: 16, Failures: 1` — `fimNaoFicaProntoComInicioPendenteOuEnviando:102 [inicio PENDENTE]` |
| (b) `resolverEntrega` devolve sempre `ENTREGUE` | `Failures: 5` — `encerradaComInicioPendenteSemTentativaCancelaEDizNaoEntregue`, `encerradaComInicioFalhaDizTalvez`, `inicioDevolvidoPorReservaVencidaDizTalvez`, `encerradaComInicioPendenteComTentativaDizTalvez`, `manualEncerradaSegueAMesmaRegra` |
| (c) marca de `erro` removida de `releaseStaleSending` | `Failures: 1` — `inicioDevolvidoPorReservaVencidaDizTalvez:211` |

Execução de cobertura da correção: `./mvnw test -Dtest='FilaAnuncioManutencaoPostgresIntegrationTest,NotificacaoServiceTest,NotificationDispatchStateServiceTest,NotificationDispatcherTest'`
→ `Tests run: 28, Failures: 0, Errors: 0, Skipped: 0`.

## Anúncios da janela (Task 7)

Teste: `manutencao/ManutencaoAnuncioPostgresIntegrationTest` (`@RequerDocker`, 18 casos): texto de início e fim por
igualdade exata, demais por linhas-chave; `created_at` da linha = instante do CAS. Os caminhos "não anuncia" (cancelar,
expirar, editar AGENDADA) passam antes e depois por definição; o que os torna significativos são os positivos vizinhos
no mesmo código.

RED da implementação ausente: `Tests run: 17, Failures: 7, Errors: 7` (nenhuma linha de anúncio existia).

Revisão da Task 7, duas correções (MA31 e MA28), com RED próprio no código anterior ao fix (`df96e6d`):

```
$ ./mvnw -q test -Dtest='ManutencaoAnuncioPostgresIntegrationTest'     # testes novos sobre df96e6d
Tests run: 18, Failures: 1, Errors: 1
janelaComAnuncioQuebradoNaoBloqueiaAsDemais <<< ERROR!  java.lang.IllegalStateException: anuncio quebrado
ativacaoNaCriacaoNuncaDizAtrasada <<< FAILURE!  not to contain: "(previsto"
   (texto: "Início: 26/10/2026 13:34 (previsto 13:32 — sistema esteve fora)")
```

GREEN depois de `6766b27`: `ManutencaoAnuncioPostgresIntegrationTest` 18/18, `ReconciliadorManutencaoPostgresIntegrationTest` 7/7,
`ReconciliadorManutencaoTest` 2/2, corridas da F1 210/210 e da F2 152/152.

**Efeito colateral nas corridas da F2.** O CAS por janela e o anúncio dentro da transação mudaram os tempos do
reconciliador. Duas corridas passaram a cair num único desfecho (ainda verdes, mas um ramo deixava de ser exercitado):
`corrida-editar-ativar` (C1 da F2) ficou 30/30 EDICAO com atraso 0..1 ms; `corrida-ativacao-motor` já estava 30/30
INC_PRIMEIRO. Recalibradas **sem mudar as asserções**: `ATRASO_C1_MS` para 3 (medido: 0..3 → 14 EDICAO / 16 JOB; 0..6 →
4/26) e `ATRASO_MOTOR_MS` para 20 (0..20 → 18 INC / 12 MANUT; 0..40 → 6/24). Moral: o tempo do reconciliador faz parte da
calibração de toda corrida que o inclui; mexer nele pede reconferir as distribuições.

## Corridas das Tasks 6 e 8 e provas de reversão

Teste: `manutencao/AnuncioManutencaoConcorrenciaPostgresIntegrationTest` (`@RequerDocker`, `@SpringBootTest`), mesmo
idioma da F1/F2: cada corrida `@RepeatedTest(30)`, duas threads reais alinhadas por `CyclicBarrier(2)`, atraso aleatório
pós-barreira calibrado (medições em comentário nas constantes), `[corrida-<nome>] desfecho=<RÓTULO>`; `ILEGITIMO` falha, e
exceção em qualquer thread também é `ILEGITIMO`. Mais um teste determinístico (herdado da revisão da Task 6) sem corrida:
`janelaAtivaComFlagAindaFalsoBotaoNaoCitaJanelaEFechaPeloBotao` — janela ATIVA cobrindo o equipamento, `em_manutencao` ainda
false, incidente aberto: o texto do botão **não** cita a janela ("Sem fim previsto: volta só quando alguém encerrar.") e o
incidente é fechado com `fechado_por` = quem apertou o botão.

### Corridas (suíte completa, `./mvnw test`, 2026-10-26)

| # | Corrida | Desfechos legítimos | Distribuição (30) | ILEGITIMO | Atraso pós-barreira |
|---|---|---|---|---|---|
| 1 | `conclusaoJobVsEncerrarAgora` — job conclui × "Encerrar agora" | AUTO (job venceu: 1 ENCERRADA "como previsto") · OPER (pessoa venceu: "antecipado por X"); "antecipado" ⇔ `encerrada_por_id` nos dois sentidos | 4 AUTO / 26 OPER | 0 | encerrar 0..1 ms |
| 2 | `alterarFimVsConclusao` — "Alterar fim" × job conclui | PRORROGOU (FIM_ALTERADO + ENCERRADA "após prorrogação") · RECUSADO (409 + ENCERRADA "como previsto"); nunca FIM_ALTERADO sem a alteração registrada | 27 PRORROGOU / 3 RECUSADO | 0 | alterar fim 0..3 ms |
| 3 | `fimVsDispatcherReservaInicio` — fim da janela × dispatcher reserva o início | CANCELOU (início CANCELADA + "não foi entregue") · RESERVOU (início ENVIANDO/ENVIADA + fim normal) | 2 CANCELOU / 28 RESERVOU | 0 | reserva 0..7 ms |
| 4 | `doisCliquesIniciar` — dois "Iniciar manutenção" | 1 sessão, 1 `MANUTENCAO_MANUAL_INICIADA`, nenhuma exceção; rótulo = dono da sessão | 25 PRIMEIRO_CLIQUE / 5 SEGUNDO_CLIQUE | 0 | 2º clique 0..2 ms |
| 5 | `iniciarManualVsAtivacaoJanela` — botão × ativação da janela, mesmo equipamento | 1 sessão, 1 MANUAL_INICIADA, 1 MANUTENCAO_INICIADA; texto cita a janela ⇔ efeitos de entrada **não** rodaram pelo botão (`fechado_por` = criador da janela) | 23 BOTAO_PRIMEIRO / 7 JANELA_PRIMEIRO | 0 | botão 0..15 ms |

Execução isolada da classe logo após a calibração: 21 AUTO/9 OPER; 20 PRORROGOU/10 RECUSADO; 17 CANCELOU/13 RESERVOU;
22/8; 7 BOTAO/23 JANELA. A divisão se move com a carga da máquina (a suíte inteira inclinou a 1 para OPER e a 3 para
RESERVOU), mas os dois desfechos legítimos apareceram em toda execução. Calibração do atraso (pares AUTO/OPER, PRORROGOU/RECUSADO, CANCELOU/RESERVOU, 1º/2º clique, BOTAO/JANELA; medições também nos comentários das constantes): corrida 1 — encerrar 0..4 → 26/4, 0..2 → 21/9, 0..1 → 21/9 (ficou 1); corrida 2 — 0..4 → 11/19 (duas vezes), 0..3 → 20/10 (ficou 3); corrida 3 — 0..4 → 3/27, 0..10 → 21/9, 0..7 → 17/13 (ficou 7); corrida 4 — 0..2 → 24/6, 21/9, 22/8 (ficou 2); corrida 5 — 0..8 → 23/7, 0..15 → 14/16 e 7/23 (ficou 15). Classe isolada: 151/151 (5 × 30 + 1).

### Provas de reversão

Cada reversão é edição local, nunca commitada; `git diff --stat -- infra-monitor-backend/src/main` vazio depois de cada
restauração e antes do commit. Comando, a partir de `infra-monitor-backend/`:
`./mvnw -q -Dtest='AnuncioManutencaoConcorrenciaPostgresIntegrationTest#<metodo>' test`.

**(1) ENCERRADA fora do ramo vencedor do CAS** (`ManutencaoAgendadaService.encerrar`: `anuncio.anunciarFim` movido para
**antes** de `if (!cobertura.encerrar(...)) return false;`) — `conclusaoJobVsEncerrarAgora` → **VERMELHO, 2/30**:

```
[corrida-conclusao-encerrar] desfecho=ILEGITIMO situacao=CONCLUIDA encerradaPor=2 recusado=false encerradas=1 antecipado=false comoPrevisto=true falhas=[]
[ERROR] Tests run: 30, Failures: 2, Errors: 0, Skipped: 0
```

A pessoa venceu o CAS, mas o texto foi lido antes: "como previsto" com `encerrada_por_id` preenchido.

*Variante 1b, registrada como evidência da segunda guarda:* anunciar **depois** do CAS sem checar o resultado
(`boolean venceu = cobertura.encerrar(...); anuncio.anunciarFim(...); return venceu;`) → **fica verde** (18 AUTO / 12
OPER). Quem perde só anuncia depois que o vencedor commitou (lock de linha), lê o estado já gravado, e o INSERT bate em
`uq_notificacao_manutencao_evento` + `ON CONFLICT DO NOTHING`. O índice único absorve a duplicata. Só "anunciar antes do CAS"
faz o texto mentir. A guarda é, portanto, **dupla** (ramo do CAS + índice único), no mesmo idioma de C1/C2 da F2.

**(2) FIM_ALTERADO antes do CAS de versão** (`ManutencaoAgendadaService.alterarFim`):

- *2a, literal* (dentro da transação, depois de `travar` e antes de `gravarFim`) → **verde** (21 PRORROGOU / 9 RECUSADO).
  Sob o lock de `travar`, `gravarFim` não pode falhar, e se `travar` falha a exceção desfaz o anúncio. Não é um defeito
  real; a reversão do spec §5 ("inserir FIM_ALTERADO antes do CAS") não pode ser feita dentro da transação.
- *2b* (anunciar em transação **própria**, antes do lock/CAS, com `fimAnterior` lido sem lock):
  ```java
  transacao.executeWithoutResult(s -> anuncio.anunciarFimAlterado(id,   // REVERSAO 2b
          repositorio.findById(id).orElseThrow().getFimPrevisto(), novoFim, usuarioId, agora));
  ```
  `alterarFimVsConclusao` → **VERMELHO, 30/30**:
  ```
  [corrida-alterar-fim-conclusao] desfecho=ILEGITIMO recusado=true fimAlterado=1 prorrogacoes=0 encerradas=1 aposProrrogacao=false comoPrevisto=true falhas=[]
  [ERROR] Tests run: 30, Failures: 30, Errors: 0, Skipped: 0
  ```

**(3) Entrega do início por leitura anterior ao UPDATE** (`InicioAnuncioRepository.cancelar`: `SELECT tentativas, erro ...
AND status = 'PENDENTE'` primeiro, depois o `UPDATE`, devolvendo a **leitura**, não o `RETURNING`) —
`fimVsDispatcherReservaInicio` → **VERMELHO, 2/30** (9 CANCELOU / 19 RESERVOU):

```
[corrida-fim-reserva-inicio] desfecho=ILEGITIMO inicio=ENVIANDO reservou=1 encerradas=1 naoEntregue=true talvezEntregue=false falhas=[]
[ERROR] Tests run: 30, Failures: 2, Errors: 0, Skipped: 0
```

O dispatcher reservou o início entre o SELECT e o UPDATE: o fim diz "não foi entregue" com o início ENVIANDO.

**(4) Sem o retorno idempotente** (`EstadoManutencaoEquipamento.iniciarManual`: removido
`if (travado.getManutencaoManual()) { return; }`) — `doisCliquesIniciar` → **VERMELHO, 30/30**:

```
[corrida-dois-cliques] desfecho=ILEGITIMO sessoes=1 abertas=1 avisos=1 falhas=[org.springframework.dao.DuplicateKeyException: PreparedStatementCallback; SQL [INSERT INTO manutencao_manual (equipamento_id, iniciada_em, iniciada_por_id) ...
... violates unique constraint "uq_manutencao_manual_aberta"
[ERROR] Tests run: 30, Failures: 30, Errors: 0, Skipped: 0
```

`uq_manutencao_manual_aberta` segura a segunda sessão, mas o segundo clique recebe erro (o usuário veria 500).

**(5) `jaEmManutencao` lido da cobertura em vez do flag travado** (`anuncio.anunciarInicio(sessao, equipamentoId,
cobertura.coberto(equipamentoId), agora)`; os efeitos continuam lendo `travado.getEmManutencao()`):

- `iniciarManualVsAtivacaoJanela` → **VERMELHO, 18/30** (12 JANELA_PRIMEIRO, 0 BOTAO_PRIMEIRO):
  ```
  [corrida-botao-ativacao] desfecho=ILEGITIMO citaJanela=true semFim=false fechadoPor=2 (botao=2, criador=1) sessoes=1 manuais=1 inicios=1 falhas=[]
  [ERROR] Tests run: 30, Failures: 18, Errors: 0, Skipped: 0
  ```
- `janelaAtivaComFlagAindaFalsoBotaoNaoCitaJanelaEFechaPeloBotao` (determinístico) → **VERMELHO**:
  ```
  Expecting actual: "🔧 EQUIPAMENTO EM MANUTENÇÃO MANUAL — alertas suspensos ...
    Já estava na janela #1 (até 26/10/2026 15:07); agora não volta sozinho no fim dela.
    Horários: UTC-03:00 (America/Sao_Paulo)"
  to contain: "Sem fim previsto: volta só quando alguém encerrar."
  [ERROR] AnuncioManutencaoConcorrenciaPostgresIntegrationTest.janelaAtivaComFlagAindaFalsoBotaoNaoCitaJanelaEFechaPeloBotao:362
  ```
  (No console os acentos saem como `?` por causa do codepage do Windows; o texto no banco está correto.)

**Achados do T8 sobre o desenho do spec.**

- Para 1 e 2 a reversão literal do spec §5 não deixa nada vermelho: o índice único (1b) e o lock de `travar` (2a) são
  segundas guardas. Ficou vermelho "anunciar antes do CAS" (1) e "anunciar em transação fora do lock" (2b); as duas
  variantes verdes estão registradas acima como evidência da segunda guarda, não escondidas.
- A condição `ILEGITIMO` da corrida 1 confere os **dois** sentidos de "antecipado por X ⇔ a pessoa venceu". O sentido que
  deixou a reversão (1) vermelha é exatamente o oposto do mais óbvio (`encerrada_por` preenchido + "como previsto").
- Nenhum defeito real foi encontrado no código de produção.

## Suítes

| Suíte | Resultado | Onde |
|---|---|---|
| Backend, com Docker (`./mvnw test`) | `Tests run: 1412, Failures: 0, Errors: 0, Skipped: 0`, BUILD SUCCESS, **zero** linhas `!!` | worktree `infra-monitor-wt-f3`, HEAD `1854b37` (Task 8). Era 1165 na F2. Trajetória: 1222 (T5), 1243 (T9), 1261 (T7 após o fix), 1412 (T8) |
| Frontend (`npx ng test --watch=false`) | 62 arquivos, **698/698** | Task 10, commit `16f74c9`; era 682 |
| `ng build` | OK; único aviso: orçamento de `mapa.component.scss` (preexistente) | Task 10 |

Notas de método:

- A Task 6 reportou 1235 numa **cópia isolada** do `infra-monitor-backend` (a árvore compartilhada não compilava os
  testes naquele momento por trabalho em andamento da Task 9); a Task 7 também validou em cópia (`git archive` + os arquivos
  dela, `diff -rq --strip-trailing-cr` idêntico ao worktree no commit). Os números oficiais da tabela são os do worktree real.
- O último número do backend (1412) vale para o HEAD `1854b37`. Reconfirmar no HEAD final (Task 12).
- Suíte verde com a linha `!! N classes puladas: Docker indisponivel.` **não** testou o banco; nenhuma das execuções
  citadas teve esse aviso.
- No checkout de trabalho do usuário, `ng test` falha em cerca de 235 specs só porque o `environment.ts` local aponta
  `apiUrl` para outro host (mesma nota da F2). Com o `environment.ts` versionado, passa.

## Pendências conhecidas

Achados menores das revisões, deliberadamente adiados (nenhum bloqueia a F3):

**Contrato e dados**

- Relatório de histórico: coluna de origem da sessão manual mostra só `#id` (o contrato do histórico traz o id da sessão, não
  o nome do equipamento). `NotificacaoListQuery` do front não tem `manutencaoId`/`manutencaoManualId` (sem tela que filtre).
- Relatório de histórico não filtra por janela/sessão; só mostra as colunas.
- Ordenação do histórico manual por `id desc` (spec dizia `iniciada_em desc, id desc`): o backfill não tem `iniciada_em`.
- A marca `erro = 'Reserva vencida devolvida a fila...'` aparece numa linha PENDENTE na tela de notificações; o front pode
  lê-la como falha. `marcarEnviada` a limpa; só permanece em CANCELADA/FALHA.
- "Encerrar agora" depois do fim previsto e antes do tick do job diz "antecipado" (a pessoa chegou antes do reconciliador).
- A Transicao de ativação usa o `inicio_previsto` lido antes do CAS (só afeta o log de atraso).
- `ativarDevidas` / `concluirVencidas` (lote) ficaram sem uso em produção; só um teste os chama.
- Trailer de co-autoria do commit `b8fd672` diz `Claude Sonnet 5.5`, o global-constraints cita Opus 5.5. Histórico não reescrito.

**Texto e formatação**

- `rodape(null)` lança NPE enquanto `hora(null)` devolve `-` (tolerante).
- `ANTECIPADO` com autor nulo imprimiria "null"; os chamadores da Task 7 sempre passam o autor (JOIN obrigatório).
- Rodapé do `FIM_ALTERADO` usa o `inicioPrevisto` como instante de referência de offset.
- `Notificacao.descreverAncora()` não tem guarda para entidade sem âncora (o banco nunca permite essa linha).
- Faltam testes do fallback de data completa em `horaRelativa`, da omissão de linhas nulas e de `segue=true` sem janela.

**Testes**

- As distribuições das corridas 1 e 3 são sensíveis à carga da máquina (2 a 4 de 30 no ramo minoritário na suíte
  completa) e nenhuma asserção exige que os **dois** rótulos apareçam; a Task 12 roda a classe isolada e registra a
  distribuição.
- Uma thread que passa do `join` de uma repetição pode vazar para a próxima repetição das corridas.
- O teste de CSV de notificações usa `@Order` com estado compartilhado entre os métodos.
- Assertion fraca no teste do Mapa para "Iniciar manutenção" em `.gaveta__acoes`.
- `manualAtivo` indo de `null` para `false` dispara uma segunda requisição do histórico no drawer (a primeira é cancelada).
- Faltam testes negativos de `ck_manutencao_manual_periodo` e `ck_manutencao_manual_encerrador`.
- O ramo `manutencaoManual=` de `descreverAncora()` não tem teste no dispatcher.
- Teste 400 do controller de notificações com mock `any()` não prova a regra das quatro âncoras (a regra está provada no
  serviço e na integração).
- A expressão de formatação de data repete-se em 4 testes do builder (extrair helper).
- `GET /equipamentos/{id}/manutencoes-manuais` não tem `@WebMvcTest` próprio; coberto por HTTP real nos testes de integração.
- Dois testes usam FQN/imports fora de ordem; `warn` de sessão ausente sem asserção; `@MockitoSpyBean` cria contexto próprio.
- `CoberturaManutencao`/`SessaoManutencaoManual` importam `notificacao.service.DadosAnuncio` (dependência mandada pelo plano).
- O predicado "janela ATIVA cobre o equipamento" existe em três cópias (`autorDaCobertura`/`janelaVigente`,
  `seguemEmManutencao`, `COBERTO_E`); cada uma comenta a fonte.
- Volume de notificações a medir: ver spec §8 (consulta SQL), após duas semanas em produção.

## Exercício no clone e e2e

Executado em 2026-10-26 (18:33–18:42 em America/Sao_Paulo), Task 12, código do HEAD `50eaee8` (jar empacotado desse commit).
A reconfirmação das suítes no HEAD final ficou com o controlador, numa corrida separada (não repetida aqui).

### Ambiente

| Peça | Valor |
|---|---|
| Banco | clone descartável da carga: container `inframonitor-f3-clone` (`docker run`, nunca compose), `127.0.0.1:5440`, db/usuário `inframonitor_f3`; restaurado de `pg_dump` do `inframonitor-carga`, na V22; a V23 rodou no boot do jar (`Migrating schema "public" to version "23 - add notificacao manutencao e manutencao manual"`, aplicada em 0,162 s) |
| Backend | jar da F3 na porta **8083**; motor ICMP, dispatcher, Telegram e agendador ligados; intervalo do agendador 15 s; `REPORT_TIMEZONE=America/Sao_Paulo`; admin de bootstrap próprio do clone (`f3.exercicio@inframonitor.local`, nome "Exercicio F3"); CORS só 4300 |
| Telegram | `TELEGRAM_API_BASE_URL=http://127.0.0.1:18443` (mock local), token e chat fictícios. `grep api.telegram.org env.sh` vazio (exit 1) antes de subir. Prova de que o jar falou com o mock: `GET /api/v1/notificacoes/telegram/configuracao` → `"bot":{"status":"VERIFICADO","username":"mock_f3_bot","botId":1}`, identidade que só o `getMe` do mock devolve |
| Mock | servidor HTTP Node que responde `getMe`/`sendMessage` como o Telegram e grava cada `sendMessage` (campo `text`) em JSONL |
| Front | `npx ng serve --port 4300` a partir do worktree; Playwright reescreve `localhost:8080` → `8083` (`e2e/api-porta.cjs`, `API_PORT=8083`) |

Não tocados: banco da carga `127.0.0.1:5436`, backend 8080 e front 4200 (nenhuma conexão, nem leitura). Senha do admin e
`JWT_SECRET` ficam fora deste documento.

### Escolha dos equipamentos

Excluídos por nome antes de tudo: Servidor AD Core (id 1), Gateway Servidores (id 2) e Swtich CPD (id 8, que no clone tem
um incidente RECONHECIDO e medições em falha). Usados: AP_IND_01 e AP_IND_02 (passo 1), **todos** os 6 de Sesc Indiaroba
(passo 2, unidade inteira) e ServidorADATA, Hotel Atalaia (passos 3 e 4; o mesmo equipamento, para o drawer mostrar as
duas sessões).

Critério, rodado no clone antes de cada passo (coluna `criterio` só diz APROVADO quando: ativo, `em_manutencao = false`,
zero incidente ABERTO/RECONHECIDO em qualquer monitor do equipamento, medições na última hora > 0 e todas SUCESSO, id fora
de 1/2/8):

```sql
select e.id, e.nome, u.nome as unidade, e.ativo, e.em_manutencao, e.manutencao_manual,
  (select count(*) from incidente i join monitor m on m.id=i.monitor_id
     where m.equipamento_id=e.id and i.status in ('ABERTO','RECONHECIDO')) as incid_abertos,
  (select count(*) from medicao d join monitor m on m.id=d.monitor_id
     where m.equipamento_id=e.id and d.executado_em > now()-interval '1 hour') as med_1h,
  (select count(*) from medicao d join monitor m on m.id=d.monitor_id
     where m.equipamento_id=e.id and d.executado_em > now()-interval '1 hour' and d.status='SUCESSO') as med_1h_sucesso,
  (select max(d.executado_em) from medicao d join monitor m on m.id=d.monitor_id where m.equipamento_id=e.id) as ultima_medicao,
  case when <todas as condições acima> and e.id not in (1,2,8) then 'APROVADO' else 'REPROVADO' end as criterio
from equipamento e join unidade u on u.id=e.unidade_id where e.id in (...) order by e.id;
```

Antes do passo 1:

```
           agora_utc
-------------------------------
 2026-10-26 21:35:29.871272+00

 id |   nome    |    unidade     | ativo | em_manutencao | manutencao_manual | incid_abertos | med_1h | med_1h_sucesso |        ultima_medicao         | criterio
----+-----------+----------------+-------+---------------+-------------------+---------------+--------+----------------+-------------------------------+----------
 12 | AP_IND_01 | Sesc Indiaroba | t     | f             | f                 |             0 |      2 |              2 | 2026-10-26 21:34:54.031305+00 | APROVADO
 13 | AP_IND_02 | Sesc Indiaroba | t     | f             | f                 |             0 |      2 |              2 | 2026-10-26 21:34:54.031305+00 | APROVADO
```

Antes do passo 2 (unidade Sesc Indiaroba tem 6 equipamentos, 6 ativos; AP_IND_01/02 já com medição SUCESSO **depois** de
saírem da janela do passo 1, às 21:36:09):

```
           agora_utc
-------------------------------
 2026-10-26 21:36:35.871888+00

 id |       nome        |    unidade     | ativo | em_manutencao | manutencao_manual | incid_abertos | med_1h | med_1h_sucesso |        ultima_medicao         | criterio
----+-------------------+----------------+-------+---------------+-------------------+---------------+--------+----------------+-------------------------------+----------
  7 | Servidor_IND      | Sesc Indiaroba | t     | f             | f                 |             0 |      3 |              3 | 2026-10-26 21:35:54.117425+00 | APROVADO
 10 | SW_IND            | Sesc Indiaroba | t     | f             | f                 |             0 |      3 |              3 | 2026-10-26 21:35:54.144247+00 | APROVADO
 11 | Roteador_Marvitel | Sesc Indiaroba | t     | f             | f                 |             0 |      3 |              3 | 2026-10-26 21:35:54.151188+00 | APROVADO
 12 | AP_IND_01         | Sesc Indiaroba | t     | f             | f                 |             0 |      3 |              3 | 2026-10-26 21:36:09.55844+00  | APROVADO
 13 | AP_IND_02         | Sesc Indiaroba | t     | f             | f                 |             0 |      3 |              3 | 2026-10-26 21:36:09.55844+00  | APROVADO
 14 | AP_IND_03         | Sesc Indiaroba | t     | f             | f                 |             0 |      3 |              3 | 2026-10-26 21:35:54.07767+00  | APROVADO
```

Antes do passo 3:

```
           agora_utc
------------------------------
 2026-10-26 21:38:55.83538+00

 id |     nome      |    unidade    | ativo | em_manutencao | manutencao_manual | incid_abertos | med_1h | med_1h_sucesso |        ultima_medicao         | criterio
----+---------------+---------------+-------+---------------+-------------------+---------------+--------+----------------+-------------------------------+----------
  6 | ServidorADATA | Hotel Atalaia | t     | f             | f                 |             0 |      5 |              5 | 2026-10-26 21:37:55.433936+00 | APROVADO
```

Antes do passo 4 (esperou-se uma medição nova, 21:39:56, posterior ao fim da sessão manual do passo 3):

```
           agora_utc
-------------------------------
 2026-10-26 21:40:09.342213+00

 id |     nome      |    unidade    | ativo | em_manutencao | manutencao_manual | incid_abertos | med_1h | med_1h_sucesso |        ultima_medicao         | criterio
----+---------------+---------------+-------+---------------+-------------------+---------------+--------+----------------+-------------------------------+----------
  6 | ServidorADATA | Hotel Atalaia | t     | f             | f                 |             0 |      7 |              7 | 2026-10-26 21:39:56.484676+00 | APROVADO
```

No passo 4, entre criar a janela e apertar o botão, o equipamento estava `em_manutencao = t, manutencao_manual = f` com a
janela #11 ATIVA; depois do botão, `t / t`; depois de encerrar o manual, `t / f` com a #11 ainda ATIVA. Nenhum incidente
foi aberto durante o exercício (únicos incidentes do dia: #4 FECHADO e #5 RECONHECIDO, ambos do monitor 8, Swtich CPD,
anteriores ao exercício).

### Roteiro e conferência

Tudo pela API com o JWT do admin do clone.

| # | Ação | Notificação | Evento | Status | Texto contra o §3 |
|---|---|---|---|---|---|
| 1a | `POST /manutencoes` EQUIPAMENTOS [12, 13] em Sesc Indiaroba, início agora, fim +20 min → janela **#9** ATIVA na hora | 10 | `MANUTENCAO_INICIADA` | ENVIADA (1 tentativa) | confere (`Escopo: 2 equipamentos — AP_IND_01, AP_IND_02`) |
| 1b | `PATCH /manutencoes/9/fim` +10 min (versão 1) | 11 | `MANUTENCAO_FIM_ALTERADO` | ENVIADA | confere (cabeçalho `⏱️ MANUTENÇÃO PRORROGADA`, `18:55 → 19:05`) |
| 1c | `PATCH /manutencoes/9/encerrar` | 12 | `MANUTENCAO_ENCERRADA` | ENVIADA | confere (`Término: antecipado por Exercicio F3 (previsto 19:05)`) |
| 2a | `POST /manutencoes` UNIDADE Sesc Indiaroba, início agora, fim +2 min → janela **#10** | 13 | `MANUTENCAO_INICIADA` | ENVIADA | confere (`Escopo: unidade inteira (6 equipamentos)`) |
| 2b | job concluiu a #10 às 21:38:37 (`encerrada_por_id` nulo) | 14 | `MANUTENCAO_ENCERRADA` | ENVIADA | confere (`Término: como previsto`) |
| 3a | `PATCH /equipamentos/6/manutencao/iniciar` → sessão manual **#1** | 15 | `MANUTENCAO_MANUAL_INICIADA` | ENVIADA | confere (`Sem fim previsto: volta só quando alguém encerrar.`) |
| 3b | `PATCH /equipamentos/6/manutencao/encerrar` | 16 | `MANUTENCAO_MANUAL_ENCERRADA` | ENVIADA | confere, com a observação do `IP:` abaixo |
| 4a | `POST /manutencoes` EQUIPAMENTOS [6] em Hotel Atalaia, início agora, fim +10 min → janela **#11** | 17 | `MANUTENCAO_INICIADA` | ENVIADA | confere (`Escopo: 1 equipamento — ServidorADATA`) |
| 4b | botão manual no 6, coberto pela #11 → sessão manual **#2** | 18 | `MANUTENCAO_MANUAL_INICIADA` | ENVIADA | confere (`Já estava na janela #11 (até 26/10/2026 18:50); agora não volta sozinho no fim dela.`) |
| 4c | encerrar o manual com a #11 ATIVA | 19 | `MANUTENCAO_MANUAL_ENCERRADA` | ENVIADA | confere (cabeçalho `— segue em manutenção pela janela #11 até 26/10/2026 18:50`) |
| 4d | `PATCH /manutencoes/11/encerrar` (limpeza do passo) | 20 | `MANUTENCAO_ENCERRADA` | ENVIADA | confere (`antecipado por Exercicio F3 (previsto 18:50)`) |

Em todas as 11: horários em `dd/MM/yyyy HH:mm` locais (UTC−3; ex.: início real 21:35:30Z → `18:35`), rodapé
`Horários: UTC-03:00 (America/Sao_Paulo)`, duração no formato `0h 0m 38s`, nenhuma frase de "aviso de início não
entregue" (todos os inícios foram ENVIADA antes do fim, caso `ENTREGUE` do MA32). Log do dispatcher com a âncora
(`Telegram enviado: notificationId=10, ancora=manutencao=9, tipoEvento=MANUTENCAO_INICIADA, tentativa=1`); zero linhas
`ERROR`/`WARN` e zero "Erro interno" no log do jar.

**Observação de texto (não corrigida, para decisão):** o §3 desenha a `MANUTENÇÃO MANUAL ENCERRADA` só com `Unidade: ...`
e `Equipamento: ...` antes do `Período:`; o envio real traz também `IP: <ip>` (mesmo bloco de dados da mensagem de início,
`dadosManual` no `NotificacaoMessageBuilder`). O teste `NotificacaoMessageBuilderManutencaoTest.manualEncerradaRetoma`
fixa esse `IP:`, então é escolha da implementação; o spec é que ficou ambíguo (o `...` não diz se o IP entra). Ou se
acerta o desenho do §3, ou se tira a linha — não há outra divergência.

SQL das notificações no fim (ordem de envio = ordem do mock, #1 a #11):

```
 id |         tipo_evento         | status  | tentativas |          enviado_em           | janela | manual | erro | ordem_envio
----+-----------------------------+---------+------------+-------------------------------+--------+--------+------+-------------
 10 | MANUTENCAO_INICIADA         | ENVIADA |          1 | 2026-10-26 21:35:31.472435+00 |      9 |        |      |           1
 11 | MANUTENCAO_FIM_ALTERADO     | ENVIADA |          1 | 2026-10-26 21:35:58.239801+00 |      9 |        |      |           2
 12 | MANUTENCAO_ENCERRADA        | ENVIADA |          1 | 2026-10-26 21:36:09.583571+00 |      9 |        |      |           3
 13 | MANUTENCAO_INICIADA         | ENVIADA |          1 | 2026-10-26 21:36:36.356871+00 |     10 |        |      |           4
 14 | MANUTENCAO_ENCERRADA        | ENVIADA |          1 | 2026-10-26 21:38:38.577054+00 |     10 |        |      |           5
 15 | MANUTENCAO_MANUAL_INICIADA  | ENVIADA |          1 | 2026-10-26 21:38:57.02901+00  |        |      1 |      |           6
 16 | MANUTENCAO_MANUAL_ENCERRADA | ENVIADA |          1 | 2026-10-26 21:39:08.300052+00 |        |      1 |      |           7
 17 | MANUTENCAO_INICIADA         | ENVIADA |          1 | 2026-10-26 21:40:09.834133+00 |     11 |        |      |           8
 18 | MANUTENCAO_MANUAL_INICIADA  | ENVIADA |          1 | 2026-10-26 21:40:20.067426+00 |        |      2 |      |           9
 19 | MANUTENCAO_MANUAL_ENCERRADA | ENVIADA |          1 | 2026-10-26 21:40:30.28493+00  |        |      2 |      |          10
 20 | MANUTENCAO_ENCERRADA        | ENVIADA |          1 | 2026-10-26 21:40:42.584589+00 |     11 |        |      |          11
```

Estado final: janelas #9 e #11 CONCLUIDA com `encerrada_por_id = 6`, #10 CONCLUIDA com `encerrada_por_id` nulo; sessões
manuais #1 e #2 do equipamento 6, ambas com início, autor e encerrador preenchidos; os 8 equipamentos usados com
`em_manutencao = f, manutencao_manual = f`.

### Textos recebidos pelo mock (integrais, na ordem)

```
#1 2026-10-26T21:35:31.464Z  chat -100000000  /bot<token>/sendMessage
🔧 MANUTENÇÃO INICIADA — alertas suspensos

Unidade: Sesc Indiaroba
Escopo: 2 equipamentos — AP_IND_01, AP_IND_02
Motivo: Exercicio F3 passo 1
Início: 26/10/2026 18:35
Fim previsto: 26/10/2026 18:55
Agendada por: Exercicio F3
Janela: #9
Horários: UTC-03:00 (America/Sao_Paulo)
```

```
#2 2026-10-26T21:35:58.230Z
⏱️ MANUTENÇÃO PRORROGADA

Unidade: Sesc Indiaroba
Escopo: 2 equipamentos — AP_IND_01, AP_IND_02
Motivo: Exercicio F3 passo 1
Fim previsto: 26/10/2026 18:55 → 26/10/2026 19:05
Alterado por: Exercicio F3
Janela: #9
Horários: UTC-03:00 (America/Sao_Paulo)
```

```
#3 2026-10-26T21:36:09.574Z
✅ MANUTENÇÃO ENCERRADA — alertas retomados

Unidade: Sesc Indiaroba
Escopo: 2 equipamentos — AP_IND_01, AP_IND_02
Motivo: Exercicio F3 passo 1
Período: 26/10/2026 18:35 → 26/10/2026 18:36 (0h 0m 38s)
Término: antecipado por Exercicio F3 (previsto 19:05)
Janela: #9
Horários: UTC-03:00 (America/Sao_Paulo)
```

```
#4 2026-10-26T21:36:36.348Z
🔧 MANUTENÇÃO INICIADA — alertas suspensos

Unidade: Sesc Indiaroba
Escopo: unidade inteira (6 equipamentos)
Motivo: Exercicio F3 passo 2
Início: 26/10/2026 18:36
Fim previsto: 26/10/2026 18:38
Agendada por: Exercicio F3
Janela: #10
Horários: UTC-03:00 (America/Sao_Paulo)
```

```
#5 2026-10-26T21:38:38.570Z
✅ MANUTENÇÃO ENCERRADA — alertas retomados

Unidade: Sesc Indiaroba
Escopo: unidade inteira (6 equipamentos)
Motivo: Exercicio F3 passo 2
Período: 26/10/2026 18:36 → 26/10/2026 18:38 (0h 2m 1s)
Término: como previsto
Janela: #10
Horários: UTC-03:00 (America/Sao_Paulo)
```

```
#6 2026-10-26T21:38:57.024Z
🔧 EQUIPAMENTO EM MANUTENÇÃO MANUAL — alertas suspensos

Unidade: Hotel Atalaia
Equipamento: ServidorADATA
IP: 10.72.10.1
Iniciada por: Exercicio F3
Início: 26/10/2026 18:38
Sem fim previsto: volta só quando alguém encerrar.
Horários: UTC-03:00 (America/Sao_Paulo)
```

```
#7 2026-10-26T21:39:08.295Z
✅ MANUTENÇÃO MANUAL ENCERRADA — alertas retomados

Unidade: Hotel Atalaia
Equipamento: ServidorADATA
IP: 10.72.10.1
Período: 26/10/2026 18:38 → 26/10/2026 18:39 (0h 0m 11s)
Encerrada por: Exercicio F3
Horários: UTC-03:00 (America/Sao_Paulo)
```

```
#8 2026-10-26T21:40:09.830Z
🔧 MANUTENÇÃO INICIADA — alertas suspensos

Unidade: Hotel Atalaia
Escopo: 1 equipamento — ServidorADATA
Motivo: Exercicio F3 passo 4
Início: 26/10/2026 18:40
Fim previsto: 26/10/2026 18:50
Agendada por: Exercicio F3
Janela: #11
Horários: UTC-03:00 (America/Sao_Paulo)
```

```
#9 2026-10-26T21:40:20.063Z
🔧 EQUIPAMENTO EM MANUTENÇÃO MANUAL — alertas suspensos

Unidade: Hotel Atalaia
Equipamento: ServidorADATA
IP: 10.72.10.1
Iniciada por: Exercicio F3
Início: 26/10/2026 18:40
Já estava na janela #11 (até 26/10/2026 18:50); agora não volta sozinho no fim dela.
Horários: UTC-03:00 (America/Sao_Paulo)
```

```
#10 2026-10-26T21:40:30.280Z
✅ MANUTENÇÃO MANUAL ENCERRADA — segue em manutenção pela janela #11 até 26/10/2026 18:50

Unidade: Hotel Atalaia
Equipamento: ServidorADATA
IP: 10.72.10.1
Período: 26/10/2026 18:40 → 26/10/2026 18:40 (0h 0m 10s)
Encerrada por: Exercicio F3
Horários: UTC-03:00 (America/Sao_Paulo)
```

```
#11 2026-10-26T21:40:42.579Z
✅ MANUTENÇÃO ENCERRADA — alertas retomados

Unidade: Hotel Atalaia
Escopo: 1 equipamento — ServidorADATA
Motivo: Exercicio F3 passo 4
Período: 26/10/2026 18:40 → 26/10/2026 18:40 (0h 0m 32s)
Término: antecipado por Exercicio F3 (previsto 18:50)
Janela: #11
Horários: UTC-03:00 (America/Sao_Paulo)
```

Todas as 11 chegaram ao chat fictício `-100000000` pela URL `/bot<token>/sendMessage` do mock.

### E2E Playwright

Script `infra-monitor-frontend/e2e/manutencao-agendada-f3.cjs` (`npm run e2e:manutencao-agendada-f3`), no padrão do da F2:
navegação só por clique depois do login, nenhum `catch` em seletor, resultado e `rede.json` gravados em `finally`,
`unrouteAll({ behavior: 'ignoreErrors' })` antes de fechar. **Só lê**: depende do exercício acima (nenhum POST/PATCH/PUT/DELETE).

```
MANUT_F3_EMAIL=... MANUT_F3_SENHA=... MANUT_F3_EQUIPAMENTO=ServidorADATA MANUT_F3_SESSOES=2 MANUT_F3_JANELA=10 \
BASE=http://127.0.0.1:4300 API_PORT=8083 npm run e2e:manutencao-agendada-f3
```

Resultado: **17/17 OK** na primeira execução, nenhum erro de página/console.

| Caso | O que conferiu |
|---|---|
| a | Equipamentos → busca → "Ver": drawer com "Manutenção manual — histórico" e as **2** sessões (API `totalElements = 2`): `26/10/2026 18:40 até 26/10/2026 18:40 · 10 s · Iniciada por Exercicio F3 · encerrada por Exercicio F3` e `18:38 até 18:39 · 11 s` |
| b | Telegram → Histórico → EVENTO "Manutenção iniciada": pedido com `tipoEvento=MANUTENCAO_INICIADA`, 3 linhas todas com o rótulo novo, origem "Janela #10" como link para `/manutencoes` |
| c | EVENTO "Manutenção manual iniciada": 2 linhas com origem "Manutenção manual · ServidorADATA"; "Ver detalhe" → origem igual, evento "Manutenção manual iniciada", mensagem registrada começa no cabeçalho do botão e termina no rodapé de fuso |
| d | Relatórios → aba Notificações → Evento "Manutenção iniciada": 200, 3 linhas com o rótulo novo, origem "Janela #10" com link para `/manutencoes` |

Capturas em `infra-monitor-frontend/e2e/manutencao-agendada-f3-evidence/`:
`01-drawer-historico-manual.png`, `02-notificacoes-filtro-manutencao-iniciada.png`,
`03-notificacoes-filtro-manual-iniciada.png`, `04-notificacao-detalhe-manual.png`,
`05-relatorios-notificacoes-manutencao-iniciada.png`, `manutencao-agendada-f3.json` (resultados) e `rede.json` (método,
status e caminho de cada chamada à API; sem cabeçalhos nem corpos).

### Limpeza

Processos parados por PID (`taskkill //PID <pid> //F //T`), conferidos antes pelo `CommandLine`: jar `java -jar
backend-f3.jar` (28956), mock `node mock-telegram.cjs` (48748), `ng serve --port 4300` (47304, com o filho 43288).
`docker rm -f inframonitor-f3-clone`. Depois: `netstat -ano` sem nenhum `LISTENING` em 8083, 18443, 4300 ou 5440, e
`docker ps` sem o clone (o `inframonitor-carga` segue de pé, intocado).

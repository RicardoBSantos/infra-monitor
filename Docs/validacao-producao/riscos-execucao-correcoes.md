# Riscos de execução — correções da rodada de fechamento

Três riscos que ficaram abertos na revisão final do branch `feat/manutencao-equipamento`, corrigidos
com teste concorrente real (threads + `CyclicBarrier` + Postgres de Testcontainers + 30 repetições) e
prova de reversão. Desenho: [../superpowers/specs/2026-09-24-fechamento-dois-branches-design.md](../superpowers/specs/2026-09-24-fechamento-dois-branches-design.md).

## 1a. `fecharAutomaticamente` sem CAS

### Defeito

`IncidenteService.fecharAutomaticamente` carregava a entidade, chamava `incidente.fechar(...)` e fazia
`saveAndFlush`. O `UPDATE` do Hibernate grava todas as colunas `WHERE id = ?`, sem versão. Contra
transações que escrevem o mesmo incidente, isso dá dois desfechos ilegítimos concretos:

- com `EquipamentoService.entrarEmManutencao` (`fecharPorManutencao`): o motor sobrescreve
  `motivo_encerramento = MANUTENCAO` / `fechado_por = operador` por `RECUPERACAO_AUTOMATICA` / `NULL`,
  e o incidente fica com **duas** notificações de encerramento (`INCIDENTE_ENCERRADO_MANUTENCAO` e
  `INCIDENTE_FECHADO`);
- com `IncidenteService.reconhecer` (CAS `reconhecerSeAberto`): a instância carregada antes, ainda sem
  reconhecimento, grava `reconhecido_em`/`reconhecido_por` de volta a `NULL`.

### Segundo defeito, achado pela corrida: notificação de manutenção sobre id lido antes do bulk

Com o CAS no lugar, a corrida com a manutenção **continuou** 30/30 ilegítima, agora com outra forma:
linha `RECUPERACAO_AUTOMATICA`/`fechado_por NULL` (o motor ganhou a linha, legítimo) **mas** com uma
`INCIDENTE_ENCERRADO_MANUTENCAO` além da `INCIDENTE_FECHADO`. Causa: `entrarEmManutencao` lê os ids de
`abertosDoEquipamento` **antes** do `fecharPorManutencao` (SELECT simples, sem lock no incidente),
o motor fecha e commita no meio, o bulk update pula esse incidente (`status IN (ABERTO, RECONHECIDO)`
já não bate) — e a releitura por id chamava `tratarEncerramentoPorManutencao` para todos os ids lidos,
inclusive o que o motor fechou.

### Correção

1. `IncidenteRepository.fecharAutomaticamenteSeEmAberto(id, encerradoEm, observacao, agora)` — bulk
   update JPQL no idioma de `reconhecerSeAberto`/`fecharPorManutencao`: `SET status = FECHADO,
   encerradoEm, observacao, motivoEncerramento = RECUPERACAO_AUTOMATICA, fechadoPor = null, updatedAt
   WHERE id = :id AND status IN (ABERTO, RECONHECIDO)`, com `clearAutomatically`/`flushAutomatically`.
   Só toca colunas de fechamento, então `reconhecido_*` sobrevive. `fecharAutomaticamente` mantém
   assinatura e retorno: retorno 0 = outra transação já fechou → **sem notificação**, devolve a
   releitura; retorno 1 → relê por `findById` e só então `criarParaIncidenteFechado`. A validação
   `encerradoEm >= iniciadoEm` fica.
2. `EquipamentoService.entrarEmManutencao`: a releitura só notifica incidentes com
   `motivoEncerramento == MANUTENCAO`, isto é, os que **esta** manutenção fechou.

### Prova

Em `ManutencaoPostgresIntegrationTest`, quatro testes:

- **Duas corridas** (`@RepeatedTest(30)`, `CyclicBarrier`): manutenção × fechamento automático e
  reconhecer × fechamento automático. A instância que o motor fecha é carregada antes da barreira, como
  no `IncidentProcessor`. Depois da barreira o motor dorme um atraso aleatório de 0..12 ms (manutenção)
  ou 0..4 ms (reconhecer). Sem o atraso, o `UPDATE` único do motor commitava sempre primeiro e só um
  desfecho legítimo aparecia (30 R e 30 F). Os limites foram calibrados até os dois desfechos
  aparecerem.
- **Duas ordens fixas, sem corrida:** motor carrega → manutenção roda inteira (ou `reconhecer` responde
  sucesso) → motor fecha com a instância velha. É a intercalação que discrimina o CAS de forma
  determinística: `fecharAutomaticamenteComInstanciaVelhaNaoSobrescreveFechamentoPorManutencao` exige
  MANUTENCAO/operador, uma `INCIDENTE_ENCERRADO_MANUTENCAO` e nenhuma `INCIDENTE_FECHADO`;
  `fecharAutomaticamenteComInstanciaVelhaNaoApagaReconhecimento` exige `reconhecido_em`/`reconhecido_por`
  preenchidos.

As saídas completas ficaram só na máquina local de quem executou (diretório de trabalho fora do git).
As contagens abaixo foram coladas delas.

### Distribuição

**Código antigo (`saveAndFlush`, sem filtro na manutenção), corridas ainda sem atraso:**
`Tests run: 94, Failures: 30`

```
     30 [corrida-fechamento-manutencao] desfecho=ILEGITIMO motivo=RECUPERACAO_AUTOMATICA fechadoPor=null encerradasPorManutencao=1 fechadas=1
     30 [corrida-fechamento-reconhecer] desfecho=F-fechamento-ganhou recusado=true reconhecidoPor=null
```

**Só o CAS, sem o filtro da manutenção, corridas sem atraso:** as 30 da manutenção continuaram
`ILEGITIMO`, com a mesma forma (`motivo=RECUPERACAO_AUTOMATICA ... encerradasPorManutencao=1 fechadas=1`).
É o segundo defeito acima e também a prova de reversão do filtro.

**Reversão só do CAS (`saveAndFlush` antigo restaurado, filtro mantido), versão final dos testes:**
`Tests run: 96, Failures: 41`

```
     18 [corrida-fechamento-manutencao] desfecho=ILEGITIMO motivo=RECUPERACAO_AUTOMATICA fechadoPor=null encerradasPorManutencao=1 fechadas=1
     12 [corrida-fechamento-manutencao] desfecho=R-recuperacao-ganhou motivo=RECUPERACAO_AUTOMATICA fechadoPor=null encerradasPorManutencao=0 fechadas=1
      9 [corrida-fechamento-reconhecer] desfecho=F-fechamento-ganhou recusado=true reconhecidoPor=null
     21 [corrida-fechamento-reconhecer] desfecho=ILEGITIMO recusado=false reconhecidoPor=null
```

Os dois testes de ordem fixa também falharam:

```
fecharAutomaticamenteComInstanciaVelhaNaoApagaReconhecimento
  {"reconhecido_em"=null, "reconhecido_por"=null, "status"="FECHADO"}
fecharAutomaticamenteComInstanciaVelhaNaoSobrescreveFechamentoPorManutencao
  {"fechado_por"=null, "motivo_encerramento"="RECUPERACAO_AUTOMATICA", "status"="FECHADO"}
```

41 = 18 + 21 + 2. Sem o CAS, a manutenção fecha e notifica e o motor grava por cima. `reconhecer`
responde sucesso e o motor apaga o reconhecimento.

**Depois (CAS + filtro), versão final dos testes:** `Tests run: 96, Failures: 0`

```
     23 [corrida-fechamento-manutencao] desfecho=M-manutencao-ganhou motivo=MANUTENCAO fechadoPor=1 encerradasPorManutencao=1 fechadas=0
      7 [corrida-fechamento-manutencao] desfecho=R-recuperacao-ganhou motivo=RECUPERACAO_AUTOMATICA fechadoPor=null encerradasPorManutencao=0 fechadas=1
     14 [corrida-fechamento-reconhecer] desfecho=F-fechamento-ganhou recusado=true reconhecidoPor=null
     16 [corrida-fechamento-reconhecer] desfecho=RF-reconhecido-e-fechado recusado=false reconhecidoPor=1
```

Zero ilegítimo em 30/30 nas duas corridas. Os dois desfechos legítimos aparecem em cada uma. Durante a
calibração, com o código corrigido: 12/4 ms deu 15 M / 15 R e 9 F / 21 RF; 25/8 ms deu 24 M / 6 R e
5 F / 25 RF. Com 40 ms nas duas corridas, deu 24 M / 6 R e 30 RF / 0 F.

### Limites da prova

- A proporção entre os desfechos depende da máquina, porque o atraso foi calibrado contra a latência
  local. O que discrimina o CAS de forma determinística são os dois testes de ordem fixa. As corridas
  ficam como guarda contra intercalações que a ordem fixa não cobre.

## 1b. `lock_timeout` e pool

### Onde o motor espera lock

`IncidenteRepository.inserirSeElegivel` (`IncidenteRepository.java:114`) e
`MonitorEpisodioLatenciaRepository.inserirSeElegivel` (`MonitorEpisodioLatenciaRepository.java:39`)
fazem `FOR UPDATE OF e` na linha do equipamento, a mesma que `entrarEmManutencao` trava. Os bulk
updates de fechamento disputam a linha do incidente/episódio com a manutenção. Tudo roda dentro das
transações `REQUIRES_NEW` de `IncidentProcessor.process` (`IncidentProcessor.java:47`) e
`LatencyEpisodeProcessor.process` (`LatencyEpisodeProcessor.java:61`). Antes desta correção não havia
`lock_timeout` nem `statement_timeout` em lugar nenhum: o worker esperava o detentor pelo tempo que
ele quisesse, segurando a conexão.

### Correção

- `LimiteDeEsperaPorLock.aplicarNaTransacaoCorrente()` executa
  `select set_config('lock_timeout', '2000ms', true)`. O terceiro argumento `true` é `SET LOCAL`:
  vale só para a transação corrente e morre no commit/rollback, não vaza para a conexão devolvida ao
  pool. É a primeira instrução de `process` nos dois processors (`IncidentProcessor.java:49`,
  `LatencyEpisodeProcessor.java:63`). O `JdbcTemplate` participa da transação JPA (o
  `JpaTransactionManager` expõe a conexão ao `DataSourceUtils`): a prova é o próprio teste abaixo, que
  só volta em ~2 s se o `set_config` cair na conexão que depois faz o `FOR UPDATE`.
- Valor: **2 s**, `monitoring.engine.lock-timeout-ms` (env `MONITORING_ENGINE_LOCK_TIMEOUT_MS`,
  `application.yml:92`). Quem segura a linha do equipamento são transações curtas, só banco:
  `entrarEmManutencao`, `atualizar`/`ativar`/`desativar` de equipamento, e a abertura concorrente de
  outro monitor do mesmo equipamento, todas na casa de milissegundos. 2 s fica duas ordens de grandeza
  acima da espera legítima e bem abaixo do menor intervalo de monitor (10 s).

### Decisão no estouro: pula o ciclo

O Postgres devolve `55P03` (`canceling statement due to lock timeout`), o Spring traduz para
`PessimisticLockingFailureException`, e a transação do processor faz rollback inteira.
`MedicaoService.criar` é `NOT_SUPPORTED` (`MedicaoService.java:44`) e a medição já foi gravada antes,
fora dessa transação: nada se perde. A próxima medição do monitor reavalia a cauda inteira e abre ou
fecha no ciclo seguinte. `MedicaoService.criar` captura `PessimisticLockingFailureException` antes do
`catch (RuntimeException)` genérico (`MedicaoService.java:54` e `:66`) e loga **WARN** sem stack trace.

- **Não registrar falha:** a medição é verdadeira. O que não aconteceu foi a interpretação dela.
- **Não tentar de novo na hora:** o detentor típico é a própria manutenção. Tentar de novo prende o
  worker atrás dele, que é exatamente o que a correção tira.
- **Custo conhecido:** uma abertura adiada um ciclo nasce com `iniciado_em` na primeira falha da cauda
  avaliada no ciclo seguinte, um intervalo depois do que teria sido. Um fechamento adiado tem
  `encerrado_em` um intervalo depois, pelo mesmo motivo.

### Prova

`LockTimeoutMotorPostgresIntegrationTest` (Testcontainers, `postgres:16-alpine`): uma transação
externa faz `select ... from equipamento where id = ? for update` e segura a linha por 8 s. A 3ª falha
consecutiva chega pelo caminho real do motor (`MedicaoService.criar` → `IncidentProcessor`). O teste
exige que a chamada volte em menos de 4 s, que a medição exista (3 no monitor), que não haja incidente
nem notificação, e que, solto o lock, a próxima falha abra o incidente.

**Antes (código sem `lock_timeout`, teste já escrito):** `Tests run: 1, Failures: 1`

```
[lock-timeout] chamada voltou em 7998 ms
LockTimeoutMotorPostgresIntegrationTest.lockEstouradoPulaOCicloSemPerderMedicaoEAProximaMedicaoAbre:118 [o motor nao pode esperar o lock inteiro]
```

**Depois:** `Tests run: 1, Failures: 0`

```
WARN ... b.c.i.medicao.service.MedicaoService     : Lock not acquired while processing incidents for measurement 3; re-evaluated on the next measurement
[lock-timeout] chamada voltou em 2238 ms
```

A linha seguinte ao WARN no log é o `DEBUG` do `LatencyEpisodeProcessor`: sem stack trace. O Hibernate
ainda emite as suas duas linhas WARN do erro JDBC (`HHH000247: ErrorCode: 0, SQLState: 55P03` e
`ERROR: canceling statement due to lock timeout`), também sem stack trace.

Suíte completa depois da correção: `Tests run: 445, Failures: 0, Errors: 0, Skipped: 0`, `BUILD SUCCESS`.

### Pool

A conta do desenho previa 11 detentores de segundo plano. A leitura do código dá **10**:

| Detentor | Quantas threads | Evidência | Conexões no pico |
|---|---|---|---|
| Workers do motor | 4 | `MonitoringEngineConfiguration.java:26` (`ThreadPoolExecutor` fixo de `worker-threads`), `application.yml:89` | 4 |
| Thread de agendamento | 1 | `MonitoringScheduler.java:13`, `NotificationDispatcher.java:44` e `TelegramIdentityCache.java:39` são `@Scheduled` sem `TaskScheduler` próprio nem threads virtuais; `spring.task.scheduling.pool.size` tem default 1 no Spring Boot 4.1.0 | 1 |
| Workers do dispatcher | 5 | `NotificationDispatcherConfiguration.java:27`, `application.yml:115` | 5 |

O scheduler do motor e o poll do dispatcher **dividem a mesma thread**: rodam em fila, nunca juntos.
Por isso são 10, e não 11.

Cada detentor segura no máximo uma conexão por vez, e nenhum a segura durante I/O externo:

- Worker do motor: o ping roda antes e sem transação (`MonitorExecutionCoordinator.java:80`).
  `MedicaoService.criar` é `NOT_SUPPORTED`, e cada etapa (`findById`, `save`, as duas `REQUIRES_NEW`)
  abre e devolve a sua. Medido com o `HikariPoolMXBean` amostrado a cada 20 ms enquanto o worker
  esperava o lock: 1 conexão ativa antes (só o detentor do lock) e **máximo de 2** durante a chamada
  (detentor + worker), nas duas execuções, com e sem `lock_timeout`.
- Thread de agendamento: `findActiveExecutionCandidates` (`MonitorExecutionCoordinator.java:49`) e
  depois `releaseStaleReservations` + `findIdsReadyForDispatch` (`NotificationDispatcher.java:47-50`),
  cada um na sua transação curta. `TelegramIdentityCache.revalidar` só faz HTTP, sem banco.
- Worker do dispatcher: só nas transações de estado (`NotificationDispatchStateService.java:18-31`).
  O HTTP do Telegram roda fora de transação (`NotificationDispatcher.java:65`).

Com o default antigo de 10, o pico de segundo plano já esgota o pool antes de qualquer requisição
HTTP. Com `lock_timeout`, cada worker do motor pode segurar conexão por até 2 s num estouro. **Novo
default: 20** (`application.yml:18`, conta no comentário), 10 de segundo plano e 10 para a API, bem
abaixo do `max_connections = 100` do Postgres. O desenho previa 20 = 11 + 9. Com 10 detentores, a
regra "segundo plano + 9" daria 19. Arredondado para 20, que também cobre o caso de alguém ligar
threads virtuais ou subir `spring.task.scheduling.pool.size` (o scheduler e o poll passariam a rodar
em paralelo e o pico voltaria a 11). `infra-monitor-backend/README.md` atualizado para o mesmo número.

### Fora do escopo

Os `PESSIMISTIC_WRITE` de `UsuarioRepository` e o `UPDATE` de `entrarEmManutencao`, os dois do caminho
HTTP, continuam sem `lock_timeout`. Estão registrados como B1 em
[auditoria-concorrencia-ciclo-de-vida.md](auditoria-concorrencia-ciclo-de-vida.md).

## 1c. Excluir monitor e equipamento × janela

### Achado que muda o enunciado

`janela_monitoramento.monitor_id` é `REFERENCES monitor(id) ON DELETE RESTRICT` (V13), e
`MonitorService.criar`/`ativar` sempre abrem janela. Logo, antes desta correção, excluir um monitor
ativo recém-criado (sem medição nem incidente) **não deixava janela órfã — falhava**: o `DELETE` de
`MonitorService.excluir` estourava a FK e a API devolvia 409 `DATA_INTEGRITY_VIOLATION`. Na prática só
era possível excluir um monitor que nunca tivera janela. Mensagem real do Postgres, capturada no RED
do teste de integração:

```
org.springframework.dao.DataIntegrityViolationException:
could not execute statement [ERROR: update or delete on table "monitor" violates foreign key
constraint "janela_monitoramento_monitor_id_fkey" on table "janela_monitoramento"
  Detalhe: Key (id)=(1) is still referenced from table "janela_monitoramento".
```

### Correção

`JanelaMonitoramentoRepository.apagarDoMonitor` (bulk `delete from JanelaMonitoramento j where
j.monitor.id = :id`, `@Modifying(clearAutomatically = true, flushAutomatically = true)`) e
`CicloJanelaMonitoramentoService.apagarDoMonitor`, chamado por `MonitorService.excluir` entre a última
guarda (existência de incidente) e o `monitorRepository.delete(monitor)`, na mesma transação. Apaga, e
não fecha, porque um monitor sem medição e sem incidente não tem período observado que o relatório
precise preservar, e fechar não bastaria de qualquer forma — a FK continuaria `RESTRICT`. Corrida
medição×exclusão: se o motor gravar uma medição entre a guarda de `medicaoRepository.existsByMonitorId`
e o `delete`, a FK de `medicao` (V6:17) estoura, a transação inteira volta (janelas apagadas inclusive)
e a API responde 409 — a invariante fica garantida pelo próprio banco, não por lock aplicativo.

### Equipamento

Nenhuma mudança de código. `EquipamentoService.excluir` já exige `!monitorRepository.existsByEquipamentoId(id)`
antes do `delete`: exclusão física de equipamento só é possível com zero monitores, logo zero janelas —
a invariante nunca se quebra ali. O teste de integração
(`excluirEquipamentoSoComZeroMonitoresLogoSemJanelaOrfa`) prova as duas pontas: equipamento com monitor
→ 409, equipamento sem monitor → exclui, e nenhuma `janela_monitoramento` fica órfã (`left join` contra
`monitor` vazio).

### Exclusão lógica

Não existe. `deleted_at` está nas três tabelas de inventário (`unidade`, `tipo_equipamento`,
`equipamento`) desde a V2, mas nenhum código Java lê ou grava a coluna — achado já registrado na
auditoria de concorrência, não inventado aqui. Nada a cobrir nesta correção.

### Prova

`ExclusaoEJanelaPostgresIntegrationTest`, Testcontainers com Postgres 16 real:

- `excluirMonitorSemHistoricoApagaAJanelaEOMonitor` — RED com a `DataIntegrityViolationException`
  acima; GREEN depois de `apagarDoMonitor`: zero linhas em `monitor` e em `janela_monitoramento` para o
  id excluído.
- `excluirMonitorComMedicaoRecusaEPreservaAJanela` — `ConflitoException` (409) e a janela aberta
  (`fim_em is null`) intacta.
- `excluirEquipamentoSoComZeroMonitoresLogoSemJanelaOrfa` — `ConflitoException` com monitor associado;
  exclusão bem-sucedida sem monitor; zero `janela_monitoramento` órfã.

Classe inteira: `Tests run: 3, Failures: 0, Errors: 0, Skipped: 0`. Suíte completa depois da correção:
`Tests run: 448, Failures: 0, Errors: 0, Skipped: 0`, `BUILD SUCCESS` (445 antes desta rodada + 3 novos
testes).

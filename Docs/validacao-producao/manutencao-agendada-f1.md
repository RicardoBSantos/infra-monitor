# Manutenção agendada F1 — Evidências da F1

## Task 1 — lost update de `em_manutencao`

Teste: `FlagManutencaoNaoSobrescritoPostgresIntegrationTest` (PostgreSQL 16 real, Testcontainers).
A transação carrega o equipamento (`em_manutencao = false` na sessão), outra thread commita
`em_manutencao = true`, e a sessão velha renomeia o equipamento (dirty-check regrava a linha).

### RED — entidade original (sem `updatable = false`, antes da V21)

```
$ ./mvnw -q test -Dtest=FlagManutencaoNaoSobrescritoPostgresIntegrationTest
[ERROR] Tests run: 1, Failures: 1 ... FlagManutencaoNaoSobrescritoPostgresIntegrationTest
Expecting map: {"em_manutencao"=false, "nome"="SW-CORE-RENOMEADO"}
  ["em_manutencao"=false (expected: true)]
```

### GREEN — com `updatable = false`

```
$ ./mvnw test -Dtest='MigracaoManutencaoAgendadaPostgresIntegrationTest,FlagManutencaoNaoSobrescritoPostgresIntegrationTest'
Tests run: 1, Failures: 0 -- FlagManutencaoNaoSobrescritoPostgresIntegrationTest
Tests run: 11, Failures: 0 -- MigracaoManutencaoAgendadaPostgresIntegrationTest
BUILD SUCCESS
```

### Reversão — `updatable = false` removido de `emManutencao` (depois restaurado)

```
[ERROR] Tests run: 1, Failures: 1 ... FlagManutencaoNaoSobrescritoPostgresIntegrationTest
Expecting map: {"em_manutencao"=false, "nome"="SW-CORE-RENOMEADO"}
  ["em_manutencao"=false (expected: true)]
```

O teste falha sem a anotação e passa com ela: o fim do lost update é causado por `updatable = false`.

### Regressão (Docker real, nenhuma classe pulada)

Suíte completa: `Tests run: 697, Failures: 0, Errors: 0, Skipped: 0`, BUILD SUCCESS.

## Reconciliador — sistema parado

"Sistema parado" simulado com janelas cujos horários já passaram e nenhum tick até `agora`;
o teste chama `reconciliar(agora)` direto (`intervalo-ms=3600000`).

### RED — classe ainda não existe

```
$ ./mvnw -q test -Dtest='ReconciliadorManutencaoPostgresIntegrationTest,ReconciliadorManutencaoTest,MonitoringSchedulerGateTest'
[ERROR] ReconciliadorManutencaoPostgresIntegrationTest.java:[9,46] cannot find symbol
[ERROR] ReconciliadorManutencaoTest.java:[43,13] cannot find symbol
[ERROR] MonitoringSchedulerGateTest.java:[24,9] constructor MonitoringScheduler ... cannot be applied to given types;
```

### GREEN (Docker real)

```
$ ./mvnw test -Dtest='ReconciliadorManutencaoPostgresIntegrationTest,ReconciliadorManutencaoTest,MonitoringSchedulerGateTest'
ERROR Reconciliador: falha ao reavaliar o equipamento 1; seguindo com os demais
INFO  Reconciliador: equipamento 2 excluido antes da reavaliacao; ignorado
WARN  Janela de manutencao 1 expirou sem ativar: o sistema esteve fora durante a janela inteira
Tests run: 7, Failures: 0, Errors: 0, Skipped: 0 -- ReconciliadorManutencaoPostgresIntegrationTest
Tests run: 2, Failures: 0, Errors: 0, Skipped: 0 -- ReconciliadorManutencaoTest
Tests run: 2, Failures: 0, Errors: 0, Skipped: 0 -- MonitoringSchedulerGateTest
Tests run: 11, Failures: 0, Errors: 0, Skipped: 0
```

Casos cobertos: início perdido com fim no futuro ativa com `ativada_em = agora` (real) e efeitos;
janela inteira perdida vira `EXPIRADA` sem efeito (fotografia de incidentes, janelas de SLA,
notificações e flags idêntica); fim perdido conclui com `encerrada_em = agora`, sem autor, e a
janela de SLA reabre agora; divergência corrigida sem transição; equipamento novo na unidade
entra no tick; falha num equipamento não segura os outros; a primeira passada marca
`ReconciliacaoInicial` pronta, inclusive quando falha (unitário).

### Regressão (Docker real, nenhuma classe pulada)

Suíte completa: `Tests run: 778, Failures: 0, Errors: 0, Skipped: 0`, BUILD SUCCESS, sem aviso `!!`.

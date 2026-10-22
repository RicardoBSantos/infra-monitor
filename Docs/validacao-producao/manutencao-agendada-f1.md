# Manutenção agendada F1 — evidências

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

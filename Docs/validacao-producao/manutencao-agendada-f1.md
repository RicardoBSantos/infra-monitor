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

## Task 6 — Corridas reais e provas de reversão

Teste: `manutencao/ManutencaoAgendadaConcorrenciaPostgresIntegrationTest` (PostgreSQL 16 real,
Testcontainers). Sete corridas, cada uma `@RepeatedTest(30)`, duas threads reais alinhadas por
`CyclicBarrier(2)`, cada lado nas suas próprias transações, atraso aleatório pós-barreira calibrado
(valores e medições de calibração em comentário nas constantes `ATRASO_*`). Cada repetição imprime
`[corrida-<nome>] desfecho=<RÓTULO>` e falha com `ILEGITIMO`. Exceção em qualquer thread (CHECK
violada, CAS de segunda camada, deadlock abortado) também é `ILEGITIMO`: o operador ou o tick
receberiam erro por causa da corrida.

### Corridas

```
$ ./mvnw test -Dtest=ManutencaoAgendadaConcorrenciaPostgresIntegrationTest > target/corridas.log 2>&1
$ grep -o '\[corrida-[a-z-]*\] desfecho=[A-Z_]*' target/corridas.log | sort | uniq -c
     19 [corrida-ativacao-motor] desfecho=INC_PRIMEIRO
     11 [corrida-ativacao-motor] desfecho=MANUT_PRIMEIRO
      9 [corrida-ativar-cancelar] desfecho=ATIV
     21 [corrida-ativar-cancelar] desfecho=CANC
     30 [corrida-duas-janelas] desfecho=UMA_SAIDA
     25 [corrida-duas-passadas] desfecho=ATIVOU_A
      5 [corrida-duas-passadas] desfecho=ATIVOU_B
     18 [corrida-encerrar-concluir] desfecho=AUTO
     12 [corrida-encerrar-concluir] desfecho=OPER
      5 [corrida-manual-ativacao] desfecho=FICOU
     25 [corrida-manual-ativacao] desfecho=SAIU_E_VOLTOU
     30 [corrida-put-flag] desfecho=PUT_LEU_FORA
[INFO] Tests run: 210, Failures: 0, Errors: 0, Skipped: 0
```

| # | Corrida (`[corrida-…]`) | Desfechos legítimos | Distribuição (30) | Atraso pós-barreira |
|---|---|---|---|---|
| 1 | job ativa × operador cancela (`ativar-cancelar`) | CANC: CANCELADA, equipamento fora · ATIV: ATIVA, cancelar → 409, em manutenção | 21 CANC / 9 ATIV | reconciliador 0–8 ms |
| 2 | encerrar agora × conclusão automática (`encerrar-concluir`) | OPER: `encerrada_por` = operador, tick não relata · AUTO: `encerrada_por` nulo, operador → 409, tick relata. Nos dois: CONCLUIDA, fora, 1 janela de SLA aberta | 12 OPER / 18 AUTO | encerrar 0–2 ms |
| 3 | botão encerrar manual × janela ativando (`manual-ativacao`) | estado único: ATIVA, manual = false, em_manutencao = true, 0 SLA aberta; pela ordem: SAIU_E_VOLTOU / FICOU | 25 SAIU_E_VOLTOU / 5 FICOU | reconciliador 0–8 ms |
| 4 | duas janelas sobrepostas terminando juntas (`duas-janelas`) | as duas CONCLUIDA, fora, exatamente 1 SLA aberta | 30 UMA_SAIDA | 2º encerrar 0–4 ms |
| 5 | janela ativando × motor abrindo incidente (`ativacao-motor`) | MANUT_PRIMEIRO: nenhum incidente · INC_PRIMEIRO: FECHADO/MANUTENCAO, sem abertura PENDENTE órfã | 11 MANUT / 19 INC | motor 0–8 ms |
| 6 | duas passadas do reconciliador, 2 janelas UNIDADE, 3 equipamentos com incidente (`duas-passadas`) | sem deadlock/erro, 3 em manutenção, cada incidente fechado 1× com 1 aviso; rótulo = quem ganhou o CAS de ativação | 25 A / 5 B | 2ª passada 0–4 ms |
| 7 | PUT do equipamento × job virando o flag (`put-flag`) | nome novo E em_manutencao = true | 30 PUT_LEU_FORA | PUT 0–8 ms |

Calibração (medida): na 1 e na 3, atrasar o lado do operador deu 30/30 de um desfecho só (ATIV;
FICOU), porque o CAS de ativação é a primeira instrução do reconciliador; o atraso passou para o
reconciliador. Na 2, atrasar o reconciliador deu 30/30 OPER e atrasar o encerrar 0–8 ms deu 30/30
AUTO; 0–4 deu 22 AUTO / 8 OPER e 0–2 deu 15/15. Na 7 o PUT sempre lê `em_manutencao = false`
(PUT_LEU_FORA) e em parte das repetições grava depois da virada — o caso perigoso; a reversão 7
mostra que ele ocorre em ~metade das repetições.

### Provas de reversão

Cada reversão aplicada localmente, só aquela corrida rodada (`-Dtest=…#método`), arquivo restaurado
com `git checkout -- <arquivo>` em seguida (`git status --short src/main` vazio depois de cada uma).
Linhas `[corrida-…]` agrupadas com `sort | uniq -c` (cortadas em 260 colunas) e a linha `Tests run`.

**1 — `cancelar` sem `AND status = 'AGENDADA'`** (`CoberturaManutencao`)

```
     18 [corrida-ativar-cancelar] desfecho=CANC situacao=CANCELADA emManutencao=false recusado=false falhas=[]
     12 [corrida-ativar-cancelar] desfecho=ILEGITIMO situacao=ATIVA emManutencao=true recusado=false falhas=[org.springframework.dao.DataIntegrityViolationException: PreparedStatementCallback; SQL [UPDATE manutencao_agendada SET status = 'CANCELADA', cancelada_em = ?,
[ERROR] Tests run: 30, Failures: 12, Errors: 0, Skipped: 0
```

Sem o CAS, o cancelamento alcança a janela já ATIVA e só para na segunda camada,
`ck_manutencao_agendada_coerente` (CANCELADA não pode ter `ativada_em`): o operador receberia 500 em
vez de 409. Vermelho em 12/30 — as repetições em que o tick ativou primeiro.

**2 — `encerrar` sem `AND status = 'ATIVA'`** (só o `encerrar`)

```
     15 [corrida-encerrar-concluir] desfecho=OPER situacao=CONCLUIDA encerradaPor=1 recusado=false autoRelatou=false emManutencao=false slaAbertas=1 falhas=[]
     15 [corrida-encerrar-concluir] desfecho=ILEGITIMO situacao=CONCLUIDA encerradaPor=1 recusado=false autoRelatou=true emManutencao=false slaAbertas=1 falhas=[]
[ERROR] Tests run: 30, Failures: 15, Errors: 0, Skipped: 0
```

**2 — `encerrar` sem `AND status = 'ATIVA'` e `concluirVencidas` sem o filtro de status** (as duas, como na tabela do plano)

```
     30 [corrida-encerrar-concluir] desfecho=ILEGITIMO situacao=CONCLUIDA encerradaPor=1 recusado=false autoRelatou=true emManutencao=false slaAbertas=1 falhas=[]
[ERROR] Tests run: 30, Failures: 30, Errors: 0, Skipped: 0
```

Os dois lados afirmam ter concluído a mesma janela (operador recebe 200 e o tick a relata como
concluída; a linha mistura `encerrada_por` do operador com o `encerrada_em` do tick). Só o
`encerrar` revertido já fica vermelho em todas as repetições AUTO (15/30). A saída continua aplicada
uma vez (`slaAbertas=1`) porque `reavaliar` é idempotente sob o lock — a guarda disso é a da corrida 4.

**3 — reconciliador sem reavaliar os `cobertosPor` (só divergência)** (`ReconciliadorManutencao`)

```
     17 [corrida-manual-ativacao] desfecho=ILEGITIMO situacao=ATIVA emManutencao=false manual=false slaAbertas=1 slaNovas=1 falhas=[]
     11 [corrida-manual-ativacao] desfecho=FICOU situacao=ATIVA emManutencao=true manual=false slaAbertas=0 slaNovas=0 falhas=[]
      2 [corrida-manual-ativacao] desfecho=SAIU_E_VOLTOU situacao=ATIVA emManutencao=true manual=false slaAbertas=0 slaNovas=1 falhas=[]
[ERROR] Tests run: 30, Failures: 17, Errors: 0, Skipped: 0
```

**3 — cobertura lida NA MESMA instrução do `FOR UPDATE`** (subconsulta do autor dentro de
`travarEstadoManutencao`, `reavaliar` usando o valor dela), sozinha

```
     29 [corrida-manual-ativacao] desfecho=SAIU_E_VOLTOU situacao=ATIVA emManutencao=true manual=false slaAbertas=0 slaNovas=1 falhas=[]
      1 [corrida-manual-ativacao] desfecho=FICOU situacao=ATIVA emManutencao=true manual=false slaAbertas=0 slaNovas=0 falhas=[]
[INFO] Tests run: 30, Failures: 0, Errors: 0, Skipped: 0
```

**3 — as duas reversões juntas**

```
     16 [corrida-manual-ativacao] desfecho=ILEGITIMO situacao=ATIVA emManutencao=false manual=false slaAbertas=1 slaNovas=1 falhas=[]
     11 [corrida-manual-ativacao] desfecho=SAIU_E_VOLTOU situacao=ATIVA emManutencao=true manual=false slaAbertas=0 slaNovas=1 falhas=[]
      3 [corrida-manual-ativacao] desfecho=FICOU situacao=ATIVA emManutencao=true manual=false slaAbertas=0 slaNovas=0 falhas=[]
[ERROR] Tests run: 30, Failures: 16, Errors: 0, Skipped: 0
```

Combinação necessária: nenhuma — a reversão do reconciliador sozinha já fica vermelha (17/30). A
leitura no snapshot do lock, sozinha, fica verde, e não por falta de exercício: ela desloca a
distribuição de 25/5 para 29/1 SAIU_E_VOLTOU (o botão lê a cobertura velha e tira o equipamento),
mas o reconciliador, que reavalia os `cobertosPor` sob o lock depois do próprio CAS commitado,
recoloca o equipamento. Nesta corrida a guarda decisiva é a reavaliação por lock no reconciliador; a
leitura em instrução separada é defesa em profundidade. O par também foi registrado, como pedia a
decisão já tomada.

**4 — `travarEstadoManutencao` sem `FOR UPDATE`** (`EquipamentoRepository`)

```
     20 [corrida-duas-janelas] desfecho=ILEGITIMO j1=CONCLUIDA j2=CONCLUIDA emManutencao=false slaAbertas=1 falhas=[java.lang.IllegalStateException: em_manutencao mudou sob lock do equipamento 1]
     10 [corrida-duas-janelas] desfecho=UMA_SAIDA j1=CONCLUIDA j2=CONCLUIDA emManutencao=false slaAbertas=1 falhas=[]
[ERROR] Tests run: 30, Failures: 20, Errors: 0, Skipped: 0
```

Sem o lock as duas reavaliações decidem sair; o CAS de `trocarEmManutencao` (segunda camada) barra a
segunda saída e o `encerrar` dela devolve 500 ao operador.

**5 — `inserirSeElegivel` sem `FOR UPDATE OF e`** (`IncidenteRepository`)

```
     15 [corrida-ativacao-motor] desfecho=INC_PRIMEIRO emManutencao=true incidentes=[{status=FECHADO, motivo_encerramento=MANUTENCAO}] aberturasPendentes=0 falhas=[]
      9 [corrida-ativacao-motor] desfecho=ILEGITIMO emManutencao=true incidentes=[{status=ABERTO, motivo_encerramento=null}] aberturasPendentes=1 falhas=[]
      6 [corrida-ativacao-motor] desfecho=ILEGITIMO emManutencao=true incidentes=[{status=FECHADO, motivo_encerramento=MANUTENCAO}] aberturasPendentes=1 falhas=[]
[ERROR] Tests run: 30, Failures: 15, Errors: 0, Skipped: 0
```

Os dois modos de falha do M7 reaparecem pela janela agendada: incidente ABERTO com o equipamento em
manutenção (9) e incidente fechado pela manutenção com a abertura ainda PENDENTE (6), que o
dispatcher enviaria como "incidente aberto".

**6 — `reavaliar` dos alvos em ordem inversa dentro de UMA transação** (`ReconciliadorManutencao`)

Literal (uma transação, alvos em ordem decrescente nas duas passadas) — verde:

```
     26 [corrida-duas-passadas] desfecho=ATIVOU_A emManutencao=3 fechadosPorManutencao=3 avisosPorIncidente=[1, 1, 1] ativadasA=2 ativadasB=0 falhas=[]
      4 [corrida-duas-passadas] desfecho=ATIVOU_B emManutencao=3 fechadosPorManutencao=3 avisosPorIncidente=[1, 1, 1] ativadasA=0 ativadasB=2 falhas=[]
[INFO] Tests run: 30, Failures: 0, Errors: 0, Skipped: 0
```

Duas passadas do MESMO código invertido continuam travando na mesma ordem entre si: sem ciclo, a
reversão literal não pode produzir deadlock — o teste não era o problema. Reversão ajustada para
inverter a ordem de só uma das fontes de alvos: uma transação, `cobertosPor` das transições em ordem
inversa, `divergentes()` em ordem de id (`LinkedHashSet`). A passada que ganha o CAS trava 3→2→1; a
outra, que só vê divergência, trava 1→2→3:

```
     23 [corrida-duas-passadas] desfecho=ILEGITIMO emManutencao=3 fechadosPorManutencao=3 avisosPorIncidente=[1, 1, 1] ativadasA=2 ativadasB=-1 falhas=[org.springframework.transaction.UnexpectedRollbackException: Transaction silently rolled back because it has been ma
      3 [corrida-duas-passadas] desfecho=ILEGITIMO emManutencao=3 fechadosPorManutencao=3 avisosPorIncidente=[1, 1, 1] ativadasA=-1 ativadasB=2 falhas=[org.springframework.transaction.UnexpectedRollbackException: Transaction silently rolled back because it has been ma
      3 [corrida-duas-passadas] desfecho=ILEGITIMO emManutencao=3 fechadosPorManutencao=3 avisosPorIncidente=[1, 1, 1] ativadasA=-1 ativadasB=0 falhas=[org.springframework.transaction.UnexpectedRollbackException: Transaction silently rolled back because it has been ma
      1 [corrida-duas-passadas] desfecho=ILEGITIMO emManutencao=3 fechadosPorManutencao=3 avisosPorIncidente=[1, 1, 1] ativadasA=0 ativadasB=-1 falhas=[org.springframework.transaction.UnexpectedRollbackException: Transaction silently rolled back because it has been ma
[ERROR] Tests run: 30, Failures: 30, Errors: 0, Skipped: 0
```

No log: `ERROR: deadlock detected` / `Process 62 waits for ShareLock on transaction 796; blocked by
process 61. Process 61 waits for ShareLock on transaction 797; blocked by process 62.` O Postgres
aborta uma das passadas (60 linhas `Reconciliador: falha ao reavaliar` em 30 repetições), que termina
em `UnexpectedRollbackException`; o estado final só fica certo porque a outra sobrevive. As guardas
provadas são o par "uma transação por equipamento" + "ordem por id em todo lugar".

**7 — `updatable = false` removido de `em_manutencao`** (`Equipamento`)

```
     16 [corrida-put-flag] desfecho=ILEGITIMO nome=SW-01-RENOMEADO emManutencao=false putLeu=PUT_LEU_FORA falhas=[]
     14 [corrida-put-flag] desfecho=PUT_LEU_FORA nome=SW-01-RENOMEADO emManutencao=true putLeu=PUT_LEU_FORA falhas=[]
[ERROR] Tests run: 30, Failures: 16, Errors: 0, Skipped: 0
```

O dirty-check do PUT regrava o `em_manutencao = false` que carregou por cima da virada do job (o lost
update da Task 1, agora numa corrida real em vez de intercalado à mão).

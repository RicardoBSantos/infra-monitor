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
| 1 | job ativa × operador cancela (`ativar-cancelar`) | CANC: CANCELADA, equipamento fora, 1 SLA aberta · ATIV: ATIVA, cancelar → 409, em manutenção, 0 SLA aberta | 21 CANC / 9 ATIV | reconciliador 0–8 ms |
| 2 | encerrar agora × conclusão automática (`encerrar-concluir`) | OPER: `encerrada_por` = operador, tick não relata · AUTO: `encerrada_por` nulo, operador → 409, tick relata. Nos dois: CONCLUIDA, fora, 1 janela de SLA aberta | 12 OPER / 18 AUTO | encerrar 0–2 ms |
| 3 | botão encerrar manual × janela ativando (`manual-ativacao`) | estado único: ATIVA, manual = false, em_manutencao = true, 0 SLA aberta; pela ordem: SAIU_E_VOLTOU / FICOU | 25 SAIU_E_VOLTOU / 5 FICOU | reconciliador 0–8 ms |
| 4 | duas janelas sobrepostas terminando juntas (`duas-janelas`) | as duas CONCLUIDA, fora, exatamente 1 SLA aberta | 30 UMA_SAIDA | 2º encerrar 0–4 ms |
| 5 | janela ativando × motor abrindo incidente (`ativacao-motor`) | MANUT_PRIMEIRO: nenhum incidente · INC_PRIMEIRO: FECHADO/MANUTENCAO; nos dois, sem abertura PENDENTE órfã | 11 MANUT / 19 INC | motor 0–8 ms |
| 6 | duas passadas do reconciliador, 2 janelas UNIDADE, 3 equipamentos com incidente (`duas-passadas`) | sem deadlock/erro, 3 em manutenção, cada incidente fechado 1× com 1 aviso; rótulo = quem ganhou o CAS de ativação | 25 A / 5 B | 2ª passada 0–4 ms |
| 7 | PUT do equipamento × job virando o flag (`put-flag`) | nome novo E em_manutencao = true | 30 PUT_LEU_FORA | PUT 0–8 ms |

Revisão (rodada 1): a corrida 1 passou a exigir 1 janela de SLA aberta no CANC e 0 no ATIV, e a 5
passou a exigir zero abertura PENDENTE órfã também no MANUT_PRIMEIRO. Só essas duas foram re-rodadas:

```
$ ./mvnw test -Dtest='ManutencaoAgendadaConcorrenciaPostgresIntegrationTest#ativacaoECancelamentoConcorrentes+ativacaoEMotorAbrindoIncidente'
     21 [corrida-ativacao-motor] desfecho=INC_PRIMEIRO
      9 [corrida-ativacao-motor] desfecho=MANUT_PRIMEIRO
      9 [corrida-ativar-cancelar] desfecho=ATIV
     21 [corrida-ativar-cancelar] desfecho=CANC
[INFO] Tests run: 60, Failures: 0, Errors: 0, Skipped: 0
```

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

Nota de procedência (corrida 2): as duas reversões abaixo rodaram enquanto o teste ainda lia o atraso
do encerrar de uma propriedade de sistema temporária, `atrasar(Long.getLong("a2", …))`, passada como
`./mvnw test -Dtest='…#encerrarAgoraEConclusaoAutomatica' -Da2=2`. O valor (0–2 ms no encerrar) é o
mesmo da constante final `ATRASO_ENCERRAR_VS_CONCLUSAO_MS = 2`; a propriedade foi retirada do teste
antes do commit e a distribuição final (seção Corridas) foi medida sem ela.

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

Combinação necessária: nenhuma — a reversão do reconciliador sozinha já fica vermelha (17/30); a
guarda que esta corrida prova é a reavaliação dos `cobertosPor` sob o lock, depois do CAS commitado.
O par também foi registrado, como pedia a decisão já tomada.

A leitura da cobertura em instrução separada do `FOR UPDATE` **não tem prova em nível de corrida**, e
a corrida 3 não pode exercitá-la por construção. Lida dentro da instrução que trava, a cobertura só
fica velha se essa instrução começou ANTES do commit do CAS da janela e esperou por um lock tomado
ANTES desse commit (o snapshot da instrução é de antes da espera). Nesta corrida ninguém toma um lock
assim: o reconciliador commita o CAS na transação dele e só depois reavalia, então qualquer lock de
equipamento que ele tome é posterior ao commit, e a instrução de quem espera por ele já começa
depois do commit ou espera um lock que nasceu depois dele. A distribuição deslocada (25/5 → 29/1
SAIU_E_VOLTOU) vem de o botão ler a cobertura antes do CAS commitar — o que acontece com ou sem a
guarda — e não de um snapshot velho pós-espera. A guarda só seria decisiva num caminho que commitasse
a mudança de situação da janela e reavaliasse o equipamento na MESMA transação, segurando o lock do
equipamento através do commit; nenhum caminho de produção faz isso hoje (verificado nas revisões das
Tasks 3/4): `ManutencaoAgendadaService` e `ReconciliadorManutencao` commitam o CAS no seu próprio
`TransactionTemplate` e só depois chamam `reavaliar` por equipamento, um por transação.

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
em `UnexpectedRollbackException`; o estado final só fica certo porque a outra sobrevive. A ordem por
id é a guarda decisiva; a transação por equipamento é redundante, dado que o literal (uma transação
só, mas ordem igual nas duas passadas) ficou verde.

**7 — `updatable = false` removido de `em_manutencao`** (`Equipamento`)

```
     16 [corrida-put-flag] desfecho=ILEGITIMO nome=SW-01-RENOMEADO emManutencao=false putLeu=PUT_LEU_FORA falhas=[]
     14 [corrida-put-flag] desfecho=PUT_LEU_FORA nome=SW-01-RENOMEADO emManutencao=true putLeu=PUT_LEU_FORA falhas=[]
[ERROR] Tests run: 30, Failures: 16, Errors: 0, Skipped: 0
```

O dirty-check do PUT regrava o `em_manutencao = false` que carregou por cima da virada do job (o lost
update da Task 1, agora numa corrida real em vez de intercalado à mão).

## Task 10 — Validação integrada

Branch `feat/manutencao-agendada` em `2842119`. Backend compilado e testado numa cópia por
`git archive HEAD infra-monitor-backend`, fora do `target/` do repositório (o backend diário da 8080
roda do `target/` do repositório e não foi tocado).

### Suítes

Backend, com Docker (Testcontainers, PostgreSQL 16 real):

```
$ ./mvnw test
[INFO] Tests run: 991, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
[INFO] Total time:  04:41 min
$ grep -c "classes puladas" mvn-test.log
0
```

Nenhuma linha `!! N classes puladas`: as classes `@RequerDocker` rodaram todas.

Frontend:

```
$ npx ng test --watch=false
 Test Files  60 passed (60)
      Tests  639 passed (639)
$ npx ng build
Initial total | 356.82 kB | 99.23 kB
Application bundle generation complete.
▲ [WARNING] src/app/features/mapa/mapa.component.scss exceeded maximum budget. Budget 6.00 kB was not met by 91.34 kB with a total of 97.34 kB.
```

O aviso de orçamento é do Mapa (CSS do MapLibre), anterior a este ciclo; o build sai com exit 0.

### E2E (clone)

Banco descartável: container `im-f1-e2e` (postgres:16-alpine, 127.0.0.1:5440) com `pg_dump` do dev
(`inframonitor-postgres`, V20, 221 equipamentos); o jar da branch aplicou a V21 ao clone
(`Successfully applied 1 migration ... now at version v21`). Backend na 8082 com admin próprio de
bootstrap, `MANUTENCAO_AGENDADA_ENABLED=true`, `MANUTENCAO_AGENDADA_INTERVALO_MS=5000`, motor, Telegram e
dispatcher desligados. Frontend da branch em `ng serve --port 4201`; `API_PORT=8082` redireciona as
chamadas. Equipamento: `SWI-07-U1` (id 2, Sede Administrativa), ativo, numa unidade ativa, fora de
manutenção, com 1 monitor.

```
$ MANUT_AG_UNIDADE="Sede Administrativa" MANUT_AG_EQUIPAMENTO="SWI-07-U1" BASE=http://127.0.0.1:4201 \
  API_PORT=8082 npm run e2e:manutencao-agendada
OK    [login] login concluído — http://127.0.0.1:4201/dashboard (API_PORT=8082)
OK    [banner-ausente] agendador ligado: sem banner de desligado
OK    [botao-habilitado] "+ Agendar manutenção" habilitado
OK    [modal-titulo] modal "Agendar manutenção" aberto
OK    [modal-foco-inicial] foco entra no primeiro campo (select Unidade) — SELECT unidadeId
OK    [modal-escape-foco] Escape fecha o modal e o foco volta ao "+ Agendar manutenção" — BUTTON "+ Agendar manutenção"
OK    [modal-contagem] um equipamento selecionado — 1 de 21 selecionados
OK    [post] POST /manutencoes 201 — 201
OK    [aviso-agendada] aviso "Janela #N agendada." — Janela #3 agendada.
OK    [linha-agendada] linha da janela em AGENDADA — Agendada
OK    [linha-escopo] escopo "1 equipamento" com o nome no title — 1 equipamento [title=SWI-07-U1]
OK    [linha-ativa] o job ativou a janela (linha ATIVA) — Ativa após 19 recargas
OK    [equipamento-badge] linha do equipamento em "Em manutenção" — Em manutenção
OK    [equipamento-origem] legenda "Janela #3" — Janela #3
OK    [dialogo-titulo] título do diálogo — Encerrar agora a janela #3?
OK    [dialogo-sla] mensagem é o texto de SLA da spec §3.2 — Os equipamentos voltam a ser verificados na próxima varredura. O período desde o início da janela continua fora do relatório de disponibilidade: nele não houve medição, e encerrar não o devolve ao SLA. Equipamentos que também estão em manutenção manual continuam fora até ela ser encerrada.
OK    [dialogo-botao] botão primário "Encerrar janela"
OK    [encerrar] encerrar 200 — PATCH 200 /manutencoes/3/encerrar
OK    [aviso-encerrada] aviso "Janela #N encerrada." — Janela #3 encerrada.
OK    [linha-concluida] linha CONCLUÍDA no Histórico — Concluída
OK    [sem-erros] nenhum erro de página/console

21/21 OK
```

A janela é a #3 porque as duas primeiras execuções pararam numa verificação do próprio roteiro, não
do produto: a 1ª esperava o nome do equipamento no texto do escopo (a tela mostra "1 equipamento" e
os nomes no `title`, como no design); a 2ª leu a contagem do modal antes de ela re-renderizar ("0 de
21"; a captura do mesmo instante mostra "1 de 21" e o POST levou o equipamento). As duas foram
corrigidas no roteiro (ler o `title`; esperar o texto da contagem). O restante do fluxo passou nas
três execuções.

Capturas em `infra-monitor-frontend/e2e/manutencao-agendada-evidence/` (resultado e log de rede em
`manutencao-agendada.json`):

| # | Arquivo | O que mostra |
|---|---|---|
| 01 | `01-lista-vigentes.png` | `/manutencoes` vazia, sem banner, botão habilitado |
| 02 | `02-modal-agendar.png` | modal recém-aberto, foco no select Unidade |
| 03 | `03-modal-preenchido.png` | unidade, escopo Equipamentos selecionados, 1 de 21, início/fim, motivo |
| 04 | `04-linha-agendada.png` | aviso "Janela #3 agendada." e linha AGENDADA |
| 05 | `05-linha-ativa.png` | a mesma linha ATIVA depois do job |
| 06 | `06-equipamento-janela.png` | Equipamentos: badge "Em manutenção" com a legenda "Janela #3" |
| 07 | `07-menu-encerrar.png` | menu da linha com "Encerrar agora" |
| 08 | `08-dialogo-encerrar.png` | diálogo "Encerrar agora a janela #3?" com o texto de SLA |
| 09 | `09-historico-concluida.png` | Histórico com a linha CONCLUÍDA ("encerrada 19:25 · 30 min antes do previsto") |

Banco do clone depois das três execuções (equipamento 2):

```
 id |  status   |    inicio_previsto     |          ativada_em           |      fim_previsto      |         encerrada_em          | encerrada_por_id
----+-----------+------------------------+-------------------------------+------------------------+-------------------------------+------------------
  3 | CONCLUIDA | 2026-10-22 22:25:00+00 | 2026-10-22 22:25:02.633413+00 | 2026-10-22 22:55:00+00 | 2026-10-22 22:25:04.385826+00 |                8
  2 | CONCLUIDA | 2026-10-22 22:23:00+00 | 2026-10-22 22:23:02.278466+00 | 2026-10-22 22:53:00+00 | 2026-10-22 22:23:07.334226+00 |                8
  1 | CONCLUIDA | 2026-10-22 22:21:00+00 | 2026-10-22 22:21:01.802846+00 | 2026-10-22 22:51:00+00 | 2026-10-22 22:21:04.09493+00  |                8

 id | em_manutencao | manutencao_manual
----+---------------+-------------------
  2 | f             | f

 id  | monitor_id |           inicio_em           |            fim_em
-----+------------+-------------------------------+-------------------------------
 227 |          2 | 2026-10-22 22:25:04.396077+00 |
 226 |          2 | 2026-10-22 22:23:07.342891+00 | 2026-10-22 22:25:02.655455+00
 225 |          2 | 2026-10-22 22:21:04.110774+00 | 2026-10-22 22:23:02.304864+00
  53 |          2 | 2026-07-27 16:31:56.842727+00 | 2026-10-22 22:21:01.844684+00
```

Cada ativação fecha a janela de SLA aberta no instante da ativação (+20–40 ms) e cada encerramento
abre outra. A ativação veio 1,8–2,6 s depois do início previsto (tick de 5 s).

### Carga

Banco `inframonitor-carga` (127.0.0.1:5436), com aval do usuário. Jar da branch na 8081 com a
credencial de `~/.inframonitor-carga/env.sh`, `MANUTENCAO_AGENDADA_ENABLED=true`, intervalo 5000, e motor,
Telegram e dispatcher desligados na 8081 (a 8080 do usuário, com o código antigo da `main`, seguiu com
o motor ligado). A senha de admin do `env.sh` não confere (401), então o bootstrap criou um usuário
próprio, `f1.manutencao@inframonitor.local` (id 2), **desativado ao final** por SQL. A subida aplicou
a V21 ao banco da carga (`now at version v21`): **o banco da carga fica em V21** daqui para frente.

Antes (22:25:57 UTC): `select count(*) from equipamento where em_manutencao` = 0, ou seja, nenhuma
manutenção manual que o código antigo da 8080 pudesse encerrar contra o CHECK novo. Havia só 1
incidente (FECHADO), nenhum episódio de latência aberto e 2 notificações (ids 1–2, ENVIADA).
Equipamento escolhido: `SEDE_TERREO_TI` (id 3, monitor 3, Sede Administrativa), ativo, fora de
manutenção, sem incidente `ABERTO`/`RECONHECIDO`, sem episódio de latência aberto, com 60/60 medições
SUCESSO na última hora e latência máxima de 0 ms.

```
$ MANUT_AG_UNIDADE="Sede Administrativa" MANUT_AG_EQUIPAMENTO="SEDE_TERREO_TI" BASE=http://127.0.0.1:4201 \
  API_PORT=8081 MANUT_AG_OUT=<scratch>/carga/evidence npm run e2e:manutencao-agendada
...
OK    [modal-contagem] um equipamento selecionado — 1 de 3 selecionados
OK    [aviso-agendada] aviso "Janela #N agendada." — Janela #1 agendada.
OK    [linha-ativa] o job ativou a janela (linha ATIVA) — Ativa após 18 recargas
OK    [equipamento-origem] legenda "Janela #1" — Janela #1
OK    [dialogo-sla] mensagem é o texto de SLA da spec §3.2 — ...
OK    [encerrar] encerrar 200 — PATCH 200 /manutencoes/1/encerrar
OK    [linha-concluida] linha CONCLUÍDA no Histórico — Concluída
OK    [sem-erros] nenhum erro de página/console

21/21 OK
```

As capturas da carga ficaram fora do repositório (scratchpad da sessão, `t10/carga/evidence/`), com os
mesmos nomes `01-lista-vigentes.png` … `09-historico-concluida.png` e `manutencao-agendada.json`.

SQL do brief, saída bruta (`:eq` = 3), seguida da desativação do usuário:

```
select id, status, inicio_previsto, ativada_em, fim_previsto, encerrada_em, encerrada_por_id from manutencao_agendada order by id desc limit 3;
 id |  status   |    inicio_previsto     |          ativada_em           |      fim_previsto      |         encerrada_em          | encerrada_por_id 
----+-----------+------------------------+-------------------------------+------------------------+-------------------------------+------------------
  1 | CONCLUIDA | 2026-10-22 22:28:00+00 | 2026-10-22 22:28:01.323606+00 | 2026-10-22 22:58:00+00 | 2026-10-22 22:28:02.861916+00 |                2
(1 row)

select id, em_manutencao, manutencao_manual from equipamento where id = 3;
 id | em_manutencao | manutencao_manual 
----+---------------+-------------------
  3 | f             | f
(1 row)

select id, monitor_id, inicio_em, fim_em from janela_monitoramento where monitor_id in (select id from monitor where equipamento_id = 3) order by id desc limit 4;
 id | monitor_id |           inicio_em           |            fim_em             
----+------------+-------------------------------+-------------------------------
  8 |          3 | 2026-10-22 22:28:02.879278+00 | 
  3 |          3 | 2026-10-14 16:17:08.934438+00 | 2026-10-22 22:28:01.367045+00
(2 rows)

select id, status, motivo_encerramento, fechado_por from incidente where monitor_id in (select id from monitor where equipamento_id = 3) order by id desc limit 3;
 id | status | motivo_encerramento | fechado_por 
----+--------+---------------------+-------------
(0 rows)

select id, tipo_evento, status from notificacao order by id desc limit 5;
 id |    tipo_evento    | status  
----+-------------------+---------
  2 | INCIDENTE_FECHADO | ENVIADA
  1 | INCIDENTE_ABERTO  | ENVIADA
(2 rows)

select count(*) em_manut from equipamento where em_manutencao;
 em_manut 
----------
        0
(1 row)

update usuarios set ativo=false where email='f1.manutencao@inframonitor.local';
UPDATE 1
select id, email, ativo from usuarios order by id;
 id |              email               | ativo 
----+----------------------------------+-------
  1 | admin.carga@inframonitor.local   | t
  2 | f1.manutencao@inframonitor.local | f
(2 rows)
```

Conferência contra o esperado:

- janela CONCLUIDA com carimbos reais: ativada 1,3 s depois do início previsto, encerrada pelo usuário 2;
- flags de volta a false/false;
- a janela de SLA 3 (aberta desde 14/10) fechou no instante da ativação (22:28:01.367) e a 8 abriu no
  encerramento (22:28:02.879);
- nenhum incidente e nenhuma notificação novos, então o dispatcher da 8080 não teve o que enviar ao
  grupo do Telegram.

Depois do encerramento, o motor da 8080 voltou a medir o monitor 3 (a última medição avançou além de
22:27:49).

**Convivência com a 8080.** A 8080 roda código da `main`, que não conhece `manutencao_manual`. Uma
manutenção manual iniciada por ela grava `em_manutencao = true` com `manutencao_manual = false`.
Quando a 8080 passar a rodar o código da F1, o reconciliador vai tratar essa linha como divergência e
tirar o equipamento de manutenção. Antes de trocar o código da 8080, conferir
`select id, nome from equipamento where em_manutencao and not manutencao_manual` e, para cada linha,
marcar `manutencao_manual = true` ou reiniciar a manutenção pela tela.

### Limpeza

Os processos iniciados nesta validação foram parados por PID: os jars `im-f1-clone.jar` e
`im-f1-carga.jar`, o `ng serve --port 4201` e o esbuild filho dele. O container `im-f1-e2e` foi
removido e os arquivos de senha/env gerados, apagados. Prova:

```
processos com im-f1-*.jar ou "serve --port 4201": 0
$ netstat -ano  (LISTENING em 8080/4200/8081/8082/4201)
  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       21192
  TCP    127.0.0.1:4200         0.0.0.0:0              LISTENING       61288
  TCP    [::]:8080              [::]:0                 LISTENING       21192
$ docker ps --format '{{.Names}}'
inframonitor-carga
inframonitor-postgres
```

As portas 8081, 8082 e 4201 estão livres; a 8080 (PID 21192) e a 4200 (PID 61288) seguem intactas.

### Decisões

Nenhuma decisão nova nesta task: o log de decisões continua em MA17.

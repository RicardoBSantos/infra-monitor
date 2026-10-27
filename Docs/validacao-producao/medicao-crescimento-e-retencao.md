# Medição — crescimento, consultas O(histórico) e retenção

Data: 2026-10-27. Branch `perf/medicao-consultas-lateral` a partir de `main` (`cd0ae4b`).
PostgreSQL 16.15 (Docker no dev; produção será nativo no Windows). Bancos medidos: dev
(`inframonitor-postgres`, 5434, 317.080 medições, dados sintéticos) e carga
(`inframonitor-carga`, 5436, 87.313 medições reais de 14 monitores). As medições antes/depois
foram feitas em **clones** (`pg_dump` → container descartável); os bancos originais só foram lidos.

## 1. Resumo

O primeiro problema de crescimento não era disco nem retenção: três consultas liam a tabela
`medicao` inteira a cada chamada, então o custo crescia com o histórico total, não com o período
pedido. As três foram corrigidas neste branch. Retenção e agregação **não** foram implementadas;
ficam com gatilho definido (seção 6).

| Consulta | Quem chama | Antes (dev, 317 mil) | Depois (dev) | Antes (carga, 87 mil) | Depois (carga) |
|---|---|---|---|---|---|
| Agendador do motor (`findActiveExecutionCandidates`) | a cada 1 s | 240 ms | **2,3 ms** | 60 ms | **0,46 ms** |
| ESTADOS do painel (DV19) | topbar, `/dashboard/equipamentos`, mapa | 190 ms | **2,8 ms** | 43 ms | **0,53 ms** |
| SLA (CTE `janelas`), 30 dias | painel, unidades, relatórios, PDF | 128 ms | **2,1 ms** | 40 ms | **0,64 ms** |

Escala medida antes da correção, em banco descartável com dados sintéticos no ritmo real (150
monitores a 60 s): com 10× o dev (3,2 M linhas) e 50× (15,9 M) o agendador ia a 1,6 s e 6,9 s por
tick, o ESTADOS a 7,9 s e 36 s, e o SLA a 1,0 s e 4,7 s (5,8 s para um período de **um** dia). Com a
reescrita, no mesmo banco de 50×: 1,8 ms, 0,7 ms e 6,7 ms.

Planos completos (antes e depois, nos clones):
[evidencias/medicao-explain-antes-depois.txt](evidencias/medicao-explain-antes-depois.txt).

## 2. O que mudou

### a) Última medição por monitor: `between` no lugar de `=`

Agendador, ESTADOS e `MedicaoRepository.findLatestByMonitorIds` (DV17) buscam agora a última
medição com uma leitura de `ix_medicao_monitor_executado_em` por monitor:

```sql
where md.monitor_id between m.id and m.id
order by md.monitor_id, md.executado_em desc, md.id desc
limit 1
```

O `between` é deliberado. Com `md.monitor_id = m.id`, o PostgreSQL descarta `monitor_id` do
`order by` como chave redundante, e com poucos monitores (o caso da produção no início) prefere
varrer `ix_medicao_executado_em` para trás, filtrando o monitor. Esse plano acerta por acaso
enquanto o monitor tem medição recente; para monitor **sem medição** ou **inativo há meses**, ele
percorre o índice inteiro. Medido: 80.612 leituras numa tabela de 40.001 linhas. Com o intervalo,
só o índice composto entrega a ordem pedida, e o plano fica preso a ele. O `findLatestByMonitorIds`
já era LATERAL desde a DV17, mas tinha o mesmo defeito de plano.

### b) SLA lê `janela_monitoramento.primeira_medicao_em` (V24)

O SLA só lia `medicao` para saber a primeira medição de cada janela
(`greatest(:inicio, j.inicio_em, primeira)`). A V24 guarda esse valor na própria janela, preenche as
janelas existentes com a regra antiga (menor `executado_em` em `[inicio_em, fim_em)`) e passa a
mantê-lo por gatilho:

- `AFTER INSERT` em `medicao`: UPDATE condicional
  (`WHERE primeira_medicao_em IS NULL OR primeira_medicao_em > NEW.executado_em`). Sem
  ler-depois-escrever; medições concorrentes do mesmo monitor se serializam na linha da janela, e o
  EvalPlanQual garante que fica o menor valor.
- `BEFORE INSERT OR UPDATE OF inicio_em, fim_em` em `janela_monitoramento`: busca a primeira entre as
  medições que já existem, **só** quando ela falta ou caiu fora do período. Um valor válido nunca é
  recalculado, porque depois de uma retenção a medição que o originou pode não existir mais.

Gatilho, e não serviço, porque medição entra por vários caminhos (motor, seed SQL, testes, psql);
um caminho que esquecesse de gravar viraria `SEM_DADOS` silencioso no SLA. A entidade
`JanelaMonitoramento` **não** mapeia a coluna: o Hibernate atualiza todas as colunas mapeadas em
`fechar()` e regravaria por cima o valor do gatilho.

Uma versão LATERAL do SLA (sem coluna) foi medida e descartada: o plano dependia do planner. Uma
janela antiga fechada e vazia relia o resto do monitor (2.020 leituras), e com
`coalesce(fim_em, 'infinity')` o planner trocava para o índice global (800 mil leituras).

### c) Exclusão de monitor trava o monitor primeiro

Com o gatilho, `MonitorService.excluir` (apaga as janelas e depois o monitor) podia entrar em
deadlock com o motor gravando a primeira medição no meio: o INSERT segura `FOR KEY SHARE` no
monitor (FK) e espera a janela apagada; o DELETE do monitor espera o `KEY SHARE`. Resultado: 40P01,
500. Agora `excluir` começa com `select … for update` nativo no monitor. O `PESSIMISTIC_WRITE` do
Hibernate não serve: vira `FOR NO KEY UPDATE`, que não conflita com `FOR KEY SHARE`.

## 3. Como foi verificado

**Equivalência nos dados reais (clones do dev e da carga):**

- Agendador, `monitor_estado`, `equipamento_estado` e `findLatestByMonitorIds`, versão nova contra a
  antiga (`EXCEPT ALL` nos dois sentidos): **0 diferenças** nos dois bancos (217 + 221 + 221 + 220
  linhas no dev; 14 em cada no carga).
- SLA pela coluna contra o SQL antigo, depois de aplicar a V24 nos clones: **511 cenários, 0
  diferenças**. Dev: 7 períodos (30 d, 3 d, 365 d, 1 d, período sem dados, período futuro, período
  no vão depois do fim dos dados) × (sem filtro, cada uma das 11 unidades, 25 monitores), mais a série
  diária de cada unidade. Carga: 7 períodos × (sem filtro, 5 unidades, 14 monitores) mais a diária.
  4.117 linhas `CALCULADO` comparadas no total.
- Backfill da V24: dev 220 de 223 janelas preenchidas (3 sem medição alguma, ficam nulas); carga 23
  de 23. Tempo da migration: abaixo de 10 ms nos dois.

**Testes automatizados (rodam em toda suíte, exigem Docker):**

- `ConsultasSobreMedicaoEquivalenciaPostgresIntegrationTest`: compara as quatro consultas com os
  oráculos congelados em `src/test/resources/oraculo-medicao/` num cenário com os casos de borda:
  monitor sem medição, monitor com uma só, janela recém-aberta sem medição, medição exatamente no
  início (conta) e no fim (não conta) da janela, medição antes da janela, período sem dados, período
  futuro, empate de `executado_em` decidido pelo id, inserção fora de ordem, equipamento em
  manutenção, inativo e sem monitor.
- `LeituraDeMedicaoLimitadaPostgresIntegrationTest`: trava de desempenho por **linhas lidas**, não
  por tempo. O contador vem de `pg_stat_get_xact_tuples_returned` (tabela e cada índice), na própria
  transação e sem paralelismo, então o número é determinístico. Tempo seria instável em CI, e
  "ausência de seq scan" não pegaria o SLA antigo (index only scan sobre tudo) nem o plano ruim do
  `=` (index scan sobre tudo). Teto: 10 leituras por monitor; SLA: **zero**. Prova de reversão: o
  oráculo passa pelo mesmo medidor e precisa estourar o teto. Conferido por mutação: voltar cada uma
  das quatro consultas à forma antiga, ou tirar a trava de `excluir`, faz o teste correspondente
  falhar.
- `V24PrimeiraMedicaoDaJanelaPostgresIntegrationTest`: backfill (Flyway até a V22, dados, depois V24)
  e os dois gatilhos, incluindo medições concorrentes do mesmo monitor e janela fechada depois de a
  medição de origem ter sido apagada.
- `PrimeiraMedicaoNaAplicacaoPostgresIntegrationTest`: caminho real (`MedicaoService.criar`,
  `MonitorService.desativar` pelo Hibernate) e SLA idêntico depois de apagar todas as medições.
- `ExclusaoEJanelaPostgresIntegrationTest`: o deadlock da ordem antiga reproduzido (40P01), e a
  exclusão nova bloqueando no `for update` do monitor antes de tocar a janela.

**Varredura** por `distinct on` e `max/min(executado_em)` sobre `medicao` no backend e em `tools/`:
fora as consultas corrigidas, `distinct on` só aparece sobre `monitor_estado` (já uma linha por
monitor) e sobre `manutencao_agendada_alteracao`; `min/max(executado_em)` só na V13 (backfill único).
O caminho Java de disponibilidade (`DisponibilidadeEquipamentoTemporalService`) ainda carrega as
medições do período, mas só é usado quando o repositório SQL não existe (testes unitários).

## 4. Tamanho e ritmo reais

- **Bytes por medição: ~200 B** com índices. Na carga: 205 B (91 de linha + 114 de índices:
  `pk` 23, `monitor_executado_em` 56, `executado_em` 35). O dev dá 150 B porque foi semeado em lote.
- **Ritmo** (carga, dias completos): monitor de 30 s → ~2.800 medições/dia (97% das 2.880
  teóricas); de 60 s → ~1.424/dia (99%). O dev é semeado a 48/dia e não serve para ritmo.
- **Outras tabelas** (`incidente`, `notificacao`, `janela_monitoramento`, episódios): menos de 1
  incidente por dia na carga; abaixo de 10 MB por ano mesmo multiplicado por 20.
- **Backup** (`pg_dump -Fc`): ~15 B por medição na carga (≈7% do tamanho em disco).

### Projeção (um monitor por equipamento, com índices)

| Cenário | Por dia | 1 mês | 3 meses | 6 meses | 1 ano |
|---|---|---|---|---|---|
| 7 eq · 60 s | 10 mil · 2 MB | 0,3 M · 60 MB | 0,9 M · 181 MB | 1,8 M · 363 MB | 3,6 M · **0,7 GB** |
| 7 eq · 30 s | 20 mil · 4 MB | 0,6 M · 118 MB | 1,8 M · 357 MB | 3,6 M · 713 MB | 7,2 M · **1,4 GB** |
| 50 eq · 60 s | 71 mil · 14 MB | 2,1 M · 427 MB | 6,5 M · 1,3 GB | 13 M · 2,6 GB | 26 M · **5,2 GB** |
| 50 eq · 30 s | 140 mil · 28 MB | 4,2 M · 840 MB | 12,7 M · 2,5 GB | 25 M · 5,1 GB | 51 M · **10,2 GB** |
| 150 eq · 60 s | 214 mil · 43 MB | 6,4 M · 1,3 GB | 19 M · 3,9 GB | 39 M · 7,8 GB | 78 M · **15,6 GB** |
| 150 eq · 30 s | 420 mil · 84 MB | 12,6 M · 2,5 GB | 38 M · 7,6 GB | 76 M · 15,3 GB | 153 M · **30,7 GB** |

## 5. Quem usa o detalhe, e até quando

| Consumidor | Janela que usa |
|---|---|
| Motor (incidente, episódio de latência) | últimas N por monitor (N ≤ 100) e a última no agendador: minutos |
| SLA / disponibilidade | períodos de até 365 d, mas **não lê medição** desde a V24 |
| Gráfico do drawer de equipamento | 26 min (60 pontos); KPIs do drawer: 30 d |
| Gráfico da ocorrência (drawer de incidente) | o período do incidente + 5 min, **qualquer idade** |
| Tela Medições | sem período padrão; começa pelas mais recentes |
| Painel e Unidades | 30 d (latência mín/média/máx/p95) |
| Relatórios e CSV | medições até 31 d, latência até **90 d com p95**, qualquer data passada |
| PDF Visão Geral | 31 d: top 5 de latência com p95 e contagem de falhas |

A operação precisa de 30 d de detalhe; os relatórios de latência só ficam exatos com 90 d, porque
p95 não se reconstrói de mín/média/máx.

## 6. Gatilhos (nada disto está implementado)

| Mudança | Gatilho | Por quê |
|---|---|---|
| **Retenção por DELETE**, 90 dias, job na aplicação (`@Scheduled` noturno, lotes de ~10 mil linhas por `ix_medicao_executado_em`), **desligada por padrão** como o motor e o Telegram | `medicao` passar de **10 M linhas** ou **2 GB**, ou **12 meses** de produção, o que vier antes | Disco. Com a V24 o SLA não perde nada ao apagar. Job na aplicação e não tarefa agendada do Windows com `psql.exe`: fica versionado, testado e sem senha guardada na tarefa |
| **Agregado por hora** (mín, soma, máx, contagem de sucesso e falha por monitor e hora) | `/relatorios/latencia` de 30 d passar de **1 s**, perto de **20 equipamentos a 60 s** (≈1 M linhas no período; medido ~1,1 s por milhão) | Desempenho. A latência de 30 e 90 d cresce com monitores × período, e reter menos não ajuda. É a única opção que a acelera |
| **Particionamento por data** | não fazer; reavaliar acima de **~50 M linhas retidas** | Com 90 d de detalhe, 150 eq a 60 s ficam em ~19 M linhas; um DELETE diário de ~214 mil linhas é trivial para o PostgreSQL. A PK viraria `(id, executado_em)` e exigiria job de criação de partição (pg_partman não é trivial no Windows) |

Para conferir os gatilhos de disco:

```sql
select count(*) linhas, pg_size_pretty(pg_total_relation_size('medicao')) tamanho, min(executado_em) desde
  from medicao;
```

### Pendência para decisão

As opções de retenção (DELETE) e de agregado por hora fazem perder, para o que for mais antigo que
o detalhe guardado (90 d):

- o **gráfico das ocorrências antigas** no drawer de incidente (fica "Sem medições registradas");
- o **p95 de latência** (o agregado guarda mín/média/máx; p95 seria aproximado, ou exigiria
  histograma por faixa).

Se algum dos dois for requisito de auditoria, o detalhe precisa ser guardado por mais tempo ou o
agregado precisa de histograma. Decisão do responsável pelo produto, antes de ligar a retenção.

## 7. Dimensionamento do disco da VM

Base: até 50 equipamentos, 12 meses, **sem** retenção ligada (o gatilho de 10 M linhas dispara por
volta do 5º mês a 50 eq e 60 s, mas o disco não pode depender de alguém ligá-la a tempo).

| Item | 50 eq · 60 s | 50 eq · 30 s (pior caso) |
|---|---|---|
| `medicao` com índices (tabela da seção 4) | 5,2 GB | 10,2 GB |
| Folga de inchaço (páginas parcialmente ocupadas, autovacuum) | +20% → 6,3 GB | +20% → 12,3 GB |
| Demais tabelas e catálogo | 0,5 GB | 0,5 GB |
| WAL (`max_wal_size` = 1 GB, pode passar em pico) | 2 GB | 2 GB |
| Arquivos temporários (ordenação dos relatórios de latência; 1,1 GB medidos com 15,9 M linhas) | 2 GB | 2 GB |
| 7 backups diários locais (`pg_dump -Fc`, ~15 B por medição) | 7 × 0,4 GB ≈ 2,8 GB | 7 × 0,8 GB ≈ 5,6 GB |
| **Subtotal** | **≈14 GB** | **≈22 GB** |

**Recomendação: reservar 40 GB** para o PostgreSQL (dados, WAL e backups locais). Isso cobre o pior
caso de 12 meses com ~45% livre, espaço suficiente para restaurar um backup ao lado do banco num
teste de recuperação ou para um `REINDEX`. Com a retenção de 90 d ligada, o banco estabiliza em
~1,3 GB (60 s) ou ~2,5 GB (30 s) e os 40 GB passam a ser folga. Configurar alerta de disco em 70%.
Os backups locais não substituem uma cópia fora da VM.

## 8. Dependência de merge

A migration é a **V24**: a V23 está reservada para `feat/manutencao-f3`, que ainda não foi enviado.
A F3 precisa entrar antes deste branch. Com a V24 aplicada, o Flyway recusa uma V23 pendente
(`validate` falha com "resolved migration not applied"). Se a ordem se inverter, renumerar a V24
antes do merge, nunca depois de aplicada em algum banco.

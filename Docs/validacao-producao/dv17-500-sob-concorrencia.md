# DV17 — 500 sob concorrência em `/dashboard/unidades/{id}/equipamentos`

Data: 2026-10-16. Branch `chore/fecho-mapa-dv17` a partir de `main` (`e0d0078`). Banco de dev
(`inframonitor-postgres`, 5434): 11 unidades, 221 equipamentos, 221 monitores, **317.080 medições**
(45 MB). PostgreSQL 16.15 em Docker, `/dev/shm` de **64 MB** (padrão do Docker),
`max_parallel_workers_per_gather = 2`, `work_mem = 4MB`. Motor desligado: o pool inteiro (20) fica
para a API.

Achado original (D20, `e2e:n08`): 92 de 121 chamadas simultâneas devolveram 500. A suspeita
registrada era esgotamento do pool. **A suspeita estava errada.**

## Diagnóstico

### a) Exceção e camada

Reproduzido duas vezes com a mesma rajada de 121: **112 × 500 e 9 × 200**. As 112 falhas têm a
mesma origem, `DashboardService.java:106`, a chamada de `MedicaoRepository.findLatestByMonitorIds`:

```
org.springframework.orm.jpa.JpaSystemException: JDBC exception executing SQL [ERROR: could not resize
  shared memory segment "/PostgreSQL.1321823330" to 2097152 bytes: No space left on device] [select m1_0.id, ...]
  at ...findLatestByMonitorIds(Unknown Source)
  at br.com.inframonitor.dashboard.DashboardService.equipamentosDaUnidade(DashboardService.java:106)
  at br.com.inframonitor.dashboard.DashboardController.equipamentos(DashboardController.java:64)
Caused by: org.hibernate.exception.GenericJDBCException: JDBC exception executing SQL [...]
Caused by: org.postgresql.util.PSQLException: ERROR: could not resize shared memory segment
  "/PostgreSQL.1321823330" to 2097152 bytes: No space left on device
  Onde: parallel worker
```

Stack completo: [evidencias/dv17-stacktrace-500.txt](evidencias/dv17-stacktrace-500.txt).
SQLState `53100` (`disk_full`). **A falha é do PostgreSQL**, dentro de um worker paralelo, e sobe até
virar o 500 genérico do `TratadorGlobalDeErros`.

O stack só pôde ser lido com um patch local: o tratador logava `ex.getClass().getSimpleName()` e
mais nada. Corrigido junto (ver abaixo).

### b) Conexões e SQL por chamada

Uma chamada abre **uma** conexão para o filtro JWT, que é devolvida em seguida, e segura **uma**
durante a transação `readOnly` do serviço. `open-in-view` está desligado, e não há lazy loading
fora da transação. São **6 statements fixos**, sem N+1 (medido com `org.hibernate.SQL`):

1. `usuarios` (filtro JWT)
2. CTE `ESTADOS` inteira, com o agregado de **todas** as unidades, só para checar se a unidade existe
3. página de `equipamento`
4. `monitor ... where equipamento_id in (...)`
5. **última medição por monitor**
6. `incidente ... where monitor_id in (...) and status in (...)`

O 5 é o problema. O `NOT EXISTS` em JPQL vira, para a unidade com mais monitores (26):

```
Gather  Workers Launched: 1
  ->  Parallel Hash Anti Join   (rows=158540 loops=2 em cada lado)
        ->  Parallel Seq Scan on medicao m1_0
        ->  Parallel Hash  Buckets: 131072  Batches: 4  Memory Usage: 5472kB
              ->  Parallel Seq Scan on medicao m3_0
Execution Time: 606.783 ms
```

Lê a tabela inteira **duas vezes** para devolver 26 linhas, e guarda o hash em memória
compartilhada dinâmica, que no Linux é o `/dev/shm`. Com 20 dessas em paralelo (uma por conexão do
pool), os segmentos passam dos 64 MB e o PostgreSQL recusa o próximo.

### c) O pool na rajada

Medido em `pg_stat_activity` durante a rajada: **20 de 20 conexões em uso**, e **nenhum**
`Connection is not available` no log. O pool satura, mas quem espera entra na fila do Hikari
(timeout de 30 s) e não falha. A conta de 20 (10 para o motor e segundo plano, 10 para a API) não
foi medida com o motor ligado nesta rodada.

### d) Outros endpoints

Mesma rajada de 121, um endpoint por vez ([evidencias/dv17-outros-endpoints-antes.txt](evidencias/dv17-outros-endpoints-antes.txt)):

| Endpoint | Resultado | p50 | Pool |
|---|---|---|---|
| `/dashboard/resumo` | 121 × 200 | 777 ms | 20/20 |
| `/dashboard/unidades` | 121 × 200 | 1403 ms | 20/20 |
| `/dashboard/unidades/{id}` | 121 × 200 | 1311 ms | 20/20 |
| `/dashboard/equipamentos` | 121 × 200 | 1326 ms | 20/20 |
| `/relatorios/disponibilidade/unidades` | 121 × 200 | 1697 ms | 20/20 |
| `/relatorios/disponibilidade/equipamentos` | 121 × 200 | 1259 ms | 20/20 |
| `/dashboard/incidentes`, `/equipamentos`, `/incidentes`, `/unidades` | 121 × 200 | 129–188 ms | — |
| `/relatorios/latencia`, `/visao-geral/indicadores`, `/incidentes` | 121 × 200 | 119–155 ms | — |
| **`/dashboard/unidades/{id}/equipamentos`** | **9 × 200, 112 × 500** | 2345 ms | 20/20 |

Só o endpoint da DV17 falha. Os seis que passam pela CTE `ESTADOS` (que faz `distinct on` sobre a
`medicao` inteira) saturam o pool e respondem devagar, mas respondem: o plano deles não usa hash
paralelo. Viram dívida própria (DV19 em `Docs/mapa-architecture/mapa-dividas.md`).

### e) Aumentar o pool é remendo, e piora

Mais conexões significam mais consultas simultâneas, mais hashes paralelos e mais `/dev/shm`
disputado. Menos conexões só esconderiam o problema na fila. O número certo do pool **continua
20**: a correção tira a consulta do caminho do `/dev/shm`, e o pool deixa de ser o gargalo dessa
rota (abaixo, 500 chamadas com pico de 17 em uso).

`shm_size` maior no container é defesa adicional legítima, mas não entra aqui: é configuração de
infraestrutura, e o PostgreSQL de produção não está documentado (se é Docker, e com que `/dev/shm`).
Fica registrado como pergunta em aberto.

## Correção

1. **`MedicaoRepository.findLatestByMonitorIds`**: consulta nativa com `LATERAL ... LIMIT 1` por
   monitor, sobre o índice `ix_medicao_monitor_executado_em (monitor_id, executado_em DESC)`. Mesmo
   desempate (`executado_em desc, id desc`). Plano: `Nested Loop` → `Index Scan` → `Limit`, **0,35 ms**
   contra 606 ms, sem worker paralelo. O custo passa a ser O(monitores), não O(medições).
2. **`DashboardService.equipamentosDaUnidade`**: a checagem de existência deixa de rodar o agregado
   de todas as unidades e vira `select exists (select 1 from unidade where id = ?)`
   (`DashboardReadRepository.existeUnidade`). Mesmo 404 para unidade inexistente.
3. **`TratadorGlobalDeErros`**: o 500 inesperado passa a logar o stack trace.

## Teste de carga com prova de reversão

Script versionado: `tools/rajada-api/rajada.cjs`. Mesma rajada de 121 chamadas simultâneas em
`/dashboard/unidades/{id}/equipamentos?size=200&sort=nome`, banco de dev, mesmo processo de subida:

| Build | Resultado | p50 | máx | Pool |
|---|---|---|---|---|
| `main` sem correção | **10 × 200, 111 × 500** | 1408 ms | 3875 ms | 20/20 |
| com a correção (3 rodadas) | **121 × 200** (as três) | 309–382 ms | 364–510 ms | ≤ 14 |
| com a correção, **500** chamadas | **500 × 200** | 1543 ms | 1804 ms | 17 |
| correção, mas **só a consulta revertida** | **5 × 200, 116 × 500** | 746 ms | — | 19 |

A última linha é a prova de causalidade: com as mudanças 2 e 3 mantidas e só a consulta antiga de
volta, a mesma rajada volta a falhar, agora com o stack trace completo no log. A consulta é a causa,
e a mudança 2 sozinha não resolve.

Rajada mista (242 chamadas, os quatro endpoints do mapa intercalados): **242 × 200**, p50 de 2783 ms,
puxado pelos endpoints da CTE `ESTADOS` (DV19).

JSONs das rodadas: `evidencias/dv17-r-*.json`.

## Testes automatizados

- `InventarioDashboardPostgresIntegrationTest.ultimaMedicaoPorMonitorEscolheAMaisRecenteEDesempataPeloMaiorId`
  (novo, Testcontainers): mais recente, empate em `executado_em` decidido pelo maior id, monitor
  sem medição ausente, monitor não pedido ausente. **Mutação conferida**: trocar o desempate para
  `id asc` faz o teste falhar.
- `statusELatenciaBatemComOResolverJavaEmTodosOsEquipamentos` (existente): o caminho Java (que usa a
  consulta nova) bate com o SQL da CTE em status e latência nos 220 equipamentos.

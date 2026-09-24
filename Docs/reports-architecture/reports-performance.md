# R02.5 — Performance, EXPLAIN e homologação final

**Status:** concluído com ressalvas de escala futura. Medição feita em 24/08/2026, em base isolada e sintética; não foram usados dados de produção.

## Ambiente e volume

PostgreSQL 16.15 (`postgres:16-alpine`), Java 24.0.1, Docker Desktop com aproximadamente 7,8 GB de memória disponível.

| Entidade | Volume |
|---|---:|
| Unidades | 20 |
| Equipamentos | 500 |
| Monitores ICMP | 750 |
| Janelas | 1.500 |
| Medições | 150.500 |
| Incidentes | 6.000 |
| Notificações | 6.000 |

A massa contém monitores sem dados e desativados, duas janelas por monitor (algumas abertas), falhas/sucessos, latências variadas e incidentes sobrepostos. `ANALYZE` foi executado após a carga.

## EXPLAIN (ANALYZE, BUFFERS)

| Relatório | Planning | Execution | Plano / sort / buffers | Avaliação |
|---|---:|---:|---|---|
| Disponibilidade equipamentos, unidade + métrica desc | 3,626 ms | 14,018 ms | CTE materializada para 38 monitores; index-only `ix_medicao_monitor_executado_em` (38 loops); hash dos 6.000 incidentes; quicksort 34 kB; 7.778 shared hit | Adequado; sem temp. |
| Disponibilidade unidades, métrica desc | — | — | Mesma CTE, depois `GROUP BY unidade_id` (20 grupos), em memória | Adequado; HTTP warm 135,5 ms. |
| Incidentes, unidade/status/período | 0,697 ms | 1,142 ms | `ix_equipamento_unidade` + `ix_incidente_monitor_iniciado_em`; top-N 37 kB; 396 hit | Adequado. |
| Medições, monitor/período, data desc | 1,928 ms | 0,455 ms | bitmap `ix_medicao_monitor_executado_em`; quicksort 32 kB; 77 hit | Adequado; count 0,137 ms/72 hit. |
| Latência, monitor/período | 0,606 ms | 1,363 ms | índice temporal + `GroupAggregate`; incremental sort até 47 kB; 233 hit | Adequado; `percentile_cont(0.95)` permanece no PostgreSQL. |
| Notificações, status/canal/tipo/período | 0,498 ms | 1,001 ms | bitmap `ix_notificacao_status_created_at`; top-N 31 kB; 109 hit | Adequado; count 0,553 ms/109 hit. |

Os sequential scans observados ficaram em relações pequenas (20 unidades, 750 monitores, 1.500 janelas) ou na leitura integral justificada de 6.000 incidentes da CTE. Não houve spill para disco. Nested loops são seletivos e dirigidos por monitor/unidade. O count da disponibilidade repete a CTE para manter `totalElements` real; custa ordem semelhante à página e é uma limitação conhecida, não uma alteração de contrato nesta release.

## Índices, paginação e memória

Inventário relevante: `ix_equipamento_unidade`, `ix_monitor_equipamento`, `ix_medicao_monitor_executado_em`, `ix_medicao_executado_em`, `uq_incidente_monitor_aberto`, `ix_incidente_monitor_iniciado_em`, `ix_incidente_status_iniciado_em`, `ix_notificacao_incidente_id`, `ix_notificacao_status_created_at`, `uq_janela_monitoramento_aberta` e `ix_janela_monitoramento_monitor_periodo`.

Nenhum índice foi adicionado/removido: os existentes já são usados e um índice amplo em canal/tipo/status não se justifica com uma única cardinalidade de canal e 6.000 notificações. Em medições globais (`size=50`), páginas 0, 10 e 50 tiveram medianas HTTP de 80,5, 81,8 e 80,5 ms. Filtros, sort, paginação e count são server-side; a auditoria não encontrou N+1 nem listas amplas ordenadas em Java.

## Benchmark, regressão e veredito

| Endpoint | Cold-ish | Mediana warm | Pior | Classificação |
|---|---:|---:|---:|---|
| disponibilidade/equipamentos | 180,8 | 74,2 | 180,8 | adequado para MVP |
| disponibilidade/unidades | 173,4 | 135,5 | 173,4 | adequado para MVP |
| incidentes | 50,6 | 46,8 | 50,6 | adequado para MVP |
| medicoes | 73,6 | 50,2 | 73,6 | adequado para MVP |
| latencia | 47,2 | 37,0 | 47,2 | adequado para MVP |
| notificacoes | 46,0 | 41,2 | 49,1 | adequado para MVP |

Os seis endpoints retornaram 200 com JWT ADMIN; sem Authorization, medições retornou 401. `./mvnw.cmd test` executou 164 testes: 0 failures, 0 errors, 0 skipped, **BUILD SUCCESS**. Não houve alteração de código/schema, logo fórmula, DTOs, p95, contrato HTTP e RBAC não foram modificados.

Riscos futuros: repetir EXPLAIN antes de milhões de medições; a CTE temporal/count e OFFSET profundo são os pontos a reavaliar antes de retenção, particionamento ou agregados. Essas ações não pertencem à R02.5.

**Veredito: R02 HOMOLOGADA COM RESSALVAS. Backend de Relatórios pronto para Frontend: SIM.**

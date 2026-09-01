# R01 — Arquitetura de Relatórios e Histórico Operacional

**Status:** decisão arquitetural para R02–R05. Esta fase não adiciona código de produção, migrations, endpoints, telas, gráficos nem exportação executável.

## 1. Diagnóstico confirmado

### Dados e relações existentes

| Relação | Implementação atual |
|---|---|
| Unidade → Equipamento | `equipamento.unidade_id` obrigatório; N equipamentos por Unidade. |
| Equipamento → Monitor | `monitor.equipamento_id` obrigatório; N monitores por Equipamento. |
| Monitor → Medição | `medicao.monitor_id` obrigatório; N medições imutáveis por Monitor. |
| Monitor → Incidente | `incidente.monitor_id` obrigatório; N incidentes por Monitor. |
| Incidente → Notificação | `notificacao.incidente_id` obrigatório; até uma notificação por `(incidente, canal, tipoEvento)`. |

Campos temporais reais: `Monitor.createdAt/updatedAt`, `Equipamento.createdAt/updatedAt`, `Medicao.executadoEm` (informado pelo executor; em ICMP é o instante da execução) e `createdAt`, `Incidente.iniciadoEm/encerradoEm` e `createdAt/updatedAt`, `Notificacao.createdAt/enviadoEm/updatedAt`. Todos são `Instant`/`TIMESTAMPTZ` e devem trafegar em ISO-8601 UTC.

O engine somente agenda monitores e equipamentos atualmente ativos. Desativar Monitor ou Equipamento apenas muda o booleano `ativo`; não fecha incidente e não grava o instante da transição. `updatedAt` **não** é histórico de ativação: também muda em edição. Portanto ele não pode ser usado como data de desativação em relatórios.

O banco garante no máximo um incidente `ABERTO` por Monitor com `uq_incidente_monitor_aberto`. Incidentes fechados não têm constraint de não sobreposição; dados antigos, inserções diretas ou bugs podem sobrepor intervalos e exigem união de intervalos no cálculo.

O dashboard atual resolve o estado presente por incidente aberto e existência de última medição; isto não é disponibilidade histórica e não deve ser reutilizado como fórmula.

### Limitação que R02 precisa resolver

Não existe histórico de períodos ativo/inativo de Monitor ou Equipamento. Para uma disponibilidade temporal correta, R02 deve introduzir uma migration versionada (não nesta R01) com intervalos de elegibilidade de monitoramento, por exemplo `janela_monitoramento`:

```text
id, monitor_id, inicio_em, fim_em nullable, origem
```

`fim_em = null` significa intervalo vigente. Ela deve ser criada ao cadastrar/ativar Monitor e encerrada ao desativá-lo; desativar/reativar Equipamento deve encerrar/abrir as janelas de seus Monitores. A operação deve ser transacional e impedir duas janelas abertas por Monitor. `origem` distingue eventos migrados de eventos precisos. Não é permitido inferir essa data de `updated_at`.

Para dados anteriores à migration, R02 só poderá criar uma janela **inferida** de `max(monitor.created_at, primeira medicao.executado_em)` até `ultima medicao.executado_em + intervalo_segundos`; fora dela a resposta é `SEM_DADOS`. Não haverá disponibilidade inventada retroativamente. A documentação de resposta deve expor `qualidadeJanela = PRECISA | INFERIDA` quando houver inferência.

## 2. Relatórios V1 e regras comuns

Relatórios V1: Disponibilidade por Equipamento, Disponibilidade por Unidade, Histórico de Incidentes, Histórico de Medições, Latência ICMP e Notificações. Todos se apoiam em tabelas existentes, sem tabela de relatório duplicada.

Cada consulta exige `inicio` e `fim` como `Instant` UTC, inclusivos para filtros de eventos. `inicio > fim`, ausência de um deles, ou período acima do limite retornam `400 INVALID_REQUEST`. A janela temporal é tratada como intervalo semiaberto `[inicio, fim)` para durações, eliminando dupla contagem na fronteira; com `inicio = fim`, a duração é zero e métricas de duração retornam `null`/zero conforme sua regra abaixo.

Filtros hierárquicos devem ser coerentes: `equipamentoId` deve pertencer a `unidadeId`, e `monitorId` ao equipamento/unidade informados; combinação inconsistente retorna `400 INVALID_REQUEST`, não lista vazia ambígua. IDs inexistentes em filtros também retornam `404 RESOURCE_NOT_FOUND`.

Percentuais serão `BigDecimal` numérico, escala 2, `HALF_UP`, no intervalo `0.00..100.00`; `null` significa não calculável. O backend arredonda somente o percentual final; tempos são inteiros em segundos e o frontend apenas os formata.

## 3. Disponibilidade por Equipamento — fórmula oficial

### Escopo de monitor e janela monitorada

Para eliminar ambiguidade de múltiplos monitores, o relatório por Equipamento terá **uma linha por Monitor ICMP**, não uma linha sintética que escolha arbitrariamente um deles. O endpoint continua sob disponibilidade/equipamentos, mas retorna `monitorId`, `monitorNome` e `tipoMonitor`; assim o Equipamento aparece N vezes quando tiver N Monitores. O filtro opcional `monitorId` seleciona uma linha. A agregação de Unidade usa essas linhas de Monitor, nunca uma média simples de Equipamentos. Um futuro “disponibilidade consolidada do equipamento” só poderá existir com regra de criticidade/principal explicitamente modelada; não faz parte da V1.

Para cada Monitor ICMP, `tempoMonitorado` é a duração da **união** das janelas de elegibilidade persistidas que interceptam `[inicio, fim)`, limitada também pela existência de dado observável:

```text
inicioEfetivo = max(inicio, inicioDaJanela, primeiraMedicao.executadoEm dentro da janela)
fimEfetivo    = min(fim, fimDaJanela quando existir)
tempoMonitorado = Σ duração([inicioEfetivo, fimEfetivo))
```

O período anterior à primeira medição **da respectiva janela** não é monitorado. Monitor criado após `inicio` começa em sua criação/janela e primeira medição, nunca no início solicitado. Monitor ou Equipamento desativado encerra sua janela no evento de desativação. Reativação abre outra janela e as durações são somadas. Uma janela sem medição não contribui: é `SEM_DADOS`, não 100%. O conjunto deve ser normalizado para intervalos disjuntos antes de somar.

Sem Monitor ICMP vinculado ao Equipamento: `estadoAnalitico=SEM_MONITORAMENTO`, percentual e tempos `null`, incidentes `0`. Com Monitor mas nenhuma interseção de janela com primeira medição: `estadoAnalitico=SEM_DADOS`, percentual e tempos `null`; a qualidade de janela pode continuar `PRECISA` ou `INFERIDA`.

### Indisponibilidade e disponibilidade

Para cada incidente do Monitor, forme `[iniciadoEm, encerradoEm ?? fim)`, intercepte com cada janela monitorada e então faça a **união por Monitor** antes de medir. Logo, sobreposição nunca é somada duas vezes. Um incidente aberto em `11:00` com fim do relatório `12:00` conta até `12:00`; um de `09:30–10:30` na janela `10:00–12:00` conta 30 min; um de `11:30–13:00` conta 30 min; um de `09:00–13:00` conta 2 h. Só a interseção temporal conta.

```text
tempoIndisponivel = duração( união(incidentes ∩ janelasMonitoradas ∩ [inicio, fim)) )
tempoDisponivel    = tempoMonitorado - tempoIndisponivel
disponibilidadePercentual = round(tempoDisponivel / tempoMonitorado * 100, 2, HALF_UP)
```

`incidentes` é a quantidade de incidentes distintos que intersectam a janela monitorada, e não a quantidade de trechos unidos. Por constraint há no máximo um aberto por Monitor; a união é defesa para fechados sobrepostos. A fórmula usa incidentes — resultado do limiar configurado —, não `SUCESSO / total de medições`.

## 4. Disponibilidade por Unidade

Uma Unidade retorna uma linha agregada de todos os Monitores ICMP elegíveis de seus Equipamentos, inclusive Equipamentos hoje inativos se tinham janela no período. Fórmula oficial:

```text
tempoMonitoradoUnidade = Σ tempoMonitorado dos Monitores com estado CALCULADO
tempoIndisponivelUnidade = Σ tempoIndisponivel desses Monitores
tempoDisponivelUnidade = tempoMonitoradoUnidade - tempoIndisponivelUnidade
disponibilidadePercentual = round(tempoDisponivelUnidade / tempoMonitoradoUnidade * 100, 2, HALF_UP)
```

É média ponderada por tempo monitorado, não média de percentuais. `equipamentosTotal` conta Equipamentos da Unidade; `equipamentosMonitorados` conta Equipamentos com ao menos um Monitor em estado `CALCULADO`; `equipamentosSemMonitoramento` conta os sem Monitor ICMP; `equipamentosSemDados` conta os que têm Monitor, porém nenhum calculável. Um Equipamento com múltiplos Monitores contribui uma vez a essas contagens, mas cada Monitor contribui seu próprio tempo ao denominador. Se não houver denominador, percentual e tempos são `null`, `estadoAnalitico=SEM_DADOS` quando houver monitor e `SEM_MONITORAMENTO` quando não houver nenhum.

## 5. API, filtros, paginação e ordenação

Base: `/api/v1/relatorios`. Todas as leituras usam o envelope existente `PaginaResposta` quando paginadas: `content`, `page`, `size`, `totalElements`, `totalPages`, `first`, `last`; `page` é zero-based, padrão 20 (50 para medições), máximo 100. Sort fora da whitelist retorna `400 INVALID_REQUEST`.

| Endpoint | Filtros suportados | Paginação | Sort permitido |
|---|---|---|---|
| `GET /disponibilidade/equipamentos` | inicio, fim, unidadeId, equipamentoId, monitorId, tipoEquipamentoId | sim | equipamentoNome, unidadeNome, monitorNome, disponibilidadePercentual, tempoIndisponivelSegundos, tempoMonitoradoSegundos, incidentes |
| `GET /disponibilidade/unidades` | inicio, fim, unidadeId | sim | unidadeNome, equipamentosTotal, equipamentosMonitorados, equipamentosSemMonitoramento, tempoIndisponivelSegundos, disponibilidadePercentual, incidentes |
| `GET /incidentes` | inicio, fim, unidadeId, equipamentoId, monitorId, status | sim | iniciadoEm, encerradoEm, duracaoSegundosNoPeriodo, status, unidadeNome, equipamentoNome, monitorNome |
| `GET /medicoes` | inicio, fim, unidadeId, equipamentoId, monitorId, status | sim | executadoEm, status, latenciaMs, unidadeNome, equipamentoNome, monitorNome |
| `GET /latencia` | inicio, fim, unidadeId, equipamentoId, monitorId | sim | unidadeNome, equipamentoNome, monitorNome, minLatenciaMs, avgLatenciaMs, maxLatenciaMs, count |
| `GET /notificacoes` | inicio, fim, incidenteId, status, canal, tipoEvento | sim | createdAt, enviadoEm, status, canal, tipoEvento, tentativas |

O histórico de Incidentes usa **interseção**: `iniciado_em < fim AND coalesce(encerrado_em, fim) >= inicio`; um aberto é considerado até `fim` para o filtro. Histórico de Medições filtra `executado_em >= inicio AND executado_em <= fim`. Notificações reutiliza exatamente a semântica atual: período sobre `created_at`.

Limites: disponibilidade por equipamento/unidade e incidentes, 365 dias; notificações, 365 dias; medições detalhadas, 31 dias; latência, 90 dias. Exportação conserva esses mesmos limites. Para `inicio=fim`, os históricos podem retornar eventos naquele instante, enquanto agregados temporais não calculam percentual por denominador zero.

## 6. DTOs de resposta

Todos incluem `inicio` e `fim` recebidos, em UTC.

```text
DisponibilidadeEquipamentoResponse
  equipamentoId, equipamentoNome, unidadeId, unidadeNome, monitorId, monitorNome, tipoMonitor,
  inicio, fim, estadoAnalitico(CALCULADO|SEM_MONITORAMENTO|SEM_DADOS), qualidadeJanela(PRECISA|INFERIDA|null),
  tempoMonitoradoSegundos nullable, tempoIndisponivelSegundos nullable,
  tempoDisponivelSegundos nullable, disponibilidadePercentual nullable, incidentes

DisponibilidadeUnidadeResponse
  unidadeId, unidadeNome, inicio, fim, estadoAnalitico(CALCULADO|SEM_MONITORAMENTO|SEM_DADOS),
  equipamentosTotal, equipamentosMonitorados, equipamentosSemMonitoramento, equipamentosSemDados,
  tempoMonitoradoSegundos nullable, tempoIndisponivelSegundos nullable,
  tempoDisponivelSegundos nullable, disponibilidadePercentual nullable, incidentes

HistoricoIncidenteResponse
  incidenteId, unidadeId, unidadeNome, equipamentoId, equipamentoNome, monitorId, monitorNome, tipoMonitor,
  status, iniciadoEm, encerradoEm nullable, duracaoSegundosNoPeriodo, motivo, observacao

HistoricoMedicaoResponse
  medicaoId, unidadeId, unidadeNome, equipamentoId, equipamentoNome, monitorId, monitorNome, tipoMonitor,
  status, latenciaMs nullable, mensagem nullable, executadoEm

LatenciaIcmpResponse
  unidadeId, unidadeNome, equipamentoId, equipamentoNome, monitorId, monitorNome,
  inicio, fim, minLatenciaMs nullable, avgLatenciaMs nullable, maxLatenciaMs nullable,
  p95LatenciaMs nullable, count

HistoricoNotificacaoResponse
  notificacaoId, incidenteId, canal, tipoEvento, status, tentativas, enviadoEm nullable,
  createdAt, erro nullable
```

`duracaoSegundosNoPeriodo` do incidente é a interseção com o período (para aberto, termina em `fim`), não sua duração total fora dele. Não retornar entidades JPA.

## 7. Latência ICMP

Somente `medicao.status='SUCESSO' AND latencia_ms IS NOT NULL` dentro do período entra em `min`, `avg`, `max` e `count`. `avgLatenciaMs` é `BigDecimal` com escala 2, `HALF_UP`; min/max/p95 são números inteiros de ms; com `count=0`, todas as métricas são `null`.

`p95LatenciaMs` entra na V1 porque PostgreSQL o calcula eficientemente na projeção com `percentile_cont(0.95) within group (order by latencia_ms)`, por grupo e após filtros, sem materializar registros em Java. O valor final será arredondado para inteiro em ms com `HALF_UP`.

## 8. Exportação CSV

Padrão final: `GET /api/v1/relatorios/{recurso}/export.csv`, para os seis recursos (`disponibilidade/equipamentos`, `disponibilidade/unidades`, `incidentes`, `medicoes`, `latencia`, `notificacoes`) com os mesmos filtros, sem `page`, `size` ou `sort` arbitrário. A ordem do CSV é a ordem padrão documentada de cada relatório, estável com ID como desempate.

Formato CSV RFC 4180, delimitador vírgula, aspas quando necessário, `Content-Type: text/csv; charset=utf-8`, UTF-8 **sem BOM**, timestamps ISO-8601 UTC. O front deve baixar por `HttpClient` com `responseType: 'blob'`, criando URL de objeto temporária; `window.open` não é aceitável porque o JWT está apenas em memória e o bearer não acompanha a navegação. Não há URL pública.

Limite adicional: até 100.000 linhas por exportação, contado após filtros; excedente retorna `400 INVALID_REQUEST` com orientação para restringir filtros. Agregados naturalmente obedecem ao limite; CSV não é escape para os limites temporais ou RBAC.

## 9. RBAC

Relatórios e CSV são dados operacionais de leitura. A decisão V1 é permitir consulta e exportação aos três papéis, pois VISUALIZADOR já possui leitura de medições, incidentes e notificações e o CSV não altera nem amplia o recorte autorizado.

| Ação | ADMIN | OPERADOR | VISUALIZADOR |
|---|---:|---:|---:|
| Consultar relatórios | Sim | Sim | Sim |
| Exportar CSV | Sim | Sim | Sim |

R02 deve incluir explicitamente `/api/v1/relatorios/**` na regra GET de leitura atual e cobrir 401/403. JWT continua obrigatório.

## 10. Banco, consultas e performance

Índices existentes relevantes: `ix_equipamento_unidade (unidade_id)`, `ix_monitor_equipamento (equipamento_id)`, `ix_medicao_monitor_executado_em (monitor_id, executado_em DESC)`, `ix_medicao_executado_em (executado_em DESC)`, `uq_incidente_monitor_aberto`, `ix_incidente_monitor_iniciado_em (monitor_id, iniciado_em DESC)`, `ix_incidente_status_iniciado_em (status, iniciado_em DESC)`, `ix_notificacao_incidente_id`, `ix_notificacao_status_created_at (status, created_at DESC)` e fila de notificação.

Migrations recomendadas somente em R02, após `EXPLAIN (ANALYZE, BUFFERS)` com volume representativo:

```text
janela_monitoramento(monitor_id, inicio_em, fim_em) com unicidade parcial para janela aberta
medicao(monitor_id, status, executado_em) WHERE status = 'SUCESSO' AND latencia_ms IS NOT NULL
incidente(monitor_id, iniciado_em, encerrado_em)
notificacao(created_at DESC) e, se os filtros reais justificarem, (canal, status, created_at DESC)
```

Estratégia por relatório:

| Relatório | Estratégia R02 |
|---|---|
| Disponibilidade equipamento/unidade | native SQL PostgreSQL com CTEs, `greatest/least`, `range_agg` ou normalização por gaps-and-islands; agrega no banco e pagina a projeção final. Não carregar incidentes/medições em `List`. |
| Incidentes | projection/native SQL paginada; filtro temporal por interseção e duração no banco. |
| Medições | Spring Data specification/projection paginada com joins explícitos para nomes; não devolver entidade. |
| Latência | native aggregate PostgreSQL com `min/avg/max/count/percentile_cont`, por Monitor. |
| Notificações | specification/projection paginada, reutilizando semântica de `created_at`. |

Disponibilidade consulta janelas e incidentes, não milhões de medições. Medições servem apenas para qualificar início observado/legado e para o relatório próprio/latência. Antes de criar índices, R02 deve medir planos reais. O crescimento contínuo de `medicao` exige, como evolução posterior, política de retenção, particionamento por `executado_em` e agregados/materialized views; nada disso entra na V1.

## 11. Frontend planejado

Rota única `/relatorios`, lazy-loaded e protegida pelo `businessGuard`; sidebar ganha **Relatórios** na seção Operações, visível para ADMIN, OPERADOR e VISUALIZADOR. A página possui subáreas/tabs: Disponibilidade (equipamentos e unidades), Incidentes, Medições, Latência e Notificações. Não criar tela monolítica: filtros e tabelas são componentes por área, compartilhando seletor de período.

Filtros dependentes reutilizam `GET /unidades?ativo=true`, `GET /equipamentos?unidadeId=…&ativo=true`, `GET /monitores?equipamentoId=…&ativo=true`; ao mudar Unidade limpa Equipamento e Monitor, ao mudar Equipamento limpa Monitor. Para consultar histórico de inativos, o relatório recebe IDs já selecionados; a UX pode oferecer busca/seleção histórica em fase posterior, sem alterar o contrato.

Datas usam `datetime-local → new Date(valor).toISOString() → UTC`, como o padrão existente. Cada subárea prevê loading, empty, error recuperável, success, paginação e sort server-side. Gráficos de valor real: barra de disponibilidade por equipamento, série agregada de incidentes e resumo/série agregada de latência; seus dados deverão vir de endpoints agregados específicos definidos em R03/R04, nunca de centenas de milhares de medições no Angular.

Não há biblioteca de gráficos nas dependências atuais. R03/R04 deve comparar uma biblioteca Angular compatível e tree-shakeable (por exemplo, Chart.js via wrapper oficial ou Apache ECharts), registrar licença/acessibilidade e impacto de bundle antes de adicionar uma dependência. Não instalar agora.

## 12. Testes planejados

**Backend R02/R04:** período inválido e limites; início/fim inclusivos de eventos; incidente dentro/cruzando início/cruzando fim/aberto/cobrindo período; união de sobreposições; incidente aberto único; sem monitor, sem dados e janela inferida; Monitor/Equipamento criado, desativado e reativado; múltiplos Monitores; agregação ponderada de Unidade; métricas/p95 de latência e zero sucessos; paginação, sort inválido e coerência de filtros; DTO sem entidade; RBAC 401/403 para os três papéis; CSV autenticado, escaping, UTF-8 sem BOM, UTC, limites temporais e 100.000 linhas.

**Frontend R03/R04:** serialização UTC de período; filtros e cascata Unidade→Equipamento→Monitor; loading/empty/error/success; paginação/sort; estados `SEM_MONITORAMENTO` e `SEM_DADOS`; RBAC e item de sidebar; CSV Blob com bearer, nome de arquivo e erro; renderização e acessibilidade dos gráficos; nenhum agregado pesado no cliente.

## 13. Roadmap

| Fase | Entrega |
|---|---|
| R02 — Backend de Relatórios | Migration de janela temporal e captura transacional de ciclo de vida, queries/projections, validação, DTOs, endpoints, paginação/sort, RBAC e testes backend. |
| R03 — Frontend de Relatórios | Rota, sidebar, serviços/modelos, tabs, filtros dependentes, tabelas, estados de UX e testes frontend; sem dependência de gráfico nova. |
| R04 — Exportação CSV + Visualizações | CSV autenticado como Blob, limite de linhas e testes; decidir/adicionar biblioteca de gráficos, endpoints agregados necessários e gráficos acessíveis. |
| R05 — Homologação de Relatórios | Massa representativa, validação manual das fórmulas/UTC/CSV/RBAC, `EXPLAIN ANALYZE`, carga e regressão end-to-end. |

## 15. Contrato HTTP R02.4

Os seis `GET` sob `/api/v1/relatorios` exigem JWT de `ADMIN`, `OPERADOR` ou `VISUALIZADOR` e retornam `PaginaResposta<T>`: `content`, `page`, `size`, `totalElements`, `totalPages`, `first`, `last`. `inicio` e `fim` são `Instant` UTC obrigatórios; `inicio > fim` e período acima do limite retornam `400 INVALID_REQUEST`; igualdade é válida. `page` é zero-based, padrão 0; `size` é 20, exceto medições (50), com máximo/clamp 100.

| Endpoint | DTO | Limite | Filtros | Sort whitelist |
|---|---|---:|---|---|
| `/disponibilidade/equipamentos` | `DisponibilidadeEquipamentoResponse` | 365d | unidadeId, equipamentoId, monitorId, tipoEquipamentoId | equipamentoNome, unidadeNome, monitorNome, disponibilidadePercentual, tempoIndisponivelSegundos, tempoMonitoradoSegundos, incidentes |
| `/disponibilidade/unidades` | `DisponibilidadeUnidadeResponse` | 365d | unidadeId | unidadeNome, equipamentosTotal, equipamentosMonitorados, equipamentosSemMonitoramento, tempoIndisponivelSegundos, disponibilidadePercentual, incidentes |
| `/incidentes` | `HistoricoIncidenteResponse` | 365d | unidadeId, equipamentoId, monitorId, status | iniciadoEm, encerradoEm, duracaoSegundosNoPeriodo, status, unidadeNome, equipamentoNome, monitorNome |
| `/medicoes` | `HistoricoMedicaoResponse` | 31d | unidadeId, equipamentoId, monitorId, status | executadoEm, status, latenciaMs, unidadeNome, equipamentoNome, monitorNome |
| `/latencia` | `LatenciaIcmpResponse` | 90d | unidadeId, equipamentoId, monitorId | unidadeNome, equipamentoNome, monitorNome, minLatenciaMs, avgLatenciaMs, maxLatenciaMs, count |
| `/notificacoes` | `HistoricoNotificacaoResponse` | 365d | incidenteId, status, canal, tipoEvento | createdAt, enviadoEm, status, canal, tipoEvento, tentativas |

`sort=campo,asc|desc` usa somente a whitelist; campo ou direção inválida retorna `400 INVALID_REQUEST`. Nulos usam `NULLS LAST`. ID explícito inexistente retorna `404 RESOURCE_NOT_FOUND`, e combinação hierárquica incoerente retorna `400 INVALID_REQUEST`. Exemplo: `GET /api/v1/relatorios/medicoes?inicio=2026-01-01T00:00:00Z&fim=2026-01-02T00:00:00Z&page=0&size=50&sort=executadoEm,desc`.

## 16. R02.5 — validação de performance

A R02.5 validou PostgreSQL 16 com massa isolada de 150.500 medições, 6.000 incidentes e 6.000 notificações. Os índices temporais existentes foram escolhidos pelos planos; não houve índice novo, pois scans sequenciais remanescentes são pequenos/justificados e não ocorreu spill para disco. A disponibilidade preserva CTEs SQL com `range_agg`, paginação/count no banco e a mesma matemática homologada; `percentile_cont` continua no PostgreSQL.

Medições, incidentes, latência e notificações permanecem com filtros, sort, paginação e count server-side, sem N+1 ou listas amplas em Java. Tempos, inventário, planos, benchmark HTTP e riscos de escala estão em `Docs/reports-performance.md`. Antes de volume na casa de milhões, repetir EXPLAIN para reavaliar CTE temporal/count, OFFSET, retenção, particionamento ou agregados; isso não é mudança desta release.

## 14. Riscos e decisões futuras

1. Disponibilidade histórica anterior à captura de janelas de ciclo de vida será explicitamente `INFERIDA` e pode ser `SEM_DADOS`; não há dado atual para reconstituí-la com precisão.
2. Múltiplos monitores não têm conceito de principal ou criticidade. V1 reporta por Monitor; uma consolidação por Equipamento exige regra de produto futura.
3. Retenção, particionamento e agregados históricos só devem ser implantados quando volume e planos de consulta justificarem.
4. Alteração futura de intervalo, limiar ou tipo de Monitor não reescreve o histórico; a disponibilidade continua baseada nas janelas e incidentes persistidos.

# R03.5 — Auditoria analítica do Dashboard de Relatórios

Data da auditoria: 25/08/2026.

## Escopo e regra de decisão

Foram auditados os contratos HTTP, DTOs, `RelatorioApiService`, `RelatorioController`, `RelatorioService`, `DisponibilidadeSqlRepository`, a arquitetura R01/R02 e o relatório de performance R02.5. Os seis endpoints retornam `PaginaResposta<T>` com `totalElements` calculado no banco após os filtros. Nenhuma soma de conteúdo de página é uma métrica global.

A Visão Geral adota um período único de no máximo **31 dias**, informado explicitamente ao usuário. Esse limite comum evita truncamento silencioso e é compatível com todos os endpoints: Disponibilidade/Incidentes/Notificações (365 dias), Latência (90 dias) e Medições (31 dias).

Classificações usadas:

- **IMPLEMENTÁVEL COM CONTRATO ATUAL**: agregado já calculado no backend, `totalElements` do universo filtrado, ou Top N global obtido com sort server-side.
- **NÃO IMPLEMENTÁVEL CORRETAMENTE**: a proposta dependeria de agregar uma página parcial ou de ordenar por campo não suportado.
- **REQUER ENDPOINT/AGREGAÇÃO BACKEND**: visual relevante que precisa de novo resumo/agrupamento no servidor.

## Matriz de decisão

| Visualização | Fonte | Implementável? | Motivo | Endpoint | Filtros | Sort | Risco |
|---|---|---|---|---|---|---|---|
| Ranking Top N de Unidades por disponibilidade | Agregado por Unidade | IMPLEMENTÁVEL COM CONTRATO ATUAL | Cada linha já é ponderada por tempo no backend; Top N global usa ordenação e paginação server-side | `/api/v1/relatorios/disponibilidade/unidades` | `inicio`, `fim` | `disponibilidadePercentual,asc|desc`, `page=0`, `size=N` | Não converter percentual nulo em zero; manter `NULLS LAST` |
| Comparação de todas as Unidades | Página de agregados por Unidade | REQUER ENDPOINT/AGREGAÇÃO BACKEND | O endpoint limita `size` a 100; não há garantia de conter todo o universo | `/api/v1/relatorios/disponibilidade/unidades` | `inicio`, `fim` | — | Uma comparação da página atual só seria válida se explicitamente rotulada como parcial |
| Tempo monitorado por Unidade | Campo agregado da linha de Unidade | IMPLEMENTÁVEL COM CONTRATO ATUAL | Pode ser exibido como detalhe do Top N retornado, sem recomputar | `/api/v1/relatorios/disponibilidade/unidades` | `inicio`, `fim` | Mesmo sort do ranking exibido | Não chamar a página de total global |
| Ranking Top N de Unidades por tempo indisponível | Agregado por Unidade | IMPLEMENTÁVEL COM CONTRATO ATUAL | Campo agregado e sort server-side permitido | `/api/v1/relatorios/disponibilidade/unidades` | `inicio`, `fim` | `tempoIndisponivelSegundos,desc`, `page=0`, `size=N` | Nulos permanecem no fim |
| Ranking Top N de Unidades por incidentes | Agregado por Unidade | IMPLEMENTÁVEL COM CONTRATO ATUAL | Contagem por Unidade calculada no backend e ordenável | `/api/v1/relatorios/disponibilidade/unidades` | `inicio`, `fim` | `incidentes,desc`, `page=0`, `size=N` | Mede incidentes que intersectam janelas monitoradas, não todos os incidentes brutos |
| Equipamentos monitorados por Unidade | Campo agregado da linha de Unidade | IMPLEMENTÁVEL COM CONTRATO ATUAL | Contagem por Unidade já vem do backend e é ordenável | `/api/v1/relatorios/disponibilidade/unidades` | `inicio`, `fim` | `equipamentosMonitorados,desc`, `page=0`, `size=N` | Top N, não soma global |
| Equipamentos sem monitoramento por Unidade | Campo agregado da linha de Unidade | IMPLEMENTÁVEL COM CONTRATO ATUAL | Contagem por Unidade já vem do backend e é ordenável | `/api/v1/relatorios/disponibilidade/unidades` | `inicio`, `fim` | `equipamentosSemMonitoramento,desc`, `page=0`, `size=N` | Top N, não soma global |
| Equipamentos sem dados por Unidade | Campo agregado da linha de Unidade | IMPLEMENTÁVEL COM CONTRATO ATUAL somente como detalhe | Valor de cada Unidade é correto, mas não há sort por `equipamentosSemDados` | `/api/v1/relatorios/disponibilidade/unidades` | `inicio`, `fim` | Sort de outro ranking | Não apresentar como ranking global por sem dados |
| KPI global Equipamentos sem monitoramento | Páginas de Unidade/Equipamento | REQUER ENDPOINT/AGREGAÇÃO BACKEND | Somar `equipamentosSemMonitoramento` de uma página parcial seria incorreto; não há filtro por estado | — | `inicio`, `fim` | — | Métrica global inválida sem novo resumo |
| KPI global Equipamentos sem dados | Páginas de Unidade/Equipamento | REQUER ENDPOINT/AGREGAÇÃO BACKEND | Somar `equipamentosSemDados` de uma página parcial seria incorreto; não há filtro por estado | — | `inicio`, `fim` | — | Métrica global inválida sem novo resumo |
| Top N piores Equipamentos/Monitores | Linha analítica de disponibilidade | IMPLEMENTÁVEL COM CONTRATO ATUAL | Ranking global usa sort server-side, página zero e N; backend aplica `NULLS LAST` | `/api/v1/relatorios/disponibilidade/equipamentos` | `inicio`, `fim` | `disponibilidadePercentual,asc`, `page=0`, `size=N` | Uma linha representa Monitor ICMP; não é consolidação sintética por Equipamento |
| Top N melhores Equipamentos/Monitores | Linha analítica de disponibilidade | IMPLEMENTÁVEL COM CONTRATO ATUAL | Ranking global usa sort server-side | `/api/v1/relatorios/disponibilidade/equipamentos` | `inicio`, `fim` | `disponibilidadePercentual,desc`, `page=0`, `size=N` | Preservar nulos |
| Top N por tempo indisponível | Linha analítica de disponibilidade | IMPLEMENTÁVEL COM CONTRATO ATUAL | Campo e sort server-side suportados | `/api/v1/relatorios/disponibilidade/equipamentos` | `inicio`, `fim` | `tempoIndisponivelSegundos,desc`, `page=0`, `size=N` | Linha por Monitor |
| Top N por incidentes | Linha analítica de disponibilidade | IMPLEMENTÁVEL COM CONTRATO ATUAL | Campo e sort server-side suportados | `/api/v1/relatorios/disponibilidade/equipamentos` | `inicio`, `fim` | `incidentes,desc`, `page=0`, `size=N` | Linha por Monitor |
| Estado analítico e qualidade do Equipamento | Campos da linha retornada | IMPLEMENTÁVEL COM CONTRATO ATUAL como detalhe do ranking | `estadoAnalitico` e `qualidadeJanela` vêm do backend | `/api/v1/relatorios/disponibilidade/equipamentos` | `inicio`, `fim` | Sort do ranking | Não inferir qualidade nem agregar página |
| Últimos Incidentes | Histórico paginado | IMPLEMENTÁVEL COM CONTRATO ATUAL | A ordenação cronológica é server-side | `/api/v1/relatorios/incidentes` | `inicio`, `fim` | `iniciadoEm,desc`, `page=0`, `size=N` | Lista recente, não série agregada |
| KPI Incidentes abertos | `totalElements` filtrado | IMPLEMENTÁVEL COM CONTRATO ATUAL | Count SQL cobre todo o universo do período após `status=ABERTO` | `/api/v1/relatorios/incidentes` | `inicio`, `fim`, `status=ABERTO` | `page=0`, `size=1` | Sem somar conteúdo da página |
| KPI Incidentes fechados | `totalElements` filtrado | IMPLEMENTÁVEL COM CONTRATO ATUAL | Count SQL cobre todo o universo filtrado | `/api/v1/relatorios/incidentes` | `inicio`, `fim`, `status=FECHADO` | `page=0`, `size=1` | Sem somar conteúdo da página |
| Ranking de Incidentes por duração no período | Histórico paginado | IMPLEMENTÁVEL COM CONTRATO ATUAL | Duração intersectada é calculada no backend e ordenável | `/api/v1/relatorios/incidentes` | `inicio`, `fim` | `duracaoSegundosNoPeriodo,desc`, `page=0`, `size=N` | Duração é limitada ao período selecionado |
| Últimas Medições | Histórico paginado | IMPLEMENTÁVEL COM CONTRATO ATUAL | Ordenação cronológica é server-side | `/api/v1/relatorios/medicoes` | `inicio`, `fim` | `executadoEm,desc`, `page=0`, `size=N` | Lista recente, não distribuição global |
| KPI Medições com falha | `totalElements` filtrado | IMPLEMENTÁVEL COM CONTRATO ATUAL | Count SQL cobre todas as medições do período com `status=FALHA` | `/api/v1/relatorios/medicoes` | `inicio`, `fim`, `status=FALHA` | `page=0`, `size=1` | Não derivar taxa com outra página |
| KPI Medições com sucesso | `totalElements` filtrado | IMPLEMENTÁVEL COM CONTRATO ATUAL | Count SQL cobre todas as medições do período com `status=SUCESSO` | `/api/v1/relatorios/medicoes` | `inicio`, `fim`, `status=SUCESSO` | `page=0`, `size=1` | Taxa só seria válida combinando dois counts globais; não será exibida no MVP |
| Taxa global de sucesso/falha | Conteúdo de página | NÃO IMPLEMENTÁVEL CORRETAMENTE a partir de uma página | Uma página parcial não representa o universo | `/api/v1/relatorios/medicoes` | `inicio`, `fim` | — | Só seria válida com counts globais separados ou endpoint agregado |
| Ranking Top N de Latência média | Agregado por Monitor | IMPLEMENTÁVEL COM CONTRATO ATUAL | `avgLatenciaMs` é calculado no PostgreSQL e possui sort server-side | `/api/v1/relatorios/latencia` | `inicio`, `fim` | `avgLatenciaMs,desc`, `page=0`, `size=N` | Monitores sem amostras ficam no fim |
| Ranking Top N de Latência máxima | Agregado por Monitor | IMPLEMENTÁVEL COM CONTRATO ATUAL | `maxLatenciaMs` é calculado no PostgreSQL e possui sort server-side | `/api/v1/relatorios/latencia` | `inicio`, `fim` | `maxLatenciaMs,desc`, `page=0`, `size=N` | Monitores sem amostras ficam no fim |
| Comparação min/avg/max/P95/amostras por Monitor | Agregado por Monitor | IMPLEMENTÁVEL COM CONTRATO ATUAL | Todos os campos vêm do backend, inclusive `p95LatenciaMs` via `percentile_cont` | `/api/v1/relatorios/latencia` | `inicio`, `fim` | Sort do ranking escolhido | P95 nunca é recalculado no Angular |
| Ranking global por P95 | Agregado por Monitor | REQUER ENDPOINT/AGREGAÇÃO BACKEND | `p95LatenciaMs` não pertence à whitelist de sort | `/api/v1/relatorios/latencia` | `inicio`, `fim` | Não suportado | Ordenar apenas a página no Angular produziria ranking falso |
| Últimas Notificações | Histórico paginado | IMPLEMENTÁVEL COM CONTRATO ATUAL | Ordenação cronológica é server-side | `/api/v1/relatorios/notificacoes` | `inicio`, `fim` | `createdAt,desc`, `page=0`, `size=N` | Lista recente, não agregado temporal |
| Count/KPI de Notificações por status | `totalElements` filtrado | IMPLEMENTÁVEL COM CONTRATO ATUAL | Cada request com status conta todo o conjunto filtrado no banco | `/api/v1/relatorios/notificacoes` | `inicio`, `fim`, `status` | `page=0`, `size=1` | Uma chamada por status; evitar explosão |
| Count de Notificações por canal | `totalElements` filtrado | IMPLEMENTÁVEL COM CONTRATO ATUAL | Cada request com canal conta todo o universo filtrado | `/api/v1/relatorios/notificacoes` | `inicio`, `fim`, `canal` | `page=0`, `size=1` | Uma chamada por canal; custo cresce com enum |
| Count de Notificações por tipoEvento | `totalElements` filtrado | IMPLEMENTÁVEL COM CONTRATO ATUAL | Cada request com tipo conta todo o universo filtrado | `/api/v1/relatorios/notificacoes` | `inicio`, `fim`, `tipoEvento` | `page=0`, `size=1` | Uma chamada por tipo; preferível endpoint agrupado se os tipos crescerem |

## Visualizações aprovadas para a Visão Geral

Para manter seis requests independentes, sem duplicações e sem biblioteca adicional, ficam aprovados:

1. KPI **Incidentes abertos**, por `totalElements` de `status=ABERTO`.
2. KPI **Medições com falha**, por `totalElements` de `status=FALHA`.
3. KPI **Notificações com falha**, por `totalElements` de `status=FALHA`.
4. Ranking **Disponibilidade por Unidade**, Top 5 por `disponibilidadePercentual,asc`.
5. **Top Equipamentos críticos**, Top 5 por `disponibilidadePercentual,asc`.
6. **Latência por Monitor**, Top 5 por `avgLatenciaMs,desc`, exibindo min/média/máxima/P95/amostras retornados pela API.

As barras simples serão HTML/CSS acessível com tabela textual equivalente. `null` será apresentado como “Sem dados”, nunca como zero. Cada request alimenta um widget independente com loading, vazio, erro e retry próprios. Uma troca de período dispara exatamente as mesmas seis consultas necessárias uma vez cada.

## KPIs aprovados

| Nome | Fonte | Endpoint e filtro | Campo usado | Por que é globalmente correto |
|---|---|---|---|---|
| Incidentes abertos | Count SQL do histórico filtrado | `/incidentes?status=ABERTO&page=0&size=1` + período | `totalElements` | O count envolve a consulta completa após filtros, não apenas `content` |
| Medições com falha | Count SQL do histórico filtrado | `/medicoes?status=FALHA&page=0&size=1` + período | `totalElements` | O count envolve todas as medições filtradas do período |
| Notificações com falha | Count SQL do histórico filtrado | `/notificacoes?status=FALHA&page=0&size=1` + período | `totalElements` | O count envolve todas as notificações filtradas do período |

## Lacunas de backend

- **Resumo global de disponibilidade:** propor `GET /api/v1/relatorios/disponibilidade/resumo?inicio&fim`, retornando contagens globais por `estadoAnalitico` e tempos/percentual agregados com a mesma fórmula temporal. Isso viabiliza os KPIs globais de sem monitoramento/sem dados sem somar páginas.
- **Ranking por P95:** adicionar `p95LatenciaMs` à whitelist e à ordenação SQL de `/latencia`, caso o produto realmente necessite desse ranking.
- **Distribuições de notificações:** se todos os status/canais/tipos precisarem aparecer juntos, propor `GET /api/v1/relatorios/notificacoes/resumo?inicio&fim`, com agrupamentos server-side, evitando uma chamada por valor do enum.

Essas lacunas não são essenciais para o MVP aprovado acima e não serão implementadas na R03.5.

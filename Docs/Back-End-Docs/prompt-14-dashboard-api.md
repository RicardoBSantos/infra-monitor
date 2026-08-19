# Prompt 14 — Dashboard API e Leitura Operacional

## 1. Contexto

Com base no contexto permanente definido em:

`codexcontex.md`

e considerando o estado atual do repositório após a implementação e consolidação de:

```text
Unidade
TipoEquipamento
Equipamento
Monitor
Medição
Incidente
Monitoring Engine ICMP
Incident Engine
Notificação
Telegram Dispatcher
```

implemente agora uma camada de leitura operacional voltada ao Dashboard do Infra Monitor.

O objetivo desta etapa é fornecer ao frontend Angular dados já agregados e coerentes com as regras do domínio.

NÃO implemente frontend nesta etapa.

NÃO implemente novas entidades operacionais sem necessidade.

NÃO replique regras de negócio no Angular.

---

# 2. Objetivo principal

Criar endpoints de leitura que permitam ao Dashboard responder perguntas como:

```text
Quantas unidades existem?

Quantos equipamentos estão cadastrados?

Quantos equipamentos estão ativos?

Quantos monitores estão ativos?

Quantos incidentes estão abertos?

Quantos equipamentos estão indisponíveis?

Quantos estão disponíveis?

Quantos estão sem dados?

Qual o estado operacional de cada unidade?

Qual o estado dos equipamentos de uma unidade?

Quais incidentes estão abertos agora?
```

O backend deve fornecer dados adequados para cards, listas, tabelas e indicadores do Dashboard.

---

# 3. Princípio arquitetural

O Dashboard é uma camada de leitura.

Não transforme entidades de inventário em armazenamento de estado operacional duplicado.

Não adicione automaticamente em Equipamento:

```text
online
offline
statusAtual
latenciaAtual
ultimoPing
```

Não adicione automaticamente em Monitor:

```text
statusAtual
online
offline
ultimaLatencia
```

O estado operacional deve ser derivado das informações já existentes:

```text
Monitor
+
última Medição
+
Incidente aberto
+
ativo/inativo
```

---

# 4. Separação

Preserve:

```text
Inventário
    ↓
Unidade
Equipamento

Configuração
    ↓
Monitor

Resultado operacional
    ↓
Medição

Estado consolidado
    ↓
Incidente

Leitura operacional
    ↓
Dashboard
```

Dashboard não deve alterar estado do domínio.

Endpoints desta etapa devem ser essencialmente:

```text
GET
```

---

# 5. Status operacional de Monitor

Defina um enum ou modelo de leitura específico para representar o estado atual de um Monitor.

Sugestão conceitual:

```java
public enum StatusOperacionalMonitor {
    DESABILITADO,
    SEM_DADOS,
    DISPONIVEL,
    INDISPONIVEL
}
```

Pode adaptar nomes conforme padrão do projeto.

Não persista esse enum na tabela Monitor.

Ele deve ser derivado.

---

# 6. Regra DESABILITADO

Se:

```text
Monitor.ativo = false
```

status operacional:

```text
DESABILITADO
```

Independentemente da última Medição histórica.

---

# 7. Regra SEM_DADOS

Se Monitor está ativo, mas ainda não possui Medição:

```text
SEM_DADOS
```

Não considere automaticamente indisponível.

---

# 8. Regra INDISPONIVEL

Se Monitor está ativo e possui Incidente ABERTO:

```text
INDISPONIVEL
```

O Incidente aberto representa o estado consolidado de indisponibilidade.

Essa informação deve ter precedência sobre uma simples Medição individual.

---

# 9. Regra DISPONIVEL

Se Monitor está ativo:

* possui histórico suficiente;
* não possui Incidente ABERTO;
* situação atual é considerada normal pelo Incident Engine;

retorne:

```text
DISPONIVEL
```

Não reimplemente threshold no Dashboard.

O Dashboard deve confiar no estado consolidado do Incidente.

---

# 10. Última Medição

Para cada Monitor, quando necessário, disponibilize resumo da última Medição:

```text
status
latenciaMs
executadoEm
```

Não retorne histórico completo no endpoint de Dashboard.

---

# 11. Status operacional de Equipamento

Crie modelo derivado para Equipamento.

Sugestão:

```java
public enum StatusOperacionalEquipamento {
    DESABILITADO,
    SEM_MONITORAMENTO,
    SEM_DADOS,
    DISPONIVEL,
    INDISPONIVEL
}
```

Não persistir na tabela Equipamento.

---

# 12. Equipamento DESABILITADO

Se:

```text
Equipamento.ativo = false
```

retorne:

```text
DESABILITADO
```

Essa condição administrativa possui precedência.

---

# 13. SEM_MONITORAMENTO

Se Equipamento está ativo e não possui Monitor ativo:

```text
SEM_MONITORAMENTO
```

Monitores inativos não contam como monitoramento operacional ativo.

---

# 14. INDISPONIVEL

Se Equipamento está ativo e pelo menos um Monitor ativo possui:

```text
Incidente ABERTO
```

o Equipamento deve ser considerado:

```text
INDISPONIVEL
```

Nesta primeira versão, qualquer Monitor ativo indisponível torna o Equipamento indisponível.

Não introduza pesos ou criticidade por Monitor ainda.

---

# 15. SEM_DADOS

Se Equipamento possui Monitor ativo, mas nenhum deles ainda possui informação operacional suficiente:

```text
SEM_DADOS
```

Exemplo:

```text
Monitor ativo
sem Medições
sem Incidente
```

---

# 16. DISPONIVEL

Se Equipamento:

```text
ativo = true
```

possui Monitor ativo,

nenhum Monitor ativo possui Incidente aberto,

e existe informação operacional válida,

retorne:

```text
DISPONIVEL
```

---

# 17. Caso misto SEM_DADOS + DISPONIVEL

Defina regra determinística.

Sugestão:

```text
se pelo menos um Monitor ativo está INDISPONIVEL
    -> INDISPONIVEL

senão se todos os Monitores ativos estão SEM_DADOS
    -> SEM_DADOS

senão se existe ao menos um Monitor DISPONIVEL
    -> DISPONIVEL
```

Documente claramente.

Não deixe o frontend decidir isso.

---

# 18. Status operacional de Unidade

Crie modelo derivado semelhante.

Sugestão:

```java
public enum StatusOperacionalUnidade {
    SEM_EQUIPAMENTOS,
    SEM_DADOS,
    DISPONIVEL,
    DEGRADADA,
    INDISPONIVEL
}
```

Não persista na tabela Unidade.

---

# 19. Regra de Unidade

Nesta primeira versão, utilize uma regra simples e determinística.

Exemplo:

```text
sem Equipamentos ativos
    -> SEM_EQUIPAMENTOS

todos sem dados
    -> SEM_DADOS

nenhum Equipamento indisponível
    -> DISPONIVEL

alguns indisponíveis
    -> DEGRADADA
```

Para `INDISPONIVEL`, não invente regra arbitrária.

Só utilize se houver critério claro, como todos os Equipamentos monitorados indisponíveis.

Uma sugestão:

```text
todos os Equipamentos monitorados relevantes INDISPONIVEIS
    -> INDISPONIVEL
```

Documente a regra exata.

---

# 20. Equipamentos inativos na Unidade

Equipamentos inativos não devem afetar disponibilidade operacional da Unidade.

Eles podem ser contabilizados separadamente como inventário, mas não devem causar:

```text
DEGRADADA
```

ou:

```text
INDISPONIVEL
```

---

# 21. Monitores inativos

Mesma regra.

Monitores inativos não entram no cálculo operacional.

---

# 22. Endpoint de resumo geral

Implemente:

```text
GET /api/v1/dashboard/resumo
```

Esse endpoint deve retornar visão global do sistema.

Resposta conceitual:

```json
{
  "unidades": {
    "total": 10
  },
  "equipamentos": {
    "total": 250,
    "ativos": 240,
    "disponiveis": 220,
    "indisponiveis": 8,
    "semDados": 7,
    "semMonitoramento": 5
  },
  "monitores": {
    "total": 300,
    "ativos": 280,
    "disponiveis": 260,
    "indisponiveis": 10,
    "semDados": 10
  },
  "incidentes": {
    "abertos": 10
  }
}
```

Adapte nomes ao padrão JSON atual.

---

# 23. Evitar contagens inconsistentes

Garanta que as contagens sejam semanticamente coerentes.

Exemplo:

```text
equipamentosDisponiveis
+
equipamentosIndisponiveis
+
equipamentosSemDados
+
equipamentosSemMonitoramento
```

deve representar apenas o universo operacional correspondente.

Documente se Equipamentos inativos ficam fora dessas categorias.

---

# 24. Endpoint de Unidades

Implemente:

```text
GET /api/v1/dashboard/unidades
```

Retorne visão resumida das Unidades.

Exemplo conceitual:

```json
[
  {
    "id": 1,
    "nome": "Matriz",
    "status": "DISPONIVEL",
    "equipamentosTotal": 30,
    "equipamentosAtivos": 28,
    "equipamentosDisponiveis": 26,
    "equipamentosIndisponiveis": 1,
    "equipamentosSemDados": 1,
    "incidentesAbertos": 1
  }
]
```

---

# 25. Unidade inativa

Se Unidade possui campo ativo e puder estar inativa, observe regra atual do domínio.

Não inclua Unidade inativa no operacional por default se isso for coerente com o sistema.

Se incluir, exponha seu estado administrativo claramente.

Não invente comportamento sem olhar o modelo real.

---

# 26. Endpoint de detalhe de Unidade

Implemente:

```text
GET /api/v1/dashboard/unidades/{id}
```

Retorne visão operacional da Unidade.

Exemplo:

```json
{
  "id": 1,
  "nome": "Matriz",
  "status": "DEGRADADA",
  "equipamentos": {
    "total": 30,
    "ativos": 28,
    "disponiveis": 26,
    "indisponiveis": 1,
    "semDados": 1
  },
  "monitores": {
    "ativos": 35,
    "indisponiveis": 1
  },
  "incidentesAbertos": 1
}
```

Não retornar histórico completo.

---

# 27. Unidade inexistente

```text
GET /api/v1/dashboard/unidades/{id}
```

para ID inexistente:

```text
404 Not Found
```

---

# 28. Endpoint de Equipamentos da Unidade

Implemente:

```text
GET /api/v1/dashboard/unidades/{id}/equipamentos
```

Como pode haver muitos equipamentos, use paginação.

---

# 29. Resposta operacional do Equipamento

Exemplo conceitual:

```json
{
  "id": 10,
  "nome": "SW-CORE-01",
  "ip": "10.0.0.1",
  "localizacao": "CPD - Rack 01",
  "ativo": true,
  "status": "INDISPONIVEL",
  "tipoEquipamento": {
    "id": 2,
    "nome": "Switch"
  },
  "monitoresAtivos": 1,
  "incidentesAbertos": 1,
  "ultimaMedicao": {
    "status": "FALHA",
    "latenciaMs": null,
    "executadoEm": "..."
  }
}
```

Não exponha entidades.

---

# 30. Monitor principal / última Medição

Não assuma que Equipamento sempre possui apenas um Monitor.

Se houver vários, não escolha um arbitrariamente como "principal".

Pode:

```text
retornar última Medição mais recente entre os Monitores ativos
```

se isso for útil.

Documente a semântica.

Ou omita `ultimaMedicao` do nível Equipamento se isso ficar ambíguo.

Prefira clareza a conveniência.

---

# 31. Endpoint de detalhe operacional do Equipamento

Implemente, se coerente:

```text
GET /api/v1/dashboard/equipamentos/{id}
```

Retorne:

```text
dados resumidos do Equipamento
Unidade
Tipo
status operacional
Monitores
Incidentes abertos
```

---

# 32. Monitores no detalhe do Equipamento

Pode retornar lista resumida:

```json
{
  "id": 5,
  "nome": "ICMP principal",
  "tipo": "ICMP",
  "ativo": true,
  "status": "DISPONIVEL",
  "ultimaMedicao": {
    "status": "SUCESSO",
    "latenciaMs": 4,
    "executadoEm": "..."
  },
  "incidenteAberto": null
}
```

Ou, em caso de falha:

```json
{
  "id": 5,
  "status": "INDISPONIVEL",
  "incidenteAberto": {
    "id": 50,
    "iniciadoEm": "..."
  }
}
```

---

# 33. Não retornar histórico de Medições

Detalhe operacional pode retornar:

```text
última Medição
```

Não:

```text
todas as Medições
```

Histórico continua no endpoint próprio.

---

# 34. Não retornar histórico de Incidentes

Da mesma forma, retorne no máximo:

```text
Incidente aberto atual
```

ou quantidade.

Histórico permanece na API de Incidentes.

---

# 35. Endpoint de Incidentes abertos

Implemente:

```text
GET /api/v1/dashboard/incidentes-abertos
```

ou reutilize endpoint existente:

```text
GET /api/v1/incidentes?status=ABERTO
```

Antes de criar endpoint novo, analise se o endpoint existente já satisfaz o frontend adequadamente.

NÃO duplique API sem necessidade.

Se o endpoint existente já retorna dados suficientes e performáticos, reutilize e documente.

---

# 36. Regra contra endpoints redundantes

Antes de criar qualquer endpoint Dashboard, pergunte:

```text
o frontend conseguiria obter esse dado com uma única chamada existente,
sem reconstruir regra de negócio e sem consultas excessivas?
```

Se sim, prefira reutilizar.

Dashboard endpoints devem existir para:

```text
agregação
estado derivado
redução de round-trips
```

e não apenas duplicação de CRUD.

---

# 37. Camada de serviço Dashboard

Crie serviço específico de leitura.

Exemplo:

```text
DashboardService
```

ou equivalente.

Não coloque agregações no Controller.

Controller deve permanecer fino.

---

# 38. Read models

Crie DTOs específicos para Dashboard.

Exemplos conceituais:

```text
DashboardResumoResponse
DashboardUnidadeResponse
DashboardUnidadeDetalheResponse
DashboardEquipamentoResponse
DashboardEquipamentoDetalheResponse
DashboardMonitorResponse
```

Não reutilize DTOs CRUD apenas para evitar criar read models apropriados.

Dashboard possui necessidades diferentes.

---

# 39. Não criar Entity Dashboard

NÃO crie:

```text
DashboardEntity
DashboardTable
DashboardRepository genérico
```

Dashboard é projeção de leitura.

Não deve existir tabela Dashboard nesta etapa.

---

# 40. Repository / queries especializadas

É aceitável criar consultas especializadas para Dashboard.

Exemplo:

```text
projections
JPQL
native query
```

se trouxer eficiência clara.

Não force todo cálculo em Java carregando milhares de entidades.

---

# 41. Evitar N+1

Esta feature possui alto risco de N+1.

Evite fluxos como:

```text
buscar 100 Equipamentos

para cada Equipamento:
    buscar Monitores

para cada Monitor:
    buscar última Medição

para cada Monitor:
    buscar Incidente aberto
```

Isso é inaceitável.

---

# 42. Estratégia de consulta

Prefira consultas em lote/projections.

Exemplo de estratégia aceitável:

```text
1. buscar página de Equipamentos
2. buscar Monitores necessários em lote
3. buscar últimas Medições dos Monitores em lote
4. buscar Incidentes abertos em lote
5. montar read model em memória
```

ou consultas SQL/projections capazes de resolver eficientemente.

Escolha conforme estado atual do projeto.

---

# 43. Última Medição por Monitor

A consulta:

```text
última Medição de cada Monitor
```

é crítica.

Não faça uma query por Monitor.

Use estratégia em lote.

No PostgreSQL pode ser utilizada solução apropriada como:

```text
DISTINCT ON
window function
subquery
```

se consulta nativa for a alternativa mais simples e performática.

Documente a decisão.

---

# 44. Incidentes abertos em lote

Da mesma forma, não consultar um a um.

Como existe no máximo um Incidente ABERTO por Monitor, faça consulta em lote por IDs de Monitores.

---

# 45. Contagens globais

Não carregue todas as entidades para executar:

```java
list.size()
```

Use:

```text
COUNT
GROUP BY
```

no banco quando apropriado.

---

# 46. Contagens por Unidade

Para:

```text
equipamentos por status por Unidade
```

não faça necessariamente uma consulta por Unidade.

Prefira agregações eficientes.

---

# 47. Performance inicial

Ainda não crie:

```text
Redis
cache distribuído
materialized view
tabela de status
```

O objetivo é primeiro obter queries corretas.

O volume inicial pode ser atendido pelo PostgreSQL.

---

# 48. Cache

NÃO adicione cache nesta etapa.

O Dashboard deve refletir estado atual com baixa latência.

Cache pode ser avaliado depois se necessário.

---

# 49. Status derivado em código

É aceitável centralizar regra de status em um componente puro.

Exemplo:

```text
OperationalStatusResolver
```

Responsabilidades:

```text
resolveMonitorStatus(...)
resolveEquipmentStatus(...)
resolveUnitStatus(...)
```

Isso evita regras duplicadas entre endpoints.

---

# 50. Resolver deve ser puro

O resolver não deve consultar banco.

Recebe dados já carregados e determina status.

Isso facilita testes.

---

# 51. Precedência de status do Monitor

Formalize:

```text
if !monitor.ativo
    DESABILITADO

else if incidenteAberto
    INDISPONIVEL

else if ultimaMedicao == null
    SEM_DADOS

else
    DISPONIVEL
```

Não use a última Medição FALHA isoladamente para marcar indisponível se o Incident Engine ainda não abriu Incidente.

Isso é importante.

---

# 52. Falha abaixo do threshold

Exemplo:

```text
threshold = 3

última Medição = FALHA
apenas 1 falha
sem Incidente ABERTO
```

Dashboard ainda NÃO deve marcar Monitor como:

```text
INDISPONIVEL
```

porque o Incident Engine ainda não consolidou indisponibilidade.

Pode continuar:

```text
DISPONIVEL
```

ou considerar um estado futuro `ATENCAO`.

Nesta primeira versão NÃO crie `ATENCAO` sem requisito.

Use estado consolidado do Incidente.

---

# 53. Status de Equipamento

Formalize precedência:

```text
if !equipamento.ativo
    DESABILITADO

activeMonitors = monitores ativos

if activeMonitors vazio
    SEM_MONITORAMENTO

if algum activeMonitor == INDISPONIVEL
    INDISPONIVEL

if todos activeMonitor == SEM_DADOS
    SEM_DADOS

else
    DISPONIVEL
```

---

# 54. Status de Unidade

Formalize também em código/teste.

Sugestão:

```text
activeEquipments = equipamentos ativos

if vazio
    SEM_EQUIPAMENTOS

monitorados = equipamentos que não estão SEM_MONITORAMENTO

if monitorados vazio
    SEM_DADOS

if todos monitorados == INDISPONIVEL
    INDISPONIVEL

if algum monitorado == INDISPONIVEL
    DEGRADADA

if todos monitorados == SEM_DADOS
    SEM_DADOS

else
    DISPONIVEL
```

Avalie cuidadosamente equipamentos `SEM_MONITORAMENTO`.

Documente a regra definitiva.

---

# 55. SEM_MONITORAMENTO na Unidade

Equipamentos sem monitoramento podem ser contabilizados, mas não devem necessariamente degradar a Unidade.

O status operacional refere-se àquilo que é monitorado.

Exponha contagem separada.

---

# 56. Endpoint geral

Implemente primeiro:

```text
GET /api/v1/dashboard/resumo
```

Essa chamada deve ser suficiente para cards globais.

---

# 57. Endpoint Unidades

Implemente:

```text
GET /api/v1/dashboard/unidades
```

Quantidade de Unidades normalmente é pequena.

Paginação não é obrigatória se o domínio continuar pequeno.

Se o projeto já padroniza paginação para tudo, avalie consistência.

---

# 58. Ordenação de Unidades

Preferencialmente:

```text
nome ASC
```

ou padrão atual.

---

# 59. Equipamentos de Unidade

```text
GET /api/v1/dashboard/unidades/{id}/equipamentos
```

deve ser paginado.

Suporte pelo menos:

```text
status
tipoEquipamentoId
ativo
```

se isso for simples e útil.

Não replique toda API de Equipamento sem necessidade.

---

# 60. Filtro por status operacional

Pode suportar:

```text
?status=INDISPONIVEL
```

Isso é útil para dashboard.

Como status é derivado, filtre com cuidado.

Não carregue base inteira apenas para depois paginar em memória.

Se o filtro derivado tornar paginação correta excessivamente complexa, documente e limite o primeiro escopo.

Prefira paginação correta.

---

# 61. Incidentes abertos por Unidade

No DTO de Unidade, retorne:

```text
incidentesAbertos
```

como contagem.

Não liste todos dentro da Unidade summary.

---

# 62. Última atualização

Pode ser útil retornar:

```text
atualizadoEm
```

no resumo global, representando o instante de geração da resposta.

Use:

```text
Instant.now(clock)
```

Não persista.

---

# 63. Latência no resumo

Não adicione médias de latência no resumo global nesta etapa.

Isso pode exigir agregações temporais específicas e pertence a relatórios/analytics.

---

# 64. Uptime

NÃO implemente:

```text
uptime %
SLA
disponibilidade 24h
disponibilidade 7d
```

neste Prompt.

Dashboard inicial é estado atual.

Relatórios históricos virão depois.

---

# 65. Série temporal

Não implemente gráficos de latência ou disponibilidade temporal aqui.

Frontend pode usar API de Medições para gráficos individuais inicialmente.

Endpoints otimizados de séries temporais podem vir depois.

---

# 66. Segurança

Não introduza autenticação nesta tarefa.

Mas não retorne informações sensíveis desnecessárias.

Dashboard não deve incluir:

```text
Telegram token
DB credentials
stack traces
```

obviamente.

---

# 67. CORS

NÃO configure CORS nesta etapa salvo se já fizer parte do escopo consolidado.

A integração Angular será Prompt 15.

---

# 68. OpenAPI

Se OpenAPI já estiver presente, documente os endpoints conforme padrão existente.

Não adicione dependência nova só por esta tarefa.

---

# 69. Testes do resolver de Monitor

Cubra:

```text
Monitor inativo -> DESABILITADO

Monitor ativo sem Medição -> SEM_DADOS

Monitor ativo + Incidente aberto -> INDISPONIVEL

Monitor ativo + Medição + sem Incidente -> DISPONIVEL

última Medição FALHA abaixo do threshold + sem Incidente -> não INDISPONIVEL
```

Esse último teste é importante.

---

# 70. Testes de Equipamento

Cubra:

```text
Equipamento inativo -> DESABILITADO

sem Monitor ativo -> SEM_MONITORAMENTO

todos sem dados -> SEM_DADOS

um Monitor indisponível -> INDISPONIVEL

monitores disponíveis -> DISPONIVEL

mistura disponível + sem dados -> regra documentada
```

---

# 71. Testes de Unidade

Cubra:

```text
sem Equipamentos ativos -> SEM_EQUIPAMENTOS

todos sem dados -> SEM_DADOS

todos disponíveis -> DISPONIVEL

algum indisponível -> DEGRADADA

todos monitorados indisponíveis -> INDISPONIVEL
```

---

# 72. Testes do resumo

Crie cenário integrado com:

```text
2 Unidades
vários Equipamentos
Monitores
Medições
Incidentes
```

e valide contagens.

---

# 73. Testes de N+1

Se infraestrutura permitir, valide query count ou inspecione consultas para endpoints principais.

Principalmente:

```text
/dashboard/unidades/{id}/equipamentos
```

Não é suficiente apenas “funcionar”.

---

# 74. Teste de paginação

Garanta:

```text
page
size
sort
```

quando aplicável.

Não pagine depois de carregar tudo em memória.

---

# 75. Teste de Unidade inexistente

```text
GET /api/v1/dashboard/unidades/99999
```

deve retornar:

```text
404
```

---

# 76. Teste de Equipamento inexistente

Se endpoint detalhe for implementado:

```text
GET /api/v1/dashboard/equipamentos/{id}
```

inexistente:

```text
404
```

---

# 77. Controllers

Crie:

```text
DashboardController
```

ou equivalente.

Mantenha fino.

Não coloque SQL ou regras de status no controller.

---

# 78. Service

Crie:

```text
DashboardService
```

responsável pela orquestração das consultas e read models.

---

# 79. Query service

Se DashboardService ficar muito grande, pode separar consultas em componente específico.

Exemplo:

```text
DashboardQueryService
```

Mas não crie camadas extras sem necessidade.

---

# 80. Repositories existentes

Prefira reutilizar repositories existentes quando consultas forem do mesmo domínio.

É aceitável adicionar métodos específicos de leitura.

Se isso poluir excessivamente repositories CRUD, pode criar repository/query component dedicado para Dashboard.

Documente a decisão.

---

# 81. Native SQL

Native SQL é aceitável para agregações complexas de Dashboard se:

```text
for mais clara
mais eficiente
testada
PostgreSQL já for uma decisão explícita do projeto
```

Não evite SQL a qualquer custo.

Porém não transforme todo Dashboard em SQL opaco de centenas de linhas.

---

# 82. Projection

Considere Spring projections/records para resultados agregados.

Não crie Entity só para receber resultado.

---

# 83. Clock

Se retornar:

```text
geradoEm
```

utilize `Clock` existente quando disponível.

Isso melhora testes.

---

# 84. Read-only transaction

Consultas de Dashboard podem utilizar:

```java
@Transactional(readOnly = true)
```

quando apropriado.

Não é obrigatório se arquitetura atual já gerencia isso de outra forma.

---

# 85. Nenhuma alteração de estado

Nenhum endpoint Dashboard deve executar:

```text
save
update
delete
```

no domínio.

---

# 86. Monitoring Engine independente

Não faça Dashboard consultar estado interno em memória do scheduler.

Estado deve vir do domínio persistido:

```text
Monitor
Medição
Incidente
```

Isso mantém API consistente após restart.

---

# 87. Telegram independente

Status do Telegram não deve afetar disponibilidade de Unidade/Equipamento.

Uma notificação FALHA não significa Equipamento indisponível além do Incidente já existente.

---

# 88. Notificação no Dashboard

Não inclua dados de Notificação no resumo operacional nesta primeira versão, salvo quantidade de falhas de envio se já houver requisito.

Preferência:

não incluir.

Notificação possui tela administrativa própria futuramente.

---

# 89. Migration

A expectativa desta etapa é:

```text
nenhuma migration
```

porque Dashboard é leitura derivada.

Se surgir necessidade de migration apenas para facilitar Dashboard, avalie criticamente.

Índice novo pode ser justificável se query real demonstrar necessidade.

Documente.

---

# 90. Índices

Antes de adicionar índice, revise os já existentes.

Possíveis consultas críticas:

```text
medicao.monitor_id + executado_em
incidente.monitor_id + status
equipamento.unidade_id
monitor.equipamento_id
```

Provavelmente já devem existir.

Não duplique.

---

# 91. API Response

Não devolva `Page` do Spring diretamente se o projeto já possui envelope próprio.

Preserve contrato consolidado.

Se atualmente o projeto expõe Page diretamente, mantenha consistência nesta etapa.

---

# 92. Nulls

Defina comportamento consistente.

Exemplo:

```text
ultimaMedicao = null
```

quando não há dado.

Não crie objetos vazios artificiais.

---

# 93. Enums no JSON

Utilize strings:

```text
DISPONIVEL
INDISPONIVEL
SEM_DADOS
```

Não ordinal.

---

# 94. README

Atualize documentação com os endpoints do Dashboard.

Inclua regras resumidas de status operacional.

Isso é importante para o Angular consumir corretamente.

---

# 95. Documentação da regra de status

Adicione uma seção curta semelhante a:

```text
Monitor:
- DESABILITADO
- SEM_DADOS
- DISPONIVEL
- INDISPONIVEL

Equipamento:
- DESABILITADO
- SEM_MONITORAMENTO
- SEM_DADOS
- DISPONIVEL
- INDISPONIVEL

Unidade:
- SEM_EQUIPAMENTOS
- SEM_DADOS
- DISPONIVEL
- DEGRADADA
- INDISPONIVEL
```

Explique precedência.

---

# 96. Não quebrar APIs existentes

CRUDs e endpoints históricos devem continuar funcionando.

Execute toda suíte, não apenas Dashboard tests.

---

# 97. Inspeção inicial

Antes de modificar:

```bash
pwd
git status
```

Analise principalmente:

```text
Equipamento
Monitor
Medição
Incidente
repositories
queries
EntityGraphs
DTOs
paginação
testes end-to-end
migrations
```

---

# 98. Sequência sugerida

```text
1. analisar APIs atuais
2. identificar dados realmente necessários ao Dashboard
3. definir enums/read models operacionais
4. implementar OperationalStatusResolver
5. implementar queries em lote/agregadas
6. implementar DashboardService
7. implementar DashboardController
8. implementar resumo global
9. implementar resumo por Unidade
10. implementar detalhe da Unidade
11. implementar lista operacional de Equipamentos
12. implementar detalhe de Equipamento, se justificado
13. testes unitários do status resolver
14. testes de queries
15. testes de controller
16. testes de performance/N+1
17. suíte completa
18. verify
19. revisar git diff
```

---

# 99. Testes e build

Se houver Maven Wrapper:

```bash
./mvnw test
./mvnw verify
```

Caso contrário:

```bash
mvn test
mvn verify
```

Corrija falhas relacionadas à implementação.

---

# 100. Git

Ao final:

```bash
git status
git diff
```

Não execute:

```text
git commit
git push
git reset --hard
git clean -fd
git checkout .
```

---

# 101. Revisão final

Revise explicitamente:

```text
nenhum status operacional persistido
nenhuma Entity Dashboard
nenhuma regra duplicada no Controller
nenhum N+1 evidente
nenhuma paginação em memória
contagens via banco quando apropriado
últimas Medições buscadas em lote
Incidentes abertos buscados em lote
nenhum cache prematuro
nenhum endpoint CRUD duplicado
```

---

# 102. Critérios de aceite

A etapa estará concluída quando:

* existir endpoint global de resumo;
* existir visão operacional por Unidade;
* existir detalhe operacional de Unidade;
* existir listagem paginada de Equipamentos da Unidade;
* Monitor possuir status operacional derivado;
* Equipamento possuir status operacional derivado;
* Unidade possuir status operacional derivado;
* status não for persistido;
* Incident Engine continuar sendo fonte de verdade para indisponibilidade;
* falha abaixo do threshold não marcar Monitor como indisponível;
* última Medição puder ser exibida sem N+1;
* Incidente aberto puder ser exibido sem N+1;
* contagens globais forem eficientes;
* APIs existentes continuarem funcionando;
* testes passarem;
* build passar.

---

# 103. Resposta final

Ao concluir, apresente:

```text
RESUMO

...


CONTEXTO UTILIZADO

- codexcontex.md
- backend consolidado
- Equipamento
- Monitor
- Medição
- Incidente
- repositories/queries existentes


MODELO DE STATUS OPERACIONAL

Monitor:
...

Equipamento:
...

Unidade:
...


REGRAS DE PRECEDÊNCIA

...


ENDPOINTS DASHBOARD

GET /api/v1/dashboard/resumo

GET /api/v1/dashboard/unidades

GET /api/v1/dashboard/unidades/{id}

GET /api/v1/dashboard/unidades/{id}/equipamentos

Outros implementados:
...


CONTRATOS DE RESPOSTA

...


QUERIES / AGREGAÇÕES

...


ESTRATÉGIA DE ÚLTIMA MEDIÇÃO

...


ESTRATÉGIA DE INCIDENTE ABERTO

...


N+1 / PERFORMANCE

Problemas evitados:
...

Queries utilizadas:
...


PAGINAÇÃO

...


FILTROS

...


MIGRATIONS

Nenhuma.

ou:

...


ÍNDICES

Nenhum novo.

ou:

...


ARQUIVOS CRIADOS

...


ARQUIVOS ALTERADOS

...


README

...


TESTES CRIADOS

...


RESULTADO DOS TESTES

Comando:
...

Resultado:
...


RESULTADO DO BUILD

Comando:
...

Resultado:
...


GIT STATUS

...


GIT DIFF

...


DECISÕES TÉCNICAS

...


DIVERGÊNCIAS DA ESPECIFICAÇÃO

Nenhuma.

ou:
...


LIMITAÇÕES ATUAIS

...


NECESSIDADES IDENTIFICADAS PARA O FRONTEND

Liste apenas.


PRÓXIMO PASSO RECOMENDADO

Prompt 15 — preparação do contrato backend/frontend, CORS e documentação da API.

Não implemente automaticamente.
```

---

# 104. Princípio final

O Dashboard não deve inventar estado.

Ele deve apresentar uma leitura coerente do domínio existente:

```text
Monitor
    +
Medição
    +
Incidente
    ↓
Status operacional
```

E:

```text
Monitores
    ↓
Equipamento
    ↓
Unidade
```

O frontend deve receber uma resposta pronta para apresentação, sem precisar reproduzir thresholds, regras de incidentes ou cálculos complexos.

Agora analise o backend atual e implemente integralmente a Dashboard API de leitura operacional.

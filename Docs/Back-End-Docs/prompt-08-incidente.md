# Prompt 08 — Implementação do módulo Incidente

## 1. Contexto

Com base no contexto permanente definido em:

`codexcontex.md`

e considerando o estado atual do repositório após a implementação dos módulos:

```text
Unidade
TipoEquipamento
Equipamento
Monitor
Medição
```

implemente agora o domínio:

# INCIDENTE

A arquitetura conceitual passa a ser:

```text
Equipamento
    |
    +---- Monitor
            |
            +---- Medição
            |
            +---- Incidente
```

Conceitualmente:

```text
Monitor 1 ---- N Incidentes
```

IMPORTANTE:

Nesta etapa implemente:

* modelo de Incidente;
* persistência;
* API;
* abertura manual/controlada;
* fechamento manual/controlado;
* consultas;
* filtros;
* integridade referencial.

NÃO implemente ainda:

```text
scheduler
worker ICMP
detecção automática por falhas consecutivas
threshold automático
recovery automático
Telegram
Notificação
```

Essas responsabilidades serão tratadas em etapas posteriores.

---

# 2. Conceito de Incidente

`Incidente` representa um período consolidado de indisponibilidade ou anomalia associado a um Monitor.

Exemplo:

```text
Monitor:
ICMP principal

Incidente:
Iniciado em 2026-08-19T12:00:00Z

Status:
ABERTO
```

Posteriormente:

```text
Encerrado em:
2026-08-19T12:05:00Z

Status:
FECHADO
```

Um Incidente NÃO representa uma única Medição.

Esta regra é fundamental:

```text
Medição com FALHA != Incidente
```

Uma sequência de Medições poderá futuramente provocar a abertura automática de um Incidente através do Monitoring Engine.

---

# 3. Relação com Monitor

Todo Incidente pertence obrigatoriamente a um Monitor.

No banco:

```text
incidente.monitor_id
    FK -> monitor.id
```

Deve ser:

```text
NOT NULL
```

No Java, prefira:

```java
@ManyToOne(fetch = FetchType.LAZY)
```

Não adicione relacionamento bidirecional em Monitor apenas por antecipação.

Uma navegação:

```text
Incidente -> Monitor
```

é suficiente.

---

# 4. Relação com Medição

Nesta etapa NÃO crie FK obrigatória direta:

```text
incidente.medicao_id
```

Um Incidente representa um intervalo e poderá estar relacionado conceitualmente a várias Medições.

Não force uma Medição específica como dona do Incidente.

Se futuramente for útil registrar:

```text
medição que disparou o incidente
medição de recovery
```

isso poderá ser adicionado em migration posterior.

Não antecipe agora sem necessidade.

---

# 5. Modelo inicial

A entidade Incidente deverá possuir, no mínimo:

```text
id
monitor
status
iniciadoEm
encerradoEm
motivo
observacao
createdAt
updatedAt
```

Analise o padrão atual do projeto antes de definir nomes reais.

---

# 6. ID

Utilize a mesma estratégia já consolidada nas outras entidades.

Não introduza outro padrão.

---

# 7. Status do Incidente

Crie enum controlado pela aplicação.

Inicialmente:

```java
public enum StatusIncidente {
    ABERTO,
    FECHADO
}
```

Persistir como string:

```java
@Enumerated(EnumType.STRING)
```

Nunca utilizar ordinal.

---

# 8. Ciclo de vida

O ciclo básico será:

```text
ABERTO
  ↓
FECHADO
```

Nesta primeira versão, não implemente:

```text
ACKNOWLEDGED
INVESTIGANDO
SILENCIADO
RESOLVIDO
CANCELADO
```

sem requisito real.

Mantenha o modelo simples.

---

# 9. Campo iniciadoEm

Obrigatório.

Representa o instante de início do Incidente.

Use:

```java
Instant
```

ou estratégia equivalente já consolidada.

Não deve ser nulo.

---

# 10. Campo encerradoEm

Quando:

```text
status = ABERTO
```

deve ser:

```text
null
```

Quando:

```text
status = FECHADO
```

deve possuir valor válido.

Não utilize data artificial ou valor mágico.

---

# 11. Consistência temporal

Garanta:

```text
encerradoEm >= iniciadoEm
```

quando encerradoEm existir.

Não permita fechar incidente com data anterior ao início.

---

# 12. Campo motivo

Opcional ou obrigatório conforme padrão adotado, mas prefira inicialmente opcional.

Exemplos:

```text
Indisponibilidade detectada
Perda de conectividade
Falha recorrente
Abertura manual para investigação
```

Defina limite coerente.

Não use esse campo para armazenar stack trace.

---

# 13. Campo observacao

Opcional.

Pode conter informação administrativa sobre o incidente.

Exemplo:

```text
Equipe de infraestrutura verificando o equipamento.
```

Defina limite razoável.

---

# 14. createdAt e updatedAt

Siga o padrão consolidado no projeto.

Diferentemente de Medição, Incidente é mutável durante seu ciclo de vida porque pode passar de:

```text
ABERTO
```

para:

```text
FECHADO
```

Portanto `updatedAt` faz sentido.

---

# 15. Abertura de Incidente

Implemente operação explícita para abrir um Incidente.

Sugestão:

```text
POST /api/v1/incidentes
```

Request conceitual:

```json
{
  "monitorId": 1,
  "iniciadoEm": "2026-08-19T12:00:00Z",
  "motivo": "Indisponibilidade detectada",
  "observacao": null
}
```

O cliente NÃO deve informar:

```text
status
encerradoEm
createdAt
updatedAt
```

Novo Incidente começa:

```text
status = ABERTO
encerradoEm = null
```

---

# 16. Monitor inexistente

Ao abrir Incidente para Monitor inexistente:

```text
404 Not Found
```

Reutilize o padrão de exception existente.

---

# 17. Monitor inativo

Não bloqueie automaticamente a criação de um Incidente apenas porque o Monitor está inativo no momento da persistência.

O Incidente pode representar um fato ocorrido antes da desativação.

Não trate estado atual do Monitor como invalidação do histórico.

---

# 18. Apenas um Incidente aberto por Monitor

Implemente a regra:

```text
um Monitor não deve possuir mais de um Incidente ABERTO simultaneamente
```

Exemplo inválido:

```text
Monitor 10

Incidente A -> ABERTO
Incidente B -> ABERTO
```

Isso deve ser impedido.

Tentativa deverá retornar:

```text
409 Conflict
```

ou padrão equivalente.

---

# 19. Garantia no banco

A regra de apenas um Incidente aberto por Monitor deve, quando tecnicamente adequado ao PostgreSQL, possuir garantia também no banco.

Considere índice único parcial equivalente a:

```sql
UNIQUE (monitor_id)
WHERE status = 'ABERTO'
```

Avalie compatibilidade com as convenções atuais.

Isso é preferível a depender apenas de:

```text
existsByMonitorIdAndStatus(...)
```

porque concorrência pode gerar dois Incidentes simultâneos.

A aplicação deve fornecer mensagem de negócio amigável, enquanto o banco representa a garantia final.

---

# 20. Fechamento

Implemente endpoint explícito:

```text
PATCH /api/v1/incidentes/{id}/fechar
```

Request conceitual:

```json
{
  "encerradoEm": "2026-08-19T12:05:00Z",
  "observacao": "Conectividade restabelecida."
}
```

Ao fechar:

```text
status = FECHADO
```

---

# 21. Fechamento idempotente

Se o Incidente já estiver fechado, não altere silenciosamente o instante original de encerramento.

Prefira comportamento seguro.

Sugestão:

* se já FECHADO, retornar o recurso atual;
* não substituir `encerradoEm`;
* não reabrir;
* manter idempotência.

Documente a escolha.

---

# 22. Reabertura

NÃO implemente:

```text
PATCH /incidentes/{id}/reabrir
```

nesta etapa.

Caso ocorra nova indisponibilidade após um Incidente fechado, isso deverá gerar um novo Incidente.

---

# 23. UPDATE genérico

Evite:

```text
PUT /api/v1/incidentes/{id}
```

para alterar estado arbitrariamente.

O ciclo de vida deve ser explícito.

Pode existir endpoint para alterar apenas campos administrativos, se necessário, mas não é obrigatório nesta etapa.

Prefira:

```text
POST para abrir
PATCH /fechar para fechar
```

---

# 24. Exclusão física

Incidentes representam histórico operacional.

A preferência nesta etapa é:

```text
NÃO expor DELETE público de Incidente
```

Não permita apagar histórico facilmente.

Se existir necessidade administrativa explícita já definida no projeto, documente antes de implementar.

---

# 25. Migration

Utilize Flyway.

Antes de criar:

1. liste todas as migrations;
2. descubra a última versão;
3. confirme tabela Monitor;
4. confirme tipo do ID;
5. confirme padrão de enum/string;
6. confirme timestamps;
7. crie a próxima migration disponível.

Exemplo conceitual:

```text
Vx__create_incidente.sql
```

Nunca altere migration histórica aplicada.

---

# 26. Estrutura conceitual da tabela

Algo equivalente a:

```text
incidente
-----------------------------
id
monitor_id
status
iniciado_em
encerrado_em
motivo
observacao
created_at
updated_at
```

Utilize nomes coerentes com o padrão real do projeto.

---

# 27. Constraints

Garanta:

```text
monitor_id NOT NULL
status NOT NULL
iniciado_em NOT NULL
created_at NOT NULL
updated_at NOT NULL
```

E coerência para:

```text
status = ABERTO -> encerrado_em IS NULL
status = FECHADO -> encerrado_em IS NOT NULL
```

Se for simples e seguro, utilize CHECK constraint.

Exemplo conceitual:

```sql
CHECK (
    (status = 'ABERTO' AND encerrado_em IS NULL)
    OR
    (status = 'FECHADO' AND encerrado_em IS NOT NULL)
)
```

Considere também:

```text
encerrado_em >= iniciado_em
```

quando houver encerramento.

---

# 28. Foreign key

Crie FK real:

```text
incidente.monitor_id -> monitor.id
```

Não utilize:

```text
ON DELETE CASCADE
```

Excluir Monitor não deve apagar Incidentes.

---

# 29. Índices

Incidentes serão consultados frequentemente por:

```text
monitor_id
status
iniciado_em
```

Considere índice composto adequado, por exemplo:

```text
(monitor_id, iniciado_em DESC)
```

e índice para Incidentes abertos se fizer sentido.

Não crie índices sem justificativa.

---

# 30. Enum StatusIncidente

Crie no package apropriado.

Inicialmente:

```java
ABERTO,
FECHADO
```

Não implemente lógica complexa dentro do enum.

---

# 31. Entity

Crie:

```text
Incidente
```

seguindo o padrão de packages atual.

Mapeie Monitor como LAZY.

Não exponha entidade JPA pela API.

---

# 32. Repository

Crie:

```text
IncidenteRepository
```

Prepare consultas necessárias para:

```text
buscar por ID
listar
filtrar por monitor
filtrar por status
filtrar por período
buscar incidente aberto de um Monitor
```

---

# 33. Busca por Incidente aberto

Implemente uma consulta eficiente equivalente a:

```text
findOpenByMonitor(...)
```

ou padrão apropriado.

Isso será essencial quando o Monitoring Engine for implementado.

Não crie engine agora.

---

# 34. DTO de criação

Crie algo equivalente a:

```text
CreateIncidenteRequest
```

Campos:

```text
monitorId
iniciadoEm
motivo
observacao
```

Não receber:

```text
status
encerradoEm
id
createdAt
updatedAt
```

---

# 35. DTO de fechamento

Crie:

```text
CloseIncidenteRequest
```

ou nomenclatura equivalente.

Campos:

```text
encerradoEm
observacao
```

`encerradoEm` deve ser obrigatório no fechamento, salvo se o padrão do projeto preferir usar `Instant.now()` no servidor.

Escolha uma abordagem consistente e documente.

---

# 36. IncidenteResponse

Retorne algo equivalente a:

```json
{
  "id": 50,
  "status": "ABERTO",
  "iniciadoEm": "2026-08-19T12:00:00Z",
  "encerradoEm": null,
  "motivo": "Indisponibilidade detectada",
  "observacao": null,
  "monitor": {
    "id": 1,
    "nome": "ICMP principal",
    "tipo": "ICMP"
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

Não exponha entidade JPA.

---

# 37. Informações do Equipamento

A resposta pode incluir resumo do Equipamento através do Monitor se isso já fizer parte do padrão de DTOs atual.

Exemplo útil:

```text
monitor.id
monitor.nome
equipamento.id
equipamento.nome
```

Mas não retorne árvores completas.

Evite N+1.

---

# 38. Endpoints

Implemente:

```text
POST  /api/v1/incidentes
GET   /api/v1/incidentes
GET   /api/v1/incidentes/{id}
PATCH /api/v1/incidentes/{id}/fechar
```

Não implemente DELETE público.

Não implemente reabertura.

---

# 39. POST

Sucesso:

```text
201 Created
```

Valide:

```text
Monitor existente
data de início válida
não existir outro Incidente ABERTO para o Monitor
```

---

# 40. GET por ID

```text
GET /api/v1/incidentes/{id}
```

Sucesso:

```text
200 OK
```

Inexistente:

```text
404 Not Found
```

---

# 41. Listagem

```text
GET /api/v1/incidentes
```

Sempre paginada.

Incidentes acumulam histórico.

Use o padrão já consolidado em Medição.

---

# 42. Ordenação

Por padrão:

```text
iniciadoEm DESC
```

e, se necessário para estabilidade:

```text
iniciadoEm DESC, id DESC
```

---

# 43. Filtro por Monitor

Suporte:

```text
GET /api/v1/incidentes?monitorId=1
```

---

# 44. Filtro por status

Suporte:

```text
GET /api/v1/incidentes?status=ABERTO
GET /api/v1/incidentes?status=FECHADO
```

Status inválido:

```text
400 Bad Request
```

---

# 45. Filtro por período

Suporte filtros equivalentes a:

```text
inicio
fim
```

aplicados ao campo:

```text
iniciadoEm
```

Exemplo:

```text
GET /api/v1/incidentes?inicio=2026-08-01T00:00:00Z&fim=2026-08-31T23:59:59Z
```

Valide:

```text
inicio <= fim
```

---

# 46. Filtro por Unidade

Como o dashboard é organizado por Unidade, será útil consultar Incidentes por Unidade.

Se for possível implementar de forma simples e eficiente através das relações:

```text
Incidente
 -> Monitor
 -> Equipamento
 -> Unidade
```

suporte:

```text
GET /api/v1/incidentes?unidadeId=1
```

Não crie duplicação de `unidade_id` na tabela Incidente apenas para esse filtro.

Use relacionamento existente.

---

# 47. Filtro por Equipamento

Suporte, se simples e coerente:

```text
GET /api/v1/incidentes?equipamentoId=10
```

Novamente, não duplique FK na entidade Incidente.

Consulte através de Monitor.

---

# 48. Combinação de filtros

Permita combinar:

```text
monitorId
equipamentoId
unidadeId
status
inicio
fim
```

sem criar arquitetura excessivamente complexa.

Utilize a estratégia de filtros já consolidada em Medição/Equipamento.

---

# 49. N+1

A listagem poderá precisar de:

```text
Monitor
Equipamento
Unidade
```

Evite N+1.

Não altere os relacionamentos globalmente para EAGER.

Utilize a estratégia explícita já estabelecida no projeto:

```text
EntityGraph
JOIN FETCH
projection
```

ou equivalente.

---

# 50. Fechar Incidente inexistente

Retorne:

```text
404 Not Found
```

---

# 51. Fechamento com data inválida

Se:

```text
encerradoEm < iniciadoEm
```

retorne:

```text
400 Bad Request
```

ou padrão equivalente para validação de entrada/regra temporal.

---

# 52. Observação no fechamento

Se o request de fechamento trouxer observação, defina claramente se:

```text
substitui
```

ou:

```text
complementa
```

a observação existente.

Prefira comportamento simples e previsível.

Sugestão:

```text
substitui apenas se fornecida
```

Documente a decisão.

---

# 53. Alteração no DELETE de Monitor

Com:

```text
Incidente -> Monitor
```

um Monitor com Incidentes associados não pode ser apagado fisicamente.

O DELETE existente de Monitor deve retornar:

```text
409 Conflict
```

com mensagem apropriada.

Exemplo:

```text
Não é possível excluir o monitor porque existem incidentes associados.
```

Se Medições já impedem DELETE, mantenha tratamento consistente.

Não exponha SQL.

---

# 54. Não vincular automaticamente Medições

Não faça lógica como:

```text
ao abrir incidente
buscar todas as medições de falha e atualizá-las
```

Medição deve permanecer imutável.

Não adicione `incidente_id` nas Medições nesta etapa.

---

# 55. Não abrir automaticamente

Mesmo que existam Medições com FALHA:

NÃO execute automaticamente:

```text
createIncidente()
```

Apenas exponha o caso de uso necessário.

O Monitoring Engine fará isso posteriormente.

---

# 56. Não fechar automaticamente

Mesmo que exista Medição SUCESSO posterior:

NÃO feche automaticamente.

Recovery pertence ao Monitoring Engine.

---

# 57. Não implementar threshold

Não crie campos como:

```text
falhasParaAbrirIncidente
sucessosParaRecovery
threshold
```

em Incidente.

Essas configurações pertencem ao domínio de Monitor/engine e serão modeladas quando necessário.

---

# 58. Não implementar Notificação

NÃO crie ainda:

```text
Notificacao
Telegram
Email
Webhook
```

Incidente e Notificação são entidades diferentes.

Um Incidente poderá futuramente gerar várias Notificações.

---

# 59. Testes de Service

Cubra no mínimo:

```text
abrir Incidente com sucesso

falhar com Monitor inexistente

impedir segundo Incidente ABERTO para o mesmo Monitor

permitir novo Incidente após o anterior estar FECHADO

buscar Incidente existente

buscar Incidente inexistente

fechar Incidente

impedir fechamento com data anterior ao início

fechamento idempotente

listar por Monitor

listar por status

listar por período

listar por Equipamento, se implementado

listar por Unidade, se implementado
```

---

# 60. Testes de Controller/API

Cubra:

```text
POST válido -> 201

Monitor inexistente -> 404

Incidente aberto duplicado -> 409

GET existente -> 200

GET inexistente -> 404

GET lista paginada -> 200

filtro status -> 200

filtro monitor -> 200

PATCH fechar -> 200

PATCH fechar inexistente -> 404

data de fechamento inválida -> 400
```

---

# 61. Teste de concorrência/unicidade

Se for tecnicamente viável com a infraestrutura atual, valide a proteção do banco contra dois Incidentes ABERTOS para o mesmo Monitor.

Pelo menos teste a constraint/índice parcial em nível de repository/integration quando fizer sentido.

Não dependa apenas de mock do service para essa regra crítica.

---

# 62. Teste de integridade de Monitor

Garanta que Monitor com Incidentes não possa ser excluído.

API:

```text
409 Conflict
```

---

# 63. Performance

Revise:

```text
paginação
índices
filtros
sort
N+1
```

Incidentes crescerão menos rapidamente que Medições, mas ainda representam histórico.

---

# 64. Não criar dados derivados

Não adicione ao Incidente:

```text
duracaoSegundos
duracaoMinutos
uptime
downtimePercentage
```

A duração pode ser calculada:

```text
encerradoEm - iniciadoEm
```

quando necessário.

Evite duplicação de dados derivados.

---

# 65. Não criar estado global no Equipamento

Não atualize:

```text
Equipamento.status
Equipamento.online
```

quando Incidente abrir/fechar.

O estado operacional será determinado em camada específica posteriormente.

---

# 66. Consistência com módulos existentes

Reutilize:

```text
paginação
DTOs
exceptions
mappers
filtros
EntityGraph
HTTP status
padrões de Instant
```

já adotados.

Não crie nova arquitetura.

---

# 67. Migration x JPA

Garanta compatibilidade com:

```text
ddl-auto=validate
```

Revise:

```text
enum string
FK
nullable
CHECK constraints
timestamps
índice parcial
tamanhos
```

---

# 68. Inspeção inicial

Antes de modificar:

```bash
pwd
git status
```

Analise:

```text
pom.xml
src/main/java
src/main/resources/db/migration
src/test
```

Localize principalmente:

```text
Monitor
Medição
filtros
paginação
tratamento de integridade
EntityGraph/fetch
```

---

# 69. Sequência sugerida

```text
1. analisar repositório
2. analisar migrations
3. definir schema de Incidente
4. criar migration
5. criar StatusIncidente
6. criar entity
7. criar repository
8. criar DTOs
9. criar service
10. criar controller
11. filtros/paginação
12. ajustar DELETE Monitor
13. testes
14. mvn test
15. mvn verify
16. revisar git diff
```

---

# 70. Git

Não execute:

```text
git reset --hard
git clean -fd
git checkout .
git commit
git push
```

Ao final:

```bash
git status
git diff
```

---

# 71. Critérios de aceite

A feature estará concluída quando:

* existir migration válida de Incidente;
* Incidente possuir FK obrigatória para Monitor;
* não houver cascade delete;
* StatusIncidente for persistido como string;
* novo Incidente iniciar ABERTO;
* encerradoEm iniciar null;
* for impossível dois Incidentes ABERTOS simultaneamente para o mesmo Monitor;
* banco possuir garantia dessa regra quando tecnicamente apropriado;
* for possível fechar Incidente;
* fechamento definir status FECHADO;
* data de fechamento inválida for rejeitada;
* GET por ID funcionar;
* listagem for paginada;
* filtros principais funcionarem;
* ordenação for determinística;
* Monitor com Incidente não puder ser apagado silenciosamente;
* não houver DELETE público de Incidente;
* não houver abertura automática;
* não houver fechamento automático;
* não houver Notificação;
* testes passarem;
* build passar.

---

# 72. Resposta final

Ao concluir, apresente:

```text
RESUMO

...


CONTEXTO UTILIZADO

- codexcontex.md
- módulo Monitor
- módulo Medição
- módulos anteriores
- migrations existentes


ESTADO ANTES DA IMPLEMENTAÇÃO

...


MODELO INCIDENTE

Campos:
...


STATUS INCIDENTE

Enum:
...


RELACIONAMENTO

Incidente -> Monitor:
...


REGRA DE INCIDENTE ABERTO

Como foi garantido na aplicação:
...

Como foi garantido no banco:
...


ENDPOINTS

POST  /api/v1/incidentes
GET   /api/v1/incidentes
GET   /api/v1/incidentes/{id}
PATCH /api/v1/incidentes/{id}/fechar


FILTROS

...


PAGINAÇÃO

...


ORDENAÇÃO

...


MIGRATION

Arquivo:
...

FK:
...

Constraints:
...

Índices:
...


ARQUIVOS CRIADOS

...


ARQUIVOS ALTERADOS

...


ALTERAÇÕES EM MONITOR

...


TRATAMENTO DE ERROS

...


ESTRATÉGIA CONTRA N+1

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


PENDÊNCIAS

...


PRÓXIMO PASSO RECOMENDADO

Apenas indique a próxima feature.

Não implemente Notificação nem Monitoring Engine ainda.
```

---

# 73. Princípio principal

Preserve claramente:

```text
Monitor
    ↓
configuração

Medição
    ↓
resultado individual

Incidente
    ↓
estado consolidado ao longo do tempo
```

A existência de uma Medição com FALHA não implica automaticamente Incidente.

Nesta etapa, Incidente deve funcionar como domínio independente e consistente, preparado para ser manipulado futuramente pelo Monitoring Engine.

Agora analise o estado atual do repositório e implemente integralmente o módulo `Incidente`.

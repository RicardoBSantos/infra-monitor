# Prompt 07 — Implementação do módulo Medição

## 1. Contexto

Com base no contexto permanente definido em:

`codexcontex.md`

e considerando o estado atual do repositório após a implementação de:

```text
Unidade
TipoEquipamento
Equipamento
Monitor
```

implemente agora o domínio:

# MEDIÇÃO

Esta etapa introduz o primeiro registro operacional de monitoramento.

A arquitetura conceitual passa a ser:

```text
Equipamento
    |
    +---- Monitor
            |
            +---- Medição
```

Conceitualmente:

```text
Monitor 1 ---- N Medições
```

IMPORTANTE:

Nesta etapa implemente a persistência e consulta de Medições.

NÃO implemente ainda:

```text
scheduler
worker ICMP
execução periódica
ping automático
abertura automática de incidente
recovery
notificação
Telegram
```

---

# 2. Conceito de Medição

`Medição` representa o resultado de uma execução de um Monitor em um instante específico.

Exemplo:

```text
Monitor:
ICMP principal

Resultado:
SUCESSO

Latência:
4 ms

Executado em:
2026-08-19T12:00:00Z
```

Outro exemplo:

```text
Monitor:
ICMP principal

Resultado:
FALHA

Executado em:
2026-08-19T12:01:00Z
```

Medição é histórico.

Ela não representa a configuração do Monitor.

---

# 3. Relação com Monitor

Toda Medição pertence obrigatoriamente a um Monitor.

No banco:

```text
medicao.monitor_id
    FK -> monitor.id
```

A FK deve ser:

```text
NOT NULL
```

No Java, prefira:

```java
@ManyToOne(fetch = FetchType.LAZY)
```

Não adicione relacionamento bidirecional em Monitor sem necessidade.

Uma navegação:

```text
Medicao -> Monitor
```

é suficiente.

---

# 4. Modelo inicial

A entidade Medição deverá possuir, no mínimo:

```text
id
monitor
status
latenciaMs
mensagem
executadoEm
createdAt
```

Avalie o padrão atual antes de escolher nomes reais.

Nesta entidade, `updatedAt` provavelmente NÃO é necessário.

Medições representam eventos históricos e devem ser essencialmente imutáveis.

Não adicione `updatedAt` apenas por padronização se não houver razão real.

---

# 5. Imutabilidade

Depois de registrada, uma Medição não deve ser alterada normalmente.

Não implemente:

```text
PUT /medicoes/{id}
PATCH /medicoes/{id}
```

Medições são registros de histórico.

Preferencialmente permita apenas:

```text
criação
consulta
listagem
```

e, se realmente necessário administrativamente:

```text
DELETE
```

mas avalie com cautela.

A preferência inicial é não expor DELETE público para Medição.

---

# 6. Status da Medição

Crie enum controlado pela aplicação.

Exemplo:

```java
public enum StatusMedicao {
    SUCESSO,
    FALHA
}
```

Use os nomes que melhor se encaixarem no padrão atual do projeto.

Persistir como string:

```java
@Enumerated(EnumType.STRING)
```

Nunca persistir ordinal.

---

# 7. Semântica dos status

`SUCESSO` significa que a execução do Monitor foi concluída com sucesso.

`FALHA` significa que a execução falhou.

NÃO interprete uma única Medição com `FALHA` como Incidente.

Essa regra é fundamental:

```text
falha de medição != incidente
```

Incidente dependerá posteriormente de regras como:

```text
falhas consecutivas
threshold
tempo
recovery
```

Não implemente isso nesta etapa.

---

# 8. Campo latenciaMs

Opcional.

Para um monitor ICMP bem-sucedido, poderá representar:

```text
4
15
120
```

milissegundos.

Quando:

```text
status = FALHA
```

`latenciaMs` poderá ser:

```text
null
```

Não utilize valor mágico como:

```text
-1
9999
```

para representar falha.

Use `null`.

---

# 9. Validação de latência

Se `latenciaMs` for informado:

```text
latenciaMs >= 0
```

Não aceite valor negativo.

Se `status = SUCESSO`, avalie tornar `latenciaMs` obrigatória para o tipo ICMP.

Entretanto, como o domínio deverá futuramente suportar outros tipos de Monitor, não acople a entidade Medição exclusivamente ao ICMP.

Prefira uma regra simples nesta etapa.

---

# 10. Campo mensagem

Opcional.

Pode conter uma informação curta sobre o resultado.

Exemplos:

```text
Timeout
Host unreachable
Resposta recebida
```

Não armazene stack trace completo.

Não armazene secrets.

Defina limite de tamanho razoável.

---

# 11. Campo executadoEm

Obrigatório.

Representa o instante em que a execução ocorreu.

Use:

```java
Instant
```

ou a estratégia de timestamps consolidada no projeto.

Persistência deve representar instante absoluto.

Não utilize timezone local do servidor como regra de negócio.

---

# 12. Campo createdAt

Pode representar o instante em que o registro foi persistido.

Use somente se o projeto já diferencia:

```text
momento da execução
```

de:

```text
momento da persistência
```

Se não houver benefício real, avalie usar apenas `executadoEm`.

Não adicione campos redundantes sem necessidade.

A decisão deve ser documentada.

---

# 13. ID

Siga a mesma estratégia utilizada nas outras entidades.

Não introduza outro tipo de ID.

---

# 14. Migration

Utilize Flyway.

Antes de criar:

1. liste as migrations existentes;
2. identifique a última versão;
3. confirme nome real da tabela Monitor;
4. confirme tipo da PK;
5. confirme padrão de timestamps;
6. crie a próxima migration disponível.

Exemplo conceitual:

```text
Vx__create_medicao.sql
```

Não presuma número.

Nunca edite migration histórica aplicada.

---

# 15. Estrutura conceitual da tabela

Algo equivalente a:

```text
medicao
-----------------------------
id
monitor_id
status
latencia_ms
mensagem
executado_em
created_at
```

ou versão mais simples caso `created_at` seja considerado redundante.

---

# 16. Foreign key

Crie FK real:

```text
medicao.monitor_id
    -> monitor.id
```

Não utilize:

```text
ON DELETE CASCADE
```

Excluir Monitor não deve apagar automaticamente o histórico de Medições.

Preserve histórico.

---

# 17. Índices

Medições tendem a ser a primeira tabela realmente volumosa do sistema.

Crie índices com base nas consultas previstas.

No mínimo avalie:

```text
monitor_id
executado_em
```

e, idealmente, um índice composto:

```text
(monitor_id, executado_em DESC)
```

porque será muito comum consultar:

```text
últimas medições de um monitor
```

Não crie índices aleatórios.

---

# 18. Volume de dados

Assuma que Medição crescerá muito mais rapidamente que:

```text
Unidade
Equipamento
Monitor
```

Por isso:

* toda listagem deve ser paginada;
* nunca retorne todas as Medições sem limite;
* ordene por data de execução;
* consultas devem usar índices coerentes.

---

# 19. Entidade JPA

Crie:

```text
Medicao
```

no módulo apropriado.

Sugestão conceitual:

```text
br.com.inframonitor.medicao.entity.Medicao
```

Siga a estrutura real do projeto.

---

# 20. Repository

Crie:

```text
MedicaoRepository
```

Prepare consultas para:

```text
listar por monitor
filtrar por status
filtrar por intervalo de datas
buscar última medição de um monitor
```

Não crie dezenas de métodos antecipadamente.

---

# 21. Última medição

Implemente uma consulta eficiente para obter:

```text
última Medição de determinado Monitor
```

Exemplo futuro:

```text
GET /api/v1/monitores/{id}/ultima-medicao
```

Porém, avalie se esse endpoint deve ser implementado agora.

Se não houver necessidade direta nesta etapa, pelo menos deixe o repository preparado de forma simples.

Não crie cache.

---

# 22. Criação de Medição

Implemente um endpoint interno/administrativo para registrar Medição.

Exemplo:

```text
POST /api/v1/medicoes
```

Request conceitual:

```json
{
  "monitorId": 1,
  "status": "SUCESSO",
  "latenciaMs": 4,
  "mensagem": null,
  "executadoEm": "2026-08-19T12:00:00Z"
}
```

Essa API será útil inicialmente para testes e futura integração com o Monitoring Engine.

---

# 23. Monitor inexistente

Ao registrar Medição para:

```text
monitorId inexistente
```

retorne:

```text
404 Not Found
```

---

# 24. Monitor inativo

NÃO bloqueie automaticamente a persistência de uma Medição apenas porque o Monitor está inativo no momento da gravação.

Uma execução pode ter ocorrido instantes antes da desativação.

A Medição representa um fato histórico.

O Monitoring Engine será responsável futuramente por decidir se deve executar Monitores inativos.

---

# 25. Validação de status

Valores fora do enum devem retornar:

```text
400 Bad Request
```

Não persista strings arbitrárias.

---

# 26. Consistência entre status e latência

Adote uma regra clara.

Sugestão:

```text
SUCESSO:
latenciaMs pode ser informada

FALHA:
latenciaMs deve ser null
```

Para o primeiro tipo ICMP isso é coerente.

Se optar por regra mais flexível pensando em futuros tipos, documente.

Não introduza modelo complexo de métricas genéricas nesta etapa.

---

# 27. DTO de criação

Crie algo equivalente a:

```text
CreateMedicaoRequest
```

Campos:

```text
monitorId
status
latenciaMs
mensagem
executadoEm
```

Não receber:

```text
id
createdAt
```

---

# 28. DTO de resposta

Crie:

```text
MedicaoResponse
```

Sugestão:

```json
{
  "id": 100,
  "status": "SUCESSO",
  "latenciaMs": 4,
  "mensagem": null,
  "executadoEm": "2026-08-19T12:00:00Z",
  "monitor": {
    "id": 1,
    "nome": "ICMP principal",
    "tipo": "ICMP"
  }
}
```

Não exponha entidade JPA.

---

# 29. Endpoint POST

Implemente:

```text
POST /api/v1/medicoes
```

Sucesso:

```text
201 Created
```

Valide:

```text
monitor existente
status
latencia
mensagem
executadoEm
```

---

# 30. Endpoint GET por ID

Implemente:

```text
GET /api/v1/medicoes/{id}
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

# 31. Listagem

Implemente:

```text
GET /api/v1/medicoes
```

Sempre paginada.

Sugestão:

```text
GET /api/v1/medicoes?page=0&size=50
```

Use padrão já consolidado em Equipamento/Monitor.

---

# 32. Ordenação default

Por padrão:

```text
executadoEm DESC
```

Medições mais recentes primeiro.

Garanta ordenação determinística.

Se necessário:

```text
executadoEm DESC, id DESC
```

---

# 33. Filtro por Monitor

Suporte:

```text
GET /api/v1/medicoes?monitorId=1
```

Esse será o filtro mais importante.

---

# 34. Filtro por status

Suporte:

```text
GET /api/v1/medicoes?status=SUCESSO
GET /api/v1/medicoes?status=FALHA
```

Valor inválido:

```text
400 Bad Request
```

---

# 35. Filtro por período

Suporte filtros equivalentes a:

```text
inicio
fim
```

Exemplo:

```text
GET /api/v1/medicoes?monitorId=1&inicio=2026-08-19T00:00:00Z&fim=2026-08-20T00:00:00Z
```

Utilize `Instant`.

Valide:

```text
inicio <= fim
```

---

# 36. Combinação de filtros

Permita combinar:

```text
monitorId
status
inicio
fim
```

Não introduza biblioteca externa.

Use estratégia simples com Spring Data/JPA já utilizada no projeto.

---

# 37. Limite de size

Como Medição pode crescer muito, adote limite máximo razoável de página se o projeto já possuir esse padrão.

Exemplo conceitual:

```text
size máximo = 200
```

Não permita facilmente:

```text
size=100000
```

sem controle.

Preserve o padrão existente se já houver solução.

---

# 38. Não implementar UPDATE

Não crie:

```text
PUT /api/v1/medicoes/{id}
PATCH /api/v1/medicoes/{id}
```

Medição é histórica.

---

# 39. DELETE

A preferência é:

```text
não expor DELETE de Medição nesta primeira versão
```

Caso o projeto possua necessidade administrativa explícita, documente antes de implementar.

Preservação de histórico é prioridade.

---

# 40. Alteração no DELETE de Monitor

Após a nova FK:

```text
Medicao -> Monitor
```

reavalie o DELETE físico de Monitor.

Monitor com Medições associadas não deve ser excluído silenciosamente.

A API deve retornar:

```text
409 Conflict
```

ou padrão equivalente.

Mensagem conceitual:

```text
Não é possível excluir o monitor porque existem medições associadas.
```

Faça apenas a alteração mínima necessária no módulo Monitor.

---

# 41. Não criar Incidente

Mesmo quando:

```text
status = FALHA
```

NÃO crie Incidente automaticamente.

Não implemente:

```text
contador de falhas
threshold
abertura automática
recovery
```

Isso pertence ao módulo Incidente/Monitoring Engine.

---

# 42. Não atualizar status do Monitor

Não crie nem atualize em Monitor:

```text
statusAtual
online
offline
ultimaMedicao
ultimaLatencia
```

A menos que já exista uma decisão arquitetural explícita anterior.

Nesta etapa, o estado deve ser obtido por consulta às Medições.

Evite duplicação prematura de estado.

---

# 43. Consulta da última Medição

Se necessário para facilitar o frontend futuro, considere endpoint:

```text
GET /api/v1/monitores/{monitorId}/ultima-medicao
```

Mas implemente apenas se isso for simples e coerente com o padrão do projeto.

Se não implementar, documente como próxima evolução.

---

# 44. N+1

MedicaoResponse poderá incluir resumo de Monitor.

Evite N+1 na listagem.

Não altere relacionamento para EAGER global.

Use:

```text
EntityGraph
JOIN FETCH
projection
```

ou padrão existente.

---

# 45. Testes de Service

Cubra no mínimo:

```text
criar Medição SUCESSO

criar Medição FALHA

falhar com Monitor inexistente

falhar com status inválido quando aplicável

falhar com latência negativa

validar consistência status/latência

buscar Medição existente

buscar Medição inexistente

listar por Monitor

listar por status

listar por período

validar intervalo de datas inválido
```

---

# 46. Testes de Controller/API

Cubra:

```text
POST válido -> 201

POST inválido -> 400

Monitor inexistente -> 404

GET existente -> 200

GET inexistente -> 404

GET lista paginada -> 200

filtro monitor -> 200

filtro status -> 200

filtro período -> 200

intervalo inválido -> 400
```

---

# 47. Teste de integridade

Garanta que:

```text
Monitor com Medições
```

não possa ser excluído fisicamente.

API:

```text
409 Conflict
```

ou equivalente.

---

# 48. Repository tests

Como haverá consultas por:

```text
monitor
status
data
```

e ordenação por tempo, testes de repository podem ser úteis.

Teste apenas consultas customizadas relevantes.

---

# 49. Performance

Medição será tabela de alto crescimento.

Revise explicitamente:

```text
paginação
índices
sort
filtros
fetch
N+1
```

Não carregue histórico completo em memória.

---

# 50. Não implementar retenção ainda

Não implemente ainda:

```text
purge automático
retention policy
particionamento
TimescaleDB
compressão
arquivamento
```

Esses tópicos serão avaliados quando houver volume real.

Apenas mantenha o schema preparado para consultas eficientes.

---

# 51. Não implementar agregações

Não implemente ainda:

```text
uptime %
latência média
P95
P99
disponibilidade diária
gráficos
relatórios
```

Essas consultas virão depois.

---

# 52. Não implementar scheduler

Não utilize:

```text
@Scheduled
ExecutorService
Quartz
ScheduledExecutor
```

nesta tarefa.

O Monitoring Engine continua separado.

---

# 53. Não executar ping

Não utilize qualquer API de rede nesta feature.

Medição apenas recebe/persiste o resultado.

---

# 54. Consistência arquitetural

Preserve padrões existentes de:

```text
packages
DTOs
services
repositories
exceptions
paginação
filtros
tratamento HTTP
timestamps
testes
```

Não crie arquitetura paralela.

---

# 55. Migration x JPA

Garanta compatibilidade total com:

```text
ddl-auto=validate
```

Revise:

```text
FK
enum string
nullable
latencia
timestamps
varchar
índices
```

---

# 56. Inspeção inicial

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
Equipamento
paginação
filtros
EntityGraph/fetch
tratamento de DELETE com FK
```

---

# 57. Sequência sugerida

```text
1. analisar repositório
2. analisar migration atual
3. modelar Medição
4. criar migration
5. criar StatusMedicao
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
16. git diff
```

---

# 58. Git

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

# 59. Critérios de aceite

A feature estará concluída quando:

* existir migration válida para Medição;
* Medição possuir FK obrigatória para Monitor;
* não existir cascade delete;
* StatusMedicao for persistido como string;
* for possível registrar SUCESSO;
* for possível registrar FALHA;
* latência negativa for rejeitada;
* Monitor inexistente retornar 404;
* GET por ID funcionar;
* listagem for sempre paginada;
* filtro por Monitor funcionar;
* filtro por status funcionar;
* filtro por período funcionar;
* ordenação padrão for do mais recente para o mais antigo;
* índices adequados existirem;
* não houver N+1 óbvio;
* Monitor com Medições não puder ser apagado silenciosamente;
* não houver UPDATE de Medição;
* não houver criação automática de Incidente;
* não houver execução ICMP;
* testes passarem;
* build passar.

---

# 60. Resposta final

Ao concluir, apresente:

```text
RESUMO

...


CONTEXTO UTILIZADO

- codexcontex.md
- módulo Monitor
- módulos anteriores
- migrations existentes


ESTADO ANTES DA IMPLEMENTAÇÃO

...


MODELO MEDIÇÃO

Campos:
...


STATUS MEDIÇÃO

Enum:
...


RELACIONAMENTO

Medicao -> Monitor:
...


ENDPOINTS

POST /api/v1/medicoes
GET  /api/v1/medicoes
GET  /api/v1/medicoes/{id}


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

Não implemente Incidente ainda.
```

---

# 61. Princípio principal

A separação deve permanecer:

```text
Monitor
    ↓
configuração

Medição
    ↓
resultado histórico

Incidente
    ↓
interpretação de uma sequência de resultados
```

Não misture essas responsabilidades.

Uma Medição com falha é apenas um dado histórico.

Ela não significa automaticamente indisponibilidade consolidada.

Implemente a feature de forma eficiente para alto volume e preparada para o futuro Monitoring Engine, sem implementar o engine nesta etapa.

Agora analise o estado atual do repositório e implemente integralmente o módulo `Medição`.

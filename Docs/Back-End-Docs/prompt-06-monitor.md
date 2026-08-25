# Prompt 06 — Implementação do módulo Monitor

## 1. Contexto

Com base no contexto permanente definido em:

`codexcontex.md`

e considerando o estado atual do repositório após a implementação dos módulos:

```text
Unidade
TipoEquipamento
Equipamento
```

implemente agora o domínio:

# MONITOR

Esta etapa inicia o domínio de monitoramento do Infra Monitor.

Até aqui o projeto construiu principalmente o inventário:

```text
Unidade
   |
   +---- Equipamento ---- TipoEquipamento
```

A partir desta etapa passamos a preparar:

```text
Equipamento
    |
    +---- Monitor
```

Um Equipamento poderá possuir vários Monitores.

Conceitualmente:

```text
Equipamento 1 ---- N Monitor
```

IMPORTANTE:

Nesta etapa será implementada apenas a configuração e gerenciamento de Monitores.

NÃO implemente ainda:

```text
execução de ping
scheduler
worker ICMP
medição
processamento de disponibilidade
incidente
notificação
Telegram
```

Essas responsabilidades pertencem às próximas etapas.

---

# 2. Conceito de Monitor

`Monitor` representa uma configuração de monitoramento associada a um Equipamento.

Exemplo:

```text
Equipamento:
SW-CORE-01

Monitor:
ICMP - IP principal
```

Outro equipamento poderá futuramente possuir:

```text
ICMP
TCP
HTTP
SNMP
DNS
```

Portanto:

```text
Equipamento != Monitor
```

e:

```text
Monitor != Medição
```

`Monitor` representa configuração.

`Medição` representará posteriormente o resultado da execução dessa configuração.

---

# 3. Tipo de Monitor

Diferentemente de `TipoEquipamento`, `TipoMonitor` NÃO deve ser um cadastro administrativo livre.

`TipoEquipamento` representa classificação de inventário.

Já `TipoMonitor` representa uma capacidade realmente implementada pelo software.

Não faria sentido permitir ao usuário cadastrar:

```text
SNMP
```

se o backend ainda não possuir implementação para executar SNMP.

Por isso, nesta etapa represente o tipo do monitor através de enum controlado pela aplicação.

Exemplo inicial:

```java
public enum TipoMonitor {
    ICMP
}
```

No futuro esse enum poderá evoluir para:

```java
ICMP,
TCP,
HTTP,
SNMP,
DNS
```

quando cada tecnologia realmente for implementada.

---

# 4. Persistência do TipoMonitor

No banco, persista o enum como string legível.

Preferencialmente:

```java
@Enumerated(EnumType.STRING)
```

Nunca persista enum por ordinal.

NÃO utilizar:

```text
0
1
2
```

para representar tipos.

Persistir algo equivalente a:

```text
ICMP
```

Isso evita quebra caso a ordem do enum seja alterada.

---

# 5. Relação Equipamento -> Monitor

Todo Monitor pertence obrigatoriamente a um Equipamento.

No banco:

```text
monitor.equipamento_id
    FK -> equipamento.id
```

A foreign key deve ser:

```text
NOT NULL
```

No Java, prefira:

```java
@ManyToOne(fetch = FetchType.LAZY)
```

Não adicione `@OneToMany` em Equipamento apenas para tornar o relacionamento bidirecional.

Uma navegação:

```text
Monitor -> Equipamento
```

é suficiente nesta etapa.

---

# 6. Modelo inicial

A entidade Monitor deverá possuir, no mínimo:

```text
id
equipamento
tipo
nome
intervaloSegundos
timeoutMs
ativo
createdAt
updatedAt
```

Analise o repositório antes de definir:

* tipo de ID;
* nomes das colunas;
* tamanhos;
* padrão de timestamps;
* auditoria;
* convenções JPA.

Preserve o padrão consolidado nos módulos anteriores.

---

# 7. Campo id

Use exatamente a mesma estratégia utilizada nas entidades anteriores.

Não introduza outro tipo de identificador.

---

# 8. Campo equipamento

Obrigatório.

O Monitor deverá sempre estar associado a um Equipamento existente.

Request conceitual:

```json
{
  "equipamentoId": 10
}
```

Se o equipamento não existir:

```text
404 Not Found
```

---

# 9. Equipamento inativo

Não permita criar um Monitor ativo para Equipamento inativo.

Preferencialmente retorne:

```text
409 Conflict
```

ou o padrão já consolidado no projeto para violação de regra de negócio.

Um Monitor já existente pode permanecer historicamente associado a um Equipamento que posteriormente foi desativado.

Não apague Monitores automaticamente.

---

# 10. Ativação de Monitor

Ao ativar um Monitor, valide que o Equipamento associado esteja ativo.

Não permita:

```text
Monitor ativo
+
Equipamento inativo
```

Se o Equipamento estiver inativo:

```text
409 Conflict
```

---

# 11. Desativação do Equipamento

Nesta etapa NÃO implemente automaticamente:

```text
desativar equipamento
    ↓
desativar todos os monitores
```

Não faça cascata lógica sem requisito explícito.

O Monitor pode permanecer registrado como ativo ou inativo conforme estado atual, mas nenhuma execução será realizada ainda porque o Monitoring Engine ainda não existe.

Caso o projeto já possua regra diferente explicitamente implementada, preserve e documente.

---

# 12. Campo tipo

Obrigatório.

Nesta etapa somente:

```text
ICMP
```

é suportado.

Request conceitual:

```json
{
  "tipo": "ICMP"
}
```

Valores não reconhecidos devem resultar em:

```text
400 Bad Request
```

Não permita que strings arbitrárias sejam persistidas.

---

# 13. Campo nome

Obrigatório.

Representa um nome amigável para identificar o Monitor.

Exemplos:

```text
ICMP principal
Ping gateway
ICMP gerenciamento
Disponibilidade do switch
```

Não aceitar:

```text
null
""
"   "
```

Use validações coerentes com os módulos anteriores.

---

# 14. Unicidade do nome

Não imponha unicidade global ao nome do Monitor.

Exemplo:

```text
Equipamento A:
ICMP principal

Equipamento B:
ICMP principal
```

deve ser permitido.

Avalie se faz sentido impedir dois Monitores do mesmo equipamento com exatamente o mesmo nome.

Nesta primeira versão, prefira uma regra simples e consistente:

```text
nome não precisa ser globalmente único.
```

Não crie constraint adicional sem requisito claro.

---

# 15. Múltiplos monitores do mesmo tipo

A modelagem deve permitir, conceitualmente, mais de um Monitor do mesmo tipo no mesmo Equipamento.

Exemplo futuro:

```text
Monitor ICMP do IP principal
Monitor ICMP de outro endereço
```

Mesmo que inicialmente o Equipamento tenha apenas um campo IP.

Não crie constraint:

```text
UNIQUE(equipamento_id, tipo)
```

nesta etapa.

---

# 16. Alvo do monitor ICMP

Nesta primeira versão NÃO crie campo duplicado de IP no Monitor se não for necessário.

O monitor ICMP inicial poderá utilizar futuramente o IP principal do Equipamento.

Porém a execução de ICMP ainda NÃO será implementada.

Não faça agora:

```text
monitor.target_ip
```

sem necessidade explícita.

A responsabilidade desta etapa é configurar o Monitor.

Se o repositório ou requisitos existentes já tiverem decidido que cada Monitor precisa de alvo próprio, preserve essa decisão e documente.

---

# 17. Campo intervaloSegundos

Obrigatório.

Representa o intervalo desejado entre execuções futuras do Monitor.

Exemplo:

```text
30 segundos
60 segundos
300 segundos
```

O Monitoring Engine utilizará esse valor futuramente.

Nesta etapa apenas persista e valide a configuração.

Defina limites razoáveis.

Sugestão:

```text
mínimo: 10 segundos
máximo: 86400 segundos
```

Não trate esses valores como definitivos caso o projeto já tenha convenção diferente.

Evite intervalo zero ou negativo.

---

# 18. Campo timeoutMs

Obrigatório.

Representa o timeout futuro para a execução.

Exemplos:

```text
1000
2000
5000
```

Defina limites coerentes.

Sugestão:

```text
mínimo: 100 ms
máximo: 60000 ms
```

Apenas valide e persista.

Não execute nenhuma operação de rede nesta etapa.

---

# 19. Relação entre intervalo e timeout

Valide uma regra simples para evitar configurações incoerentes.

Preferencialmente:

```text
timeoutMs < intervaloSegundos * 1000
```

Exemplo inválido:

```text
intervalo = 10 segundos
timeout = 15000 ms
```

pois uma execução poderia ultrapassar o intervalo configurado.

Implemente essa regra no service ou em validação adequada.

Não crie framework complexo de validação cruzada.

---

# 20. Campo ativo

Obrigatório.

Novo Monitor deve iniciar:

```text
ativo = true
```

por padrão.

O cliente não precisa informar `ativo` no POST.

Ativação/desativação ocorrerão por endpoints específicos.

---

# 21. Datas

Utilize:

```text
createdAt
updatedAt
```

seguindo exatamente a estratégia já utilizada em:

```text
Unidade
TipoEquipamento
Equipamento
```

Não introduza infraestrutura de auditoria diferente.

---

# 22. Migration

Utilize Flyway.

Antes de criar qualquer migration:

1. liste todas as migrations existentes;
2. identifique a última versão;
3. confirme o nome real da tabela Equipamento;
4. confirme o tipo real da PK de Equipamento;
5. confirme padrão de timestamps;
6. confirme padrão singular/plural;
7. somente depois crie a próxima migration.

Exemplo conceitual:

```text
Vx__create_monitor.sql
```

Não presuma número.

Nunca altere migration histórica já aplicada.

---

# 23. Estrutura conceitual da tabela

A tabela deverá ser equivalente a:

```text
monitor
--------------------------------
id
equipamento_id
tipo
nome
intervalo_segundos
timeout_ms
ativo
created_at
updated_at
```

Utilize os nomes reais compatíveis com o projeto.

---

# 24. Constraints

Garanta no banco:

```text
PRIMARY KEY

equipamento_id NOT NULL

tipo NOT NULL

nome NOT NULL

intervalo_segundos NOT NULL

timeout_ms NOT NULL

ativo NOT NULL

created_at NOT NULL

updated_at NOT NULL
```

Considere CHECK constraints para:

```text
intervalo_segundos > 0
timeout_ms > 0
```

e limites adequados, se isso estiver coerente com o padrão do projeto.

A regra cruzada entre timeout e intervalo pode ficar na aplicação se for mais simples.

---

# 25. Tipo do enum no banco

Se utilizar VARCHAR, garanta tamanho suficiente.

Pode também considerar CHECK para tipos atualmente suportados.

Por exemplo:

```text
tipo IN ('ICMP')
```

Porém avalie o custo de evolução.

Se cada novo TipoMonitor exigirá naturalmente migration porque representa nova capacidade oficial do sistema, o CHECK pode ser aceitável.

Se isso criar rigidez desnecessária, mantenha apenas aplicação + enum.

Escolha a solução mais simples e documente.

---

# 26. Foreign key

Crie FK real:

```text
monitor.equipamento_id
    -> equipamento.id
```

Não utilize:

```text
ON DELETE CASCADE
```

Excluir Equipamento não deve apagar Monitores silenciosamente.

Preserve histórico.

---

# 27. Índice

Crie índice em:

```text
equipamento_id
```

porque consultas de:

```text
monitores por equipamento
```

serão frequentes.

Considere índice em:

```text
ativo
```

somente se houver justificativa real.

Não crie índices indiscriminadamente.

---

# 28. Entidade JPA

Crie:

```text
Monitor
```

no módulo apropriado.

Sugestão conceitual:

```text
br.com.inframonitor.monitor.entity.Monitor
```

Siga o padrão real do projeto.

---

# 29. Enum TipoMonitor

Crie enum:

```text
TipoMonitor
```

no package apropriado.

Inicialmente:

```java
ICMP
```

Não implemente código de execução dentro do enum.

O enum representa apenas tipo/capacidade.

---

# 30. Repository

Crie:

```text
MonitorRepository
```

Inclua somente consultas necessárias nesta etapa.

Será necessário, no mínimo, suportar:

```text
buscar por ID
listar
filtrar por equipamento
filtrar por tipo
filtrar por ativo
```

A combinação desses filtros deve permanecer simples.

---

# 31. DTO de criação

Crie algo equivalente a:

```text
CreateMonitorRequest
```

Request conceitual:

```json
{
  "equipamentoId": 10,
  "tipo": "ICMP",
  "nome": "ICMP principal",
  "intervaloSegundos": 60,
  "timeoutMs": 2000
}
```

Não receber:

```text
id
ativo
createdAt
updatedAt
```

---

# 32. DTO de atualização

Crie algo equivalente a:

```text
UpdateMonitorRequest
```

Permita atualizar:

```text
equipamentoId
tipo
nome
intervaloSegundos
timeoutMs
```

Não permitir alterar diretamente:

```text
id
ativo
createdAt
updatedAt
```

Ativo permanece em endpoints próprios.

---

# 33. Alteração de Equipamento

Permita mover um Monitor para outro Equipamento, se necessário.

O novo Equipamento:

```text
deve existir
deve estar ativo
```

Se `equipamentoId` permanecer o mesmo e o Equipamento tiver sido desativado posteriormente, não bloqueie automaticamente a edição de:

```text
nome
intervalo
timeout
```

apenas por isso.

Mas não permita transferir para outro Equipamento inativo.

---

# 34. DTO de resposta

Crie:

```text
MonitorResponse
```

Sugestão conceitual:

```json
{
  "id": 1,
  "nome": "ICMP principal",
  "tipo": "ICMP",
  "intervaloSegundos": 60,
  "timeoutMs": 2000,
  "ativo": true,
  "equipamento": {
    "id": 10,
    "nome": "SW-CORE-01"
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

Não retorne entidade JPA aninhada.

---

# 35. Informações resumidas do Equipamento

A resposta poderá incluir dados úteis como:

```text
id
nome
ip
```

se fizer sentido para o frontend.

Não retorne automaticamente:

```text
Unidade completa
TipoEquipamento completo
futuras relações
```

Mantenha o DTO enxuto.

---

# 36. N+1

Como a listagem de Monitores poderá retornar dados do Equipamento, avalie N+1.

Não altere:

```java
@ManyToOne
```

para EAGER globalmente.

Use solução explícita, como:

```text
EntityGraph
JOIN FETCH
projection
```

ou padrão já utilizado em Equipamento.

---

# 37. Service

Implemente:

```text
create
findById
list
update
activate
deactivate
delete
```

O service deverá centralizar as regras de negócio.

---

# 38. Endpoints

Implemente:

```text
POST   /api/v1/monitores
GET    /api/v1/monitores
GET    /api/v1/monitores/{id}
PUT    /api/v1/monitores/{id}
PATCH  /api/v1/monitores/{id}/ativar
PATCH  /api/v1/monitores/{id}/desativar
DELETE /api/v1/monitores/{id}
```

Preserve outra rota apenas se já houver convenção consolidada.

---

# 39. POST

Endpoint:

```text
POST /api/v1/monitores
```

Sucesso:

```text
201 Created
```

Valide:

```text
equipamento existente
equipamento ativo
tipo suportado
nome válido
intervalo válido
timeout válido
relação timeout/intervalo válida
```

---

# 40. GET por ID

```text
GET /api/v1/monitores/{id}
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
GET /api/v1/monitores
```

A quantidade de Monitores poderá crescer junto com Equipamentos.

Use paginação se o projeto já consolidou esse padrão em Equipamento.

Prefira consistência.

---

# 42. Filtro por Equipamento

Suporte:

```text
GET /api/v1/monitores?equipamentoId=10
```

Esse filtro será essencial para a tela de detalhes do Equipamento.

---

# 43. Filtro por Tipo

Suporte:

```text
GET /api/v1/monitores?tipo=ICMP
```

Tipo inválido deve resultar em:

```text
400 Bad Request
```

de forma consistente.

---

# 44. Filtro por ativo

Suporte:

```text
GET /api/v1/monitores?ativo=true
GET /api/v1/monitores?ativo=false
```

---

# 45. Combinação de filtros

Permita:

```text
GET /api/v1/monitores?equipamentoId=10&tipo=ICMP&ativo=true
```

Não introduza biblioteca externa para filtros.

Use mecanismo simples já disponível no Spring Data/JPA.

---

# 46. PUT

```text
PUT /api/v1/monitores/{id}
```

Permita atualizar os campos editáveis.

Valide novamente:

```text
equipamento
tipo
intervalo
timeout
```

Se o Equipamento continuar sendo o mesmo e estiver atualmente inativo, permita editar outros campos.

Se houver tentativa de trocar para Equipamento inativo:

```text
409 Conflict
```

---

# 47. PATCH ativar

```text
PATCH /api/v1/monitores/{id}/ativar
```

Antes de ativar:

```text
Equipamento deve estar ativo.
```

Além disso, a configuração deve continuar válida.

Operação idempotente.

---

# 48. PATCH desativar

```text
PATCH /api/v1/monitores/{id}/desativar
```

Define:

```text
ativo = false
```

Operação idempotente.

---

# 49. DELETE

```text
DELETE /api/v1/monitores/{id}
```

Sucesso:

```text
204 No Content
```

Inexistente:

```text
404 Not Found
```

Nesta etapa ainda não existem Medições/Incidentes relacionadas.

Quando essas entidades forem implementadas, a política de DELETE deverá ser reavaliada.

Não antecipe cascade.

---

# 50. Alteração no DELETE de Equipamento

Após a criação da FK:

```text
Monitor -> Equipamento
```

reavalie o DELETE existente de Equipamento.

Um Equipamento com Monitores associados não deve ser excluído fisicamente de forma silenciosa.

O banco deve impedir perda de histórico.

A API deve tratar isso como:

```text
409 Conflict
```

ou padrão equivalente.

Mensagem conceitual:

```text
Não é possível excluir o equipamento porque existem monitores associados.
```

Faça a alteração mínima necessária no módulo Equipamento.

---

# 51. Bean Validation

Utilize validações adequadas para:

```text
equipamentoId
tipo
nome
intervaloSegundos
timeoutMs
```

Exemplos:

```java
@NotNull
@NotBlank
@Size
@Min
@Max
```

Siga o estilo existente.

---

# 52. Validação cruzada

A regra:

```text
timeoutMs < intervaloSegundos * 1000
```

não deve ficar no controller.

Implemente em service ou solução simples de validação.

Mensagem de erro deve ser compreensível.

---

# 53. Tratamento de erros

Reutilize o tratamento global existente.

Casos:

```text
request inválido -> 400

TipoMonitor inválido -> 400

intervalo inválido -> 400

timeout inválido -> 400

relação timeout/intervalo inválida -> 400 ou padrão equivalente

monitor inexistente -> 404

equipamento inexistente -> 404

equipamento inativo em novo vínculo -> 409

ativação com equipamento inativo -> 409

exclusão de Equipamento com Monitor -> 409
```

Não exponha stack trace, SQL ou mensagens internas.

---

# 54. Não executar ICMP

NÃO utilize:

```text
InetAddress.isReachable
ProcessBuilder("ping")
Runtime.exec
biblioteca ICMP
socket
scheduler
@Scheduled
```

nesta etapa.

Nenhuma requisição de rede deve acontecer.

O campo:

```text
tipo = ICMP
```

representa somente a configuração da capacidade futura.

---

# 55. Não criar Medição

NÃO crie:

```text
Medicao
Measurement
PingResult
MonitorResult
```

nesta etapa.

O próximo módulo tratará disso.

---

# 56. Não criar status operacional

Não adicione ao Monitor:

```text
online
offline
statusAtual
latenciaAtual
ultimaExecucao
lastSeen
ultimaFalha
uptime
percentualDisponibilidade
```

Esses valores serão derivados posteriormente das Medições.

---

# 57. Não criar lógica de Incidente

Não implemente:

```text
falhas consecutivas
threshold
abertura de incidente
fechamento de incidente
recovery
```

agora.

Isso será tratado depois.

---

# 58. Não implementar Telegram

Não adicione:

```text
chatId
telegramEnabled
telegramToken
notificarTelegram
```

no Monitor.

Notificações são outro domínio.

---

# 59. Testes de Service

Cubra pelo menos:

```text
criar Monitor válido

falhar com Equipamento inexistente

falhar com Equipamento inativo

falhar com tipo inválido quando aplicável

falhar com intervalo abaixo do mínimo

falhar com timeout inválido

falhar quando timeout >= intervalo

buscar Monitor existente

buscar Monitor inexistente

atualizar Monitor

alterar Equipamento para Equipamento ativo

impedir alteração para Equipamento inativo

editar dados mantendo Equipamento atual inativo

ativar Monitor

impedir ativação com Equipamento inativo

desativar Monitor

excluir Monitor
```

Adapte ao padrão atual dos testes.

---

# 60. Testes de Controller/API

Cubra:

```text
POST válido -> 201

POST inválido -> 400

Equipamento inexistente -> 404

Equipamento inativo -> 409

GET existente -> 200

GET inexistente -> 404

GET lista -> 200

GET filtro equipamento -> 200

GET filtro tipo -> 200

GET filtro ativo -> 200

PUT válido -> 200

PATCH ativar -> sucesso

PATCH desativar -> sucesso

DELETE -> 204
```

---

# 61. Teste de integridade de Equipamento

Garanta que:

```text
Equipamento com Monitor
```

não possa ser excluído fisicamente.

A API deverá retornar:

```text
409 Conflict
```

ou padrão equivalente.

---

# 62. Repository tests

Crie apenas se houver comportamento relevante.

Filtros combinados e estratégia de fetch podem justificar testes.

Não teste CRUD trivial do Spring Data por formalidade.

---

# 63. Consistência com Equipamento

Use o módulo Equipamento como referência para:

```text
paginação
filtros
DTOs resumidos
EntityGraph/fetch
HTTP
tratamento de erro
estrutura de package
testes
```

Evite criar nova abordagem.

---

# 64. Não criar abstrações genéricas

Mesmo com vários módulos implementados, não crie automaticamente:

```text
BaseEntity
BaseService
BaseController
GenericCrud
GenericSpecification
```

Só abstraia caso exista problema real.

---

# 65. Migration e validação JPA

Garanta compatibilidade entre:

```text
migration
```

e:

```text
@Entity Monitor
```

Verifique:

```text
nomes
nullable
tipo enum
tamanhos
ID
FK
timestamps
boolean
intervalo
timeout
```

O projeto deve continuar funcionando com:

```text
ddl-auto=validate
```

---

# 66. Inspeção inicial

Antes de modificar:

```bash
pwd
git status
```

Analise:

```text
pom.xml
src/main/java
src/main/resources
src/main/resources/db/migration
src/test
```

Localize:

```text
Equipamento
Unidade
TipoEquipamento
exceptions
tratamento global de erros
infraestrutura de paginação
estratégia contra N+1
```

---

# 67. Implementação incremental

Sugestão:

```text
1. analisar repositório
2. analisar migration mais recente
3. criar migration Monitor
4. criar TipoMonitor
5. criar Monitor entity
6. criar repository
7. criar DTOs
8. criar service
9. criar controller
10. filtros/paginação
11. tratamento DELETE Equipamento
12. testes
13. executar test
14. executar verify
15. revisar git diff
```

---

# 68. Git

Antes:

```bash
git status
```

Depois:

```bash
git status
git diff
```

Não execute:

```text
git reset --hard
git clean -fd
git checkout .
git commit
git push
```

Preserve alterações locais existentes.

---

# 69. Testes finais

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

Se falhar:

1. investigue;
2. corrija erros relacionados;
3. execute novamente;
4. reporte problemas remanescentes.

---

# 70. Revisão final

Revise:

```text
FK Equipamento
enum
EnumType.STRING
LAZY
N+1
paginação
filtros
intervalo
timeout
validação cruzada
erros HTTP
DELETE Equipamento
testes
```

Procure ainda:

```text
imports não utilizados
TODO
secrets
mudanças fora do escopo
código de rede indevido
```

---

# 71. Critérios de aceite

A feature estará concluída quando:

* existir migration de Monitor quando necessária;
* Monitor possuir FK obrigatória para Equipamento;
* FK não utilizar cascade delete;
* `TipoMonitor` existir;
* inicialmente suportar `ICMP`;
* enum for persistido como string;
* Monitor possuir nome;
* intervalo for validado;
* timeout for validado;
* timeout não puder ser maior/igual ao intervalo;
* Monitor iniciar ativo;
* Equipamento inexistente retornar 404;
* Equipamento inativo impedir criação ativa;
* listagem funcionar;
* filtros funcionarem;
* paginação seguir padrão do projeto;
* update funcionar;
* ativação validar Equipamento;
* desativação funcionar;
* DELETE funcionar;
* Equipamento com Monitor não puder ser excluído silenciosamente;
* não houver N+1 óbvio;
* entidade JPA não for exposta;
* testes passarem;
* build passar;
* nenhuma execução ICMP tiver sido implementada;
* nenhuma Medição tiver sido implementada;
* nenhum Incidente tiver sido implementado.

---

# 72. Resposta final

Ao concluir, apresente:

```text
RESUMO

...


CONTEXTO UTILIZADO

- codexcontex.md
- módulo Equipamento
- módulos anteriores
- migrations existentes


ESTADO ANTES DA IMPLEMENTAÇÃO

...


MODELO MONITOR

Campos:
...


TIPO MONITOR

Enum:
...

Tipos atualmente suportados:
...


RELACIONAMENTO

Monitor -> Equipamento:
...


ENDPOINTS

POST   /api/v1/monitores
GET    /api/v1/monitores
GET    /api/v1/monitores/{id}
PUT    /api/v1/monitores/{id}
PATCH  /api/v1/monitores/{id}/ativar
PATCH  /api/v1/monitores/{id}/desativar
DELETE /api/v1/monitores/{id}


FILTROS

...


PAGINAÇÃO

...


MIGRATION

Arquivo:
...

FK:
...

Índices:
...


REGRAS DE INTERVALO E TIMEOUT

...


ARQUIVOS CRIADOS

...


ARQUIVOS ALTERADOS

...


ALTERAÇÕES EM EQUIPAMENTO

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

Não implemente Medição ainda.
```

---

# 73. Princípio principal

A arquitetura deverá continuar separando claramente:

```text
INVENTÁRIO

Unidade
TipoEquipamento
Equipamento
```

de:

```text
CONFIGURAÇÃO DE MONITORAMENTO

Monitor
```

e futuramente de:

```text
RESULTADO DO MONITORAMENTO

Medição
Incidente
```

`Monitor` é configuração.

Não é execução.

Não é resultado.

Não é incidente.

Implemente esta etapa de forma que futuramente seja possível adicionar novos tipos:

```text
TCP
HTTP
SNMP
DNS
```

sem redesenhar a relação principal:

```text
Equipamento 1 ---- N Monitor
```

Agora analise o estado atual do repositório e implemente integralmente o módulo `Monitor`, sem iniciar o Monitoring Engine.

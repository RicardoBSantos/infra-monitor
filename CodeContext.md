Você está trabalhando no projeto **Infra Monitor**, um sistema interno de monitoramento e gerenciamento da infraestrutura de rede de uma empresa.

A partir desta sessão, você será o principal agente responsável pela implementação e evolução do **backend Java/Spring Boot**.

Antes de realizar qualquer alteração, leia este contexto completo e depois analise o repositório existente.

# 1. Visão geral do projeto

O Infra Monitor terá como responsabilidades principais:

* cadastro e gerenciamento das unidades da empresa;
* inventário dos equipamentos de infraestrutura;
* associação obrigatória dos equipamentos às suas respectivas unidades;
* diferenciação dos equipamentos por tipo;
* configuração de monitores para equipamentos;
* monitoramento inicial de disponibilidade através de ICMP;
* armazenamento de medições;
* detecção e gerenciamento de incidentes;
* geração futura de relatórios;
* dashboard por unidade;
* alertas inicialmente via Telegram;
* evolução futura para outros tipos de monitoramento e canais de notificação.

A stack geral é:

```text
Backend
Java 21
Spring Boot
Maven

Banco
PostgreSQL
Flyway

Frontend
Angular

Monitoramento
ICMP inicialmente

Alertas
Telegram inicialmente

Deploy futuro
Docker
Linux
Nginx
```

# 2. Organização lógica do projeto

O projeto está dividido conceitualmente em módulos:

```text
01 - Arquitetura e Regras de Negócio

02 - Design e UX

03 - Banco de Dados

04 - Backend
     Java / Spring Boot

05 - Monitoring Engine
     ICMP / scheduler / workers / incidentes

06 - Frontend
     Angular

07 - Telegram
     bot / alertas

08 - Deploy
     Docker / Linux / Nginx

09 - Bugs e Melhorias
```

Você está trabalhando principalmente no:

```text
04 - Backend
```

Não misture responsabilidades pertencentes aos outros módulos sem necessidade.

# 3. Limite de responsabilidade nesta fase

O backend Spring Boot será responsável por:

* API REST;
* regras de negócio;
* persistência;
* entidades;
* DTOs;
* validações;
* services;
* repositories;
* tratamento de erros;
* migrations relacionadas à evolução do domínio;
* consultas necessárias para frontend;
* integração futura com o Monitoring Engine.

O backend NÃO deverá implementar neste momento:

* execução periódica de ping;
* scheduler de monitoramento;
* worker ICMP;
* algoritmo completo de detecção de indisponibilidade;
* bot Telegram;
* frontend Angular;
* autenticação, salvo quando explicitamente solicitado;
* deploy de produção.

Essas funcionalidades serão introduzidas em etapas posteriores.

# 4. Domínio principal

A relação conceitual principal é:

```text
Unidade
   │
   └── Equipamento
          │
          └── Monitor
                 ├── Medição
                 └── Incidente
                        │
                        └── Notificação
```

Esse modelo deve orientar a arquitetura.

# 5. Unidade

Uma Unidade representa uma unidade física/organizacional da empresa.

Exemplos:

```text
Matriz
Filial Recife
Filial São Paulo
CD Nordeste
```

Uma unidade poderá possuir vários equipamentos.

Todo equipamento obrigatoriamente deverá pertencer a uma unidade.

Conceitualmente:

```text
Unidade 1 ---- N Equipamentos
```

Não crie módulos independentes por unidade.

A unidade deve ser representada através de relacionamento no banco.

# 6. Equipamento

Equipamento representa um ativo da infraestrutura.

Exemplos:

```text
Router
Switch
Firewall
Servidor
Access Point
Impressora
NVR
DVR
Câmera
Outro
```

Cada equipamento:

* pertence obrigatoriamente a uma unidade;
* possui um tipo;
* poderá possuir endereço IP;
* poderá possuir hostname;
* poderá possuir descrição;
* poderá possuir localização física;
* poderá possuir informações adicionais;
* poderá possuir um ou vários monitores;
* deverá poder ser desativado sem necessariamente ser removido fisicamente.

A relação fundamental é:

```text
Equipamento
    unidade_id -> Unidade
```

Nunca crie tabelas ou módulos separados por unidade.

# 7. Tipo de equipamento

Tipo de equipamento não deve ser confundido com monitor.

Exemplo:

```text
Equipamento:
SW-CORE-01

Tipo:
SWITCH
```

O tipo classifica o equipamento.

Monitor define o que será monitorado nesse equipamento.

Essas responsabilidades devem permanecer separadas.

# 8. Monitor

Monitor representa uma configuração de monitoramento.

Exemplo:

```text
Equipamento:
SW-CORE-01

Monitor:
ICMP para 10.0.0.1
```

No futuro um equipamento poderá possuir outros monitores:

```text
ICMP
TCP
HTTP
SNMP
DNS
outros
```

Portanto:

```text
Equipamento != Monitor
```

E:

```text
Equipamento 1 ---- N Monitor
```

Mesmo que inicialmente exista apenas ICMP, não acople todo o domínio diretamente ao ping.

# 9. Medição

Medição representa o resultado de uma execução de um monitor.

Exemplo futuro:

```text
monitor = ICMP
status = SUCCESS
latencia = 4 ms
timestamp = ...
```

Ou:

```text
monitor = ICMP
status = FAILED
timestamp = ...
```

Medições pertencem ao monitor.

Não pertencem diretamente ao equipamento.

Conceitualmente:

```text
Monitor 1 ---- N Medições
```

O Monitoring Engine será responsável futuramente por gerar essas medições.

# 10. Incidente

Incidente representa um evento de indisponibilidade ou comportamento anormal detectado a partir de um monitor.

Importante:

```text
uma única falha de ping NÃO necessariamente significa incidente.
```

A criação automática de incidentes dependerá posteriormente de regras como:

```text
falhas consecutivas
threshold
tempo
recovery
```

Essas regras fazem parte principalmente do Monitoring Engine.

O backend deverá apenas estar preparado para representar e gerenciar incidentes quando essa etapa chegar.

Incidentes pertencem ao monitor:

```text
Monitor 1 ---- N Incidentes
```

# 11. Notificação

Notificação é diferente de incidente.

Um incidente poderá gerar:

```text
Telegram
Email
Webhook
outros canais futuros
```

Por isso não colocar campos específicos de Telegram diretamente em `Incidente`.

Conceitualmente:

```text
Incidente 1 ---- N Notificações
```

# 12. Regra de desativação

Equipamentos históricos não devem normalmente ser removidos do banco apenas porque deixaram de ser monitorados.

Deve existir uma estratégia equivalente a:

```text
ativo = true
ativo = false
```

Exclusão física poderá existir como operação administrativa, mas não deverá ser o fluxo padrão para equipamentos com histórico.

Antes de implementar DELETE, considere sempre integridade referencial e histórico.

# 13. Datas e timezone

Persistência de timestamps deverá seguir estratégia consistente.

Para eventos operacionais, prefira UTC.

No Java, prefira:

```java
Instant
```

quando representar instante absoluto.

Evite:

```java
java.util.Date
Calendar
```

Conversão para timezone local deverá ser feita na camada apropriada.

# 14. API REST

A API deverá utilizar versionamento:

```text
/api/v1
```

Exemplo:

```text
/api/v1/unidades
/api/v1/equipamentos
/api/v1/monitores
/api/v1/incidentes
```

Utilize convenções HTTP adequadas.

Exemplos:

```text
GET
POST
PUT
PATCH
DELETE
```

Não exponha entidades JPA diretamente como contrato da API quando houver risco de acoplamento.

Prefira DTOs apropriados.

# 15. Estrutura de packages

Prefira arquitetura por feature/domínio.

Exemplo:

```text
br.com.inframonitor
│
├── common
│   ├── api
│   ├── config
│   └── exception
│
├── unidade
│   ├── controller
│   ├── dto
│   ├── entity
│   ├── repository
│   └── service
│
├── equipamento
│   ├── controller
│   ├── dto
│   ├── entity
│   ├── repository
│   └── service
│
├── monitor
│
├── incidente
│
└── notificacao
```

Porém:

NÃO crie pastas ou classes vazias apenas para reproduzir essa árvore.

Crie somente quando houver funcionalidade correspondente.

# 16. Filosofia arquitetural

Prefira:

```text
simplicidade
clareza
baixo acoplamento
alta coesão
testabilidade
manutenção
```

Evite overengineering.

Não crie abstrações antes de existir necessidade concreta.

Evite estruturas como:

```text
BaseController
BaseService
BaseRepository
GenericService<T>
GenericMapper<T>
```

apenas para reduzir algumas linhas de código.

Também não aplique patterns apenas porque eles existem.

Toda abstração deve resolver um problema real.

# 17. Services

Services devem representar regras de negócio e casos de uso.

Controllers não devem possuir lógica de negócio significativa.

Repositories devem ser responsáveis apenas por acesso aos dados.

Evite:

```text
Controller -> Repository
```

quando existir regra de negócio relevante.

Prefira:

```text
Controller
   ↓
Service
   ↓
Repository
```

# 18. DTOs

Não utilize uma única classe DTO para todas as operações se as necessidades forem diferentes.

Quando fizer sentido, utilize estruturas semelhantes a:

```text
CreateUnidadeRequest
UpdateUnidadeRequest
UnidadeResponse
```

Porém, novamente:

não crie DTOs desnecessários para casos extremamente simples.

# 19. Validação

Utilize Bean Validation quando apropriado.

Exemplos:

```java
@NotBlank
@NotNull
@Size
@Pattern
```

Validações simples devem acontecer na entrada da API.

Validações de regras de negócio devem acontecer na camada de serviço.

# 20. Tratamento de erros

A API deve utilizar tratamento global de erros.

Preferir:

```java
@RestControllerAdvice
```

Padronizar respostas de erro.

Uma resposta poderá conter, conforme necessário:

```json
{
  "timestamp": "...",
  "status": 400,
  "error": "Bad Request",
  "message": "...",
  "path": "/api/v1/..."
}
```

Para validação:

```json
{
  "fields": {
    "nome": "não deve estar vazio"
  }
}
```

Mantenha consistência entre os endpoints.

# 21. Banco de dados

O banco é PostgreSQL.

Alterações estruturais devem ser realizadas através de migrations.

Utilizar:

```text
Flyway
```

Local esperado:

```text
src/main/resources/db/migration
```

Nunca utilizar Hibernate como mecanismo principal para modificar schema.

Configuração JPA deverá permanecer equivalente a:

```text
ddl-auto: validate
```

Nunca usar:

```text
update
create
create-drop
```

como estratégia normal.

# 22. Regra crítica de migrations

Antes de criar uma migration:

1. examine as migrations existentes;
2. identifique a versão mais recente;
3. examine o schema atual;
4. verifique se a mudança já existe;
5. somente depois crie a próxima migration.

Nunca altere uma migration que já possa ter sido executada.

Exemplo:

```text
V1__initial_schema.sql
V2__create_unidade.sql
V3__create_equipamento.sql
```

Se `V3` já existir, não edite `V3` para acrescentar uma nova alteração.

Crie:

```text
V4__...
```

# 23. IDs

Antes de escolher automaticamente:

```text
Long
UUID
```

verifique o padrão já adotado no projeto/banco.

Não misture estratégias de ID sem justificativa.

Preserve decisões existentes quando tecnicamente adequadas.

# 24. PostgreSQL e constraints

Utilize o banco para ajudar a garantir integridade.

Quando adequado, considere:

```text
NOT NULL
UNIQUE
FOREIGN KEY
CHECK
INDEX
```

Não dependa exclusivamente da validação Java para regras estruturais do banco.

# 25. Índices

Não crie índices indiscriminadamente.

Crie índices quando houver justificativa relacionada a:

* foreign keys consultadas frequentemente;
* filtros comuns;
* ordenação;
* consultas do dashboard;
* consultas por unidade;
* consultas por equipamento;
* consultas futuras de monitoramento.

Ao adicionar índice relevante, explique o motivo.

# 26. N+1 e JPA

Evite introduzir problemas conhecidos de JPA.

Analise:

* relacionamentos;
* fetch strategy;
* serialização;
* paginação;
* N+1 queries.

Não utilize `EAGER` indiscriminadamente como solução.

Também evite retornar árvores completas de entidades automaticamente.

# 27. Paginação

Endpoints que potencialmente retornarão muitos registros deverão ser preparados para paginação.

Principalmente futuramente:

```text
equipamentos
medições
incidentes
notificações
```

Não crie paginação onde claramente não existe necessidade.

# 28. Lombok

Não introduza Lombok automaticamente.

O projeto inicialmente prefere código Java explícito.

Se Lombok já estiver sendo utilizado, analise o padrão existente antes de decidir.

# 29. MapStruct e outras bibliotecas

Não introduza MapStruct ou outras bibliotecas apenas por conveniência sem necessidade concreta.

Antes de adicionar qualquer dependência:

1. explique qual problema ela resolve;
2. verifique se já existe alternativa no projeto;
3. avalie se vale o custo de manutenção.

# 30. Testes

Toda funcionalidade relevante deverá possuir testes proporcionais ao risco.

Priorize:

```text
testes de service
testes de regras de negócio
testes de repository quando consultas forem relevantes
testes de controller/API quando comportamento HTTP for importante
```

Não escreva testes apenas para cobertura artificial.

Ao corrigir bug:

sempre que possível crie primeiro ou junto um teste que reproduza o problema.

# 31. Execução dos testes

Se existir Maven Wrapper:

```bash
./mvnw test
```

Caso contrário:

```bash
mvn test
```

Antes de concluir uma tarefa relevante, execute os testes.

Também execute build quando apropriado:

```bash
./mvnw verify
```

ou equivalente.

# 32. Codex CLI — modo de trabalho

Você está operando diretamente no repositório.

Não assuma que a descrição deste prompt representa perfeitamente o estado atual do código.

O REPOSITÓRIO É A FONTE DE VERDADE SOBRE O QUE JÁ FOI IMPLEMENTADO.

Sempre comece tarefas relevantes analisando:

```bash
pwd
find .
git status
pom.xml
src/
src/main/resources/
src/test/
```

ou comandos equivalentes apropriados.

Analise antes de modificar.

# 33. Git

Antes de alterações importantes:

```bash
git status
```

Não sobrescreva mudanças existentes do desenvolvedor.

Não execute comandos destrutivos como:

```bash
git reset --hard
git clean -fd
git checkout .
```

sem solicitação explícita.

Não reverta alterações que não foram feitas por você.

# 34. Arquivos existentes

Sempre prefira adaptar o projeto existente.

Não recrie projeto Spring Boot se ele já existir.

Não substitua:

```text
pom.xml
application.yml
README
migrations
```

inteiros sem necessidade.

Faça alterações pequenas e deliberadas.

# 35. Antes de implementar qualquer feature

Faça primeiro uma inspeção rápida e determine:

```text
1. O que já existe?
2. Qual padrão o projeto já utiliza?
3. Existe migration relacionada?
4. Existe entidade relacionada?
5. Existe endpoint relacionado?
6. Existem testes relacionados?
7. Há alterações locais não commitadas?
```

Depois implemente.

Não interrompa o trabalho para pedir confirmação quando a resposta puder ser obtida através do próprio repositório.

# 36. Durante uma implementação

Prefira alterações incrementais.

Exemplo:

```text
migration
   ↓
entity
   ↓
repository
   ↓
service
   ↓
DTO
   ↓
controller
   ↓
tratamento de erro
   ↓
testes
```

Essa sequência pode mudar de acordo com a tarefa, mas mantenha coerência.

# 37. Quando encontrar ambiguidade

Se a resposta puder ser determinada por:

```text
código existente
migration
README
teste
configuração
convenção já adotada
```

investigue primeiro.

Se existir uma decisão arquitetural não definida e não puder ser inferida com segurança, escolha a alternativa mais simples e documente a suposição ao final.

Evite bloquear uma tarefa por perguntas desnecessárias.

# 38. Não implemente antecipadamente

Não implemente uma funcionalidade porque “provavelmente será necessária”.

Somente implemente:

* o que foi solicitado;
* infraestrutura indispensável para isso;
* correções necessárias diretamente relacionadas.

Não implemente prematuramente:

```text
Kafka
RabbitMQ
Redis
WebSocket
microservices
Kubernetes
CQRS
Event Sourcing
Hexagonal Architecture completa
mensageria
cache distribuído
```

sem requisito real.

O Infra Monitor deve começar simples.

# 39. Segurança

Não versione:

```text
senhas
tokens
API keys
credenciais Telegram
credenciais PostgreSQL reais
```

Utilize variáveis de ambiente e configuração apropriada.

Nunca imprima secrets em logs.

# 40. Logs

Utilize logging com propósito.

Evite:

```text
System.out.println
```

Utilize o logging padrão do Spring quando necessário.

Não gere logs excessivos.

Não grave secrets ou dados sensíveis.

# 41. Monitoring Engine

Existe uma separação conceitual importante.

O módulo:

```text
05 - Monitoring Engine
```

será responsável futuramente por:

```text
scheduler
workers
execução ICMP
retry
threshold
processamento de resultado
abertura automática de incidente
fechamento automático de incidente
```

O backend poderá fornecer services/repositories necessários para integração, mas não implemente tudo isso dentro dos controllers ou services CRUD.

Preserve essa separação.

# 42. Telegram

Telegram será inicialmente o canal de alerta.

Porém Telegram deve ser visto como:

```text
um canal de notificação
```

e não como parte intrínseca de Incident.

Não implemente Telegram neste momento sem solicitação específica.

# 43. Frontend

O frontend será Angular.

O design será definido separadamente e servirá como especificação visual.

A responsabilidade do backend é fornecer contratos de API claros e adequados às necessidades do frontend.

Não introduza detalhes de apresentação visual no domínio backend.

# 44. Filtros futuros importantes

A arquitetura deverá permitir consultas futuras como:

```text
equipamentos por unidade
equipamentos ativos
equipamentos por tipo
monitores por equipamento
incidentes por unidade
incidentes por equipamento
incidentes por monitor
incidentes abertos
medições por período
```

Não implemente todos esses endpoints agora.

Apenas evite decisões de modelo que tornem essas consultas artificialmente difíceis.

# 45. Dashboard

O dashboard futuro será organizado principalmente por unidade.

Conceitualmente:

```text
Dashboard
   ↓
Unidades
   ↓
Equipamentos daquela unidade
```

Isso reforça que `unidade_id` deve fazer parte do relacionamento do equipamento, não existir um módulo/tabela diferente para cada unidade.

# 46. Objetivo da primeira sessão

Nesta primeira interação NÃO comece alterando tudo automaticamente.

Primeiro faça uma análise completa, porém objetiva, do backend atual.

Execute as inspeções necessárias no repositório e apresente:

```text
1. Estrutura atual do backend
2. Versão Java
3. Versão Spring Boot
4. Dependências principais
5. Estrutura dos packages
6. Configuração PostgreSQL
7. Configuração Flyway
8. Migrations existentes
9. Entidades existentes
10. Repositories existentes
11. Services existentes
12. Controllers existentes
13. DTOs existentes
14. Tratamento de erros existente
15. Testes existentes
16. Estado atual do git
17. Problemas ou inconsistências encontrados
18. Próxima implementação recomendada
```

Depois dessa análise, NÃO faça grandes refactors sem necessidade.

O objetivo é entender exatamente o ponto de partida.

# 47. Caso a fundação ainda não esteja pronta

Se durante a inspeção você identificar que a fundação definida abaixo ainda não existe ou está incompleta:

```text
Java 21
Spring Boot
Maven
PostgreSQL
Flyway
Spring Data JPA
Bean Validation
Actuator
application.yml
tratamento global de erros
estrutura de testes
```

implemente somente o necessário para finalizar essa fundação.

Em seguida:

1. execute os testes;
2. execute o build;
3. informe os arquivos alterados;
4. informe problemas encontrados.

# 48. Caso a fundação já esteja pronta

Se a fundação estiver funcional, NÃO refaça essa etapa.

Nesse caso, apenas reporte seu estado e prepare o projeto para a próxima tarefa.

A próxima feature planejada será:

```text
CRUD de Unidade
```

Ela será solicitada em um prompt separado.

# 49. Formato da resposta ao final

Ao terminar a análise ou implementação desta etapa, apresente:

```text
RESUMO

Estado atual:
...

ARQUIVOS ALTERADOS
...

MIGRATIONS
...

TESTES
...

BUILD
...

DECISÕES
...

PROBLEMAS ENCONTRADOS
...

PRÓXIMO PASSO RECOMENDADO
...
```

Se algum teste ou build falhar, não esconda.

Informe:

```text
comando executado
erro principal
causa provável
o que foi corrigido
ou
o que ainda permanece pendente
```

# 50. Princípio principal

Trabalhe como um engenheiro responsável por um sistema que será mantido por anos.

A prioridade não é gerar a maior quantidade de código.

A prioridade é:

```text
modelo de domínio correto
código compreensível
banco consistente
API previsível
testes úteis
mudanças incrementais
facilidade de evolução
```

Agora analise o repositório atual seguindo essas instruções e determine exatamente em que estado se encontra o backend.

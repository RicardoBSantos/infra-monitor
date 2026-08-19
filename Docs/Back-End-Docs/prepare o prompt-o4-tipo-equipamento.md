# Prompt 04 — Implementação do módulo Tipo de Equipamento

Com base no contexto já assimilado a partir do arquivo `codexcontex.md`, e considerando o estado atual do repositório após a implementação do módulo `Unidade`, prossiga agora com a próxima feature de domínio do backend:

# TIPO DE EQUIPAMENTO

Antes de alterar qualquer arquivo:

1. leia novamente os trechos relevantes do `codexcontex.md`, caso necessário;
2. analise o estado atual do repositório;
3. verifique como o módulo `Unidade` foi implementado;
4. reutilize os padrões consolidados em `Unidade` quando forem tecnicamente adequados;
5. não copie cegamente estrutura ou código se houver oportunidade clara de manter a implementação mais simples;
6. não faça refactors amplos que não sejam necessários para esta tarefa.

O objetivo desta etapa é implementar o domínio `Tipo de Equipamento`, que será utilizado posteriormente pelo módulo `Equipamento`.

---

# 1. Objetivo funcional

`Tipo de Equipamento` representa a classificação de um equipamento da infraestrutura.

Exemplos:

```text
Switch
Router
Firewall
Servidor
Access Point
Impressora
NVR
DVR
Câmera
Outro
```

Essa classificação deve ser persistida em banco e administrável via API.

Não implemente como `enum` Java.

O objetivo é permitir que novos tipos sejam cadastrados posteriormente sem necessidade de alterar ou recompilar o backend.

---

# 2. Relação futura com Equipamento

O modelo futuro será:

```text
Unidade 1 ---- N Equipamento N ---- 1 TipoEquipamento
```

Conceitualmente:

```text
UNIDADE
   |
   +---- EQUIPAMENTO ---- TIPO_EQUIPAMENTO
```

Cada equipamento deverá possuir obrigatoriamente:

```text
unidade_id
tipo_equipamento_id
```

Porém:

**NÃO implemente `Equipamento` nesta etapa.**

Também não adicione relacionamentos JPA antecipados com uma entidade `Equipamento` inexistente.

---

# 3. Escopo funcional

O backend deverá permitir:

```text
Criar tipo de equipamento
Consultar tipo de equipamento por ID
Listar tipos de equipamento
Atualizar tipo de equipamento
Ativar tipo de equipamento
Desativar tipo de equipamento
Excluir fisicamente quando permitido
```

O fluxo normal para tipos que não devem mais ser usados deve ser:

```text
ativo = false
```

A exclusão física deve existir como operação administrativa.

No futuro, quando `Equipamento` estiver relacionado a `TipoEquipamento`, a integridade referencial deverá impedir exclusão física de tipos utilizados, ou a regra de negócio deverá tratar isso adequadamente.

Não implemente antecipadamente essa lógica de Equipamento nesta tarefa.

---

# 4. Modelo de dados

Antes de escolher qualquer estratégia de ID:

* observe o padrão já adotado em `Unidade`;
* preserve o mesmo tipo de ID;
* não misture `Long`, `UUID` ou outras estratégias sem justificativa.

A entidade `TipoEquipamento` deverá possuir, no mínimo:

```text
id
nome
descricao
ativo
createdAt
updatedAt
```

---

# 5. Campo nome

`nome` é obrigatório.

Não aceitar:

```text
null
""
"   "
```

Defina tamanho máximo coerente com o padrão utilizado em `Unidade`.

O nome deve ser único.

A política de unicidade deve seguir a mesma decisão tomada no módulo `Unidade`.

Se `Unidade` utiliza unicidade case-insensitive, faça o mesmo aqui.

Exemplo:

```text
Switch
switch
SWITCH
```

devem ser tratados como o mesmo tipo quando a política for case-insensitive.

Não crie uma política diferente sem justificativa.

A unicidade deve ser garantida por:

```text
regra na aplicação
+
constraint no banco
```

quando tecnicamente aplicável.

---

# 6. Campo descricao

`descricao` é opcional.

Deve possuir limite de tamanho apropriado e coerente entre Java e banco.

Exemplos:

```text
"Equipamento responsável pela comutação da rede local"
"Equipamento de borda e roteamento"
```

Não torne descrição obrigatória.

---

# 7. Campo ativo

`ativo` é obrigatório.

Ao criar um novo tipo:

```text
ativo = true
```

por padrão.

O cliente não precisa informar `ativo` no request de criação.

A ativação/desativação deve possuir operações explícitas.

---

# 8. Datas

A entidade deverá possuir:

```text
createdAt
updatedAt
```

Siga exatamente a estratégia adotada no projeto e, especialmente, no módulo `Unidade`.

Se `Unidade` utiliza `Instant`, mantenha `Instant`.

Garanta:

```text
createdAt
```

é definido na criação e não é alterado em updates.

E:

```text
updatedAt
```

é atualizado quando a entidade é modificada.

Não introduza `BaseEntity`, auditoria genérica ou infraestrutura abstrata apenas para reaproveitar dois campos.

Se já existir uma infraestrutura de auditoria consolidada no projeto, reutilize-a.

---

# 9. Banco de dados

Utilize Flyway.

Antes de criar qualquer migration:

1. liste todas as migrations existentes;
2. descubra a versão mais recente;
3. verifique se a tabela de tipo de equipamento já existe;
4. verifique convenções de nomes de tabela;
5. verifique convenções de nomes de colunas;
6. observe como `Unidade` foi criada.

Somente depois crie a próxima migration necessária.

Exemplo conceitual:

```text
Vx__create_tipo_equipamento.sql
```

Não presuma número de versão.

Descubra-o a partir do repositório.

Nunca altere migration histórica que já possa ter sido aplicada.

---

# 10. Nome da tabela

Siga o padrão já estabelecido no banco.

Se `Unidade` utiliza singular, mantenha singular.

Se utiliza plural, mantenha plural.

Exemplos possíveis:

```text
tipo_equipamento
```

ou:

```text
tipos_equipamento
```

Não crie um terceiro padrão de nomenclatura.

---

# 11. Migration

A migration deverá criar a tabela com constraints apropriadas.

Conceitualmente:

```text
id
nome
descricao
ativo
created_at
updated_at
```

Considere:

```text
PRIMARY KEY
NOT NULL
UNIQUE
CHECK
```

quando pertinente.

Garanta compatibilidade com:

```text
spring.jpa.hibernate.ddl-auto=validate
```

Hibernate não deve criar ou modificar a tabela.

---

# 12. Seeds iniciais

Não insira automaticamente todos os tipos abaixo apenas porque são exemplos:

```text
Switch
Router
Firewall
Servidor
Access Point
Impressora
NVR
DVR
Câmera
Outro
```

Primeiro verifique a estratégia de dados iniciais do projeto.

Se não existir requisito explícito para seeds, a preferência nesta etapa é:

```text
não criar seeds
```

A API será responsável pelo cadastro dos tipos.

Caso o repositório já possua uma estratégia oficial de dados iniciais e os tipos façam sentido nela, siga o padrão existente e documente a decisão.

---

# 13. Entidade JPA

Crie a entidade `TipoEquipamento`.

Sugestão conceitual de localização:

```text
br.com.inframonitor.tipoequipamento.entity.TipoEquipamento
```

ou outra localização coerente com a estrutura atual.

Antes de criar package, observe os nomes reais utilizados pelo projeto.

Não introduza uma convenção diferente da utilizada em `Unidade`.

Utilize corretamente:

```text
@Entity
@Table
@Id
@Column
```

Mapeie explicitamente constraints relevantes quando isso melhorar clareza.

Não exponha a entidade diretamente através da API.

---

# 14. Nome do módulo/package

Escolha um nome consistente e simples.

Possíveis opções:

```text
tipoequipamento
```

ou:

```text
tipo_equipamento
```

Para package Java, prefira nome válido e alinhado ao padrão existente.

Não use underscore em package Java se o projeto não usa.

Exemplo preferível:

```text
br.com.inframonitor.tipoequipamento
```

Mas o código existente é a referência final.

---

# 15. Repository

Crie um Spring Data repository para `TipoEquipamento`.

Inclua apenas métodos necessários para esta feature.

Provavelmente serão necessários comportamentos para:

```text
buscar por ID
listar
verificar nome existente
verificar nome existente excluindo o próprio ID durante update
filtrar por ativo, se necessário
ordenar por nome
```

Não crie consultas antecipadas para Equipamento.

Não crie repository genérico.

---

# 16. DTOs

Não exponha entidade JPA diretamente.

Crie DTOs seguindo o padrão adotado em `Unidade`.

Sugestão:

```text
CreateTipoEquipamentoRequest
UpdateTipoEquipamentoRequest
TipoEquipamentoResponse
```

Se o projeto adotou records, classes tradicionais ou outra abordagem em `Unidade`, preserve a mesma convenção.

---

# 17. CreateTipoEquipamentoRequest

Entrada conceitual:

```json
{
  "nome": "Switch",
  "descricao": "Equipamento de comutação de rede"
}
```

Não permita que o cliente informe:

```text
id
createdAt
updatedAt
```

`ativo` deve iniciar como `true`.

---

# 18. UpdateTipoEquipamentoRequest

Permita editar:

```text
nome
descricao
```

Não permita alteração de:

```text
id
createdAt
updatedAt
```

através do request.

Também não utilize o update genérico para alterar `ativo`.

A ativação/desativação deve ocorrer pelos endpoints específicos.

---

# 19. TipoEquipamentoResponse

Retorne pelo menos:

```text
id
nome
descricao
ativo
createdAt
updatedAt
```

Siga o padrão JSON adotado no projeto.

---

# 20. Bean Validation

Utilize Bean Validation nos DTOs de entrada.

No mínimo, considere:

```java
@NotBlank
@Size
```

Use limites compatíveis com o banco.

Não dependa exclusivamente do PostgreSQL para retornar erro de entrada inválida.

---

# 21. Service

Implemente camada de service.

Responsabilidades esperadas:

```text
create
findById
list
update
activate
deactivate
delete
```

Adapte nomes ao padrão existente.

Regras de negócio devem permanecer no service.

O controller não deve acessar repository diretamente quando houver regra de negócio.

Fluxo esperado:

```text
Controller
    ↓
Service
    ↓
Repository
```

---

# 22. Nome duplicado

Impeça criação de tipo com nome duplicado.

Exemplo:

```text
Switch
```

já existente.

Uma nova tentativa deverá gerar conflito apropriado.

Também impeça:

```text
PUT /api/v1/tipos-equipamento/{id}
```

de alterar o nome para um nome utilizado por outro registro.

Não considere o próprio registro como duplicado durante update.

Exemplo:

```text
id = 10
nome atual = Switch
```

Atualizar apenas a descrição mantendo:

```text
nome = Switch
```

deve funcionar.

---

# 23. Concorrência e constraint

A validação no service melhora o feedback da API, mas não substitui a constraint do banco.

Garanta que duplicidade também seja protegida pelo PostgreSQL.

Se houver corrida concorrente entre duas requisições, a integridade do banco deve ser preservada.

Integre a violação de constraint ao padrão de tratamento de erros existente, quando necessário.

Não exponha mensagem SQL crua ao cliente.

---

# 24. Recurso inexistente

Quando um tipo não existir:

```text
GET /api/v1/tipos-equipamento/{id}
```

deve retornar:

```text
404 Not Found
```

O mesmo comportamento deve se aplicar às operações de:

```text
PUT
PATCH ativar
PATCH desativar
DELETE
```

Reutilize exceptions e tratamento global existentes sempre que possível.

Não crie nova hierarquia de exceptions se já houver uma solução adequada.

---

# 25. Conflitos

Nome duplicado deve retornar, preferencialmente:

```text
409 Conflict
```

Siga o comportamento já implementado em `Unidade`.

Consistência entre os módulos é mais importante do que introduzir um novo padrão.

---

# 26. Endpoints

Implemente os seguintes endpoints, salvo se o projeto já tiver convenção equivalente consolidada:

```text
POST   /api/v1/tipos-equipamento
GET    /api/v1/tipos-equipamento
GET    /api/v1/tipos-equipamento/{id}
PUT    /api/v1/tipos-equipamento/{id}
PATCH  /api/v1/tipos-equipamento/{id}/ativar
PATCH  /api/v1/tipos-equipamento/{id}/desativar
DELETE /api/v1/tipos-equipamento/{id}
```

Se optar por outro nome de rota, deve haver justificativa baseada no padrão atual da aplicação.

Evite abreviações como:

```text
/api/v1/tipos-eq
```

---

# 27. POST

Endpoint:

```text
POST /api/v1/tipos-equipamento
```

Exemplo de request:

```json
{
  "nome": "Firewall",
  "descricao": "Equipamento de segurança de borda"
}
```

Sucesso:

```text
201 Created
```

Retorne o recurso criado.

Se o módulo `Unidade` usa header `Location`, mantenha o mesmo padrão.

---

# 28. GET por ID

Endpoint:

```text
GET /api/v1/tipos-equipamento/{id}
```

Sucesso:

```text
200 OK
```

Não encontrado:

```text
404 Not Found
```

---

# 29. Listagem

Endpoint:

```text
GET /api/v1/tipos-equipamento
```

A quantidade de tipos tende a ser pequena.

Não introduza paginação complexa sem necessidade.

Siga a estratégia utilizada em `Unidade`.

A listagem deve possuir ordem determinística.

Preferencialmente:

```text
nome ASC
```

ou o padrão já estabelecido no projeto.

---

# 30. Filtro por ativo

Se `Unidade` já implementou filtro semelhante, preserve a mesma convenção.

Exemplos:

```text
GET /api/v1/tipos-equipamento?ativo=true
GET /api/v1/tipos-equipamento?ativo=false
```

Sem parâmetro:

```text
GET /api/v1/tipos-equipamento
```

deve retornar todos.

Se o módulo `Unidade` deliberadamente não possui esse filtro, avalie a consistência antes de adicioná-lo apenas aqui.

A preferência é manter comportamento uniforme entre cadastros administrativos semelhantes.

---

# 31. PUT

Endpoint:

```text
PUT /api/v1/tipos-equipamento/{id}
```

Permita atualizar:

```text
nome
descricao
```

Não altere automaticamente:

```text
ativo
```

Retorne:

```text
200 OK
```

com o recurso atualizado.

---

# 32. Ativação

Endpoint:

```text
PATCH /api/v1/tipos-equipamento/{id}/ativar
```

Deve definir:

```text
ativo = true
```

A operação deve ser idempotente.

Se já estiver ativo, não deve falhar apenas por isso.

---

# 33. Desativação

Endpoint:

```text
PATCH /api/v1/tipos-equipamento/{id}/desativar
```

Deve definir:

```text
ativo = false
```

A operação deve ser idempotente.

Não implemente agora regra relacionada à existência de equipamentos usando esse tipo, pois `Equipamento` ainda será implementado.

---

# 34. DELETE

Endpoint:

```text
DELETE /api/v1/tipos-equipamento/{id}
```

Sucesso:

```text
204 No Content
```

Se não existir:

```text
404 Not Found
```

No futuro, se houver equipamentos vinculados, a exclusão física deverá respeitar integridade referencial.

Não antecipe uma dependência artificial com `Equipamento`.

---

# 35. Controller

Mantenha controller fino.

Responsabilidades:

```text
receber request
validar
delegar para service
montar resposta HTTP
```

Não coloque lógica de unicidade, acesso a banco ou manipulação direta da entidade no controller.

---

# 36. Mapper

Siga a estratégia utilizada em `Unidade`.

Se o projeto usa mapeamento manual simples, continue assim.

Não introduza MapStruct apenas para `TipoEquipamento`.

Não crie uma infraestrutura genérica de mapper.

---

# 37. Tratamento global de erros

Reutilize o tratamento global de erros já existente.

Garanta comportamento consistente para:

```text
400 Bad Request
404 Not Found
409 Conflict
500 Internal Server Error
```

Não exponha:

```text
stack trace
SQL
nome de constraint interna
detalhes de Hibernate
```

para clientes da API.

---

# 38. Testes de service

Implemente testes úteis.

No mínimo, cubra cenários equivalentes a:

```text
criar tipo com sucesso
impedir nome duplicado
buscar tipo existente
buscar tipo inexistente
atualizar tipo
manter o mesmo nome no próprio update
impedir update usando nome de outro tipo
ativar tipo
desativar tipo
excluir tipo
```

Não crie testes artificiais apenas para aumentar cobertura.

---

# 39. Testes de controller/API

Cubra os principais contratos HTTP.

Cenários esperados:

```text
POST válido -> 201
POST inválido -> 400
POST duplicado -> 409

GET existente -> 200
GET inexistente -> 404

GET lista -> 200

PUT válido -> 200
PUT duplicado -> 409

PATCH ativar -> sucesso
PATCH desativar -> sucesso

DELETE existente -> 204
DELETE inexistente -> 404
```

Siga a infraestrutura de testes já adotada em `Unidade`.

---

# 40. Repository tests

Crie testes de repository apenas se houver comportamento que realmente precise ser validado.

Exemplos:

```text
unicidade case-insensitive
consulta customizada
filtro ativo
```

Se for CRUD trivial já coberto pelo framework, não crie teste apenas por formalidade.

---

# 41. Banco nos testes

Preserve a estratégia existente.

Se o projeto utiliza:

```text
PostgreSQL
Testcontainers
H2
```

não altere sem necessidade.

Se houver comportamento PostgreSQL-específico para unicidade case-insensitive, certifique-se de que o teste utilizado realmente valide esse comportamento.

Não introduza H2 como atalho se isso gerar resultado diferente do PostgreSQL de produção.

---

# 42. Consistência com Unidade

Esta feature deve consolidar um padrão para os cadastros administrativos.

Compare explicitamente com o módulo `Unidade` em:

```text
estrutura de package
nomes de DTO
status HTTP
formato de erro
timestamps
validação
service
repository
endpoints de ativação/desativação
testes
```

Onde `Unidade` estiver bem estruturado, reaproveite o padrão.

Se identificar um pequeno problema em `Unidade` que impeça consistência ou reutilização, faça somente a correção mínima indispensável e documente.

Não transforme esta tarefa em um refactor completo do módulo `Unidade`.

---

# 43. Não criar abstração genérica agora

Pode haver bastante semelhança entre:

```text
Unidade
TipoEquipamento
```

Mesmo assim, NÃO crie automaticamente:

```text
BaseCadastro
BaseEntity
BaseCrudService
BaseCrudController
GenericRepository
AbstractNamedEntity
```

Dois módulos semelhantes ainda não justificam necessariamente uma abstração.

Prefira alguma duplicação simples e legível a uma abstração prematura.

A abstração pode ser reconsiderada quando houver vários domínios realmente repetindo o mesmo comportamento.

---

# 44. Integração futura com Equipamento

Ao finalizar, `TipoEquipamento` deve estar pronto para ser referenciado posteriormente por:

```text
Equipamento.tipoEquipamento
```

Mas não adicione:

```java
@OneToMany(mappedBy = "tipoEquipamento")
```

nesta etapa apenas por antecipação.

O relacionamento será definido quando o módulo `Equipamento` for implementado.

---

# 45. Não implementar Monitor aqui

Não confunda:

```text
TipoEquipamento
```

com:

```text
TipoMonitor
```

Exemplo:

```text
Tipo do equipamento:
Switch
```

Enquanto futuramente:

```text
Tipo do monitor:
ICMP
```

São conceitos completamente diferentes.

Não crie enum ou campo ICMP em `TipoEquipamento`.

---

# 46. Não implementar nesta etapa

NÃO implemente:

```text
Equipamento
Monitor
TipoMonitor
Medição
ICMP
Scheduler
Workers
Incidente
Notificação
Telegram
Dashboard
Relatórios
Usuário
JWT
Roles
Angular
```

Esta tarefa deve permanecer restrita a:

```text
TIPO DE EQUIPAMENTO
```

e à infraestrutura mínima diretamente necessária.

---

# 47. Segurança e configuração

Não adicione secrets.

Não altere configurações de banco desnecessariamente.

Não modifique:

```text
DB_PASSWORD
Telegram token
credenciais
```

ou outras configurações não relacionadas.

---

# 48. README / documentação

Se o projeto documenta endpoints no README, adicione os endpoints de `TipoEquipamento` seguindo o mesmo nível de detalhe utilizado para `Unidade`.

Se não há documentação de endpoints no README, não crie uma seção enorme apenas para esta feature.

Se OpenAPI já estiver configurado, siga o padrão existente.

Não adicione Swagger/OpenAPI como nova dependência nesta tarefa.

---

# 49. Inspeção antes de alterar

Antes de implementar, execute no mínimo:

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

Localize especificamente os arquivos do módulo `Unidade`.

Use-os como referência arquitetural, não como código a ser copiado cegamente.

---

# 50. Implementação incremental

Prefira uma sequência de trabalho semelhante a:

```text
1. inspecionar migrations
2. criar migration necessária
3. criar entidade
4. criar repository
5. criar DTOs
6. criar service
7. criar controller
8. integrar tratamento de erro
9. criar testes
10. executar testes
11. executar build
12. revisar git diff
```

Adapte a ordem quando tecnicamente necessário.

---

# 51. Validação do schema

Como o projeto usa Flyway e JPA com validação, certifique-se de que:

```text
migration
```

e:

```text
entity
```

possuem tipos e constraints compatíveis.

Verifique especialmente:

```text
tamanho de varchar
nullable
nome das colunas
tipo do ID
tipo dos timestamps
default de ativo
```

Não deixe inconsistências que façam `ddl-auto=validate` falhar.

---

# 52. Git

Antes das alterações:

```bash
git status
```

Depois das alterações:

```bash
git status
git diff
```

Não sobrescreva alterações locais do desenvolvedor.

Não execute:

```bash
git reset --hard
git clean -fd
git checkout .
```

Não execute:

```bash
git commit
git push
```

A revisão e o commit serão feitos posteriormente.

---

# 53. Testes finais

Se houver Maven Wrapper:

```bash
./mvnw test
```

Depois:

```bash
./mvnw verify
```

Caso contrário:

```bash
mvn test
mvn verify
```

Se os testes falharem:

1. analise a causa;
2. corrija problemas relacionados à sua implementação;
3. execute novamente;
4. reporte qualquer falha restante.

Não marque como concluído se não tiver executado os comandos disponíveis.

---

# 54. Revisão própria

Antes da resposta final, execute:

```bash
git diff
```

Revise:

```text
imports não utilizados
mudanças fora do escopo
DTO expondo entidade
controller acessando repository
duplicação desnecessária
constraint ausente
validação Java incompatível com banco
mensagens de erro inconsistentes
código morto
TODOs
secrets
```

Corrija problemas encontrados quando estiverem dentro do escopo.

---

# 55. Critérios de aceite

A tarefa estará concluída quando:

* existir migration válida para `TipoEquipamento`, quando necessária;
* a aplicação iniciar com validação JPA;
* for possível criar um tipo;
* nome inválido retornar 400;
* nome duplicado retornar conflito adequado;
* for possível consultar por ID;
* inexistente retornar 404;
* for possível listar tipos;
* for possível atualizar nome e descrição;
* for possível ativar;
* for possível desativar;
* for possível excluir fisicamente;
* entidade JPA não for exposta diretamente;
* testes relevantes estiverem implementados;
* testes estiverem passando;
* build estiver passando;
* nenhuma feature de `Equipamento` tiver sido implementada antecipadamente.

---

# 56. Resposta final

Ao concluir, apresente:

```text
RESUMO

Explique objetivamente o que foi implementado.


CONTEXTO UTILIZADO

- codexcontex.md
- módulo Unidade existente
- migrations existentes


ESTADO ANTES DA IMPLEMENTAÇÃO

Explique o que já existia relacionado ao domínio.


ENDPOINTS

POST   /api/v1/tipos-equipamento
GET    /api/v1/tipos-equipamento
GET    /api/v1/tipos-equipamento/{id}
PUT    /api/v1/tipos-equipamento/{id}
PATCH  /api/v1/tipos-equipamento/{id}/ativar
PATCH  /api/v1/tipos-equipamento/{id}/desativar
DELETE /api/v1/tipos-equipamento/{id}


ARQUIVOS CRIADOS

...


ARQUIVOS ALTERADOS

...


MIGRATION

Arquivo:
...

Versão:
...

Estrutura criada:
...


MODELO

Campos:
...

Constraints:
...


REGRAS DE NEGÓCIO

...


TRATAMENTO DE ERROS

...


CONSISTÊNCIA COM UNIDADE

Explique quais padrões foram reutilizados.


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

Resumo:
...


DECISÕES TÉCNICAS

...


DIVERGÊNCIAS DA ESPECIFICAÇÃO

Nenhuma.

ou:

- divergência:
- decisão adotada:
- justificativa:


PENDÊNCIAS

...


PRÓXIMO PASSO RECOMENDADO

Apenas indique o próximo módulo.

Não implemente o próximo módulo.
```

---

# 57. Princípio principal desta etapa

O objetivo não é apenas criar mais um CRUD.

`TipoEquipamento` deve consolidar os padrões estabelecidos por `Unidade` e preparar corretamente o domínio para a próxima relação:

```text
Unidade
    ↓
Equipamento
    ↑
TipoEquipamento
```

Mantenha:

```text
simplicidade
consistência
integridade do banco
contratos REST claros
testes úteis
baixo acoplamento
```

Não faça abstrações prematuras apenas porque `Unidade` e `TipoEquipamento` possuem estruturas semelhantes.

Agora analise o repositório, use `Unidade` como referência arquitetural e implemente integralmente o módulo `TipoEquipamento`.

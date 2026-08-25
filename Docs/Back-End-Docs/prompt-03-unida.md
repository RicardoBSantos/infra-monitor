Com base no contexto já assimilado a partir do arquivo `codexcontex.md` e na análise realizada anteriormente do repositório, prossiga agora com a implementação da primeira feature de domínio do backend:

# CRUD DE UNIDADE

Antes de alterar qualquer arquivo, releia apenas os trechos relevantes do `codexcontex.md` caso necessário e confirme o estado atual do código relacionado a:

* migrations;
* entidades;
* tratamento global de erros;
* convenções de DTO;
* padrão de packages;
* testes;
* configuração JPA/Flyway.

Não recrie estruturas que já existam.

## 1. Objetivo

Implementar o módulo de gerenciamento de Unidades do Infra Monitor.

Uma Unidade representa uma unidade física ou organizacional da empresa.

Exemplos:

```text
Matriz
Filial Recife
Filial São Paulo
CD Nordeste
```

No futuro, cada equipamento pertencerá obrigatoriamente a uma unidade.

Relacionamento futuro:

```text
Unidade 1 ---- N Equipamentos
```

Nesta etapa, NÃO implemente Equipamento ainda.

## 2. Escopo funcional

O backend deverá permitir:

```text
Criar unidade
Consultar unidade por ID
Listar unidades
Atualizar unidade
Ativar/desativar unidade
Excluir unidade fisicamente quando permitido
```

A desativação deve ser o mecanismo normal para retirar uma unidade de uso.

A exclusão física deve existir como operação administrativa, mas deve respeitar integridade referencial quando equipamentos forem adicionados futuramente.

## 3. Modelo de Unidade

Antes de implementar, verifique o padrão de IDs já existente no projeto.

Não escolha `Long` ou `UUID` arbitrariamente se o projeto já tiver uma convenção.

A entidade Unidade deverá possuir, no mínimo:

```text
id
nome
descricao
ativo
createdAt
updatedAt
```

Regras:

### nome

Obrigatório.

Não aceitar:

```text
null
""
"   "
```

Defina um limite de tamanho razoável e consistente tanto no Java quanto no banco.

O nome deve ser único.

Avalie se a unicidade deve considerar case-insensitive no PostgreSQL.

Caso implemente unicidade case-insensitive, faça isso de forma consistente no banco e na aplicação.

### descricao

Opcional.

Possui limite de tamanho adequado.

### ativo

Obrigatório.

Ao criar uma unidade:

```text
ativo = true
```

por padrão.

### createdAt

Timestamp de criação.

Não deve ser informado pelo cliente.

### updatedAt

Timestamp da última alteração.

Não deve ser informado pelo cliente.

Utilize a estratégia de datas definida no `codexcontex.md`.

Prefira `Instant` para timestamps absolutos.

## 4. Banco de dados

Utilize Flyway.

Antes de criar nova migration:

1. liste as migrations existentes;
2. identifique a versão mais recente;
3. verifique se a tabela de unidade já existe;
4. verifique convenções de nomenclatura já utilizadas.

Se a tabela ainda não existir, crie a próxima migration disponível.

Exemplo conceitual:

```text
Vx__create_unidade_table.sql
```

Não assuma que será V1, V2 etc.

Descubra a próxima versão correta.

A tabela deverá possuir constraints adequadas.

Considere:

```text
PRIMARY KEY
NOT NULL
UNIQUE
CHECK quando pertinente
```

O schema deverá ser compatível com:

```text
spring.jpa.hibernate.ddl-auto=validate
```

Não utilize Hibernate para criar a tabela.

## 5. Nome da tabela

Siga o padrão de nomenclatura já existente no banco.

Se ainda não houver padrão definido, utilize um nome simples e consistente, por exemplo:

```text
unidade
```

ou

```text
unidades
```

Escolha apenas um padrão e mantenha consistência.

Não renomeie tabelas existentes sem necessidade.

## 6. Entidade JPA

Crie a entidade no módulo de Unidade conforme a arquitetura existente.

Exemplo conceitual:

```text
br.com.inframonitor.unidade.entity.Unidade
```

Não exponha a entidade diretamente pela API.

Configure corretamente:

```text
@Entity
@Table
@Id
@Column
```

Mapeie explicitamente constraints importantes quando isso melhorar a clareza.

Evite relacionamento com Equipamento nesta etapa, pois Equipamento ainda não foi implementado.

## 7. Auditoria de datas

Implemente `createdAt` e `updatedAt` de forma simples.

Não introduza uma infraestrutura genérica de auditoria ou `BaseEntity` apenas para essa entidade.

Pode utilizar mecanismos JPA/Spring apropriados, desde que simples e compreensíveis.

Garanta que:

```text
createdAt
```

não seja alterado em updates.

E:

```text
updatedAt
```

seja atualizado corretamente.

## 8. Repository

Crie um repository Spring Data JPA.

Deverá oferecer somente consultas necessárias nesta etapa.

Provavelmente serão necessárias operações para:

```text
buscar por ID
listar
verificar existência por nome
buscar nome para validação de unicidade
```

Não crie dezenas de métodos antecipadamente.

## 9. DTOs

Não exponha a entidade diretamente.

Crie DTOs claros.

Sugestão:

```text
CreateUnidadeRequest
UpdateUnidadeRequest
UnidadeResponse
```

Você pode adaptar nomes conforme o padrão já encontrado no projeto.

### CreateUnidadeRequest

Deve receber algo semelhante a:

```json
{
  "nome": "Matriz",
  "descricao": "Unidade principal"
}
```

`ativo` não precisa ser informado na criação.

Nova unidade começa ativa.

### UpdateUnidadeRequest

Deve permitir atualização dos campos editáveis.

Não permita alteração de:

```text
id
createdAt
updatedAt
```

através do cliente.

A ativação/desativação deve preferencialmente possuir operação explícita, em vez de depender do update genérico.

### UnidadeResponse

Deve retornar pelo menos:

```text
id
nome
descricao
ativo
createdAt
updatedAt
```

## 10. Validação

Utilize Bean Validation.

Exemplos adequados:

```text
@NotBlank
@Size
```

Não dependa exclusivamente do banco para feedback de validação.

Validações estruturais devem ocorrer na entrada da API.

Regras de negócio, como nome duplicado, devem ser verificadas no service.

O banco continua sendo a última camada de garantia de integridade.

## 11. Service

Crie a camada de service.

Centralize nela as regras de negócio.

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

Adapte os nomes ao padrão do projeto.

O controller não deve conhecer detalhes de repository.

Fluxo esperado:

```text
Controller
   ↓
Service
   ↓
Repository
```

## 12. Regra de nome duplicado

Não permita duas unidades com o mesmo nome conforme a política de unicidade adotada.

Exemplo:

```text
Matriz
```

e, se a estratégia escolhida for case-insensitive:

```text
matriz
MATRIZ
```

devem ser tratados como duplicados.

Essa regra deve ser protegida por:

```text
regra no service
+
constraint no banco
```

quando tecnicamente aplicável.

Não confie apenas em:

```text
existsByNome(...)
```

para garantir concorrência.

A constraint do banco é a garantia final.

## 13. Busca inexistente

Quando uma unidade não existir, por exemplo:

```text
GET /api/v1/unidades/{id}
```

a API deve retornar:

```text
404 Not Found
```

Utilize o tratamento global de erros existente.

Se já houver uma exception de recurso não encontrado, reutilize-a.

Caso não exista, crie uma solução simples e reutilizável, sem overengineering.

## 14. Conflitos

Tentativa de criar unidade com nome duplicado deve retornar resposta HTTP adequada.

Preferencialmente:

```text
409 Conflict
```

O mesmo vale para atualização que tente utilizar nome já pertencente a outra unidade.

Integre isso ao tratamento global de erros.

## 15. Endpoints

Implemente:

```text
POST /api/v1/unidades
GET /api/v1/unidades/{id}
GET /api/v1/unidades
PUT /api/v1/unidades/{id}
PATCH /api/v1/unidades/{id}/ativar
PATCH /api/v1/unidades/{id}/desativar
DELETE /api/v1/unidades/{id}
```

Caso a arquitetura existente utilize outra convenção equivalente e já consolidada, preserve-a e explique a decisão.

## 16. POST

Endpoint:

```text
POST /api/v1/unidades
```

Entrada:

```json
{
  "nome": "Matriz",
  "descricao": "Unidade principal"
}
```

Sucesso:

```text
201 Created
```

Retorne a unidade criada.

Se o projeto já possuir padrão para header:

```text
Location
```

utilize-o.

Caso contrário, pode adicionar corretamente se não gerar complexidade desnecessária.

## 17. GET por ID

Endpoint:

```text
GET /api/v1/unidades/{id}
```

Sucesso:

```text
200 OK
```

Não encontrado:

```text
404 Not Found
```

## 18. Listagem

Endpoint:

```text
GET /api/v1/unidades
```

Como quantidade de unidades normalmente é pequena, paginação não é obrigatória nesta primeira versão.

Porém, antes de decidir, observe o padrão do projeto.

Caso já exista uma infraestrutura simples e consistente de paginação, pode reutilizá-la.

Evite adicionar paginação complexa apenas para esse endpoint.

A listagem deverá possuir ordem determinística.

Preferencialmente por:

```text
nome ASC
```

ou outro padrão consistente já existente.

## 19. Filtro por ativo

Se for simples e compatível com a arquitetura existente, permita:

```text
GET /api/v1/unidades?ativo=true
GET /api/v1/unidades?ativo=false
```

Sem o parâmetro:

```text
GET /api/v1/unidades
```

deve retornar todas.

Não crie um mecanismo genérico de Specification apenas para esse filtro.

Uma consulta simples é suficiente.

## 20. PUT

Endpoint:

```text
PUT /api/v1/unidades/{id}
```

Atualize:

```text
nome
descricao
```

Não altere automaticamente:

```text
ativo
```

O status deverá ser controlado pelos endpoints específicos de ativação/desativação.

Sucesso:

```text
200 OK
```

## 21. Ativar

Endpoint:

```text
PATCH /api/v1/unidades/{id}/ativar
```

Deve alterar:

```text
ativo = true
```

Se já estiver ativa, mantenha comportamento idempotente.

Retornar sucesso sem erro é aceitável.

## 22. Desativar

Endpoint:

```text
PATCH /api/v1/unidades/{id}/desativar
```

Deve alterar:

```text
ativo = false
```

Se já estiver inativa, mantenha comportamento idempotente.

Nesta etapa, como Equipamento ainda não existe, não implemente regras relacionadas a equipamentos ativos.

Essas regras serão adicionadas posteriormente caso necessárias.

## 23. DELETE

Endpoint:

```text
DELETE /api/v1/unidades/{id}
```

Sucesso:

```text
204 No Content
```

Se não existir:

```text
404 Not Found
```

No futuro, quando equipamentos estiverem vinculados, exclusão física poderá falhar por integridade referencial.

Não implemente antecipadamente lógica relacionada a Equipamento.

## 24. Controller

Controller deve permanecer fino.

Responsabilidades:

```text
receber request
validar entrada
chamar service
transformar resultado em resposta HTTP
```

Evite lógica de persistência ou negócio no controller.

## 25. Mapeamento

Mapeamento entre entidade e DTO deve ser simples.

Não introduza MapStruct apenas para esta feature.

Pode utilizar:

```text
métodos privados
factory methods
mapper simples
```

conforme o padrão existente.

Evite abstração genérica.

## 26. Tratamento global de erros

Integre a feature com o tratamento de erros já existente.

Garanta comportamento adequado para:

```text
400 Bad Request
404 Not Found
409 Conflict
500 Internal Server Error
```

Não exponha stack trace, SQL ou detalhes internos para o cliente.

Para Bean Validation, informe campos inválidos de maneira clara.

## 27. Testes obrigatórios

Implemente testes úteis para a feature.

No mínimo, cubra cenários equivalentes a:

### Service

```text
criar unidade com sucesso
impedir nome duplicado
buscar unidade existente
buscar unidade inexistente
atualizar unidade
impedir atualização para nome duplicado
ativar unidade
desativar unidade
excluir unidade
```

Adapte a quantidade e o estilo conforme a arquitetura existente.

### Controller / API

Cubra os comportamentos HTTP principais.

Exemplos:

```text
POST válido -> 201
POST inválido -> 400
nome duplicado -> 409
GET existente -> 200
GET inexistente -> 404
PUT válido -> 200
PATCH ativar/desativar
DELETE -> 204
```

Não crie testes redundantes apenas para aumentar cobertura.

## 28. Testes de repository

Se houver comportamento específico como unicidade case-insensitive ou consulta com filtro `ativo`, crie teste de repository caso seja útil para validar SQL/JPA.

Se for apenas CRUD trivial, não crie teste de repository sem necessidade.

## 29. Banco real nos testes

Observe a infraestrutura de testes existente.

Se o projeto já utilizar:

```text
Testcontainers
PostgreSQL
H2
```

preserve o padrão.

Não introduza H2 se o projeto deliberadamente testar comportamento específico do PostgreSQL.

Não introduza Testcontainers apenas para essa feature sem avaliar a infraestrutura atual.

## 30. Compatibilidade com futuras relações

Implemente Unidade de modo que posteriormente possa receber:

```text
Unidade 1 ---- N Equipamentos
```

Porém NÃO adicione ainda:

```java
@OneToMany
```

apenas para antecipar Equipamento.

Quando Equipamento for implementado, avaliaremos qual lado do relacionamento deve ser navegado.

## 31. Open Session / serialização

Não retorne entidade JPA diretamente pelo controller.

Isso evita futuros problemas com:

```text
lazy loading
serialização recursiva
relações bidirecionais
acoplamento API/JPA
```

## 32. Logs

Adicione logs apenas quando forem úteis.

Não gere log para cada getter, mapper ou operação trivial.

Não utilize:

```text
System.out.println
```

## 33. Documentação

Se o README do backend documenta endpoints, atualize a seção correspondente com os endpoints de Unidade.

Não transforme o README em documentação excessivamente detalhada.

Se o projeto possuir OpenAPI/Swagger já configurado, documente os endpoints conforme o padrão existente.

Não introduza Swagger apenas para esta tarefa.

## 34. Não implementar nesta etapa

NÃO implemente:

```text
Equipamento
Monitor
ICMP
Medição
Incidente
Telegram
usuários
login
JWT
roles
dashboard
relatórios
WebSocket
scheduler
workers
```

Esta tarefa é exclusivamente o domínio:

```text
UNIDADE
```

mais infraestrutura diretamente necessária.

## 35. Antes de terminar

Execute:

```bash
git diff
```

Revise suas próprias alterações.

Procure por:

```text
imports não utilizados
código morto
TODO desnecessário
duplicação óbvia
nomes inconsistentes
exposição de entidade JPA
credenciais
mudanças não relacionadas
```

Depois execute os testes.

Se houver Maven Wrapper:

```bash
./mvnw test
```

Depois:

```bash
./mvnw verify
```

ou comandos equivalentes conforme o projeto.

## 36. Não faça commit

Não execute:

```text
git commit
git push
```

Deixe as alterações no working tree para revisão.

## 37. Resposta final

Ao concluir, responda seguindo este formato:

```text
RESUMO

Explique brevemente a implementação realizada.


ENDPOINTS

POST   /api/v1/unidades
GET    /api/v1/unidades
GET    /api/v1/unidades/{id}
PUT    /api/v1/unidades/{id}
PATCH  /api/v1/unidades/{id}/ativar
PATCH  /api/v1/unidades/{id}/desativar
DELETE /api/v1/unidades/{id}


ARQUIVOS CRIADOS

...


ARQUIVOS ALTERADOS

...


MIGRATION

Nome:
...

Alterações:
...


MODELO

Campos da Unidade:
...


REGRAS DE NEGÓCIO

...


TRATAMENTO DE ERROS

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


DECISÕES TÉCNICAS

...


PENDÊNCIAS

...


PRÓXIMO PASSO RECOMENDADO

...
```

Não diga apenas que "funciona".

Apresente os resultados reais dos comandos executados.

Agora implemente o módulo `Unidade` de forma incremental e compatível com o estado atual do repositório.

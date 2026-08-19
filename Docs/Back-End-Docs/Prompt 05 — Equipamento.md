# Prompt 05 — Implementação do módulo Equipamento

## 1. Contexto da etapa

Com base no contexto permanente definido em `codexcontex.md` e no estado atual do repositório após a implementação dos módulos `Unidade` e `TipoEquipamento`, implemente agora o módulo:

# EQUIPAMENTO

Esta é uma etapa central do domínio do Infra Monitor.

Até este momento, o sistema deve possuir conceitualmente:

```text
Unidade

TipoEquipamento
```

Agora essas entidades serão conectadas através de:

```text
Unidade 1 ---- N Equipamento N ---- 1 TipoEquipamento
```

Todo equipamento cadastrado deve pertencer obrigatoriamente a:

```text
uma Unidade
+
um TipoEquipamento
```

Antes de modificar qualquer arquivo, analise o estado real do repositório.

Não assuma que as etapas anteriores foram implementadas exatamente como descritas nos prompts.

O código, migrations e testes existentes representam o estado atual do sistema.

---

# 2. Objetivo

Implementar o domínio `Equipamento`, responsável pelo inventário dos ativos de infraestrutura.

Exemplos de equipamentos:

```text
SW-CORE-01
SW-ACESSO-01
RTR-MATRIZ-01
FW-MATRIZ-01
SRV-AD-01
AP-RECEPCAO-01
NVR-01
```

Cada equipamento deverá possuir obrigatoriamente:

```text
Unidade
TipoEquipamento
```

Exemplo:

```text
Equipamento:
SW-CORE-01

Unidade:
Matriz

Tipo:
Switch
```

---

# 3. Relações do domínio

O relacionamento desta etapa é:

```text
UNIDADE
   │
   │ 1
   │
   └──── N EQUIPAMENTO N ──── 1 TIPO_EQUIPAMENTO
```

No banco:

```text
equipamento.unidade_id
    FK -> unidade.id

equipamento.tipo_equipamento_id
    FK -> tipo_equipamento.id
```

Ambas as foreign keys devem ser obrigatórias.

Não deve existir equipamento sem unidade.

Não deve existir equipamento sem tipo.

---

# 4. Modelo inicial de Equipamento

A entidade deverá possuir, no mínimo:

```text
id
unidade
tipoEquipamento
nome
ip
hostname
descricao
localizacao
ativo
createdAt
updatedAt
```

Antes de definir tipos, nomes de colunas ou estratégia de IDs, examine os módulos existentes.

Preserve:

* tipo de ID;
* nomenclatura;
* estratégia de timestamps;
* padrão de auditoria;
* convenções JPA;
* padrão das migrations.

---

# 5. Campo id

Utilize a mesma estratégia já utilizada por:

```text
Unidade
TipoEquipamento
```

Não introduza outro tipo de ID.

---

# 6. Campo unidade

Obrigatório.

Representa a unidade à qual o equipamento pertence.

No banco:

```text
unidade_id NOT NULL
```

com foreign key para a tabela correspondente a `Unidade`.

No Java, utilize relacionamento JPA adequado.

Preferencialmente:

```java
@ManyToOne(fetch = FetchType.LAZY)
```

com:

```java
@JoinColumn(...)
```

Não utilize `EAGER` apenas para facilitar DTOs.

Não adicione `@OneToMany` em `Unidade` apenas para tornar o relacionamento bidirecional.

Nesta etapa, uma navegação unidirecional:

```text
Equipamento -> Unidade
```

é suficiente.

---

# 7. Campo tipoEquipamento

Obrigatório.

No banco:

```text
tipo_equipamento_id NOT NULL
```

com foreign key correspondente.

No Java, utilize relacionamento adequado, preferencialmente:

```java
@ManyToOne(fetch = FetchType.LAZY)
```

Não adicione relacionamento reverso em `TipoEquipamento` apenas por antecipação.

Uma navegação:

```text
Equipamento -> TipoEquipamento
```

é suficiente.

---

# 8. Unidade inexistente

Ao criar ou atualizar um equipamento informando uma unidade inexistente:

```text
unidadeId = ID inexistente
```

retorne:

```text
404 Not Found
```

Reutilize o padrão de exception já existente.

---

# 9. Tipo inexistente

Ao criar ou atualizar um equipamento informando:

```text
tipoEquipamentoId = ID inexistente
```

retorne:

```text
404 Not Found
```

de forma consistente com Unidade.

---

# 10. Unidade inativa

Não permita criar um novo equipamento vinculado a uma unidade inativa.

Exemplo:

```text
Unidade:
Filial Recife

ativo = false
```

Tentativa de criação deverá falhar com erro de regra de negócio.

Utilize status HTTP consistente com o padrão do projeto.

Preferencialmente:

```text
409 Conflict
```

se não houver padrão melhor já estabelecido.

Não exclua nem altere automaticamente a unidade.

---

# 11. Tipo de equipamento inativo

Não permita criar novo equipamento utilizando um `TipoEquipamento` inativo.

Preferencialmente retorne:

```text
409 Conflict
```

ou o status já adotado pelo projeto para violação de regra de negócio.

---

# 12. Equipamentos existentes e desativação dos cadastros relacionados

Um equipamento existente pode continuar historicamente associado a:

```text
Unidade inativa
```

ou:

```text
TipoEquipamento inativo
```

Não altere automaticamente equipamentos quando Unidade ou TipoEquipamento forem desativados.

A desativação não significa exclusão do histórico.

---

# 13. Alteração de Unidade

O update de Equipamento poderá alterar sua unidade.

Porém a nova unidade:

* deve existir;
* deve estar ativa.

Não permita mover um equipamento para uma unidade inativa.

---

# 14. Alteração de TipoEquipamento

O update poderá alterar o tipo.

O novo tipo:

* deve existir;
* deve estar ativo.

---

# 15. Campo nome

`nome` é obrigatório.

Exemplos:

```text
SW-CORE-01
FW-MATRIZ-01
SRV-AD-01
```

Não aceitar:

```text
null
""
"   "
```

Utilize:

```java
@NotBlank
@Size
```

ou validações equivalentes conforme o padrão do projeto.

Defina tamanho coerente entre Java e PostgreSQL.

---

# 16. Unicidade do nome

NÃO imponha automaticamente unicidade global ao nome do equipamento.

Equipamentos de unidades diferentes podem seguir padrões de nomenclatura semelhantes.

Exemplo:

```text
Unidade A:
SW-01

Unidade B:
SW-01
```

Isso pode ser válido.

Nesta etapa, não crie uma constraint global:

```text
UNIQUE(nome)
```

sem requisito explícito já existente no projeto.

Se o repositório já tiver uma regra definida sobre isso, preserve-a e documente.

---

# 17. Campo IP

O equipamento poderá possuir um endereço IP principal.

Exemplos:

```text
10.0.0.1
192.168.1.10
172.16.20.5
```

O campo deve ser opcional.

Não imponha unicidade global ao IP.

Redes privadas diferentes podem reutilizar faixas de endereçamento.

Não modele múltiplas interfaces de rede nesta etapa.

O campo representa apenas:

```text
IP principal / endereço de gerenciamento
```

do equipamento.

No futuro, se necessário, uma entidade própria poderá representar interfaces/endereço.

Não antecipe isso agora.

---

# 18. Validação do IP

Se um valor de IP for informado, valide sua estrutura.

O sistema deverá aceitar pelo menos IPv4 válido.

Antes de implementar uma regex complexa manualmente, verifique se o projeto já possui solução adequada.

Evite regex excessivamente obscura.

Não faça resolução DNS para validar IP.

Não execute ping para validar o equipamento.

A validação deve ser puramente sintática.

Se houver decisão arquitetural existente para IPv6, preserve-a.

Caso contrário, não amplie o escopo desnecessariamente.

---

# 19. Tipo PostgreSQL para IP

Avalie tecnicamente se o projeto deve utilizar:

```text
VARCHAR
```

ou o tipo PostgreSQL:

```text
INET
```

Para esta primeira versão, priorize consistência com JPA e simplicidade.

Não introduza dependências adicionais apenas para mapear `INET`.

Se `VARCHAR` for a solução mais simples e consistente com o projeto, utilize-a.

Documente a decisão.

---

# 20. Campo hostname

Opcional.

Exemplos:

```text
sw-core-01
fw-matriz
srv-ad01
```

Não realize resolução DNS.

Hostname representa apenas informação de inventário.

Defina tamanho coerente.

---

# 21. Campo descricao

Opcional.

Exemplo:

```text
Switch core da unidade Matriz
```

Defina limite adequado.

---

# 22. Campo localizacao

Opcional.

Representa localização física dentro da unidade.

Exemplos:

```text
CPD
Rack 01
Sala de TI
Recepção
Rack 03 - U20
```

Não confundir:

```text
Unidade
```

com:

```text
localizacao
```

Unidade é uma entidade e FK obrigatória.

Localização é uma descrição interna opcional.

---

# 23. Campo ativo

Obrigatório.

Novo equipamento deve iniciar com:

```text
ativo = true
```

por padrão.

O cliente não precisa informar `ativo` no POST.

A ativação/desativação deve ocorrer por endpoints explícitos.

---

# 24. Datas

Utilize:

```text
createdAt
updatedAt
```

seguindo exatamente o padrão consolidado nos módulos anteriores.

Não introduza nova estratégia de auditoria nesta feature.

---

# 25. Migration

Utilize Flyway.

Antes de criar migration:

1. liste todas as migrations existentes;
2. identifique a última versão;
3. verifique se a tabela Equipamento já existe;
4. confirme os nomes reais das tabelas de Unidade e TipoEquipamento;
5. confirme o tipo real dos IDs;
6. confirme tipos de timestamp;
7. confirme padrão singular/plural;
8. somente depois crie a próxima migration.

Não presuma o número da migration.

Exemplo conceitual:

```text
Vx__create_equipamento.sql
```

---

# 26. Estrutura conceitual da tabela

A tabela deverá ser equivalente a:

```text
equipamento
--------------------------------
id
unidade_id
tipo_equipamento_id
nome
ip
hostname
descricao
localizacao
ativo
created_at
updated_at
```

Os nomes reais devem seguir o padrão existente.

---

# 27. Foreign keys

Crie foreign keys reais no PostgreSQL.

Conceitualmente:

```text
FOREIGN KEY (unidade_id)
REFERENCES unidade(id)
```

e:

```text
FOREIGN KEY (tipo_equipamento_id)
REFERENCES tipo_equipamento(id)
```

Não dependa apenas do JPA para integridade.

---

# 28. Comportamento de DELETE das foreign keys

Não utilize:

```text
ON DELETE CASCADE
```

para Unidade -> Equipamento.

Também não utilize cascade delete para TipoEquipamento -> Equipamento.

Excluir uma unidade não deve apagar silenciosamente todos os equipamentos.

Excluir um tipo não deve apagar equipamentos.

Prefira integridade restritiva.

Quando houver equipamentos associados, o banco deve proteger o histórico.

---

# 29. Índices

Crie índices para as foreign keys se forem adequados ao PostgreSQL e às consultas previstas.

Especialmente:

```text
unidade_id
tipo_equipamento_id
```

Esses campos serão utilizados frequentemente em filtros.

Não crie índices indiscriminadamente em todos os campos.

---

# 30. Entidade JPA

Crie a entidade `Equipamento` no módulo adequado.

Exemplo conceitual:

```text
br.com.inframonitor.equipamento.entity.Equipamento
```

Siga a arquitetura existente.

Não exponha a entidade diretamente na API.

---

# 31. Cascade JPA

Não utilize:

```java
CascadeType.REMOVE
```

nos relacionamentos com Unidade ou TipoEquipamento.

Criar, atualizar ou excluir equipamento não deve criar/excluir automaticamente Unidade ou TipoEquipamento.

Evite `CascadeType.ALL` nesses relacionamentos.

---

# 32. Repository

Crie:

```text
EquipamentoRepository
```

seguindo o padrão do projeto.

Além do CRUD básico, o repository deverá suportar as consultas necessárias para os filtros desta etapa.

Evite criar métodos para Monitor ou Incidente.

---

# 33. DTO de criação

Crie seguindo a convenção existente algo equivalente a:

```text
CreateEquipamentoRequest
```

Request conceitual:

```json
{
  "unidadeId": 1,
  "tipoEquipamentoId": 2,
  "nome": "SW-CORE-01",
  "ip": "10.0.0.10",
  "hostname": "sw-core-01",
  "descricao": "Switch core da unidade",
  "localizacao": "CPD - Rack 01"
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

# 34. DTO de atualização

Crie algo equivalente a:

```text
UpdateEquipamentoRequest
```

Permita editar:

```text
unidadeId
tipoEquipamentoId
nome
ip
hostname
descricao
localizacao
```

Não permitir alteração direta de:

```text
id
createdAt
updatedAt
ativo
```

Ativo possui endpoints próprios.

---

# 35. DTO de resposta

Crie algo equivalente a:

```text
EquipamentoResponse
```

A resposta deve ser útil ao frontend sem expor entidade JPA.

Sugestão:

```json
{
  "id": 10,
  "nome": "SW-CORE-01",
  "ip": "10.0.0.10",
  "hostname": "sw-core-01",
  "descricao": "Switch core",
  "localizacao": "CPD - Rack 01",
  "ativo": true,
  "unidade": {
    "id": 1,
    "nome": "Matriz"
  },
  "tipoEquipamento": {
    "id": 2,
    "nome": "Switch"
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

Não retorne entidades JPA aninhadas.

Utilize DTOs resumidos, records ou estrutura equivalente conforme o padrão existente.

Evite devolver todos os campos internos de Unidade e TipoEquipamento se o frontend não precisa deles.

---

# 36. Evitar N+1

Como `EquipamentoResponse` precisará de informações de:

```text
Unidade
TipoEquipamento
```

analise o risco de N+1 na listagem.

Não resolva usando:

```java
FetchType.EAGER
```

globalmente.

Utilize uma solução explícita e adequada quando necessário, como:

```text
@EntityGraph
JOIN FETCH
projection
```

ou padrão já existente.

Escolha a alternativa mais simples que evite consultas excessivas.

---

# 37. Service

Implemente camada de service.

Responsabilidades:

```text
create
findById
list
update
activate
deactivate
delete
```

Além disso, o service deverá validar:

```text
unidade existe
unidade está ativa quando necessário
tipo existe
tipo está ativo quando necessário
```

Não coloque essas regras no controller.

---

# 38. Endpoints

Implemente:

```text
POST   /api/v1/equipamentos
GET    /api/v1/equipamentos
GET    /api/v1/equipamentos/{id}
PUT    /api/v1/equipamentos/{id}
PATCH  /api/v1/equipamentos/{id}/ativar
PATCH  /api/v1/equipamentos/{id}/desativar
DELETE /api/v1/equipamentos/{id}
```

Preserve outra convenção apenas se já estiver consolidada no projeto.

---

# 39. POST

Endpoint:

```text
POST /api/v1/equipamentos
```

Sucesso:

```text
201 Created
```

Deve validar:

* request;
* unidade existente;
* unidade ativa;
* tipo existente;
* tipo ativo;
* IP sintaticamente válido, quando informado.

Se o padrão existente utiliza `Location`, mantenha-o.

---

# 40. GET por ID

Endpoint:

```text
GET /api/v1/equipamentos/{id}
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

Endpoint:

```text
GET /api/v1/equipamentos
```

Diferentemente de Unidade e TipoEquipamento, a quantidade de equipamentos pode crescer significativamente.

Analise o padrão existente e prefira paginação para esta listagem.

Se o projeto ainda não possui padrão de paginação, implemente uma solução simples baseada em Spring Data:

```text
page
size
sort
```

Não crie infraestrutura genérica complexa.

---

# 42. Paginação

Se implementada, utilize defaults razoáveis.

Exemplo conceitual:

```text
GET /api/v1/equipamentos?page=0&size=20
```

Defina limite máximo razoável para `size` se o projeto possuir estratégia para isso.

Não permita respostas acidentalmente enormes sem necessidade.

Siga o formato de resposta já existente, caso haja um padrão.

---

# 43. Filtro por Unidade

Suporte:

```text
GET /api/v1/equipamentos?unidadeId=1
```

Esse filtro é importante porque o dashboard e o inventário serão organizados por unidade.

---

# 44. Filtro por Tipo

Suporte:

```text
GET /api/v1/equipamentos?tipoEquipamentoId=2
```

---

# 45. Filtro por ativo

Suporte:

```text
GET /api/v1/equipamentos?ativo=true
GET /api/v1/equipamentos?ativo=false
```

Sem filtro:

```text
GET /api/v1/equipamentos
```

deve considerar ativos e inativos, respeitando paginação.

---

# 46. Combinação de filtros

Permita combinar:

```text
GET /api/v1/equipamentos?unidadeId=1&tipoEquipamentoId=2&ativo=true
```

Não crie uma arquitetura de filtros excessivamente abstrata.

Se houver poucas combinações, escolha solução simples.

Se Spring Data Specification já estiver oficialmente presente no projeto, pode reutilizar.

Não introduza uma biblioteca externa para isso.

---

# 47. Busca textual

Não implemente busca textual genérica nesta etapa, salvo se já estiver prevista pelo código atual.

Campos como:

```text
nome
ip
hostname
```

poderão receber busca posteriormente.

Mantenha o escopo atual focado nos filtros estruturais.

---

# 48. PUT

Endpoint:

```text
PUT /api/v1/equipamentos/{id}
```

Permita alterar os campos editáveis.

Se `unidadeId` for alterado:

* unidade deve existir;
* nova unidade deve estar ativa.

Se `tipoEquipamentoId` for alterado:

* tipo deve existir;
* novo tipo deve estar ativo.

Se os IDs permanecerem os mesmos e os registros relacionados estiverem atualmente inativos, não bloqueie automaticamente a atualização de outros campos apenas por causa disso.

Exemplo:

um equipamento histórico associado a uma unidade posteriormente desativada deve poder ter sua descrição corrigida sem necessariamente ser transferido.

Porém, não permita trocar para outra unidade inativa.

A mesma lógica vale para TipoEquipamento.

---

# 49. PATCH ativar

Endpoint:

```text
PATCH /api/v1/equipamentos/{id}/ativar
```

Antes de ativar um equipamento, valide:

```text
Unidade está ativa
TipoEquipamento está ativo
```

Não permita ativar equipamento dentro de unidade inativa.

Não permita ativar equipamento com tipo inativo.

A operação deve ser idempotente quando já estiver ativo e suas dependências forem válidas.

---

# 50. PATCH desativar

Endpoint:

```text
PATCH /api/v1/equipamentos/{id}/desativar
```

Define:

```text
ativo = false
```

Operação idempotente.

Não implemente comportamento de Monitor ainda.

---

# 51. DELETE

Endpoint:

```text
DELETE /api/v1/equipamentos/{id}
```

Sucesso:

```text
204 No Content
```

Inexistente:

```text
404 Not Found
```

Nesta etapa, como Monitor ainda não existe, a exclusão física pode funcionar normalmente.

Quando Monitor for implementado, a integridade referencial deverá ser reavaliada.

Não antecipe cascade delete.

---

# 52. Exclusão de Unidade e TipoEquipamento

Com a criação das foreign keys de Equipamento, reavalie o comportamento dos endpoints DELETE existentes de:

```text
Unidade
TipoEquipamento
```

Agora deve ser impossível excluir fisicamente uma Unidade que possua Equipamentos associados sem tratamento apropriado.

O mesmo vale para TipoEquipamento.

O banco deve impedir perda acidental de histórico.

A API não deve retornar:

```text
500 Internal Server Error
```

com SQL bruto quando essa tentativa ocorrer.

Trate a violação de integridade de forma apropriada.

Preferencialmente:

```text
409 Conflict
```

com mensagem de negócio clara.

Exemplos conceituais:

```text
Não é possível excluir a unidade porque existem equipamentos associados.
```

```text
Não é possível excluir o tipo de equipamento porque existem equipamentos associados.
```

Implemente apenas a alteração mínima necessária nos módulos anteriores para suportar essa nova realidade.

---

# 53. Controller

Mantenha fino.

Fluxo:

```text
Controller
   ↓
Service
   ↓
Repository
```

Não acesse repositories de Unidade e Tipo diretamente no controller.

---

# 54. Bean Validation

Valide DTOs.

Campos obrigatórios:

```text
unidadeId
tipoEquipamentoId
nome
```

Campos opcionais devem respeitar seus limites quando informados.

IP deve ser validado quando não for nulo/vazio.

---

# 55. Normalização de strings

Observe o padrão existente.

Evite armazenar acidentalmente:

```text
"   SW-CORE-01   "
```

se os módulos anteriores já normalizam entradas.

Se houver estratégia consolidada de trim, reutilize-a.

Não crie framework próprio de normalização.

---

# 56. Tratamento de erros

Reutilize o tratamento global existente.

Garanta comportamento consistente para:

```text
400 Bad Request
404 Not Found
409 Conflict
500 Internal Server Error
```

Casos principais:

```text
request inválido -> 400

IP inválido -> 400

equipamento inexistente -> 404

unidade inexistente -> 404

tipo inexistente -> 404

unidade inativa -> 409

tipo inativo -> 409

exclusão de Unidade com Equipamentos -> 409

exclusão de TipoEquipamento com Equipamentos -> 409
```

Não exponha SQL ou stack trace.

---

# 57. Testes de Service

Cubra no mínimo cenários equivalentes a:

```text
criar equipamento válido

falhar criação com unidade inexistente

falhar criação com unidade inativa

falhar criação com tipo inexistente

falhar criação com tipo inativo

falhar criação com IP inválido

buscar equipamento existente

buscar equipamento inexistente

atualizar dados básicos

alterar unidade para unidade ativa

impedir alteração para unidade inativa

alterar tipo para tipo ativo

impedir alteração para tipo inativo

permitir alteração de outro campo mantendo relação existente inativa

ativar equipamento

impedir ativação quando unidade estiver inativa

impedir ativação quando tipo estiver inativo

desativar equipamento

excluir equipamento
```

Adapte ao estilo atual dos testes.

---

# 58. Testes de Controller/API

Cubra os contratos HTTP principais:

```text
POST válido -> 201

POST inválido -> 400

unidade inexistente -> 404

tipo inexistente -> 404

unidade inativa -> 409

tipo inativo -> 409

GET existente -> 200

GET inexistente -> 404

GET lista -> 200

GET filtro unidade -> 200

GET filtro tipo -> 200

GET filtro ativo -> 200

PUT válido -> 200

PATCH ativar -> sucesso

PATCH desativar -> sucesso

DELETE -> 204
```

---

# 59. Testes de integridade

Adicione teste apropriado para garantir que:

```text
Unidade com Equipamento
```

não seja excluída fisicamente.

E:

```text
TipoEquipamento com Equipamento
```

não seja excluído fisicamente.

O comportamento da API deve ser:

```text
409 Conflict
```

ou o padrão equivalente adotado.

---

# 60. Repository e consultas

Teste repository apenas quando houver comportamento relevante.

Os filtros combinados e a estratégia de fetch podem justificar testes.

Não teste métodos triviais do Spring Data apenas por cobertura.

---

# 61. N+1

Verifique especificamente a listagem.

Não aceite como solução final uma implementação que execute aproximadamente:

```text
1 query para equipamentos
+
N queries para unidade
+
N queries para tipo
```

Use ferramenta/padrão apropriado para carregar as referências necessárias de forma eficiente.

Não altere os relacionamentos para EAGER globalmente.

---

# 62. Performance

Ainda não faça otimizações prematuras.

Mas preserve:

* índices das FKs;
* paginação;
* fetch adequado;
* consultas previsíveis.

Isso será importante quando o inventário crescer.

---

# 63. Não implementar Monitor

Apesar de Equipamento futuramente possuir:

```text
Equipamento 1 ---- N Monitor
```

NÃO implemente agora:

```text
Monitor
@OneToMany monitors
ICMP
ping
scheduler
worker
```

O módulo Monitor será a próxima etapa separada.

---

# 64. Não implementar status online/offline em Equipamento

Não crie campos como:

```text
online
offline
statusPing
latencia
lastPing
lastSeen
uptime
```

em `Equipamento`.

Essas informações pertencem ao domínio de monitoramento e serão derivadas de:

```text
Monitor
Medição
Incidente
```

Não misture inventário com estado operacional.

---

# 65. Não implementar credenciais

Não adicione:

```text
usuarioSSH
senhaSSH
communitySNMP
token
credencial
```

ao Equipamento nesta etapa.

Credenciais exigem modelagem e segurança próprias.

---

# 66. Não implementar fabricante/modelo automaticamente

Nesta primeira versão, mantenha o escopo definido.

Não adicione campos extras como:

```text
fabricante
modelo
serial
patrimonio
firmware
mac
```

apenas porque parecem úteis.

Esses campos poderão ser avaliados posteriormente na evolução do inventário.

Se já estiverem explicitamente presentes no schema ou requisitos existentes, preserve-os.

---

# 67. Consistência com módulos anteriores

Use `Unidade` e `TipoEquipamento` como referência para:

```text
packages
DTOs
services
exceptions
mappers
timestamps
HTTP
testes
nomenclatura
```

Não crie uma terceira abordagem arquitetural.

---

# 68. Não criar abstrações genéricas

Agora existirão três CRUDs:

```text
Unidade
TipoEquipamento
Equipamento
```

Mesmo assim, não crie automaticamente:

```text
BaseController
BaseService
BaseRepository
GenericCrud
BaseEntity
GenericMapper
```

Somente abstraia se houver um problema concreto e justificável.

Esta tarefa não tem como objetivo refatorar toda a arquitetura.

---

# 69. README / OpenAPI

Se o projeto documenta endpoints, adicione Equipamento seguindo o padrão existente.

Não introduza Swagger se ainda não existir.

---

# 70. Inspeção inicial

Antes de modificar:

```bash
pwd
git status
```

Examine:

```text
pom.xml
src/main/java
src/main/resources
src/main/resources/db/migration
src/test
```

Localize:

```text
Unidade
TipoEquipamento
tratamento de erros
migrations
testes
```

---

# 71. Implementação incremental

Sugestão de sequência:

```text
1. analisar código atual
2. analisar migrations
3. criar migration Equipamento
4. criar entidade
5. criar repository
6. criar DTOs
7. implementar service
8. implementar controller
9. implementar filtros/paginação
10. tratar integridade nos módulos anteriores
11. criar testes
12. executar testes
13. executar build
14. revisar git diff
```

---

# 72. Testes finais

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

Investigue e corrija falhas relacionadas à implementação.

Não esconda falhas preexistentes.

---

# 73. Git

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

```bash
git reset --hard
git clean -fd
git checkout .
git commit
git push
```

---

# 74. Revisão final

Revise:

```text
foreign keys
índices
nullable
constraints
tipos JPA x PostgreSQL
lazy loading
N+1
paginação
validações
erros HTTP
alterações em Unidade
alterações em TipoEquipamento
testes
```

Verifique também:

```text
imports não utilizados
TODOs
secrets
mudanças fora do escopo
```

---

# 75. Critérios de aceite

A tarefa estará concluída quando:

* existir tabela/migration de Equipamento quando necessária;
* `unidade_id` for obrigatório;
* `tipo_equipamento_id` for obrigatório;
* ambas possuírem foreign keys reais;
* não houver cascade delete;
* for possível criar Equipamento;
* unidade inexistente retornar 404;
* tipo inexistente retornar 404;
* unidade inativa impedir novo vínculo;
* tipo inativo impedir novo vínculo;
* IP inválido retornar 400;
* IP não possuir unicidade global;
* for possível consultar Equipamento;
* listagem possuir estratégia adequada para volume;
* filtros por Unidade, Tipo e ativo funcionarem;
* filtros puderem ser combinados;
* update funcionar;
* ativação validar dependências;
* desativação funcionar;
* exclusão funcionar;
* Unidade com Equipamentos não puder ser excluída silenciosamente;
* TipoEquipamento com Equipamentos não puder ser excluído silenciosamente;
* não houver N+1 óbvio na listagem;
* entidade JPA não for exposta;
* testes relevantes passarem;
* build passar;
* Monitor não tiver sido implementado.

---

# 76. Resposta final

Ao concluir, apresente:

```text
RESUMO

...


CONTEXTO UTILIZADO

- codexcontex.md
- módulo Unidade
- módulo TipoEquipamento
- migrations existentes


ESTADO ANTES DA IMPLEMENTAÇÃO

...


MODELO IMPLEMENTADO

Equipamento:
- id
- unidade
- tipoEquipamento
- nome
- ip
- hostname
- descricao
- localizacao
- ativo
- createdAt
- updatedAt


RELACIONAMENTOS

Equipamento -> Unidade:
...

Equipamento -> TipoEquipamento:
...


ENDPOINTS

POST   /api/v1/equipamentos
GET    /api/v1/equipamentos
GET    /api/v1/equipamentos/{id}
PUT    /api/v1/equipamentos/{id}
PATCH  /api/v1/equipamentos/{id}/ativar
PATCH  /api/v1/equipamentos/{id}/desativar
DELETE /api/v1/equipamentos/{id}


FILTROS

...


PAGINAÇÃO

...


MIGRATION

Arquivo:
...

Foreign keys:
...

Índices:
...


ARQUIVOS CRIADOS

...


ARQUIVOS ALTERADOS

...


ALTERAÇÕES EM UNIDADE

...


ALTERAÇÕES EM TIPO EQUIPAMENTO

...


REGRAS DE NEGÓCIO

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

Não implemente Monitor ainda.
```

---

# 77. Princípio principal

Esta feature estabelece o núcleo do inventário:

```text
Unidade
   │
   └── Equipamento
          ↑
          │
    TipoEquipamento
```

Mantenha separação clara entre:

```text
INVENTÁRIO
Equipamento

e

MONITORAMENTO
Monitor / Medição / Incidente
```

Não coloque estado de ping ou disponibilidade dentro de Equipamento.

Implemente o módulo de forma simples, consistente, testável e preparada para que a próxima etapa possa adicionar:

```text
Equipamento 1 ---- N Monitor
```

sem precisar redesenhar o inventário.

Agora analise o estado atual do repositório e implemente integralmente o módulo `Equipamento`.

B10 — Georreferenciamento de Unidades para o Mapa — Infra Monitor

1. Objetivo

Implementar no backend do Infra Monitor uma referência geográfica estável para cada Unidade, permitindo que o frontend associe corretamente uma Unidade ao GeoJSON municipal de Sergipe.

A solução preferida é adicionar codigoIbge à entidade/DTO de Unidade e propagá-lo para a Dashboard API.

Esta fase deve entregar persistência, validação, migration Flyway, exposição no CRUD de Unidade, exposição na Dashboard API, testes e documentação, sem ainda implementar a ligação visual do mapa no Angular.

2. Contexto

A F09 reutilizou public/assets/maps/se-municipalities.geo.json, porém a Dashboard API atual retorna Unidade sem chave geográfica suficiente. O Angular não deve inventar coordenadas nem mapear por heurística de nome.

Fluxo desejado:

Unidade.codigoIbge
↓
Dashboard API
↓
Angular
↓
GeoJSON municipal
↓
município correspondente

3. Estratégia

Adicionar codigoIbge como atributo cadastral da Unidade. Para o mapa municipal atual, isso é preferível a latitude/longitude porque o GeoJSON já representa municípios e a associação territorial é determinística.

Latitude/longitude pode ser adicionada futuramente para localização pontual, mas não pertence a esta fase.

4. Tipo do campo

Confirmar o formato do código municipal presente no GeoJSON existente.

Preferir String em vez de número.

Exemplo conceitual:

"2800308"

Não fixar tamanho sem verificar o asset real.

5. Migration

Criar migration Flyway incremental. Não editar migrations já aplicadas.

Adicionar coluna equivalente a:

codigo_ibge varchar(...)

Como já podem existir Unidades cadastradas, o campo deve ser opcional inicialmente.

Não criar UNIQUE, pois podem existir múltiplas Unidades no mesmo município.

6. Entidade e DTOs

Adicionar o campo à entidade de Unidade e aos DTOs reais correspondentes, por exemplo:

UnidadeResponse
UnidadeCreateRequest
UnidadeUpdateRequest

ou nomes equivalentes.

Não expor entidade JPA diretamente.

7. Validação

Validar apenas o necessário e após confirmar o formato real.

null deve ser aceito.

Se houver string vazia, tratar de forma coerente com o padrão do projeto.

Não criar dependência externa nem validação online.

8. CRUD

Atualizar:

POST /api/v1/unidades
PUT /api/v1/unidades/{id}
GET /api/v1/unidades
GET /api/v1/unidades/{id}

para suportar/retornar codigoIbge.

Requests antigos sem o campo devem continuar funcionando.

Preservar ativar, desativar e delete sem mudança de regra.

9. Dashboard API

Propagar codigoIbge para os DTOs usados em:

GET /api/v1/dashboard/unidades
GET /api/v1/dashboard/unidades/{id}

Não adicionar ao resumo global se ele não retorna entidades individuais.

O Dashboard apenas propaga o valor cadastrado; não deve ler GeoJSON nem fazer geocoding.

10. Contrato

Atualizar:

docs/frontend-api-contract.md

documentando:

codigoIbge: string | null

e indicando que ele será usado pela integração cartográfica do frontend.

11. Testes

Cobrir pelo menos:

criação com codigoIbge;

criação sem codigoIbge;

edição adicionando/alterando o código;

remoção, se o contrato permitir;

listagem retornando o campo;

GET por id;

Dashboard unidades;

Dashboard unidade por id;

null;

formato inválido conforme a validação adotada;

migration em PostgreSQL de teste.

12. Validação manual

Com PostgreSQL de teste:

criar Unidade com codigoIbge;

consultar /unidades;

consultar /unidades/{id};

consultar /dashboard/unidades;

consultar /dashboard/unidades/{id};

confirmar o mesmo valor;

testar uma Unidade sem codigoIbge.

13. Fora do escopo

Não implementar:

latitude/longitude;

geocoding;

API externa do IBGE;

mapa Angular;

marcadores;

autenticação;

deploy.

14. Critérios de aceite

B10 está concluída quando:

migration incremental existir;

codigo_ibge existir e for opcional;

criação e edição aceitarem codigoIbge;

GETs de Unidade retornarem codigoIbge;

Dashboard retornar codigoIbge;

null for suportado;

não houver unique indevido;

frontend atual continuar compatível;

contrato REST estiver atualizado;

testes passarem;

build passar.

15. Relatório final

B10 — Resultado

Status: CONCLUÍDO / CONCLUÍDO COM RESSALVAS / BLOQUEADO

Migration

Nome e alteração.

Entidade

Campo, tipo e nullability.

DTOs

Arquivos/DTOs alterados.

CRUD

Endpoints atualizados.

Dashboard

Endpoints que retornam codigoIbge.

Validação

Regra adotada.

Compatibilidade

Confirmação de requests antigos sem o campo.

Testes

Comando, quantidade e resultado.

Build

Comando e resultado.

Validação HTTP

Exemplos sanitizados.

Git diff

Arquivos relevantes.

Pendências

Somente problemas reais.

Observações para F10

Tudo que o frontend precisa saber para mapear codigoIbge ao GeoJSON.

Não implementar frontend nesta fase.
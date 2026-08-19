# Prompt 11 — Domínio de Notificação

## 1. Contexto

Com base no contexto permanente definido em:

`codexcontex.md`

e considerando o estado atual do repositório após a implementação de:

```text
Unidade
TipoEquipamento
Equipamento
Monitor
Medição
Incidente
Monitoring Engine ICMP
Incident Engine
```

implemente agora o domínio:

# NOTIFICAÇÃO

A arquitetura conceitual passa a ser:

```text
Incidente
    |
    +---- Notificação
```

Conceitualmente:

```text
Incidente 1 ---- N Notificações
```

Uma Notificação representa uma tentativa persistida de comunicar um evento relacionado a um Incidente.

IMPORTANTE:

Nesta etapa implemente:

* entidade Notificação;
* persistência;
* enums;
* vínculo com Incidente;
* criação automática de registros pendentes quando Incidente for aberto/fechado;
* consultas;
* filtros;
* tratamento de integridade;
* testes.

NÃO implemente ainda:

```text
envio Telegram real
bot Telegram
HTTP para Telegram API
Email
Webhook
retry scheduler
fila externa
Kafka
RabbitMQ
```

O Prompt 12 ficará responsável pelo envio real via Telegram.

---

# 2. Separação de responsabilidades

Preserve a diferença entre:

```text
Incidente
    ↓
evento operacional
```

e:

```text
Notificação
    ↓
tentativa de comunicar esse evento
```

Incidente não deve possuir campos específicos de Telegram.

Não adicionar em Incidente:

```text
telegramChatId
telegramMessageId
telegramStatus
telegramSentAt
```

---

# 3. Relação com Incidente

Toda Notificação pertence obrigatoriamente a um Incidente.

No banco:

```text
notificacao.incidente_id
    FK -> incidente.id
```

A FK deve ser:

```text
NOT NULL
```

No Java, prefira:

```java
@ManyToOne(fetch = FetchType.LAZY)
```

Não adicione relacionamento bidirecional em Incidente apenas por antecipação.

Uma navegação:

```text
Notificacao -> Incidente
```

é suficiente.

---

# 4. Canal de Notificação

Crie enum controlado pela aplicação.

Exemplo:

```java
public enum CanalNotificacao {
    TELEGRAM
}
```

Mesmo sem envio real nesta etapa, TELEGRAM já pode existir como canal planejado.

No futuro:

```text
TELEGRAM
EMAIL
WEBHOOK
```

Não transforme CanalNotificacao em cadastro administrativo.

Canal representa capacidades implementadas pela aplicação.

Persistir como string:

```java
@Enumerated(EnumType.STRING)
```

Nunca ordinal.

---

# 5. Tipo de evento

Crie enum separado para representar o evento que originou a notificação.

Exemplo:

```java
public enum TipoEventoNotificacao {
    INCIDENTE_ABERTO,
    INCIDENTE_FECHADO
}
```

Isso é diferente do canal.

Exemplo:

```text
canal = TELEGRAM
tipoEvento = INCIDENTE_ABERTO
```

ou:

```text
canal = TELEGRAM
tipoEvento = INCIDENTE_FECHADO
```

---

# 6. Status da Notificação

Crie enum controlado pela aplicação.

Inicialmente:

```java
public enum StatusNotificacao {
    PENDENTE,
    ENVIANDO,
    ENVIADA,
    FALHA
}
```

Se `ENVIANDO` não for necessário nesta primeira versão por não existir dispatcher ainda, pode manter apenas:

```text
PENDENTE
ENVIADA
FALHA
```

Porém modele pensando na próxima etapa.

Documente a escolha.

Persistir como string.

---

# 7. Modelo inicial

A entidade Notificacao deverá possuir, no mínimo:

```text
id
incidente
canal
tipoEvento
status
tentativas
mensagem
erro
enviadoEm
createdAt
updatedAt
```

Avalie o padrão atual do projeto para nomes reais e timestamps.

---

# 8. Campo tentativas

Representa quantas tentativas de envio foram realizadas.

Nesta etapa, como envio real ainda não existe:

```text
tentativas = 0
```

na criação.

No Prompt 12 esse valor será incrementado pelo dispatcher.

Não permitir valor negativo.

---

# 9. Campo mensagem

Armazena o conteúdo lógico que deverá ser enviado.

Pode ser criado já nesta etapa ou apenas no Prompt 12.

Preferência nesta etapa:

criar a mensagem já no momento em que a Notificação é gerada, tornando o registro um snapshot do evento.

Exemplo:

```text
INCIDENTE ABERTO

Equipamento: SW-CORE-01
Monitor: ICMP principal
Início: 2026-08-19T12:00:00Z
```

Mas mantenha o conteúdo simples.

Não incluir secrets.

---

# 10. Snapshot da mensagem

A mensagem persistida deve representar o conteúdo no momento da criação da Notificação.

Se posteriormente:

```text
nome do equipamento
nome da unidade
nome do monitor
```

for alterado, a Notificação histórica não precisa ser reescrita.

Isso ajuda auditoria.

---

# 11. Campo erro

Opcional.

Utilizado futuramente quando uma tentativa de envio falhar.

Exemplos:

```text
Timeout ao enviar
HTTP 500
Falha de autenticação
```

Não armazenar stack trace completo.

Não armazenar token.

Na criação:

```text
erro = null
```

---

# 12. Campo enviadoEm

Quando:

```text
status != ENVIADA
```

deve ser:

```text
null
```

Quando:

```text
status = ENVIADA
```

deverá possuir timestamp.

Nesta etapa, como nenhum envio real ocorrerá, novas Notificações permanecerão:

```text
status = PENDENTE
enviadoEm = null
```

---

# 13. createdAt / updatedAt

Use o mesmo padrão consolidado no projeto.

Notificação é mutável porque no Prompt 12 poderá passar por:

```text
PENDENTE
    ↓
ENVIADA
```

ou:

```text
PENDENTE
    ↓
FALHA
```

Portanto `updatedAt` faz sentido.

---

# 14. Migration

Utilize Flyway.

Antes de criar:

1. liste migrations existentes;
2. identifique a última versão;
3. confirme tabela Incidente;
4. confirme tipo de PK;
5. confirme timestamps;
6. crie a próxima migration.

Exemplo conceitual:

```text
Vx__create_notificacao.sql
```

Nunca altere migration histórica já aplicada.

---

# 15. Estrutura conceitual da tabela

Algo equivalente a:

```text
notificacao
--------------------------------
id
incidente_id
canal
tipo_evento
status
tentativas
mensagem
erro
enviado_em
created_at
updated_at
```

Use nomes reais compatíveis com o padrão do banco.

---

# 16. Constraints

Garanta:

```text
incidente_id NOT NULL
canal NOT NULL
tipo_evento NOT NULL
status NOT NULL
tentativas NOT NULL
created_at NOT NULL
updated_at NOT NULL
```

Considere:

```text
tentativas >= 0
```

via CHECK.

Considere coerência:

```text
status = ENVIADA
    -> enviado_em IS NOT NULL
```

e:

```text
status != ENVIADA
    -> enviado_em pode ser NULL
```

Sem criar constraint excessivamente rígida se atrapalhar transições futuras.

---

# 17. Foreign key

Crie:

```text
notificacao.incidente_id
    -> incidente.id
```

Não utilize:

```text
ON DELETE CASCADE
```

Excluir Incidente não deve apagar notificações silenciosamente.

Como Incidente já não possui DELETE público, preserve histórico.

---

# 18. Índices

Considere índices para:

```text
incidente_id
status
canal
created_at
```

No mínimo, `incidente_id` é justificado.

Para futuro dispatcher, será comum buscar:

```text
status = PENDENTE
```

Então considere índice apropriado.

Evite excesso de índices.

---

# 19. Unicidade lógica

Evite gerar duplicatas para o mesmo evento/canal.

Por exemplo:

```text
Incidente 50
canal TELEGRAM
tipoEvento INCIDENTE_ABERTO
```

não deve ser criado duas vezes por processamento idempotente.

Implemente regra de unicidade lógica.

Considere constraint única equivalente a:

```text
(incidente_id, canal, tipo_evento)
```

Isso permite:

```text
INCIDENTE_ABERTO via TELEGRAM
INCIDENTE_FECHADO via TELEGRAM
```

para o mesmo incidente, mas impede duplicação do mesmo evento.

---

# 20. Garantia no banco

A unicidade deve ser protegida também no PostgreSQL quando apropriado.

Não dependa apenas de:

```text
existsBy...
```

para concorrência.

Aplicação deve retornar comportamento previsível.

---

# 21. Criação automática ao abrir Incidente

Quando o Incident Engine abrir um Incidente automaticamente:

após a criação bem-sucedida do Incidente, crie uma Notificação:

```text
canal = TELEGRAM
tipoEvento = INCIDENTE_ABERTO
status = PENDENTE
tentativas = 0
```

Nesta etapa isso apenas cria o registro.

NÃO envie Telegram.

---

# 22. Criação automática ao fechar Incidente

Quando o Incident Engine fechar um Incidente automaticamente:

crie:

```text
canal = TELEGRAM
tipoEvento = INCIDENTE_FECHADO
status = PENDENTE
tentativas = 0
```

Sem envio real.

---

# 23. Abertura manual

Quando Incidente for aberto manualmente via API:

também deve gerar Notificação pendente?

Preferência:

```text
SIM
```

porque a origem do incidente não deve mudar a necessidade de notificação.

Se o projeto possuir conceito diferente, documente.

A regra deve ficar na camada de domínio/serviço, não apenas no Incident Engine.

---

# 24. Fechamento manual

Da mesma forma, fechamento manual deve gerar:

```text
INCIDENTE_FECHADO
```

pendente.

Isso evita diferença de comportamento entre:

```text
fechamento automático
```

e:

```text
fechamento manual
```

---

# 25. Ponto correto de integração

Idealmente, a criação da Notificação deve acontecer na camada de serviço responsável pela transição do Incidente.

Exemplo conceitual:

```text
IncidenteService.open(...)
    ↓
Incidente criado
    ↓
NotificacaoService.createForIncidentOpened(...)
```

e:

```text
IncidenteService.close(...)
    ↓
Incidente fechado
    ↓
NotificacaoService.createForIncidentClosed(...)
```

Assim, tanto fluxo manual quanto automático reutilizam a mesma regra.

Não coloque criação de Notificação no Controller.

---

# 26. Transação

Avalie consistência transacional.

Preferência:

```text
Incidente criado/fechado
+
Notificação persistida
```

na mesma transação curta.

Assim evita:

```text
Incidente aberto
sem Notificação correspondente
```

se a persistência da Notificação falhar.

Porém não misture isso com operação de rede.

Nesta etapa não há envio externo.

---

# 27. Idempotência

Se a mesma operação de abertura/fechamento for processada duas vezes:

não crie Notificação duplicada.

A constraint de unicidade deve garantir isso.

Trate conflito de forma segura.

---

# 28. Service

Crie:

```text
NotificacaoService
```

ou equivalente.

Responsabilidades atuais:

```text
criar Notificação pendente
buscar por ID
listar
filtrar
```

Não implemente envio ainda.

Pode expor métodos internos:

```text
createIncidentOpenedNotification(...)
createIncidentClosedNotification(...)
```

ou solução equivalente.

Mantenha simples.

---

# 29. Repository

Crie:

```text
NotificacaoRepository
```

Prepare consultas para:

```text
por incidente
por canal
por tipoEvento
por status
por período
```

E futuramente:

```text
pendentes mais antigas primeiro
```

---

# 30. DTO de resposta

Crie:

```text
NotificacaoResponse
```

Exemplo:

```json
{
  "id": 100,
  "canal": "TELEGRAM",
  "tipoEvento": "INCIDENTE_ABERTO",
  "status": "PENDENTE",
  "tentativas": 0,
  "mensagem": "...",
  "erro": null,
  "enviadoEm": null,
  "incidente": {
    "id": 50,
    "status": "ABERTO"
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

Não exponha entidade JPA.

---

# 31. API de consulta

Implemente apenas consultas administrativas.

Sugestão:

```text
GET /api/v1/notificacoes
GET /api/v1/notificacoes/{id}
```

Não implemente POST público para criar Notificação arbitrária nesta etapa.

Notificações devem surgir de eventos do domínio.

---

# 32. GET por ID

```text
GET /api/v1/notificacoes/{id}
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

# 33. Listagem

```text
GET /api/v1/notificacoes
```

Sempre paginada.

Notificações acumulam histórico.

Ordenação default:

```text
createdAt DESC
```

com desempate por ID.

---

# 34. Filtro por Incidente

Suporte:

```text
GET /api/v1/notificacoes?incidenteId=50
```

---

# 35. Filtro por status

Suporte:

```text
GET /api/v1/notificacoes?status=PENDENTE
GET /api/v1/notificacoes?status=ENVIADA
GET /api/v1/notificacoes?status=FALHA
```

Status inválido:

```text
400 Bad Request
```

---

# 36. Filtro por canal

Suporte:

```text
GET /api/v1/notificacoes?canal=TELEGRAM
```

Canal inválido:

```text
400 Bad Request
```

---

# 37. Filtro por tipo de evento

Suporte:

```text
GET /api/v1/notificacoes?tipoEvento=INCIDENTE_ABERTO
```

ou:

```text
INCIDENTE_FECHADO
```

---

# 38. Filtro por período

Suporte:

```text
inicio
fim
```

aplicados a `createdAt`.

Use `Instant`.

Valide:

```text
inicio <= fim
```

---

# 39. Combinação de filtros

Permita combinar:

```text
incidenteId
status
canal
tipoEvento
inicio
fim
```

Reutilize o padrão existente de filtros/paginação.

Não crie infraestrutura nova desnecessariamente.

---

# 40. Mensagem de INCIDENTE_ABERTO

Implemente uma formatação simples e centralizada.

Exemplo conceitual:

```text
🚨 Incidente aberto

Unidade: Matriz
Equipamento: SW-CORE-01
IP: 10.0.0.10
Monitor: ICMP principal
Início: 2026-08-19T12:00:00Z
```

A presença de emoji é opcional.

Mais importante:

* mensagem clara;
* curta;
* determinística;
* sem secrets.

---

# 41. Mensagem de INCIDENTE_FECHADO

Exemplo:

```text
✅ Incidente encerrado

Unidade: Matriz
Equipamento: SW-CORE-01
Monitor: ICMP principal
Início: ...
Fim: ...
```

Se for simples, inclua duração calculada.

Mas não persista duração como novo campo.

---

# 42. Horário da mensagem

Persistência continua em UTC/Instant.

Não introduza timezone fixo dentro do domínio.

Se a mensagem precisar de formatação humana local no futuro, isso poderá ser configurado no Prompt 12.

Nesta etapa, formato ISO-8601 é aceitável.

---

# 43. Message builder

Pode criar componente simples:

```text
NotificationMessageBuilder
```

ou equivalente.

Não crie template engine.

Não introduza Thymeleaf/Freemarker apenas para isso.

---

# 44. N+1

Para montar mensagens/respostas poderá ser necessário acessar:

```text
Notificacao
 -> Incidente
 -> Monitor
 -> Equipamento
 -> Unidade
```

Evite N+1 nas listagens.

Não torne relações EAGER globalmente.

Use estratégia explícita já consolidada.

---

# 45. DELETE de Incidente

Incidente já não deve possuir DELETE público.

Com a FK de Notificação, preserve essa regra.

Não implemente cascade.

---

# 46. Não alterar Incident Engine desnecessariamente

O Incident Engine deve continuar responsável por:

```text
Medição
 ↓
Incidente
```

Não transforme o processor em:

```text
Medição
 ↓
Incidente
 ↓
Telegram
```

Apenas utilize IncidenteService de forma que a regra de criação da Notificação ocorra centralmente.

---

# 47. Não enviar Telegram

Não faça:

```text
HTTP request
RestClient
WebClient
Telegram Bot API
```

nesta etapa.

Nenhuma comunicação externa.

---

# 48. Não configurar token ainda

Não adicione obrigatoriamente:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

nesta etapa.

Isso será Prompt 12.

---

# 49. Não criar scheduler de Notificação

Não crie:

```text
@Scheduled
```

para pendentes nesta etapa.

O dispatcher virá depois.

---

# 50. Não implementar retry

Não implemente lógica de:

```text
tentativa 1
tentativa 2
backoff
retry
```

agora.

Apenas prepare os campos persistentes.

---

# 51. Não implementar múltiplos destinatários

Nesta primeira versão, Notificação representa tentativa por canal.

Não modele ainda:

```text
destinatario
grupo
chatId
lista de emails
```

O canal Telegram poderá usar configuração global inicial.

Se o projeto já possuir requisito por Unidade, documente sem antecipar.

---

# 52. Não implementar preferências de alerta

Não crie ainda:

```text
alerta habilitado por unidade
alerta habilitado por monitor
quiet hours
severity routing
```

Esses recursos podem vir depois.

---

# 53. Testes de Service

Cubra no mínimo:

```text
criar notificação INCIDENTE_ABERTO

criar notificação INCIDENTE_FECHADO

status inicial PENDENTE

tentativas iniciais 0

enviadoEm inicial null

não duplicar mesma combinação incidente/canal/tipoEvento

buscar notificação existente

buscar inexistente

listar por incidente

listar por status

listar por canal

listar por tipoEvento
```

---

# 54. Testes de integração com Incidente

Cubra:

```text
abrir Incidente manualmente
↓
Notificação INCIDENTE_ABERTO criada
```

```text
fechar Incidente manualmente
↓
Notificação INCIDENTE_FECHADO criada
```

E fluxo automático:

```text
Incident Engine abre Incidente
↓
Notificação pendente criada
```

```text
Incident Engine fecha Incidente
↓
Notificação de fechamento criada
```

Sem Telegram real.

---

# 55. Teste de idempotência

Garanta que processamento repetido não crie:

```text
2 notificações TELEGRAM / INCIDENTE_ABERTO
```

para o mesmo Incidente.

---

# 56. Teste da constraint

Se possível, teste em nível de banco a unicidade:

```text
incidente_id
canal
tipo_evento
```

Não dependa apenas de mock.

---

# 57. Testes de Controller

Cubra:

```text
GET existente -> 200
GET inexistente -> 404
GET lista -> 200
filtro incidente -> 200
filtro status -> 200
filtro canal -> 200
filtro tipoEvento -> 200
filtro temporal inválido -> 400
```

Não há POST público de Notificação nesta etapa.

---

# 58. Performance

Notificações crescerão menos que Medições, mas são histórico.

Use:

```text
paginação
índices
ordenação determinística
fetch adequado
```

---

# 59. Migration x JPA

Garanta compatibilidade com:

```text
ddl-auto=validate
```

Revise:

```text
enum strings
FK
nullable
varchar
timestamps
unique constraint
CHECK tentativas
```

---

# 60. Inspeção inicial

Antes de modificar:

```bash
pwd
git status
```

Analise principalmente:

```text
Incidente
IncidenteService
IncidentProcessor
Monitor
Equipamento
Unidade
migrations
tratamento de erros
paginação
filtros
testes
```

---

# 61. Sequência sugerida

```text
1. analisar repositório
2. modelar Notificação
3. criar migration
4. criar enums
5. criar entity
6. criar repository
7. criar message builder
8. criar service
9. integrar IncidenteService
10. criar GET API
11. filtros/paginação
12. testes
13. mvn test
14. mvn verify
15. revisar git diff
```

---

# 62. Git

Não execute:

```text
git commit
git push
git reset --hard
git clean -fd
git checkout .
```

Ao final:

```bash
git status
git diff
```

---

# 63. Build e testes

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

# 64. Revisão final

Revise explicitamente:

```text
FK Incidente
enums como string
status inicial
tentativas
unicidade lógica
mensagem snapshot
paginação
filtros
N+1
integração abertura
integração fechamento
nenhum envio externo
nenhum token Telegram
nenhum scheduler de retry
```

---

# 65. Critérios de aceite

A feature estará concluída quando:

* existir migration de Notificação;
* Notificação possuir FK obrigatória para Incidente;
* não existir cascade delete;
* CanalNotificacao for enum persistido como string;
* TipoEventoNotificacao existir;
* StatusNotificacao existir;
* nova Notificação iniciar PENDENTE;
* tentativas iniciar 0;
* enviadoEm iniciar null;
* abertura de Incidente gerar INCIDENTE_ABERTO;
* fechamento de Incidente gerar INCIDENTE_FECHADO;
* fluxo manual e automático reutilizarem a mesma regra;
* duplicidade por incidente/canal/evento for impedida;
* GET por ID funcionar;
* listagem for paginada;
* filtros funcionarem;
* mensagens forem persistidas;
* nenhum envio Telegram real ocorrer;
* testes passarem;
* build passar.

---

# 66. Resposta final

Ao concluir, apresente:

```text
RESUMO

...


CONTEXTO UTILIZADO

- codexcontex.md
- Incident Engine
- Incidente
- Monitor
- Equipamento
- Unidade
- migrations existentes


MODELO NOTIFICAÇÃO

Campos:
...


ENUMS

CanalNotificacao:
...

TipoEventoNotificacao:
...

StatusNotificacao:
...


RELACIONAMENTO

Notificacao -> Incidente:
...


MIGRATION

Arquivo:
...

Constraints:
...

Índices:
...


UNICIDADE / IDEMPOTÊNCIA

...


INTEGRAÇÃO COM INCIDENTE

Abertura:
...

Fechamento:
...


MENSAGENS

INCIDENTE_ABERTO:
...

INCIDENTE_FECHADO:
...


ENDPOINTS

GET /api/v1/notificacoes
GET /api/v1/notificacoes/{id}


FILTROS

...


PAGINAÇÃO

...


ESTRATÉGIA CONTRA N+1

...


ARQUIVOS CRIADOS

...


ARQUIVOS ALTERADOS

...


ALTERAÇÕES EM INCIDENTE

...


ALTERAÇÕES NO INCIDENT ENGINE

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

- nenhuma notificação é enviada externamente;
- TELEGRAM é apenas um canal persistido/preparado;
- retry/dispatcher ainda não existem.


PRÓXIMO PASSO RECOMENDADO

Implementar dispatcher Telegram para processar Notificações PENDENTES.

Não implemente nesta etapa.
```

---

# 67. Princípio principal

Preserve:

```text
Incidente
    ↓
evento de domínio

Notificação
    ↓
registro persistente de comunicação

Dispatcher
    ↓
envio externo futuro

Telegram
    ↓
primeiro canal real
```

Não acople Incidente diretamente ao Telegram.

O domínio de Notificação deve permitir futuramente:

```text
TELEGRAM
EMAIL
WEBHOOK
```

sem redesenhar Incidente.

Agora analise o estado atual do repositório e implemente integralmente o domínio Notificação, sem realizar qualquer envio externo.

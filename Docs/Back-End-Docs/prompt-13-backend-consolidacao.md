# Prompt 13 — Consolidação e Validação End-to-End do Backend

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
Notificação
Telegram Dispatcher
```

realize agora uma etapa de:

# CONSOLIDAÇÃO DO BACKEND

IMPORTANTE:

O objetivo desta tarefa NÃO é adicionar novas funcionalidades de negócio.

O objetivo é:

```text
REVISAR
VALIDAR
INTEGRAR
CORRIGIR
TESTAR
CONSOLIDAR
```

o que já foi implementado.

Não implemente ainda:

```text
Dashboard
novos endpoints agregados
Angular
autenticação
JWT
usuários
novos tipos de Monitor
SNMP
HTTP Monitor
TCP Monitor
Email
Webhook
deploy de produção
```

---

# 2. Objetivo principal

Validar se o backend funciona de forma consistente como um único sistema.

O fluxo completo atual deve ser equivalente a:

```text
Unidade
   ↓
Equipamento ← TipoEquipamento
   ↓
Monitor
   ↓
Monitoring Engine ICMP
   ↓
Medição
   ↓
Incident Engine
   ↓
Incidente
   ↓
Notificação
   ↓
Telegram Dispatcher
```

Cada etapa deve continuar respeitando sua responsabilidade.

---

# 3. Princípio desta tarefa

Não faça refactors amplos apenas por preferência estética.

Corrija:

```text
bugs reais
inconsistências
duplicações perigosas
problemas de integridade
problemas de performance óbvios
quebras de contrato
falhas de testes
problemas de transação
problemas de segurança
```

Evite:

```text
renomear o projeto inteiro
mover todos os packages
introduzir nova arquitetura
criar framework interno genérico
alterar endpoints sem necessidade
```

---

# 4. Inspeção inicial

Antes de modificar qualquer arquivo:

```bash
pwd
git status
```

Analise:

```text
pom.xml
application.yml
application-*.yml
README*
compose.yml
docker-compose.yml

src/main/java
src/main/resources
src/main/resources/db/migration
src/test
```

Mapeie todos os módulos existentes.

---

# 5. Estado do Git

Identifique:

```text
arquivos alterados
arquivos não rastreados
mudanças locais
```

Não sobrescreva alterações existentes do desenvolvedor.

Não execute:

```text
git reset --hard
git clean -fd
git checkout .
git commit
git push
```

---

# 6. Inventário arquitetural

Antes de corrigir, identifique a estrutura atual dos módulos:

```text
Unidade
TipoEquipamento
Equipamento
Monitor
Medição
Incidente
Notificação
Monitoring Engine
Incident Engine
Telegram
```

Para cada um, identifique:

```text
Entity
DTOs
Repository
Service
Controller
Enums
Config
Tests
Migrations
```

---

# 7. Banco de dados — migrations

Revise todas as migrations em ordem.

Verifique:

```text
ordem
nomes
dependências
foreign keys
constraints
índices
defaults
enum strings
NOT NULL
CHECK
unicidade
```

Nunca edite migration histórica apenas para “arrumar”.

Se existir correção necessária:

```text
crie nova migration
```

---

# 8. Validação do banco do zero

Crie ou utilize um PostgreSQL limpo.

Valide que:

```text
Flyway
```

consegue executar todas as migrations:

```text
V1
V2
V3
...
Vn
```

do zero até o estado atual.

Não dependa de banco já migrado.

---

# 9. Schema final

Depois das migrations, valide que o schema final representa corretamente:

```text
Unidade

TipoEquipamento

Equipamento
  -> Unidade
  -> TipoEquipamento

Monitor
  -> Equipamento

Medição
  -> Monitor

Incidente
  -> Monitor

Notificação
  -> Incidente
```

---

# 10. Cascade delete

Revise todas as foreign keys.

Não deve haver perda silenciosa de histórico através de:

```text
ON DELETE CASCADE
```

em relações como:

```text
Unidade -> Equipamento
TipoEquipamento -> Equipamento
Equipamento -> Monitor
Monitor -> Medição
Monitor -> Incidente
Incidente -> Notificação
```

Se algum cascade indevido existir, corrija através de nova migration.

---

# 11. Exclusão física

Revise os DELETEs administrativos existentes.

Garanta comportamento consistente.

Exemplos:

```text
Unidade com Equipamento -> 409

TipoEquipamento com Equipamento -> 409

Equipamento com Monitor -> 409

Monitor com Medição -> 409

Monitor com Incidente -> 409
```

Incidente e Medição não devem possuir DELETE público se essa foi a decisão consolidada.

Não exponha SQL ao cliente.

---

# 12. ddl-auto

Confirme que o projeto utiliza estratégia equivalente a:

```text
ddl-auto: validate
```

Não utilizar:

```text
update
create
create-drop
```

como mecanismo normal.

---

# 13. JPA x schema

Compare cada Entity com migration correspondente.

Verifique:

```text
tipo da PK
varchar lengths
nullable
boolean
timestamps
enums
join columns
FK
```

A aplicação deve iniciar sem erro de schema validation.

---

# 14. Relacionamentos JPA

Revise:

```text
Equipamento -> Unidade
Equipamento -> TipoEquipamento
Monitor -> Equipamento
Medicao -> Monitor
Incidente -> Monitor
Notificacao -> Incidente
```

Prefira:

```java
@ManyToOne(fetch = FetchType.LAZY)
```

quando apropriado.

Não transforme tudo em EAGER.

---

# 15. Cascade JPA

Revise todos os relacionamentos.

Não utilizar indevidamente:

```text
CascadeType.ALL
CascadeType.REMOVE
```

em relações de histórico.

---

# 16. API não deve expor Entity

Revise todos os Controllers.

Nenhum endpoint deve retornar diretamente:

```text
@Entity
```

como contrato da API.

Use DTOs.

Isso evita:

```text
lazy loading
recursão
acoplamento JPA/API
vazamento de campos
```

---

# 17. Contratos REST

Mapeie todos os endpoints existentes.

Verifique consistência de:

```text
/api/v1
pluralização
status HTTP
DTOs
erros
paginação
filtros
```

Não altere rota funcionando apenas por preferência.

Corrija apenas inconsistências evidentes.

---

# 18. Status HTTP

Valide comportamento:

```text
POST criado -> 201

GET -> 200

PUT -> 200

PATCH -> 200 ou padrão consolidado

DELETE -> 204

validação -> 400

não encontrado -> 404

conflito de negócio/integridade -> 409
```

---

# 19. Tratamento global de erros

Revise `@RestControllerAdvice`.

Garanta resposta consistente para:

```text
Bean Validation
resource not found
business conflict
data integrity
enum inválido
request malformado
erro interno
```

Não exponha:

```text
stack trace
SQL
constraint interna
Hibernate exception
token
```

---

# 20. Erro 500

Revise se situações conhecidas estão caindo indevidamente em:

```text
500 Internal Server Error
```

Exemplos:

```text
FK impedindo DELETE
nome duplicado
recurso inexistente
enum inválido
```

Corrija para status adequado quando necessário.

---

# 21. Timestamps

Revise uso de:

```text
Instant
```

e estratégia UTC.

Evite mistura desnecessária com:

```text
LocalDateTime
Date
Calendar
```

para instantes absolutos.

---

# 22. Paginação

Revise endpoints potencialmente volumosos:

```text
Equipamento
Monitor
Medição
Incidente
Notificação
```

Garanta paginação adequada.

Principalmente:

```text
Medição
```

nunca deve retornar histórico ilimitado.

---

# 23. Limite de page size

Se houver suporte:

```text
size
```

avalie limite máximo.

Evite:

```text
size=1000000
```

causar resposta enorme.

Não crie infraestrutura exagerada.

---

# 24. Ordenação determinística

Revise listagens.

Exemplos:

```text
Unidade -> nome ASC

TipoEquipamento -> nome ASC

Equipamento -> padrão estável

Monitor -> padrão estável

Medição -> executadoEm DESC, id DESC

Incidente -> iniciadoEm DESC, id DESC

Notificação -> createdAt DESC, id DESC
```

Use convenção atual quando adequada.

---

# 25. Filtros

Valide filtros existentes.

Equipamento:

```text
unidadeId
tipoEquipamentoId
ativo
```

Monitor:

```text
equipamentoId
tipo
ativo
```

Medição:

```text
monitorId
status
inicio
fim
```

Incidente:

```text
monitorId
equipamentoId
unidadeId
status
inicio
fim
```

Notificação:

```text
incidenteId
status
canal
tipoEvento
inicio
fim
```

---

# 26. Combinação de filtros

Valide combinações.

Não teste apenas filtros isolados.

Exemplo:

```text
equipamentos?
unidadeId=1
&tipoEquipamentoId=2
&ativo=true
```

deve produzir resultado coerente.

---

# 27. N+1

Revise explicitamente queries de listagem.

Preste atenção em:

```text
Equipamento -> Unidade / Tipo

Monitor -> Equipamento

Medição -> Monitor

Incidente -> Monitor -> Equipamento -> Unidade

Notificação -> Incidente -> Monitor -> Equipamento -> Unidade
```

Evite padrão:

```text
1 + N + N
```

Não resolva globalmente com EAGER.

Use estratégia explícita já adotada:

```text
EntityGraph
JOIN FETCH
projection
```

---

# 28. Query count

Quando viável, adicione ou utilize testes capazes de revelar N+1 nos fluxos críticos.

Não é necessário criar infraestrutura sofisticada.

Mas revise SQL/queries geradas de forma consciente.

---

# 29. Monitoring Engine

Revise a implementação do engine ICMP.

Confirme:

```text
scheduler central
intervalo respeitado
pool limitado
Equipamento inativo ignorado
Monitor inativo ignorado
sem execução duplicada do mesmo Monitor
timeout
limpeza de lock em finally
engine desabilitável
```

---

# 30. ICMP

Revise segurança da execução.

Se utiliza processo externo:

```text
ProcessBuilder
```

com argumentos separados.

Não deve existir:

```text
sh -c
Runtime.exec("ping " + ip)
```

---

# 31. Transações no ICMP

Confirme que nenhuma transaction permanece aberta durante:

```text
ping
timeout
espera de processo
```

Operações de rede devem ficar fora de transações longas.

---

# 32. Falha de um Monitor

Garanta:

```text
falha em um Monitor
```

não interrompe execução de outros.

Uma exception interna deve ser isolada.

---

# 33. Monitor sem IP

Valide comportamento.

Não derrubar scheduler.

Não executar comando inválido.

Não criar Incidente automaticamente por erro administrativo de configuração, salvo regra explícita.

---

# 34. Medição

Revise que:

```text
Medição
```

é histórico.

Não possui update arbitrário.

Garanta:

```text
SUCESSO
FALHA
latenciaMs
executadoEm
```

coerentes.

---

# 35. Incident Engine

Revise thresholds:

```text
falhasParaIncidente
sucessosParaRecovery
```

Valide defaults, migration e constraints.

---

# 36. Abertura automática

Teste:

```text
threshold = 3

FALHA
FALHA
```

não abre.

Depois:

```text
FALHA
```

abre.

---

# 37. iniciadoEm

Garanta que:

```text
iniciadoEm
```

corresponda à primeira falha da sequência que disparou o incidente.

Não ao horário arbitrário de processamento.

---

# 38. Recovery

Teste:

```text
sucessosParaRecovery = 2
```

Um sucesso não fecha.

Dois consecutivos fecham.

---

# 39. encerradoEm

Garanta:

```text
encerradoEm
```

igual ao timestamp da Medição que completou recovery.

---

# 40. Sequência interrompida

Teste:

```text
FALHA
FALHA
SUCESSO
FALHA
FALHA
FALHA
```

O incidente só deve abrir na última sequência.

---

# 41. Incidente aberto único

Garanta aplicação + PostgreSQL protegendo:

```text
máximo um Incidente ABERTO por Monitor
```

Teste a constraint real quando possível.

---

# 42. Idempotência Incident Engine

Processamento repetido não deve:

```text
duplicar incidente
alterar fechamento já consolidado
```

---

# 43. Notificação

Revise criação automática:

```text
Incidente ABERTO
    ↓
INCIDENTE_ABERTO / TELEGRAM / PENDENTE
```

```text
Incidente FECHADO
    ↓
INCIDENTE_FECHADO / TELEGRAM / PENDENTE
```

---

# 44. Fluxo manual x automático

Garanta que:

```text
abertura manual
abertura automática
```

gerem Notificação de forma consistente.

O mesmo para fechamento.

---

# 45. Unicidade de Notificação

Garanta:

```text
incidente_id + canal + tipo_evento
```

não duplicado.

Banco deve ser garantia final.

---

# 46. Mensagem snapshot

Confirme que Notificação usa mensagem persistida.

Não reconstruir a mensagem no Telegram Dispatcher.

---

# 47. Telegram Dispatcher

Revise:

```text
dispatcher enabled
telegram enabled
batch
pool
maxAttempts
backoff
proximaTentativaEm
HTTP timeout
```

---

# 48. Secrets Telegram

Confirme:

```text
token
chatId
```

não estão hardcoded.

Token não pode estar:

```text
banco
logs
README com valor real
git
test fixtures reais
```

---

# 49. Configuração

Confirme comportamento:

```text
telegram disabled + sem token
→ aplicação inicia
```

Se Telegram enabled:

```text
token/chatId ausentes
→ erro claro
```

sem revelar secret.

---

# 50. Dispatcher disabled

Com:

```text
notification.dispatcher.enabled=false
```

nenhuma notificação deve ser enviada.

---

# 51. Retry

Valide:

```text
tentativas
maxAttempts
backoff
proximaTentativaEm
```

Sem:

```text
Thread.sleep()
```

para retry.

---

# 52. Telegram indisponível

Simule:

```text
timeout
500
429
```

Backend deve continuar funcional.

Monitoring Engine não deve ser afetado.

---

# 53. Entrega at-least-once

Confirme documentação da limitação:

```text
Telegram pode receber
backend pode cair antes de marcar ENVIADA
```

portanto envio pode ser duplicado nesse caso.

Não implementar exactly-once nesta tarefa.

---

# 54. Pools separados

Confirme que:

```text
Monitoring Engine
```

e:

```text
Telegram Dispatcher
```

não disputam o mesmo executor de forma perigosa.

Se existirem pools próprios, valide tamanhos e shutdown.

---

# 55. Schedulers nos testes

Garanta que testes comuns não iniciem:

```text
Monitoring Engine real
Telegram Dispatcher real
```

Profiles de teste devem desligá-los por padrão.

---

# 56. Testes sem rede

Nenhum teste automatizado deve depender de:

```text
internet
api.telegram.org
8.8.8.8
rede corporativa
```

Use mocks/fakes.

---

# 57. Configuração PostgreSQL de teste

Revise estratégia.

Se Testcontainers/PostgreSQL real já é utilizado, preserve.

Se H2 estiver sendo utilizado para comportamento PostgreSQL específico, verifique se há risco de falso positivo.

Não altere infraestrutura inteira sem necessidade.

---

# 58. Teste de migrations

Adicione ou execute teste que valide Flyway em banco limpo.

Idealmente PostgreSQL compatível.

---

# 59. Teste de contexto

Confirme:

```text
contextLoads
```

ou equivalente.

A aplicação deve iniciar com configuração de teste.

---

# 60. Teste end-to-end interno

Crie um teste integrado de domínio sem rede real.

Fluxo:

```text
Criar Unidade
    ↓
Criar TipoEquipamento
    ↓
Criar Equipamento
    ↓
Criar Monitor ICMP
    ↓
Persistir FALHAS suficientes
    ↓
Incident Processor
    ↓
Incidente ABERTO
    ↓
Notificação INCIDENTE_ABERTO PENDENTE
```

Depois:

```text
Persistir SUCESSOS suficientes
    ↓
Incidente FECHADO
    ↓
Notificação INCIDENTE_FECHADO PENDENTE
```

---

# 61. Teste de Telegram fake

Complete o fluxo com client fake/mock:

```text
Notificação PENDENTE
    ↓
Dispatcher
    ↓
Telegram fake retorna sucesso
    ↓
Notificação ENVIADA
```

Sem rede real.

---

# 62. Teste end-to-end de falha

Simule Telegram indisponível.

Valide:

```text
Medição permanece
Incidente permanece
Notificação entra em retry/FALHA
Monitoring Engine permanece funcional
```

---

# 63. Cenário completo esperado

O sistema deve ser capaz de representar:

```text
Unidade:
Matriz

Tipo:
Switch

Equipamento:
SW-CORE-01
10.0.0.1

Monitor:
ICMP principal
intervalo = 60
timeout = 2000
falhasParaIncidente = 3
sucessosParaRecovery = 2
```

Sequência:

```text
FALHA
FALHA
FALHA
```

Resultado:

```text
Incidente ABERTO
Notificação INCIDENTE_ABERTO PENDENTE
```

Dispatcher:

```text
Telegram enviado
Notificação ENVIADA
```

Depois:

```text
SUCESSO
SUCESSO
```

Resultado:

```text
Incidente FECHADO
Notificação INCIDENTE_FECHADO PENDENTE
```

Dispatcher:

```text
Telegram recovery enviado
Notificação ENVIADA
```

---

# 64. Não utilizar ping real no teste end-to-end

O resultado ICMP deve ser simulado.

O objetivo é testar integração entre camadas.

---

# 65. README

Revise README.

Deve explicar de forma objetiva:

```text
requisitos
Java
PostgreSQL
variáveis de ambiente
como iniciar banco
como rodar migrations
como iniciar backend
como rodar testes
Monitoring Engine config
Telegram config
health endpoint
```

---

# 66. README de arquitetura

Adicione uma seção curta com fluxo:

```text
Equipamento
 -> Monitor
 -> Medição
 -> Incidente
 -> Notificação
 -> Telegram
```

Não transforme README em documentação de centenas de páginas.

---

# 67. Configurações órfãs

Procure propriedades:

```text
não utilizadas
duplicadas
com nomes inconsistentes
```

Remova apenas se tiver certeza de que são obsoletas e relacionadas às features atuais.

---

# 68. Dependências Maven

Revise `pom.xml`.

Procure:

```text
dependências não utilizadas
dependências duplicadas
bibliotecas introduzidas sem necessidade
```

Não faça upgrade geral de versões nesta tarefa.

Preserve versões gerenciadas pelo Spring Boot.

---

# 69. Lombok / MapStruct

Não introduza nessa fase apenas para refactor.

Se não existem, continue sem eles.

---

# 70. Logs

Revise níveis de log.

Evite:

```text
INFO para cada ping
INFO para cada medição
INFO para polling vazio
```

Evite volume excessivo.

Use DEBUG para eventos frequentes.

---

# 71. Dados sensíveis em logs

Procure possíveis vazamentos:

```text
token Telegram
credenciais DB
chat ID se considerado sensível
payload completo desnecessário
```

Corrija.

---

# 72. Security scan básico

Procure no repositório por:

```text
password=
token=
secret=
TELEGRAM_BOT_TOKEN com valor
```

e equivalentes.

Não apagar exemplos vazios legítimos.

Garanta ausência de secrets reais.

---

# 73. Health

Valide Actuator.

Health da aplicação deve refletir:

```text
aplicação
PostgreSQL
```

Uma falha de ICMP ou Telegram não deve tornar health global DOWN, salvo se já houver estratégia deliberada diferente.

---

# 74. Startup sem Telegram

Aplicação deve iniciar em ambiente de desenvolvimento/teste com Telegram desabilitado.

---

# 75. Startup sem Monitoring Engine

Aplicação deve iniciar com engine desabilitado.

---

# 76. Startup completo

Quando configurações necessárias estiverem presentes, aplicação deve iniciar com:

```text
Monitoring Engine habilitado
Dispatcher habilitado
Telegram habilitado
```

sem erro de configuração.

Não é necessário fazer envio real no teste automatizado.

---

# 77. Concorrência

Revise estruturas thread-safe usadas por:

```text
runningMonitors
runningNotifications
```

Garanta remoção em `finally`.

---

# 78. Rejeição de executor

Valide que saturação/rejeição não deixa IDs presos permanentemente.

---

# 79. Shutdown

Executors gerenciados devem encerrar corretamente no shutdown Spring.

Evite threads criadas manualmente sem lifecycle.

---

# 80. Transações longas

Revise:

```text
ICMP
Telegram
```

Nenhuma operação externa deve ocorrer dentro de transação longa.

---

# 81. LazyInitializationException

Execute testes de API.

Garanta que DTO mapping não depende de sessão aberta acidentalmente.

Se OSIV estiver habilitado por default, não dependa dele como solução arquitetural.

Avalie configurar explicitamente conforme estratégia atual.

Não faça alteração global sem testar.

---

# 82. Open Session in View

Verifique configuração atual.

Se a aplicação depende de OSIV para serializar DTOs, isso é sinal de problema.

Controllers devem receber DTOs já preparados.

Se tecnicamente seguro, prefira:

```text
spring.jpa.open-in-view=false
```

mas somente altere se testes confirmarem que camada de serviço/fetch está correta.

Documente a decisão.

---

# 83. Índices

Revise índices com base em consultas reais.

Especial atenção:

```text
equipamento.unidade_id
equipamento.tipo_equipamento_id

monitor.equipamento_id

medicao.monitor_id + executado_em

incidente.monitor_id + iniciado_em
incidente aberto

notificacao.incidente_id
fila PENDENTE/proxima_tentativa
```

---

# 84. Índices redundantes

Não crie índices duplicados por acidente.

Revise constraints UNIQUE que já criam índice.

---

# 85. Consultas do scheduler

Revise custo do:

```text
Monitoring Scheduler
```

Não consultar histórico inteiro.

Não gerar N+1 por Monitor.

---

# 86. Consultas do dispatcher

Revise polling.

Buscar somente lote elegível.

Não carregar toda tabela Notificacao a cada segundo.

---

# 87. Queries do Incident Processor

Deve buscar apenas:

```text
Incidente aberto
+
últimas N Medições necessárias
```

Não histórico inteiro.

---

# 88. Correções

Ao encontrar problema:

1. escreva ou ajuste teste que demonstre o problema quando apropriado;
2. implemente correção mínima;
3. execute testes novamente.

Evite refactor sem teste em partes críticas.

---

# 89. Novas migrations

Somente crie migration se houver problema real de schema.

Exemplos aceitáveis:

```text
constraint faltante
índice necessário
coluna incompatível
correção de schema
```

Não crie migration apenas para mudar estilo.

---

# 90. Test suite completa

Execute toda suíte.

Se houver wrapper:

```bash
./mvnw test
```

Depois:

```bash
./mvnw verify
```

Não execute apenas testes novos.

---

# 91. Build

O build deve concluir com sucesso.

Se houver plugins adicionais:

```text
checkstyle
spotbugs
jacoco
```

execute o lifecycle já configurado.

Não introduza novas ferramentas obrigatórias nesta tarefa.

---

# 92. Aplicação

Se possível no ambiente local de desenvolvimento:

suba PostgreSQL limpo e inicialize a aplicação.

Valide:

```text
Flyway OK
Hibernate validate OK
contexto Spring OK
Actuator health OK
```

---

# 93. Smoke test da API

Se possível, execute smoke tests dos endpoints principais.

Exemplos:

```text
POST unidade
POST tipo
POST equipamento
POST monitor

GET equipamentos
GET monitores
GET medicoes
GET incidentes
GET notificacoes
```

Não é obrigatório criar scripts permanentes se já existirem testes equivalentes.

---

# 94. Contrato para frontend

Sem criar endpoints novos, documente quais endpoints atuais estão prontos para o frontend.

Liste:

```text
Unidades
Tipos
Equipamentos
Monitores
Medições
Incidentes
Notificações
```

e seus filtros principais.

---

# 95. Não implementar Dashboard

Mesmo se perceber que Angular precisará de agregações:

NÃO crie ainda:

```text
/dashboard
/overview
/stats
```

Apenas documente as necessidades encontradas.

Isso será Prompt 14.

---

# 96. Não implementar autenticação

Não introduza:

```text
Spring Security
JWT
login
roles
```

nesta tarefa.

Apenas documente se a ausência de segurança impacta exposição futura.

---

# 97. Critérios de aceite

A consolidação estará concluída quando:

* migrations rodarem do zero;
* schema validar com JPA;
* build passar;
* toda suíte de testes passar;
* relações possuírem integridade;
* não houver cascade delete perigoso;
* APIs usarem DTOs;
* erros conhecidos não vazarem como 500/SQL;
* paginação estiver adequada;
* filtros principais funcionarem;
* não houver N+1 óbvio nas listagens críticas;
* Monitoring Engine estiver isolado;
* ICMP não usar transação longa;
* Incident Engine respeitar thresholds;
* Incidente aberto único estiver protegido;
* Notificações forem idempotentes;
* Telegram Dispatcher possuir retry/backoff;
* secrets não estiverem no código;
* testes não usarem internet;
* fluxo end-to-end interno estiver coberto;
* README estiver atualizado;
* nenhuma feature nova fora de escopo tiver sido adicionada.

---

# 98. Resposta final

Ao concluir, apresente:

```text
RESUMO EXECUTIVO

Estado geral do backend:
...


ARQUITETURA VALIDADA

Unidade
 -> Equipamento
 -> Monitor
 -> Medição
 -> Incidente
 -> Notificação
 -> Telegram

...


MIGRATIONS

Quantidade:
...

Execução do zero:
...

Problemas encontrados:
...

Migrations novas criadas:
...


SCHEMA / JPA

Resultado ddl-auto=validate:
...


INTEGRIDADE REFERENCIAL

...


API

Endpoints revisados:
...

Inconsistências corrigidas:
...


TRATAMENTO DE ERROS

...


PAGINAÇÃO E FILTROS

...


N+1 / PERFORMANCE

Problemas encontrados:
...

Correções:
...


MONITORING ENGINE

Scheduler:
...

Concorrência:
...

ICMP:
...

Transações:
...


INCIDENT ENGINE

Threshold:
...

Recovery:
...

Idempotência:
...

Concorrência:
...


NOTIFICAÇÃO

Criação:
...

Unicidade:
...


TELEGRAM

Dispatcher:
...

Retry:
...

Timeout:
...

Secrets:
...


TESTE END-TO-END

Fluxo testado:
...

Resultado:
...


TESTES

Comando:
...

Quantidade/resultados:
...


BUILD

Comando:
...

Resultado:
...


HEALTH

...


README

Alterações:
...


ARQUIVOS CRIADOS

...


ARQUIVOS ALTERADOS

...


GIT STATUS

...


GIT DIFF

Resumo:
...


BUGS ENCONTRADOS E CORRIGIDOS

1.
2.
...


PROBLEMAS REMANESCENTES

...


DÉBITOS TÉCNICOS RELEVANTES

Liste apenas débitos reais.


RISCO PARA PRODUÇÃO

Baixo / Médio / Alto

Justificativa:
...


CONTRATOS PRONTOS PARA FRONTEND

...


NECESSIDADES IDENTIFICADAS PARA DASHBOARD

Documente apenas.

Não implemente.


PRÓXIMO PASSO RECOMENDADO

Prompt 14 — API de Dashboard e consultas agregadas.

Não implemente automaticamente.
```

---

# 99. Princípio final

Esta etapa é uma revisão de engenharia.

Não considere o backend consolidado apenas porque:

```text
compila
```

Ele deve também:

```text
migrar
iniciar
validar schema
persistir corretamente
respeitar regras
falhar de forma previsível
ser testável
não vazar secrets
não possuir N+1 óbvio
não misturar responsabilidades
```

Agora analise integralmente o backend atual, execute a consolidação e corrija apenas problemas reais encontrados dentro do escopo.

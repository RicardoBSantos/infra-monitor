# Prompt 09 — Monitoring Engine Base + Execução ICMP

> **Revertido em 2026-09-21.** A orientação abaixo de decidir pelo código de saída do processo
> `ping` foi revertida: no Windows o `ping.exe` devolve exit 0 tanto para sucesso quanto para
> TTL expirado em trânsito e host de destino inacessível. Ver
> `Docs/validacao-producao/icmp-falsos-positivos.md` para a evidência e a decisão que substituiu
> essa orientação. Quem seguir só este documento reimplementa o bug.

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
Incidente
```

implemente agora a primeira etapa do:

# MONITORING ENGINE

Esta etapa deve executar Monitores do tipo ICMP e persistir o resultado como Medição.

A arquitetura conceitual passa a ser:

```text
Monitor ativo
    ↓
Monitoring Engine
    ↓
Execução ICMP
    ↓
Resultado
    ↓
Medição
```

IMPORTANTE:

Nesta etapa NÃO implemente:

```text
abertura automática de Incidente
fechamento automático de Incidente
threshold de falhas
recovery
Notificação
Telegram
Email
Webhook
```

Uma Medição com FALHA continua sendo apenas uma Medição.

A interpretação da sequência de Medições será implementada no Prompt 10.

---

# 2. Objetivo

Criar um mecanismo backend capaz de:

```text
1. identificar Monitores ativos;
2. identificar quais estão prontos para execução;
3. executar ICMP para o Equipamento associado;
4. respeitar timeout;
5. classificar resultado como SUCESSO ou FALHA;
6. medir latência quando houver sucesso;
7. persistir uma Medição;
8. continuar funcionando mesmo se uma execução individual falhar;
9. controlar concorrência;
10. evitar execução simultânea duplicada do mesmo Monitor.
```

---

# 3. Separação de responsabilidades

Não coloque toda a lógica em uma única classe.

Prefira responsabilidades claras.

Exemplo conceitual:

```text
MonitoringScheduler
        ↓
MonitorExecutionCoordinator
        ↓
IcmpMonitorExecutor
        ↓
MedicaoService
```

Os nomes reais podem variar conforme arquitetura existente.

Não crie abstrações excessivas.

---

# 4. Scheduler central

Não crie:

```text
um @Scheduled por Monitor
```

Os Monitores são dados de banco.

Implemente um scheduler central responsável por verificar periodicamente quais Monitores precisam ser executados.

Exemplo conceitual:

```java
@Scheduled(...)
public void scheduleMonitors() {
    ...
}
```

O scheduler deve ser pequeno.

Não coloque execução de ping diretamente dentro dele.

---

# 5. Frequência do scheduler central

O scheduler central pode executar com frequência curta, por exemplo:

```text
1 segundo
```

ou valor configurável equivalente.

Esse intervalo é diferente de:

```text
Monitor.intervaloSegundos
```

O scheduler apenas procura trabalho pendente.

Cada Monitor continua respeitando seu próprio intervalo.

Não hardcode valores sem possibilidade de configuração quando forem operacionais.

---

# 6. Configuração

Crie configuração específica do Monitoring Engine em `application.yml`.

Exemplo conceitual:

```yaml
monitoring:
  engine:
    enabled: true
    scheduler-delay-ms: 1000
    worker-threads: 10
```

Adapte nomes ao padrão do projeto.

Permita desativar completamente o engine:

```text
monitoring.engine.enabled=false
```

Isso será importante em:

```text
testes
ambiente administrativo
manutenção
instâncias que não devam executar monitoramento
```

---

# 7. Evitar múltiplos schedulers desnecessários

Nesta primeira versão, assuma execução em uma única instância da aplicação.

NÃO implemente agora:

```text
distributed locks
Redis locks
ShedLock
Kafka
leader election
cluster coordination
```

Mas mantenha o código organizado para permitir evolução futura.

Documente que, nesta versão, o engine pressupõe uma única instância responsável pelo monitoramento.

---

# 8. Critério para Monitor executável

Um Monitor só pode ser executado quando:

```text
Monitor.ativo = true
```

e:

```text
Equipamento.ativo = true
```

e possuir configuração válida.

Para ICMP, o Equipamento deve possuir IP configurado.

Se Monitor estiver ativo mas Equipamento estiver inativo:

```text
não executar
```

Não gere Medição de FALHA apenas por isso.

É uma condição administrativa, não uma falha de rede.

---

# 9. Equipamento sem IP

Se um Monitor ICMP ativo estiver associado a Equipamento ativo sem IP:

não tente executar comando de rede inválido.

Avalie comportamento apropriado.

Preferência:

```text
registrar erro operacional em log
não derrubar scheduler
```

e, se a configuração inválida já deveria ter sido impedida pelo domínio, trate como inconsistência.

Não crie automaticamente Incidente.

Documente a decisão.

---

# 10. Controle do intervalo

Cada Monitor possui:

```text
intervaloSegundos
```

O engine deve respeitá-lo.

Exemplo:

```text
Monitor A:
intervalo = 30 s

Monitor B:
intervalo = 60 s
```

O scheduler pode acordar a cada segundo, mas A só deve ser executado quando seu intervalo tiver vencido.

---

# 11. Como determinar próxima execução

Não faça query de todo histórico completo de Medições para decidir cada execução.

Prefira mecanismo eficiente.

Existem algumas estratégias possíveis:

```text
última Medição do Monitor
+
intervaloSegundos
```

ou armazenamento explícito de próxima execução.

Nesta primeira versão, prefira a solução mais simples e consistente com o schema existente.

Se utilizar última Medição:

```text
nextRun = ultimaMedicao.executadoEm + intervalo
```

Para Monitor sem Medições:

```text
executar imediatamente
```

---

# 12. Cuidado com query N+1

Não faça:

```text
buscar todos os Monitores
e para cada Monitor consultar última Medição separadamente
```

se isso gerar N+1.

Projete consulta eficiente.

Pode utilizar:

```text
query específica
projection
subquery
join
consulta em lote
```

ou estratégia simples coerente com o projeto.

---

# 13. Execução concorrente

Os Monitores não devem ser executados sequencialmente em uma única thread.

Um timeout de um equipamento não pode bloquear todos os demais.

Use executor concorrente controlado.

Exemplo conceitual:

```text
ThreadPoolTaskExecutor
ExecutorService
```

ou infraestrutura Spring apropriada.

Não utilize pool ilimitado.

---

# 14. Configuração de worker threads

Quantidade de workers deve ser configurável.

Exemplo:

```yaml
monitoring:
  engine:
    worker-threads: 10
```

Defina default razoável.

Não derive automaticamente centenas de threads.

---

# 15. Backpressure

Se existirem mais Monitores pendentes que workers disponíveis:

```text
não crie threads infinitas
```

Use fila limitada ou estratégia controlada.

O engine deve degradar de forma previsível.

Evite rejeição silenciosa de tarefas.

---

# 16. Não sobrepor execução do mesmo Monitor

Garanta que:

```text
Monitor 10
```

não tenha duas execuções simultâneas.

Isso pode acontecer se:

```text
execução demora
scheduler roda novamente
```

Implemente controle local em memória apropriado.

Exemplo conceitual:

```text
Set<MonitorId> runningMonitors
```

com operação thread-safe.

Não implemente lock distribuído nesta etapa.

Garanta remoção do lock em bloco `finally`.

---

# 17. TipoMonitor

Nesta etapa execute somente:

```text
ICMP
```

O engine deve possuir arquitetura que permita no futuro:

```text
TCP
HTTP
SNMP
DNS
```

sem transformar o scheduler em:

```java
if (tipo == ICMP) ...
else if ...
else if ...
```

gigante.

Uma separação simples por executor de tipo é apropriada.

Exemplo:

```text
MonitorExecutor
    ↓
IcmpMonitorExecutor
```

Não exagere em factories ou abstrações genéricas.

---

# 18. Contrato de executor

Pode existir uma abstração simples equivalente a:

```java
interface MonitorExecutor {
    TipoMonitor supports();
    ExecutionResult execute(...);
}
```

ou solução semelhante.

Essa abstração é justificável porque o projeto já prevê múltiplos tipos reais de Monitor.

Mantenha-a pequena.

---

# 19. Resultado interno da execução

Crie um objeto interno para representar resultado.

Exemplo conceitual:

```text
MonitorExecutionResult
----------------------
success
latencyMs
message
executedAt
```

Não utilize diretamente a Entity Medicao como retorno do executor de rede.

Separar execução de persistência facilita testes.

---

# 20. Execução ICMP

Implemente executor ICMP.

O objetivo é determinar:

```text
host alcançável?
latência aproximada?
```

e respeitar:

```text
timeoutMs
```

---

# 21. Estratégia ICMP

Antes de escolher a implementação, considere portabilidade e permissões.

`InetAddress.isReachable()` pode depender do sistema operacional e permissões para ICMP, podendo utilizar mecanismos alternativos.

Executar comando externo `ping` pode fornecer comportamento mais previsível em Linux, mas introduz dependência do ambiente.

Analise o ambiente alvo do projeto:

```text
Linux
Docker futuramente
```

Escolha uma abordagem simples e documente.

Se utilizar comando do sistema, implemente de forma segura e isolada.

---

# 22. Não construir comando com shell concatenado

Se utilizar `ping`, NÃO faça:

```java
Runtime.exec("ping " + ip)
```

ou:

```text
sh -c "ping " + input
```

Isso cria risco desnecessário de command injection.

Use:

```java
ProcessBuilder
```

com argumentos separados.

O IP já deve possuir validação sintática, mas ainda assim não dependa disso para segurança.

---

# 23. Linux

Como o deploy planejado é Linux, caso escolha comando externo, implemente inicialmente para Linux.

Exemplo conceitual:

```text
ping -c 1 ...
```

Configure timeout no processo Java.

Não dependa apenas do timeout do próprio comando.

---

# 24. Timeout

A execução deve respeitar:

```text
Monitor.timeoutMs
```

Se exceder:

```text
FALHA
```

com mensagem apropriada, por exemplo:

```text
Timeout
```

O processo deve ser encerrado de forma segura quando necessário.

Não deixe processos órfãos.

---

# 25. Latência

Em caso de sucesso, obtenha latência em milissegundos quando possível.

Não dependa de parsing extremamente frágil.

Se o mecanismo escolhido não fornecer latência confiável, documente e considere medir duração com:

```java
System.nanoTime()
```

ao redor da operação.

Não utilize:

```java
System.currentTimeMillis()
```

para medir duração quando `nanoTime()` for mais apropriado.

---

# 26. DNS

O alvo inicial deve ser o campo IP do Equipamento.

Não utilize hostname como fallback automaticamente nesta etapa.

Não faça resolução DNS se o modelo exige IP para ICMP.

---

# 27. IPv4

Garanta funcionamento pelo menos para IPv4.

Se a infraestrutura atual já valida IPv6 e a implementação escolhida o suporta naturalmente, preserve.

Não aumente escopo apenas para IPv6 se não for necessário.

---

# 28. Resultado SUCESSO

Quando houver resposta:

crie Medição:

```text
status = SUCESSO
latenciaMs = valor
executadoEm = instante da execução
```

`mensagem` pode ser null ou informação curta.

---

# 29. Resultado FALHA

Quando não houver resposta, timeout ou erro operacional relacionado ao alvo:

crie Medição:

```text
status = FALHA
latenciaMs = null
executadoEm = instante
mensagem = descrição curta
```

Exemplos:

```text
Timeout
Host unreachable
Process exited with code X
```

Evite mensagens gigantes.

---

# 30. Falha interna do worker

Diferencie:

```text
falha do monitoramento
```

de:

```text
bug/erro interno da aplicação
```

Exemplo:

```text
host não responde
```

é Medição FALHA.

Mas:

```text
NullPointerException inesperada
```

é erro interno.

Não transforme toda exception interna em Medição FALHA silenciosamente.

Logue adequadamente e preserve observabilidade.

Ainda assim, uma exception não pode interromper o scheduler global.

---

# 31. Persistência

Após uma execução válida, utilize a camada de domínio existente de Medição.

Evite persistir diretamente via repository se já houver `MedicaoService` apropriado.

Reutilize regras já implementadas.

Se o endpoint público exige DTO e isso não for adequado internamente, crie método interno de domínio limpo.

Não faça chamada HTTP interna para a própria API.

---

# 32. Timestamp

`executadoEm` deve representar o momento real da execução.

Use:

```java
Instant
```

conforme padrão atual.

---

# 33. Transações

Não mantenha transaction aberta durante execução ICMP.

Este ponto é importante.

NÃO faça:

```text
abrir transaction
↓
executar ping esperando timeout
↓
persistir
```

A operação de rede pode demorar.

Execute rede fora de transação longa.

Abra transação apenas para persistência quando necessário.

---

# 34. Scheduler e banco

O scheduler deve buscar os dados necessários e liberar contexto de persistência antes das execuções demoradas quando apropriado.

Evite manter conexões PostgreSQL ocupadas enquanto espera ICMP.

---

# 35. Atualização concorrente de Monitor

Um Monitor pode ser desativado enquanto uma execução está em andamento.

Não tente cancelar de forma complexa nesta etapa.

Se a execução começou quando o Monitor estava válido, a Medição pode ser persistida ao terminar.

A próxima execução respeitará o novo estado.

Documente essa semântica.

---

# 36. Exclusão concorrente

Foreign keys e integridade já existentes devem proteger inconsistências.

Se Monitor for excluído entre seleção e persistência, trate a falha de forma controlada.

Não derrube o scheduler.

---

# 37. Logging

Crie logs úteis em níveis apropriados.

Exemplos:

```text
DEBUG:
monitor agendado
execução iniciada
execução concluída

WARN:
monitor ativo sem IP
timeout
processo retornou erro esperado

ERROR:
falha interna inesperada
```

Não gere `INFO` para cada ping em ambiente normal, pois isso poderá gerar volume enorme.

Não logue secrets.

---

# 38. Métricas

Não introduza Micrometer customizado extensivo nesta etapa.

Se Actuator/Micrometer já estiver presente, pode adicionar poucas métricas simples se isso for trivial, mas não é obrigatório.

Prioridade:

```text
funcionalidade
testes
estabilidade
```

---

# 39. Health

Não marque aplicação inteira como DOWN apenas porque um Equipamento não responde.

Falha de ICMP é dado de negócio.

Não é falha de health da aplicação.

---

# 40. Startup

O engine deve iniciar automaticamente apenas quando:

```text
monitoring.engine.enabled=true
```

Se false:

```text
nenhum monitor deve ser executado
```

---

# 41. Testes unitários do executor ICMP

Não faça testes unitários dependerem de internet ou equipamentos reais.

Estruture o código para permitir teste do executor sem depender de rede externa instável.

Se utilizar `ProcessBuilder`, considere encapsular criação/execução do processo em componente testável.

Não introduza framework pesado de mocking de processos sem necessidade.

---

# 42. Testes de scheduler/coordinator

Cubra:

```text
Monitor ativo + Equipamento ativo -> agendável

Monitor inativo -> não executar

Equipamento inativo -> não executar

Monitor ainda dentro do intervalo -> não executar

Monitor sem Medição -> executar

intervalo vencido -> executar

mesmo Monitor já em execução -> não duplicar
```

---

# 43. Testes de resultado

Cubra:

```text
ICMP sucesso -> Medição SUCESSO

ICMP falha -> Medição FALHA

timeout -> Medição FALHA

latência sucesso -> persistida

falha interna inesperada -> não derruba scheduler
```

Use doubles/mocks apropriados.

---

# 44. Teste de concorrência

Adicione pelo menos um teste útil para garantir que o mesmo Monitor não seja submetido duas vezes simultaneamente.

Não precisa criar teste de carga complexo.

---

# 45. Teste de intervalo

Garanta que o engine não execute o mesmo Monitor a cada tick do scheduler quando:

```text
intervaloSegundos
```

ainda não tiver vencido.

---

# 46. Teste de engine disabled

Com:

```text
monitoring.engine.enabled=false
```

garanta que scheduler/engine não execute Monitores.

Use configuração condicional apropriada se fizer sentido.

---

# 47. Não alterar Medição indevidamente

Não modifique o modelo de Medição para adicionar:

```text
incidentProcessed
schedulerId
workerThread
```

sem necessidade.

Mantenha Medição como histórico do resultado.

---

# 48. Não alterar Monitor com status operacional

Não adicione:

```text
lastRun
nextRun
online
lastLatency
currentStatus
```

ao Monitor apenas para facilitar o scheduler, salvo se houver justificativa forte.

Prefira derivar o agendamento pela última Medição nesta primeira versão.

Se a solução ficar ineficiente ou inviável, documente e implemente a menor mudança necessária.

---

# 49. Consulta de Monitores pendentes

Evite carregar todos os Monitores ativos em memória se uma consulta eficiente puder selecionar os candidatos.

Porém não crie SQL extremamente complexo prematuramente.

O volume inicial provavelmente será administrável.

Escolha equilíbrio entre:

```text
simplicidade
eficiência
clareza
```

---

# 50. Batch

Não implemente Spring Batch.

Este não é um job batch tradicional.

---

# 51. Reactive

Não migre o projeto para WebFlux/Reactor apenas por causa de concorrência.

Mantenha stack atual.

---

# 52. Virtual Threads

Se o projeto estiver em Java 21, avalie se virtual threads seriam adequadas.

Porém não altere a arquitetura inteira apenas para usá-las.

Se a solução existente com executor tradicional for mais simples, mantenha.

Documente qualquer decisão relevante.

---

# 53. Shutdown

Se criar executor próprio, garanta shutdown apropriado quando aplicação for encerrada.

Prefira beans gerenciados pelo Spring.

Não deixe threads não gerenciadas.

---

# 54. Configuração por propriedades

Se criar classe de properties, utilize solução Spring apropriada.

Exemplo conceitual:

```text
MonitoringEngineProperties
```

Evite espalhar:

```java
@Value("${...}")
```

em várias classes se uma classe de configuração simples melhorar organização.

Não crie framework de configuração.

---

# 55. Estrutura de packages

Mantenha o Monitoring Engine separado do CRUD de Monitor.

Exemplo conceitual:

```text
br.com.inframonitor.monitoring
    scheduler
    execution
    icmp
    config
```

ou estrutura equivalente alinhada ao projeto.

Não coloque scheduler dentro do controller/service CRUD de Monitor.

---

# 56. Nome do módulo

Use terminologia consistente.

Preferência conceitual:

```text
monitoring
```

para motor de execução.

Enquanto:

```text
monitor
```

permanece domínio da configuração.

Essa separação deve ficar clara no package.

---

# 57. Nenhum endpoint novo obrigatório

O Monitoring Engine não precisa de endpoints REST nesta etapa.

Não crie:

```text
POST /run-all
POST /ping
POST /execute-monitor
```

sem requisito explícito.

Testes devem chamar services/componentes diretamente.

Endpoints administrativos poderão ser avaliados depois.

---

# 58. Não executar engine nos testes automaticamente

Evite que testes de contexto comecem a executar ping real.

Em ambiente de teste, configure:

```text
monitoring.engine.enabled=false
```

por padrão.

Testes específicos do engine habilitam apenas quando necessário.

---

# 59. Dev environment

Documente como habilitar/desabilitar engine localmente.

Exemplo:

```text
MONITORING_ENGINE_ENABLED=true
```

se o padrão do projeto utiliza environment variables.

---

# 60. Segurança de entrada

Embora IP já venha do banco, trate-o como dado não confiável ao construir processo externo.

Nunca passe por shell.

Argumentos sempre separados.

---

# 61. Process output

Se utilizar processo externo, consuma saída sem risco de deadlock.

Como `ping -c 1` gera pouco output, mantenha implementação simples, mas correta.

Não deixe stdout/stderr bloquearem processo.

Pode combinar stderr/stdout se apropriado.

---

# 62. Charset/locale

Não dependa de texto localizado do `ping` para decidir sucesso.

Prefira:

```text
exit code
```

para sucesso/falha.

Se precisar extrair latência do output, faça parsing minimamente robusto e teste.

Considere definir locale conhecido no processo apenas se necessário.

---

# 63. Exit code

Use exit code como principal indicação de sucesso quando utilizar `ping`.

Conceitualmente:

```text
0 -> sucesso

diferente de 0 -> falha
```

mas valide comportamento real do ambiente Linux alvo.

Não trate exit code não zero como exception interna.

É resultado de monitoramento.

---

# 64. Mensagem de falha

Normalize mensagens para valores curtos.

Exemplos:

```text
Timeout
Host unreachable
Ping failed
Execution error
```

Não persista output inteiro do comando.

---

# 65. Precisão de latência

`latenciaMs` atual é inteiro conforme modelo existente.

Se o ping retornar:

```text
0.423 ms
```

defina comportamento consistente.

Pode:

```text
arredondar
```

ou medir duração inteira.

Não altere schema para decimal nesta etapa sem necessidade.

Documente.

---

# 66. Clock

Para testes de intervalo e timestamps, prefira utilizar:

```java
Clock
```

injetável em componentes onde isso trouxer benefício real.

Isso facilita testes determinísticos.

Não espalhe `Instant.now()` em lógica de agendamento difícil de testar.

Se o projeto já utiliza `Clock`, reutilize.

---

# 67. Estado em memória

O controle de Monitores em execução pode ficar em memória nesta primeira versão.

Use estrutura thread-safe.

Garanta:

```text
add antes de submeter/executar
remove sempre ao finalizar
```

inclusive em exceptions.

---

# 68. Falha ao submeter tarefa

Se executor rejeitar tarefa por saturação:

```text
remova Monitor do estado running
```

para que possa ser tentado posteriormente.

Logue warning apropriado.

Não perca o Monitor permanentemente.

---

# 69. Scheduler overlap

Se o próprio método scheduler puder ser chamado novamente enquanto ainda está selecionando Monitores, avalie proteção simples.

Não deixe duas varreduras concorrentes criarem submissões duplicadas.

O controle de `runningMonitors` deve ser suficiente ou complemente com lock local simples.

Não implemente coordenação distribuída.

---

# 70. Observabilidade do pool

Não é obrigatório criar dashboard ou métricas customizadas.

Mas mantenha nomes de thread úteis se configurar ThreadPoolTaskExecutor.

Exemplo conceitual:

```text
monitor-worker-
```

---

# 71. Compatibilidade com futuro Incident Engine

Após persistir Medição, NÃO chame `IncidenteService` nesta etapa.

Mas mantenha um ponto claro no fluxo onde futuramente poderemos adicionar:

```text
medição persistida
    ↓
incident processor
```

sem redesenhar toda a execução.

Não implemente event bus ainda.

Uma chamada adicional futura em service/coordinator já pode ser suficiente.

---

# 72. Sem eventos prematuros

Não introduza:

```text
Kafka
RabbitMQ
Spring Cloud Stream
domain event infrastructure complexa
```

para conectar Medição e Incidente.

O próximo Prompt decidirá a forma mais simples.

---

# 73. Alterações em dependências

Antes de adicionar biblioteca ICMP externa:

1. avalie se realmente é necessária;
2. verifique manutenção;
3. verifique compatibilidade Java 21;
4. prefira não adicionar se `ProcessBuilder` ou API JDK forem suficientes.

Não adicione dependências sem justificativa.

---

# 74. README

Atualize documentação mínima com:

```text
como habilitar Monitoring Engine
configurações disponíveis
dependência do comando ping, se utilizada
comportamento em Linux
```

Se houver Docker futuro, apenas documente a necessidade.

Não implemente Docker completo nesta tarefa.

---

# 75. Docker

Se a execução ICMP escolhida exigir capabilities específicas em container, documente a necessidade.

Não altere deploy inteiro agora.

Por exemplo, dependendo da estratégia ICMP, containers podem precisar de:

```text
NET_RAW
```

ou pacote `iputils-ping`.

Documente sem implementar infraestrutura de produção fora de escopo.

---

# 76. Testes de integração

Não faça testes dependerem de:

```text
8.8.8.8
google.com
internet
rede corporativa
```

Testes devem ser determinísticos.

---

# 77. Teste manual opcional

Pode documentar um procedimento manual para ambiente dev:

```text
cadastrar Equipamento com IP local
criar Monitor ICMP
habilitar engine
aguardar intervalo
consultar /api/v1/medicoes
```

Isso não substitui testes automatizados.

---

# 78. Não criar UI

Nenhuma alteração Angular nesta etapa.

---

# 79. Inspeção inicial

Antes de modificar:

```bash
pwd
git status
```

Analise principalmente:

```text
pom.xml
application.yml
application-*.yml
src/main/java
src/main/resources/db/migration
src/test
```

Localize:

```text
Monitor
TipoMonitor
Medicao
StatusMedicao
repositories
services
paginação
configuração Spring
test profiles
```

---

# 80. Sequência sugerida

```text
1. analisar estado atual
2. escolher estratégia ICMP
3. documentar decisão técnica
4. criar properties/config
5. criar executor/pool
6. criar abstração MonitorExecutor
7. implementar IcmpMonitorExecutor
8. implementar coordinator
9. implementar scheduler
10. integrar MedicaoService
11. implementar controle de intervalo
12. implementar runningMonitors
13. configurar tests engine=false
14. criar testes unitários
15. criar testes de integração úteis
16. executar test
17. executar verify
18. revisar git diff
```

---

# 81. Testes obrigatórios

Cubra pelo menos:

```text
scheduler ignora Monitor inativo

scheduler ignora Equipamento inativo

Monitor sem Medição executa

Monitor antes do intervalo não executa

Monitor após intervalo executa

mesmo Monitor não executa simultaneamente duas vezes

ICMP sucesso gera Medição SUCESSO

ICMP falha gera Medição FALHA

timeout gera Medição FALHA

latência é persistida em sucesso

exception interna não interrompe processamento de outros Monitores

engine disabled não executa

rejeição do executor não deixa Monitor preso em running
```

---

# 82. Build e testes

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

# 83. Git

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

# 84. Revisão final

Revise explicitamente:

```text
nenhuma transaction longa durante ping
pool limitado
scheduler central
intervalo respeitado
runningMonitors thread-safe
finally remove lock
ProcessBuilder sem shell, se utilizado
timeout real
nenhum incidente automático
nenhuma chamada Telegram
testes sem rede externa
engine disabled em tests
```

---

# 85. Critérios de aceite

A etapa estará concluída quando:

* existir um scheduler central;
* Monitores ativos forem selecionados;
* Equipamentos inativos forem ignorados;
* intervalo individual for respeitado;
* Monitor sem histórico puder executar imediatamente;
* execuções ocorrerem em pool controlado;
* mesmo Monitor não puder executar simultaneamente;
* ICMP for executado com timeout;
* sucesso gerar Medição SUCESSO;
* falha gerar Medição FALHA;
* latência for persistida quando disponível;
* erro individual não parar o engine;
* não houver transaction aberta durante operação de rede;
* engine puder ser desabilitado por configuração;
* testes não realizarem ping externo;
* build passar;
* nenhum Incidente for criado/fechado automaticamente.

---

# 86. Resposta final

Ao concluir, apresente:

```text
RESUMO

...


CONTEXTO UTILIZADO

- codexcontex.md
- módulo Monitor
- módulo Medição
- módulo Incidente
- configuração atual
- testes existentes


ESTRATÉGIA ICMP ESCOLHIDA

...

Motivo:
...


ARQUITETURA DO ENGINE

Scheduler:
...

Coordinator:
...

Executor:
...

Persistência:
...


CONFIGURAÇÕES

...


FLUXO DE EXECUÇÃO

Monitor
 -> ...
 -> Medição


CONTROLE DE INTERVALO

...


CONTROLE DE CONCORRÊNCIA

...


PROTEÇÃO CONTRA EXECUÇÃO DUPLICADA

...


TIMEOUT

...


TRATAMENTO DE FALHAS

...


ARQUIVOS CRIADOS

...


ARQUIVOS ALTERADOS

...


DEPENDÊNCIAS ADICIONADAS

Nenhuma.

ou:

...


MIGRATIONS

Nenhuma esperada.

Se houve:
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


LIMITAÇÕES ATUAIS

Exemplo:
- execução pressupõe uma única instância do backend
- somente ICMP está implementado
...


DIVERGÊNCIAS DA ESPECIFICAÇÃO

Nenhuma.

ou:

...


PENDÊNCIAS

...


PRÓXIMO PASSO RECOMENDADO

Incident Engine:
processar sequência de Medições para abrir/fechar Incidentes automaticamente.

Não implemente essa etapa agora.
```

---

# 87. Princípio principal

A responsabilidade desta etapa é somente:

```text
CONFIGURAÇÃO
Monitor
    ↓
EXECUÇÃO
Monitoring Engine / ICMP
    ↓
RESULTADO
Medição
```

Ainda não:

```text
INTERPRETAÇÃO
Incidente
```

O engine deve ser resiliente.

Uma falha em um equipamento nunca deve impedir o monitoramento dos demais.

A arquitetura deve permitir adicionar futuramente:

```text
TCP
HTTP
SNMP
DNS
```

sem redesenhar o scheduler central.

Agora analise o estado atual do repositório, escolha e documente a estratégia ICMP apropriada e implemente integralmente a primeira versão do Monitoring Engine.

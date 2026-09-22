# Revisão do branch `fix/icmp-nativo-windows` — desenho

Data: 2026-09-22. Branch: `fix/icmp-nativo-windows`. **Não haverá merge nesta rodada.**

Regras de contorno, válidas para toda a execução:

- `monitoring.engine.enabled=false` (motor desligado) e `notification.telegram.enabled=false`.
- Banco de dev (`inframonitor-postgres`, porta 5434) apenas para leitura e para a subida da
  aplicação. Nenhuma migration nova é criada, nenhuma linha é escrita por script.
- A `V19` permanece rascunho dentro de documento. Nenhum arquivo em `db/migration`.

Cinco frentes: duas de código (2 e 3), uma de correção de registro (1) e duas de documentação
(4 e 5).

---

## 1. Contradição sobre o campo de IP

### O que o banco diz

`docker exec inframonitor-postgres psql -U inframonitor -d inframonitor -c '\d equipamento'`
devolve, no campo em disputa:

```
 ip_address          | character varying(45)    |           |          |
```

Sem `NOT NULL` e sem a constraint `ck_equipamento_ip_e_host`.

### As duas migrations que explicam a história

- `V2__create_inventario_tables.sql:88` — `ip_address INET NOT NULL`, com
  `ck_equipamento_ip_e_host` (`:104-106`) exigindo máscara de host.
- `V4__make_equipamento_ip_optional.sql:5-9` — derruba a constraint e faz
  `ALTER COLUMN ip_address TYPE VARCHAR(45) USING ip_address::text` + `DROP NOT NULL`.

### Veredito

A afirmação **"`equipamento.ip` é `INET`" estava errada**, em dois pontos: a coluna chama-se
`ip_address`, não `ip`, e o tipo é `VARCHAR(45)` desde a `V4`. A afirmação do relatório de
investigação (varchar(45), não INET) estava certa.

A `V2` de fato criou a coluna como `INET` — por isso o CLAUDE.md do projeto ainda registra "endereços
IP deverão utilizar o tipo PostgreSQL `INET`" como decisão arquitetural. Esse conflito entre decisão
e estado real também fica registrado.

### Correção da dívida de IPv6

`Docs/validacao-producao/icmp-falsos-positivos.md`, dívida 4, é reescrita. O risco continua real, mas
a causa muda e fica **maior**:

- `VARCHAR(45)` não valida nada. Aceita IPv6, aceita hostname, aceita lixo. O `INET` original ao
  menos rejeitava o que não fosse endereço.
- `WindowsNativeIcmpRunner.paraOrdemDeRede` (`:121-131`) lança `IllegalArgumentException` para
  qualquer coisa que não tenha 4 octetos.
- Essa exceção cai no `catch (RuntimeException | LinkageError)` de `:73`, vira `IcmpResult.erro(0)`,
  e chega ao banco como medição `FALHA` com a mensagem `"Erro ICMP não identificado"` — em **toda**
  sondagem daquele monitor, indefinidamente, sem nada apontar para a causa real.

---

## 2. Modo de falha da biblioteca nativa

### Como está hoje

`Native.load` está no inicializador estático de um **campo de interface**:

```java
private interface Biblioteca extends StdCallLibrary {
    Biblioteca INSTANCE = Native.load("Iphlpapi", Biblioteca.class, W32APIOptions.DEFAULT_OPTIONS);
```

Campo de interface é implicitamente `static final`, então a carga acontece na primeira leitura de
`Biblioteca.INSTANCE` — ou seja, na **primeira chamada a `icmpCreateFile()`**, dentro da primeira
sondagem, já numa thread do pool. Consequência por sondagem, hoje:

| sondagem | o que acontece |
|---|---|
| 1ª | `UnsatisfiedLinkError` (um `Error`) sobe do inicializador estático |
| 2ª em diante | `NoClassDefFoundError` — a classe ficou marcada como erroneous |
| todas | `WindowsNativeIcmpRunner:73` captura como `LinkageError`, loga WARN e devolve `IcmpResult.erro(0)` |

Resultado: a aplicação sobe normalmente, `/api/v1/status` diz `UP`, e todo monitor ICMP grava
`FALHA` com `"Erro ICMP não identificado"` para sempre. O operador vê uma rede inteira caída.

### O desenho novo

**Carga uma vez, na subida.** `Iphlpapi.Jna` deixa de depender do inicializador estático implícito:
a carga passa a ser uma chamada explícita, feita pela configuração na construção do bean.

**Bean de estado, fora do `@ConditionalOnProperty`.** Novo `IcmpImplementacaoAtiva`:

```java
public record IcmpImplementacaoAtiva(
        IcmpImplementacao pedida,
        IcmpImplementacao ativa,
        CargaNativa cargaNativa,
        String detalheFalha) { }

public enum CargaNativa { OK, FALHOU, NAO_TENTADA }
```

Vive numa `@Configuration` **sem** o `@ConditionalOnProperty(monitoring.engine.enabled)`, para que
`/api/v1/status` consiga reportar mesmo com o motor desligado — que é a condição da evidência pedida.

**Matriz de comportamento:**

| motor | `monitoring.icmp.implementacao` | SO | carga | resultado |
|---|---|---|---|---|
| ligado | `nativo-windows` | qualquer | falha | **app não sobe.** `IllegalStateException` com mensagem nomeando a propriedade, a DLL e a causa |
| ligado | `nativo-windows` | qualquer | ok | `ativa=NATIVO_WINDOWS`, `cargaNativa=OK` |
| ligado | `auto` | Windows | falha | `log.error` na subida + queda para `PROCESSO_PING`. `pedida=NATIVO_WINDOWS`, `ativa=PROCESSO_PING`, `cargaNativa=FALHOU` |
| ligado | `auto` | Windows | ok | `ativa=NATIVO_WINDOWS`, `cargaNativa=OK` |
| ligado | `auto` | não-Windows | — | `ativa=PROCESSO_PING`, `cargaNativa=NAO_TENTADA` |
| ligado | `processo-ping` | qualquer | — | `ativa=PROCESSO_PING`, `cargaNativa=NAO_TENTADA` |
| desligado | qualquer | qualquer | — | resolve a implementação, **não carrega nada**, `cargaNativa=NAO_TENTADA` |

A distinção entre `pedida` e `ativa` é o que torna a queda do `auto` auditável: sem ela, `auto` que
caiu para `processo-ping` fica indistinguível de `processo-ping` configurado de propósito.

**`/api/v1/status`.** `StatusController` recebe `ObjectProvider<IcmpImplementacaoAtiva>` — não uma
dependência obrigatória — porque `StatusControllerTest` é `@WebMvcTest` e não carrega `@Configuration`
de domínio. Com `ObjectProvider`, o teste existente continua passando sem alteração e o campo sai
como `null` naquele contexto. Formato:

```json
{
  "aplicacao": "infra-monitor",
  "status": "UP",
  "instante": "2026-09-22T...Z",
  "icmp": {
    "pedida": "AUTO",
    "ativa": "NATIVO_WINDOWS",
    "cargaNativa": "NAO_TENTADA",
    "detalheFalha": null,
    "motorLigado": false
  }
}
```

### Testes

Todos com um `Iphlpapi` falso cuja fábrica lança **`UnsatisfiedLinkError` cru**, não embrulhado —
reproduzindo o que a JNA faz de verdade.

1. `nativo-windows` explícito + carga falha → a criação do contexto/bean lança, e a mensagem cita a
   propriedade.
2. `auto` no Windows + carga falha → nenhum lançamento; bean resolvido é `ProcessoPingIcmpRunner`;
   um `ListAppender` do Logback prova o registro em nível **ERROR**.
3. Estado exposto: `cargaNativa=FALHOU` e `pedida != ativa` no holder.

**Prova de reversão.** O falso conta as cargas. O teste exige `contagem == 1` **depois da subida e
antes de qualquer sondagem**, e `contagem == 1` ainda depois de N sondagens. Se a carga voltar a ser
preguiçosa (por sondagem), a primeira asserção vê `0` e o teste falha. Se alguém carregar por
sondagem, a segunda vê `N` e falha.

### Evidência a coletar

- Log real de subida nesta máquina, motor desligado, mostrando a linha da implementação escolhida.
- Resposta real de `GET /api/v1/status`, colada crua.

---

## 3. Exceções que somem nos pools

### Como está hoje — levantamento

| pool | submissão | quem lê o `Future` | corpo da tarefa |
|---|---|---|---|
| `monitoringWorkerExecutor` | `workerExecutor.submit(...)` — `MonitorExecutionCoordinator:79` | **ninguém**; o `Future` é descartado na mesma linha | `execute(candidate)` com `catch (RuntimeException)` → `log.error` (`:98`) |
| `notificationWorkerExecutor` | `executor.execute(...)` — `NotificationDispatcher:66` | não se aplica | `process(id)` com `catch (RuntimeException)` → `log.error` (`:84`) |

Ambos os beans são `ThreadPoolExecutor` com `ArrayBlockingQueue` e `AbortPolicy`
(`MonitoringEngineConfiguration:25-31`, `NotificationDispatcherConfiguration:26-31`). As
`ThreadFactory` não instalam `UncaughtExceptionHandler`.

### A premissa do pedido está errada, e o buraco real é outro

Uma `RuntimeException` lançada dentro do `IncidentProcessor` **não** some hoje: `MedicaoService.criar`
já a captura e loga ERROR em `:51-56`, com a mesma proteção para o `LatencyEpisodeProcessor` em
`:57-61`. Isso é registrado no relatório com o trecho, em vez de ser encenado.

O que de fato desaparece é **`Throwable` que não é `RuntimeException`** — `Error`, e qualquer
`Throwable` cru:

- Pelo `submit()`: o `FutureTask` captura o `Throwable`, guarda no `Future` e a thread termina a
  tarefa normalmente. O `Future` é descartado. **Zero log, zero rastro.** É exatamente o caminho pelo
  qual o `UnsatisfiedLinkError` do item 2 sumiria se `WindowsNativeIcmpRunner` não tivesse o
  `catch (LinkageError)` defensivo — o comentário em `:70-72` já diz isso, e este item prova.
- Pelo `execute()`: a thread morre, o handler default imprime em `stderr` — fora do Logback, fora de
  qualquer arquivo de log, invisível para quem lê o log da aplicação. O pool repõe a thread.

### A correção, geral e não caso a caso

Nova classe `br.com.inframonitor.common.concurrent.ExecutorQueLogaFalhas`: decorator de
`ExecutorService` que delega tudo e embrulha **todo** `Runnable`/`Callable` submetido, por
`submit` ou por `execute`, num envelope com `catch (Throwable)`:

- loga ERROR com o rótulo da tarefa e a exceção inteira;
- **não** relança — o worker sobrevive e o pool não precisa repor thread;
- `InterruptedException`/interrupção é repropagada como interrupção da thread, não engolida.

Rótulo: `br.com.inframonitor.common.concurrent.TarefaRotulada`, um `record(String rotulo, Runnable
delegada)` cujo `toString()` é o rótulo. O coordinator submete `"monitor " + monitorId`; o dispatcher,
`"notificacao " + id`. Sem isso o ERROR sairia sem dizer qual monitor ou qual notificação — que é
metade do valor do requisito.

Os dois `@Bean` passam a devolver `new ExecutorQueLogaFalhas(poolReal, log)`. O `destroyMethod =
"shutdown"` continua funcionando: o decorator implementa `shutdown()` delegando.

Os `catch (RuntimeException)` existentes em `MedicaoService`, `MonitorExecutionCoordinator` e
`NotificationDispatcher` **permanecem**. Eles não são redundantes: o do dispatcher compensa
(`stateService.complete(..., failure)`), o do coordinator garante o `finally` que libera
`runningMonitors`, e o do `MedicaoService` preserva a medição como dado primário. O decorator é a
rede de baixo, para o que escapar deles.

### Testes

1. `ExecutorQueLogaFalhasTest` — tarefa lança `Error` cru: `ListAppender` prova ERROR **com o rótulo**;
   uma segunda tarefa submetida depois executa, provando que o worker sobreviveu. Repetido para
   `submit` e para `execute`, porque são caminhos distintos no JDK.
2. Teste no nível do coordinator: `Error` no caminho do `IncidentProcessor` → ERROR nomeando o monitor.
3. **Prova de reversão**: desembrulhar o bean (devolver o `ThreadPoolExecutor` cru) faz os testes 1 e
   2 falharem por ausência de log — não por outro motivo. Isso é verificado rodando com a reversão
   aplicada e colando a saída.

### Fila cheia — `AbortPolicy`

`RejectedExecutionException` **não** some hoje. `MonitorExecutionCoordinator:80-83` captura, devolve
o monitor a `runningMonitors` e loga WARN; `NotificationDispatcher:66` captura, tira de `inFlight` e
loga WARN. Um teste com executor que sempre rejeita trava esse comportamento nos dois lados, para que
uma refatoração futura não o perca em silêncio. Nenhuma mudança de comportamento aqui — o item é
investigação confirmando que está correto, e o teste é o registro disso.

---

## 4. Evidências pendentes da Parte A

Destino: `Docs/validacao-producao/icmp-falsos-positivos.md`, atualizado no lugar. Todas as saídas
coladas **cruas**.

| item | situação | ação |
|---|---|---|
| a) trava A.0 condição 1, 4 alvos (retorno, Status, GetLastError, RoundTripTime) | já no doc, `:63-72` | re-rodar contra a rede atual e colar a saída nova ao lado da de 2026-09-21 |
| b) TTL padrão × TTL 128, contagens e saídas | já no doc, `:90-105` | re-rodar e colar |
| c) 10 amostras RTT nativo × `tempo=` do `ping.exe` para `10.79.10.6` | já no doc, `:114-119` | re-rodar e colar |
| d) justificativa do handle com 4 workers + trecho de código | já no doc, `:122-133` | acrescentar o trecho de `WindowsNativeIcmpRunner` (`try/finally` do handle) e o do `worker-threads` |
| e) nome e comprimento do campo de mensagem, e a maior mensagem gerável | **ausente** | `medicao.mensagem VARCHAR(255)` (`V6:7`); enumerar todas as mensagens que `IcmpMonitorExecutor.mensagem` e `ProcessoPingIcmpRunner` podem produzir e medir a maior, por teste, não por leitura |
| f) comando Linux final com `-W` | **ausente do doc** (está só no código, `ProcessoPingIcmpRunner:73`) | registrar `ping -n -c 1 -W <segundos> <ip>`, incluindo como `timeoutMs` vira segundos e o arredondamento |
| g) execução como SYSTEM | registrado como NÃO VERIFICADO (`:207-225`), **sem fase nomeada** | acrescentar a fase: verificação na **instalação do serviço Windows**, com item de checklist explícito |

As sondagens de (a), (b) e (c) rodam por um utilitário descartável sob o diretório de scratchpad,
contra a rede real, com o motor desligado. Nada é gravado no banco.

---

## 5. Parte B — resumo da proposta

Fonte: `Docs/validacao-producao/manutencao-proposta.md` (673 linhas). O relatório **não** cola o
documento; para cada item de B.1 a B.7 entrega três blocos curtos:

- **Proposta** — 3 a 6 linhas.
- **Alternativas descartadas** — cada uma com o motivo.
- **Em aberto** — o que exige decisão de produto.

Exceção: o **rascunho da `V19` é colado na íntegra**, incluindo o backfill em duas passadas e a tabela
de classificação das linhas antigas com o grau de certeza de cada sinal — inclusive o terceiro caso,
que fica `NULL` assumidamente.

---

## Arquivos

**Criar**

```
infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/icmp/IcmpImplementacaoAtiva.java
infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/icmp/CargaNativa.java
infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/icmp/IcmpEstadoConfiguration.java
infra-monitor-backend/src/main/java/br/com/inframonitor/common/concurrent/ExecutorQueLogaFalhas.java
infra-monitor-backend/src/main/java/br/com/inframonitor/common/concurrent/TarefaRotulada.java
infra-monitor-backend/src/test/java/br/com/inframonitor/common/concurrent/ExecutorQueLogaFalhasTest.java
```

O relatório dos cinco itens é entregue **na resposta**, não como documento novo: a decisão foi
atualizar `icmp-falsos-positivos.md` no lugar e não criar uma segunda fonte a manter.

**Modificar**

```
.../monitoring/icmp/nativo/Iphlpapi.java                 carga explícita e ansiosa
.../monitoring/icmp/IcmpRunnerConfiguration.java         fail-fast, queda do auto, holder
.../common/api/StatusController.java                     bloco icmp via ObjectProvider
.../monitoring/config/MonitoringEngineConfiguration.java bean embrulhado
.../notificacao/dispatcher/NotificationDispatcherConfiguration.java  bean embrulhado
.../monitoring/execution/MonitorExecutionCoordinator.java            rótulo da tarefa
.../notificacao/dispatcher/NotificationDispatcher.java               rótulo da tarefa
.../test/.../monitoring/icmp/IcmpRunnerConfigurationTest.java        falha de carga + reversão
.../test/.../monitoring/execution/MonitorExecutionCoordinatorTest.java  Error + rejeição
.../test/.../common/api/StatusControllerTest.java                    bloco icmp
Docs/validacao-producao/icmp-falsos-positivos.md                     dívida 4, 4e, 4f, 4g
```

**Não tocar**: `db/migration/` (nenhuma `V19`), banco de dev (escrita), frontend — `/api/v1/status`
não é consumido por nenhum arquivo em `infra-monitor-frontend/src`, logo esta rodada não tem
verificação de Playwright.

## Validação final

1. `./mvnw test` verde, com a contagem colada.
2. Provas de reversão executadas de verdade: aplicar a reversão, colar a falha, desfazer.
3. Aplicação sobe com `monitoring.engine.enabled=false` contra o banco de dev; log de subida e
   `GET /api/v1/status` colados crus.
4. Nenhuma migration nova; `git status` em `db/migration` limpo.

# Revisão do branch `fix/icmp-nativo-windows` — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar as cinco frentes da revisão do branch — corrigir o registro do tipo de
`equipamento.ip_address`, fazer a biblioteca nativa carregar uma única vez na subida com fail-fast ou
queda registrada, impedir que falha de tarefa suma nos dois pools, completar as evidências da Parte A
e resumir a Parte B.

**Architecture:** Duas mudanças de código independentes entre si. (1) Um `record` de ambiente ICMP,
resolvido na subida fora do `@ConditionalOnProperty` do motor, que carrega a DLL uma vez, decide
entre derrubar a subida e cair para `processo-ping`, e é publicado em `GET /api/v1/status`. (2) Um
decorator de `ExecutorService` que embrulha toda tarefa submetida aos dois pools, captura `Throwable`
e loga ERROR com o rótulo da tarefa sem matar o worker. Documentação depois do código, porque as
evidências citam linhas que o código muda.

**Tech Stack:** Java 21, Spring Boot 4.1.0, Maven Wrapper, JNA 5.19.0, JUnit 5, AssertJ, Mockito,
Logback (`ListAppender` para provar log), PostgreSQL 16 em Docker.

**Spec:** `Docs/superpowers/specs/2026-09-22-revisao-branch-icmp-nativo-windows-design.md`

## Global Constraints

- **Não fazer merge.** O trabalho fica em `fix/icmp-nativo-windows`.
- **Motor desligado:** `monitoring.engine.enabled=false` em toda execução manual.
- **Telegram desligado:** `notification.telegram.enabled=false`.
- **Banco de dev intocado:** leitura e subida da aplicação apenas. Nenhum `INSERT`, `UPDATE`,
  `DELETE` ou `ALTER` por script. Conexão: `docker exec inframonitor-postgres psql -U inframonitor -d inframonitor`.
- **Nenhuma migration nova.** `infra-monitor-backend/src/main/resources/db/migration/` não recebe
  arquivo. A `V19` continua rascunho dentro de `Docs/validacao-producao/manutencao-proposta.md`.
- **Sem Lombok.** Classes e `record` explícitos.
- **Sem abstração especulativa.** Nada de `Base*`, nada de interface com uma implementação só.
- Datas sempre `Instant`/Java Time API, nunca `java.util.Date`.
- Comandos de build rodam a partir de `infra-monitor-backend/`: `./mvnw test`.
- Mensagens de commit em português, no padrão do branch (`fix(icmp):`, `test(icmp):`, `docs(...)`),
  terminando com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `common/concurrent/TarefaRotulada.java` (criar) | dá nome à tarefa; `toString()` é o rótulo que aparece no log |
| `common/concurrent/ExecutorQueLogaFalhas.java` (criar) | decorator de `ExecutorService`; captura `Throwable` de toda tarefa submetida |
| `monitoring/icmp/CargaNativa.java` (criar) | enum `OK | FALHOU | NAO_TENTADA` |
| `monitoring/icmp/IcmpAmbiente.java` (criar) | o que foi pedido, o que está ativo, se a DLL carregou, e a ligação carregada |
| `monitoring/icmp/IcmpAmbienteConfiguration.java` (criar) | resolve o ambiente na subida, fora do `@ConditionalOnProperty` do motor |
| `monitoring/icmp/nativo/Iphlpapi.java` (modificar) | carga explícita via `Jna.carregar()`, sem inicializador estático de campo |
| `monitoring/icmp/IcmpRunnerConfiguration.java` (modificar) | passa a consumir `IcmpAmbiente` em vez de decidir sozinha |
| `common/api/StatusController.java` (modificar) | bloco `icmp` na resposta |
| `monitoring/config/MonitoringEngineConfiguration.java` (modificar) | embrulha o pool |
| `notificacao/dispatcher/NotificationDispatcherConfiguration.java` (modificar) | embrulha o pool |
| `monitoring/execution/MonitorExecutionCoordinator.java` (modificar) | rotula a tarefa |
| `notificacao/dispatcher/NotificationDispatcher.java` (modificar) | rotula a tarefa |
| `Docs/validacao-producao/icmp-falsos-positivos.md` (modificar) | dívida 4 corrigida + evidências 4a–4g |

O `IcmpAmbiente` carrega a ligação `Iphlpapi` já carregada além dos campos de estado — é o mesmo ato
(resolver + carregar) e separá-lo em dois beans criaria um tipo intermediário que ninguém mais usa.
`StatusController` monta o próprio DTO e não serializa esse campo.

---

### Task 1: Envelope que impede falha de tarefa de sumir

**Files:**
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/common/concurrent/TarefaRotulada.java`
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/common/concurrent/ExecutorQueLogaFalhas.java`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/common/concurrent/ExecutorQueLogaFalhasTest.java`

**Interfaces:**
- Consumes: nada.
- Produces: `new ExecutorQueLogaFalhas(ExecutorService delegado)` implementando `ExecutorService`;
  `new TarefaRotulada(String rotulo, Runnable delegada)` implementando `Runnable`.

- [ ] **Step 1: Escrever o teste que falha**

`ExecutorQueLogaFalhasTest.java`:

```java
package br.com.inframonitor.common.concurrent;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

class ExecutorQueLogaFalhasTest {

    private final Logger logger = (Logger) LoggerFactory.getLogger(ExecutorQueLogaFalhas.class);
    private final ListAppender<ILoggingEvent> registros = new ListAppender<>();
    private ExecutorService poolReal;
    private ExecutorQueLogaFalhas executor;

    @BeforeEach
    void preparar() {
        registros.start();
        logger.addAppender(registros);
        poolReal = Executors.newSingleThreadExecutor();
        executor = new ExecutorQueLogaFalhas(poolReal);
    }

    @AfterEach
    void encerrar() {
        logger.detachAppender(registros);
        poolReal.shutdownNow();
    }

    @Test
    @DisplayName("submit: Error cru vira ERROR com o rotulo da tarefa, em vez de sumir no Future")
    void submitLogaErrorComRotulo() throws Exception {
        CountDownLatch terminou = new CountDownLatch(1);
        executor.submit(new TarefaRotulada("monitor 42", () -> {
            try {
                throw new UnsatisfiedLinkError("Iphlpapi nao encontrada");
            } finally {
                terminou.countDown();
            }
        }));

        assertThat(terminou.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(esperarUmRegistro()).isTrue();
        ILoggingEvent evento = registros.list.get(0);
        assertThat(evento.getLevel()).isEqualTo(Level.ERROR);
        assertThat(evento.getFormattedMessage()).contains("monitor 42");
        assertThat(evento.getThrowableProxy().getClassName()).isEqualTo("java.lang.UnsatisfiedLinkError");
    }

    @Test
    @DisplayName("execute: Error cru vira ERROR com o rotulo da tarefa")
    void executeLogaErrorComRotulo() throws Exception {
        CountDownLatch terminou = new CountDownLatch(1);
        executor.execute(new TarefaRotulada("notificacao 7", () -> {
            try {
                throw new StackOverflowError("estouro");
            } finally {
                terminou.countDown();
            }
        }));

        assertThat(terminou.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(esperarUmRegistro()).isTrue();
        assertThat(registros.list.get(0).getLevel()).isEqualTo(Level.ERROR);
        assertThat(registros.list.get(0).getFormattedMessage()).contains("notificacao 7");
    }

    @Test
    @DisplayName("o worker sobrevive: a tarefa seguinte executa depois de um Error")
    void workerSobrevive() throws Exception {
        executor.submit(new TarefaRotulada("monitor 1", () -> {
            throw new OutOfMemoryError("simulado");
        }));
        CountDownLatch seguinte = new CountDownLatch(1);
        executor.submit(new TarefaRotulada("monitor 2", seguinte::countDown));

        assertThat(seguinte.await(2, TimeUnit.SECONDS)).isTrue();
    }

    @Test
    @DisplayName("tarefa que termina bem nao gera registro nenhum")
    void sucessoNaoLoga() throws Exception {
        CountDownLatch terminou = new CountDownLatch(1);
        executor.submit(new TarefaRotulada("monitor 3", terminou::countDown));

        assertThat(terminou.await(2, TimeUnit.SECONDS)).isTrue();
        Thread.sleep(100);
        assertThat(registros.list).isEmpty();
    }

    @Test
    @DisplayName("shutdown e awaitTermination continuam chegando ao pool real")
    void delegaCicloDeVida() throws Exception {
        executor.shutdown();
        assertThat(executor.awaitTermination(2, TimeUnit.SECONDS)).isTrue();
        assertThat(poolReal.isShutdown()).isTrue();
        assertThat(executor.isTerminated()).isTrue();
    }

    private boolean esperarUmRegistro() throws InterruptedException {
        for (int tentativa = 0; tentativa < 40; tentativa++) {
            if (!registros.list.isEmpty()) {
                return true;
            }
            Thread.sleep(50);
        }
        return false;
    }
}
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd infra-monitor-backend && ./mvnw -q test -Dtest=ExecutorQueLogaFalhasTest
```

Esperado: FALHA de compilação — `TarefaRotulada` e `ExecutorQueLogaFalhas` não existem.

- [ ] **Step 3: Implementar `TarefaRotulada`**

```java
package br.com.inframonitor.common.concurrent;

import java.util.Objects;

/**
 * Runnable com nome. Existe porque o envelope de {@link ExecutorQueLogaFalhas}
 * loga {@code tarefa.toString()}: sem rotulo, o ERROR diria que "uma tarefa"
 * falhou sem dizer qual monitor ou qual notificacao, que e metade do valor.
 */
public record TarefaRotulada(String rotulo, Runnable delegada) implements Runnable {

    public TarefaRotulada {
        Objects.requireNonNull(rotulo, "rotulo");
        Objects.requireNonNull(delegada, "delegada");
    }

    @Override
    public void run() {
        delegada.run();
    }

    @Override
    public String toString() {
        return rotulo;
    }
}
```

- [ ] **Step 4: Implementar `ExecutorQueLogaFalhas`**

```java
package br.com.inframonitor.common.concurrent;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collection;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Decorator de ExecutorService que impede uma falha de tarefa de desaparecer.
 *
 * <p>Sem ele, pelo {@code submit} o FutureTask guarda o Throwable dentro de um
 * Future que ninguem le, e a falha some sem uma linha de log; pelo
 * {@code execute} a thread morre e o handler default imprime em stderr, fora
 * do Logback. Os dois casos sao reais neste projeto.
 *
 * <p>A falha e' logada e NAO relancada: o requisito e' que o worker sobreviva.
 * Isso inclui Error, OutOfMemoryError inclusive — engolir um Error e' uma
 * escolha deliberada, nao um descuido, e o ERROR gravado e o rastro dela.
 *
 * <p>{@code invokeAll}, {@code invokeAny} e {@code submit(Callable)} delegam
 * sem envelope: quem os chama bloqueia lendo o resultado, entao nada some.
 * Nenhum chamador deste projeto usa essas formas hoje.
 */
public final class ExecutorQueLogaFalhas implements ExecutorService {

    private static final Logger log = LoggerFactory.getLogger(ExecutorQueLogaFalhas.class);

    private final ExecutorService delegado;

    public ExecutorQueLogaFalhas(ExecutorService delegado) {
        this.delegado = delegado;
    }

    private static Runnable envelopar(Runnable tarefa) {
        return () -> {
            try {
                tarefa.run();
            } catch (Throwable falha) {
                log.error("Tarefa [{}] falhou e foi descartada", tarefa, falha);
            }
        };
    }

    @Override
    public void execute(Runnable tarefa) {
        delegado.execute(envelopar(tarefa));
    }

    @Override
    public Future<?> submit(Runnable tarefa) {
        return delegado.submit(envelopar(tarefa));
    }

    @Override
    public <T> Future<T> submit(Runnable tarefa, T resultado) {
        return delegado.submit(envelopar(tarefa), resultado);
    }

    @Override
    public <T> Future<T> submit(Callable<T> tarefa) {
        return delegado.submit(tarefa);
    }

    @Override
    public <T> List<Future<T>> invokeAll(Collection<? extends Callable<T>> tarefas) throws InterruptedException {
        return delegado.invokeAll(tarefas);
    }

    @Override
    public <T> List<Future<T>> invokeAll(Collection<? extends Callable<T>> tarefas, long tempo, TimeUnit unidade)
            throws InterruptedException {
        return delegado.invokeAll(tarefas, tempo, unidade);
    }

    @Override
    public <T> T invokeAny(Collection<? extends Callable<T>> tarefas) throws InterruptedException, java.util.concurrent.ExecutionException {
        return delegado.invokeAny(tarefas);
    }

    @Override
    public <T> T invokeAny(Collection<? extends Callable<T>> tarefas, long tempo, TimeUnit unidade)
            throws InterruptedException, java.util.concurrent.ExecutionException, TimeoutException {
        return delegado.invokeAny(tarefas, tempo, unidade);
    }

    @Override
    public void shutdown() {
        delegado.shutdown();
    }

    @Override
    public List<Runnable> shutdownNow() {
        return delegado.shutdownNow();
    }

    @Override
    public boolean isShutdown() {
        return delegado.isShutdown();
    }

    @Override
    public boolean isTerminated() {
        return delegado.isTerminated();
    }

    @Override
    public boolean awaitTermination(long tempo, TimeUnit unidade) throws InterruptedException {
        return delegado.awaitTermination(tempo, unidade);
    }
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
cd infra-monitor-backend && ./mvnw -q test -Dtest=ExecutorQueLogaFalhasTest
```

Esperado: 5 testes, 0 falhas.

- [ ] **Step 6: Prova de reversão — executar e colar a saída**

Trocar temporariamente, em `ExecutorQueLogaFalhas`, os dois métodos para delegar sem envelope:

```java
    @Override
    public void execute(Runnable tarefa) {
        delegado.execute(tarefa);
    }

    @Override
    public Future<?> submit(Runnable tarefa) {
        return delegado.submit(tarefa);
    }
```

Rodar `./mvnw -q test -Dtest=ExecutorQueLogaFalhasTest`, **guardar a saída da falha** (ela tem de
citar `submitLogaErrorComRotulo` e `executeLogaErrorComRotulo`, por lista de registros vazia — e não
por outro motivo), e desfazer a reversão com `git checkout -- <arquivo>` ou reaplicando o código do
Step 4. Rodar de novo e confirmar verde.

- [ ] **Step 7: Commit**

```bash
git add infra-monitor-backend/src/main/java/br/com/inframonitor/common/concurrent \
        infra-monitor-backend/src/test/java/br/com/inframonitor/common/concurrent
git commit -m "$(cat <<'EOF'
fix(pools): envelope que impede falha de tarefa de sumir no Future

Pelo submit o FutureTask guardava o Throwable num Future que ninguem le;
pelo execute a thread morria com stderr fora do Logback. O decorator loga
ERROR com o rotulo da tarefa e o worker sobrevive.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Ligar o envelope aos dois pools, com rótulo

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/config/MonitoringEngineConfiguration.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/notificacao/dispatcher/NotificationDispatcherConfiguration.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/execution/MonitorExecutionCoordinator.java:79`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/notificacao/dispatcher/NotificationDispatcher.java:66`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/execution/MonitorExecutionCoordinatorTest.java`

**Interfaces:**
- Consumes: `ExecutorQueLogaFalhas`, `TarefaRotulada` da Task 1.
- Produces: nada novo para tasks seguintes. Os beans `monitoringWorkerExecutor` e
  `notificationWorkerExecutor` continuam do tipo `ExecutorService`, com o mesmo nome.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `MonitorExecutionCoordinatorTest` (mantendo tudo que já existe no arquivo):

```java
    @Test
    @DisplayName("Error dentro da execucao do monitor vira ERROR nomeando o monitor")
    void errorNaExecucaoViraErrorComRotulo() throws Exception {
        ch.qos.logback.classic.Logger logger =
                (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(
                        br.com.inframonitor.common.concurrent.ExecutorQueLogaFalhas.class);
        ListAppender<ILoggingEvent> registros = new ListAppender<>();
        registros.start();
        logger.addAppender(registros);
        ExecutorService poolReal = Executors.newSingleThreadExecutor();
        MonitorExecutionCoordinator comEnvelope = new MonitorExecutionCoordinator(repository, medicaoService,
                new ExecutorQueLogaFalhas(poolReal),
                Clock.fixed(Instant.parse("2026-08-19T12:00:00Z"), ZoneOffset.UTC), List.of(executor));
        try {
            when(repository.findActiveExecutionCandidates()).thenReturn(List.of(candidate(77L, "10.0.0.9")));
            when(executor.execute(any())).thenAnswer(invocation -> {
                throw new UnsatisfiedLinkError("Iphlpapi nao encontrada");
            });

            comEnvelope.scheduleDueMonitors();

            assertThat(aguardarRegistro(registros)).isTrue();
            assertThat(registros.list.get(0).getLevel()).isEqualTo(Level.ERROR);
            assertThat(registros.list.get(0).getFormattedMessage()).contains("monitor 77");
        } finally {
            logger.detachAppender(registros);
            poolReal.shutdownNow();
        }
    }

    @Test
    @DisplayName("fila cheia: RejectedExecutionException continua virando WARN, e nao some")
    void filaCheiaContinuaLogando() {
        ch.qos.logback.classic.Logger logger = (ch.qos.logback.classic.Logger)
                org.slf4j.LoggerFactory.getLogger(MonitorExecutionCoordinator.class);
        ListAppender<ILoggingEvent> registros = new ListAppender<>();
        registros.start();
        logger.addAppender(registros);
        ExecutorService recusa = new ExecutorQueLogaFalhas(new java.util.concurrent.ThreadPoolExecutor(
                1, 1, 0, TimeUnit.MILLISECONDS, new java.util.concurrent.ArrayBlockingQueue<>(1),
                new java.util.concurrent.ThreadPoolExecutor.AbortPolicy()) {
            @Override
            public java.util.concurrent.Future<?> submit(Runnable tarefa) {
                throw new java.util.concurrent.RejectedExecutionException("fila cheia");
            }
        });
        MonitorExecutionCoordinator saturado = new MonitorExecutionCoordinator(repository, medicaoService,
                recusa, Clock.fixed(Instant.parse("2026-08-19T12:00:00Z"), ZoneOffset.UTC), List.of(executor));
        try {
            MonitorCandidate candidato = candidate(91L, "10.0.0.10");
            saturado.submit(candidato);

            assertThat(registros.list).isNotEmpty();
            assertThat(registros.list.get(0).getLevel()).isEqualTo(Level.WARN);
            assertThat(registros.list.get(0).getFormattedMessage()).contains("91");
            // o monitor voltou para a fila logica: nao ficou preso em runningMonitors
            assertThat(saturado.isRunning(91L)).isFalse();
        } finally {
            logger.detachAppender(registros);
            recusa.shutdownNow();
        }
    }

    private static boolean aguardarRegistro(ListAppender<ILoggingEvent> registros) throws InterruptedException {
        for (int tentativa = 0; tentativa < 40; tentativa++) {
            if (!registros.list.isEmpty()) {
                return true;
            }
            Thread.sleep(50);
        }
        return false;
    }
```

Imports a acrescentar no topo do arquivo de teste:

```java
import br.com.inframonitor.common.concurrent.ExecutorQueLogaFalhas;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.DisplayName;
```

- [ ] **Step 2: Rodar e confirmar que o primeiro teste falha pelo motivo certo**

```bash
cd infra-monitor-backend && ./mvnw -q test -Dtest=MonitorExecutionCoordinatorTest
```

Esperado: `errorNaExecucaoViraErrorComRotulo` FALHA — a lista de registros fica vazia, porque o
coordinator ainda submete um lambda anônimo sem rótulo (`ExecutorQueLogaFalhas` loga
`Tarefa [br.com...Lambda$...]`, que não contém `monitor 77`). `filaCheiaContinuaLogando` já passa: é
teste de travamento de comportamento existente, não de comportamento novo.

- [ ] **Step 3: Rotular a tarefa no coordinator**

Em `MonitorExecutionCoordinator.submit`, trocar a linha 79:

```java
            workerExecutor.submit(new TarefaRotulada("monitor " + candidate.monitorId(), () -> execute(candidate)));
```

Import: `import br.com.inframonitor.common.concurrent.TarefaRotulada;`

- [ ] **Step 4: Rotular a tarefa no dispatcher**

Em `NotificationDispatcher.submit`, trocar:

```java
        try { executor.execute(new TarefaRotulada("notificacao " + id, () -> process(id))); }
```

Import: `import br.com.inframonitor.common.concurrent.TarefaRotulada;`

- [ ] **Step 5: Embrulhar os dois beans**

`MonitoringEngineConfiguration`:

```java
    @Bean(destroyMethod = "shutdown")
    ExecutorService monitoringWorkerExecutor(MonitoringEngineProperties properties) {
        AtomicInteger sequence = new AtomicInteger();
        ThreadFactory factory = task -> new Thread(task, "monitor-worker-" + sequence.incrementAndGet());
        ThreadPoolExecutor pool = new ThreadPoolExecutor(properties.getWorkerThreads(), properties.getWorkerThreads(), 0,
                TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(properties.getQueueCapacity()), factory,
                new ThreadPoolExecutor.AbortPolicy());
        // AbortPolicy continua valendo: RejectedExecutionException sobe ate' o
        // chamador, que ja' a trata. O envelope so' cobre a falha DENTRO da tarefa.
        return new ExecutorQueLogaFalhas(pool);
    }
```

Import: `import br.com.inframonitor.common.concurrent.ExecutorQueLogaFalhas;`

`NotificationDispatcherConfiguration`, o mesmo padrão:

```java
    @Bean(destroyMethod = "shutdown")
    ExecutorService notificationWorkerExecutor(NotificationDispatcherProperties properties) {
        AtomicInteger sequence = new AtomicInteger();
        ThreadFactory factory = task -> new Thread(task, "notification-worker-" + sequence.incrementAndGet());
        ThreadPoolExecutor pool = new ThreadPoolExecutor(properties.getWorkerThreads(), properties.getWorkerThreads(), 0,
                TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(properties.getQueueCapacity()), factory,
                new ThreadPoolExecutor.AbortPolicy());
        return new ExecutorQueLogaFalhas(pool);
    }
```

- [ ] **Step 6: Rodar a suíte inteira**

```bash
cd infra-monitor-backend && ./mvnw -q test
```

Esperado: verde. `destroyMethod = "shutdown"` continua resolvendo — `ExecutorQueLogaFalhas` tem
`shutdown()` público.

- [ ] **Step 7: Prova de reversão — executar e colar a saída**

Reverter o Step 3 (voltar a `workerExecutor.submit(() -> execute(candidate))`), rodar
`./mvnw -q test -Dtest=MonitorExecutionCoordinatorTest`, guardar a saída mostrando
`errorNaExecucaoViraErrorComRotulo` falhando por não achar `monitor 77` no log, e desfazer.

- [ ] **Step 8: Commit**

```bash
git add infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring \
        infra-monitor-backend/src/main/java/br/com/inframonitor/notificacao \
        infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring
git commit -m "$(cat <<'EOF'
fix(pools): rotular a tarefa e embrulhar os dois executores

O ERROR do envelope passa a nomear o monitor ou a notificacao. Trava por
teste que a RejectedExecutionException da fila cheia continua virando WARN
nos dois lados, em vez de sumir.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Carga da biblioteca nativa uma única vez, na subida

**Files:**
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/icmp/CargaNativa.java`
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/icmp/IcmpAmbiente.java`
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/icmp/IcmpAmbienteConfiguration.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/icmp/nativo/Iphlpapi.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/icmp/IcmpRunnerConfiguration.java`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/icmp/IcmpAmbienteConfigurationTest.java`

**Interfaces:**
- Consumes: `IcmpImplementacao`, `IcmpProperties`, `Iphlpapi`, `MonitoringEngineProperties` (já existem).
- Produces:
  - `enum CargaNativa { OK, FALHOU, NAO_TENTADA }`
  - `record IcmpAmbiente(IcmpImplementacao pedida, IcmpImplementacao ativa, CargaNativa cargaNativa, String detalheFalha, boolean motorLigado, Iphlpapi nativo)`
  - `static IcmpAmbiente IcmpAmbienteConfiguration.resolver(IcmpImplementacao pedida, boolean windows, boolean motorLigado, Supplier<Iphlpapi> fabrica)`
  - `static Iphlpapi.Jna Iphlpapi.Jna.carregar()`
  - `@Bean IcmpAmbiente icmpAmbiente(...)`

- [ ] **Step 1: Escrever o teste que falha**

`IcmpAmbienteConfigurationTest.java`:

```java
package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitoring.icmp.nativo.Iphlpapi;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.sun.jna.Pointer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class IcmpAmbienteConfigurationTest {

    private final Logger logger = (Logger) LoggerFactory.getLogger(IcmpAmbienteConfiguration.class);
    private final ListAppender<ILoggingEvent> registros = new ListAppender<>();

    /** Reproduz o que a JNA faz: UnsatisfiedLinkError CRU, nao embrulhado. */
    private static final Supplier<Iphlpapi> CARGA_QUE_FALHA = () -> {
        throw new UnsatisfiedLinkError("Unable to load library 'Iphlpapi'");
    };

    @BeforeEach
    void preparar() {
        registros.start();
        logger.addAppender(registros);
    }

    @AfterEach
    void encerrar() {
        logger.detachAppender(registros);
    }

    @Test
    @DisplayName("nativo-windows pedido de proposito + carga falha: a aplicacao nao sobe")
    void nativoExplicitoComFalhaDeCargaDerrubaASubida() {
        assertThatThrownBy(() -> IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.NATIVO_WINDOWS, true, true, CARGA_QUE_FALHA))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("monitoring.icmp.implementacao=nativo-windows")
                .hasMessageContaining("Iphlpapi")
                .hasMessageContaining("processo-ping")
                .hasRootCauseInstanceOf(UnsatisfiedLinkError.class);
    }

    @Test
    @DisplayName("auto no Windows + carga falha: cai para processo-ping com ERROR na subida")
    void autoComFalhaDeCargaCaiParaProcessoPing() {
        IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.AUTO, true, true, CARGA_QUE_FALHA);

        assertThat(ambiente.pedida()).isEqualTo(IcmpImplementacao.AUTO);
        assertThat(ambiente.ativa()).isEqualTo(IcmpImplementacao.PROCESSO_PING);
        assertThat(ambiente.cargaNativa()).isEqualTo(CargaNativa.FALHOU);
        assertThat(ambiente.detalheFalha()).contains("UnsatisfiedLinkError");
        assertThat(ambiente.nativo()).isNull();
        assertThat(registros.list)
                .anySatisfy(evento -> {
                    assertThat(evento.getLevel()).isEqualTo(Level.ERROR);
                    assertThat(evento.getFormattedMessage()).contains("processo-ping");
                });
    }

    @Test
    @DisplayName("motor desligado nao carrega a biblioteca, mas resolve a implementacao")
    void motorDesligadoNaoCarrega() {
        AtomicInteger cargas = new AtomicInteger();
        IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.AUTO, true, false, contar(cargas));

        assertThat(cargas.get()).isZero();
        assertThat(ambiente.ativa()).isEqualTo(IcmpImplementacao.NATIVO_WINDOWS);
        assertThat(ambiente.cargaNativa()).isEqualTo(CargaNativa.NAO_TENTADA);
        assertThat(ambiente.motorLigado()).isFalse();
    }

    @Test
    @DisplayName("processo-ping nunca toca a camada nativa")
    void processoPingNaoCarrega() {
        AtomicInteger cargas = new AtomicInteger();
        IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.PROCESSO_PING, true, true, contar(cargas));

        assertThat(cargas.get()).isZero();
        assertThat(ambiente.cargaNativa()).isEqualTo(CargaNativa.NAO_TENTADA);
    }

    @Test
    @DisplayName("PROVA DE REVERSAO: a carga acontece UMA vez na subida e ZERO vezes por sondagem")
    void cargaAconteceUmaVezNaSubidaENuncaPorSondagem() {
        AtomicInteger cargas = new AtomicInteger();
        IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.NATIVO_WINDOWS, true, true, contar(cargas));

        // Se a carga voltar a ser preguicosa (dentro da sondagem), aqui e' 0 e o teste falha.
        assertThat(cargas.get()).isEqualTo(1);
        assertThat(ambiente.nativo()).isNotNull();

        IcmpCommandRunner runner = IcmpRunnerConfiguration.criarRunner(ambiente);
        for (int sondagem = 0; sondagem < 5; sondagem++) {
            runner.run("10.0.0.1", 100);
        }

        // Se alguem carregar por sondagem, aqui e' 6 e o teste falha.
        assertThat(cargas.get()).isEqualTo(1);
    }

    /** Iphlpapi falso: conta cargas e devolve sempre timeout, sem tocar a rede. */
    private static Supplier<Iphlpapi> contar(AtomicInteger cargas) {
        return () -> {
            cargas.incrementAndGet();
            return new Iphlpapi() {
                @Override
                public Pointer icmpCreateFile() {
                    return new Pointer(1L);
                }

                @Override
                public Retorno icmpSendEcho(Pointer handle, int destino, Pointer requisicao, short tamanho,
                                            Pointer opcoes, Pointer reply, int tamanhoReply, int timeoutMs) {
                    return new Retorno(0, 11010);
                }

                @Override
                public void icmpCloseHandle(Pointer handle) {
                }
            };
        };
    }
}
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd infra-monitor-backend && ./mvnw -q test -Dtest=IcmpAmbienteConfigurationTest
```

Esperado: FALHA de compilação — `CargaNativa`, `IcmpAmbiente`, `IcmpAmbienteConfiguration.resolver`
e `IcmpRunnerConfiguration.criarRunner` não existem.

- [ ] **Step 3: Criar `CargaNativa` e `IcmpAmbiente`**

```java
package br.com.inframonitor.monitoring.icmp;

/** Resultado da tentativa de carregar a biblioteca nativa, decidida na subida. */
public enum CargaNativa {
    OK,
    FALHOU,
    /** Nao se aplica: implementacao de processo, ou motor desligado. */
    NAO_TENTADA
}
```

```java
package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitoring.icmp.nativo.Iphlpapi;

/**
 * O que foi pedido, o que ficou ativo e se a biblioteca nativa carregou.
 *
 * <p>{@code pedida} e {@code ativa} sao campos distintos de proposito: sem eles,
 * um {@code auto} que caiu para processo-ping fica indistinguivel de um
 * processo-ping configurado de proposito, e a queda some do diagnostico.
 *
 * <p>{@code nativo} e a ligacao ja carregada, entregue ao runner. Nao e'
 * serializado: StatusController monta o proprio DTO.
 */
public record IcmpAmbiente(IcmpImplementacao pedida, IcmpImplementacao ativa, CargaNativa cargaNativa,
                           String detalheFalha, boolean motorLigado, Iphlpapi nativo) {
}
```

- [ ] **Step 4: Carga explícita em `Iphlpapi.Jna`**

Substituir a classe interna `Jna` inteira por:

```java
    /** Ligacao real com a DLL. A carga e' explicita, feita uma vez na subida. */
    final class Jna implements Iphlpapi {

        private interface Biblioteca extends StdCallLibrary {

            Pointer IcmpCreateFile() throws LastErrorException;

            int IcmpSendEcho(Pointer handle, int destinationAddress, Pointer requestData, short requestSize,
                             Pointer requestOptions, Pointer replyBuffer, int replySize, int timeout)
                    throws LastErrorException;

            boolean IcmpCloseHandle(Pointer handle) throws LastErrorException;
        }

        private final Biblioteca biblioteca;

        private Jna(Biblioteca biblioteca) {
            this.biblioteca = biblioteca;
        }

        /**
         * Carrega a DLL AGORA e lanca UnsatisfiedLinkError cru se falhar.
         *
         * <p>Antes, Native.load morava no inicializador estatico do campo
         * Biblioteca.INSTANCE — campo de interface e' implicitamente static
         * final —, entao a carga so acontecia na PRIMEIRA sondagem, dentro de
         * uma thread do pool. A falha virava erro de sondagem em vez de erro de
         * subida, e o operador via a rede inteira caida.
         */
        public static Jna carregar() {
            return new Jna(Native.load("Iphlpapi", Biblioteca.class, W32APIOptions.DEFAULT_OPTIONS));
        }

        @Override
        public Pointer icmpCreateFile() {
            return biblioteca.IcmpCreateFile();
        }

        @Override
        public Retorno icmpSendEcho(Pointer handle, int destino, Pointer requisicao, short tamanho,
                                    Pointer opcoes, Pointer reply, int tamanhoReply, int timeoutMs) {
            try {
                int valor = biblioteca.IcmpSendEcho(handle, destino, requisicao, tamanho,
                        opcoes, reply, tamanhoReply, timeoutMs);
                return new Retorno(valor, 0);
            } catch (LastErrorException excecao) {
                // JNA lanca quando GetLastError != 0 apos a chamada; o valor de
                // retorno foi 0 e o codigo real esta aqui.
                return new Retorno(0, excecao.getErrorCode());
            }
        }

        @Override
        public void icmpCloseHandle(Pointer handle) {
            biblioteca.IcmpCloseHandle(handle);
        }
    }
```

- [ ] **Step 5: Criar `IcmpAmbienteConfiguration`**

```java
package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitoring.config.MonitoringEngineProperties;
import br.com.inframonitor.monitoring.icmp.nativo.Iphlpapi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.function.Supplier;

/**
 * Resolve a implementacao ICMP e carrega a biblioteca nativa UMA vez, na subida.
 *
 * <p>Deliberadamente FORA do @ConditionalOnProperty do motor: com o motor
 * desligado nao ha sondagem, mas /api/v1/status continua tendo de dizer qual
 * implementacao este processo usaria.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({IcmpProperties.class, MonitoringEngineProperties.class})
public class IcmpAmbienteConfiguration {

    private static final Logger log = LoggerFactory.getLogger(IcmpAmbienteConfiguration.class);

    @Bean
    IcmpAmbiente icmpAmbiente(IcmpProperties icmpProperties, MonitoringEngineProperties engineProperties) {
        IcmpAmbiente ambiente = resolver(icmpProperties.getImplementacao(), IcmpRunnerConfiguration.isWindows(),
                engineProperties.isEnabled(), Iphlpapi.Jna::carregar);
        log.info("Implementacao ICMP ativa: {} (pedida: {}, carga nativa: {}, motor: {}, so={})",
                ambiente.ativa(), ambiente.pedida(), ambiente.cargaNativa(),
                ambiente.motorLigado() ? "ligado" : "desligado", System.getProperty("os.name"));
        return ambiente;
    }

    static IcmpAmbiente resolver(IcmpImplementacao pedida, boolean windows, boolean motorLigado,
                                 Supplier<Iphlpapi> fabrica) {
        IcmpImplementacao escolhida = IcmpRunnerConfiguration.escolher(pedida, windows);
        if (escolhida != IcmpImplementacao.NATIVO_WINDOWS || !motorLigado) {
            return new IcmpAmbiente(pedida, escolhida, CargaNativa.NAO_TENTADA, null, motorLigado, null);
        }
        try {
            return new IcmpAmbiente(pedida, escolhida, CargaNativa.OK, null, true, fabrica.get());
        } catch (RuntimeException | LinkageError falha) {
            // LinkageError e' obrigatorio: Native.load lanca UnsatisfiedLinkError,
            // que e' um Error e nao seria pego por catch (Exception).
            String detalhe = falha.getClass().getName() + ": " + falha.getMessage();
            if (pedida == IcmpImplementacao.NATIVO_WINDOWS) {
                throw new IllegalStateException(
                        "monitoring.icmp.implementacao=nativo-windows foi pedido explicitamente, mas a carga da "
                                + "biblioteca nativa Iphlpapi falhou: " + detalhe
                                + ". Suba com monitoring.icmp.implementacao=processo-ping para nao depender dela.",
                        falha);
            }
            log.error("Carga da biblioteca nativa Iphlpapi falhou nesta subida; monitoring.icmp.implementacao=auto "
                    + "cai para processo-ping. Detalhe: {}", detalhe, falha);
            return new IcmpAmbiente(pedida, IcmpImplementacao.PROCESSO_PING, CargaNativa.FALHOU, detalhe, true, null);
        }
    }
}
```

- [ ] **Step 6: `IcmpRunnerConfiguration` passa a consumir o ambiente**

Substituir o corpo da classe (mantendo `escolher`, que agora é usado por `IcmpAmbienteConfiguration`
e continua coberto por `IcmpRunnerConfigurationTest`):

```java
package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitoring.icmp.nativo.WindowsNativeIcmpRunner;
import br.com.inframonitor.monitoring.icmp.processo.ProcessoPingIcmpRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Locale;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "monitoring.engine", name = "enabled", havingValue = "true")
public class IcmpRunnerConfiguration {

    @Bean
    IcmpCommandRunner icmpCommandRunner(IcmpAmbiente ambiente) {
        return criarRunner(ambiente);
    }

    /** Visivel para teste: monta o runner a partir de um ambiente ja resolvido. */
    static IcmpCommandRunner criarRunner(IcmpAmbiente ambiente) {
        return ambiente.ativa() == IcmpImplementacao.NATIVO_WINDOWS
                ? new WindowsNativeIcmpRunner(ambiente.nativo())
                : new ProcessoPingIcmpRunner();
    }

    /** Resolve AUTO; nunca devolve AUTO. */
    static IcmpImplementacao escolher(IcmpImplementacao pedida, boolean windows) {
        if (pedida != IcmpImplementacao.AUTO) {
            return pedida;
        }
        return windows ? IcmpImplementacao.NATIVO_WINDOWS : IcmpImplementacao.PROCESSO_PING;
    }

    static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }
}
```

`@EnableConfigurationProperties(IcmpProperties.class)` sai daqui porque
`IcmpAmbienteConfiguration` — que existe sempre — já o declara; deixar nos dois faria o binding
depender de o motor estar ligado.

- [ ] **Step 7: Rodar e confirmar verde**

```bash
cd infra-monitor-backend && ./mvnw -q test -Dtest='IcmpAmbienteConfigurationTest+IcmpRunnerConfigurationTest+WindowsNativeIcmpRunnerTest+ProvaDeReversaoIcmpTest'
```

Esperado: todos verdes. `WindowsNativeIcmpRunnerTest` não muda: continua construindo o runner com um
`Iphlpapi` falso.

- [ ] **Step 8: Prova de reversão — executar e colar a saída**

Reverter para a carga preguiçosa: em `IcmpAmbienteConfiguration.resolver`, trocar
`fabrica.get()` por um `Iphlpapi` que só chama `fabrica.get()` dentro de `icmpCreateFile()`:

```java
            Supplier<Iphlpapi> preguicosa = fabrica;
            Iphlpapi tardio = new Iphlpapi() {
                @Override public Pointer icmpCreateFile() { return preguicosa.get().icmpCreateFile(); }
                @Override public Retorno icmpSendEcho(Pointer h, int d, Pointer rq, short t, Pointer o,
                                                      Pointer rp, int tr, int ms) {
                    return preguicosa.get().icmpSendEcho(h, d, rq, t, o, rp, tr, ms);
                }
                @Override public void icmpCloseHandle(Pointer h) { }
            };
            return new IcmpAmbiente(pedida, escolhida, CargaNativa.OK, null, true, tardio);
```

Rodar `./mvnw -q test -Dtest=IcmpAmbienteConfigurationTest`, guardar a saída mostrando
`cargaAconteceUmaVezNaSubidaENuncaPorSondagem` falhando com `expected: 1 but was: 0`, e desfazer.

- [ ] **Step 9: Commit**

```bash
git add infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/icmp \
        infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/icmp
git commit -m "$(cat <<'EOF'
fix(icmp): carregar a biblioteca nativa uma vez na subida, nao por sondagem

Native.load estava no inicializador estatico de um campo de interface e so
disparava na primeira sondagem: a falha virava medicao FALHA para sempre com
a aplicacao de pe. Agora nativo-windows explicito com falha de carga nao sobe,
e auto cai para processo-ping com ERROR na subida.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: A implementação ativa aparece em `GET /api/v1/status`

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/common/api/StatusController.java`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/common/api/StatusControllerTest.java`

**Interfaces:**
- Consumes: `IcmpAmbiente`, `CargaNativa`, `IcmpImplementacao` da Task 3.
- Produces: `StatusController.StatusResposta(String aplicacao, String status, Instant instante, IcmpResposta icmp)`
  e `StatusController.IcmpResposta(IcmpImplementacao pedida, IcmpImplementacao ativa, CargaNativa cargaNativa, String detalheFalha, boolean motorLigado)`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `StatusControllerTest` (os dois testes existentes ficam como estão):

```java
    @Test
    @DisplayName("o bloco icmp mostra a implementacao ativa e o estado da carga nativa")
    void exibeAImplementacaoIcmp() throws Exception {
        mockMvc.perform(get("/api/v1/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.icmp.ativa").value("NATIVO_WINDOWS"))
                .andExpect(jsonPath("$.icmp.pedida").value("AUTO"))
                .andExpect(jsonPath("$.icmp.cargaNativa").value("NAO_TENTADA"))
                .andExpect(jsonPath("$.icmp.motorLigado").value(false));
    }
```

E, no topo da classe, registrar o ambiente no contexto do `@WebMvcTest`:

```java
@WebMvcTest(StatusController.class)
@Import(StatusControllerTest.AmbienteDeTeste.class)
class StatusControllerTest {

    @TestConfiguration
    static class AmbienteDeTeste {
        @Bean
        IcmpAmbiente icmpAmbiente() {
            return new IcmpAmbiente(IcmpImplementacao.AUTO, IcmpImplementacao.NATIVO_WINDOWS,
                    CargaNativa.NAO_TENTADA, null, false, null);
        }
    }
```

Imports novos no teste:

```java
import br.com.inframonitor.monitoring.icmp.CargaNativa;
import br.com.inframonitor.monitoring.icmp.IcmpAmbiente;
import br.com.inframonitor.monitoring.icmp.IcmpImplementacao;
import org.junit.jupiter.api.DisplayName;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd infra-monitor-backend && ./mvnw -q test -Dtest=StatusControllerTest
```

Esperado: `exibeAImplementacaoIcmp` FALHA — `$.icmp` não existe no JSON.

- [ ] **Step 3: Implementar**

```java
package br.com.inframonitor.common.api;

import br.com.inframonitor.monitoring.icmp.CargaNativa;
import br.com.inframonitor.monitoring.icmp.IcmpAmbiente;
import br.com.inframonitor.monitoring.icmp.IcmpImplementacao;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;

/**
 * Endpoint minimo de infraestrutura: prova que a API responde no prefixo /api/v1
 * e diz qual implementacao ICMP este processo resolveu na subida.
 * Diagnostico completo (banco, disco) fica no Actuator em /actuator/health.
 */
@RestController
@RequestMapping("/api/v1")
public class StatusController {

    private final String aplicacao;
    private final ObjectProvider<IcmpAmbiente> ambiente;

    /**
     * ObjectProvider, e nao dependencia obrigatoria: @WebMvcTest nao carrega as
     * @Configuration de dominio, e exigir o bean quebraria o teste de fatia
     * deste controller sem ganho nenhum.
     */
    public StatusController(@Value("${spring.application.name}") String aplicacao,
                            ObjectProvider<IcmpAmbiente> ambiente) {
        this.aplicacao = aplicacao;
        this.ambiente = ambiente;
    }

    @GetMapping("/status")
    public StatusResposta status() {
        IcmpAmbiente resolvido = ambiente.getIfAvailable();
        IcmpResposta icmp = resolvido == null ? null
                : new IcmpResposta(resolvido.pedida(), resolvido.ativa(), resolvido.cargaNativa(),
                        resolvido.detalheFalha(), resolvido.motorLigado());
        return new StatusResposta(aplicacao, "UP", Instant.now(), icmp);
    }

    public record StatusResposta(String aplicacao, String status, Instant instante, IcmpResposta icmp) {
    }

    public record IcmpResposta(IcmpImplementacao pedida, IcmpImplementacao ativa, CargaNativa cargaNativa,
                               String detalheFalha, boolean motorLigado) {
    }
}
```

- [ ] **Step 4: Rodar a suíte inteira**

```bash
cd infra-monitor-backend && ./mvnw -q test
```

Esperado: verde.

- [ ] **Step 5: Commit**

```bash
git add infra-monitor-backend/src/main/java/br/com/inframonitor/common/api/StatusController.java \
        infra-monitor-backend/src/test/java/br/com/inframonitor/common/api/StatusControllerTest.java
git commit -m "$(cat <<'EOF'
feat(status): publicar a implementacao ICMP ativa em /api/v1/status

Inclui a implementacao pedida, a ativa e o estado da carga nativa, para que
uma queda de auto para processo-ping seja visivel sem ler log.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Medir o campo de mensagem da medição (evidência 4e)

**Files:**
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/icmp/IcmpMonitorExecutorTest.java`

**Interfaces:**
- Consumes: `IcmpMonitorExecutor.mensagem(IcmpResult)` (já existe, package-private).
- Produces: a medida que a Task 7 cola no documento.

- [ ] **Step 1: Escrever o teste**

Acrescentar a `IcmpMonitorExecutorTest`:

```java
    @Test
    @DisplayName("evidencia 4e: toda mensagem gerada cabe em medicao.mensagem VARCHAR(255)")
    void todaMensagemCabeNoCampo() {
        List<String> mensagens = new ArrayList<>();
        for (StatusIcmp status : StatusIcmp.values()) {
            if (status == StatusIcmp.SUCESSO) {
                continue;
            }
            IcmpResult resultado = status == StatusIcmp.ERRO
                    ? IcmpResult.erro(Integer.MIN_VALUE)
                    : IcmpResult.falha(status);
            mensagens.add(IcmpMonitorExecutor.mensagem(resultado));
        }
        mensagens.add(IcmpMonitorExecutor.mensagem(IcmpResult.erro(0)));
        // As duas do catch de IcmpMonitorExecutor.execute, literais no codigo.
        mensagens.add("Erro ao executar a sondagem ICMP");
        mensagens.add("Sondagem ICMP interrompida");

        String maior = mensagens.stream().max(Comparator.comparingInt(String::length)).orElseThrow();
        System.out.println("[4e] campo: medicao.mensagem VARCHAR(255)");
        mensagens.forEach(m -> System.out.println("[4e] " + m.length() + " | " + m));
        System.out.println("[4e] maior: " + maior.length() + " | " + maior);

        assertThat(maior.length()).isLessThan(255);
    }
```

Imports a acrescentar: `java.util.ArrayList`, `java.util.Comparator`, `java.util.List`,
`org.junit.jupiter.api.DisplayName`. Conferir quais já estão no arquivo antes de duplicar.

- [ ] **Step 2: Rodar e guardar a saída crua**

```bash
cd infra-monitor-backend && ./mvnw test -Dtest=IcmpMonitorExecutorTest | grep '\[4e\]'
```

Guardar todas as linhas `[4e]` — elas vão inteiras para o documento na Task 7.

- [ ] **Step 3: Commit**

```bash
git add infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/icmp/IcmpMonitorExecutorTest.java
git commit -m "$(cat <<'EOF'
test(icmp): medir a maior mensagem gerada contra o limite de medicao.mensagem

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Coletar as evidências de rede e de subida

**Files:**
- Create (descartável, fora do repositório): `<scratchpad>/SondaA0.java`
- Nenhum arquivo do projeto é modificado nesta task.

**Interfaces:**
- Consumes: `Iphlpapi.Jna.carregar()` e `WindowsNativeIcmpRunner` da Task 3.
- Produces: blocos de saída crua que a Task 7 cola no documento.

- [ ] **Step 1: Escrever a sonda descartável**

No diretório de scratchpad (nunca dentro do repositório), `SondaA0.java`, um `main` que:

1. Para cada alvo de `10.79.10.6`, `10.72.10.16`, `10.79.20.250`, `10.73.10.15`: chama
   `IcmpSendEcho` com `IP_OPTION_INFORMATION.Ttl = 128`, timeout 3000 ms, e imprime uma linha
   `alvo=<ip> retorno=<n> replyStatus=<n|-> lastError=<n|-> rttMs=<n|->`. Sonda `10.79.20.250` duas
   vezes seguidas, para cobrir cache ARP frio e quente.
2. Contra `10.72.10.16`: 10 sondagens com `RequestOptions = NULL` e 5 com `Ttl = 128`, imprimindo
   cada retorno e, ao final, a contagem por resultado.
3. Contra `10.79.10.6`: 10 amostras do `RoundTripTime` nativo.

Compilar e rodar com o classpath da JNA já baixada pelo Maven:

```bash
cd infra-monitor-backend && ./mvnw -q dependency:build-classpath -Dmdep.outputFile=target/cp.txt
```

- [ ] **Step 2: Rodar a sonda e guardar a saída crua**

Guardar as três saídas **sem editar**. Elas são as evidências 4a, 4b e 4c.

- [ ] **Step 3: Rodar `ping.exe` para a comparação de RTT**

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do ping -n 1 -w 3000 10.79.10.6 | grep -i "tempo\|time"; done
```

Guardar a saída crua. É a outra metade da evidência 4c.

- [ ] **Step 4: Subir a aplicação com o motor desligado e guardar o log**

```bash
cd infra-monitor-backend && DB_PORT=5434 JWT_SECRET="<o secret de dev ja usado neste ambiente>" \
  MONITORING_ENGINE_ENABLED=false NOTIFICATION_TELEGRAM_ENABLED=false \
  ./mvnw spring-boot:run -Dspring-boot.run.jvmArguments="-Dmonitoring.engine.enabled=false -Dnotification.telegram.enabled=false"
```

Guardar a linha `Implementacao ICMP ativa: ...` crua, com o contexto de algumas linhas em volta.

Se a porta `${SERVER_PORT}` estiver ocupada, usar outra e registrar qual. O banco é o de dev na
porta 5434 — **somente leitura e as migrations já aplicadas**; nenhuma `V19` existe, então o Flyway
não tem nada novo para rodar. Confirmar isso na saída (`Successfully validated N migrations`).

- [ ] **Step 5: Chamar `/api/v1/status` e guardar a resposta crua**

```bash
curl -s http://localhost:<porta>/api/v1/status
```

Guardar o JSON exatamente como voltou. Derrubar a aplicação depois.

- [ ] **Step 6: Confirmar que o banco não foi tocado**

```bash
docker exec inframonitor-postgres psql -U inframonitor -d inframonitor \
  -c "SELECT version, description, installed_on FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 3;"
git status --short infra-monitor-backend/src/main/resources/db/migration
```

Esperado: a última migration continua sendo a `V18`, e o `git status` do diretório de migrations sai
vazio.

Sem commit nesta task: nada do repositório mudou.

---

### Task 7: Atualizar `icmp-falsos-positivos.md`

**Files:**
- Modify: `Docs/validacao-producao/icmp-falsos-positivos.md`

**Interfaces:**
- Consumes: as saídas cruas das Tasks 5 e 6, e a saída de `\d equipamento`.
- Produces: o documento corrigido, citado no relatório final.

- [ ] **Step 1: Corrigir a dívida 4**

Substituir o item 4 da seção `## Dívidas do ciclo` por:

```markdown
4. `WindowsNativeIcmpRunner.paraOrdemDeRede` só entende IPv4. A coluna do alvo é
   `equipamento.ip_address`, e o tipo é `VARCHAR(45)` **desde a `V4`**, não `INET`:

   ```
    ip_address          | character varying(45)    |           |          |
   ```

   Um registro anterior desta série afirmou que a coluna era `INET`; **estava errado**, no nome e no
   tipo. A `V2:88` de fato a criou como `INET NOT NULL`, com `ck_equipamento_ip_e_host` (`V2:104-106`)
   exigindo máscara de host; a `V4:5-9` derrubou a constraint e converteu para `VARCHAR(45)` NULL.
   O CLAUDE.md do projeto ainda registra "endereços IP deverão utilizar o tipo PostgreSQL `INET`"
   como decisão arquitetural — o estado real diverge da decisão, e isso fica em aberto.

   O risco **aumentou** com a conversão: `VARCHAR(45)` não valida nada — aceita IPv6, hostname e
   lixo, enquanto o `INET` original ao menos rejeitava o que não fosse endereço. Um alvo não-IPv4
   faz `paraOrdemDeRede` lançar `IllegalArgumentException` (`:123`), que o
   `catch (RuntimeException | LinkageError)` de `:73` transforma em `IcmpResult.erro(0)`, e o banco
   recebe medição `FALHA` com `"Erro ICMP não identificado"` em **toda** sondagem daquele monitor,
   sem nada apontar para a causa.
```

- [ ] **Step 2: Acrescentar as saídas novas das evidências 4a, 4b e 4c**

Em cada seção correspondente (`## Saída bruta do IcmpSendEcho`, `## A descoberta do RequestOptions
= NULL`, `## Comparação de RTT`), acrescentar um bloco `Reexecução em 2026-09-22:` com a saída crua
da Task 6, **sem apagar** a de 2026-09-21. Se algum número divergir, dizer que divergiu e não
escolher um deles em silêncio.

- [ ] **Step 3: Completar a evidência 4d com o trecho de código**

Na seção `## Handle por chamada, não por thread`, acrescentar os dois trechos citados:
o `try`/`finally` do handle em `WindowsNativeIcmpRunner:36-85` e
`MonitoringEngineProperties:9` (`private int workerThreads = 4;`), cada um com arquivo e linha.

- [ ] **Step 4: Acrescentar a seção nova da evidência 4e**

```markdown
## O campo de mensagem da medição

Campo: `medicao.mensagem`, `VARCHAR(255)` (`V6__create_medicao.sql:7`). Todas as mensagens que o
código pode gravar vêm de um único lugar, `IcmpMonitorExecutor.mensagem` mais os dois literais do
`catch` de `execute` — `PingOutputParser` devolve status, nunca texto. Medido por
`IcmpMonitorExecutorTest.todaMensagemCabeNoCampo`:

<saída crua [4e] da Task 5>

A maior mensagem gerável tem <N> caracteres, com folga de <255-N> sobre o limite da coluna.
```

- [ ] **Step 5: Acrescentar a evidência 4f**

```markdown
## O comando do `ping` em cada sistema

Windows (`ProcessoPingIcmpRunner:68`): `ping -n 1 -w <timeoutMs> <ip>` — `-w` em milissegundos.

Linux (`ProcessoPingIcmpRunner:70-73`):

    ping -n -c 1 -W <segundos> <ip>

`-n` suprime a resolução de nomes; `-c 1` envia um pacote; `-W` é o timeout de resposta **em
segundos** e não aceita fração, então `timeoutMs` é arredondado para cima —
`Math.max(1L, (timeoutMs + 999L) / 1000L)` — para o timeout efetivo nunca ficar menor que o pedido.
Um `timeoutMs` de 2000 vira `-W 2`; de 2001, `-W 3`.

Continua valendo a dívida 2: o formato de saída do `ping` do Linux não foi verificado em máquina
Linux.
```

- [ ] **Step 6: Nomear a fase de verificação do SYSTEM**

No fim da seção `## Condição (2) da trava de viabilidade: NÃO VERIFICADA`, acrescentar:

```markdown
**Onde isso será verificado.** Na **instalação do serviço Windows**, fase de implantação do
Monitoring Engine — o primeiro momento em que a aplicação roda sob a conta de serviço de verdade, e
o único em que a verificação não seria uma simulação. Item de checklist daquela fase, em uma linha:
*com o serviço instalado e rodando sob a conta de produção, e o motor ligado, conferir em
`GET /api/v1/status` que `icmp.cargaNativa = OK` e `icmp.ativa = NATIVO_WINDOWS`, e confirmar no log
de subida que não houve queda para `processo-ping`.* Enquanto essa fase não chegar, a condição (2)
permanece **NÃO VERIFICADA**, e nenhuma inferência sobre privilégio a substitui.
```

- [ ] **Step 7: Registrar o modo de falha novo da camada nativa**

Na seção `## A decisão: IcmpSendEcho via JNA no Windows`, acrescentar um parágrafo dizendo que a
carga passou a acontecer uma única vez na subida (`IcmpAmbienteConfiguration.resolver`), que
`nativo-windows` explícito com falha de carga derruba a subida e que `auto` cai para `processo-ping`
com ERROR — e que `GET /api/v1/status` publica `pedida`, `ativa` e `cargaNativa`.

- [ ] **Step 8: Commit**

```bash
git add Docs/validacao-producao/icmp-falsos-positivos.md
git commit -m "$(cat <<'EOF'
docs(validacao): corrigir o tipo de equipamento.ip_address e completar a Parte A

A coluna e ip_address VARCHAR(45) desde a V4, nao equipamento.ip INET. Entram
tambem o campo de mensagem da medicao, o comando do ping no Linux com -W e a
fase em que a execucao como SYSTEM sera verificada.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Resumo da Parte B (B.1 a B.7) e rascunho da V19

**Files:**
- Read: `Docs/validacao-producao/manutencao-proposta.md`
- Create (fora do repositório): `<scratchpad>/parte-b-resumo.md`

**Interfaces:**
- Consumes: nada de código.
- Produces: o texto que vai para a resposta final. Nenhum arquivo do projeto muda.

- [ ] **Step 1: Ler o documento inteiro**

`Docs/validacao-producao/manutencao-proposta.md`, 673 linhas. Seções: B.1 (`:23`), B.2 (`:177`),
B.3 (`:246`), B.4 (`:323`), B.5 (`:429`), B.6 (`:515`), B.7 (`:547`), dívidas (`:629`).

- [ ] **Step 2: Escrever o resumo**

Para **cada** item de B.1 a B.7, exatamente três blocos:

- **Proposta** — 3 a 6 linhas. Não mais.
- **Alternativas descartadas** — uma linha por alternativa, cada uma com o motivo do descarte.
- **Em aberto** — o que exige decisão de produto. Se não houver nada em aberto, dizer "nada".

Regra dura: **não colar as 673 linhas**, e não inventar conteúdo que não esteja no documento. Se uma
seção não tiver alternativa descartada registrada, dizer isso em vez de fabricar uma.

- [ ] **Step 3: Copiar o rascunho da V19 na íntegra**

Copiar **sem cortar** o bloco SQL de `manutencao-proposta.md:56-103`, mais a tabela de classificação
das linhas antigas (`:120-140`) e a decisão de não fazer backfill do episódio de latência
(`:147-175`), incluindo o terceiro caso ambíguo que fica `NULL`.

Sem commit: nada do repositório muda.

---

### Task 9: Validação final

**Files:** nenhum.

- [ ] **Step 1: Suíte completa**

```bash
cd infra-monitor-backend && ./mvnw test
```

Guardar a linha `Tests run: ...` crua.

- [ ] **Step 2: Confirmar que nenhuma migration nasceu**

```bash
git status --short infra-monitor-backend/src/main/resources/db/migration
ls infra-monitor-backend/src/main/resources/db/migration | grep -c "^V19" || echo "nenhuma V19 — correto"
```

- [ ] **Step 3: Confirmar que não houve merge**

```bash
git branch --show-current   # fix/icmp-nativo-windows
git log --oneline main..HEAD | head -20
```

- [ ] **Step 4: Revisar o diff inteiro**

```bash
git diff main...HEAD --stat
```

Conferir que só aparecem os arquivos previstos na tabela de estrutura, mais os documentos.

---

## Self-review

**Cobertura do spec:** item 1 → Tasks 6 (Step 6) e 7 (Step 1); item 2 → Tasks 3, 4 e 6 (Steps 4-5);
item 3 → Tasks 1 e 2; item 4 → Tasks 5, 6 e 7; item 5 → Task 8; validação final → Task 9.

**Divergência do spec, deliberada:** o spec chamava o holder de `IcmpImplementacaoAtiva` e previa
`IcmpEstadoConfiguration`. O plano usa `IcmpAmbiente` e `IcmpAmbienteConfiguration`, porque o record
carrega também a ligação `Iphlpapi` carregada, e "implementação ativa" descreveria mal esse campo.
Nada mais muda.

**Frontend:** `/api/v1/status` não é consumido por nenhum arquivo de `infra-monitor-frontend/src`
(grep vazio). Esta rodada não tem verificação de Playwright, e isso é dito no relatório final em vez
de ser omitido.

**Consistência de tipos:** `IcmpAmbiente` tem a mesma assinatura na Task 3 (criação), na Task 3
(`criarRunner`), na Task 4 (`StatusController`) e no teste da Task 4. `TarefaRotulada(String,
Runnable)` e `new ExecutorQueLogaFalhas(ExecutorService)` são idênticos nas Tasks 1 e 2.

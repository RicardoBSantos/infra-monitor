package br.com.inframonitor.monitoring.execution;

import br.com.inframonitor.common.concurrent.ExecutorQueLogaFalhas;
import br.com.inframonitor.medicao.dto.CreateMedicaoRequest;
import br.com.inframonitor.medicao.dto.MedicaoResponse;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.service.MedicaoService;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.lang.management.ManagementFactory;
import java.lang.management.ThreadMXBean;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.LockSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Arnes de capacidade: mede o pool de monitoramento numa queda em massa.
 *
 * <p>Fica FORA do {@code ./mvnw test} por {@code @Tag("bench")}: segura threads de
 * proposito e leva minutos. Roda sob demanda:
 * {@code ./mvnw -o test -Dexcluded.groups=rede-real -Dgroups=bench}.
 *
 * <p>Nao toca banco: repositorio e MedicaoService sao falsos, em memoria. O que e' REAL
 * aqui e' o {@link MonitorExecutionCoordinator}, o {@link ExecutorQueLogaFalhas} e o
 * {@link ThreadPoolExecutor} montado exatamente como em MonitoringEngineConfiguration.
 *
 * <p><b>Compressao de tempo.</b> Um ciclo de producao e' 30 s de intervalo com 2000 ms de
 * timeout; medir isso em tempo de parede levaria dezenas de minutos por celula. O arnes
 * comprime TODO o experimento pelo mesmo fator {@link #FATOR}: o relogio que o coordenador
 * le anda {@code FATOR} vezes mais rapido que o relogio de parede, e toda espera real e'
 * dividida por {@code FATOR}. A RAZAO entre ocupacao de thread e intervalo de agendamento —
 * que e' o que determina a saturacao — fica identica a' de producao, e a ocupacao do pool
 * continua sendo tempo real de thread parada, nao tempo virtualizado. Os numeros
 * reportados ja' saem em tempo VIRTUAL, isto e', na escala de producao.
 */
@Tag("bench")
class CapacidadeQuedaEmMassaBenchTest {

    private static final int N = 250;
    private static final int INTERVALO_SEGUNDOS = 30;
    private static final int TIMEOUT_MS = 2000;
    private static final int FILA = 100;
    private static final int CICLOS_DE_FALHA_ALVO = 3;
    private static final long SCHEDULER_DELAY_MS = 1_000;
    private static final int SUCESSO_MS = 1;

    /**
     * Fator de compressao do experimento: 1 ms real = FATOR ms virtuais.
     *
     * <p>4, nao 10: o relogio de espera do Windows tem granularidade de ~15 ms, entao
     * quanto menor a espera real, maior o erro relativo. Com 4, a falha espera 500 ms
     * reais e o excesso de uma batida de relogio fica em ~3%. O arnes mede e reporta a
     * ocupacao REAL de cada caminho, em vez de assumir a nominal.
     */
    private static final long FATOR = 4;

    /** Teto de seguranca por celula, em tempo real. */
    private static final Duration TETO_REAL = Duration.ofMinutes(4);

    private static final Instant INICIO_VIRTUAL = Instant.parse("2026-09-22T00:00:00Z");

    private RelogioComprimido clock;

    @ParameterizedTest(name = "K={0} workers={1}")
    @CsvSource({
        "25,4", "100,4", "250,4",
        "25,16", "100,16", "250,16",
        "25,32", "100,32", "250,32"
    })
    void quedaEmMassa(int k, int workers) throws Exception {
        clock = new RelogioComprimido(INICIO_VIRTUAL, FATOR);

        EstadoFalso estado = new EstadoFalso(k, INTERVALO_SEGUNDOS);
        MonitorRepository repositorio = repositorioFalso(estado);
        MedicaoService medicaoService = new MedicaoServiceFalso(estado);
        MonitorExecutor executor = new ExecutorFalso(estado, clock, k);

        List<Thread> workerThreads = new ArrayList<>();
        AtomicInteger sequencia = new AtomicInteger();
        ThreadFactory factory = tarefa -> {
            Thread t = new Thread(tarefa, "monitor-worker-" + sequencia.incrementAndGet());
            synchronized (workerThreads) { workerThreads.add(t); }
            return t;
        };
        ThreadPoolExecutor pool = new ThreadPoolExecutor(workers, workers, 0, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(FILA), factory, new ThreadPoolExecutor.AbortPolicy());
        ExecutorQueContaRejeicoes contador = new ExecutorQueContaRejeicoes(new ExecutorQueLogaFalhas(pool));

        MonitorExecutionCoordinator coordinator =
                new MonitorExecutionCoordinator(repositorio, medicaoService, contador, clock, List.of(executor));

        ThreadMXBean threadMx = ManagementFactory.getThreadMXBean();
        boolean cpuMedida = threadMx.isThreadCpuTimeSupported();
        if (cpuMedida) threadMx.setThreadCpuTimeEnabled(true);

        Runtime runtime = Runtime.getRuntime();
        System.gc();
        long heapAntes = runtime.totalMemory() - runtime.freeMemory();
        long heapPico = heapAntes;
        int threadsPico = Thread.activeCount();

        long inicioReal = System.nanoTime();
        long tetoReal = inicioReal + TETO_REAL.toNanos();
        long fimReal = -1;
        long esperaSchedulerReal = TimeUnit.MILLISECONDS.toNanos(SCHEDULER_DELAY_MS) / FATOR;

        while (System.nanoTime() < tetoReal) {
            coordinator.scheduleDueMonitors();
            heapPico = Math.max(heapPico, runtime.totalMemory() - runtime.freeMemory());
            threadsPico = Math.max(threadsPico, Thread.activeCount());
            if (estado.todosOsFalhosAtingiram(CICLOS_DE_FALHA_ALVO)) { fimReal = System.nanoTime(); break; }
            LockSupport.parkNanos(esperaSchedulerReal);
        }

        long duracaoRealNs = (fimReal < 0 ? System.nanoTime() : fimReal) - inicioReal;

        long cpuWorkersNs = 0;
        if (cpuMedida) {
            synchronized (workerThreads) {
                for (Thread t : workerThreads) {
                    long cpu = threadMx.getThreadCpuTime(t.threadId());
                    if (cpu > 0) cpuWorkersNs += cpu;
                }
            }
        }

        pool.shutdownNow();
        pool.awaitTermination(30, TimeUnit.SECONDS);

        double duracaoVirtualS = duracaoRealNs / 1_000_000_000.0 * FATOR;
        long[] atrasos = estado.atrasosSaudaveisOrdenados();

        String cpu = cpuMedida
                ? String.format("%.0f ms de CPU para %d threads x %.1f s reais = %.2f%% de uma CPU "
                        + "(nao do pool de %d workers)",
                        cpuWorkersNs / 1_000_000.0, workers, duracaoRealNs / 1_000_000_000.0,
                        100.0 * cpuWorkersNs / Math.max(1L, duracaoRealNs), workers)
                : "NAO VERIFICADO (ThreadMXBean sem CPU por thread)";

        System.out.printf(
            "%n[BENCH] K=%d workers=%d | concluiu=%s | 3o ciclo de falha de todos os K: %.1f s virtuais "
          + "(%.1f s reais) | rejeicoes=%d | atraso saudaveis p50=%s p95=%s max=%s ms virtuais (n=%d) "
          + "| medicoes falha=%d sucesso=%d | heap antes=%.1f MB pico=%.1f MB delta=%.1f MB "
          + "| threads vivas pico=%d workers=%d | cpu dos workers: %s "
          + "| ocupacao real media: sucesso=%.3f ms (%.1f virtuais) falha=%.1f ms (%.0f virtuais)%n",
            k, workers, fimReal >= 0 ? "SIM" : "NAO (teto)",
            duracaoVirtualS, duracaoRealNs / 1_000_000_000.0,
            contador.rejeicoes(),
            percentil(atrasos, 0.50), percentil(atrasos, 0.95), percentil(atrasos, 1.0), atrasos.length,
            estado.totalFalhas(), estado.totalSucessos(),
            heapAntes / 1048576.0, heapPico / 1048576.0, (heapPico - heapAntes) / 1048576.0,
            threadsPico, workers, cpu,
            estado.ocupacaoMediaSucessoRealMs(), estado.ocupacaoMediaSucessoRealMs() * FATOR,
            estado.ocupacaoMediaFalhaRealMs(), estado.ocupacaoMediaFalhaRealMs() * FATOR);

        // Nao assertamos convergencia (todosOsFalhosAtingiram) nem um piso arbitrario de
        // totalFalhas(): a celula K=250/workers=4 estoura o TETO_REAL sem convergir e ainda
        // assim acumula muito mais que qualquer piso pequeno faria parecer suspeito - um
        // "isGreaterThan(k)" antigo passava exatamente nesse caso que deveria capturar. O que
        // o arnes sabe checar e' a propria sanidade da simulacao: a falha REAL de cada monitor
        // com falhasPorMonitor <= k precisa ocupar ~TIMEOUT_MS (em tempo virtual), porque e'
        // isso que ExecutorFalso.execute() faz de proposito. Se essa ocupacao desviar muito do
        // timeout configurado, o experimento parou de medir o que diz medir - convirja ou nao.
        double ocupacaoVirtualFalhaMs = estado.ocupacaoMediaFalhaRealMs() * FATOR;
        assertThat(ocupacaoVirtualFalhaMs)
                .as("ocupacao media de falha (virtual) deve ficar perto do TIMEOUT_MS configurado")
                .isCloseTo(TIMEOUT_MS, org.assertj.core.data.Percentage.withPercentage(10));
    }

    // ---------- relogio ----------

    /**
     * Clock que anda {@code fator} vezes mais rapido que o relogio de parede, ancorado num
     * instante fixo. E' o unico relogio que o coordenador enxerga.
     */
    static final class RelogioComprimido extends Clock {
        private final Instant base;
        private final long origemNanos;
        private final long fator;

        RelogioComprimido(Instant base, long fator) {
            this.base = base;
            this.fator = fator;
            this.origemNanos = System.nanoTime();
        }

        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return base.plusNanos((System.nanoTime() - origemNanos) * fator); }
    }

    // ---------- duplos ----------

    private MonitorRepository repositorioFalso(EstadoFalso estado) {
        MonitorRepository repositorio = mock(MonitorRepository.class);
        when(repositorio.findActiveExecutionCandidates()).thenAnswer(invocacao -> estado.candidatos());
        return repositorio;
    }

    /** Estado vivo que o repositorio falso releria do banco a cada varredura. */
    static final class EstadoFalso {
        private final int k;
        private final int intervaloSegundos;
        private final Map<Long, Instant> ultimaMedicaoEm = new ConcurrentHashMap<>();
        private final Map<Long, AtomicInteger> falhasPorMonitor = new ConcurrentHashMap<>();
        private final AtomicLong totalFalhas = new AtomicLong();
        private final AtomicLong totalSucessos = new AtomicLong();
        private final ConcurrentLinkedQueue<Long> atrasosSaudaveis = new ConcurrentLinkedQueue<>();
        private final AtomicLong sucessoOcupacaoRealNs = new AtomicLong();
        private final AtomicLong sucessoAmostras = new AtomicLong();
        private final AtomicLong falhaOcupacaoRealNs = new AtomicLong();
        private final AtomicLong falhaAmostras = new AtomicLong();

        EstadoFalso(int k, int intervaloSegundos) {
            this.k = k;
            this.intervaloSegundos = intervaloSegundos;
            for (long id = 1; id <= N; id++) falhasPorMonitor.put(id, new AtomicInteger());
        }

        List<MonitorCandidate> candidatos() {
            List<MonitorCandidate> lista = new ArrayList<>(N);
            for (long id = 1; id <= N; id++) {
                lista.add(new MonitorCandidate(id, TipoMonitor.ICMP, intervaloSegundos, TIMEOUT_MS,
                        "10.0." + (id / 256) + "." + (id % 256), ultimaMedicaoEm.get(id)));
            }
            return lista;
        }

        void registrar(long monitorId, StatusMedicao status, Instant executadoEm) {
            Instant anterior = ultimaMedicaoEm.put(monitorId, executadoEm);
            if (status == StatusMedicao.FALHA) {
                totalFalhas.incrementAndGet();
                falhasPorMonitor.get(monitorId).incrementAndGet();
            } else {
                totalSucessos.incrementAndGet();
                if (anterior != null) {
                    atrasosSaudaveis.add(Duration.between(anterior, executadoEm).toMillis()
                            - intervaloSegundos * 1000L);
                }
            }
        }

        void registrarOcupacaoSucesso(long nanos) {
            sucessoOcupacaoRealNs.addAndGet(nanos);
            sucessoAmostras.incrementAndGet();
        }

        void registrarOcupacaoFalha(long nanos) {
            falhaOcupacaoRealNs.addAndGet(nanos);
            falhaAmostras.incrementAndGet();
        }

        double ocupacaoMediaSucessoRealMs() {
            long amostras = sucessoAmostras.get();
            return amostras == 0 ? 0 : sucessoOcupacaoRealNs.get() / 1_000_000.0 / amostras;
        }

        double ocupacaoMediaFalhaRealMs() {
            long amostras = falhaAmostras.get();
            return amostras == 0 ? 0 : falhaOcupacaoRealNs.get() / 1_000_000.0 / amostras;
        }

        boolean todosOsFalhosAtingiram(int ciclos) {
            for (long id = 1; id <= k; id++) {
                if (falhasPorMonitor.get(id).get() < ciclos) return false;
            }
            return true;
        }

        long totalFalhas() { return totalFalhas.get(); }
        long totalSucessos() { return totalSucessos.get(); }

        long[] atrasosSaudaveisOrdenados() {
            long[] valores = atrasosSaudaveis.stream().mapToLong(Long::longValue).toArray();
            Arrays.sort(valores);
            return valores;
        }
    }

    /** MedicaoService falso: grava ultimaMedicaoEm e conta, sem tocar em banco. */
    static final class MedicaoServiceFalso extends MedicaoService {
        private final EstadoFalso estado;

        MedicaoServiceFalso(EstadoFalso estado) {
            super(null, null, null, null);
            this.estado = estado;
        }

        @Override
        public MedicaoResponse criar(CreateMedicaoRequest requisicao) {
            estado.registrar(requisicao.monitorId(), requisicao.status(), requisicao.executadoEm());
            return null;
        }
    }

    /**
     * Runner falso com a latencia real do ICMP: sucesso ocupa ~1 ms virtual, falha ocupa o
     * TIMEOUT inteiro — e' o que o IcmpSendEcho faz quando o host nao responde. As esperas
     * sao divididas por FATOR porque o experimento inteiro esta' comprimido.
     */
    static final class ExecutorFalso implements MonitorExecutor {
        private final EstadoFalso estado;
        private final Clock clock;
        private final int k;

        ExecutorFalso(EstadoFalso estado, Clock clock, int k) {
            this.estado = estado;
            this.clock = clock;
            this.k = k;
        }

        @Override public TipoMonitor supports() { return TipoMonitor.ICMP; }

        @Override
        public MonitorExecutionResult execute(MonitorCandidate monitor) {
            long inicio = System.nanoTime();
            if (monitor.monitorId() <= k) {
                dormirReal(TimeUnit.MILLISECONDS.toNanos(monitor.timeoutMs()) / FATOR);
                estado.registrarOcupacaoFalha(System.nanoTime() - inicio);
                return MonitorExecutionResult.failure("timeout", clock.instant());
            }
            dormirReal(TimeUnit.MILLISECONDS.toNanos(SUCESSO_MS) / FATOR);
            estado.registrarOcupacaoSucesso(System.nanoTime() - inicio);
            return MonitorExecutionResult.success(SUCESSO_MS, clock.instant());
        }

        /** Limite abaixo do qual o relogio do Windows (~15 ms) nao serve e a espera gira. */
        private static final long LIMITE_GIRO_NS = 2_000_000L;

        private static void dormirReal(long nanos) {
            long alvo = System.nanoTime() + nanos;
            long restante = nanos;
            while (restante > LIMITE_GIRO_NS) {
                LockSupport.parkNanos(restante - LIMITE_GIRO_NS);
                restante = alvo - System.nanoTime();
            }
            while (System.nanoTime() < alvo) Thread.onSpinWait();
        }
    }

    /**
     * Decorador que conta RejectedExecutionException antes de repassa-la. Escolhido em vez
     * do ListAppender do Logback: conta o evento no ponto exato onde ele acontece, sem
     * depender do nivel de log configurado nem do texto da mensagem, e sem alterar a cadeia
     * de producao (ThreadPoolExecutor + AbortPolicy + ExecutorQueLogaFalhas), que continua
     * inteira por dentro.
     */
    static final class ExecutorQueContaRejeicoes implements ExecutorService {
        private final ExecutorService delegado;
        private final AtomicLong rejeicoes = new AtomicLong();

        ExecutorQueContaRejeicoes(ExecutorService delegado) { this.delegado = delegado; }

        long rejeicoes() { return rejeicoes.get(); }

        @Override public void execute(Runnable tarefa) {
            try { delegado.execute(tarefa); }
            catch (RejectedExecutionException e) { rejeicoes.incrementAndGet(); throw e; }
        }

        @Override public Future<?> submit(Runnable tarefa) {
            try { return delegado.submit(tarefa); }
            catch (RejectedExecutionException e) { rejeicoes.incrementAndGet(); throw e; }
        }

        @Override public <T> Future<T> submit(Runnable tarefa, T resultado) {
            try { return delegado.submit(tarefa, resultado); }
            catch (RejectedExecutionException e) { rejeicoes.incrementAndGet(); throw e; }
        }

        @Override public <T> Future<T> submit(Callable<T> tarefa) {
            try { return delegado.submit(tarefa); }
            catch (RejectedExecutionException e) { rejeicoes.incrementAndGet(); throw e; }
        }

        @Override public <T> List<Future<T>> invokeAll(Collection<? extends Callable<T>> tarefas)
                throws InterruptedException { return delegado.invokeAll(tarefas); }

        @Override public <T> List<Future<T>> invokeAll(Collection<? extends Callable<T>> tarefas, long tempo,
                                                       TimeUnit unidade) throws InterruptedException {
            return delegado.invokeAll(tarefas, tempo, unidade);
        }

        @Override public <T> T invokeAny(Collection<? extends Callable<T>> tarefas)
                throws InterruptedException, ExecutionException { return delegado.invokeAny(tarefas); }

        @Override public <T> T invokeAny(Collection<? extends Callable<T>> tarefas, long tempo, TimeUnit unidade)
                throws InterruptedException, ExecutionException, TimeoutException {
            return delegado.invokeAny(tarefas, tempo, unidade);
        }

        @Override public void shutdown() { delegado.shutdown(); }
        @Override public List<Runnable> shutdownNow() { return delegado.shutdownNow(); }
        @Override public boolean isShutdown() { return delegado.isShutdown(); }
        @Override public boolean isTerminated() { return delegado.isTerminated(); }
        @Override public boolean awaitTermination(long tempo, TimeUnit unidade) throws InterruptedException {
            return delegado.awaitTermination(tempo, unidade);
        }
    }

    private static String percentil(long[] ordenados, double p) {
        if (ordenados.length == 0) return "-";
        int indice = (int) Math.ceil(p * ordenados.length) - 1;
        if (indice < 0) indice = 0;
        if (indice >= ordenados.length) indice = ordenados.length - 1;
        return Long.toString(ordenados[indice]);
    }
}

package br.com.inframonitor.monitoring.execution;

import br.com.inframonitor.common.concurrent.ExecutorQueLogaFalhas;
import br.com.inframonitor.medicao.dto.CreateMedicaoRequest;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.service.MedicaoService;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MonitorExecutionCoordinatorTest {
    private final MonitorRepository repository = mock(MonitorRepository.class);
    private final MedicaoService medicaoService = mock(MedicaoService.class);
    private final ExecutorService workers = Executors.newSingleThreadExecutor();
    private final MonitorExecutor executor = mock(MonitorExecutor.class);
    private final MonitorExecutionCoordinator coordinator;

    MonitorExecutionCoordinatorTest() {
        when(executor.supports()).thenReturn(TipoMonitor.ICMP);
        coordinator = new MonitorExecutionCoordinator(repository, medicaoService, workers,
                Clock.fixed(Instant.parse("2026-08-19T12:00:00Z"), ZoneOffset.UTC), List.of(executor));
    }

    @AfterEach void shutdown() { workers.shutdownNow(); }

    @Test
    void ignoraInativoPeloResultadoDaConsultaEEquipamentoSemIp() {
        when(repository.findActiveExecutionCandidates()).thenReturn(List.of(candidate(1L, null), candidate(2L, " ")));
        coordinator.scheduleDueMonitors();
        verify(executor, times(0)).execute(any());
    }

    @Test
    void respeitaIntervaloEExecutaSemHistoricoOuIntervaloVencido() throws Exception {
        MonitorCandidate recente = new MonitorCandidate(1L, TipoMonitor.ICMP, 60, 2000, "10.0.0.1", Instant.parse("2026-08-19T11:59:30Z"));
        MonitorCandidate semHistorico = candidate(2L, "10.0.0.2");
        MonitorCandidate vencido = new MonitorCandidate(3L, TipoMonitor.ICMP, 60, 2000, "10.0.0.3", Instant.parse("2026-08-19T11:58:00Z"));
        when(repository.findActiveExecutionCandidates()).thenReturn(List.of(recente, semHistorico, vencido));
        when(executor.execute(any())).thenAnswer(invocation -> MonitorExecutionResult.success(4, Instant.now()));
        coordinator.scheduleDueMonitors();
        workers.shutdown();
        assertThat(workers.awaitTermination(2, TimeUnit.SECONDS)).isTrue();
        verify(executor, times(2)).execute(any());
    }

    @Test
    void impedeDuplicidadeESempreLiberaMonitor() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(repository.findActiveExecutionCandidates()).thenReturn(List.of(candidate(1L, "10.0.0.1")));
        when(executor.execute(any())).thenAnswer(invocation -> {
            started.countDown(); release.await(2, TimeUnit.SECONDS);
            return MonitorExecutionResult.success(3, Instant.now());
        });
        coordinator.scheduleDueMonitors();
        assertThat(started.await(1, TimeUnit.SECONDS)).isTrue();
        coordinator.scheduleDueMonitors();
        verify(executor, times(1)).execute(any());
        release.countDown();
        workers.shutdown();
        assertThat(workers.awaitTermination(2, TimeUnit.SECONDS)).isTrue();
        assertThat(coordinator.isRunning(1L)).isFalse();
    }

    @Test
    void persisteSucessoEFalhaESegueAposErroIndividual() throws Exception {
        when(repository.findActiveExecutionCandidates()).thenReturn(List.of(candidate(1L, "10.0.0.1"), candidate(2L, "10.0.0.2"), candidate(3L, "10.0.0.3")));
        when(executor.execute(any())).thenAnswer(invocation -> {
            long id = invocation.<MonitorCandidate>getArgument(0).monitorId();
            if (id == 1) throw new IllegalStateException("internal");
            return id == 2 ? MonitorExecutionResult.success(5, Instant.now()) : MonitorExecutionResult.failure("Timeout", Instant.now());
        });
        coordinator.scheduleDueMonitors();
        workers.shutdown();
        assertThat(workers.awaitTermination(2, TimeUnit.SECONDS)).isTrue();
        ArgumentCaptor<CreateMedicaoRequest> captor = ArgumentCaptor.forClass(CreateMedicaoRequest.class);
        verify(medicaoService, times(2)).criar(captor.capture());
        assertThat(captor.getAllValues()).extracting(CreateMedicaoRequest::status)
                .containsExactlyInAnyOrder(StatusMedicao.SUCESSO, StatusMedicao.FALHA);
        assertThat(captor.getAllValues()).filteredOn(r -> r.status() == StatusMedicao.SUCESSO)
                .allSatisfy(r -> assertThat(r.latenciaMs()).isEqualTo(5));
        assertThat(captor.getAllValues()).filteredOn(r -> r.status() == StatusMedicao.FALHA)
                .allSatisfy(r -> assertThat(r.latenciaMs()).isNull());
    }

    @Test
    void rejeicaoDoExecutorNaoDeixaMonitorMarcadoComoEmExecucao() {
        workers.shutdownNow();
        when(repository.findActiveExecutionCandidates()).thenReturn(List.of(candidate(1L, "10.0.0.1")));
        coordinator.scheduleDueMonitors();
        assertThat(coordinator.isRunning(1L)).isFalse();
    }

    private MonitorCandidate candidate(Long id, String ip) { return new MonitorCandidate(id, TipoMonitor.ICMP, 60, 2000, ip, null); }

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
}

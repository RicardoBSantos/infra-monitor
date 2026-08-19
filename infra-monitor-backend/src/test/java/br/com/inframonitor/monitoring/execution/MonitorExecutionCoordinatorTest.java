package br.com.inframonitor.monitoring.execution;

import br.com.inframonitor.medicao.dto.CreateMedicaoRequest;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.service.MedicaoService;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import org.junit.jupiter.api.AfterEach;
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
}

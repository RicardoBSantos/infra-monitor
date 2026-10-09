package br.com.inframonitor.monitoring.execution;

import br.com.inframonitor.medicao.dto.CreateMedicaoRequest;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.service.MedicaoService;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Function;
import java.util.stream.Collectors;

@Component
@ConditionalOnProperty(prefix = "monitoring.engine", name = "enabled", havingValue = "true")
public class MonitorExecutionCoordinator {
    private static final Logger log = LoggerFactory.getLogger(MonitorExecutionCoordinator.class);
    private final MonitorRepository monitorRepository;
    private final MedicaoService medicaoService;
    private final ExecutorService workerExecutor;
    private final Clock clock;
    private final Map<TipoMonitor, MonitorExecutor> executors;
    private final Set<Long> runningMonitors = ConcurrentHashMap.newKeySet();

    public MonitorExecutionCoordinator(MonitorRepository monitorRepository, MedicaoService medicaoService,
                                       ExecutorService monitoringWorkerExecutor, @Qualifier("monitoringClock") Clock monitoringClock,
                                       List<MonitorExecutor> executors) {
        this.monitorRepository = monitorRepository;
        this.medicaoService = medicaoService;
        this.workerExecutor = monitoringWorkerExecutor;
        this.clock = monitoringClock;
        this.executors = executors.stream().collect(Collectors.toUnmodifiableMap(MonitorExecutor::supports, Function.identity()));
    }

    public void scheduleDueMonitors() {
        Instant now = clock.instant();
        for (MonitorCandidate candidate : monitorRepository.findActiveExecutionCandidates()) {
            if (!isDue(candidate, now)) continue;
            if (candidate.ip() == null || candidate.ip().isBlank()) {
                log.warn("Active ICMP monitor {} ignored because its equipment has no IP", candidate.monitorId());
                continue;
            }
            if (!executors.containsKey(candidate.tipo())) {
                log.warn("No executor for monitor {} type {}", candidate.monitorId(), candidate.tipo());
                continue;
            }
            submit(candidate);
        }
    }

    boolean isDue(MonitorCandidate candidate, Instant now) {
        return candidate.ultimaMedicaoEm() == null || !now.isBefore(candidate.ultimaMedicaoEm().plusSeconds(candidate.intervaloSegundos()));
    }

    void submit(MonitorCandidate candidate) {
        if (!runningMonitors.add(candidate.monitorId())) return;
        try {
            workerExecutor.submit(() -> execute(candidate));
            log.debug("Monitor {} submitted for execution", candidate.monitorId());
        } catch (RejectedExecutionException exception) {
            runningMonitors.remove(candidate.monitorId());
            log.warn("Monitoring worker pool is saturated; monitor {} will be retried", candidate.monitorId());
        }
    }

    private void execute(MonitorCandidate candidate) {
        try {
            MonitorExecutionResult result = executors.get(candidate.tipo()).execute(candidate);
            StatusMedicao status = result.success() ? StatusMedicao.SUCESSO : StatusMedicao.FALHA;
            medicaoService.criar(new CreateMedicaoRequest(candidate.monitorId(), status, result.latencyMs(), result.message(), result.executedAt()));
            log.debug("Monitor {} execution completed with {}", candidate.monitorId(), status);
        } catch (RuntimeException exception) {
            log.error("Unexpected internal error executing monitor {}", candidate.monitorId(), exception);
        } finally {
            runningMonitors.remove(candidate.monitorId());
        }
    }

    boolean isRunning(Long monitorId) { return runningMonitors.contains(monitorId); }
}

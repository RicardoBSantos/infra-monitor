package br.com.inframonitor.monitoring.scheduler;

import br.com.inframonitor.monitoring.execution.MonitorExecutionCoordinator;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "monitoring.engine", name = "enabled", havingValue = "true")
public class MonitoringScheduler {
    private final MonitorExecutionCoordinator coordinator;
    public MonitoringScheduler(MonitorExecutionCoordinator coordinator) { this.coordinator = coordinator; }
    @Scheduled(fixedDelayString = "${monitoring.engine.scheduler-delay-ms:1000}")
    public void scheduleMonitors() { coordinator.scheduleDueMonitors(); }
}

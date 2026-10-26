package br.com.inframonitor.monitoring.scheduler;

import br.com.inframonitor.manutencao.service.ReconciliacaoInicial;
import br.com.inframonitor.monitoring.execution.MonitorExecutionCoordinator;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "monitoring.engine", name = "enabled", havingValue = "true")
public class MonitoringScheduler {
    private final MonitorExecutionCoordinator coordinator;
    private final ReconciliacaoInicial inicial;
    public MonitoringScheduler(MonitorExecutionCoordinator coordinator, ReconciliacaoInicial inicial) {
        this.coordinator = coordinator;
        this.inicial = inicial;
    }
    @Scheduled(fixedDelayString = "${monitoring.engine.scheduler-delay-ms:1000}")
    public void scheduleMonitors() {
        // MA12: antes da primeira passada do reconciliador, em_manutencao pode estar defasado
        // (janela que venceu com o sistema parado) e o motor pingaria o que nao deve.
        if (!inicial.pronta()) {
            return;
        }
        coordinator.scheduleDueMonitors();
    }
}

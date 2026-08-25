package br.com.inframonitor.monitoring.execution;

import br.com.inframonitor.monitor.entity.TipoMonitor;

public interface MonitorExecutor {
    TipoMonitor supports();

    MonitorExecutionResult execute(MonitorCandidate monitor);
}

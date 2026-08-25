package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitoring.execution.MonitorCandidate;
import br.com.inframonitor.monitoring.execution.MonitorExecutionResult;
import br.com.inframonitor.monitoring.execution.MonitorExecutor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.Clock;
import java.time.Instant;

@Component
@ConditionalOnProperty(prefix = "monitoring.engine", name = "enabled", havingValue = "true")
public class IcmpMonitorExecutor implements MonitorExecutor {
    private final IcmpCommandRunner commandRunner;
    private final Clock clock;

    public IcmpMonitorExecutor(IcmpCommandRunner commandRunner, Clock clock) {
        this.commandRunner = commandRunner;
        this.clock = clock;
    }

    @Override public TipoMonitor supports() { return TipoMonitor.ICMP; }

    @Override
    public MonitorExecutionResult execute(MonitorCandidate monitor) {
        Instant executedAt = clock.instant();
        try {
            IcmpProcessResult result = commandRunner.run(monitor.ip(), monitor.timeoutMs());
            if (result.timedOut()) return MonitorExecutionResult.failure("Timeout", executedAt);
            if (result.exitCode() != 0) return MonitorExecutionResult.failure("Ping failed", executedAt);
            return MonitorExecutionResult.success(Math.toIntExact(result.elapsedMs()), executedAt);
        } catch (IOException exception) {
            return MonitorExecutionResult.failure("Execution error", executedAt);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return MonitorExecutionResult.failure("Execution interrupted", executedAt);
        }
    }
}

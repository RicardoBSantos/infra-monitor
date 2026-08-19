package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitoring.execution.MonitorCandidate;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class IcmpMonitorExecutorTest {
    private final IcmpCommandRunner runner = mock(IcmpCommandRunner.class);
    private final IcmpMonitorExecutor executor = new IcmpMonitorExecutor(runner,
            Clock.fixed(Instant.parse("2026-08-19T12:00:00Z"), ZoneOffset.UTC));

    @Test
    void sucessoRetornaLatenciaInteira() throws Exception {
        when(runner.run("10.0.0.1", 2000)).thenReturn(new IcmpProcessResult(false, 0, 7));
        var result = executor.execute(candidate());
        assertThat(result.success()).isTrue();
        assertThat(result.latencyMs()).isEqualTo(7);
    }

    @Test
    void falhaETimeoutGeramResultadoDeFalha() throws Exception {
        when(runner.run("10.0.0.1", 2000)).thenReturn(new IcmpProcessResult(false, 1, 2));
        assertThat(executor.execute(candidate()).message()).isEqualTo("Ping failed");
        when(runner.run("10.0.0.1", 2000)).thenReturn(new IcmpProcessResult(true, -1, 2000));
        var timeout = executor.execute(candidate());
        assertThat(timeout.success()).isFalse();
        assertThat(timeout.latencyMs()).isNull();
        assertThat(timeout.message()).isEqualTo("Timeout");
    }

    @Test
    void erroDeProcessoGeraFalhaSemRedeReal() throws Exception {
        when(runner.run("10.0.0.1", 2000)).thenThrow(new IOException("ping unavailable"));
        assertThat(executor.execute(candidate()).message()).isEqualTo("Execution error");
    }

    private MonitorCandidate candidate() { return new MonitorCandidate(1L, TipoMonitor.ICMP, 60, 2000, "10.0.0.1", null); }
}

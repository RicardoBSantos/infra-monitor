package br.com.inframonitor.monitoring.icmp.processo;

import br.com.inframonitor.monitoring.icmp.IcmpResult;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;

import static org.assertj.core.api.Assertions.assertThat;

@EnabledOnOs({OS.WINDOWS, OS.LINUX, OS.MAC})
class ProcessoPingIcmpRunnerTest {

    @Test
    @DisplayName("a leitura do stream nao prende o runner alem do timeout do waitFor")
    void naoPrendeAThreadAlemDoTimeout() throws Exception {
        ProcessoPingIcmpRunner runner = new ProcessoPingIcmpRunner();

        long inicio = System.nanoTime();
        IcmpResult resultado = runner.run("127.0.0.1", 300);
        long decorridoMs = (System.nanoTime() - inicio) / 1_000_000;

        assertThat(resultado).isNotNull();
        assertThat(decorridoMs).isLessThan(5_000);
    }
}

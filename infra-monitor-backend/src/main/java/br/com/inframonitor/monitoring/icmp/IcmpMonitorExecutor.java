package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitoring.execution.MonitorCandidate;
import br.com.inframonitor.monitoring.execution.MonitorExecutionResult;
import br.com.inframonitor.monitoring.execution.MonitorExecutor;
import org.springframework.beans.factory.annotation.Qualifier;
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

    public IcmpMonitorExecutor(IcmpCommandRunner commandRunner, @Qualifier("monitoringClock") Clock clock) {
        this.commandRunner = commandRunner;
        this.clock = clock;
    }

    @Override
    public TipoMonitor supports() {
        return TipoMonitor.ICMP;
    }

    /**
     * Decide SO pelo status. Nao ha cronometro em volta da chamada: a latencia
     * gravada e o RTT que a pilha de rede informou, nunca o tempo de processo.
     */
    @Override
    public MonitorExecutionResult execute(MonitorCandidate monitor) {
        Instant executedAt = clock.instant();
        try {
            IcmpResult result = commandRunner.run(monitor.ip(), monitor.timeoutMs());
            if (result.status() == StatusIcmp.SUCESSO) {
                return MonitorExecutionResult.success(result.rttMs() == null ? 0 : result.rttMs(), executedAt);
            }
            return MonitorExecutionResult.failure(mensagem(result), executedAt);
        } catch (IOException exception) {
            return MonitorExecutionResult.failure("Erro ao executar a sondagem ICMP", executedAt);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return MonitorExecutionResult.failure("Sondagem ICMP interrompida", executedAt);
        }
    }

    static String mensagem(IcmpResult result) {
        return switch (result.status()) {
            case SUCESSO -> null;
            case TIMEOUT -> "Timeout";
            case HOST_INACESSIVEL -> "Host de destino inacessível";
            case REDE_INACESSIVEL -> "Rede de destino inacessível";
            case TTL_EXPIRADO -> "TTL expirado em trânsito";
            case ERRO -> {
                Integer codigo = result.codigoNativo();
                // 0 e' IP_SUCCESS: como codigo de erro ele nao diz nada. Acontece quando a
                // saida do ping nao casou com nenhum padrao conhecido, ou quando a camada
                // nativa estourou antes de produzir codigo.
                yield codigo == null || codigo == 0 ? "Erro ICMP não identificado" : "Erro ICMP " + codigo;
            }
        };
    }
}

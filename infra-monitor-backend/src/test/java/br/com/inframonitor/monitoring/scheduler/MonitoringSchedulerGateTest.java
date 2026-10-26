package br.com.inframonitor.monitoring.scheduler;

import br.com.inframonitor.manutencao.config.ManutencaoAgendadaProperties;
import br.com.inframonitor.manutencao.service.ReconciliacaoInicial;
import br.com.inframonitor.monitoring.execution.MonitorExecutionCoordinator;
import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * MA12: com o reconciliador ligado, o motor so agenda depois da primeira passada, para nao
 * pingar equipamento cujo em_manutencao ainda esta defasado do periodo em que o sistema
 * esteve parado.
 */
class MonitoringSchedulerGateTest {

    private final MonitorExecutionCoordinator coordenador = mock(MonitorExecutionCoordinator.class);

    @Test
    void naoAgendaAntesDaPrimeiraPassada() {
        var inicial = new ReconciliacaoInicial(props(true));
        new MonitoringScheduler(coordenador, inicial).scheduleMonitors();
        verifyNoInteractions(coordenador);

        inicial.marcarPronta();
        new MonitoringScheduler(coordenador, inicial).scheduleMonitors();
        verify(coordenador).scheduleDueMonitors();
    }

    @Test
    void comReconciliadorDesligadoAgendaDeCara() {
        new MonitoringScheduler(coordenador, new ReconciliacaoInicial(props(false))).scheduleMonitors();
        verify(coordenador).scheduleDueMonitors();
    }

    private static ManutencaoAgendadaProperties props(boolean ligado) {
        var props = new ManutencaoAgendadaProperties();
        props.setEnabled(ligado);
        return props;
    }
}

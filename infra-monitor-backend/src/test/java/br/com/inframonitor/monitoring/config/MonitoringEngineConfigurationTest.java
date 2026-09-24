package br.com.inframonitor.monitoring.config;

import br.com.inframonitor.monitoring.icmp.IcmpCommandRunner;
import br.com.inframonitor.monitoring.icmp.IcmpMonitorExecutor;
import br.com.inframonitor.notificacao.dispatcher.NotificationDispatcherConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Clock;
import java.util.concurrent.ExecutorService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class MonitoringEngineConfigurationTest {
    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(MonitoringEngineConfiguration.class);

    @Test
    void engineDesabilitadoNaoCriaPoolNemScheduler() {
        contextRunner.withPropertyValues("monitoring.engine.enabled=false").run(context ->
                assertThat(context).doesNotHaveBean(ExecutorService.class));
    }

    @Test
    void engineHabilitadoComMonitoringClockConfigurationNaoDuplicaBean() {
        // Reproduz o contexto real: MonitoringClockConfiguration (sem condicional de
        // motor) e MonitoringEngineConfiguration (com o motor ligado) sao ambas
        // registradas pelo component scan. Duas @Bean("monitoringClock") derrubam o
        // contexto porque allow-bean-definition-overriding e false por padrao.
        new ApplicationContextRunner()
                .withUserConfiguration(MonitoringClockConfiguration.class, MonitoringEngineConfiguration.class)
                .withPropertyValues("monitoring.engine.enabled=true")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(Clock.class);
                    assertThat(context).hasBean("monitoringClock");
                });
    }

    @Test
    void engineHabilitadoCriaExecutorComMonitoringClockMesmoComNotificationClock() {
        new ApplicationContextRunner()
                .withUserConfiguration(MonitoringClockConfiguration.class, MonitoringEngineConfiguration.class,
                        NotificationDispatcherConfiguration.class)
                .withPropertyValues("monitoring.engine.enabled=true")
                .withBean(IcmpCommandRunner.class, () -> mock(IcmpCommandRunner.class))
                .withBean(IcmpMonitorExecutor.class)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(IcmpMonitorExecutor.class);
                    assertThat(context).hasBean("monitoringClock");
                    assertThat(context).hasBean("notificationClock");
                    assertThat(ReflectionTestUtils.getField(context.getBean(IcmpMonitorExecutor.class), "clock"))
                            .isSameAs(context.getBean("monitoringClock", Clock.class));
                });
    }
}

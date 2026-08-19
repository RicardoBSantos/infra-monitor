package br.com.inframonitor.monitoring.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.util.concurrent.ExecutorService;

import static org.assertj.core.api.Assertions.assertThat;

class MonitoringEngineConfigurationTest {
    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(MonitoringEngineConfiguration.class);

    @Test
    void engineDesabilitadoNaoCriaPoolNemScheduler() {
        contextRunner.withPropertyValues("monitoring.engine.enabled=false").run(context ->
                assertThat(context).doesNotHaveBean(ExecutorService.class));
    }
}

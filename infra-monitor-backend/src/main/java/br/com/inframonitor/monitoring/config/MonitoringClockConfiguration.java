package br.com.inframonitor.monitoring.config;

import java.time.Clock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

// Fica FORA do @ConditionalOnProperty do motor de propósito: CicloJanelaMonitoramentoService
// (fora do pacote monitoring) consome "monitoringClock" mesmo com o motor desligado, e
// MonitoringEngineConfiguration nao deve mais declarar seu proprio bean com este nome
// (duas @Configuration com o mesmo @Bean derrubam o contexto quando o motor liga).
@Configuration(proxyBeanMethods = false)
public class MonitoringClockConfiguration {
    @Bean("monitoringClock")
    @ConditionalOnMissingBean(name = "monitoringClock")
    Clock monitoringClock() { return Clock.systemUTC(); }
}

package br.com.inframonitor.monitoring.config;

import java.time.Clock;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class MonitoringClockConfiguration {
    @Bean("monitoringClock")
    @ConditionalOnMissingBean(name = "monitoringClock")
    Clock monitoringClock() { return Clock.systemUTC(); }
}

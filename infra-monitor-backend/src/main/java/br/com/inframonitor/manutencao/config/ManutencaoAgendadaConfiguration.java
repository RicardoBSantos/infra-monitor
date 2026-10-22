package br.com.inframonitor.manutencao.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(ManutencaoAgendadaProperties.class)
public class ManutencaoAgendadaConfiguration {
}

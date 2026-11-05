package br.com.inframonitor.medicao.retencao;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(RetentionProperties.class)
public class RetentionConfiguration { }

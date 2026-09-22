package br.com.inframonitor.monitoring.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

// Fica FORA do @ConditionalOnProperty do motor de propósito: CicloJanelaMonitoramentoService
// (fora do pacote monitoring) consome "monitoringClock" mesmo com o motor desligado, e
// MonitoringEngineConfiguration nao deve mais declarar seu proprio bean com este nome
// (duas @Configuration com o mesmo @Bean derrubam o contexto quando o motor liga).
//
// Sem @ConditionalOnMissingBean de proposito: entre @Configuration de usuario a ordem de
// registro nao e' garantida, entao a anotacao faria back-off silencioso se outro lugar
// declarasse um bean "monitoringClock" - CicloJanelaMonitoramentoService passaria a receber
// outro relogio sem ninguem notar, o oposto da protecao que a anotacao sugere. A garantia
// real contra duplicacao e' o teste que detecta o bean duplicado, nao uma anotacao aqui.
@Configuration(proxyBeanMethods = false)
public class MonitoringClockConfiguration {
    @Bean("monitoringClock")
    Clock monitoringClock() { return Clock.systemUTC(); }
}

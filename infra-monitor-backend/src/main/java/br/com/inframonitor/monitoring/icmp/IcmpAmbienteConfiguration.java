package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitoring.config.MonitoringEngineProperties;
import br.com.inframonitor.monitoring.icmp.nativo.Iphlpapi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.function.Supplier;

/**
 * Resolve a implementacao ICMP e carrega a biblioteca nativa UMA vez, na subida.
 *
 * <p>Deliberadamente FORA do @ConditionalOnProperty do motor: com o motor
 * desligado nao ha sondagem, mas /api/v1/status continua tendo de dizer qual
 * implementacao este processo usaria.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({IcmpProperties.class, MonitoringEngineProperties.class})
public class IcmpAmbienteConfiguration {

    private static final Logger log = LoggerFactory.getLogger(IcmpAmbienteConfiguration.class);

    @Bean
    IcmpAmbiente icmpAmbiente(IcmpProperties icmpProperties, MonitoringEngineProperties engineProperties) {
        IcmpAmbiente ambiente = resolver(icmpProperties.getImplementacao(), IcmpRunnerConfiguration.isWindows(),
                engineProperties.isEnabled(), Iphlpapi.Jna::carregar);
        log.info("Implementacao ICMP ativa: {} (pedida: {}, carga nativa: {}, motor: {}, so={})",
                ambiente.ativa(), ambiente.pedida(), ambiente.cargaNativa(),
                ambiente.motorLigado() ? "ligado" : "desligado", System.getProperty("os.name"));
        return ambiente;
    }

    static IcmpAmbiente resolver(IcmpImplementacao pedida, boolean windows, boolean motorLigado,
                                 Supplier<Iphlpapi> fabrica) {
        IcmpImplementacao escolhida = IcmpRunnerConfiguration.escolher(pedida, windows);
        if (escolhida != IcmpImplementacao.NATIVO_WINDOWS || !motorLigado) {
            return new IcmpAmbiente(pedida, escolhida, CargaNativa.NAO_TENTADA, null, motorLigado, null);
        }
        try {
            return new IcmpAmbiente(pedida, escolhida, CargaNativa.OK, null, true, fabrica.get());
        } catch (RuntimeException | LinkageError falha) {
            // LinkageError e' obrigatorio: Native.load lanca UnsatisfiedLinkError,
            // que e' um Error e nao seria pego por catch (Exception).
            String detalhe = falha.getClass().getName() + ": " + falha.getMessage();
            if (pedida == IcmpImplementacao.NATIVO_WINDOWS) {
                throw new IllegalStateException(
                        "monitoring.icmp.implementacao=nativo-windows foi pedido explicitamente, mas a carga da "
                                + "biblioteca nativa Iphlpapi falhou: " + detalhe
                                + ". Suba com monitoring.icmp.implementacao=processo-ping para nao depender dela.",
                        falha);
            }
            log.error("Carga da biblioteca nativa Iphlpapi falhou nesta subida; monitoring.icmp.implementacao=auto "
                    + "cai para processo-ping. Detalhe: {}", detalhe, falha);
            return new IcmpAmbiente(pedida, IcmpImplementacao.PROCESSO_PING, CargaNativa.FALHOU, detalhe, true, null);
        }
    }
}

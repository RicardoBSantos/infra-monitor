package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitoring.icmp.nativo.Iphlpapi;
import br.com.inframonitor.monitoring.icmp.nativo.WindowsNativeIcmpRunner;
import br.com.inframonitor.monitoring.icmp.processo.ProcessoPingIcmpRunner;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Locale;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(IcmpProperties.class)
@ConditionalOnProperty(prefix = "monitoring.engine", name = "enabled", havingValue = "true")
public class IcmpRunnerConfiguration {

    private static final Logger log = LoggerFactory.getLogger(IcmpRunnerConfiguration.class);

    @Bean
    IcmpCommandRunner icmpCommandRunner(IcmpProperties properties) {
        IcmpImplementacao escolhida = escolher(properties.getImplementacao(), isWindows());
        log.info("Implementacao ICMP escolhida: {} (pedida: {}, so={})",
                escolhida, properties.getImplementacao(), System.getProperty("os.name"));
        return escolhida == IcmpImplementacao.NATIVO_WINDOWS
                ? new WindowsNativeIcmpRunner(new Iphlpapi.Jna())
                : new ProcessoPingIcmpRunner();
    }

    /** Resolve AUTO; nunca devolve AUTO. */
    static IcmpImplementacao escolher(IcmpImplementacao pedida, boolean windows) {
        if (pedida != IcmpImplementacao.AUTO) {
            return pedida;
        }
        return windows ? IcmpImplementacao.NATIVO_WINDOWS : IcmpImplementacao.PROCESSO_PING;
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }
}

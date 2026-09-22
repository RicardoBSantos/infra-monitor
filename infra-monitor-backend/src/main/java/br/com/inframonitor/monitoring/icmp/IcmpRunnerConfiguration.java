package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitoring.icmp.nativo.WindowsNativeIcmpRunner;
import br.com.inframonitor.monitoring.icmp.processo.ProcessoPingIcmpRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Locale;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(prefix = "monitoring.engine", name = "enabled", havingValue = "true")
public class IcmpRunnerConfiguration {

    @Bean
    IcmpCommandRunner icmpCommandRunner(IcmpAmbiente ambiente) {
        return criarRunner(ambiente);
    }

    /** Visivel para teste: monta o runner a partir de um ambiente ja resolvido. */
    static IcmpCommandRunner criarRunner(IcmpAmbiente ambiente) {
        return ambiente.ativa() == IcmpImplementacao.NATIVO_WINDOWS
                ? new WindowsNativeIcmpRunner(ambiente.nativo())
                : new ProcessoPingIcmpRunner();
    }

    /** Resolve AUTO; nunca devolve AUTO. */
    static IcmpImplementacao escolher(IcmpImplementacao pedida, boolean windows) {
        if (pedida != IcmpImplementacao.AUTO) {
            return pedida;
        }
        return windows ? IcmpImplementacao.NATIVO_WINDOWS : IcmpImplementacao.PROCESSO_PING;
    }

    static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }
}

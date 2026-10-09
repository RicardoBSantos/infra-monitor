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
        if (ambiente.ativa() == IcmpImplementacao.NATIVO_WINDOWS) {
            if (ambiente.nativo() == null) {
                // Inalcancavel em producao: com o motor ligado, IcmpAmbienteConfiguration
                // ou carrega a biblioteca nativa e preenche este campo, ou lanca
                // IllegalStateException antes de chegar aqui. Um ambiente com
                // ativa=NATIVO_WINDOWS e nativo=null so existiria com motor desligado, e
                // esse @ConditionalOnProperty impede este bean de montar nesse caso. O
                // guarda existe porque criarRunner e' package-visible para teste, e um
                // ambiente assim montado a mao nao pode virar um runner com null por
                // dentro, silenciosamente.
                throw new IllegalStateException(
                        "IcmpAmbiente com ativa=NATIVO_WINDOWS precisa de nativo() preenchido; "
                                + "ambiente com nativo() nulo nao pode construir WindowsNativeIcmpRunner");
            }
            return new WindowsNativeIcmpRunner(ambiente.nativo());
        }
        return new ProcessoPingIcmpRunner();
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

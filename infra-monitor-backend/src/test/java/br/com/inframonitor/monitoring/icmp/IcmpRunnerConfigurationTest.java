package br.com.inframonitor.monitoring.icmp;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class IcmpRunnerConfigurationTest {

    @Test
    @DisplayName("auto no Windows escolhe o nativo")
    void autoNoWindows() {
        assertThat(IcmpRunnerConfiguration.escolher(IcmpImplementacao.AUTO, true))
                .isEqualTo(IcmpImplementacao.NATIVO_WINDOWS);
    }

    @Test
    @DisplayName("auto fora do Windows escolhe a leitura de texto")
    void autoForaDoWindows() {
        assertThat(IcmpRunnerConfiguration.escolher(IcmpImplementacao.AUTO, false))
                .isEqualTo(IcmpImplementacao.PROCESSO_PING);
    }

    @Test
    @DisplayName("valvula de escape: processo-ping forcado vence o sistema operacional")
    void forcarProcessoNoWindows() {
        assertThat(IcmpRunnerConfiguration.escolher(IcmpImplementacao.PROCESSO_PING, true))
                .isEqualTo(IcmpImplementacao.PROCESSO_PING);
    }

    @Test
    void forcarNativo() {
        assertThat(IcmpRunnerConfiguration.escolher(IcmpImplementacao.NATIVO_WINDOWS, true))
                .isEqualTo(IcmpImplementacao.NATIVO_WINDOWS);
    }

    @Test
    @DisplayName("escolher nunca devolve AUTO")
    void nuncaDevolveAuto() {
        for (IcmpImplementacao pedida : IcmpImplementacao.values()) {
            assertThat(IcmpRunnerConfiguration.escolher(pedida, true)).isNotEqualTo(IcmpImplementacao.AUTO);
            assertThat(IcmpRunnerConfiguration.escolher(pedida, false)).isNotEqualTo(IcmpImplementacao.AUTO);
        }
    }
}

package br.com.inframonitor.monitoring.icmp;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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

    @Test
    @DisplayName("ativa=NATIVO_WINDOWS com nativo() nulo nao constroi o runner silenciosamente")
    void criarRunnerRecusaNativoSemBiblioteca() {
        IcmpAmbiente ambienteInconsistente = new IcmpAmbiente(IcmpImplementacao.NATIVO_WINDOWS,
                IcmpImplementacao.NATIVO_WINDOWS, CargaNativa.NAO_TENTADA, null, false, null);

        assertThatThrownBy(() -> IcmpRunnerConfiguration.criarRunner(ambienteInconsistente))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("NATIVO_WINDOWS")
                .hasMessageContaining("nativo()");
    }
}

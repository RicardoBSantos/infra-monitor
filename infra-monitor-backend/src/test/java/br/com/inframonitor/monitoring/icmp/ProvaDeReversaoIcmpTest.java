package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitoring.icmp.processo.PingOutputParser;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Trava contra a regressao. A logica antiga era "exitCode != 0 e falha" e a
 * saida do processo era descartada. Este teste roda as MESMAS fixtures reais
 * contra aquela logica e prova que ela dava SUCESSO onde nao havia resposta.
 *
 * Se alguem reverter a correcao, os dois primeiros testes aqui passam a
 * concordar com o parser e este arquivo falha.
 */
class ProvaDeReversaoIcmpTest {

    // Saidas reais capturadas em 2026-09-21. Os tres primeiros saem com exit 0.
    private static final String TTL_EXPIRADO = """
            Disparando 10.72.10.16 com 32 bytes de dados:
            Resposta de 192.168.0.252: A vida util (TTL) expirou em transito.
            """;
    private static final int TTL_EXPIRADO_EXIT_CODE = 0;

    private static final String HOST_INACESSIVEL = """
            Disparando 10.79.20.250 com 32 bytes de dados:
            Resposta de 10.79.20.163: Host de destino inacessivel.
            """;
    private static final int HOST_INACESSIVEL_EXIT_CODE = 0;

    private static final String SUCESSO = """
            Disparando 10.79.10.6 com 32 bytes de dados:
            Resposta de 10.79.10.6: bytes=32 tempo<1ms TTL=127
            """;
    private static final int SUCESSO_EXIT_CODE = 0;

    private static final String TIMEOUT = """
            Disparando 10.73.10.15 com 32 bytes de dados:
            Esgotado o tempo limite do pedido.
            """;
    private static final int TIMEOUT_EXIT_CODE = 1;

    /** A logica antiga, reproduzida aqui para nao depender de codigo apagado. */
    private static boolean logicaAntigaDiziaSucesso(int exitCode) {
        return exitCode == 0;
    }

    @Test
    @DisplayName("TTL expirado: a logica antiga dizia SUCESSO, a nova diz TTL_EXPIRADO")
    void ttlExpiradoEraFalsoPositivo() {
        assertThat(logicaAntigaDiziaSucesso(TTL_EXPIRADO_EXIT_CODE))
                .as("exit code 0 - a logica antiga gravaria SUCESSO")
                .isTrue();
        assertThat(PingOutputParser.analisar("10.72.10.16", TTL_EXPIRADO, true).status())
                .isEqualTo(StatusIcmp.TTL_EXPIRADO);
    }

    @Test
    @DisplayName("Host inacessivel: a logica antiga dizia SUCESSO, a nova diz HOST_INACESSIVEL")
    void hostInacessivelEraFalsoPositivo() {
        assertThat(logicaAntigaDiziaSucesso(HOST_INACESSIVEL_EXIT_CODE))
                .as("exit code 0 - a logica antiga gravaria SUCESSO")
                .isTrue();
        assertThat(PingOutputParser.analisar("10.79.20.250", HOST_INACESSIVEL, true).status())
                .isEqualTo(StatusIcmp.HOST_INACESSIVEL);
    }

    @Test
    @DisplayName("os dois casos que a logica antiga acertava continuam certos")
    void casosQueJaEstavamCertosNaoRegridem() {
        assertThat(logicaAntigaDiziaSucesso(SUCESSO_EXIT_CODE)).isTrue();
        assertThat(PingOutputParser.analisar("10.79.10.6", SUCESSO, true).status())
                .isEqualTo(StatusIcmp.SUCESSO);

        assertThat(logicaAntigaDiziaSucesso(TIMEOUT_EXIT_CODE)).isFalse();
        assertThat(PingOutputParser.analisar("10.73.10.15", TIMEOUT, true).status())
                .isEqualTo(StatusIcmp.TIMEOUT);
    }

    @Test
    @DisplayName("placar: 2 dos 4 alvos de homologacao eram falso positivo")
    void placarDosFalsosPositivos() {
        record Caso(String ip, String saida, int exitCode) { }
        var casos = java.util.List.of(
                new Caso("10.79.10.6", SUCESSO, SUCESSO_EXIT_CODE),
                new Caso("10.72.10.16", TTL_EXPIRADO, TTL_EXPIRADO_EXIT_CODE),
                new Caso("10.79.20.250", HOST_INACESSIVEL, HOST_INACESSIVEL_EXIT_CODE),
                new Caso("10.73.10.15", TIMEOUT, TIMEOUT_EXIT_CODE));

        long falsosPositivos = casos.stream()
                .filter(c -> logicaAntigaDiziaSucesso(c.exitCode()))
                .filter(c -> PingOutputParser.analisar(c.ip(), c.saida(), true).status() != StatusIcmp.SUCESSO)
                .count();

        assertThat(falsosPositivos).isEqualTo(2);
    }
}

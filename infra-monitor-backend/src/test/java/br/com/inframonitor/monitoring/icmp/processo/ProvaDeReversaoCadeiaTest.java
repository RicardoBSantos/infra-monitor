package br.com.inframonitor.monitoring.icmp.processo;

import br.com.inframonitor.monitoring.icmp.IcmpResult;
import br.com.inframonitor.monitoring.icmp.StatusIcmp;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Trava contra a regressao na FIACAO, nao so no parser. O bug historico nao
 * vivia em PingOutputParser: vivia em ProcessoPingIcmpRunner.conduzir, que
 * descartava a saida e decidia pelo codigo de saida do processo
 * ("terminou ? sucesso : falha(TIMEOUT)"). Se alguem reintroduzir esse atalho
 * e parar de delegar ao parser, ProvaDeReversaoIcmpTest (que testa so o
 * parser isolado) nao pega - so este arquivo pega, porque conduz o runner de
 * verdade com um Process falso.
 */
class ProvaDeReversaoCadeiaTest {

    // Mesmas fixtures reais de ProvaDeReversaoIcmpTest, capturadas em 2026-09-21.
    private static final String TTL_EXPIRADO = """
            Disparando 10.72.10.16 com 32 bytes de dados:
            Resposta de 192.168.0.252: A vida util (TTL) expirou em transito.
            """;

    private static final String HOST_INACESSIVEL = """
            Disparando 10.79.20.250 com 32 bytes de dados:
            Resposta de 10.79.20.163: Host de destino inacessivel.
            """;

    private static final String SUCESSO = """
            Disparando 10.79.10.6 com 32 bytes de dados:
            Resposta de 10.79.10.6: bytes=32 tempo<1ms TTL=127
            """;

    /** Processo que termina normal e entrega uma saida fixa, como o ping.exe faz de verdade. */
    private static final class ProcessoComSaida extends Process {
        private final InputStream stdout;
        ProcessoComSaida(String saida) {
            this.stdout = new ByteArrayInputStream(saida.getBytes(StandardCharsets.UTF_8));
        }
        @Override public OutputStream getOutputStream() { return OutputStream.nullOutputStream(); }
        @Override public InputStream getInputStream() { return stdout; }
        @Override public InputStream getErrorStream() { return InputStream.nullInputStream(); }
        @Override public int waitFor() { return 0; }
        @Override public boolean waitFor(long timeout, TimeUnit unit) { return true; }
        @Override public int exitValue() { return 0; }   // exit 0: e' isso que enganava a logica antiga
        @Override public boolean isAlive() { return false; }
        @Override public void destroy() { }
    }

    @Test
    @DisplayName("cadeia completa: TTL expirado com exit 0 nao vira sucesso no runner")
    void runnerNaoCaiNoFalsoPositivoDeTtlExpirado() throws Exception {
        IcmpResult r = new ProcessoPingIcmpRunner()
                .conduzir(new ProcessoComSaida(TTL_EXPIRADO), "10.72.10.16", 3_000);
        assertThat(r.status()).isEqualTo(StatusIcmp.TTL_EXPIRADO);
        assertThat(r.rttMs()).isNull();
    }

    @Test
    @DisplayName("cadeia completa: host inacessivel com exit 0 nao vira sucesso no runner")
    void runnerNaoCaiNoFalsoPositivoDeHostInacessivel() throws Exception {
        IcmpResult r = new ProcessoPingIcmpRunner()
                .conduzir(new ProcessoComSaida(HOST_INACESSIVEL), "10.79.20.250", 3_000);
        assertThat(r.status()).isEqualTo(StatusIcmp.HOST_INACESSIVEL);
    }

    @Test
    @DisplayName("cadeia completa: o caminho feliz continua sucesso")
    void runnerContinuaReconhecendoOSucesso() throws Exception {
        IcmpResult r = new ProcessoPingIcmpRunner()
                .conduzir(new ProcessoComSaida(SUCESSO), "10.79.10.6", 3_000);
        assertThat(r.status()).isEqualTo(StatusIcmp.SUCESSO);
    }
}

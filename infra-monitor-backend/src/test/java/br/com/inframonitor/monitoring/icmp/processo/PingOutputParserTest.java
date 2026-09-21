package br.com.inframonitor.monitoring.icmp.processo;

import br.com.inframonitor.monitoring.icmp.IcmpResult;
import br.com.inframonitor.monitoring.icmp.StatusIcmp;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * As fixtures pt-BR sao saidas REAIS capturadas em 2026-09-21 na maquina de
 * desenvolvimento, contra os alvos da rede Sesc. A fixture do iputils esta
 * marcada como formato de referencia: NAO foi capturada nesta maquina.
 */
class PingOutputParserTest {

    // Capturada: ping -n 1 -w 3000 10.79.10.6
    private static final String WIN_PT_SUCESSO = """
            Disparando 10.79.10.6 com 32 bytes de dados:
            Resposta de 10.79.10.6: bytes=32 tempo<1ms TTL=127

            Estatisticas do Ping para 10.79.10.6:
                Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de perda),
            Aproximar um numero redondo de vezes em milissegundos:
                Minimo = 0ms, Maximo = 0ms, Media = 0ms
            """;

    // Capturada: ping -n 1 -w 3000 10.72.10.16
    private static final String WIN_PT_TTL_EXPIRADO = """
            Disparando 10.72.10.16 com 32 bytes de dados:
            Resposta de 192.168.0.252: A vida util (TTL) expirou em transito.

            Estatisticas do Ping para 10.72.10.16:
                Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de perda),
            """;

    // Capturada: ping -n 1 -w 3000 10.79.20.250
    private static final String WIN_PT_HOST_INACESSIVEL = """
            Disparando 10.79.20.250 com 32 bytes de dados:
            Resposta de 10.79.20.163: Host de destino inacessivel.

            Estatisticas do Ping para 10.79.20.250:
                Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de perda),
            """;

    // Capturada: ping -n 1 -w 3000 10.73.10.15
    private static final String WIN_PT_TIMEOUT = """
            Disparando 10.73.10.15 com 32 bytes de dados:
            Esgotado o tempo limite do pedido.

            Estatisticas do Ping para 10.73.10.15:
                Pacotes: Enviados = 1, Recebidos = 0, Perdidos = 1 (100% de perda),
            """;

    private static final String WIN_PT_FALHA_GERAL = """
            Disparando 10.99.99.99 com 32 bytes de dados:
            Falha geral.

            Estatisticas do Ping para 10.99.99.99:
                Pacotes: Enviados = 1, Recebidos = 0, Perdidos = 1 (100% de perda),
            """;

    private static final String WIN_EN_SUCESSO = """
            Pinging 10.79.10.6 with 32 bytes of data:
            Reply from 10.79.10.6: bytes=32 time=12ms TTL=127
            """;

    private static final String WIN_EN_TTL_EXPIRADO = """
            Pinging 10.72.10.16 with 32 bytes of data:
            Reply from 192.168.0.252: TTL expired in transit.
            """;

    private static final String WIN_EN_HOST_INACESSIVEL = """
            Pinging 10.79.20.250 with 32 bytes of data:
            Reply from 10.79.20.163: Destination host unreachable.
            """;

    private static final String WIN_EN_REDE_INACESSIVEL = """
            Pinging 10.88.0.1 with 32 bytes of data:
            Reply from 10.79.20.163: Destination net unreachable.
            """;

    // FORMATO DE REFERENCIA (iputils) - NAO CAPTURADO NESTA MAQUINA.
    private static final String LINUX_SUCESSO = """
            PING 10.79.10.6 (10.79.10.6) 56(84) bytes of data.
            64 bytes from 10.79.10.6: icmp_seq=1 ttl=127 time=0.412 ms

            --- 10.79.10.6 ping statistics ---
            1 packets transmitted, 1 received, 0% packet loss, time 0ms
            """;

    // FORMATO DE REFERENCIA (iputils) - NAO CAPTURADO NESTA MAQUINA.
    private static final String LINUX_HOST_INACESSIVEL = """
            PING 10.79.20.250 (10.79.20.250) 56(84) bytes of data.
            From 10.79.20.163 icmp_seq=1 Destination Host Unreachable

            --- 10.79.20.250 ping statistics ---
            1 packets transmitted, 0 received, +1 errors, 100% packet loss, time 0ms
            """;

    @Test
    @DisplayName("tempo<1ms vira sucesso com latencia zero")
    void sucessoPortuguesComMenorQue() {
        IcmpResult r = PingOutputParser.analisar("10.79.10.6", WIN_PT_SUCESSO, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.SUCESSO);
        assertThat(r.rttMs()).isZero();
    }

    @Test
    @DisplayName("Reply from ... time=12ms vira sucesso com 12 ms")
    void sucessoIngles() {
        IcmpResult r = PingOutputParser.analisar("10.79.10.6", WIN_EN_SUCESSO, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.SUCESSO);
        assertThat(r.rttMs()).isEqualTo(12);
    }

    @Test
    @DisplayName("TTL expirou em transito NAO e sucesso, mesmo com o processo saindo com 0")
    void ttlExpiradoPortugues() {
        IcmpResult r = PingOutputParser.analisar("10.72.10.16", WIN_PT_TTL_EXPIRADO, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.TTL_EXPIRADO);
        assertThat(r.rttMs()).isNull();
    }

    @Test
    void ttlExpiradoIngles() {
        IcmpResult r = PingOutputParser.analisar("10.72.10.16", WIN_EN_TTL_EXPIRADO, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.TTL_EXPIRADO);
    }

    @Test
    @DisplayName("Host de destino inacessivel NAO e sucesso")
    void hostInacessivelPortugues() {
        IcmpResult r = PingOutputParser.analisar("10.79.20.250", WIN_PT_HOST_INACESSIVEL, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.HOST_INACESSIVEL);
        assertThat(r.rttMs()).isNull();
    }

    @Test
    void hostInacessivelIngles() {
        IcmpResult r = PingOutputParser.analisar("10.79.20.250", WIN_EN_HOST_INACESSIVEL, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.HOST_INACESSIVEL);
    }

    @Test
    void redeInacessivelIngles() {
        IcmpResult r = PingOutputParser.analisar("10.88.0.1", WIN_EN_REDE_INACESSIVEL, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.REDE_INACESSIVEL);
    }

    @Test
    void timeoutPortugues() {
        IcmpResult r = PingOutputParser.analisar("10.73.10.15", WIN_PT_TIMEOUT, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.TIMEOUT);
    }

    @Test
    @DisplayName("Falha geral vira ERRO, nao timeout")
    void falhaGeral() {
        IcmpResult r = PingOutputParser.analisar("10.99.99.99", WIN_PT_FALHA_GERAL, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.ERRO);
    }

    @Test
    @DisplayName("processo que nao terminou dentro do timeout vira TIMEOUT sem olhar o texto")
    void processoNaoTerminou() {
        IcmpResult r = PingOutputParser.analisar("10.73.10.15", "", false);
        assertThat(r.status()).isEqualTo(StatusIcmp.TIMEOUT);
    }

    @Test
    @DisplayName("resposta de outro IP nunca e sucesso, mesmo tendo ttl= na linha")
    void respostaDeOutroIpNaoESucesso() {
        String saida = "Resposta de 192.168.0.252: bytes=32 tempo=1ms TTL=64\n";
        IcmpResult r = PingOutputParser.analisar("10.72.10.16", saida, true);
        assertThat(r.status()).isNotEqualTo(StatusIcmp.SUCESSO);
    }

    @Test
    @DisplayName("formato de referencia do iputils: sucesso com virgula/ponto decimal")
    void linuxSucessoFormatoDeReferencia() {
        IcmpResult r = PingOutputParser.analisar("10.79.10.6", LINUX_SUCESSO, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.SUCESSO);
        assertThat(r.rttMs()).isZero();
    }

    @Test
    @DisplayName("formato de referencia do iputils: host inacessivel")
    void linuxHostInacessivelFormatoDeReferencia() {
        IcmpResult r = PingOutputParser.analisar("10.79.20.250", LINUX_HOST_INACESSIVEL, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.HOST_INACESSIVEL);
    }
}

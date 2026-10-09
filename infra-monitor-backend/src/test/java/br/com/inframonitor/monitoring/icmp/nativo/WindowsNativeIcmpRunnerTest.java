package br.com.inframonitor.monitoring.icmp.nativo;

import br.com.inframonitor.monitoring.icmp.IcmpResult;
import br.com.inframonitor.monitoring.icmp.StatusIcmp;
import com.sun.jna.Memory;
import com.sun.jna.Pointer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A camada JNA esta isolada atras de Iphlpapi e e simulada aqui: nenhum teste
 * desta classe toca a rede nem carrega a biblioteca nativa.
 */
class WindowsNativeIcmpRunnerTest {

    /** Iphlpapi de mentira: devolve o que o teste mandar e conta os handles. */
    private static class IphlpapiFalsa implements Iphlpapi {
        private final Iphlpapi.Retorno retorno;
        private final Integer statusNoReply;
        private final int rttNoReply;
        final List<String> chamadas = new ArrayList<>();
        byte ttlRecebido;

        IphlpapiFalsa(Iphlpapi.Retorno retorno, Integer statusNoReply, int rttNoReply) {
            this.retorno = retorno;
            this.statusNoReply = statusNoReply;
            this.rttNoReply = rttNoReply;
        }

        @Override
        public Pointer icmpCreateFile() {
            chamadas.add("create");
            return new Memory(8);
        }

        @Override
        public Retorno icmpSendEcho(Pointer handle, int destino, Pointer requisicao, short tamanho,
                                    Pointer opcoes, Pointer reply, int tamanhoReply, int timeoutMs) {
            chamadas.add("send");
            if (opcoes != null) {
                ttlRecebido = opcoes.getByte(0);
            }
            if (statusNoReply != null) {
                reply.setInt(4, statusNoReply);
                reply.setInt(8, rttNoReply);
            }
            return retorno;
        }

        @Override
        public void icmpCloseHandle(Pointer handle) {
            chamadas.add("close");
        }
    }

    private static IcmpResult rodar(Iphlpapi.Retorno retorno, Integer statusNoReply, int rtt) {
        return new WindowsNativeIcmpRunner(new IphlpapiFalsa(retorno, statusNoReply, rtt))
                .run("10.79.10.6", 3_000);
    }

    @ParameterizedTest(name = "reply Status {0} vira {1}")
    @CsvSource({
            "0, SUCESSO",
            "11002, REDE_INACESSIVEL",
            "11003, HOST_INACESSIVEL",
            "11010, TIMEOUT",
            "11013, TTL_EXPIRADO"
    })
    @DisplayName("retorno >= 1: o status vem do ICMP_ECHO_REPLY")
    void mapeiaStatusDoReply(int codigo, StatusIcmp esperado) {
        IcmpResult r = rodar(new Iphlpapi.Retorno(1, 0), codigo, 5);
        assertThat(r.status()).isEqualTo(esperado);
    }

    @ParameterizedTest(name = "GetLastError {0} vira {1}")
    @CsvSource({
            "11002, REDE_INACESSIVEL",
            "11003, HOST_INACESSIVEL",
            "11010, TIMEOUT",
            "11013, TTL_EXPIRADO"
    })
    @DisplayName("retorno 0: o codigo vem do GetLastError, nao do reply")
    void mapeiaStatusDoUltimoErro(int codigo, StatusIcmp esperado) {
        IcmpResult r = rodar(new Iphlpapi.Retorno(0, codigo), null, 0);
        assertThat(r.status()).isEqualTo(esperado);
    }

    @Test
    @DisplayName("codigo desconhecido vira ERRO carregando o codigo")
    void codigoDesconhecidoViraErro() {
        IcmpResult r = rodar(new Iphlpapi.Retorno(1, 0), 11050, 0);
        assertThat(r.status()).isEqualTo(StatusIcmp.ERRO);
        assertThat(r.codigoNativo()).isEqualTo(11050);
    }

    @Test
    @DisplayName("RTT so sobrevive no sucesso; em erro ele vem preenchido e e lixo")
    void rttSoNoSucesso() {
        assertThat(rodar(new Iphlpapi.Retorno(1, 0), 0, 12).rttMs()).isEqualTo(12);
        assertThat(rodar(new Iphlpapi.Retorno(1, 0), 11003, 2998).rttMs()).isNull();
    }

    @Test
    @DisplayName("o handle e sempre fechado, inclusive quando IcmpSendEcho lanca")
    void handleSempreFechado() {
        IphlpapiFalsa falsa = new IphlpapiFalsa(new Iphlpapi.Retorno(1, 0), 0, 1) {
            @Override
            public Retorno icmpSendEcho(Pointer h, int d, Pointer rq, short t, Pointer o,
                                        Pointer rp, int tr, int tm) {
                chamadas.add("send");
                throw new IllegalStateException("estouro nativo");
            }
        };
        IcmpResult r = new WindowsNativeIcmpRunner(falsa).run("10.79.10.6", 3_000);
        assertThat(r.status()).isEqualTo(StatusIcmp.ERRO);
        assertThat(falsa.chamadas).containsExactly("create", "send", "close");
    }

    @Test
    @DisplayName("falha de carga da biblioteca nativa tambem vira ERRO com handle fechado")
    void falhaDeCargaNativaViraErro() {
        // A JNA nunca embrulha em RuntimeException: Native.load lanca o
        // UnsatisfiedLinkError cru a partir do inicializador estatico.
        IphlpapiFalsa falsa = new IphlpapiFalsa(new Iphlpapi.Retorno(1, 0), 0, 1) {
            @Override
            public Retorno icmpSendEcho(Pointer h, int d, Pointer rq, short t, Pointer o,
                                        Pointer rp, int tr, int tm) {
                chamadas.add("send");
                throw new UnsatisfiedLinkError("Iphlpapi.dll nao encontrada");
            }
        };
        IcmpResult r = new WindowsNativeIcmpRunner(falsa).run("10.79.10.6", 3_000);
        assertThat(r.status()).isEqualTo(StatusIcmp.ERRO);
        assertThat(r.codigoNativo()).isEqualTo(0);
        assertThat(falsa.chamadas).containsExactly("create", "send", "close");
    }

    @Test
    @DisplayName("handle invalido nao pode sair como 11010 (IP_REQ_TIMED_OUT): e' falha local, nao de rede")
    void handleInvalidoNaoViraTimeoutDeRede() {
        IphlpapiFalsa falsa = new IphlpapiFalsa(new Iphlpapi.Retorno(1, 0), 0, 1) {
            @Override
            public Pointer icmpCreateFile() {
                chamadas.add("create");
                return null;
            }
        };
        IcmpResult r = new WindowsNativeIcmpRunner(falsa).run("10.79.10.6", 3_000);
        assertThat(r.status()).isEqualTo(StatusIcmp.ERRO);
        assertThat(r.codigoNativo()).isEqualTo(0);
        assertThat(falsa.chamadas).containsExactly("create");
    }

    @Test
    @DisplayName("um handle por chamada: create e close em toda sondagem")
    void umHandlePorChamada() {
        IphlpapiFalsa falsa = new IphlpapiFalsa(new Iphlpapi.Retorno(1, 0), 0, 1);
        WindowsNativeIcmpRunner runner = new WindowsNativeIcmpRunner(falsa);
        runner.run("10.79.10.6", 3_000);
        runner.run("10.79.10.6", 3_000);
        assertThat(falsa.chamadas).containsExactly("create", "send", "close", "create", "send", "close");
    }

    @Test
    @DisplayName("IP_OPTION_INFORMATION vai com Ttl 128 - sem isso o A.0 mediu timeout espurio 9 em 10")
    void passaTtl128() {
        IphlpapiFalsa falsa = new IphlpapiFalsa(new Iphlpapi.Retorno(1, 0), 0, 1);
        new WindowsNativeIcmpRunner(falsa).run("10.79.10.6", 3_000);
        assertThat(falsa.ttlRecebido).isEqualTo((byte) 128);
    }

    @Test
    @DisplayName("IP vira inteiro em ordem de rede")
    void enderecoEmOrdemDeRede() {
        assertThat(WindowsNativeIcmpRunner.paraOrdemDeRede("10.79.10.6"))
                .isEqualTo(10 | (79 << 8) | (10 << 16) | (6 << 24));
    }
}

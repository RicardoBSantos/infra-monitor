package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitoring.icmp.nativo.Iphlpapi;
import br.com.inframonitor.monitoring.icmp.nativo.WindowsNativeIcmpRunner;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Toca a rede Sesc de verdade. Fica FORA da execucao padrao (tag rede-real,
 * excluida via a propriedade excluded.groups no pom.xml) e so roda no
 * Windows. Para rodar, e preciso liberar a exclusao com -Dexcluded.groups=
 * (vazio) e selecionar a tag com -Dgroups=rede-real:
 *
 *   ./mvnw -o test -Dexcluded.groups= -Dgroups=rede-real -Dtest=IcmpRedeRealIT
 */
@Tag("rede-real")
@EnabledOnOs(OS.WINDOWS)
class IcmpRedeRealIT {

    private static final int TIMEOUT_MS = 3_000;

    private static IcmpResult sondar(String ip) {
        return new WindowsNativeIcmpRunner(new Iphlpapi.Jna()).run(ip, TIMEOUT_MS);
    }

    @Test
    @DisplayName("10.79.10.6 responde")
    void alvoQueResponde() {
        IcmpResult r = sondar("10.79.10.6");
        System.out.println("10.79.10.6 -> " + r);
        assertThat(r.status()).isEqualTo(StatusIcmp.SUCESSO);
        assertThat(r.rttMs()).isNotNull().isLessThan(TIMEOUT_MS);
    }

    @Test
    @DisplayName("10.72.10.16 tem TTL expirado em transito")
    void alvoComTtlExpirado() {
        IcmpResult r = sondar("10.72.10.16");
        System.out.println("10.72.10.16 -> " + r);
        assertThat(r.status()).isEqualTo(StatusIcmp.TTL_EXPIRADO);
        assertThat(r.rttMs()).as("RTT so vale em SUCESSO").isNull();
    }

    @Test
    @DisplayName("10.79.20.250 e host inacessivel, com ARP frio e quente")
    void alvoInacessivelDuasVezes() {
        IcmpResult frio = sondar("10.79.20.250");
        IcmpResult quente = sondar("10.79.20.250");
        System.out.println("10.79.20.250 frio -> " + frio + " | quente -> " + quente);
        assertThat(frio.status()).isEqualTo(StatusIcmp.HOST_INACESSIVEL);
        assertThat(quente.status()).isEqualTo(StatusIcmp.HOST_INACESSIVEL);
        assertThat(frio.rttMs()).as("RTT so vale em SUCESSO; a API preenche RoundTripTime mesmo em erro ICMP").isNull();
        assertThat(quente.rttMs()).as("RTT so vale em SUCESSO; a API preenche RoundTripTime mesmo em erro ICMP").isNull();
    }

    @Test
    @DisplayName("10.73.10.15 da timeout")
    void alvoQueDaTimeout() {
        IcmpResult r = sondar("10.73.10.15");
        System.out.println("10.73.10.15 -> " + r);
        assertThat(r.status()).isEqualTo(StatusIcmp.TIMEOUT);
        assertThat(r.rttMs()).as("RTT so vale em SUCESSO; medido RoundTripTime=2998ms num timeout").isNull();
    }

    @Test
    @DisplayName("nenhum dos quatro alvos e classificado como ERRO")
    void nenhumAlvoCaiEmErro() {
        for (String ip : new String[]{"10.79.10.6", "10.72.10.16", "10.79.20.250", "10.73.10.15"}) {
            assertThat(sondar(ip).status()).as(ip).isNotEqualTo(StatusIcmp.ERRO);
        }
    }
}

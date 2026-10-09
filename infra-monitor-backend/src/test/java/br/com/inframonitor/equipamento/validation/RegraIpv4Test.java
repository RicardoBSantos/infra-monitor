package br.com.inframonitor.equipamento.validation;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

class RegraIpv4Test {

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"   ", "10.0.0.1", " 10.0.0.1 ", "1.0.0.0", "223.255.255.255", "127.0.0.1",
            "192.168.0.10", "169.254.1.1", "8.8.8.8", "100.64.0.1", "10.0.0.0", "10.10.100.200",
            "\u2003", "\u200310.0.0.1\u2003"})
    void aceita(String valor) {
        assertThat(RegraIpv4.motivoDeRecusa(valor)).isNull();
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "2001:db8::1|IPV6", "::1|IPV6", "::ffff:10.0.0.1|IPV6", "fe80::1%eth0|IPV6",
            "10.0.0|FORMATO", "10.0.0.1.5|FORMATO", "servidor.local|FORMATO", "10.0.0.1/32|FORMATO",
            "10.0.0.-1|FORMATO", "1000.0.0.1|FORMATO", "10..0.1|FORMATO", "10.0.0.1 x|FORMATO", "١٠.0.0.1|FORMATO",
            "1a2a3a4|FORMATO", "10 0 0 1|FORMATO",
            "256.0.0.1|OCTETO_FORA_DA_FAIXA", "10.0.0.999|OCTETO_FORA_DA_FAIXA",
            "010.0.0.1|ZERO_A_ESQUERDA", "10.0.0.01|ZERO_A_ESQUERDA", "10.00.0.1|ZERO_A_ESQUERDA",
            "0.0.0.0|REDE_ZERO", "0.1.2.3|REDE_ZERO",
            "224.0.0.1|NAO_HOST", "239.255.255.250|NAO_HOST", "240.0.0.1|NAO_HOST", "255.255.255.255|NAO_HOST"})
    void recusaComMotivo(String valor, String motivo) throws Exception {
        String esperado = (String) RegraIpv4.class.getField(motivo).get(null);
        assertThat(RegraIpv4.motivoDeRecusa(valor)).isEqualTo(esperado);
    }
}

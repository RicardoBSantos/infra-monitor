package br.com.inframonitor.equipamento.validation;

import java.util.regex.Pattern;

/**
 * Unica regra de IP de equipamento. O motor so sonda IPv4 (WindowsNativeIcmpRunner
 * converte octetos em decimal; o ping do Linux le "010" como octal), entao tudo que
 * nao for um endereco IPv4 de host sem ambiguidade e recusado na entrada — senao
 * falha em toda sondagem e abre incidente permanente sem apontar a causa.
 *
 * <p>Espelhos: CHECK da V20, {@code ip-helper.ts} no frontend e
 * {@code tools/carga-real/lib/validacao.mjs}. Mudou aqui, muda nos tres.
 */
public final class RegraIpv4 {

    public static final String IPV6 = "apenas IPv4 e suportado: o monitoramento ICMP nao sonda IPv6";
    public static final String FORMATO = "deve ser um endereco IPv4 no formato 192.168.0.10";
    public static final String OCTETO_FORA_DA_FAIXA = "cada octeto do IP vai de 0 a 255";
    public static final String ZERO_A_ESQUERDA =
            "octeto com zero a esquerda e ambiguo (pode ser lido como octal): escreva 10.0.0.1, nao 010.000.000.001";
    public static final String REDE_ZERO = "a faixa 0.0.0.0/8 nao e endereco de host";
    public static final String NAO_HOST =
            "multicast, reservado ou broadcast (224.0.0.0 em diante) nao e endereco de host monitoravel";

    // [0-9] e nao \d: so digito ASCII.
    private static final Pattern QUATRO_OCTETOS = Pattern.compile("[0-9]{1,3}(\\.[0-9]{1,3}){3}");

    private RegraIpv4() {
    }

    /** Nulo quando aceito. Nulo, vazio ou so espacos e "sem IP", que e permitido. */
    public static String motivoDeRecusa(String valor) {
        if (valor == null || valor.isBlank()) return null;
        String ip = valor.trim();
        if (ip.indexOf(':') >= 0) return IPV6;
        if (!QUATRO_OCTETOS.matcher(ip).matches()) return FORMATO;
        String[] octetos = ip.split("\\.");
        for (String octeto : octetos) {
            if (Integer.parseInt(octeto) > 255) return OCTETO_FORA_DA_FAIXA;
        }
        for (String octeto : octetos) {
            if (octeto.length() > 1 && octeto.charAt(0) == '0') return ZERO_A_ESQUERDA;
        }
        int primeiro = Integer.parseInt(octetos[0]);
        if (primeiro == 0) return REDE_ZERO;
        if (primeiro >= 224) return NAO_HOST;
        return null;
    }
}

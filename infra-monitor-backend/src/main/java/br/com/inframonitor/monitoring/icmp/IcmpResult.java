package br.com.inframonitor.monitoring.icmp;

/**
 * rttMs so e preenchido em SUCESSO: o RoundTripTime vem preenchido mesmo em
 * resposta de erro ICMP (medido: 1042 ms num host inacessivel) e nao significa
 * nada la. codigoNativo so e preenchido em ERRO, para compor a mensagem.
 */
public record IcmpResult(StatusIcmp status, Integer rttMs, Integer codigoNativo) {

    public static IcmpResult sucesso(int rttMs) {
        return new IcmpResult(StatusIcmp.SUCESSO, Math.max(rttMs, 0), null);
    }

    public static IcmpResult falha(StatusIcmp status) {
        if (status == StatusIcmp.SUCESSO) {
            throw new IllegalArgumentException("falha(SUCESSO) nao faz sentido; use sucesso(rttMs)");
        }
        return new IcmpResult(status, null, null);
    }

    public static IcmpResult erro(int codigoNativo) {
        return new IcmpResult(StatusIcmp.ERRO, null, codigoNativo);
    }
}

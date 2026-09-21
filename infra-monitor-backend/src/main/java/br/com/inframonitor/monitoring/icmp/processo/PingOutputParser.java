package br.com.inframonitor.monitoring.icmp.processo;

import br.com.inframonitor.monitoring.icmp.IcmpResult;
import br.com.inframonitor.monitoring.icmp.StatusIcmp;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Le a saida de texto do ping. O codigo de saida do processo e deliberadamente
 * ignorado: no Windows ele e 0 tanto para uma resposta valida quanto para
 * "TTL expirou em transito" e "Host de destino inacessivel".
 */
public final class PingOutputParser {

    /** Aceita "tempo<1ms", "tempo=1ms", "time=12ms" e "time=0.412 ms". */
    private static final Pattern LATENCIA =
            Pattern.compile("(?:tempo|time)\\s*([=<])\\s*(\\d+(?:[.,]\\d+)?)\\s*ms",
                    Pattern.CASE_INSENSITIVE);

    private PingOutputParser() { }

    public static IcmpResult analisar(String ipAlvo, String saida, boolean processoTerminou) {
        if (!processoTerminou) {
            return IcmpResult.falha(StatusIcmp.TIMEOUT);
        }
        String texto = saida == null ? "" : saida;
        String normalizado = texto.toLowerCase(Locale.ROOT);

        if (respondeuDoAlvo(ipAlvo, texto)) {
            return IcmpResult.sucesso(latenciaMs(texto));
        }
        if (contemAlgum(normalizado, "ttl expirou em transito", "ttl) expirou", "ttl expired in transit")) {
            return IcmpResult.falha(StatusIcmp.TTL_EXPIRADO);
        }
        if (contemAlgum(normalizado, "rede de destino inacessivel", "destination net unreachable")) {
            return IcmpResult.falha(StatusIcmp.REDE_INACESSIVEL);
        }
        if (contemAlgum(normalizado, "host de destino inacessivel", "destination host unreachable")) {
            return IcmpResult.falha(StatusIcmp.HOST_INACESSIVEL);
        }
        if (contemAlgum(normalizado, "esgotado o tempo limite", "request timed out", "tempo limite do pedido")) {
            return IcmpResult.falha(StatusIcmp.TIMEOUT);
        }
        return IcmpResult.erro(0);
    }

    /**
     * Sucesso so quando ha UMA linha que cita o IP do alvo e tem "ttl=". A
     * resposta de um roteador intermediario cita o IP dele, nunca o do alvo.
     */
    private static boolean respondeuDoAlvo(String ipAlvo, String texto) {
        if (ipAlvo == null || ipAlvo.isBlank()) {
            return false;
        }
        for (String linha : texto.split("\\R")) {
            String minuscula = linha.toLowerCase(Locale.ROOT);
            if (minuscula.contains(ipAlvo.toLowerCase(Locale.ROOT)) && minuscula.contains("ttl=")) {
                return true;
            }
        }
        return false;
    }

    private static int latenciaMs(String texto) {
        Matcher m = LATENCIA.matcher(texto);
        if (!m.find()) {
            return 0;
        }
        if ("<".equals(m.group(1))) {
            return 0;
        }
        double valor = Double.parseDouble(m.group(2).replace(',', '.'));
        return (int) Math.round(valor);
    }

    private static boolean contemAlgum(String normalizado, String... agulhas) {
        for (String agulha : agulhas) {
            if (normalizado.contains(agulha)) {
                return true;
            }
        }
        return false;
    }
}

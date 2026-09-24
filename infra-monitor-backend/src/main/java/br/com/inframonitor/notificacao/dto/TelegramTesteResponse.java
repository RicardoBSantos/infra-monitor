package br.com.inframonitor.notificacao.dto;

/**
 * Resultado de um envio de teste. Falha de teste e desfecho normal da acao, nao erro de
 * API: o endpoint responde 200 e a tela mostra {@code motivo}. {@code cooldownRestanteSegundos}
 * so vem preenchido quando a recusa foi do throttle.
 */
public record TelegramTesteResponse(boolean enviado, String motivo, Integer cooldownRestanteSegundos) {

    public static TelegramTesteResponse sucesso() { return new TelegramTesteResponse(true, null, null); }

    public static TelegramTesteResponse recusado(String motivo) {
        return new TelegramTesteResponse(false, motivo, null);
    }

    public static TelegramTesteResponse emCooldown(int restanteSegundos) {
        return new TelegramTesteResponse(false, "Aguarde para enviar outro teste.", restanteSegundos);
    }
}

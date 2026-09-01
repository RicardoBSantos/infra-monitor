package br.com.inframonitor.notificacao.telegram;

/**
 * Resultado bruto de getMe. Nunca carrega o token: so a identidade publica do bot.
 * {@code ok = false} representa qualquer falha — token invalido, HTTP de erro ou
 * API fora do ar —, porque para a tela as tres significam a mesma coisa.
 */
public record TelegramBotInfo(boolean ok, String username, Long id) {
    public static TelegramBotInfo indisponivel() { return new TelegramBotInfo(false, null, null); }
}

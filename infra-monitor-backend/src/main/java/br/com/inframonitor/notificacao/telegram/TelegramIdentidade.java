package br.com.inframonitor.notificacao.telegram;

import java.time.Instant;

/**
 * Identidade do bot exibida na tela de configuracao.
 *
 * <p>{@code desatualizado} distingue "nunca verificamos" de "ja verificamos e a ultima
 * revalidacao falhou": no segundo caso os dados continuam sendo exibidos, marcados como
 * vencidos, em vez de a tela perder a informacao por uma indisponibilidade passageira.
 */
public record TelegramIdentidade(StatusIdentidadeBot status, String username, Long botId,
                                 Instant verificadoEm, boolean desatualizado) {

    public static TelegramIdentidade naoVerificado() {
        return new TelegramIdentidade(StatusIdentidadeBot.NAO_VERIFICADO, null, null, null, false);
    }

    public static TelegramIdentidade verificado(TelegramBotInfo info, Instant agora) {
        return new TelegramIdentidade(StatusIdentidadeBot.VERIFICADO, info.username(), info.id(), agora, false);
    }

    public TelegramIdentidade marcarDesatualizado() {
        return status == StatusIdentidadeBot.VERIFICADO
                ? new TelegramIdentidade(status, username, botId, verificadoEm, true)
                : naoVerificado();
    }
}

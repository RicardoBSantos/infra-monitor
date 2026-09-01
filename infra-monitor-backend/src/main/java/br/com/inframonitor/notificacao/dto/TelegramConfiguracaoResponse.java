package br.com.inframonitor.notificacao.dto;

import br.com.inframonitor.notificacao.telegram.TelegramIdentidade;

/**
 * Configuracao do Telegram em modo leitura.
 *
 * <p>O token do bot nao tem campo aqui — nao e omitido nem redigido, simplesmente nao existe
 * neste contrato. O destino aparece apenas como booleano: a tela precisa saber se ha destino,
 * nao qual e. A arquitetura e outbound pura, entao nao ha estado de webhook a reportar.
 */
public record TelegramConfiguracaoResponse(boolean telegramEnabled, boolean dispatcherEnabled,
                                           boolean destinoConfigurado, int testeCooldownSegundos,
                                           TelegramIdentidade bot) {
}

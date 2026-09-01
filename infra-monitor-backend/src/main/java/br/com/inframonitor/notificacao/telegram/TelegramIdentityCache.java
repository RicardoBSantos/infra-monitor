package br.com.inframonitor.notificacao.telegram;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;

/**
 * Mantem a identidade do bot em memoria, revalidada por agendamento.
 *
 * <p>Chamar getMe a cada carregamento de tela seria desperdicio, e fazer a chamada so no
 * startup congelaria o estado ate o proximo deploy caso o token mude ou o Telegram esteja
 * fora do ar no boot. O refresh periodico resolve os dois. A leitura nunca faz I/O e nunca
 * lanca: a tela sempre renderiza.
 */
@Component
public class TelegramIdentityCache {
    private static final Logger log = LoggerFactory.getLogger(TelegramIdentityCache.class);

    private final TelegramClient client;
    private final TelegramProperties properties;
    private final Clock clock;
    private volatile TelegramIdentidade identidade = TelegramIdentidade.naoVerificado();

    public TelegramIdentityCache(TelegramClient client, TelegramProperties properties,
                                 @Qualifier("notificationClock") Clock notificationClock) {
        this.client = client;
        this.properties = properties;
        this.clock = notificationClock;
    }

    public TelegramIdentidade identidade() {
        return identidade;
    }

    @Scheduled(fixedDelayString = "${notification.telegram.identity-refresh-ms:300000}", initialDelay = 0)
    public void revalidar() {
        if (!properties.isEnabled() || !properties.possuiBotToken()) {
            identidade = TelegramIdentidade.naoVerificado();
            return;
        }
        TelegramBotInfo info = client.getMe();
        if (info.ok()) {
            identidade = TelegramIdentidade.verificado(info, clock.instant());
            return;
        }
        // Falha preserva o ultimo resultado bom, marcado como vencido.
        identidade = identidade.marcarDesatualizado();
        log.warn("Nao foi possivel verificar a identidade do bot Telegram");
    }
}

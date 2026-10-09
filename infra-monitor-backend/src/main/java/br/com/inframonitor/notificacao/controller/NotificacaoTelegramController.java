package br.com.inframonitor.notificacao.controller;

import br.com.inframonitor.notificacao.dispatcher.NotificationDispatcherProperties;
import br.com.inframonitor.notificacao.dto.TelegramConfiguracaoResponse;
import br.com.inframonitor.notificacao.dto.TelegramTesteResponse;
import br.com.inframonitor.notificacao.telegram.TelegramIdentityCache;
import br.com.inframonitor.notificacao.telegram.TelegramProperties;
import br.com.inframonitor.notificacao.telegram.TelegramTestService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Configuracao do canal Telegram em modo leitura e acao de teste.
 *
 * <p>Nao ha matcher proprio em SecurityConfiguration para estes caminhos, entao o POST cai
 * no catch-all {@code /api/**} e exige ADMIN — que e a role correta para uma acao que envia
 * mensagem a um grupo real.
 */
@RestController
@RequestMapping("/api/v1/notificacoes/telegram")
public class NotificacaoTelegramController {

    private final TelegramProperties telegramProperties;
    private final NotificationDispatcherProperties dispatcherProperties;
    private final TelegramIdentityCache identityCache;
    private final TelegramTestService testService;

    public NotificacaoTelegramController(TelegramProperties telegramProperties,
                                         NotificationDispatcherProperties dispatcherProperties,
                                         TelegramIdentityCache identityCache,
                                         TelegramTestService testService) {
        this.telegramProperties = telegramProperties;
        this.dispatcherProperties = dispatcherProperties;
        this.identityCache = identityCache;
        this.testService = testService;
    }

    @GetMapping("/configuracao")
    public TelegramConfiguracaoResponse configuracao() {
        return new TelegramConfiguracaoResponse(telegramProperties.isEnabled(),
                dispatcherProperties.isEnabled(), telegramProperties.possuiChatId(),
                telegramProperties.getTesteCooldownSegundos(), identityCache.identidade());
    }

    @PostMapping("/teste")
    public TelegramTesteResponse testar() {
        return testService.enviar();
    }
}

package br.com.inframonitor.notificacao.telegram;

import br.com.inframonitor.notificacao.dto.TelegramTesteResponse;
import br.com.inframonitor.notificacao.sender.SendResult;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Envio de teste manual, fora do pipeline de notificacao.
 *
 * <p>Nao passa pela tabela {@code notificacao}: toda linha de la exige uma ancora — incidente
 * ou episodio de latencia — e um teste nao tem nenhuma das duas. Por isso o envio e sincrono,
 * o que tambem da resposta imediata ao botao. Efeito colateral assumido: o teste nao aparece
 * no historico de notificacoes.
 *
 * <p>O throttle existe porque o destino e um grupo real: sem ele, cliques repetidos viram
 * mensagens repetidas para pessoas.
 */
@Service
public class TelegramTestService {

    private final TelegramClient client;
    private final TelegramProperties properties;
    private final Clock clock;
    private final AtomicReference<Instant> ultimoEnvio = new AtomicReference<>();

    public TelegramTestService(TelegramClient client, TelegramProperties properties,
                               @Qualifier("notificationClock") Clock notificationClock) {
        this.client = client;
        this.properties = properties;
        this.clock = notificationClock;
    }

    public TelegramTesteResponse enviar() {
        if (!properties.isEnabled()) {
            return TelegramTesteResponse.recusado("Integracao Telegram desabilitada no servidor.");
        }
        if (!properties.possuiBotToken() || !properties.possuiChatId()) {
            return TelegramTesteResponse.recusado("Bot ou destino padrao nao configurado no servidor.");
        }

        Instant agora = clock.instant();
        Instant anterior = ultimoEnvio.get();
        int cooldown = properties.getTesteCooldownSegundos();
        if (anterior != null) {
            long decorridos = Duration.between(anterior, agora).getSeconds();
            if (decorridos < cooldown) {
                return TelegramTesteResponse.emCooldown((int) (cooldown - decorridos));
            }
        }
        // Reserva antes de enviar: dois cliques simultaneos nao podem passar os dois.
        if (!ultimoEnvio.compareAndSet(anterior, agora)) {
            return TelegramTesteResponse.emCooldown(cooldown);
        }

        SendResult resultado = client.sendMessage(mensagemDeTeste(agora));
        if (resultado.success()) {
            return TelegramTesteResponse.sucesso();
        }
        return TelegramTesteResponse.recusado(resultado.errorMessage());
    }

    private String mensagemDeTeste(Instant agora) {
        return "TESTE DE INTEGRACAO\n\nInfra Monitor verificando o canal Telegram."
                + "\nEnviado em: " + agora
                + "\n\nEsta mensagem foi disparada manualmente e nao corresponde a um incidente.";
    }
}

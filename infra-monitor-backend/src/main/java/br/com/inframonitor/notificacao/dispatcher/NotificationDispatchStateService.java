package br.com.inframonitor.notificacao.dispatcher;

import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import br.com.inframonitor.notificacao.sender.SendResult;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;

@Service
class NotificationDispatchStateService {
    private final NotificacaoRepository repository; private final Clock clock; private final NotificationDispatcherProperties properties;
    NotificationDispatchStateService(NotificacaoRepository repository, Clock notificationClock, NotificationDispatcherProperties properties) { this.repository = repository; this.clock = notificationClock; this.properties = properties; }
    @Transactional boolean reserve(Long id) { return repository.reserveForDispatch(id, Instant.now(clock)) == 1; }
    @Transactional int releaseStaleReservations(Instant limite) { return repository.releaseStaleSending(limite); }
    @Transactional Notificacao loadSending(Long id) { return repository.findById(id).filter(n -> n.getStatus() == StatusNotificacao.ENVIANDO).orElse(null); }
    @Transactional void complete(Long id, SendResult result) {
        Notificacao n = repository.findById(id).filter(value -> value.getStatus() == StatusNotificacao.ENVIANDO).orElse(null);
        if (n == null) return;
        if (result.success()) { n.marcarEnviada(Instant.now(clock)); return; }
        String error = sanitize(result.errorMessage());
        int nextAttempt = n.getTentativas() + 1;
        if (nextAttempt >= properties.getMaxAttempts()) { n.marcarFalha(error); return; }
        long configured = properties.getBaseDelaySeconds() * (1L << Math.min(n.getTentativas(), 20));
        long delay = result.retryAfter() == null ? configured : Math.max(configured, result.retryAfter().toSeconds());
        n.agendarRetry(Instant.now(clock).plusSeconds(delay), error);
    }
    private String sanitize(String value) { if (value == null || value.isBlank()) return "Falha no envio Telegram"; String clean = value.replaceAll("[\\r\\n]", " "); return clean.substring(0, Math.min(clean.length(), 1000)); }
}

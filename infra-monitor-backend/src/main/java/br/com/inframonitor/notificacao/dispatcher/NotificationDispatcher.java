package br.com.inframonitor.notificacao.dispatcher;

import br.com.inframonitor.common.concurrent.TarefaRotulada;
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import br.com.inframonitor.notificacao.sender.NotificationSender;
import br.com.inframonitor.notificacao.sender.SendResult;
import br.com.inframonitor.notificacao.telegram.TelegramProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;

@Component
public class NotificationDispatcher {
    private static final Logger log = LoggerFactory.getLogger(NotificationDispatcher.class);
    private final NotificacaoRepository repository; private final NotificationDispatchStateService stateService;
    private final NotificationSender telegramSender; private final ExecutorService executor; private final NotificationDispatcherProperties properties;
    private final TelegramProperties telegramProperties; private final Clock clock;
    private final Set<Long> inFlight = ConcurrentHashMap.newKeySet();

    public NotificationDispatcher(NotificacaoRepository repository, NotificationDispatchStateService stateService,
                                  List<NotificationSender> senders, ExecutorService notificationWorkerExecutor,
                                  NotificationDispatcherProperties properties, TelegramProperties telegramProperties,
                                  @Qualifier("notificationClock") Clock notificationClock) {
        this.repository = repository; this.stateService = stateService; this.executor = notificationWorkerExecutor;
        this.properties = properties; this.telegramProperties = telegramProperties; this.clock = notificationClock;
        this.telegramSender = senders.stream().filter(s -> s.canal() == CanalNotificacao.TELEGRAM).findFirst()
                .orElseThrow(() -> new IllegalStateException("Sender Telegram nao configurado"));
    }

    @Scheduled(fixedDelayString = "${notification.dispatcher.poll-delay-ms:1000}")
    public void dispatchReadyNotifications() {
        if (!properties.isEnabled() || !telegramProperties.isEnabled()) return;
        int recovered = stateService.releaseStaleReservations(Instant.now(clock).minusMillis(properties.getProcessingTimeoutMs()));
        if (recovered > 0) log.warn("{} notificacao(oes) ENVIANDO antiga(s) devolvida(s) para a fila", recovered);
        List<Long> ids = repository.findIdsReadyForDispatch(CanalNotificacao.TELEGRAM, StatusNotificacao.PENDENTE,
                properties.getMaxAttempts(), Instant.now(clock), PageRequest.of(0, properties.getBatchSize()));
        for (Long id : ids) submit(id);
    }

    public void submit(Long id) {
        if (!properties.isEnabled() || !telegramProperties.isEnabled() || !inFlight.add(id)) return;
        try { executor.execute(new TarefaRotulada("notificacao " + id, () -> process(id))); }
        catch (RejectedExecutionException ex) { inFlight.remove(id); log.warn("Fila do dispatcher saturada; notificacao {} permanecera pendente", id); }
    }

    private void process(Long id) {
        try {
            if (!stateService.reserve(id)) return;
            Notificacao notification = stateService.loadSending(id);
            if (notification == null) return;
            SendResult result = telegramSender.send(notification); // no transaction is active during HTTP
            stateService.complete(id, result);
            if (result.success()) log.info("Telegram enviado: notificationId={}, ancora={}, tipoEvento={}, tentativa={}",
                    id, notification.descreverAncora(), notification.getTipoEvento(), notification.getTentativas() + 1);
            else log.warn("Telegram falhou: notificationId={}, ancora={}, tipoEvento={}, tentativa={}",
                    id, notification.descreverAncora(), notification.getTipoEvento(), notification.getTentativas() + 1);
        } catch (RuntimeException ex) {
            log.error("Erro interno ao processar notificacao {}: {}", id, ex.getClass().getSimpleName());
            stateService.complete(id, SendResult.failure("Erro interno do dispatcher", null));
        } finally { inFlight.remove(id); }
    }
}

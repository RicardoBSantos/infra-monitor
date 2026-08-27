package br.com.inframonitor.notificacao.dispatcher;

import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import br.com.inframonitor.notificacao.sender.NotificationSender;
import br.com.inframonitor.notificacao.sender.SendResult;
import br.com.inframonitor.notificacao.telegram.TelegramProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Clock;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class NotificationDispatcherTest {
    private final NotificacaoRepository repository = mock(NotificacaoRepository.class);
    private final NotificationDispatchStateService stateService = mock(NotificationDispatchStateService.class);
    private final NotificationSender sender = mock(NotificationSender.class);
    private final NotificationDispatcherProperties dispatcherProperties = new NotificationDispatcherProperties();
    private final TelegramProperties telegramProperties = new TelegramProperties();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @AfterEach
    void shutdown() throws InterruptedException {
        executor.shutdown();
        executor.awaitTermination(1, TimeUnit.SECONDS);
    }

    @Test
    void processaPendenteReservaEnviaECompleta() throws Exception {
        dispatcherProperties.setEnabled(true);
        telegramProperties.setEnabled(true);
        when(sender.canal()).thenReturn(CanalNotificacao.TELEGRAM);
        when(stateService.reserve(1L)).thenReturn(true);
        Notificacao notification = notification();
        when(stateService.loadSending(1L)).thenReturn(notification);
        when(sender.send(notification)).thenReturn(SendResult.sent());

        dispatcher().submit(1L);
        await();

        verify(stateService).reserve(1L);
        verify(sender).send(notification);
        verify(stateService).complete(1L, SendResult.sent());
    }

    @Test
    void naoEnviaComTelegramDesabilitadoNemQuandoReservaFalha() throws Exception {
        when(sender.canal()).thenReturn(CanalNotificacao.TELEGRAM);
        dispatcherProperties.setEnabled(true);
        telegramProperties.setEnabled(false);
        dispatcher().submit(1L);
        await();
        verify(sender, never()).send(any());

        telegramProperties.setEnabled(true);
        when(stateService.reserve(2L)).thenReturn(false);
        dispatcher().submit(2L);
        await();
        verify(sender, never()).send(any());
        verify(stateService, never()).complete(any(), any());
    }

    private NotificationDispatcher dispatcher() {
        return new NotificationDispatcher(repository, stateService, List.of(sender), executor, dispatcherProperties,
                telegramProperties, Clock.systemUTC());
    }

    private Notificacao notification() {
        Incidente incidente = mock(Incidente.class);
        when(incidente.getId()).thenReturn(20L);
        Notificacao notification = new Notificacao(incidente, CanalNotificacao.TELEGRAM,
                TipoEventoNotificacao.INCIDENTE_ABERTO, "mensagem");
        ReflectionTestUtils.setField(notification, "id", 1L);
        return notification;
    }

    private void await() throws Exception {
        executor.submit(() -> { }).get(1, TimeUnit.SECONDS);
    }
}

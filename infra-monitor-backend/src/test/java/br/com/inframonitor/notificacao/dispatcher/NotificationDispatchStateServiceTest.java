package br.com.inframonitor.notificacao.dispatcher;

import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import br.com.inframonitor.notificacao.sender.SendResult;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class NotificationDispatchStateServiceTest {
    private final NotificacaoRepository repository = mock(NotificacaoRepository.class);
    private final NotificationDispatcherProperties properties = new NotificationDispatcherProperties();
    private final Clock clock = Clock.fixed(Instant.parse("2026-08-19T12:00:00Z"), ZoneOffset.UTC);
    private final NotificationDispatchStateService service = new NotificationDispatchStateService(repository, clock, properties);

    @Test
    void sucessoMarcaEnviadaELimpaErro() {
        Notificacao notification = sending(0);
        ReflectionTestUtils.setField(notification, "erro", "erro anterior");
        when(repository.findById(1L)).thenReturn(Optional.of(notification));
        service.complete(1L, SendResult.sent());
        assertThat(notification.getStatus()).isEqualTo(StatusNotificacao.ENVIADA);
        assertThat(notification.getTentativas()).isEqualTo(1);
        assertThat(notification.getEnviadoEm()).isEqualTo(Instant.now(clock));
        assertThat(notification.getErro()).isNull();
    }

    @Test
    void falhasAgendamRetryEAultimaViraFalhaFinal() {
        properties.setMaxAttempts(3); properties.setBaseDelaySeconds(30);
        Notificacao first = sending(0);
        when(repository.findById(1L)).thenReturn(Optional.of(first));
        service.complete(1L, SendResult.failure("HTTP 500", null));
        assertThat(first.getStatus()).isEqualTo(StatusNotificacao.PENDENTE);
        assertThat(first.getTentativas()).isEqualTo(1);
        assertThat(first.getProximaTentativaEm()).isEqualTo(Instant.now(clock).plusSeconds(30));

        Notificacao last = sending(2);
        when(repository.findById(2L)).thenReturn(Optional.of(last));
        service.complete(2L, SendResult.failure("HTTP 400", null));
        assertThat(last.getStatus()).isEqualTo(StatusNotificacao.FALHA);
        assertThat(last.getTentativas()).isEqualTo(3);
        assertThat(last.getProximaTentativaEm()).isNull();
    }

    @Test
    void sanitizaUrlETokenDaFalhaPersistida() {
        Notificacao notification = sending(2);
        when(repository.findById(3L)).thenReturn(Optional.of(notification));

        service.complete(3L, SendResult.failure("https://api.telegram.org/bot1234567890:token/sendMessage", null));

        assertThat(notification.getStatus()).isEqualTo(StatusNotificacao.FALHA);
        assertThat(notification.getErro()).isEqualTo("Telegram API");
    }

    private Notificacao sending(int attempts) {
        Notificacao notification = new Notificacao(mock(Incidente.class), CanalNotificacao.TELEGRAM,
                TipoEventoNotificacao.INCIDENTE_ABERTO, "mensagem persistida");
        ReflectionTestUtils.setField(notification, "status", StatusNotificacao.ENVIANDO);
        ReflectionTestUtils.setField(notification, "tentativas", attempts);
        return notification;
    }
}

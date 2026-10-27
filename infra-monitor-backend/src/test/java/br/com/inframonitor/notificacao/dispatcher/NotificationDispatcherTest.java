package br.com.inframonitor.notificacao.dispatcher;

import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.manutencao.entity.ManutencaoAgendada;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatencia;
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import br.com.inframonitor.notificacao.sender.NotificationSender;
import br.com.inframonitor.notificacao.sender.SendResult;
import br.com.inframonitor.notificacao.telegram.TelegramProperties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Clock;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(OutputCaptureExtension.class)
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

    @Test
    void envioDeLatenciaNaoLogaErroInterno(CapturedOutput output) throws Exception {
        prepararEnvio(notificacaoDeLatencia(), SendResult.sent());

        dispatcher().submit(1L);
        await();

        assertThat(output.getAll()).doesNotContain("Erro interno ao processar notificacao")
                .contains("Telegram enviado: notificationId=").contains("ancora=episodioLatencia=3");
        verify(stateService, times(1)).complete(eq(1L), any());
    }

    @Test
    void falhaDeLatenciaLogaAncora(CapturedOutput output) throws Exception {
        prepararEnvio(notificacaoDeLatencia(), SendResult.failure("timeout", null));

        dispatcher().submit(1L);
        await();

        assertThat(output.getAll()).doesNotContain("Erro interno ao processar notificacao")
                .contains("Telegram falhou").contains("ancora=episodioLatencia=3");
        verify(stateService, times(1)).complete(eq(1L), any());
    }

    @Test
    void envioDeJanelaNaoLogaErroInterno(CapturedOutput output) throws Exception {
        ManutencaoAgendada janela = mock(ManutencaoAgendada.class);
        when(janela.getId()).thenReturn(41L);
        Notificacao notification = new Notificacao((Incidente) null, CanalNotificacao.TELEGRAM,
                TipoEventoNotificacao.MANUTENCAO_INICIADA, "mensagem");
        ReflectionTestUtils.setField(notification, "id", 1L);
        // sem construtor publico para janela: a ancora entra por reflexao
        ReflectionTestUtils.setField(notification, "manutencaoAgendada", janela);
        prepararEnvio(notification, SendResult.sent());

        dispatcher().submit(1L);
        await();

        assertThat(output.getAll()).doesNotContain("Erro interno ao processar notificacao")
                .contains("Telegram enviado: notificationId=").contains("ancora=manutencao=41");
        verify(stateService, times(1)).complete(eq(1L), any());
    }

    private void prepararEnvio(Notificacao notification, SendResult resultado) {
        dispatcherProperties.setEnabled(true);
        telegramProperties.setEnabled(true);
        when(sender.canal()).thenReturn(CanalNotificacao.TELEGRAM);
        when(stateService.reserve(1L)).thenReturn(true);
        when(stateService.loadSending(1L)).thenReturn(notification);
        when(sender.send(notification)).thenReturn(resultado);
    }

    private Notificacao notificacaoDeLatencia() {
        MonitorEpisodioLatencia episodio = mock(MonitorEpisodioLatencia.class);
        when(episodio.getId()).thenReturn(3L);
        Notificacao notification = new Notificacao(episodio, CanalNotificacao.TELEGRAM,
                TipoEventoNotificacao.LATENCIA_ALTA, "mensagem");
        ReflectionTestUtils.setField(notification, "id", 1L);
        return notification;
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

package br.com.inframonitor.notificacao.telegram;

import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.notificacao.sender.SendResult;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TelegramNotificationSenderTest {
    @Test void encaminhaSomenteAMensagemPersistidaAoClient() {
        TelegramClient client = mock(TelegramClient.class);
        when(client.sendMessage("snapshot historico")).thenReturn(SendResult.sent());
        TelegramNotificationSender sender = new TelegramNotificationSender(client);
        Notificacao notification = new Notificacao(mock(Incidente.class), CanalNotificacao.TELEGRAM,
                TipoEventoNotificacao.INCIDENTE_ABERTO, "snapshot historico");
        assertThat(sender.send(notification).success()).isTrue();
        verify(client).sendMessage("snapshot historico");
    }
}

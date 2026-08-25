package br.com.inframonitor.notificacao.telegram;

import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.sender.NotificationSender;
import br.com.inframonitor.notificacao.sender.SendResult;
import org.springframework.stereotype.Component;

@Component
public class TelegramNotificationSender implements NotificationSender {
    private final TelegramClient client;
    public TelegramNotificationSender(TelegramClient client) { this.client = client; }
    @Override public CanalNotificacao canal() { return CanalNotificacao.TELEGRAM; }
    @Override public SendResult send(Notificacao notificacao) { return client.sendMessage(notificacao.getMensagem()); }
}

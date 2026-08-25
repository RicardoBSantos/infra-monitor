package br.com.inframonitor.notificacao.sender;

import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;

public interface NotificationSender {
    CanalNotificacao canal();
    SendResult send(Notificacao notificacao);
}

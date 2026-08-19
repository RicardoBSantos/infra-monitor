package br.com.inframonitor.notificacao.telegram;

import br.com.inframonitor.notificacao.sender.SendResult;

public interface TelegramClient {
    SendResult sendMessage(String message);
}

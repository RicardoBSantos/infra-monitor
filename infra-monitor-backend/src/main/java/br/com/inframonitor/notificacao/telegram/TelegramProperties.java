package br.com.inframonitor.notificacao.telegram;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("notification.telegram")
public class TelegramProperties {
    private boolean enabled;
    private String botToken;
    private String chatId;
    private int connectTimeoutMs = 3000;
    private int readTimeoutMs = 5000;
    public boolean isEnabled() { return enabled; } public void setEnabled(boolean value) { enabled = value; }
    public String getBotToken() { return botToken; } public void setBotToken(String value) { botToken = value; }
    public String getChatId() { return chatId; } public void setChatId(String value) { chatId = value; }
    public int getConnectTimeoutMs() { return connectTimeoutMs; } public void setConnectTimeoutMs(int value) { connectTimeoutMs = value; }
    public int getReadTimeoutMs() { return readTimeoutMs; } public void setReadTimeoutMs(int value) { readTimeoutMs = value; }
}

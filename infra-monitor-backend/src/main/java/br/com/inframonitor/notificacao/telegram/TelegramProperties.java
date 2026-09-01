package br.com.inframonitor.notificacao.telegram;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("notification.telegram")
public class TelegramProperties {
    private boolean enabled;
    private String botToken;
    private String chatId;
    private String apiBaseUrl = "https://api.telegram.org";
    private int connectTimeoutMs = 3000;
    private int readTimeoutMs = 5000;
    private long identityRefreshMs = 300_000;
    private int testeCooldownSegundos = 60;
    public boolean isEnabled() { return enabled; } public void setEnabled(boolean value) { enabled = value; }
    public String getBotToken() { return botToken; } public void setBotToken(String value) { botToken = value; }
    public String getChatId() { return chatId; } public void setChatId(String value) { chatId = value; }
    public String getApiBaseUrl() { return apiBaseUrl; } public void setApiBaseUrl(String value) { apiBaseUrl = value; }
    public int getConnectTimeoutMs() { return connectTimeoutMs; } public void setConnectTimeoutMs(int value) { connectTimeoutMs = value; }
    public int getReadTimeoutMs() { return readTimeoutMs; } public void setReadTimeoutMs(int value) { readTimeoutMs = value; }
    public long getIdentityRefreshMs() { return identityRefreshMs; } public void setIdentityRefreshMs(long value) { identityRefreshMs = value; }
    public int getTesteCooldownSegundos() { return testeCooldownSegundos; } public void setTesteCooldownSegundos(int value) { testeCooldownSegundos = value; }

    /** Destino configurado sem expor qual: alimenta a tela em modo leitura. */
    public boolean possuiChatId() { return chatId != null && !chatId.isBlank(); }
    public boolean possuiBotToken() { return botToken != null && !botToken.isBlank(); }
}

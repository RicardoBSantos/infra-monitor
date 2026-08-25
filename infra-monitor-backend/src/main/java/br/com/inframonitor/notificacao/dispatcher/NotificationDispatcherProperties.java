package br.com.inframonitor.notificacao.dispatcher;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("notification.dispatcher")
public class NotificationDispatcherProperties {
    private boolean enabled;
    private long pollDelayMs = 1000;
    private int batchSize = 50;
    private int workerThreads = 5;
    private int queueCapacity = 100;
    private int maxAttempts = 3;
    private long baseDelaySeconds = 30;
    private long processingTimeoutMs = 60000;
    public boolean isEnabled() { return enabled; } public void setEnabled(boolean value) { enabled = value; }
    public long getPollDelayMs() { return pollDelayMs; } public void setPollDelayMs(long value) { pollDelayMs = value; }
    public int getBatchSize() { return batchSize; } public void setBatchSize(int value) { batchSize = value; }
    public int getWorkerThreads() { return workerThreads; } public void setWorkerThreads(int value) { workerThreads = value; }
    public int getQueueCapacity() { return queueCapacity; } public void setQueueCapacity(int value) { queueCapacity = value; }
    public int getMaxAttempts() { return maxAttempts; } public void setMaxAttempts(int value) { maxAttempts = value; }
    public long getBaseDelaySeconds() { return baseDelaySeconds; } public void setBaseDelaySeconds(long value) { baseDelaySeconds = value; }
    public long getProcessingTimeoutMs() { return processingTimeoutMs; } public void setProcessingTimeoutMs(long value) { processingTimeoutMs = value; }
}

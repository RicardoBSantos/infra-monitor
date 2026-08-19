package br.com.inframonitor.monitoring.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("monitoring.engine")
public class MonitoringEngineProperties {
    private boolean enabled;
    private long schedulerDelayMs = 1_000;
    private int workerThreads = 4;
    private int queueCapacity = 100;
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public long getSchedulerDelayMs() { return schedulerDelayMs; }
    public void setSchedulerDelayMs(long schedulerDelayMs) { this.schedulerDelayMs = schedulerDelayMs; }
    public int getWorkerThreads() { return workerThreads; }
    public void setWorkerThreads(int workerThreads) { this.workerThreads = workerThreads; }
    public int getQueueCapacity() { return queueCapacity; }
    public void setQueueCapacity(int queueCapacity) { this.queueCapacity = queueCapacity; }
}

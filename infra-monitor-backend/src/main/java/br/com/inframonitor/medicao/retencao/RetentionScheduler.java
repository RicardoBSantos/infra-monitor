package br.com.inframonitor.medicao.retencao;

import java.util.concurrent.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

/** Private executor: does not replace or occupy the monitoring/notification scheduler. */
@Component
public class RetentionScheduler implements SmartLifecycle {
    private static final Logger log = LoggerFactory.getLogger(RetentionScheduler.class);
    private final RetentionService service;
    private final RetentionProperties properties;
    private ScheduledExecutorService executor;
    private volatile boolean running;
    public RetentionScheduler(RetentionService service, RetentionProperties properties) {
        this.service = service; this.properties = properties;
    }
    @Override public synchronized void start() {
        if (running || !properties.enabled()) return;
        executor = Executors.newSingleThreadScheduledExecutor(task -> {
            Thread thread = new Thread(task, "medicao-retention");
            thread.setDaemon(true);
            return thread;
        });
        executor.scheduleWithFixedDelay(() -> {
            try { service.runOnce(); }
            catch (RuntimeException ex) {
                log.error("Retention scheduler failed type={}", ex.getClass().getSimpleName());
            }
        }, properties.initialDelay().toMillis(), properties.interval().toMillis(), TimeUnit.MILLISECONDS);
        running = true;
    }
    @Override public synchronized void stop() {
        if (executor != null) {
            executor.shutdownNow();
            try { executor.awaitTermination(5, TimeUnit.SECONDS); }
            catch (InterruptedException ex) { Thread.currentThread().interrupt(); }
        }
        running = false;
    }
    @Override public boolean isRunning() { return running; }
    @Override public int getPhase() { return Integer.MAX_VALUE; }
}

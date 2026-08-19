package br.com.inframonitor.monitoring.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.time.Clock;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

@Configuration(proxyBeanMethods = false)
@EnableScheduling
@EnableConfigurationProperties(MonitoringEngineProperties.class)
@ConditionalOnProperty(prefix = "monitoring.engine", name = "enabled", havingValue = "true")
public class MonitoringEngineConfiguration {
    @Bean(destroyMethod = "shutdown")
    ExecutorService monitoringWorkerExecutor(MonitoringEngineProperties properties) {
        AtomicInteger sequence = new AtomicInteger();
        ThreadFactory factory = task -> new Thread(task, "monitor-worker-" + sequence.incrementAndGet());
        return new ThreadPoolExecutor(properties.getWorkerThreads(), properties.getWorkerThreads(), 0,
                TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(properties.getQueueCapacity()), factory,
                new ThreadPoolExecutor.AbortPolicy());
    }

    @Bean Clock monitoringClock() { return Clock.systemUTC(); }
}

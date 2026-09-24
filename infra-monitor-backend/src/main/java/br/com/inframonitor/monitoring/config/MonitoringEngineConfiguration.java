package br.com.inframonitor.monitoring.config;

import br.com.inframonitor.common.concurrent.ExecutorQueLogaFalhas;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

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
        ThreadPoolExecutor pool = new ThreadPoolExecutor(properties.getWorkerThreads(), properties.getWorkerThreads(), 0,
                TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(properties.getQueueCapacity()), factory,
                new ThreadPoolExecutor.AbortPolicy());
        // AbortPolicy continua valendo: RejectedExecutionException sobe ate' o
        // chamador, que ja' a trata. O envelope so' cobre a falha DENTRO da tarefa.
        return new ExecutorQueLogaFalhas(pool);
    }
}

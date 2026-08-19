package br.com.inframonitor.notificacao.dispatcher;

import br.com.inframonitor.notificacao.telegram.TelegramProperties;
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
@EnableConfigurationProperties({NotificationDispatcherProperties.class, TelegramProperties.class})
public class NotificationDispatcherConfiguration {
    @Bean(destroyMethod = "shutdown")
    ExecutorService notificationWorkerExecutor(NotificationDispatcherProperties properties) {
        AtomicInteger sequence = new AtomicInteger();
        ThreadFactory factory = task -> new Thread(task, "notification-worker-" + sequence.incrementAndGet());
        return new ThreadPoolExecutor(properties.getWorkerThreads(), properties.getWorkerThreads(), 0, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(properties.getQueueCapacity()), factory, new ThreadPoolExecutor.AbortPolicy());
    }
    @Bean Clock notificationClock() { return Clock.systemUTC(); }

    @Bean
    @ConditionalOnProperty(prefix = "notification.telegram", name = "enabled", havingValue = "true")
    TelegramConfigurationValidator telegramConfigurationValidator(TelegramProperties properties) {
        if (properties.getBotToken() == null || properties.getBotToken().isBlank()
                || properties.getChatId() == null || properties.getChatId().isBlank()) {
            throw new IllegalStateException("Telegram habilitado requer TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID configurados");
        }
        return new TelegramConfigurationValidator();
    }
    static final class TelegramConfigurationValidator { }
}

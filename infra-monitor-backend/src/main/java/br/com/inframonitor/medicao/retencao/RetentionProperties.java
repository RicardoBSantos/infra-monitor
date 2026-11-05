package br.com.inframonitor.medicao.retencao;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Fail closed: invalid limits never become an unrestricted deletion. */
@ConfigurationProperties("monitoring.retention")
public record RetentionProperties(
        @DefaultValue("false") boolean enabled,
        @DefaultValue("true") boolean dryRun,
        @DefaultValue("false") boolean deletionApproved,
        @DefaultValue("30") int days,
        @DefaultValue("1000") int batchSize,
        @DefaultValue("50") int maxBatches,
        @DefaultValue("50000") int maxRowsPerRun,
        @DefaultValue("1000") int maxOperationalTail,
        @DefaultValue("30s") Duration maxRunTime,
        @DefaultValue("3s") Duration batchTimeout,
        @DefaultValue("200ms") Duration lockTimeout,
        @DefaultValue("15m") Duration interval,
        @DefaultValue("15m") Duration initialDelay) {
    public RetentionProperties {
        if (days < 30 || days > 36500 || batchSize < 1 || batchSize > 5000
                || maxBatches < 1 || maxBatches > 1000 || maxRowsPerRun < 1
                || maxRowsPerRun > 1000000 || maxOperationalTail < 1 || maxOperationalTail > 10000)
            throw new IllegalArgumentException("Invalid retention bounds");
        for (Duration d : new Duration[]{maxRunTime, batchTimeout, lockTimeout, interval, initialDelay})
            if (d == null || d.isNegative() || d.isZero() || d.compareTo(Duration.ofDays(1)) > 0)
                throw new IllegalArgumentException("Invalid retention duration");
        if (batchTimeout.compareTo(maxRunTime) > 0 || lockTimeout.compareTo(batchTimeout) > 0)
            throw new IllegalArgumentException("Retention timeout order is invalid");
    }
    public boolean mayDelete() { return enabled && !dryRun && deletionApproved; }
}

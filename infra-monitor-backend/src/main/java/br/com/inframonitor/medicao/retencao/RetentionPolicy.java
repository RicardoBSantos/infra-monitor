package br.com.inframonitor.medicao.retencao;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

public final class RetentionPolicy {
    private RetentionPolicy() { }
    public static Instant cutoff(Clock clock, int days) {
        if (days < 30) throw new IllegalArgumentException("At least 30 complete UTC days are required");
        return clock.instant().atZone(ZoneOffset.UTC).toLocalDate().minusDays(days)
                .atStartOfDay(ZoneOffset.UTC).toInstant();
    }
    public static int tail(int failures, int recovery, int latency, int maximum) {
        int k = Math.max(Math.max(failures, recovery), latency);
        if (Math.min(Math.min(failures, recovery), latency) < 1 || k > maximum)
            throw new IllegalArgumentException("Unsafe operational tail");
        return k;
    }
}

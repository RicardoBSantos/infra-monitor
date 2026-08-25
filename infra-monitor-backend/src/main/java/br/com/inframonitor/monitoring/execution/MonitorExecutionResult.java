package br.com.inframonitor.monitoring.execution;

import java.time.Instant;

public record MonitorExecutionResult(boolean success, Integer latencyMs, String message, Instant executedAt) {
    public static MonitorExecutionResult success(int latencyMs, Instant executedAt) {
        return new MonitorExecutionResult(true, latencyMs, null, executedAt);
    }

    public static MonitorExecutionResult failure(String message, Instant executedAt) {
        return new MonitorExecutionResult(false, null, message, executedAt);
    }
}

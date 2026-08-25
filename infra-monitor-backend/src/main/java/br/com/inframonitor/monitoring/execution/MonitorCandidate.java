package br.com.inframonitor.monitoring.execution;

import br.com.inframonitor.monitor.entity.TipoMonitor;

import java.time.Instant;

/** Snapshot detached from JPA, safe to hand to a worker after the query ends. */
public record MonitorCandidate(Long monitorId, TipoMonitor tipo, int intervaloSegundos,
                               int timeoutMs, String ip, Instant ultimaMedicaoEm) {
}

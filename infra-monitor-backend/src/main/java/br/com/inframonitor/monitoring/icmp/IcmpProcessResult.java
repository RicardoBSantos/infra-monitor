package br.com.inframonitor.monitoring.icmp;

public record IcmpProcessResult(boolean timedOut, int exitCode, long elapsedMs) {
}

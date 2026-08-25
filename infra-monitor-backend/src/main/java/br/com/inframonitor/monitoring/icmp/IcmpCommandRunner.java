package br.com.inframonitor.monitoring.icmp;

import java.io.IOException;

public interface IcmpCommandRunner {
    IcmpProcessResult run(String ip, int timeoutMs) throws IOException, InterruptedException;
}

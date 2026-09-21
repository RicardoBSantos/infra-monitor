package br.com.inframonitor.monitoring.icmp;

import java.io.IOException;

public interface IcmpCommandRunner {
    IcmpResult run(String ip, int timeoutMs) throws IOException, InterruptedException;
}

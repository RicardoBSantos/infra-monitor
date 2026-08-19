package br.com.inframonitor.monitoring.icmp;

import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

/** Linux implementation. It deliberately never invokes a shell. */
@Component
public class LinuxPingCommandRunner implements IcmpCommandRunner {

    @Override
    public IcmpProcessResult run(String ip, int timeoutMs) throws IOException, InterruptedException {
        Process process = new ProcessBuilder("ping", "-n", "-c", "1", ip)
                .redirectErrorStream(true)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .start();
        long startedAt = System.nanoTime();
        boolean completed = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
        if (!completed) {
            stop(process);
            return new IcmpProcessResult(true, -1, elapsedMs(startedAt));
        }
        return new IcmpProcessResult(false, process.exitValue(), elapsedMs(startedAt));
    }

    private void stop(Process process) throws InterruptedException {
        process.destroy();
        if (!process.waitFor(250, TimeUnit.MILLISECONDS)) {
            process.destroyForcibly();
            process.waitFor(250, TimeUnit.MILLISECONDS);
        }
    }

    private long elapsedMs(long startedAt) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt);
    }
}

package br.com.inframonitor.monitoring.icmp.processo;

import br.com.inframonitor.monitoring.icmp.IcmpCommandRunner;
import br.com.inframonitor.monitoring.icmp.IcmpResult;

import java.io.IOException;
import java.nio.charset.Charset;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * Executa o binario ping e le a SAIDA. Nunca invoca um shell.
 * Substitui LinuxPingCommandRunner, que descartava a saida e decidia pelo
 * codigo de saida do processo.
 */
public class ProcessoPingIcmpRunner implements IcmpCommandRunner {

    @Override
    public IcmpResult run(String ip, int timeoutMs) throws IOException, InterruptedException {
        ProcessBuilder builder = new ProcessBuilder(comando(ip, timeoutMs)).redirectErrorStream(true);
        Process process = builder.start();
        String saida;
        boolean terminou;
        try {
            saida = new String(process.getInputStream().readAllBytes(), Charset.defaultCharset());
            terminou = process.waitFor(timeoutMs + 1_000L, TimeUnit.MILLISECONDS);
        } finally {
            if (process.isAlive()) {
                encerrar(process);
            }
        }
        return PingOutputParser.analisar(ip, saida, terminou);
    }

    private java.util.List<String> comando(String ip, int timeoutMs) {
        if (isWindows()) {
            return java.util.List.of("ping", "-n", "1", "-w", String.valueOf(timeoutMs), ip);
        }
        // -W e em segundos e nao aceita fracao; arredonda para cima para nunca
        // ficar menor que o timeout pedido.
        long segundos = Math.max(1L, (timeoutMs + 999L) / 1000L);
        return java.util.List.of("ping", "-n", "-c", "1", "-W", String.valueOf(segundos), ip);
    }

    private void encerrar(Process process) throws InterruptedException {
        process.destroy();
        if (!process.waitFor(250, TimeUnit.MILLISECONDS)) {
            process.destroyForcibly();
            process.waitFor(250, TimeUnit.MILLISECONDS);
        }
    }

    static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }
}

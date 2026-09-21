package br.com.inframonitor.monitoring.icmp.processo;

import br.com.inframonitor.monitoring.icmp.IcmpCommandRunner;
import br.com.inframonitor.monitoring.icmp.IcmpResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Executa o binario ping e le a SAIDA. Nunca invoca um shell.
 * Substitui LinuxPingCommandRunner, que descartava a saida e decidia pelo
 * codigo de saida do processo.
 */
public class ProcessoPingIcmpRunner implements IcmpCommandRunner {

    private static final Logger log = LoggerFactory.getLogger(ProcessoPingIcmpRunner.class);

    @Override
    public IcmpResult run(String ip, int timeoutMs) throws IOException, InterruptedException {
        ProcessBuilder builder = new ProcessBuilder(comando(ip, timeoutMs)).redirectErrorStream(true);
        return conduzir(builder.start(), ip, timeoutMs);
    }

    /** Visivel para teste: e' aqui que se prova que a leitura nao prende a thread chamadora. */
    IcmpResult conduzir(Process process, String ip, int timeoutMs) throws InterruptedException {
        // A leitura vai para uma thread daemon: readAllBytes nao tem timeout proprio e
        // prenderia um worker do pool para sempre se o processo nao fechasse stdout.
        AtomicReference<String> saida = new AtomicReference<>("");
        Thread leitor = new Thread(() -> {
            try (InputStream stream = process.getInputStream()) {
                saida.set(new String(stream.readAllBytes(), Charset.defaultCharset()));
            } catch (IOException excecao) {
                // A thread nao pode lancar para fora; o esperado aqui e' o fechamento forcado
                // por encerrar(), mas um erro de I/O real nao pode sumir sem rastro.
                log.debug("Falha ao ler a saida do ping para {}", ip, excecao);
            }
        }, "ping-reader");
        leitor.setDaemon(true);
        leitor.start();

        boolean terminou;
        try {
            terminou = process.waitFor(timeoutMs + 1_000L, TimeUnit.MILLISECONDS);
        } finally {
            if (process.isAlive()) {
                encerrar(process);
            }
        }
        // join estabelece happens-before: o valor lido aqui e o que a thread escreveu.
        leitor.join(250);
        return PingOutputParser.analisar(ip, saida.get(), terminou);
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

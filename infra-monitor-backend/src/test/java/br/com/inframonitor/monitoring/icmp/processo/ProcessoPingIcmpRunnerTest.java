package br.com.inframonitor.monitoring.icmp.processo;

import br.com.inframonitor.monitoring.icmp.IcmpResult;
import br.com.inframonitor.monitoring.icmp.StatusIcmp;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

@EnabledOnOs({OS.WINDOWS, OS.LINUX, OS.MAC})
class ProcessoPingIcmpRunnerTest {

    @Test
    @DisplayName("a leitura do stream nao prende o runner alem do timeout do waitFor")
    void naoPrendeAThreadAlemDoTimeout() throws Exception {
        ProcessoPingIcmpRunner runner = new ProcessoPingIcmpRunner();

        long inicio = System.nanoTime();
        IcmpResult resultado = runner.run("127.0.0.1", 300);
        long decorridoMs = (System.nanoTime() - inicio) / 1_000_000;

        assertThat(resultado).isNotNull();
        assertThat(decorridoMs).isLessThan(5_000);
    }

    @Test
    @Timeout(10)
    @DisplayName("processo que nunca fecha stdout nao prende a thread chamadora")
    void processoPenduradoNaoPrendeOChamador() throws Exception {
        ProcessoPendurado processo = new ProcessoPendurado();
        IcmpResult resultado = new ProcessoPingIcmpRunner().conduzir(processo, "10.79.10.6", 300);
        assertThat(resultado.status()).isEqualTo(StatusIcmp.TIMEOUT);
        assertThat(processo.isAlive()).as("o finally tem de ter matado o processo").isFalse();
    }

    /** stdout que bloqueia para sempre ate alguem fechar - e' o cenario que o bug nao sobrevivia. */
    private static final class StreamQueNuncaFecha extends InputStream {
        private final CountDownLatch fechado = new CountDownLatch(1);

        @Override
        public int read() throws IOException {
            try {
                fechado.await();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            throw new IOException("stream fechado a forca");
        }

        @Override
        public void close() {
            fechado.countDown();
        }
    }

    /** Processo que ignora o timeout do proprio ping: so morre quando mandam matar. */
    private static final class ProcessoPendurado extends Process {
        private final StreamQueNuncaFecha stdout = new StreamQueNuncaFecha();
        private volatile boolean vivo = true;

        @Override
        public OutputStream getOutputStream() {
            return OutputStream.nullOutputStream();
        }

        @Override
        public InputStream getInputStream() {
            return stdout;
        }

        @Override
        public InputStream getErrorStream() {
            return InputStream.nullInputStream();
        }

        @Override
        public int waitFor() {
            return 0;
        }

        @Override
        public boolean waitFor(long timeout, TimeUnit unit) throws InterruptedException {
            Thread.sleep(unit.toMillis(timeout));   // consome o timeout e desiste, como um ping pendurado
            return false;
        }

        @Override
        public int exitValue() {
            throw new IllegalThreadStateException();
        }

        @Override
        public boolean isAlive() {
            return vivo;
        }

        @Override
        public void destroy() {
            vivo = false;
            stdout.close();
        }

        @Override
        public Process destroyForcibly() {
            destroy();
            return this;
        }
    }
}

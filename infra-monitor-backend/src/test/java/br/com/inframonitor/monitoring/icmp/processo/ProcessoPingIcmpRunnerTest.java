package br.com.inframonitor.monitoring.icmp.processo;

import br.com.inframonitor.monitoring.icmp.IcmpResult;
import br.com.inframonitor.monitoring.icmp.StatusIcmp;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

class ProcessoPingIcmpRunnerTest {

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

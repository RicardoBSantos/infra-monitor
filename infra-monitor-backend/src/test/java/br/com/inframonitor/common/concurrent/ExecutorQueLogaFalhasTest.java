package br.com.inframonitor.common.concurrent;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

class ExecutorQueLogaFalhasTest {

    private final Logger logger = (Logger) LoggerFactory.getLogger(ExecutorQueLogaFalhas.class);
    private final ListAppender<ILoggingEvent> registros = new ListAppender<>();
    private ExecutorService poolReal;
    private ExecutorQueLogaFalhas executor;

    @BeforeEach
    void preparar() {
        registros.start();
        logger.addAppender(registros);
        poolReal = Executors.newSingleThreadExecutor();
        executor = new ExecutorQueLogaFalhas(poolReal);
    }

    @AfterEach
    void encerrar() {
        logger.detachAppender(registros);
        poolReal.shutdownNow();
    }

    @Test
    @DisplayName("submit: Error cru vira ERROR com o rotulo da tarefa, em vez de sumir no Future")
    void submitLogaErrorComRotulo() throws Exception {
        CountDownLatch terminou = new CountDownLatch(1);
        executor.submit(new TarefaRotulada("monitor 42", () -> {
            try {
                throw new UnsatisfiedLinkError("Iphlpapi nao encontrada");
            } finally {
                terminou.countDown();
            }
        }));

        assertThat(terminou.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(esperarUmRegistro()).isTrue();
        ILoggingEvent evento = registros.list.get(0);
        assertThat(evento.getLevel()).isEqualTo(Level.ERROR);
        assertThat(evento.getFormattedMessage()).contains("monitor 42");
        assertThat(evento.getThrowableProxy().getClassName()).isEqualTo("java.lang.UnsatisfiedLinkError");
    }

    @Test
    @DisplayName("execute: Error cru vira ERROR com o rotulo da tarefa")
    void executeLogaErrorComRotulo() throws Exception {
        CountDownLatch terminou = new CountDownLatch(1);
        executor.execute(new TarefaRotulada("notificacao 7", () -> {
            try {
                throw new StackOverflowError("estouro");
            } finally {
                terminou.countDown();
            }
        }));

        assertThat(terminou.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(esperarUmRegistro()).isTrue();
        assertThat(registros.list.get(0).getLevel()).isEqualTo(Level.ERROR);
        assertThat(registros.list.get(0).getFormattedMessage()).contains("notificacao 7");
    }

    @Test
    @DisplayName("o worker sobrevive: a tarefa seguinte executa depois de um Error")
    void workerSobrevive() throws Exception {
        executor.submit(new TarefaRotulada("monitor 1", () -> {
            throw new OutOfMemoryError("simulado");
        }));
        CountDownLatch seguinte = new CountDownLatch(1);
        executor.submit(new TarefaRotulada("monitor 2", seguinte::countDown));

        assertThat(seguinte.await(2, TimeUnit.SECONDS)).isTrue();
    }

    @Test
    @DisplayName("tarefa que termina bem nao gera registro nenhum")
    void sucessoNaoLoga() throws Exception {
        CountDownLatch terminou = new CountDownLatch(1);
        executor.submit(new TarefaRotulada("monitor 3", terminou::countDown));

        assertThat(terminou.await(2, TimeUnit.SECONDS)).isTrue();
        Thread.sleep(100);
        assertThat(registros.list).isEmpty();
    }

    @Test
    @DisplayName("shutdown e awaitTermination continuam chegando ao pool real")
    void delegaCicloDeVida() throws Exception {
        executor.shutdown();
        assertThat(executor.awaitTermination(2, TimeUnit.SECONDS)).isTrue();
        assertThat(poolReal.isShutdown()).isTrue();
        assertThat(executor.isTerminated()).isTrue();
    }

    private boolean esperarUmRegistro() throws InterruptedException {
        for (int tentativa = 0; tentativa < 40; tentativa++) {
            if (!registros.list.isEmpty()) {
                return true;
            }
            Thread.sleep(50);
        }
        return false;
    }
}

package br.com.inframonitor.common.concurrent;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Collection;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Decorator de ExecutorService que impede uma falha de tarefa de desaparecer.
 *
 * <p>Sem ele, pelo {@code submit} o FutureTask guarda o Throwable dentro de um
 * Future que ninguem le, e a falha some sem uma linha de log; pelo
 * {@code execute} a thread morre e o handler default imprime em stderr, fora
 * do Logback. Os dois casos sao reais neste projeto.
 *
 * <p>A falha e' logada e NAO relancada: o requisito e' que o worker sobreviva.
 * Isso inclui Error, OutOfMemoryError inclusive — engolir um Error e' uma
 * escolha deliberada, nao um descuido, e o ERROR gravado e o rastro dela.
 *
 * <p>{@code invokeAll}, {@code invokeAny} e {@code submit(Callable)} delegam
 * sem envelope: quem os chama bloqueia lendo o resultado, entao nada some.
 * Nenhum chamador deste projeto usa essas formas hoje.
 */
public final class ExecutorQueLogaFalhas implements ExecutorService {

    private static final Logger log = LoggerFactory.getLogger(ExecutorQueLogaFalhas.class);

    private final ExecutorService delegado;

    public ExecutorQueLogaFalhas(ExecutorService delegado) {
        this.delegado = delegado;
    }

    private static Runnable envelopar(Runnable tarefa) {
        return () -> {
            try {
                tarefa.run();
            } catch (Throwable falha) {
                if (falha instanceof InterruptedException || falha.getCause() instanceof InterruptedException) {
                    // Interrupcao e' sinal de desligamento, nao uma falha comum: o
                    // desenho exige que ela seja repropagada como interrupcao da
                    // thread, nao engolida junto com as demais.
                    Thread.currentThread().interrupt();
                }
                log.error("Tarefa [{}] falhou e foi descartada", tarefa, falha);
            }
        };
    }

    @Override
    public void execute(Runnable tarefa) {
        delegado.execute(envelopar(tarefa));
    }

    @Override
    public Future<?> submit(Runnable tarefa) {
        return delegado.submit(envelopar(tarefa));
    }

    @Override
    public <T> Future<T> submit(Runnable tarefa, T resultado) {
        return delegado.submit(envelopar(tarefa), resultado);
    }

    @Override
    public <T> Future<T> submit(Callable<T> tarefa) {
        return delegado.submit(tarefa);
    }

    @Override
    public <T> List<Future<T>> invokeAll(Collection<? extends Callable<T>> tarefas) throws InterruptedException {
        return delegado.invokeAll(tarefas);
    }

    @Override
    public <T> List<Future<T>> invokeAll(Collection<? extends Callable<T>> tarefas, long tempo, TimeUnit unidade)
            throws InterruptedException {
        return delegado.invokeAll(tarefas, tempo, unidade);
    }

    @Override
    public <T> T invokeAny(Collection<? extends Callable<T>> tarefas) throws InterruptedException, java.util.concurrent.ExecutionException {
        return delegado.invokeAny(tarefas);
    }

    @Override
    public <T> T invokeAny(Collection<? extends Callable<T>> tarefas, long tempo, TimeUnit unidade)
            throws InterruptedException, java.util.concurrent.ExecutionException, TimeoutException {
        return delegado.invokeAny(tarefas, tempo, unidade);
    }

    @Override
    public void shutdown() {
        delegado.shutdown();
    }

    @Override
    public List<Runnable> shutdownNow() {
        return delegado.shutdownNow();
    }

    @Override
    public boolean isShutdown() {
        return delegado.isShutdown();
    }

    @Override
    public boolean isTerminated() {
        return delegado.isTerminated();
    }

    @Override
    public boolean awaitTermination(long tempo, TimeUnit unidade) throws InterruptedException {
        return delegado.awaitTermination(tempo, unidade);
    }
}

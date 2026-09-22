package br.com.inframonitor.common.concurrent;

import java.util.Objects;

/**
 * Runnable com nome. Existe porque o envelope de {@link ExecutorQueLogaFalhas}
 * loga {@code tarefa.toString()}: sem rotulo, o ERROR diria que "uma tarefa"
 * falhou sem dizer qual monitor ou qual notificacao, que e metade do valor.
 */
public record TarefaRotulada(String rotulo, Runnable delegada) implements Runnable {

    public TarefaRotulada {
        Objects.requireNonNull(rotulo, "rotulo");
        Objects.requireNonNull(delegada, "delegada");
    }

    @Override
    public void run() {
        delegada.run();
    }

    @Override
    public String toString() {
        return rotulo;
    }
}

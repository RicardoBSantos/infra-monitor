package br.com.inframonitor.incidente.entity;

import java.util.Set;

public enum StatusIncidente {
    ABERTO,
    /** Alguem assumiu o incidente. Continua operacionalmente aberto: nao encerra nada. */
    RECONHECIDO,
    FECHADO;

    /**
     * Estados em que o monitor ainda esta indisponivel. E o conjunto que responde
     * "existe incidente aberto neste monitor?" — usado pelo motor de incidentes, pelo
     * de latencia e pelas projecoes do painel. Espelha o predicado parcial de
     * {@code uq_incidente_monitor_aberto}.
     */
    public static final Set<StatusIncidente> EM_ABERTO = Set.of(ABERTO, RECONHECIDO);
}

package br.com.inframonitor.notificacao.entity;

public enum TipoEventoNotificacao {
    INCIDENTE_ABERTO,
    INCIDENTE_FECHADO,
    LATENCIA_ALTA,
    LATENCIA_NORMALIZADA,
    /** Encerramento por manutencao. NUNCA usar INCIDENTE_FECHADO: ninguem resolveu nada. */
    INCIDENTE_ENCERRADO_MANUTENCAO,
    LATENCIA_ENCERRADA_MANUTENCAO
}

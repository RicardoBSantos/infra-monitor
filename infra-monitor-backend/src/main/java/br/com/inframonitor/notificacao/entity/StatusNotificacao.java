package br.com.inframonitor.notificacao.entity;

/** Estados preparados para o dispatcher futuro; nesta etapa novos registros ficam PENDENTE. */
public enum StatusNotificacao {
    PENDENTE,
    ENVIANDO,
    ENVIADA,
    FALHA
}

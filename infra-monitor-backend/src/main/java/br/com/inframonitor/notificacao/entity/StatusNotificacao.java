package br.com.inframonitor.notificacao.entity;

/** Estados preparados para o dispatcher futuro; nesta etapa novos registros ficam PENDENTE. */
public enum StatusNotificacao {
    PENDENTE,
    ENVIANDO,
    ENVIADA,
    FALHA,
    /**
     * A notificacao nunca saiu porque o evento deixou de valer antes do envio —
     * hoje, so' a entrada em manutencao. So' PENDENTE pode virar CANCELADA:
     * marcar ENVIANDO ou ENVIADA seria mentira num campo auditado.
     */
    CANCELADA
}

package br.com.inframonitor.monitoring.icmp;

/** Resultado de uma sondagem ICMP, no vocabulario da pilha de rede, nao no da medicao. */
public enum StatusIcmp {
    SUCESSO,
    TIMEOUT,
    HOST_INACESSIVEL,
    REDE_INACESSIVEL,
    TTL_EXPIRADO,
    ERRO
}

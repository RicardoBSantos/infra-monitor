package br.com.inframonitor.monitoring.icmp;

/** Resultado da tentativa de carregar a biblioteca nativa, decidida na subida. */
public enum CargaNativa {
    OK,
    FALHOU,
    /** Nao se aplica: implementacao de processo, ou sistema operacional nao-Windows. */
    NAO_TENTADA
}

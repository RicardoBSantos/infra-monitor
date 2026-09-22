package br.com.inframonitor.monitoring.latency;

/**
 * Como o episodio foi encerrado. INCIDENTE e' o encerramento silencioso que ja'
 * existia desde a V15 — nao normalizou, piorou — e que a linha nao distinguia de
 * NORMALIZACAO. Legado fica NULL.
 */
public enum MotivoEncerramentoEpisodio {
    NORMALIZACAO,
    INCIDENTE,
    MANUTENCAO
}

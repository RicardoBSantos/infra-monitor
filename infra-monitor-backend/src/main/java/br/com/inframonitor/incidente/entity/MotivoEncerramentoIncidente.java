package br.com.inframonitor.incidente.entity;

/**
 * Como o incidente foi encerrado. Distinto de {@code motivo}, que e' por que ele
 * abriu: sobrescrever aquele apagaria a razao da abertura.
 *
 * <p>NULL na coluna significa "fechado antes da V19, nao classificavel", e nao
 * "faltou dado". Ver Docs/validacao-producao/manutencao-backfill-diagnostico.md.
 */
public enum MotivoEncerramentoIncidente {
    RECUPERACAO_AUTOMATICA,
    FECHAMENTO_MANUAL,
    MANUTENCAO
}

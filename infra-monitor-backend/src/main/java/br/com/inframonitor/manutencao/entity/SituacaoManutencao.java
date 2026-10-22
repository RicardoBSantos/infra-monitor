package br.com.inframonitor.manutencao.entity;

/** Coluna manutencao_agendada.status. Transicoes so por CAS em CoberturaManutencao. */
public enum SituacaoManutencao {
    AGENDADA, ATIVA, CONCLUIDA, CANCELADA, EXPIRADA
}

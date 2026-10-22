package br.com.inframonitor.manutencao.dto;

import br.com.inframonitor.equipamento.dto.ReferenciaResponse;
import br.com.inframonitor.manutencao.entity.EscopoManutencao;
import br.com.inframonitor.manutencao.entity.SituacaoManutencao;

import java.time.Instant;
import java.util.List;

/** Contrato consumido por core/models/manutencao.ts no front: nomes de campo sao contrato. */
public record ManutencaoResponse(
        Long id,
        ReferenciaResponse unidade,
        EscopoManutencao escopo,
        List<ReferenciaResponse> equipamentos,
        Instant inicioPrevisto,
        Instant fimPrevisto,
        String motivo,
        SituacaoManutencao situacao,
        ReferenciaResponse criadoPor,
        Instant ativadaEm,
        Instant encerradaEm,
        ReferenciaResponse encerradaPor,
        Instant canceladaEm,
        ReferenciaResponse canceladaPor,
        List<Long> sobreposicoes) {
}

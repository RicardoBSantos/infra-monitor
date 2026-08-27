package br.com.inframonitor.equipamento.dto;

import java.time.Instant;

public record EquipamentoResponse(
        Long id,
        String nome,
        String ip,
        String hostname,
        String descricao,
        String localizacao,
        boolean ativo,
        boolean emManutencao,
        ReferenciaResponse unidade,
        ReferenciaResponse tipoEquipamento,
        Instant createdAt,
        Instant updatedAt) {
}

package br.com.inframonitor.tipoequipamento.dto;

import java.time.Instant;

public record TipoEquipamentoResponse(
        Long id,
        String nome,
        String descricao,
        boolean ativo,
        Instant createdAt,
        Instant updatedAt) {
}

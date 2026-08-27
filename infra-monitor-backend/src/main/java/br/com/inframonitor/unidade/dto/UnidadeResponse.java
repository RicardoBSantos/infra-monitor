package br.com.inframonitor.unidade.dto;

import java.time.Instant;

public record UnidadeResponse(
        Long id,
        String nome,
        String sigla,
        String descricao,
        String codigoIbge,
        boolean ativo,
        Instant createdAt,
        Instant updatedAt) {
}

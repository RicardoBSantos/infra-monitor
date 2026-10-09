package br.com.inframonitor.unidade.dto;

import java.math.BigDecimal;
import java.time.Instant;

public record UnidadeResponse(
        Long id,
        String nome,
        String sigla,
        String descricao,
        String codigoIbge,
        boolean ativo,
        Instant createdAt,
        Instant updatedAt,
        String endereco,
        String cidade,
        String uf,
        BigDecimal latitude,
        BigDecimal longitude,
        Long conectaAUnidadeId) {
}

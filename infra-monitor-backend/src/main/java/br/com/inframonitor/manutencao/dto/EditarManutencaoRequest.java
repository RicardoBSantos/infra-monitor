package br.com.inframonitor.manutencao.dto;

import br.com.inframonitor.manutencao.entity.EscopoManutencao;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

/** Objeto completo, sem PATCH parcial (MA21): ausente nunca significa "manter". */
public record EditarManutencaoRequest(
        @NotNull Long unidadeId,
        @NotNull EscopoManutencao escopo,
        List<Long> equipamentoIds,
        @NotNull Instant inicioPrevisto,
        @NotNull Instant fimPrevisto,
        @NotBlank @Size(max = 300) String motivo,
        @NotNull @PositiveOrZero Integer versao) {
}

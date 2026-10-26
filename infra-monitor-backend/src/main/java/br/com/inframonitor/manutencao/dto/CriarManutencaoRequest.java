package br.com.inframonitor.manutencao.dto;

import br.com.inframonitor.manutencao.entity.EscopoManutencao;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

public record CriarManutencaoRequest(
        @NotNull Long unidadeId,
        @NotNull EscopoManutencao escopo,
        List<Long> equipamentoIds,
        @NotNull Instant inicioPrevisto,
        @NotNull Instant fimPrevisto,
        @NotBlank @Size(max = 300) String motivo) {
}

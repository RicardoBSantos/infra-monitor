package br.com.inframonitor.medicao.dto;

import br.com.inframonitor.medicao.entity.StatusMedicao;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;

public record CreateMedicaoRequest(
        @NotNull Long monitorId,
        @NotNull StatusMedicao status,
        @Min(0) Integer latenciaMs,
        @Size(max = 255) String mensagem,
        @NotNull Instant executadoEm) {
}

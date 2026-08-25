package br.com.inframonitor.incidente.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;

public record CreateIncidenteRequest(
        @NotNull Long monitorId,
        @NotNull Instant iniciadoEm,
        @Size(max = 255) String motivo,
        @Size(max = 1000) String observacao) {
}

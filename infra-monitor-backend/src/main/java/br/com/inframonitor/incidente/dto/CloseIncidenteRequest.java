package br.com.inframonitor.incidente.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;

public record CloseIncidenteRequest(
        @NotNull Instant encerradoEm,
        @Size(max = 1000) String observacao) {
}

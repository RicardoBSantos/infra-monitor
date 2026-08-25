package br.com.inframonitor.incidente.dto;

import br.com.inframonitor.incidente.entity.StatusIncidente;

import java.time.Instant;

public record IncidenteResponse(Long id, StatusIncidente status, Instant iniciadoEm,
                                Instant encerradoEm, String motivo, String observacao,
                                MonitorIncidenteResponse monitor, Instant createdAt, Instant updatedAt) {
}

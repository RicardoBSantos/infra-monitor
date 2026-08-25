package br.com.inframonitor.medicao.dto;

import br.com.inframonitor.medicao.entity.StatusMedicao;

import java.time.Instant;

public record MedicaoResponse(
        Long id,
        StatusMedicao status,
        Integer latenciaMs,
        String mensagem,
        Instant executadoEm,
        Instant createdAt,
        MonitorMedicaoResponse monitor) {
}

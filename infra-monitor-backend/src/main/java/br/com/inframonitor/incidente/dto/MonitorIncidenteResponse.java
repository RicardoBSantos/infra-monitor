package br.com.inframonitor.incidente.dto;

import br.com.inframonitor.monitor.entity.TipoMonitor;

public record MonitorIncidenteResponse(Long id, String nome, TipoMonitor tipo,
                                       Long equipamentoId, String equipamentoNome,
                                       Long unidadeId, String unidadeNome) {
}

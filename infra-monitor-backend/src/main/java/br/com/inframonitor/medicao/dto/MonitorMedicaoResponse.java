package br.com.inframonitor.medicao.dto;

import br.com.inframonitor.monitor.entity.TipoMonitor;

public record MonitorMedicaoResponse(Long id, String nome, TipoMonitor tipo) {
}

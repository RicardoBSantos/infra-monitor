package br.com.inframonitor.monitor.dto;

import br.com.inframonitor.equipamento.dto.ReferenciaResponse;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import java.time.Instant;

public record MonitorResponse(Long id, String nome, TipoMonitor tipo, int intervaloSegundos, int timeoutMs,
                              int falhasParaIncidente, int sucessosParaRecovery,
                              boolean ativo, ReferenciaResponse equipamento, Instant createdAt, Instant updatedAt) { }

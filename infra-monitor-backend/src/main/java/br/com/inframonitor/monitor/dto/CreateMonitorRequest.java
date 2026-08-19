package br.com.inframonitor.monitor.dto;

import br.com.inframonitor.monitor.entity.TipoMonitor;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CreateMonitorRequest(@NotNull Long equipamentoId, @NotNull TipoMonitor tipo,
                                   @NotBlank @Size(max = 150) String nome,
                                   @NotNull @Min(10) @Max(86400) Integer intervaloSegundos,
                                   @NotNull @Min(100) @Max(60000) Integer timeoutMs,
                                   @Min(1) @Max(100) Integer falhasParaIncidente,
                                   @Min(1) @Max(100) Integer sucessosParaRecovery) { }

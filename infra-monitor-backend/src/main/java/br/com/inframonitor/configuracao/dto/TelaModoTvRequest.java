package br.com.inframonitor.configuracao.dto;

import br.com.inframonitor.configuracao.TelaModoTv;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record TelaModoTvRequest(@NotNull TelaModoTv tela, @NotNull @Min(10) @Max(3600) Integer duracaoSegundos) { }

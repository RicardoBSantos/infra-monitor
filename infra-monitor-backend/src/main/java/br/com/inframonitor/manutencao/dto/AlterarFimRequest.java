package br.com.inframonitor.manutencao.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.Instant;

public record AlterarFimRequest(@NotNull Instant fimPrevisto, @NotNull @PositiveOrZero Integer versao) {
}

package br.com.inframonitor.tipoequipamento.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateTipoEquipamentoRequest(
        @NotBlank @Size(max = 150) String nome,
        @Size(max = 1000) String descricao) {
}

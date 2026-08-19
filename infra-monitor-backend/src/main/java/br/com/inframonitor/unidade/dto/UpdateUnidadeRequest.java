package br.com.inframonitor.unidade.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateUnidadeRequest(
        @NotBlank @Size(max = 150) String nome,
        @NotBlank @Size(max = 30) String sigla,
        String descricao) {
}

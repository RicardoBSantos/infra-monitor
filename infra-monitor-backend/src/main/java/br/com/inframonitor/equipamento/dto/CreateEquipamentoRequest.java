package br.com.inframonitor.equipamento.dto;

import br.com.inframonitor.equipamento.validation.Ipv4Monitoravel;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CreateEquipamentoRequest(
        @NotNull Long unidadeId,
        @NotNull Long tipoEquipamentoId,
        @NotBlank @Size(max = 150) String nome,
        @Size(max = 45) @Ipv4Monitoravel String ip,
        @Size(max = 255) String hostname,
        @Size(max = 1000) String descricao,
        @Size(max = 255) String localizacao,
        @Size(max = 150) String numeroSerie,
        @Size(max = 100) String fabricante,
        @Size(max = 150) String modelo) {
}

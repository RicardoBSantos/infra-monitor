package br.com.inframonitor.configuracao.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.HashSet;
import java.util.List;

/** Wrappers de proposito: ausente e null significam "preservar". Primitivos transformariam ausente em false/0. */
public record AtualizarConfiguracaoModoTvRequest(
        Boolean ativo,
        @Min(30) @Max(600) Integer intervaloAtualizacaoSegundos,
        @Size(min = 1) List<@NotNull @Valid TelaModoTvRequest> telas) {

    @AssertTrue(message = "Tela repetida na lista")
    public boolean isTelasSemDuplicata() {
        if (telas == null) return true;
        var vistas = new HashSet<>();
        for (TelaModoTvRequest t : telas) {
            if (t != null && t.tela() != null && !vistas.add(t.tela())) return false;
        }
        return true;
    }
}

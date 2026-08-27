package br.com.inframonitor.unidade.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;

public record UpdateUnidadeRequest(
        @NotBlank @Size(max = 150) String nome,
        @NotBlank @Size(max = 30) String sigla,
        String descricao,
        @Pattern(regexp = "\\s*\\d{7}\\s*", message = "deve conter exatamente 7 digitos") String codigoIbge,
        @Size(max = 255) String endereco,
        @Size(max = 100) String cidade,
        @Size(max = 2) String uf,
        @DecimalMin(value = "-90", message = "deve estar entre -90 e 90")
        @DecimalMax(value = "90", message = "deve estar entre -90 e 90") BigDecimal latitude,
        @DecimalMin(value = "-180", message = "deve estar entre -180 e 180")
        @DecimalMax(value = "180", message = "deve estar entre -180 e 180") BigDecimal longitude) {

    @AssertTrue(message = "deve ser uma sigla de UF brasileira")
    public boolean isUfValida() {
        return Uf.valida(uf);
    }

    // Espelha ck_unidade_coordenadas_completas: meia coordenada nao localiza nada.
    // Validado aqui para responder 400 em vez de estourar a constraint como 500.
    @AssertTrue(message = "latitude e longitude devem ser informadas juntas ou ambas omitidas")
    public boolean isCoordenadasCompletas() {
        return (latitude == null) == (longitude == null);
    }
}

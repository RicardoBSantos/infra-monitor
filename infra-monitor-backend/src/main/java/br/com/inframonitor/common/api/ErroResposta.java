package br.com.inframonitor.common.api;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.List;

/**
 * Corpo padrao de erro da API.
 * Campos nulos sao omitidos da resposta.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErroResposta(
        Instant timestamp,
        int status,
        String error,
        String message,
        String path,
        List<CampoInvalido> campos) {

    public static ErroResposta de(int status, String error, String message, String path) {
        return new ErroResposta(Instant.now(), status, error, message, path, null);
    }

    public static ErroResposta deValidacao(int status, String error, String message, String path,
                                           List<CampoInvalido> campos) {
        return new ErroResposta(Instant.now(), status, error, message, path, campos);
    }
}

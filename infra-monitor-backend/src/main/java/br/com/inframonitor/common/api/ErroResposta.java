package br.com.inframonitor.common.api;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.Instant;
import java.util.Map;

/**
 * Corpo padrao de erro da API.
 * Campos nulos sao omitidos da resposta.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErroResposta(
        Instant timestamp,
        int status,
        String error,
        String code,
        String message,
        String path,
        Map<String, String> fields) {

    public static ErroResposta de(int status, String error, String code, String message, String path) {
        return new ErroResposta(Instant.now(), status, error, code, message, path, null);
    }

    public static ErroResposta deValidacao(int status, String error, String message, String path,
                                           Map<String, String> fields) {
        return new ErroResposta(Instant.now(), status, error, "VALIDATION_ERROR", message, path, fields);
    }
}

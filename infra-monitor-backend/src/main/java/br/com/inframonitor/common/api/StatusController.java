package br.com.inframonitor.common.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;

/**
 * Endpoint minimo de infraestrutura: prova que a API responde no prefixo /api/v1.
 * Diagnostico completo (banco, disco) fica no Actuator em /actuator/health.
 */
@RestController
@RequestMapping("/api/v1")
public class StatusController {

    private final String aplicacao;

    public StatusController(@Value("${spring.application.name}") String aplicacao) {
        this.aplicacao = aplicacao;
    }

    @GetMapping("/status")
    public StatusResposta status() {
        return new StatusResposta(aplicacao, "UP", Instant.now());
    }

    public record StatusResposta(String aplicacao, String status, Instant instante) {
    }
}

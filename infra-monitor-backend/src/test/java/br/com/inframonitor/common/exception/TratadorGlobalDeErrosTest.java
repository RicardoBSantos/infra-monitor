package br.com.inframonitor.common.exception;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifica o contrato do corpo de erro da API. Usa um controller de apoio porque
 * ainda nao existem endpoints de negocio nesta etapa.
 */
class TratadorGlobalDeErrosTest {

    private final MockMvc mockMvc = MockMvcBuilders
            .standaloneSetup(new ControllerDeApoio())
            .setControllerAdvice(new TratadorGlobalDeErros())
            .build();

    @Test
    void erroDeValidacaoRetorna400ComCamposInvalidos() throws Exception {
        mockMvc.perform(post("/apoio")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nome\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.error").value("Bad Request"))
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.path").value("/apoio"))
                .andExpect(jsonPath("$.timestamp").exists())
                .andExpect(jsonPath("$.fields.nome").exists());
    }

    @Test
    void responseStatusExceptionPreservaStatusEMotivo() throws Exception {
        mockMvc.perform(get("/apoio/ausente"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.code").value("REQUEST_ERROR"))
                .andExpect(jsonPath("$.message").value("Recurso nao encontrado"))
                .andExpect(jsonPath("$.fields").doesNotExist());
    }

    @Test
    void erroInternoNaoExponheMensagemTecnica() throws Exception {
        mockMvc.perform(get("/apoio/erro-interno"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.message").value("Erro interno do servidor"));
    }

    @RestController
    static class ControllerDeApoio {

        @PostMapping("/apoio")
        void criar(@Valid @RequestBody Requisicao requisicao) {
        }

        @GetMapping("/apoio/ausente")
        void ausente() {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Recurso nao encontrado");
        }

        @GetMapping("/apoio/erro-interno")
        void erroInterno() {
            throw new IllegalStateException("Other specification must not be null");
        }

        record Requisicao(@NotBlank String nome) {
        }
    }
}

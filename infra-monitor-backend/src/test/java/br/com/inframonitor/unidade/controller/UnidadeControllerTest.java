package br.com.inframonitor.unidade.controller;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.unidade.dto.CreateUnidadeRequest;
import br.com.inframonitor.unidade.dto.UnidadeResponse;
import br.com.inframonitor.unidade.dto.UpdateUnidadeRequest;
import br.com.inframonitor.unidade.service.UnidadeService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(UnidadeController.class)
class UnidadeControllerTest {

    private static final UnidadeResponse UNIDADE = new UnidadeResponse(
            1L, "Matriz", "MTZ", "Unidade principal", "2800308", true,
            Instant.parse("2026-08-18T10:00:00Z"), Instant.parse("2026-08-18T10:00:00Z"));

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private UnidadeService unidadeService;

    @Test
    void criaUnidadeComLocation() throws Exception {
        when(unidadeService.criar(any(CreateUnidadeRequest.class))).thenReturn(UNIDADE);

        mockMvc.perform(post("/api/v1/unidades")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nome\":\"Matriz\",\"sigla\":\"MTZ\",\"descricao\":\"Unidade principal\",\"codigoIbge\":\"2800308\"}"))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "http://localhost/api/v1/unidades/1"))
                .andExpect(jsonPath("$.nome").value("Matriz"))
                .andExpect(jsonPath("$.sigla").value("MTZ"))
                .andExpect(jsonPath("$.codigoIbge").value("2800308"))
                .andExpect(jsonPath("$.ativo").value(true));
    }

    @Test
    void rejeitaPostInvalido() throws Exception {
        mockMvc.perform(post("/api/v1/unidades")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nome\":\"   \",\"sigla\":\"MTZ\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.fields.nome").exists());

        mockMvc.perform(post("/api/v1/unidades")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nome\":\"Matriz\",\"sigla\":\"MTZ\",\"codigoIbge\":\"28003\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.fields.codigoIbge").exists());
    }

    @Test
    void trataConflitoENaoEncontrado() throws Exception {
        when(unidadeService.criar(any(CreateUnidadeRequest.class)))
                .thenThrow(new ConflitoException("Ja existe uma unidade com este nome"));
        when(unidadeService.buscarPorId(99L)).thenThrow(new RecursoNaoEncontradoException("Unidade nao encontrada"));

        mockMvc.perform(post("/api/v1/unidades")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nome\":\"Matriz\",\"sigla\":\"MTZ\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("Ja existe uma unidade com este nome"));

        mockMvc.perform(get("/api/v1/unidades/99"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Unidade nao encontrada"));
    }

    @Test
    void consultaListaAtualizaAlteraStatusEExclui() throws Exception {
        when(unidadeService.buscarPorId(1L)).thenReturn(UNIDADE);
        when(unidadeService.listar(true)).thenReturn(List.of(UNIDADE));
        when(unidadeService.atualizar(eq(1L), any(UpdateUnidadeRequest.class))).thenReturn(UNIDADE);
        when(unidadeService.ativar(1L)).thenReturn(UNIDADE);
        when(unidadeService.desativar(1L)).thenReturn(UNIDADE);

        mockMvc.perform(get("/api/v1/unidades/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(1))
                .andExpect(jsonPath("$.codigoIbge").value("2800308"));
        mockMvc.perform(get("/api/v1/unidades?ativo=true"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].nome").value("Matriz"))
                .andExpect(jsonPath("$[0].codigoIbge").value("2800308"));
        mockMvc.perform(put("/api/v1/unidades/1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nome\":\"Matriz\",\"sigla\":\"MTZ\",\"descricao\":\"Nova\",\"codigoIbge\":null}"))
                .andExpect(status().isOk());
        mockMvc.perform(patch("/api/v1/unidades/1/ativar"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ativo").value(true));
        mockMvc.perform(patch("/api/v1/unidades/1/desativar"))
                .andExpect(status().isOk());
        mockMvc.perform(delete("/api/v1/unidades/1"))
                .andExpect(status().isNoContent());

        verify(unidadeService).excluir(1L);
    }
}

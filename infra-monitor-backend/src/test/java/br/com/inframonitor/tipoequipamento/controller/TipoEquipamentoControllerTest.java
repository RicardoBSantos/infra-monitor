package br.com.inframonitor.tipoequipamento.controller;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.tipoequipamento.dto.CreateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.dto.TipoEquipamentoResponse;
import br.com.inframonitor.tipoequipamento.dto.UpdateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.service.TipoEquipamentoService;
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

@WebMvcTest(TipoEquipamentoController.class)
class TipoEquipamentoControllerTest {

    private static final TipoEquipamentoResponse TIPO = new TipoEquipamentoResponse(
            1L, "Switch", "Comutacao", true,
            Instant.parse("2026-08-18T10:00:00Z"), Instant.parse("2026-08-18T10:00:00Z"));

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private TipoEquipamentoService tipoEquipamentoService;

    @Test
    void criaTipoComLocation() throws Exception {
        when(tipoEquipamentoService.criar(any(CreateTipoEquipamentoRequest.class))).thenReturn(TIPO);

        mockMvc.perform(post("/api/v1/tipos-equipamento").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nome\":\"Switch\",\"descricao\":\"Comutacao\"}"))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "http://localhost/api/v1/tipos-equipamento/1"))
                .andExpect(jsonPath("$.nome").value("Switch"))
                .andExpect(jsonPath("$.ativo").value(true));
    }

    @Test
    void rejeitaPostInvalidoEDuplicado() throws Exception {
        mockMvc.perform(post("/api/v1/tipos-equipamento").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nome\":\"   \"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.campos[0].campo").value("nome"));

        when(tipoEquipamentoService.criar(any(CreateTipoEquipamentoRequest.class)))
                .thenThrow(new ConflitoException("Ja existe um tipo de equipamento com este nome"));
        mockMvc.perform(post("/api/v1/tipos-equipamento").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nome\":\"Switch\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    void consultaListaAtualizaStatusEExclui() throws Exception {
        when(tipoEquipamentoService.buscarPorId(1L)).thenReturn(TIPO);
        when(tipoEquipamentoService.listar(true)).thenReturn(List.of(TIPO));
        when(tipoEquipamentoService.atualizar(eq(1L), any(UpdateTipoEquipamentoRequest.class))).thenReturn(TIPO);
        when(tipoEquipamentoService.ativar(1L)).thenReturn(TIPO);
        when(tipoEquipamentoService.desativar(1L)).thenReturn(TIPO);

        mockMvc.perform(get("/api/v1/tipos-equipamento/1")).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/tipos-equipamento?ativo=true"))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].nome").value("Switch"));
        mockMvc.perform(put("/api/v1/tipos-equipamento/1").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nome\":\"Switch\",\"descricao\":\"Nova\"}"))
                .andExpect(status().isOk());
        mockMvc.perform(patch("/api/v1/tipos-equipamento/1/ativar")).andExpect(status().isOk());
        mockMvc.perform(patch("/api/v1/tipos-equipamento/1/desativar")).andExpect(status().isOk());
        mockMvc.perform(delete("/api/v1/tipos-equipamento/1")).andExpect(status().isNoContent());
        verify(tipoEquipamentoService).excluir(1L);
    }

    @Test
    void retorna404ParaRecursoInexistenteE409NoPutDuplicado() throws Exception {
        when(tipoEquipamentoService.buscarPorId(99L))
                .thenThrow(new RecursoNaoEncontradoException("Tipo de equipamento nao encontrado"));
        when(tipoEquipamentoService.atualizar(eq(1L), any(UpdateTipoEquipamentoRequest.class)))
                .thenThrow(new ConflitoException("Ja existe um tipo de equipamento com este nome"));
        org.mockito.Mockito.doThrow(new RecursoNaoEncontradoException("Tipo de equipamento nao encontrado"))
                .when(tipoEquipamentoService).excluir(99L);

        mockMvc.perform(get("/api/v1/tipos-equipamento/99"))
                .andExpect(status().isNotFound());
        mockMvc.perform(put("/api/v1/tipos-equipamento/1").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nome\":\"Router\"}"))
                .andExpect(status().isConflict());
        mockMvc.perform(delete("/api/v1/tipos-equipamento/99"))
                .andExpect(status().isNotFound());
    }
}

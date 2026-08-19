package br.com.inframonitor.equipamento.controller;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.dto.EquipamentoResponse;
import br.com.inframonitor.equipamento.dto.ReferenciaResponse;
import br.com.inframonitor.equipamento.dto.UpdateEquipamentoRequest;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(EquipamentoController.class)
class EquipamentoControllerTest {

    private static final EquipamentoResponse EQUIPAMENTO = new EquipamentoResponse(
            1L, "SW-CORE-01", "10.0.0.10", "sw-core", "Switch core", "Rack 01", true,
            new ReferenciaResponse(1L, "Matriz"), new ReferenciaResponse(2L, "Switch"),
            Instant.parse("2026-08-18T10:00:00Z"), Instant.parse("2026-08-18T10:00:00Z"));

    @Autowired private MockMvc mockMvc;
    @MockitoBean private EquipamentoService equipamentoService;

    @Test
    void criaValidaEBuscaEquipamento() throws Exception {
        when(equipamentoService.criar(any(CreateEquipamentoRequest.class))).thenReturn(EQUIPAMENTO);
        when(equipamentoService.buscarPorId(1L)).thenReturn(EQUIPAMENTO);

        mockMvc.perform(post("/api/v1/equipamentos").contentType(MediaType.APPLICATION_JSON).content(corpoValido()))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "http://localhost/api/v1/equipamentos/1"))
                .andExpect(jsonPath("$.unidade.nome").value("Matriz"));
        mockMvc.perform(post("/api/v1/equipamentos").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nome\":\"   \"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/equipamentos/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tipoEquipamento.nome").value("Switch"));
    }

    @Test
    void listaComFiltrosAtualizaAlteraStatusEExclui() throws Exception {
        when(equipamentoService.listar(eq(1L), eq(2L), eq(true), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(EQUIPAMENTO)));
        when(equipamentoService.atualizar(eq(1L), any(UpdateEquipamentoRequest.class))).thenReturn(EQUIPAMENTO);
        when(equipamentoService.ativar(1L)).thenReturn(EQUIPAMENTO);
        when(equipamentoService.desativar(1L)).thenReturn(EQUIPAMENTO);

        mockMvc.perform(get("/api/v1/equipamentos?unidadeId=1&tipoEquipamentoId=2&ativo=true&page=0&size=20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].nome").value("SW-CORE-01"));
        mockMvc.perform(put("/api/v1/equipamentos/1").contentType(MediaType.APPLICATION_JSON).content(corpoValido()))
                .andExpect(status().isOk());
        mockMvc.perform(patch("/api/v1/equipamentos/1/ativar")).andExpect(status().isOk());
        mockMvc.perform(patch("/api/v1/equipamentos/1/desativar")).andExpect(status().isOk());
        mockMvc.perform(delete("/api/v1/equipamentos/1")).andExpect(status().isNoContent());
        verify(equipamentoService).excluir(1L);
    }

    @Test
    void traduzErrosDeDominio() throws Exception {
        when(equipamentoService.criar(any(CreateEquipamentoRequest.class)))
                .thenThrow(new RecursoNaoEncontradoException("Unidade nao encontrada"));
        when(equipamentoService.atualizar(eq(1L), any(UpdateEquipamentoRequest.class)))
                .thenThrow(new ConflitoException("Tipo de equipamento inativo"));
        doThrow(new ConflitoException("Nao e possivel excluir o equipamento porque existem monitores associados"))
                .when(equipamentoService).excluir(1L);

        mockMvc.perform(post("/api/v1/equipamentos").contentType(MediaType.APPLICATION_JSON).content(corpoValido()))
                .andExpect(status().isNotFound());
        mockMvc.perform(put("/api/v1/equipamentos/1").contentType(MediaType.APPLICATION_JSON).content(corpoValido()))
                .andExpect(status().isConflict());
        mockMvc.perform(delete("/api/v1/equipamentos/1"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("Nao e possivel excluir o equipamento porque existem monitores associados"));
    }

    private String corpoValido() {
        return """
                {"unidadeId":1,"tipoEquipamentoId":2,"nome":"SW-CORE-01",
                 "ip":"10.0.0.10","hostname":"sw-core","descricao":"Switch core","localizacao":"Rack 01"}
                """;
    }
}

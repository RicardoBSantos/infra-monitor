package br.com.inframonitor.monitor.controller;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.dto.ReferenciaResponse;
import br.com.inframonitor.monitor.dto.CreateMonitorRequest;
import br.com.inframonitor.monitor.dto.MonitorResponse;
import br.com.inframonitor.monitor.dto.UpdateMonitorRequest;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.service.MonitorService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.data.domain.PageImpl;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import java.time.Instant;
import java.util.List;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(MonitorController.class)
class MonitorControllerTest {
    private static final MonitorResponse MONITOR = new MonitorResponse(1L, "ICMP principal", TipoMonitor.ICMP, 60, 2000, 3, 2, true, new ReferenciaResponse(10L, "SW-CORE-01"), Instant.parse("2026-08-19T10:00:00Z"), Instant.parse("2026-08-19T10:00:00Z"));
    @Autowired private MockMvc mockMvc;
    @MockitoBean private MonitorService monitorService;

    @Test void criaERejeitaPostInvalido() throws Exception {
        when(monitorService.criar(any(CreateMonitorRequest.class))).thenReturn(MONITOR);
        mockMvc.perform(post("/api/v1/monitores").contentType(MediaType.APPLICATION_JSON).content(json()))
                .andExpect(status().isCreated()).andExpect(header().string("Location", "http://localhost/api/v1/monitores/1"));
        mockMvc.perform(post("/api/v1/monitores").contentType(MediaType.APPLICATION_JSON).content("{\"equipamentoId\":10,\"tipo\":\"ICMP\",\"nome\":\"\",\"intervaloSegundos\":60,\"timeoutMs\":2000}"))
                .andExpect(status().isBadRequest());
    }
    @Test void consultaFiltraAtualizaStatusEExclui() throws Exception {
        when(monitorService.buscarPorId(1L)).thenReturn(MONITOR);
        when(monitorService.listar(eq(10L), eq(TipoMonitor.ICMP), eq(true), any())).thenReturn(new PageImpl<>(List.of(MONITOR)));
        when(monitorService.atualizar(eq(1L), any(UpdateMonitorRequest.class))).thenReturn(MONITOR);
        when(monitorService.ativar(1L)).thenReturn(MONITOR); when(monitorService.desativar(1L)).thenReturn(MONITOR);
        mockMvc.perform(get("/api/v1/monitores/1")).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/monitores?equipamentoId=10&tipo=ICMP&ativo=true")).andExpect(status().isOk()).andExpect(jsonPath("$.content[0].equipamento.nome").value("SW-CORE-01"));
        mockMvc.perform(put("/api/v1/monitores/1").contentType(MediaType.APPLICATION_JSON).content(json())).andExpect(status().isOk());
        mockMvc.perform(patch("/api/v1/monitores/1/ativar")).andExpect(status().isOk());
        mockMvc.perform(patch("/api/v1/monitores/1/desativar")).andExpect(status().isOk());
        mockMvc.perform(delete("/api/v1/monitores/1")).andExpect(status().isNoContent()); verify(monitorService).excluir(1L);
    }
    @Test void retornaErrosDeDominioEEnumInvalido() throws Exception {
        when(monitorService.criar(any(CreateMonitorRequest.class))).thenThrow(new ConflitoException("Equipamento inativo"));
        when(monitorService.buscarPorId(99L)).thenThrow(new RecursoNaoEncontradoException("Monitor nao encontrado"));
        mockMvc.perform(post("/api/v1/monitores").contentType(MediaType.APPLICATION_JSON).content(json())).andExpect(status().isConflict());
        mockMvc.perform(get("/api/v1/monitores/99")).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/monitores?tipo=TCP")).andExpect(status().isBadRequest());
    }
    @Test void rejeitaThresholdsInvalidos() throws Exception {
        mockMvc.perform(post("/api/v1/monitores").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"equipamentoId\":10,\"tipo\":\"ICMP\",\"nome\":\"ICMP\",\"intervaloSegundos\":60,\"timeoutMs\":2000,\"falhasParaIncidente\":0,\"sucessosParaRecovery\":101}"))
                .andExpect(status().isBadRequest());
    }
    @Test void retorna409AoExcluirMonitorComMedicoes() throws Exception {
        doThrow(new ConflitoException("Nao e possivel excluir o monitor porque existem medicoes associadas"))
                .when(monitorService).excluir(1L);
        mockMvc.perform(delete("/api/v1/monitores/1")).andExpect(status().isConflict());
    }
    private String json() { return "{\"equipamentoId\":10,\"tipo\":\"ICMP\",\"nome\":\"ICMP principal\",\"intervaloSegundos\":60,\"timeoutMs\":2000,\"falhasParaIncidente\":3,\"sucessosParaRecovery\":2}"; }
}

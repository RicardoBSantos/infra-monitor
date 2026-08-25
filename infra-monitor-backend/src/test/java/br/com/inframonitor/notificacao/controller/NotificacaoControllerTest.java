package br.com.inframonitor.notificacao.controller;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.notificacao.dto.IncidenteNotificacaoResponse;
import br.com.inframonitor.notificacao.dto.NotificacaoResponse;
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.data.domain.PageImpl;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(NotificacaoController.class)
class NotificacaoControllerTest {
    private static final NotificacaoResponse NOTIFICACAO = new NotificacaoResponse(100L, CanalNotificacao.TELEGRAM,
            TipoEventoNotificacao.INCIDENTE_ABERTO, StatusNotificacao.PENDENTE, 0, "snapshot", null, null,
            new IncidenteNotificacaoResponse(10L, StatusIncidente.ABERTO), Instant.parse("2026-08-19T12:00:00Z"),
            Instant.parse("2026-08-19T12:00:00Z"));

    @Autowired private MockMvc mockMvc;
    @MockitoBean private NotificacaoService notificacaoService;

    @Test
    void consultaEFiltra() throws Exception {
        when(notificacaoService.buscarPorId(100L)).thenReturn(NOTIFICACAO);
        when(notificacaoService.listar(eq(10L), eq(StatusNotificacao.PENDENTE), eq(CanalNotificacao.TELEGRAM),
                eq(TipoEventoNotificacao.INCIDENTE_ABERTO), any(), any(), any())).thenReturn(new PageImpl<>(List.of(NOTIFICACAO)));

        mockMvc.perform(get("/api/v1/notificacoes/100")).andExpect(status().isOk())
                .andExpect(jsonPath("$.incidente.id").value(10));
        mockMvc.perform(get("/api/v1/notificacoes?incidenteId=10&status=PENDENTE&canal=TELEGRAM&tipoEvento=INCIDENTE_ABERTO&inicio=2026-08-19T00:00:00Z&fim=2026-08-20T00:00:00Z"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content[0].status").value("PENDENTE"));
    }

    @Test
    void retorna404E400ParaEntradasInvalidas() throws Exception {
        when(notificacaoService.buscarPorId(99L)).thenThrow(new RecursoNaoEncontradoException("Notificacao nao encontrada"));
        when(notificacaoService.listar(any(), any(), any(), any(), any(), any(), any()))
                .thenThrow(new IllegalArgumentException("inicio deve ser menor ou igual a fim"));

        mockMvc.perform(get("/api/v1/notificacoes/99")).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/notificacoes?status=INVALIDO")).andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/notificacoes?canal=EMAIL")).andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/v1/notificacoes?inicio=2026-08-20T00:00:00Z&fim=2026-08-19T00:00:00Z"))
                .andExpect(status().isBadRequest());
    }
}

package br.com.inframonitor.monitoring.latency.controller;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.monitoring.latency.MotivoEncerramentoEpisodio;
import br.com.inframonitor.monitoring.latency.dto.EpisodioLatenciaResponse;
import br.com.inframonitor.monitoring.latency.service.EpisodioLatenciaService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(EpisodioLatenciaController.class)
class EpisodioLatenciaControllerTest {

    @Autowired private MockMvc mockMvc;
    @MockitoBean private EpisodioLatenciaService episodioLatenciaService;

    @Test
    void devolveEpisodioEmCursoEDesconhecido() throws Exception {
        when(episodioLatenciaService.buscarPorId(1L)).thenReturn(new EpisodioLatenciaResponse(1L,
                10L, "ICMP principal", 20L, "LINK-WAN", 30L, "Sesc Centro",
                Instant.parse("2026-09-01T08:40:11Z"), Instant.parse("2026-09-01T08:45:11Z"), 250, 2, MotivoEncerramentoEpisodio.INCIDENTE));
        when(episodioLatenciaService.buscarPorId(99L))
                .thenThrow(new RecursoNaoEncontradoException("Episodio de latencia nao encontrado"));

        mockMvc.perform(get("/api/v1/episodios-latencia/1")).andExpect(status().isOk())
                .andExpect(jsonPath("$.limiarMs").value(250))
                // O N que a timeline usa para numerar as medicoes da sequencia.
                .andExpect(jsonPath("$.ciclosParaEpisodio").value(2))
                .andExpect(jsonPath("$.unidadeNome").value("Sesc Centro"))
                .andExpect(jsonPath("$.motivoEncerramento").value("INCIDENTE"));
        mockMvc.perform(get("/api/v1/episodios-latencia/99")).andExpect(status().isNotFound());
    }
}

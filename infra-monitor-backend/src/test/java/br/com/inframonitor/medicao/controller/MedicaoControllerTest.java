package br.com.inframonitor.medicao.controller;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.medicao.dto.CreateMedicaoRequest;
import br.com.inframonitor.medicao.dto.MedicaoResponse;
import br.com.inframonitor.medicao.dto.MonitorMedicaoResponse;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.service.MedicaoService;
import br.com.inframonitor.monitor.entity.TipoMonitor;
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
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(MedicaoController.class)
class MedicaoControllerTest {

    private static final MedicaoResponse MEDICAO = new MedicaoResponse(1L, StatusMedicao.SUCESSO, 4, null,
            Instant.parse("2026-08-19T12:00:00Z"), Instant.parse("2026-08-19T12:00:01Z"),
            new MonitorMedicaoResponse(10L, "ICMP principal", TipoMonitor.ICMP));

    @Autowired private MockMvc mockMvc;
    @MockitoBean private MedicaoService medicaoService;

    @Test
    void criaERejeitaPostInvalido() throws Exception {
        when(medicaoService.criar(any(CreateMedicaoRequest.class))).thenReturn(MEDICAO);

        mockMvc.perform(post("/api/v1/medicoes").contentType(MediaType.APPLICATION_JSON).content(json()))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", "http://localhost/api/v1/medicoes/1"));
        mockMvc.perform(post("/api/v1/medicoes").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"monitorId\":10,\"status\":\"SUCESSO\",\"latenciaMs\":-1,\"executadoEm\":\"2026-08-19T12:00:00Z\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/v1/medicoes").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"monitorId\":10,\"status\":\"INVALIDO\",\"executadoEm\":\"2026-08-19T12:00:00Z\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void consultaEFiltraLista() throws Exception {
        when(medicaoService.buscarPorId(1L)).thenReturn(MEDICAO);
        when(medicaoService.listar(eq(10L), eq(StatusMedicao.SUCESSO), any(), any(), any()))
                .thenReturn(new PageImpl<>(List.of(MEDICAO)));

        mockMvc.perform(get("/api/v1/medicoes/1")).andExpect(status().isOk())
                .andExpect(jsonPath("$.monitor.tipo").value("ICMP"));
        mockMvc.perform(get("/api/v1/medicoes?monitorId=10&status=SUCESSO&inicio=2026-08-19T00:00:00Z&fim=2026-08-20T00:00:00Z"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content[0].id").value(1));
    }

    @Test
    void retorna404E400ParaConsultaInvalida() throws Exception {
        when(medicaoService.buscarPorId(99L)).thenThrow(new RecursoNaoEncontradoException("Medicao nao encontrada"));
        mockMvc.perform(get("/api/v1/medicoes/99")).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/medicoes?status=INVALIDO")).andExpect(status().isBadRequest());
    }

    private String json() {
        return "{\"monitorId\":10,\"status\":\"SUCESSO\",\"latenciaMs\":4,\"executadoEm\":\"2026-08-19T12:00:00Z\"}";
    }
}

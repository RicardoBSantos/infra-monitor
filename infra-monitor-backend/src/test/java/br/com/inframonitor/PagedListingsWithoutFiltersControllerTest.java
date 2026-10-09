package br.com.inframonitor;

import br.com.inframonitor.equipamento.controller.EquipamentoController;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.incidente.controller.IncidenteController;
import br.com.inframonitor.incidente.service.IncidenteService;
import br.com.inframonitor.medicao.controller.MedicaoController;
import br.com.inframonitor.medicao.service.MedicaoService;
import br.com.inframonitor.monitor.controller.MonitorController;
import br.com.inframonitor.monitor.service.MonitorService;
import br.com.inframonitor.notificacao.controller.NotificacaoController;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest({EquipamentoController.class, MonitorController.class, MedicaoController.class,
        IncidenteController.class, NotificacaoController.class})
class PagedListingsWithoutFiltersControllerTest {

    @Autowired private MockMvc mockMvc;
    @MockitoBean private EquipamentoService equipamentoService;
    @MockitoBean private MonitorService monitorService;
    @MockitoBean private MedicaoService medicaoService;
    @MockitoBean private IncidenteService incidenteService;
    @MockitoBean private NotificacaoService notificacaoService;

    @Test
    void endpointsPaginadosSemFiltrosRetornam200ComPaginaVazia() throws Exception {
        when(equipamentoService.listar(isNull(), isNull(), isNull(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(), PageRequest.of(0, 20), 0));
        when(monitorService.listar(isNull(), isNull(), isNull(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(), PageRequest.of(0, 20), 0));
        when(medicaoService.listar(isNull(), isNull(), isNull(), isNull(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(), PageRequest.of(0, 50), 0));
        when(incidenteService.listar(isNull(), isNull(), isNull(), isNull(), isNull(), isNull(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(), PageRequest.of(0, 20), 0));
        when(notificacaoService.listar(isNull(), isNull(), isNull(), isNull(), isNull(), isNull(), isNull(), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(), PageRequest.of(0, 20), 0));

        for (String endpoint : List.of("/api/v1/equipamentos", "/api/v1/monitores", "/api/v1/medicoes",
                "/api/v1/incidentes", "/api/v1/notificacoes")) {
            mockMvc.perform(get(endpoint))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content").isEmpty())
                    .andExpect(jsonPath("$.page").value(0))
                    .andExpect(jsonPath("$.totalElements").value(0))
                    .andExpect(jsonPath("$.totalPages").value(0))
                    .andExpect(jsonPath("$.first").value(true))
                    .andExpect(jsonPath("$.last").value(true));
        }
    }
}

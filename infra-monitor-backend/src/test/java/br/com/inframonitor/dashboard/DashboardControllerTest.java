package br.com.inframonitor.dashboard;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.dashboard.dto.DashboardEquipamentoResponse;
import br.com.inframonitor.dashboard.dto.DashboardResumoResponse;
import br.com.inframonitor.dashboard.dto.DashboardUnidadeDetalheResponse;
import br.com.inframonitor.dashboard.dto.DashboardUnidadeResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
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

@WebMvcTest(DashboardController.class)
class DashboardControllerTest {
    @Autowired MockMvc mockMvc;
    @MockitoBean DashboardService dashboardService;

    @Test void expoeResumoUnidadesDetalheEPaginaDeEquipamentos() throws Exception {
        when(dashboardService.resumo()).thenReturn(new DashboardResumoResponse(
                new DashboardResumoResponse.Unidades(2), new DashboardResumoResponse.Equipamentos(4, 3, 2, 1, 0, 0),
                new DashboardResumoResponse.Monitores(3, 3, 2, 1, 0), new DashboardResumoResponse.Incidentes(1), Instant.parse("2026-08-19T12:00:00Z")));
        var unidade = new DashboardUnidadeResponse(1L, "Matriz", true, StatusOperacionalUnidade.DISPONIVEL, 2, 2, 2, 0, 0, 0, 0);
        when(dashboardService.unidades()).thenReturn(List.of(unidade));
        when(dashboardService.unidade(1L)).thenReturn(new DashboardUnidadeDetalheResponse(1L, "Matriz", true, StatusOperacionalUnidade.DISPONIVEL,
                new DashboardUnidadeDetalheResponse.Equipamentos(2, 2, 2, 0, 0, 0), new DashboardUnidadeDetalheResponse.Monitores(2, 0), 0));
        var equipamento = new DashboardEquipamentoResponse(10L, "SW-CORE", "10.0.0.1", "Rack 1", true,
                StatusOperacionalEquipamento.DISPONIVEL, new DashboardEquipamentoResponse.TipoEquipamento(2L, "Switch"), 1, 0, null);
        when(dashboardService.equipamentosDaUnidade(eq(1L), eq(2L), eq(true), any(Pageable.class))).thenReturn(new PageImpl<>(List.of(equipamento)));

        mockMvc.perform(get("/api/v1/dashboard/resumo")).andExpect(status().isOk()).andExpect(jsonPath("$.equipamentos.indisponiveis").value(1));
        mockMvc.perform(get("/api/v1/dashboard/unidades")).andExpect(status().isOk()).andExpect(jsonPath("$[0].status").value("DISPONIVEL"));
        mockMvc.perform(get("/api/v1/dashboard/unidades/1")).andExpect(status().isOk()).andExpect(jsonPath("$.monitores.ativos").value(2));
        mockMvc.perform(get("/api/v1/dashboard/unidades/1/equipamentos?tipoEquipamentoId=2&ativo=true&page=0&size=20"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content[0].tipoEquipamento.nome").value("Switch"));
    }

    @Test void unidadeInexistenteRetorna404() throws Exception {
        when(dashboardService.unidade(99999L)).thenThrow(new RecursoNaoEncontradoException("Unidade nao encontrada"));
        mockMvc.perform(get("/api/v1/dashboard/unidades/99999")).andExpect(status().isNotFound());
    }
}

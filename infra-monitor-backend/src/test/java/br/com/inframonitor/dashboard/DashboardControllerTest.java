package br.com.inframonitor.dashboard;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.dashboard.dto.DashboardEquipamentoResponse;
import br.com.inframonitor.dashboard.dto.DashboardEquipamentoListaResponse;
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

import java.math.BigDecimal;
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
    @MockitoBean DashboardIncidenteService dashboardIncidenteService;

    @Test void expoeResumoUnidadesDetalheEPaginaDeEquipamentos() throws Exception {
        when(dashboardService.resumo()).thenReturn(new DashboardResumoResponse(
                new DashboardResumoResponse.Unidades(2), new DashboardResumoResponse.Equipamentos(4, 3, 2, 1, 1, 0, 0, 0),
                new DashboardResumoResponse.Monitores(3, 3, 2, 0, 1, 0), new DashboardResumoResponse.Incidentes(1), 250, Instant.parse("2026-08-19T12:00:00Z")));
        var unidade = new DashboardUnidadeResponse(1L, "Matriz", "2800308", true, StatusOperacionalUnidade.DISPONIVEL, 2, 2, 2, 0, 0, 0, 0, 0, 0,
                new BigDecimal("-10.947200"), new BigDecimal("-37.073500"));
        when(dashboardService.unidades()).thenReturn(List.of(unidade));
        when(dashboardService.unidade(1L)).thenReturn(new DashboardUnidadeDetalheResponse(1L, "Matriz", "2800308", true, StatusOperacionalUnidade.DISPONIVEL,
                new DashboardUnidadeDetalheResponse.Equipamentos(2, 2, 2, 0, 0, 0, 0, 0), new DashboardUnidadeDetalheResponse.Monitores(2, 0), 0));
        var equipamento = new DashboardEquipamentoResponse(10L, "SW-CORE", "10.0.0.1", "Rack 1", true,
                StatusOperacionalEquipamento.DISPONIVEL, new DashboardEquipamentoResponse.TipoEquipamento(2L, "Switch"), false, 1, 0, null, "sw-core.rede.local");
        when(dashboardService.equipamentosDaUnidade(eq(1L), eq(2L), eq(true), any(Pageable.class))).thenReturn(new PageImpl<>(List.of(equipamento)));

        mockMvc.perform(get("/api/v1/dashboard/resumo")).andExpect(status().isOk()).andExpect(jsonPath("$.equipamentos.indisponiveis").value(1));
        mockMvc.perform(get("/api/v1/dashboard/unidades")).andExpect(status().isOk()).andExpect(jsonPath("$[0].status").value("DISPONIVEL")).andExpect(jsonPath("$[0].codigoIbge").value("2800308"))
                .andExpect(jsonPath("$[0].latitude").value(-10.9472)).andExpect(jsonPath("$[0].longitude").value(-37.0735));
        mockMvc.perform(get("/api/v1/dashboard/unidades/1")).andExpect(status().isOk()).andExpect(jsonPath("$.monitores.ativos").value(2)).andExpect(jsonPath("$.codigoIbge").value("2800308"));
        mockMvc.perform(get("/api/v1/dashboard/unidades/1/equipamentos?tipoEquipamentoId=2&ativo=true&page=0&size=20"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content[0].tipoEquipamento.nome").value("Switch"))
                .andExpect(jsonPath("$.content[0].hostname").value("sw-core.rede.local"))
                .andExpect(jsonPath("$.content[0].ip").value("10.0.0.1"))
                .andExpect(jsonPath("$.content[0].emManutencao").value(false))
                .andExpect(jsonPath("$.content[0].monitoresAtivos").value(1));
    }

    @Test void expoeInventarioCompletoSemPaginacao() throws Exception {
        when(dashboardService.equipamentos()).thenReturn(List.of(
                new DashboardEquipamentoListaResponse(10L, "SW-CORE", "Switch", 1L, "Matriz", "sw-core.rede.local",
                        "10.0.0.1", StatusOperacionalEquipamento.DISPONIVEL, 13, true, "Rack 03", "SN-0001"),
                new DashboardEquipamentoListaResponse(11L, "SW-BORDA", "Switch", 2L, "Filial", null, null,
                        StatusOperacionalEquipamento.INDISPONIVEL, null, false, null, null)));

        mockMvc.perform(get("/api/v1/dashboard/equipamentos")).andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].nome").value("SW-CORE"))
                .andExpect(jsonPath("$[0].tipoNome").value("Switch"))
                .andExpect(jsonPath("$[0].unidadeId").value(1))
                .andExpect(jsonPath("$[0].unidadeNome").value("Matriz"))
                .andExpect(jsonPath("$[0].hostname").value("sw-core.rede.local"))
                .andExpect(jsonPath("$[0].ip").value("10.0.0.1"))
                .andExpect(jsonPath("$[0].status").value("DISPONIVEL"))
                .andExpect(jsonPath("$[0].latenciaMs").value(13))
                .andExpect(jsonPath("$[0].ativo").value(true))
                // Offline: sem latencia. A tela renderiza "timeout" a partir desta combinacao.
                .andExpect(jsonPath("$[1].latenciaMs").doesNotExist())
                .andExpect(jsonPath("$[1].status").value("INDISPONIVEL"))
                .andExpect(jsonPath("$[1].ativo").value(false))
                // Localizacao e numero de serie entram no read-model porque a busca da tela
                // filtra por eles em memoria.
                .andExpect(jsonPath("$[0].localizacao").value("Rack 03"))
                .andExpect(jsonPath("$[0].numeroSerie").value("SN-0001"))
                // Descricao continua fora: texto longo que so o formulario de edicao usa.
                .andExpect(jsonPath("$[0].descricao").doesNotExist());
    }

    @Test void unidadeInexistenteRetorna404() throws Exception {
        when(dashboardService.unidade(99999L)).thenThrow(new RecursoNaoEncontradoException("Unidade nao encontrada"));
        mockMvc.perform(get("/api/v1/dashboard/unidades/99999")).andExpect(status().isNotFound());
    }

    @Test void expoeCodigoIbgeNuloQuandoUnidadeNaoFoiGeorreferenciada() throws Exception {
        when(dashboardService.unidades()).thenReturn(List.of(
                new DashboardUnidadeResponse(2L, "Filial", null, true, StatusOperacionalUnidade.SEM_EQUIPAMENTOS,
                        0, 0, 0, 0, 0, 0, 0, 0, 0, null, null)));

        mockMvc.perform(get("/api/v1/dashboard/unidades"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].codigoIbge").value(org.hamcrest.Matchers.nullValue()));
    }

    /**
     * Coordenada ausente e o estado normal do cadastro hoje, nao um erro: o campo tem de sair no
     * JSON como null, e nunca como 0 — (0,0) e uma posicao valida no Golfo da Guine, e um marcador
     * plotado ali seria indistinguivel de dado real.
     */
    @Test void expoeCoordenadaNulaSemSubstituirPorZero() throws Exception {
        when(dashboardService.unidades()).thenReturn(List.of(
                new DashboardUnidadeResponse(2L, "Filial", "2800308", true, StatusOperacionalUnidade.SEM_EQUIPAMENTOS,
                        0, 0, 0, 0, 0, 0, 0, 0, 0, null, null)));

        mockMvc.perform(get("/api/v1/dashboard/unidades"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].latitude").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$[0].longitude").value(org.hamcrest.Matchers.nullValue()));
    }

    /** hostname e campo adicional e opcional: ausencia no cadastro nao pode virar erro nem sumir do payload. */
    @Test void expoeHostnameNuloQuandoEquipamentoNaoTemHostname() throws Exception {
        var equipamento = new DashboardEquipamentoResponse(11L, "AP-01", "10.0.0.2", null, true,
                StatusOperacionalEquipamento.SEM_MONITORAMENTO, new DashboardEquipamentoResponse.TipoEquipamento(3L, "Access Point"), false, 0, 0, null, null);
        when(dashboardService.equipamentosDaUnidade(eq(1L), any(), any(), any(Pageable.class))).thenReturn(new PageImpl<>(List.of(equipamento)));

        mockMvc.perform(get("/api/v1/dashboard/unidades/1/equipamentos"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].hostname").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.content[0].nome").value("AP-01"));
    }
}

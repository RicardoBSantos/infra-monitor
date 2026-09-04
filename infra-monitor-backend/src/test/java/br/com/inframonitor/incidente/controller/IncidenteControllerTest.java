package br.com.inframonitor.incidente.controller;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.incidente.dto.CloseIncidenteRequest;
import br.com.inframonitor.incidente.dto.CreateIncidenteRequest;
import br.com.inframonitor.incidente.dto.IncidenteResponse;
import br.com.inframonitor.incidente.dto.MonitorIncidenteResponse;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.service.IncidenteService;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import br.com.inframonitor.security.UsuarioPrincipal;
import br.com.inframonitor.usuario.entity.Papel;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.data.domain.PageImpl;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(IncidenteController.class)
@Import(IncidenteControllerTest.ResolverDePrincipal.class)
class IncidenteControllerTest {

    /**
     * @WebMvcTest nao carrega SecurityConfiguration, e sem ela o resolver de
     * @AuthenticationPrincipal nao existe: o UsuarioPrincipal do metodo seria tratado
     * como @ModelAttribute e a requisicao morreria em 400 antes de chegar ao controller.
     * Quem valida a permissao continua sendo o matcher de SecurityConfiguration.
     */
    @TestConfiguration
    static class ResolverDePrincipal implements WebMvcConfigurer {
        @Override
        public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
            resolvers.add(new AuthenticationPrincipalArgumentResolver());
        }
    }

    private static final IncidenteResponse INCIDENTE = new IncidenteResponse(1L, StatusIncidente.ABERTO,
            Instant.parse("2026-08-19T12:00:00Z"), null, "Indisponibilidade", null, null, null, null,
            new MonitorIncidenteResponse(10L, "ICMP principal", TipoMonitor.ICMP, 20L, "SW-01", 30L, "Matriz"),
            Instant.parse("2026-08-19T12:00:00Z"), Instant.parse("2026-08-19T12:00:00Z"));

    @Autowired private MockMvc mockMvc;
    @MockitoBean private IncidenteService incidenteService;

    /**
     * O resolver le o principal do SecurityContextHolder, entao o teste precisa
     * autenticar alguem. Sem isso o controller receberia null e as acoes com autor
     * quebrariam so em producao — foi assim que reconhecer chegou ao banco sem autor.
     */
    @BeforeEach
    void autenticar() {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new UsuarioPrincipal(7L, Papel.OPERADOR), null, List.of()));
    }

    @AfterEach
    void limparContexto() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void criaConsultaEFiltra() throws Exception {
        when(incidenteService.criar(any(CreateIncidenteRequest.class))).thenReturn(INCIDENTE);
        when(incidenteService.buscarPorId(1L)).thenReturn(INCIDENTE);
        when(incidenteService.listar(eq(10L), eq(20L), eq(30L), eq(StatusIncidente.ABERTO), any(), any(), any()))
                .thenReturn(new PageImpl<>(List.of(INCIDENTE)));

        mockMvc.perform(post("/api/v1/incidentes").contentType(MediaType.APPLICATION_JSON).content(criacaoJson()))
                .andExpect(status().isCreated()).andExpect(header().string("Location", "http://localhost/api/v1/incidentes/1"));
        mockMvc.perform(get("/api/v1/incidentes/1")).andExpect(status().isOk())
                .andExpect(jsonPath("$.monitor.equipamentoNome").value("SW-01"));
        mockMvc.perform(get("/api/v1/incidentes?monitorId=10&equipamentoId=20&unidadeId=30&status=ABERTO&inicio=2026-08-19T00:00:00Z&fim=2026-08-20T00:00:00Z"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content[0].id").value(1));
    }

    @Test
    void retornaErrosDeDominioEDeEntrada() throws Exception {
        when(incidenteService.criar(any(CreateIncidenteRequest.class))).thenThrow(new ConflitoException("Ja existe incidente aberto"));
        when(incidenteService.buscarPorId(99L)).thenThrow(new RecursoNaoEncontradoException("Incidente nao encontrado"));
        when(incidenteService.fechar(eq(1L), any(CloseIncidenteRequest.class), eq(7L)))
                .thenThrow(new IllegalArgumentException("encerradoEm deve ser maior ou igual a iniciadoEm"));
        when(incidenteService.fechar(eq(99L), any(CloseIncidenteRequest.class), eq(7L)))
                .thenThrow(new RecursoNaoEncontradoException("Incidente nao encontrado"));

        mockMvc.perform(post("/api/v1/incidentes").contentType(MediaType.APPLICATION_JSON).content(criacaoJson()))
                .andExpect(status().isConflict());
        mockMvc.perform(get("/api/v1/incidentes/99")).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/incidentes?status=INVALIDO")).andExpect(status().isBadRequest());
        mockMvc.perform(patch("/api/v1/incidentes/1/fechar").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"encerradoEm\":\"2026-08-19T11:00:00Z\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(patch("/api/v1/incidentes/99/fechar").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"encerradoEm\":\"2026-08-19T12:05:00Z\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void reconheceERecusaTransicaoInvalida() throws Exception {
        IncidenteResponse reconhecido = new IncidenteResponse(1L, StatusIncidente.RECONHECIDO,
                Instant.parse("2026-08-19T12:00:00Z"), null, "Indisponibilidade", null,
                Instant.parse("2026-08-19T12:05:00Z"), "Operador", null,
                new MonitorIncidenteResponse(10L, "ICMP principal", TipoMonitor.ICMP, 20L, "SW-01", 30L, "Matriz"),
                Instant.parse("2026-08-19T12:00:00Z"), Instant.parse("2026-08-19T12:05:00Z"));
        when(incidenteService.reconhecer(eq(1L), any())).thenReturn(reconhecido);
        when(incidenteService.reconhecer(eq(2L), any()))
                .thenThrow(new ConflitoException("O incidente ja foi fechado e nao pode mais ser reconhecido"));
        when(incidenteService.reconhecer(eq(99L), any()))
                .thenThrow(new RecursoNaoEncontradoException("Incidente nao encontrado"));

        // Sem corpo: quem e quando saem do servidor.
        mockMvc.perform(patch("/api/v1/incidentes/1/reconhecer")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("RECONHECIDO"))
                .andExpect(jsonPath("$.reconhecidoPorNome").value("Operador"));
        mockMvc.perform(patch("/api/v1/incidentes/2/reconhecer")).andExpect(status().isConflict());
        mockMvc.perform(patch("/api/v1/incidentes/99/reconhecer")).andExpect(status().isNotFound());
        // O id do autor vem do principal autenticado, nunca do corpo ou da URL.
        verify(incidenteService).reconhecer(1L, 7L);
    }

    private String criacaoJson() {
        return "{\"monitorId\":10,\"iniciadoEm\":\"2026-08-19T12:00:00Z\",\"motivo\":\"Indisponibilidade\"}";
    }
}

package br.com.inframonitor.common.config;

import br.com.inframonitor.equipamento.controller.EquipamentoController;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.http.HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN;
import static org.springframework.http.HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD;
import static org.springframework.http.HttpHeaders.ORIGIN;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(EquipamentoController.class)
@Import(CorsConfiguration.class)
@TestPropertySource(properties = "app.cors.allowed-origins[0]=http://localhost:4200")
class CorsConfigurationTest {
    @Autowired MockMvc mockMvc;
    @MockitoBean EquipamentoService equipamentoService;

    @Test
    void permitePreflightDaOrigemConfigurada() throws Exception {
        mockMvc.perform(options("/api/v1/equipamentos")
                        .header(ORIGIN, "http://localhost:4200")
                        .header(ACCESS_CONTROL_REQUEST_METHOD, "POST"))
                .andExpect(status().isOk())
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:4200"));
    }

    @Test
    void naoRetornaHeaderParaOrigemNaoConfigurada() throws Exception {
        mockMvc.perform(options("/api/v1/equipamentos")
                        .header(ORIGIN, "https://origem-nao-permitida.example")
                        .header(ACCESS_CONTROL_REQUEST_METHOD, "POST"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist(ACCESS_CONTROL_ALLOW_ORIGIN));
    }
}

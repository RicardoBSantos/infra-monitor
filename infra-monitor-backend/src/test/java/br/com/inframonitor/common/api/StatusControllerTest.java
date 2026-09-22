package br.com.inframonitor.common.api;

import br.com.inframonitor.monitoring.icmp.CargaNativa;
import br.com.inframonitor.monitoring.icmp.IcmpAmbiente;
import br.com.inframonitor.monitoring.icmp.IcmpImplementacao;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(StatusController.class)
@Import(StatusControllerTest.AmbienteDeTeste.class)
class StatusControllerTest {

    @TestConfiguration
    static class AmbienteDeTeste {
        @Bean
        IcmpAmbiente icmpAmbiente() {
            return new IcmpAmbiente(IcmpImplementacao.AUTO, IcmpImplementacao.NATIVO_WINDOWS,
                    CargaNativa.NAO_TENTADA, null, false, null);
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Test
    void respondeNoPrefixoDaApi() throws Exception {
        mockMvc.perform(get("/api/v1/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.aplicacao").value("infra-monitor-backend"))
                .andExpect(jsonPath("$.status").value("UP"))
                // Instant serializado como ISO-8601 em UTC, e nao como numero.
                .andExpect(jsonPath("$.instante").value(Matchers.endsWith("Z")));
    }

    @Test
    void rotaDesconhecidaRetorna404NoFormatoPadrao() throws Exception {
        mockMvc.perform(get("/api/v1/inexistente"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.error").value("Not Found"))
                .andExpect(jsonPath("$.path").value("/api/v1/inexistente"));
    }

    @Test
    @DisplayName("o bloco icmp mostra a implementacao ativa e o estado da carga nativa")
    void exibeAImplementacaoIcmp() throws Exception {
        mockMvc.perform(get("/api/v1/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.icmp.ativa").value("NATIVO_WINDOWS"))
                .andExpect(jsonPath("$.icmp.pedida").value("AUTO"))
                .andExpect(jsonPath("$.icmp.cargaNativa").value("NAO_TENTADA"))
                .andExpect(jsonPath("$.icmp.motorLigado").value(false));
    }
}

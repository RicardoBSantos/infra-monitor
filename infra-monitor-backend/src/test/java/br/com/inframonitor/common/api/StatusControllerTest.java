package br.com.inframonitor.common.api;

import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(StatusController.class)
class StatusControllerTest {

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
}

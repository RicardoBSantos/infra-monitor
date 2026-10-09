package br.com.inframonitor.common.config;

import br.com.inframonitor.common.api.StatusController;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.http.HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS;
import static org.springframework.http.HttpHeaders.ACCESS_CONTROL_ALLOW_HEADERS;
import static org.springframework.http.HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN;
import static org.springframework.http.HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD;
import static org.springframework.http.HttpHeaders.ORIGIN;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(StatusController.class)
@Import(CorsConfiguration.class)
@TestPropertySource(properties = "app.cors.allowed-origins=http://localhost:4200,http://127.0.0.1:4200")
class CorsConfigurationTest {
    @Autowired MockMvc mockMvc;

    @Test
    void permiteRequestDeLocalhost() throws Exception {
        mockMvc.perform(get("/api/v1/status").header(ORIGIN, "http://localhost:4200"))
                .andExpect(status().isOk())
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:4200"));
    }

    @Test
    void permiteRequestDe127001() throws Exception {
        mockMvc.perform(get("/api/v1/status").header(ORIGIN, "http://127.0.0.1:4200"))
                .andExpect(status().isOk())
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_ORIGIN, "http://127.0.0.1:4200"));
    }

    @Test
    void permitePreflightDe127001() throws Exception {
        mockMvc.perform(options("/api/v1/status")
                        .header(ORIGIN, "http://127.0.0.1:4200")
                        .header(ACCESS_CONTROL_REQUEST_METHOD, "POST"))
                .andExpect(status().isOk())
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_ORIGIN, "http://127.0.0.1:4200"))
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_METHODS, org.hamcrest.Matchers.containsString("POST")));

        mockMvc.perform(options("/api/v1/status")
                        .header(ORIGIN, "http://127.0.0.1:4200")
                        .header(ACCESS_CONTROL_REQUEST_METHOD, "POST")
                        .header("Access-Control-Request-Headers", "Authorization"))
                .andExpect(status().isOk())
                .andExpect(header().string(ACCESS_CONTROL_ALLOW_HEADERS, org.hamcrest.Matchers.containsString("Authorization")));
    }

    @Test
    void rejeitaOrigemNaoConfigurada() throws Exception {
        mockMvc.perform(options("/api/v1/status")
                        .header(ORIGIN, "http://example.com")
                        .header(ACCESS_CONTROL_REQUEST_METHOD, "POST"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist(ACCESS_CONTROL_ALLOW_ORIGIN));
    }
}

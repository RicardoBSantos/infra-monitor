package br.com.inframonitor.common.api;

import br.com.inframonitor.medicao.controller.MedicaoController;
import br.com.inframonitor.medicao.service.MedicaoService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(MedicaoController.class)
class ApiErrorContractTest {
    @Autowired MockMvc mockMvc;
    @MockitoBean MedicaoService medicaoService;

    @Test
    void enumInvalidoEmFiltroRetornaCodigoEstavel() throws Exception {
        mockMvc.perform(get("/api/v1/medicoes?status=INVALIDO"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_ENUM"));
    }

    @Test
    void jsonMalformadoNaoExpoeDetalhesDoJackson() throws Exception {
        mockMvc.perform(post("/api/v1/medicoes").contentType(MediaType.APPLICATION_JSON).content("{\"monitorId\":"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"))
                .andExpect(jsonPath("$.message").value("Corpo da requisicao invalido"));
    }
}

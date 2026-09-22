package br.com.inframonitor.common.api;

import br.com.inframonitor.monitoring.icmp.CargaNativa;
import br.com.inframonitor.monitoring.icmp.IcmpAmbiente;
import br.com.inframonitor.monitoring.icmp.IcmpImplementacao;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;

/**
 * Endpoint minimo de infraestrutura: prova que a API responde no prefixo /api/v1
 * e diz qual implementacao ICMP este processo resolveu na subida.
 * Diagnostico completo (banco, disco) fica no Actuator em /actuator/health.
 */
@RestController
@RequestMapping("/api/v1")
public class StatusController {

    private final String aplicacao;
    private final ObjectProvider<IcmpAmbiente> ambiente;

    /**
     * ObjectProvider, e nao dependencia obrigatoria: @WebMvcTest nao carrega as
     * @Configuration de dominio, e exigir o bean quebraria o teste de fatia
     * deste controller sem ganho nenhum.
     */
    public StatusController(@Value("${spring.application.name}") String aplicacao,
                            ObjectProvider<IcmpAmbiente> ambiente) {
        this.aplicacao = aplicacao;
        this.ambiente = ambiente;
    }

    @GetMapping("/status")
    public StatusResposta status() {
        IcmpAmbiente resolvido = ambiente.getIfAvailable();
        IcmpResposta icmp = resolvido == null ? null
                : new IcmpResposta(resolvido.pedida(), resolvido.ativa(), resolvido.cargaNativa(),
                        resolvido.detalheFalha(), resolvido.motorLigado());
        return new StatusResposta(aplicacao, "UP", Instant.now(), icmp);
    }

    public record StatusResposta(String aplicacao, String status, Instant instante, IcmpResposta icmp) {
    }

    public record IcmpResposta(IcmpImplementacao pedida, IcmpImplementacao ativa, CargaNativa cargaNativa,
                               String detalheFalha, boolean motorLigado) {
    }
}

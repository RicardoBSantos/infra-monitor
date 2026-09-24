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
 * Diz qual implementacao ICMP este processo resolveu na subida. Nao e' um endpoint
 * publico: exige token com role ADMIN, OPERADOR ou VISUALIZADOR, igual a qualquer
 * outro endpoint de negocio sob /api/v1 (ver SecurityConfiguration).
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
                        resolvido.motorLigado());
        return new StatusResposta(aplicacao, "UP", Instant.now(), icmp);
    }

    public record StatusResposta(String aplicacao, String status, Instant instante, IcmpResposta icmp) {
    }

    /**
     * detalheFalha propositalmente fora daqui: a mensagem crua do Native.load carrega o
     * resource path completo do sistema de arquivos (ex.: C:\Users\<usuario>\...), e este
     * endpoint e' acessivel a ADMIN, OPERADOR e VISUALIZADOR. O detalhe continua existindo
     * em IcmpAmbiente e sendo logado na subida; cargaNativa=FALHOU ja sinaliza o problema
     * por aqui, e quem precisa do detalhe le o log.
     */
    public record IcmpResposta(IcmpImplementacao pedida, IcmpImplementacao ativa, CargaNativa cargaNativa,
                               boolean motorLigado) {
    }
}

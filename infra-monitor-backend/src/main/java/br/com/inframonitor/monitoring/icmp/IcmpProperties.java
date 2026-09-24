package br.com.inframonitor.monitoring.icmp;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("monitoring.icmp")
public class IcmpProperties {

    /** auto | nativo-windows | processo-ping. Valvula de escape se o nativo falhar em producao. */
    private IcmpImplementacao implementacao = IcmpImplementacao.AUTO;

    public IcmpImplementacao getImplementacao() {
        return implementacao;
    }

    public void setImplementacao(IcmpImplementacao implementacao) {
        this.implementacao = implementacao;
    }
}

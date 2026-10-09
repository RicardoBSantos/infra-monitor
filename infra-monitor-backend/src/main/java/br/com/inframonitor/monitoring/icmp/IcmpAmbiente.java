package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitoring.icmp.nativo.Iphlpapi;

/**
 * O que foi pedido, o que ficou ativo e se a biblioteca nativa carregou.
 *
 * <p>{@code pedida} e {@code ativa} sao campos distintos de proposito: sem eles,
 * um {@code auto} que caiu para processo-ping fica indistinguivel de um
 * processo-ping configurado de proposito, e a queda some do diagnostico.
 *
 * <p>{@code nativo} e a ligacao ja carregada, entregue ao runner. Nao e'
 * serializado: StatusController monta o proprio DTO.
 */
public record IcmpAmbiente(IcmpImplementacao pedida, IcmpImplementacao ativa, CargaNativa cargaNativa,
                           String detalheFalha, boolean motorLigado, Iphlpapi nativo) {
}

package br.com.inframonitor.dashboard.dto;

import br.com.inframonitor.dashboard.StatusOperacionalEquipamento;

/**
 * Linha do inventario completo em /dashboard/equipamentos.
 *
 * <p>{@code localizacao} e {@code numeroSerie} entram aqui porque a busca da tela cobre os
 * dois e a filtragem e em memoria: sem eles carregados, o campo de busca prometeria um
 * filtro que nao existe. {@code descricao} continua de fora — e texto longo, so o
 * formulario de edicao precisa dele, e ele chega por GET /equipamentos/{id}.
 *
 * <p>Distinto de {@link DashboardEquipamentoResponse}, que atende a aba de equipamentos da
 * unidade e permanece inalterado.
 */
public record DashboardEquipamentoListaResponse(Long id, String nome, String tipoNome, Long unidadeId,
                                                String unidadeNome, String hostname, String ip,
                                                StatusOperacionalEquipamento status, Integer latenciaMs,
                                                boolean ativo, String localizacao, String numeroSerie) {
}

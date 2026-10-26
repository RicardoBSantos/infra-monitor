package br.com.inframonitor.dashboard.dto;

import br.com.inframonitor.dashboard.StatusOperacionalEquipamento;

import java.time.Instant;

/**
 * Linha do inventario completo em /dashboard/equipamentos.
 *
 * <p>{@code localizacao} e {@code numeroSerie} entram aqui porque a busca da tela cobre os
 * dois e a filtragem e em memoria: sem eles carregados, o campo de busca prometeria um
 * filtro que nao existe. {@code descricao} continua de fora — e texto longo, so o
 * formulario de edicao precisa dele, e ele chega por GET /equipamentos/{id}.
 *
 * <p>{@code emManutencao} vem separado do {@code status} porque {@code DESABILITADO} tem precedencia
 * sobre {@code EM_MANUTENCAO} no resolver: a tela precisa do flag para oferecer "Encerrar manutencao"
 * a equipamento inativo.
 *
 * <p>Origem da manutencao: {@code emManutencao} e o estado efetivo (botao manual OU janela ativa).
 * {@code manutencaoManual} diz se o botao esta ligado. {@code janelaAtivaId} e {@code janelaAtivaFim}
 * identificam a janela ATIVA que cobre o equipamento (a de maior fim, se houver varias) e sao nulos
 * quando nenhuma cobre. Manual e janela podem coexistir.
 *
 * <p>Distinto de {@link DashboardEquipamentoResponse}, que atende a aba de equipamentos da
 * unidade e permanece inalterado.
 */
public record DashboardEquipamentoListaResponse(Long id, String nome, String tipoNome, Long unidadeId,
                                                String unidadeNome, String hostname, String ip,
                                                StatusOperacionalEquipamento status, Integer latenciaMs,
                                                boolean ativo, String localizacao, String numeroSerie,
                                                boolean emManutencao, boolean manutencaoManual,
                                                Long janelaAtivaId, Instant janelaAtivaFim) {
}

package br.com.inframonitor.dashboard.dto;

import br.com.inframonitor.dashboard.StatusOperacionalUnidade;

import java.math.BigDecimal;

/**
 * Linha do read-model de unidades do dashboard.
 *
 * <p>{@code latitude} e {@code longitude} sao aditivas e anulaveis: o cadastro nao as exige, e o
 * mapa so plota a unidade quando as duas vierem preenchidas. Campos novos entram sempre no FIM do
 * record — a projecao nativa e lida por posicao em {@code Object[]}, e inserir no meio trocaria
 * colunas em silencio, sem erro de compilacao.
 */
public record DashboardUnidadeResponse(Long id, String nome, String codigoIbge, boolean ativo, StatusOperacionalUnidade status,
                                       long equipamentosTotal, long equipamentosAtivos, long equipamentosDisponiveis,
                                       long equipamentosDegradados, long equipamentosIndisponiveis, long equipamentosSemDados,
                                       long equipamentosSemMonitoramento, long equipamentosEmManutencao,
                                       long incidentesAbertos,
                                       BigDecimal latitude, BigDecimal longitude) { }

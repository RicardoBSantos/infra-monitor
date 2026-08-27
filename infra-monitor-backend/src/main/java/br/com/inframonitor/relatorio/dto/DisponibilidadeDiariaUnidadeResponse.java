package br.com.inframonitor.relatorio.dto;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * Disponibilidade de uma unidade agregada por dia do calendario local.
 * Dias sem monitoramento nao entram na serie: ausencia nao e zero.
 * {@code tempoMonitoradoSegundos} permite ao cliente identificar o dia parcial.
 */
public record DisponibilidadeDiariaUnidadeResponse(LocalDate data, BigDecimal disponibilidadePercentual,
        Long tempoMonitoradoSegundos) { }

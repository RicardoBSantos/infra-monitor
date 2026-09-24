package br.com.inframonitor.relatorio.dto;

/**
 * Os tres indicadores globais da Visao Geral. Contrato proprio, e nao o record aninhado do
 * modelo do PDF: aquele e interno ao pacote pdf e renomear um campo la nao pode quebrar a
 * tela em silencio. A contagem por tras dos dois e a mesma query.
 *
 * <p>incidentesAbertos conta ABERTO e RECONHECIDO — reconhecer um incidente nao o encerra.
 */
public record IndicadoresVisaoGeralResponse(long incidentesAbertos, long medicoesComFalha,
        long notificacoesComFalha) { }

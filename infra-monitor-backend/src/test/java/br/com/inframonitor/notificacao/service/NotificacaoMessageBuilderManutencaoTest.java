package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.manutencao.entity.EscopoManutencao;
import br.com.inframonitor.notificacao.service.DadosAnuncio.EntregaInicio;
import br.com.inframonitor.notificacao.service.DadosAnuncio.Janela;
import br.com.inframonitor.notificacao.service.DadosAnuncio.JanelaVigente;
import br.com.inframonitor.notificacao.service.DadosAnuncio.Manual;
import br.com.inframonitor.notificacao.service.DadosAnuncio.Seguinte;
import br.com.inframonitor.notificacao.service.DadosAnuncio.Termino;
import br.com.inframonitor.notificacao.service.DadosAnuncio.TipoTermino;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class NotificacaoMessageBuilderManutencaoTest {

    private final NotificacaoMessageBuilder builder = new NotificacaoMessageBuilder("America/Sao_Paulo");

    /** Hora local (UTC-03:00) do dia 26/10/2026. */
    private static Instant t(int hora, int minuto) {
        return Instant.parse("2026-10-26T00:00:00Z").plusSeconds((hora + 3) * 3600L + minuto * 60L);
    }

    private static Janela unidadeInteira() {
        return new Janela(41, "Sesc Socorro", EscopoManutencao.UNIDADE, 20, List.of(),
                "Troca do switch core", t(8, 0), t(12, 0), "Ricardo Barbosa");
    }

    private static Janela equipamentos(List<String> nomes) {
        return new Janela(41, "Sesc Socorro", EscopoManutencao.EQUIPAMENTOS, nomes.size(), nomes,
                "Troca do switch core", t(8, 0), t(12, 0), "Ricardo Barbosa");
    }

    private static Manual manual(String ip, Instant inicio, String autor) {
        return new Manual(7, "Sesc Socorro", "Servidor  Gateway", ip, inicio, autor);
    }

    @Test
    void inicioUnidadeInteira() {
        assertThat(builder.construirInicioJanela(unidadeInteira(), t(8, 0), false)).isEqualTo("""
                🔧 MANUTENÇÃO INICIADA — alertas suspensos

                Unidade: Sesc Socorro
                Escopo: unidade inteira (20 equipamentos)
                Motivo: Troca do switch core
                Início: 26/10/2026 08:00
                Fim previsto: 26/10/2026 12:00
                Agendada por: Ricardo Barbosa
                Janela: #41
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void inicioUnidadeVazia() {
        Janela j = new Janela(41, "Sesc Socorro", EscopoManutencao.UNIDADE, 0, List.of(),
                "Troca do switch core", t(8, 0), t(12, 0), "Ricardo Barbosa");
        assertThat(builder.construirInicioJanela(j, t(8, 0), false))
                .contains("\nEscopo: unidade inteira (nenhum equipamento cadastrado)\n");
    }

    @Test
    void inicioUmEquipamento() {
        assertThat(builder.construirInicioJanela(equipamentos(List.of("AD2")), t(8, 0), false))
                .contains("\nEscopo: 1 equipamento — AD2\n");
    }

    @Test
    void inicioSeteEquipamentosMostraCincoEMaisDois() {
        Janela j = equipamentos(List.of("AD2", "Gateway", "Switch", "NVR", "AP-01", "AP-02", "AP-03"));
        assertThat(builder.construirInicioJanela(j, t(8, 0), false))
                .contains("\nEscopo: 7 equipamentos — AD2, Gateway, Switch, NVR, AP-01 e mais 2\n");
    }

    @Test
    void inicioAtrasado() {
        assertThat(builder.construirInicioJanela(unidadeInteira(), t(8, 17), true)).isEqualTo("""
                🔧 MANUTENÇÃO INICIADA — alertas suspensos

                Unidade: Sesc Socorro
                Escopo: unidade inteira (20 equipamentos)
                Motivo: Troca do switch core
                Início: 26/10/2026 08:17 (previsto 08:00 — sistema esteve fora)
                Fim previsto: 26/10/2026 12:00
                Agendada por: Ricardo Barbosa
                Janela: #41
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void fimComoPrevisto() {
        Termino termino = new Termino(TipoTermino.COMO_PREVISTO, null, t(12, 0), t(12, 0));
        assertThat(builder.construirFimJanela(unidadeInteira(), t(8, 0), t(12, 0), termino, List.of(),
                EntregaInicio.ENTREGUE)).isEqualTo("""
                ✅ MANUTENÇÃO ENCERRADA — alertas retomados

                Unidade: Sesc Socorro
                Escopo: unidade inteira (20 equipamentos)
                Motivo: Troca do switch core
                Período: 26/10/2026 08:00 → 26/10/2026 12:00 (4h 0m 0s)
                Término: como previsto
                Janela: #41
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void fimAntecipadoComSeguinteEInicioNaoEntregue() {
        Termino termino = new Termino(TipoTermino.ANTECIPADO, "Fulano", t(12, 0), t(11, 20));
        assertThat(builder.construirFimJanela(unidadeInteira(), t(8, 0), t(11, 20), termino,
                List.of(new Seguinte("Switch CPD", null)), EntregaInicio.NAO_ENTREGUE)).isEqualTo("""
                ✅ MANUTENÇÃO ENCERRADA — alertas retomados

                Unidade: Sesc Socorro
                Escopo: unidade inteira (20 equipamentos)
                Motivo: Troca do switch core
                Período: 26/10/2026 08:00 → 26/10/2026 11:20 (3h 20m 0s)
                Término: antecipado por Fulano (previsto 12:00)
                Seguem em manutenção: Switch CPD (manual)
                O aviso de início não foi entregue; este é o registro completo.
                Janela: #41
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void fimAposProrrogacao() {
        Termino termino = new Termino(TipoTermino.APOS_PRORROGACAO, "Fulano", t(12, 0), t(14, 0));
        assertThat(builder.construirFimJanela(unidadeInteira(), t(8, 0), t(14, 0), termino, List.of(),
                EntregaInicio.ENTREGUE))
                .contains("\nTérmino: como previsto, após prorrogação de 12:00 para 14:00 por Fulano\n");
    }

    @Test
    void fimAposAntecipacao() {
        Termino termino = new Termino(TipoTermino.APOS_ANTECIPACAO, "Fulano", t(12, 0), t(10, 0));
        assertThat(builder.construirFimJanela(unidadeInteira(), t(8, 0), t(10, 0), termino, List.of(),
                EntregaInicio.ENTREGUE))
                .contains("\nTérmino: como previsto, após antecipação de 12:00 para 10:00 por Fulano\n");
    }

    @Test
    void fimComSeguintesManualEJanela() {
        Termino termino = new Termino(TipoTermino.COMO_PREVISTO, null, t(12, 0), t(12, 0));
        assertThat(builder.construirFimJanela(unidadeInteira(), t(8, 0), t(12, 0), termino,
                List.of(new Seguinte("Switch CPD", null), new Seguinte("AP-02", 43L)), EntregaInicio.ENTREGUE))
                .contains("\nSeguem em manutenção: Switch CPD (manual), AP-02 (janela #43)\n");
    }

    @Test
    void fimComMaisDeCincoSeguintes() {
        Termino termino = new Termino(TipoTermino.COMO_PREVISTO, null, t(12, 0), t(12, 0));
        List<Seguinte> seguem = List.of(new Seguinte("A", null), new Seguinte("B", null), new Seguinte("C", null),
                new Seguinte("D", null), new Seguinte("E", 43L), new Seguinte("F", null), new Seguinte("G", null));
        assertThat(builder.construirFimJanela(unidadeInteira(), t(8, 0), t(12, 0), termino, seguem,
                EntregaInicio.ENTREGUE))
                .contains("\nSeguem em manutenção: A (manual), B (manual), C (manual), D (manual), "
                        + "E (janela #43) e mais 2\n");
    }

    @Test
    void fimInicioNaoEntregue() {
        Termino termino = new Termino(TipoTermino.COMO_PREVISTO, null, t(12, 0), t(12, 0));
        assertThat(builder.construirFimJanela(unidadeInteira(), t(8, 0), t(12, 0), termino, List.of(),
                EntregaInicio.NAO_ENTREGUE))
                .contains("\nO aviso de início não foi entregue; este é o registro completo.\nJanela: #41\n");
    }

    @Test
    void fimInicioTalvezEntregue() {
        Termino termino = new Termino(TipoTermino.COMO_PREVISTO, null, t(12, 0), t(12, 0));
        assertThat(builder.construirFimJanela(unidadeInteira(), t(8, 0), t(12, 0), termino, List.of(),
                EntregaInicio.TALVEZ_ENTREGUE))
                .contains("\nO aviso de início pode não ter sido entregue; este é o registro completo.\n");
    }

    @Test
    void duracaoAcimaDeUmDia() {
        Termino termino = new Termino(TipoTermino.COMO_PREVISTO, null, t(12, 0), t(12, 0));
        Instant fim = t(9, 0).plusSeconds(24 * 3600L);
        assertThat(builder.construirFimJanela(unidadeInteira(), t(8, 0), fim, termino, List.of(),
                EntregaInicio.ENTREGUE))
                .contains("\nPeríodo: 26/10/2026 08:00 → 27/10/2026 09:00 (25h 0m 0s)\n");
    }

    @Test
    void fimAlteradoProrrogado() {
        assertThat(builder.construirFimAlterado(unidadeInteira(), t(12, 0), t(14, 0), "Fulano", t(9, 30))).isEqualTo("""
                ⏱️ MANUTENÇÃO PRORROGADA

                Unidade: Sesc Socorro
                Escopo: unidade inteira (20 equipamentos)
                Motivo: Troca do switch core
                Fim previsto: 26/10/2026 12:00 → 26/10/2026 14:00
                Alterado por: Fulano
                Janela: #41
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void fimAlteradoAntecipado() {
        assertThat(builder.construirFimAlterado(unidadeInteira(), t(12, 0), t(10, 0), "Fulano", t(9, 30))).isEqualTo("""
                ⏱️ FIM DA MANUTENÇÃO ANTECIPADO

                Unidade: Sesc Socorro
                Escopo: unidade inteira (20 equipamentos)
                Motivo: Troca do switch core
                Fim previsto: 26/10/2026 12:00 → 26/10/2026 10:00
                Alterado por: Fulano
                Janela: #41
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void manualIniciadaLivre() {
        assertThat(builder.construirManualIniciada(manual("10.0.0.1", t(9, 12), "Fulano"), false, null))
                .isEqualTo("""
                🔧 EQUIPAMENTO EM MANUTENÇÃO MANUAL — alertas suspensos

                Unidade: Sesc Socorro
                Equipamento: Servidor  Gateway
                IP: 10.0.0.1
                Iniciada por: Fulano
                Início: 26/10/2026 09:12
                Sem fim previsto: volta só quando alguém encerrar.
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void manualIniciadaSemIp() {
        assertThat(builder.construirManualIniciada(manual(null, t(9, 12), "Fulano"), false, null))
                .doesNotContain("IP:")
                .contains("\nEquipamento: Servidor  Gateway\nIniciada por: Fulano\n");
    }

    @Test
    void manualIniciadaJaNaJanela() {
        assertThat(builder.construirManualIniciada(manual("10.0.0.1", t(9, 12), "Fulano"), true,
                new JanelaVigente(41, t(12, 0))))
                .contains("\nJá estava na janela #41 (até 26/10/2026 12:00); agora não volta sozinho no fim dela.\n")
                .doesNotContain("Sem fim previsto");
    }

    @Test
    void manualIniciadaJaEmManutencaoSemJanela() {
        assertThat(builder.construirManualIniciada(manual("10.0.0.1", t(9, 12), "Fulano"), true, null))
                .contains("\nJá estava em manutenção; agora não volta sozinho.\n");
    }

    @Test
    void manualEncerradaRetoma() {
        assertThat(builder.construirManualEncerrada(manual("10.0.0.1", t(9, 12), "Fulano"), t(10, 40),
                "Fulano", false, null, EntregaInicio.ENTREGUE)).isEqualTo("""
                ✅ MANUTENÇÃO MANUAL ENCERRADA — alertas retomados

                Unidade: Sesc Socorro
                Equipamento: Servidor  Gateway
                IP: 10.0.0.1
                Período: 26/10/2026 09:12 → 26/10/2026 10:40 (1h 28m 0s)
                Encerrada por: Fulano
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void manualEncerradaSeguePelaJanela() {
        assertThat(builder.construirManualEncerrada(manual("10.0.0.1", t(9, 12), "Fulano"), t(10, 40),
                "Fulano", true, new JanelaVigente(41, t(12, 0)), EntregaInicio.ENTREGUE))
                .startsWith("✅ MANUTENÇÃO MANUAL ENCERRADA — segue em manutenção pela janela #41 "
                        + "até 26/10/2026 12:00\n\nUnidade:");
    }

    @Test
    void manualEncerradaLegadoSemInicio() {
        assertThat(builder.construirManualEncerrada(manual("10.0.0.1", null, null), t(10, 40), "Fulano",
                false, null, EntregaInicio.ENTREGUE))
                .contains("\nPeríodo: início não registrado (anterior ao histórico) → 26/10/2026 10:40\n")
                .doesNotContain("(0h")
                .endsWith("\nHorários: UTC-03:00 (America/Sao_Paulo)");
    }

    @Test
    void manualEncerradaInicioNaoEntregue() {
        assertThat(builder.construirManualEncerrada(manual("10.0.0.1", t(9, 12), "Fulano"), t(10, 40),
                "Fulano", false, null, EntregaInicio.NAO_ENTREGUE))
                .contains("\nEncerrada por: Fulano\nO aviso de início não foi entregue; este é o registro "
                        + "completo.\nHorários: UTC-03:00 (America/Sao_Paulo)");
    }

    /**
     * Rodape no offset do instante da alteracao, nao do inicio previsto: a alteracao pode cair depois de
     * uma troca de horario de verao (aqui EDT -> EST, 01/11/2026).
     */
    @Test
    void fimAlteradoRodapeUsaOInstanteDaAlteracao() {
        NotificacaoMessageBuilder novaYork = new NotificacaoMessageBuilder("America/New_York");
        Janela j = new Janela(41, "Sesc Socorro", EscopoManutencao.UNIDADE, 20, List.of(), "Troca",
                Instant.parse("2026-10-31T12:00:00Z"), Instant.parse("2026-11-03T12:00:00Z"), "Ricardo Barbosa");

        assertThat(novaYork.construirFimAlterado(j, Instant.parse("2026-11-03T12:00:00Z"),
                Instant.parse("2026-11-04T12:00:00Z"), "Fulano", Instant.parse("2026-11-02T12:00:00Z")))
                .endsWith("\nHorários: UTC-05:00 (America/New_York)");
    }

    @Test
    void fimJanelaReserva() {
        assertThat(builder.construirFimJanelaReserva(41, t(12, 0))).isEqualTo("""
                ✅ MANUTENÇÃO ENCERRADA — alertas retomados

                Janela: #41
                Detalhes indisponíveis: falha ao montar a mensagem (ver o sistema).
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void manualEncerradaReservaComNome() {
        assertThat(builder.construirManualEncerradaReserva("SW-CORE", 9, t(12, 0))).isEqualTo("""
                ✅ MANUTENÇÃO MANUAL ENCERRADA — alertas retomados

                Equipamento: SW-CORE
                Detalhes indisponíveis: falha ao montar a mensagem (ver o sistema).
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void manualEncerradaReservaSemNomeUsaId() {
        assertThat(builder.construirManualEncerradaReserva(null, 9, t(12, 0))).contains("\nEquipamento: #9\n");
        assertThat(builder.construirManualEncerradaReserva("  ", 9, t(12, 0))).contains("\nEquipamento: #9\n");
    }
}

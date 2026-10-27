package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatencia;
import br.com.inframonitor.monitoring.latency.MotivoEncerramentoEpisodio;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import br.com.inframonitor.unidade.entity.Unidade;
import br.com.inframonitor.usuario.entity.Papel;
import br.com.inframonitor.usuario.entity.Usuario;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class NotificacaoMessageBuilderTest {
    private static final Instant INICIO = Instant.parse("2026-08-19T12:00:00Z");
    private static final Instant FIM = Instant.parse("2026-08-19T13:02:03Z");

    private final NotificacaoMessageBuilder builder = new NotificacaoMessageBuilder("America/Sao_Paulo");

    @Test
    void incidenteAbertoSemIpComMotivo() {
        assertThat(builder.construir(incidente(null), TipoEventoNotificacao.INCIDENTE_ABERTO)).isEqualTo("""
                INCIDENTE ABERTO

                Unidade: Matriz
                Equipamento: SW-01
                Monitor: ICMP principal
                Inicio: 19/08/2026 09:00
                Motivo: indisponibilidade
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void incidenteAbertoComIp() {
        assertThat(builder.construir(incidente("10.0.0.1"), TipoEventoNotificacao.INCIDENTE_ABERTO)).isEqualTo("""
                INCIDENTE ABERTO

                Unidade: Matriz
                Equipamento: SW-01
                IP: 10.0.0.1
                Monitor: ICMP principal
                Inicio: 19/08/2026 09:00
                Motivo: indisponibilidade
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void incidenteFechadoAutomatico() {
        Incidente incidente = incidente(null);
        incidente.fechar(FIM, null, null, MotivoEncerramentoIncidente.RECUPERACAO_AUTOMATICA);
        assertThat(builder.construir(incidente, TipoEventoNotificacao.INCIDENTE_FECHADO)).isEqualTo("""
                INCIDENTE ENCERRADO

                Unidade: Matriz
                Equipamento: SW-01
                Monitor: ICMP principal
                Inicio: 19/08/2026 09:00
                Fim: 19/08/2026 10:02
                Duracao: 1h 2m 3s
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void incidenteFechadoManual() {
        Incidente incidente = incidente(null);
        Usuario operador = new Usuario("Ricardo Barbosa", "r@x.test", "hash", Papel.OPERADOR, false);
        incidente.fechar(FIM, null, operador, MotivoEncerramentoIncidente.FECHAMENTO_MANUAL);
        assertThat(builder.construir(incidente, TipoEventoNotificacao.INCIDENTE_FECHADO)).isEqualTo("""
                INCIDENTE ENCERRADO MANUALMENTE

                Unidade: Matriz
                Equipamento: SW-01
                Monitor: ICMP principal
                Inicio: 19/08/2026 09:00
                Fim: 19/08/2026 10:02
                Duracao: 1h 2m 3s
                Encerrado por: Ricardo Barbosa
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void fechamentoManualSemAutorNaoInventaNome() {
        Incidente incidente = incidente(null);
        incidente.fechar(FIM, null, null, MotivoEncerramentoIncidente.FECHAMENTO_MANUAL);
        assertThat(builder.construir(incidente, TipoEventoNotificacao.INCIDENTE_FECHADO)).isEqualTo("""
                INCIDENTE ENCERRADO MANUALMENTE

                Unidade: Matriz
                Equipamento: SW-01
                Monitor: ICMP principal
                Inicio: 19/08/2026 09:00
                Fim: 19/08/2026 10:02
                Duracao: 1h 2m 3s
                Encerrado por: operador nao identificado
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void incidenteEncerradoPorManutencao() {
        Incidente incidente = incidente(null);
        incidente.fechar(FIM, null, null, MotivoEncerramentoIncidente.MANUTENCAO);
        assertThat(builder.construir(incidente, TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO)).isEqualTo("""
                🔧 Incidente encerrado: equipamento entrou em manutenção

                Unidade: Matriz
                Equipamento: SW-01
                Monitor: ICMP principal
                Inicio: 19/08/2026 09:00
                Fim: 19/08/2026 10:02
                Duracao: 1h 2m 3s
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void latenciaAlta() {
        assertThat(builder.construirParaEpisodio(episodio(), TipoEventoNotificacao.LATENCIA_ALTA)).isEqualTo("""
                LATENCIA ALTA

                Unidade: Matriz
                Equipamento: SW-01
                Monitor: ICMP principal
                Limiar: 150 ms
                Inicio: 19/08/2026 09:00
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void latenciaNormalizada() {
        MonitorEpisodioLatencia episodio = episodio();
        episodio.encerrar(FIM, MotivoEncerramentoEpisodio.NORMALIZACAO);
        assertThat(builder.construirParaEpisodio(episodio, TipoEventoNotificacao.LATENCIA_NORMALIZADA)).isEqualTo("""
                LATENCIA NORMALIZADA

                Unidade: Matriz
                Equipamento: SW-01
                Monitor: ICMP principal
                Limiar: 150 ms
                Inicio: 19/08/2026 09:00
                Fim: 19/08/2026 10:02
                Duracao: 1h 2m 3s
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void latenciaEncerradaPorManutencao() {
        MonitorEpisodioLatencia episodio = episodio();
        episodio.encerrar(FIM, MotivoEncerramentoEpisodio.MANUTENCAO);
        assertThat(builder.construirParaEpisodio(episodio, TipoEventoNotificacao.LATENCIA_ENCERRADA_MANUTENCAO)).isEqualTo("""
                🔧 Latencia encerrada: equipamento entrou em manutenção

                Unidade: Matriz
                Equipamento: SW-01
                Monitor: ICMP principal
                Limiar: 150 ms
                Inicio: 19/08/2026 09:00
                Fim: 19/08/2026 10:02
                Duracao: 1h 2m 3s
                Horários: UTC-03:00 (America/Sao_Paulo)""");
    }

    @Test
    void viradaDeDiaUsaDataLocal() {
        Incidente incidente = new Incidente(monitor(null), Instant.parse("2026-08-20T02:30:00Z"), "indisponibilidade", null);
        assertThat(builder.construir(incidente, TipoEventoNotificacao.INCIDENTE_ABERTO))
                .contains("Inicio: 19/08/2026 23:30");
    }

    @Test
    void fusoConfiguradoMudaTexto() {
        NotificacaoMessageBuilder emUtc = new NotificacaoMessageBuilder("UTC");
        String mensagem = emUtc.construir(incidente(null), TipoEventoNotificacao.INCIDENTE_ABERTO);
        assertThat(mensagem).contains("Inicio: 19/08/2026 12:00").endsWith("\nHorários: UTC+00:00 (UTC)");
    }

    @Test
    void rodapeUsaOffsetDoInstanteDeReferencia() {
        assertThat(builder.rodape(INICIO)).isEqualTo("Horários: UTC-03:00 (America/Sao_Paulo)");
        NotificacaoMessageBuilder lisboa = new NotificacaoMessageBuilder("Europe/Lisbon");
        assertThat(lisboa.rodape(Instant.parse("2026-07-01T12:00:00Z"))).isEqualTo("Horários: UTC+01:00 (Europe/Lisbon)");
        assertThat(lisboa.rodape(Instant.parse("2026-01-01T12:00:00Z"))).isEqualTo("Horários: UTC+00:00 (Europe/Lisbon)");
    }

    @Test
    void duracaoAcumulaHorasAcimaDeVinteEQuatro() {
        assertThat(builder.formatarDuracao(Duration.ofHours(49).plusMinutes(5).plusSeconds(6))).isEqualTo("49h 5m 6s");
    }

    private Incidente incidente(String ip) {
        return new Incidente(monitor(ip), INICIO, "indisponibilidade", null);
    }

    private MonitorEpisodioLatencia episodio() {
        return new MonitorEpisodioLatencia(monitor(null), INICIO, 150);
    }

    private Monitor monitor(String ip) {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        Equipamento equipamento = new Equipamento(unidade, new TipoEquipamento("Switch", null), "SW-01", ip, null, null, null, null);
        return new Monitor(equipamento, TipoMonitor.ICMP, "ICMP principal", 60, 2_000);
    }
}

package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import br.com.inframonitor.unidade.entity.Unidade;
import br.com.inframonitor.usuario.entity.Papel;
import br.com.inframonitor.usuario.entity.Usuario;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class NotificacaoMessageBuilderTest {
    private final NotificacaoMessageBuilder builder = new NotificacaoMessageBuilder();

    @Test
    void montaMensagemDeAberturaComDadosReaisEMotivo() {
        String message = builder.construir(incidente(), TipoEventoNotificacao.INCIDENTE_ABERTO);
        assertThat(message).contains("INCIDENTE ABERTO", "Unidade: Matriz", "Equipamento: SW-01",
                "Monitor: ICMP principal", "Motivo: indisponibilidade");
    }

    @Test
    void montaMensagemDeFechamentoComDuracaoDosTimestamps() {
        Incidente incidente = incidente();
        incidente.fechar(Instant.parse("2026-08-19T13:02:03Z"), null, null, MotivoEncerramentoIncidente.RECUPERACAO_AUTOMATICA);
        String message = builder.construir(incidente, TipoEventoNotificacao.INCIDENTE_FECHADO);
        assertThat(message).contains("INCIDENTE ENCERRADO", "Fim: 2026-08-19T13:02:03Z", "Duracao: 1h 2m 3s");
    }

    @Test
    void fechamentoManualDizQueFoiOperadorEQuem() {
        Incidente incidente = incidente();
        Usuario operador = new Usuario("Ricardo Barbosa", "r@x.test", "hash", Papel.OPERADOR, false);
        incidente.fechar(Instant.parse("2026-08-19T13:02:03Z"), null, operador, MotivoEncerramentoIncidente.FECHAMENTO_MANUAL);
        assertThat(builder.construir(incidente, TipoEventoNotificacao.INCIDENTE_FECHADO)).isEqualTo("""
                INCIDENTE ENCERRADO MANUALMENTE

                Unidade: Matriz
                Equipamento: SW-01
                Monitor: ICMP principal
                Inicio: 2026-08-19T12:00:00Z
                Fim: 2026-08-19T13:02:03Z
                Duracao: 1h 2m 3s
                Encerrado por: Ricardo Barbosa""");
    }

    @Test
    void recuperacaoAutomaticaNaoCitaOperador() {
        Incidente incidente = incidente();
        incidente.fechar(Instant.parse("2026-08-19T13:02:03Z"), null, null, MotivoEncerramentoIncidente.RECUPERACAO_AUTOMATICA);
        String mensagem = builder.construir(incidente, TipoEventoNotificacao.INCIDENTE_FECHADO);
        assertThat(mensagem).startsWith("INCIDENTE ENCERRADO\n").doesNotContain("MANUALMENTE", "Encerrado por");
    }

    @Test
    void fechamentoManualSemAutorNaoInventaNome() {
        Incidente incidente = incidente();
        incidente.fechar(Instant.parse("2026-08-19T13:02:03Z"), null, null, MotivoEncerramentoIncidente.FECHAMENTO_MANUAL);
        assertThat(builder.construir(incidente, TipoEventoNotificacao.INCIDENTE_FECHADO))
                .endsWith("\nEncerrado por: operador nao identificado");
    }

    private Incidente incidente() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        Equipamento equipamento = new Equipamento(unidade, new TipoEquipamento("Switch", null), "SW-01", null, null, null, null, null);
        Monitor monitor = new Monitor(equipamento, TipoMonitor.ICMP, "ICMP principal", 60, 2_000);
        return new Incidente(monitor, Instant.parse("2026-08-19T12:00:00Z"), "indisponibilidade", null);
    }
}

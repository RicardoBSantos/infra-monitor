package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitoring.execution.MonitorCandidate;
import br.com.inframonitor.monitoring.execution.MonitorExecutionResult;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class IcmpMonitorExecutorTest {

    private static final Instant AGORA = Instant.parse("2026-09-21T12:00:00Z");
    private static final Clock RELOGIO = Clock.fixed(AGORA, ZoneOffset.UTC);
    private static final MonitorCandidate MONITOR =
            new MonitorCandidate(1L, TipoMonitor.ICMP, 60, 3_000, "10.79.10.6", null);

    private static IcmpMonitorExecutor executorQueDevolve(IcmpResult resultado) {
        return new IcmpMonitorExecutor((ip, timeoutMs) -> resultado, RELOGIO);
    }

    @Test
    @DisplayName("SUCESSO grava o RTT informado, sem cronometro")
    void sucessoGravaRtt() {
        MonitorExecutionResult r = executorQueDevolve(IcmpResult.sucesso(7)).execute(MONITOR);
        assertThat(r.success()).isTrue();
        assertThat(r.latencyMs()).isEqualTo(7);
        assertThat(r.message()).isNull();
        assertThat(r.executedAt()).isEqualTo(AGORA);
    }

    @Test
    @DisplayName("TTL expirado e FALHA, nao sucesso")
    void ttlExpiradoEFalha() {
        MonitorExecutionResult r = executorQueDevolve(IcmpResult.falha(StatusIcmp.TTL_EXPIRADO)).execute(MONITOR);
        assertThat(r.success()).isFalse();
        assertThat(r.message()).isEqualTo("TTL expirado em trânsito");
        assertThat(r.latencyMs()).isNull();
    }

    @Test
    @DisplayName("host inacessivel e FALHA, nao sucesso")
    void hostInacessivelEFalha() {
        MonitorExecutionResult r = executorQueDevolve(IcmpResult.falha(StatusIcmp.HOST_INACESSIVEL)).execute(MONITOR);
        assertThat(r.success()).isFalse();
        assertThat(r.message()).isEqualTo("Host de destino inacessível");
    }

    @Test
    void redeInacessivelEFalha() {
        MonitorExecutionResult r = executorQueDevolve(IcmpResult.falha(StatusIcmp.REDE_INACESSIVEL)).execute(MONITOR);
        assertThat(r.success()).isFalse();
        assertThat(r.message()).isEqualTo("Rede de destino inacessível");
    }

    @Test
    void timeoutEFalha() {
        MonitorExecutionResult r = executorQueDevolve(IcmpResult.falha(StatusIcmp.TIMEOUT)).execute(MONITOR);
        assertThat(r.success()).isFalse();
        assertThat(r.message()).isEqualTo("Timeout");
    }

    @Test
    @DisplayName("codigo desconhecido vai para a mensagem")
    void erroLevaOCodigo() {
        MonitorExecutionResult r = executorQueDevolve(IcmpResult.erro(11050)).execute(MONITOR);
        assertThat(r.success()).isFalse();
        assertThat(r.message()).isEqualTo("Erro ICMP 11050");
    }

    @Test
    @DisplayName("codigo 0 e' IP_SUCCESS: como erro ele nao pode virar 'Erro ICMP 0'")
    void erroComCodigoZeroNaoViraMensagemDeSucesso() {
        MonitorExecutionResult r = executorQueDevolve(IcmpResult.erro(0)).execute(MONITOR);
        assertThat(r.success()).isFalse();
        assertThat(r.message()).isEqualTo("Erro ICMP não identificado");
    }

    @Test
    @DisplayName("todas as mensagens cabem em medicao.mensagem VARCHAR(255)")
    void mensagensCabemNaColuna() {
        for (StatusIcmp status : StatusIcmp.values()) {
            IcmpResult resultado = status == StatusIcmp.SUCESSO
                    ? IcmpResult.sucesso(1)
                    : status == StatusIcmp.ERRO ? IcmpResult.erro(2147483647) : IcmpResult.falha(status);
            String mensagem = IcmpMonitorExecutor.mensagem(resultado);
            if (mensagem != null) {
                assertThat(mensagem.length()).isLessThanOrEqualTo(255);
            }
        }
    }

    @Test
    void ioExceptionViraFalha() {
        IcmpMonitorExecutor executor = new IcmpMonitorExecutor((ip, timeoutMs) -> {
            throw new IOException("sem permissao");
        }, RELOGIO);
        MonitorExecutionResult r = executor.execute(MONITOR);
        assertThat(r.success()).isFalse();
        assertThat(r.message()).isEqualTo("Erro ao executar a sondagem ICMP");
    }
}

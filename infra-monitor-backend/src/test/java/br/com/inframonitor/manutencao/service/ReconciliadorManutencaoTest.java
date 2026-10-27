package br.com.inframonitor.manutencao.service;

import br.com.inframonitor.equipamento.service.EstadoManutencaoEquipamento;
import br.com.inframonitor.manutencao.config.ManutencaoAgendadaProperties;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.PlatformTransactionManager;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Gate do motor (MA12) na falha: a primeira passada pode estourar (banco fora, bug), e mesmo
 * assim o motor tem que ser liberado, senao fica parado para sempre esperando por ela.
 */
class ReconciliadorManutencaoTest {

    private static final Instant AGORA = Instant.parse("2026-10-22T12:00:00Z");

    private final Logger logger = (Logger) LoggerFactory.getLogger(ReconciliadorManutencao.class);
    private final ListAppender<ILoggingEvent> registros = new ListAppender<>();

    private final CoberturaManutencao cobertura = mock(CoberturaManutencao.class);
    private final EstadoManutencaoEquipamento estado = mock(EstadoManutencaoEquipamento.class);
    private final PlatformTransactionManager transacoes = mock(PlatformTransactionManager.class);
    private ReconciliacaoInicial inicial;
    private ReconciliadorManutencao reconciliador;

    @BeforeEach
    void preparar() {
        registros.start();
        logger.addAppender(registros);
        var props = new ManutencaoAgendadaProperties();
        props.setEnabled(true);
        inicial = new ReconciliacaoInicial(props);
        reconciliador = new ReconciliadorManutencao(cobertura, mock(AnuncioManutencao.class), estado, inicial, props,
                transacoes,
                Clock.fixed(AGORA, ZoneOffset.UTC));
    }

    @AfterEach
    void limpar() {
        logger.detachAppender(registros);
    }

    @Test
    void primeiraPassadaComFalhaAindaLiberaOMotor() {
        IllegalStateException falha = new IllegalStateException("banco fora");
        when(cobertura.devidasParaAtivar(any())).thenThrow(falha);
        assertThat(inicial.pronta()).isFalse();

        // Pelo agendador: nao estoura, loga e libera.
        assertThatCode(reconciliador::agendado).doesNotThrowAnyException();

        assertThat(inicial.pronta()).isTrue();
        assertThat(registros.list).anySatisfy(evento -> {
            assertThat(evento.getLevel()).isEqualTo(Level.ERROR);
            assertThat(evento.getThrowableProxy().getMessage()).isEqualTo("banco fora");
        });
        verifyNoInteractions(estado);
    }

    @Test
    void chamadaDiretaPropagaAFalhaMasLiberaOMotor() {
        IllegalStateException falha = new IllegalStateException("banco fora");
        when(cobertura.devidasParaAtivar(any())).thenThrow(falha);

        assertThatThrownBy(() -> reconciliador.reconciliar(AGORA)).isSameAs(falha);

        assertThat(inicial.pronta()).isTrue();
    }
}

package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitoring.icmp.nativo.Iphlpapi;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.sun.jna.Pointer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

class IcmpAmbienteConfigurationTest {

    private final Logger logger = (Logger) LoggerFactory.getLogger(IcmpAmbienteConfiguration.class);
    private final ListAppender<ILoggingEvent> registros = new ListAppender<>();

    /** Reproduz o que a JNA faz: UnsatisfiedLinkError CRU, nao embrulhado. */
    private static final Supplier<Iphlpapi> CARGA_QUE_FALHA = () -> {
        throw new UnsatisfiedLinkError("Unable to load library 'Iphlpapi'");
    };

    @BeforeEach
    void preparar() {
        registros.start();
        logger.addAppender(registros);
    }

    @AfterEach
    void encerrar() {
        logger.detachAppender(registros);
    }

    @Test
    @DisplayName("nativo-windows pedido de proposito + carga falha: a aplicacao nao sobe")
    void nativoExplicitoComFalhaDeCargaDerrubaASubida() {
        assertThatThrownBy(() -> IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.NATIVO_WINDOWS, true, true, CARGA_QUE_FALHA))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("monitoring.icmp.implementacao=nativo-windows")
                .hasMessageContaining("Iphlpapi")
                .hasMessageContaining("processo-ping")
                .hasRootCauseInstanceOf(UnsatisfiedLinkError.class);
    }

    @Test
    @DisplayName("auto no Windows + carga falha: cai para processo-ping com ERROR na subida")
    void autoComFalhaDeCargaCaiParaProcessoPing() {
        IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.AUTO, true, true, CARGA_QUE_FALHA);

        assertThat(ambiente.pedida()).isEqualTo(IcmpImplementacao.AUTO);
        assertThat(ambiente.ativa()).isEqualTo(IcmpImplementacao.PROCESSO_PING);
        assertThat(ambiente.cargaNativa()).isEqualTo(CargaNativa.FALHOU);
        assertThat(ambiente.detalheFalha()).contains("UnsatisfiedLinkError");
        assertThat(ambiente.nativo()).isNull();
        assertThat(registros.list)
                .anySatisfy(evento -> {
                    assertThat(evento.getLevel()).isEqualTo(Level.ERROR);
                    assertThat(evento.getFormattedMessage()).contains("processo-ping");
                });
    }

    @Test
    @DisplayName("motor desligado ainda assim tenta a carga, para que /status nao minta")
    void motorDesligadoAindaAssimTentaACarga() {
        AtomicInteger cargas = new AtomicInteger();
        IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.AUTO, true, false, contar(cargas));

        assertThat(cargas.get()).isEqualTo(1);
        assertThat(ambiente.ativa()).isEqualTo(IcmpImplementacao.NATIVO_WINDOWS);
        assertThat(ambiente.cargaNativa()).isEqualTo(CargaNativa.OK);
        assertThat(ambiente.motorLigado()).isFalse();
    }

    @Test
    @DisplayName("processo-ping nunca toca a camada nativa")
    void processoPingNaoCarrega() {
        AtomicInteger cargas = new AtomicInteger();
        IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.PROCESSO_PING, true, true, contar(cargas));

        assertThat(cargas.get()).isZero();
        assertThat(ambiente.cargaNativa()).isEqualTo(CargaNativa.NAO_TENTADA);
    }

    @Test
    @DisplayName("PROVA DE REVERSAO: a carga acontece UMA vez na subida e ZERO vezes por sondagem")
    void cargaAconteceUmaVezNaSubidaENuncaPorSondagem() throws Exception {
        AtomicInteger cargas = new AtomicInteger();
        IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.NATIVO_WINDOWS, true, true, contar(cargas));

        // Se a carga voltar a ser preguicosa (dentro da sondagem), aqui e' 0 e o teste falha.
        assertThat(cargas.get()).isEqualTo(1);
        assertThat(ambiente.nativo()).isNotNull();

        IcmpCommandRunner runner = IcmpRunnerConfiguration.criarRunner(ambiente);
        for (int sondagem = 0; sondagem < 5; sondagem++) {
            runner.run("10.0.0.1", 100);
        }

        // Se alguem carregar por sondagem, aqui e' 6 e o teste falha.
        assertThat(cargas.get()).isEqualTo(1);
    }

    @Test
    void tentaCargaNativaComMotorDesligadoERegistraFalha() {
        AtomicInteger invocacoes = new AtomicInteger();
        Supplier<Iphlpapi> fabricaQueFalha = () -> {
            invocacoes.incrementAndGet();
            throw new UnsatisfiedLinkError("Iphlpapi indisponivel no teste");
        };

        IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.AUTO, true, false, fabricaQueFalha);

        assertThat(invocacoes.get()).isEqualTo(1);
        assertThat(ambiente.cargaNativa()).isEqualTo(CargaNativa.FALHOU);
        assertThat(ambiente.ativa()).isEqualTo(IcmpImplementacao.PROCESSO_PING);
        assertThat(ambiente.detalheFalha()).contains("Iphlpapi indisponivel no teste");
        assertThat(ambiente.motorLigado()).isFalse();
    }

    @Test
    void pedidoExplicitoQueFalhaComMotorDesligadoNaoDerrubaASubidaEMantemAtiva() {
        Supplier<Iphlpapi> fabricaQueFalha = () -> {
            throw new UnsatisfiedLinkError("Iphlpapi indisponivel no teste");
        };

        IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.NATIVO_WINDOWS, true, false, fabricaQueFalha);

        // Pedido explicito nao vira fallback silencioso: /status precisa mostrar
        // exatamente o que impediria ligar o motor neste processo.
        assertThat(ambiente.ativa()).isEqualTo(IcmpImplementacao.NATIVO_WINDOWS);
        assertThat(ambiente.cargaNativa()).isEqualTo(CargaNativa.FALHOU);
        assertThat(ambiente.nativo()).isNull();
    }

    @Test
    void cargaNativaComMotorDesligadoQueFuncionaEntregaALigacao() {
        Iphlpapi ligacao = mock(Iphlpapi.class);

        IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.AUTO, true, false, () -> ligacao);

        assertThat(ambiente.cargaNativa()).isEqualTo(CargaNativa.OK);
        assertThat(ambiente.ativa()).isEqualTo(IcmpImplementacao.NATIVO_WINDOWS);
        assertThat(ambiente.nativo()).isSameAs(ligacao);
    }

    @Test
    void pedidoExplicitoQueFalhaComMotorLIGADOContinuaDerrubandoASubida() {
        Supplier<Iphlpapi> fabricaQueFalha = () -> {
            throw new UnsatisfiedLinkError("Iphlpapi indisponivel no teste");
        };

        assertThatThrownBy(() -> IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.NATIVO_WINDOWS, true, true, fabricaQueFalha))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void foraDoWindowsNaoTentaCargaNativa() {
        AtomicInteger invocacoes = new AtomicInteger();

        IcmpAmbiente ambiente = IcmpAmbienteConfiguration.resolver(
                IcmpImplementacao.AUTO, false, false, () -> {
                    invocacoes.incrementAndGet();
                    return mock(Iphlpapi.class);
                });

        assertThat(invocacoes.get()).isZero();
        assertThat(ambiente.cargaNativa()).isEqualTo(CargaNativa.NAO_TENTADA);
        assertThat(ambiente.ativa()).isEqualTo(IcmpImplementacao.PROCESSO_PING);
    }

    /** Iphlpapi falso: conta cargas e devolve sempre timeout, sem tocar a rede. */
    private static Supplier<Iphlpapi> contar(AtomicInteger cargas) {
        return () -> {
            cargas.incrementAndGet();
            return new Iphlpapi() {
                @Override
                public Pointer icmpCreateFile() {
                    return new Pointer(1L);
                }

                @Override
                public Retorno icmpSendEcho(Pointer handle, int destino, Pointer requisicao, short tamanho,
                                            Pointer opcoes, Pointer reply, int tamanhoReply, int timeoutMs) {
                    return new Retorno(0, 11010);
                }

                @Override
                public void icmpCloseHandle(Pointer handle) {
                }
            };
        };
    }
}

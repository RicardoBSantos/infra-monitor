package br.com.inframonitor.manutencao;

import br.com.inframonitor.manutencao.config.ManutencaoAgendadaProperties;
import br.com.inframonitor.manutencao.dto.AlterarFimRequest;
import br.com.inframonitor.manutencao.dto.CriarManutencaoRequest;
import br.com.inframonitor.manutencao.dto.EditarManutencaoRequest;
import br.com.inframonitor.manutencao.dto.ManutencaoResponse;
import br.com.inframonitor.manutencao.entity.EscopoManutencao;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao;
import br.com.inframonitor.manutencao.service.ManutencaoAgendadaService;
import br.com.inframonitor.manutencao.service.ReconciliadorManutencao;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import br.com.inframonitor.testsupport.RequerDocker;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static java.time.temporal.ChronoUnit.HOURS;
import static java.time.temporal.ChronoUnit.MINUTES;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;

/**
 * Anuncios da janela (MA27/MA28/MA31): inicio, fim e alteracao de fim entram na fila na MESMA
 * transacao do CAS da transicao, com o texto conferido; cancelar, expirar e editar AGENDADA nao
 * geram linha. O reconciliador e chamado direto com {@code reconciliar(agora)}; o intervalo de uma
 * hora deixa o {@code @Scheduled} fora do caminho e faz o limite de atraso valer duas horas.
 *
 * <p>Requer Docker. Sem Docker disponivel o teste e ignorado, nunca falha.
 */
@RequerDocker
@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-anuncio-janela-test",
        "app.reports.timezone=America/Sao_Paulo",
        "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false",
        "manutencao.agendada.enabled=true",
        "manutencao.agendada.intervalo-ms=3600000"
})
class ManutencaoAnuncioPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final ZoneId FUSO = ZoneId.of("America/Sao_Paulo");
    private static final DateTimeFormatter HORA = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm");
    private static final DateTimeFormatter HORA_CURTA = DateTimeFormatter.ofPattern("HH:mm");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private ReconciliadorManutencao reconciliador;
    @Autowired private ManutencaoAgendadaService service;
    @Autowired private ManutencaoAgendadaProperties props;
    // Spy so para injetar falha na montagem do anuncio; nos demais testes delega ao bean real.
    @MockitoSpyBean private NotificacaoService notificacoes;

    // Precisao de microssegundo do TIMESTAMPTZ: comparar o instante gravado com o enviado.
    private final Instant agora = Instant.now().truncatedTo(ChronoUnit.MILLIS);

    private long ana;
    private long bruno;
    private long tipo;
    private long centro;
    private long vazia;
    private long sw;
    private long ap;
    private long nvr;
    private long monitorSw;

    @BeforeEach
    void montarCenario() {
        reset(notificacoes);
        jdbc.execute("truncate table manutencao_agendada_alteracao, manutencao_agendada_equipamento, manutencao_agendada, "
                + "janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, incidente, monitor, "
                + "manutencao_manual, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        ana = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Ana Operadora', 'ana@anuncio.test', 'hash-irrelevante', 'OPERADOR', true, false) returning id");
        bruno = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Bruno Operador', 'bruno@anuncio.test', 'hash-irrelevante', 'OPERADOR', true, false) returning id");
        tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        centro = insert("insert into unidade (nome, sigla, ativo) values ('Sesc Socorro', 'SOC', true) returning id");
        vazia = insert("insert into unidade (nome, sigla, ativo) values ('Unidade Nova', 'NOV', true) returning id");
        // Ids fora da ordem alfabetica: o texto lista por nome, nao por id.
        sw = equipamento("SW-CORE");
        ap = equipamento("AP-01");
        nvr = equipamento("NVR");
        monitorSw = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                + "falhas_para_incidente, sucessos_para_recovery) "
                + "values (?, 'ICMP', 'ICMP CORE', 60, 2000, true, 3, 2) returning id", sw);
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA') returning id",
                monitorSw, Timestamp.from(agora.minus(Duration.ofDays(1))));
    }

    // --- inicio -----------------------------------------------------------------------------

    @Test
    void ativacaoPeloJobAnuncia() {
        // 47 min de atraso: abaixo de 2 x intervalo (2 h), entao NAO e "sistema esteve fora".
        Instant inicio = agora.minus(47, MINUTES);
        Instant fim = agora.plus(1, HOURS);
        long j = janela("AGENDADA", EscopoManutencao.EQUIPAMENTOS, centro, inicio, fim, ana, sw, ap);

        reconciliador.reconciliar(agora);

        assertThat(status(j)).isEqualTo("ATIVA");
        assertThat(contar("MANUTENCAO_INICIADA")).isEqualTo(1);
        assertThat(ancora("MANUTENCAO_INICIADA")).isEqualTo(j);
        assertThat(mensagem("MANUTENCAO_INICIADA")).isEqualTo("""
                🔧 MANUTENÇÃO INICIADA — alertas suspensos

                Unidade: Sesc Socorro
                Escopo: 2 equipamentos — AP-01, SW-CORE
                Motivo: Troca do switch core
                Início: %s
                Fim previsto: %s
                Agendada por: Ana Operadora
                Janela: #%d
                %s""".formatted(hora(agora), hora(fim), j, rodape(agora)));
    }

    @Test
    void ativacaoImediataNaCriacaoAnuncia() {
        Instant inicio = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        ManutencaoResponse r = service.criar(new CriarManutencaoRequest(centro, EscopoManutencao.UNIDADE, null,
                inicio, inicio.plus(Duration.ofHours(2)), "Troca do switch core"), ana);

        assertThat(status(r.id())).isEqualTo("ATIVA");
        assertThat(contar("MANUTENCAO_INICIADA")).isEqualTo(1);
        assertThat(ancora("MANUTENCAO_INICIADA")).isEqualTo(r.id());
        Instant ativadaEm = ativadaEm(r.id());
        assertThat(mensagem("MANUTENCAO_INICIADA")).contains(
                "Escopo: unidade inteira (3 equipamentos)", "Início: " + hora(ativadaEm),
                "Agendada por: Ana Operadora", "Janela: #" + r.id()).doesNotContain("previsto ");
        // O instante da linha e o mesmo do CAS: um agora so na transacao.
        assertThat(criadaEm("MANUTENCAO_INICIADA")).isEqualTo(ativadaEm);
    }

    @Test
    void ativacaoAtrasadaDizPrevisto() {
        Instant inicio = agora.minus(3, HOURS);
        long j = janela("AGENDADA", EscopoManutencao.EQUIPAMENTOS, centro, inicio, agora.plus(1, HOURS), ana, sw);

        reconciliador.reconciliar(agora);

        assertThat(mensagem("MANUTENCAO_INICIADA")).contains("Início: " + hora(agora) + " (previsto "
                + relativa(inicio, agora) + " — sistema esteve fora)", "Janela: #" + j);
    }

    @Test
    void inicioDeUnidadeVaziaAnunciaZero() {
        long j = janela("AGENDADA", EscopoManutencao.UNIDADE, vazia, agora.minusSeconds(30), agora.plus(1, HOURS), ana);

        reconciliador.reconciliar(agora);

        assertThat(status(j)).isEqualTo("ATIVA");
        assertThat(mensagem("MANUTENCAO_INICIADA")).contains("Unidade: Unidade Nova",
                "Escopo: unidade inteira (nenhum equipamento cadastrado)");
    }

    @Test
    void criadorDesativadoAindaApareceNoTexto() {
        long j = janela("AGENDADA", EscopoManutencao.EQUIPAMENTOS, centro, agora.minusSeconds(30),
                agora.plus(1, HOURS), ana, sw);
        jdbc.update("update usuarios set ativo = false where id = ?", ana);

        reconciliador.reconciliar(agora);

        assertThat(status(j)).isEqualTo("ATIVA");
        assertThat(mensagem("MANUTENCAO_INICIADA")).contains("Agendada por: Ana Operadora");
    }

    // --- fim --------------------------------------------------------------------------------

    @Test
    void conclusaoPeloJobComoPrevisto() {
        Instant inicio = agora.minus(2, HOURS);
        Instant fim = agora.minus(1, MINUTES);
        long j = janela("ATIVA", EscopoManutencao.EQUIPAMENTOS, centro, inicio, fim, ana, sw, nvr);

        reconciliador.reconciliar(agora);

        assertThat(status(j)).isEqualTo("CONCLUIDA");
        assertThat(contar("MANUTENCAO_ENCERRADA")).isEqualTo(1);
        assertThat(ancora("MANUTENCAO_ENCERRADA")).isEqualTo(j);
        assertThat(mensagem("MANUTENCAO_ENCERRADA")).isEqualTo("""
                ✅ MANUTENÇÃO ENCERRADA — alertas retomados

                Unidade: Sesc Socorro
                Escopo: 2 equipamentos — NVR, SW-CORE
                Motivo: Troca do switch core
                Período: %s → %s (2h 0m 0s)
                Término: como previsto
                Janela: #%d
                %s""".formatted(hora(inicio), hora(agora), j, rodape(inicio)));
    }

    @Test
    void encerrarAgoraDizAntecipadoPorQuem() {
        long j = janela("AGENDADA", EscopoManutencao.EQUIPAMENTOS, centro, agora.minusSeconds(30),
                agora.plus(3, HOURS), ana, sw);
        reconciliador.reconciliar(agora);   // inicio fica PENDENTE: dispatcher desligado
        Instant fim = fimPrevisto(j);

        service.encerrar(j, bruno);

        assertThat(status(j)).isEqualTo("CONCLUIDA");
        Instant encerradaEm = encerradaEm(j);
        assertThat(mensagem("MANUTENCAO_ENCERRADA")).contains(
                "Término: antecipado por Bruno Operador (previsto " + relativa(fim, encerradaEm) + ")",
                // MA32: o inicio ainda PENDENTE e cancelado e o fim vira o registro completo.
                "O aviso de início não foi entregue; este é o registro completo.");
        assertThat(statusDe("MANUTENCAO_INICIADA")).isEqualTo("CANCELADA");
        assertThat(criadaEm("MANUTENCAO_ENCERRADA")).isEqualTo(encerradaEm);
    }

    @Test
    void prorrogarAnunciaEFimDizAposProrrogacao() {
        Instant fimOriginal = agora.plus(1, HOURS).truncatedTo(ChronoUnit.MINUTES);
        long j = janela("ATIVA", EscopoManutencao.EQUIPAMENTOS, centro, agora.minus(30, MINUTES), fimOriginal, ana, sw);
        Instant fimNovo = fimOriginal.plus(2, HOURS);

        service.alterarFim(j, new AlterarFimRequest(fimNovo, versao(j)), bruno);

        assertThat(contar("MANUTENCAO_FIM_ALTERADO")).isEqualTo(1);
        assertThat(ancora("MANUTENCAO_FIM_ALTERADO")).isEqualTo(j);
        assertThat(mensagem("MANUTENCAO_FIM_ALTERADO")).startsWith("⏱️ MANUTENÇÃO PRORROGADA\n").contains(
                "Unidade: Sesc Socorro", "Escopo: 1 equipamento — SW-CORE",
                "Fim previsto: " + hora(fimOriginal) + " → " + hora(fimNovo), "Alterado por: Bruno Operador",
                "Janela: #" + j);
        // A linha leva o instante da alteracao registrada, o mesmo do CAS.
        assertThat(criadaEm("MANUTENCAO_FIM_ALTERADO")).isEqualTo(jdbc.queryForObject(
                "select alterado_em from manutencao_agendada_alteracao where manutencao_id = ?", Timestamp.class, j)
                .toInstant());

        Instant depois = fimNovo.plus(1, MINUTES);
        reconciliador.reconciliar(depois);

        assertThat(status(j)).isEqualTo("CONCLUIDA");
        assertThat(mensagem("MANUTENCAO_ENCERRADA")).contains("Término: como previsto, após prorrogação de "
                + relativa(fimOriginal, depois) + " para " + relativa(fimNovo, depois) + " por Bruno Operador");
    }

    @Test
    void antecipacaoSeguidaDeProrrogacaoUsaPrimeiroFimEUltimoAutor() {
        Instant fimOriginal = agora.plus(3, HOURS).truncatedTo(ChronoUnit.MINUTES);
        long j = janela("ATIVA", EscopoManutencao.EQUIPAMENTOS, centro, agora.minus(30, MINUTES), fimOriginal, ana, sw);
        Instant antecipado = fimOriginal.minus(2, HOURS);
        service.alterarFim(j, new AlterarFimRequest(antecipado, versao(j)), ana);
        Instant finalAntecipado = antecipado.minus(30, MINUTES);
        service.alterarFim(j, new AlterarFimRequest(finalAntecipado, versao(j)), bruno);

        assertThat(contar("MANUTENCAO_FIM_ALTERADO")).isEqualTo(2);
        assertThat(jdbc.queryForList("select mensagem from notificacao where tipo_evento = 'MANUTENCAO_FIM_ALTERADO' "
                + "order by id", String.class)).allSatisfy(m -> assertThat(m)
                .startsWith("⏱️ FIM DA MANUTENÇÃO ANTECIPADO\n"));

        Instant depois = finalAntecipado.plus(1, MINUTES);
        reconciliador.reconciliar(depois);

        assertThat(mensagem("MANUTENCAO_ENCERRADA")).contains("Término: como previsto, após antecipação de "
                + relativa(fimOriginal, depois) + " para " + relativa(finalAntecipado, depois) + " por Bruno Operador");
    }

    @Test
    void fimListaQuemSegueEmManutencao() {
        long j = janela("ATIVA", EscopoManutencao.EQUIPAMENTOS, centro, agora.minus(2, HOURS), agora.minus(1, MINUTES),
                ana, sw, ap, nvr);
        long outra = janela("ATIVA", EscopoManutencao.EQUIPAMENTOS, centro, agora.minus(1, HOURS), agora.plus(1, HOURS),
                ana, ap);
        jdbc.update("update equipamento set manutencao_manual = true, em_manutencao = true where id = ?", sw);

        reconciliador.reconciliar(agora);

        assertThat(status(j)).isEqualTo("CONCLUIDA");
        assertThat(status(outra)).isEqualTo("ATIVA");
        assertThat(mensagem("MANUTENCAO_ENCERRADA"))
                .contains("Seguem em manutenção: AP-01 (janela #" + outra + "), SW-CORE (manual)")
                .doesNotContain("NVR (");
    }

    @Test
    void anuncioVemAntesDosEncerramentosIndividuais() {
        long incidente = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitorSw,
                Timestamp.from(agora.minus(1, HOURS)));
        jdbc.update("insert into notificacao (incidente_id, canal, tipo_evento, status, mensagem, enviado_em) "
                + "values (?, 'TELEGRAM', 'INCIDENTE_ABERTO', 'ENVIADA', 'abertura', now())", incidente);
        long j = janela("AGENDADA", EscopoManutencao.UNIDADE, centro, agora.minusSeconds(30), agora.plus(1, HOURS), ana);

        reconciliador.reconciliar(agora);

        long anuncio = idDe("MANUTENCAO_INICIADA");
        long encerramento = idDe("INCIDENTE_ENCERRADO_MANUTENCAO");
        assertThat(anuncio).isLessThan(encerramento);
        assertThat(ancora("MANUTENCAO_INICIADA")).isEqualTo(j);
    }

    @Test
    void falhaDoTelegramNaoImpedeAtivacao() {
        long j = janela("AGENDADA", EscopoManutencao.EQUIPAMENTOS, centro, agora.minusSeconds(30),
                agora.plus(1, HOURS), ana, sw);

        reconciliador.reconciliar(agora);

        assertThat(status(j)).isEqualTo("ATIVA");
        assertThat(statusDe("MANUTENCAO_INICIADA")).isEqualTo("PENDENTE");
        assertThat(jdbc.queryForObject("select em_manutencao from equipamento where id = ?", Boolean.class, sw))
                .isTrue();
    }

    /**
     * MA31 por janela: a transicao cuja montagem de anuncio falha volta sozinha (nunca ATIVA sem
     * anuncio) e e tentada de novo na passada seguinte; as demais janelas da mesma passada ativam e
     * concluem normalmente. Antes, um lote so: uma janela quebrada desfazia todas e parava a passada.
     */
    @Test
    void janelaComAnuncioQuebradoNaoBloqueiaAsDemais() {
        long quebrada = janela("AGENDADA", EscopoManutencao.EQUIPAMENTOS, centro, agora.minusSeconds(30),
                agora.plus(1, HOURS), ana, sw);
        long boa = janela("AGENDADA", EscopoManutencao.EQUIPAMENTOS, centro, agora.minusSeconds(20),
                agora.plus(1, HOURS), ana, ap);
        long vencida = janela("ATIVA", EscopoManutencao.EQUIPAMENTOS, centro, agora.minus(2, HOURS),
                agora.minus(1, MINUTES), ana, nvr);
        doThrow(new IllegalStateException("anuncio quebrado")).when(notificacoes).criarParaManutencaoIniciada(
                argThat(j -> j != null && j.id() == quebrada), any(Instant.class), anyBoolean());
        Logger logger = (Logger) LoggerFactory.getLogger(ReconciliadorManutencao.class);
        ListAppender<ILoggingEvent> registros = new ListAppender<>();
        registros.start();
        logger.addAppender(registros);
        try {
            var r = reconciliador.reconciliar(agora);

            assertThat(r.ativadas()).extracting(CoberturaManutencao.Transicao::manutencaoId).containsExactly(boa);
            assertThat(r.concluidas()).extracting(CoberturaManutencao.Transicao::manutencaoId)
                    .containsExactly(vencida);
        } finally {
            logger.detachAppender(registros);
        }
        assertThat(status(quebrada)).isEqualTo("AGENDADA");
        assertThat(status(boa)).isEqualTo("ATIVA");
        assertThat(status(vencida)).isEqualTo("CONCLUIDA");
        assertThat(jdbc.queryForList("select manutencao_agendada_id from notificacao where tipo_evento = "
                + "'MANUTENCAO_INICIADA'", Long.class)).containsExactly(boa);
        assertThat(ancora("MANUTENCAO_ENCERRADA")).isEqualTo(vencida);
        assertThat(registros.list).anySatisfy(e -> {
            assertThat(e.getLevel()).isEqualTo(Level.ERROR);
            assertThat(e.getFormattedMessage()).contains("janela " + quebrada);
        });

        reset(notificacoes);
        reconciliador.reconciliar(agora.plusSeconds(30));

        assertThat(status(quebrada)).isEqualTo("ATIVA");
        assertThat(jdbc.queryForObject("select count(*) from notificacao where tipo_evento = 'MANUTENCAO_INICIADA' "
                + "and manutencao_agendada_id = ?", Integer.class, quebrada)).isEqualTo(1);
    }

    /**
     * "Sistema esteve fora" so pelo job: na criacao com inicio poucos minutos atras (tolerancia de 5 min)
     * o servidor estava no ar; com o intervalo padrao de 30 s, 2 min ja passaria do limite de 2 x intervalo.
     */
    @Test
    void ativacaoNaCriacaoNuncaDizAtrasada() {
        long intervalo = props.getIntervaloMs();
        props.setIntervaloMs(30_000);
        try {
            Instant inicio = Instant.now().minus(2, MINUTES).truncatedTo(ChronoUnit.SECONDS);
            ManutencaoResponse r = service.criar(new CriarManutencaoRequest(centro, EscopoManutencao.EQUIPAMENTOS,
                    List.of(sw), inicio, inicio.plus(1, HOURS), "Troca do switch core"), ana);

            assertThat(status(r.id())).isEqualTo("ATIVA");
            assertThat(mensagem("MANUTENCAO_INICIADA")).contains("Início: ").doesNotContain("(previsto");
        } finally {
            props.setIntervaloMs(intervalo);
        }
    }


    // --- caminhos que nao anunciam ----------------------------------------------------------

    @Test
    void cancelarNaoAnuncia() {
        ManutencaoResponse r = futura();

        service.cancelar(r.id(), bruno);

        assertThat(status(r.id())).isEqualTo("CANCELADA");
        assertThat(totalNotificacoes()).isZero();
    }

    @Test
    void expirarNaoAnuncia() {
        long j = janela("AGENDADA", EscopoManutencao.EQUIPAMENTOS, centro, agora.minus(3, HOURS),
                agora.minus(1, HOURS), ana, sw);

        reconciliador.reconciliar(agora);

        assertThat(status(j)).isEqualTo("EXPIRADA");
        assertThat(totalNotificacoes()).isZero();
    }

    @Test
    void editarAgendadaNaoAnuncia() {
        ManutencaoResponse r = futura();

        service.editar(r.id(), new EditarManutencaoRequest(centro, EscopoManutencao.EQUIPAMENTOS, List.of(sw, ap),
                r.inicioPrevisto().plus(1, HOURS), r.fimPrevisto().plus(1, HOURS), "Outro motivo", r.versao()), bruno);

        assertThat(status(r.id())).isEqualTo("AGENDADA");
        assertThat(totalNotificacoes()).isZero();
    }

    @Test
    void edicaoQueTrazOInicioParaAgoraAnuncia() {
        ManutencaoResponse r = futura();
        Instant inicio = Instant.now().truncatedTo(ChronoUnit.SECONDS);

        service.editar(r.id(), new EditarManutencaoRequest(centro, EscopoManutencao.EQUIPAMENTOS, List.of(sw),
                inicio, inicio.plus(1, HOURS), "Troca do switch core", r.versao()), bruno);

        assertThat(status(r.id())).isEqualTo("ATIVA");
        assertThat(contar("MANUTENCAO_INICIADA")).isEqualTo(1);
        // "Agendada por" e o criador da janela, nao quem editou.
        assertThat(mensagem("MANUTENCAO_INICIADA")).contains("Agendada por: Ana Operadora");
    }

    // ---------------------------------------------------------------------------------------

    private ManutencaoResponse futura() {
        Instant inicio = Instant.now().plus(2, HOURS).truncatedTo(ChronoUnit.SECONDS);
        return service.criar(new CriarManutencaoRequest(centro, EscopoManutencao.EQUIPAMENTOS, List.of(sw), inicio,
                inicio.plus(1, HOURS), "Troca do switch core"), ana);
    }

    private long janela(String status, EscopoManutencao escopo, long unidade, Instant inicio, Instant fim, long criador,
                        long... equipamentos) {
        Timestamp ativadaEm = "ATIVA".equals(status) ? Timestamp.from(inicio) : null;
        long id = insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, motivo, "
                + "status, criado_por_id, ativada_em) values (?, ?, ?, ?, 'Troca do switch core', ?, ?, ?) returning id",
                unidade, escopo.name(), Timestamp.from(inicio), Timestamp.from(fim), status, criador, ativadaEm);
        for (long e : equipamentos) {
            jdbc.update("insert into manutencao_agendada_equipamento (manutencao_id, equipamento_id) values (?, ?)",
                    id, e);
        }
        return id;
    }

    private long equipamento(String nome) {
        return insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ativo, em_manutencao) "
                + "values (?, ?, ?, true, false) returning id", centro, tipo, nome);
    }

    private String status(long janela) {
        return jdbc.queryForObject("select status from manutencao_agendada where id = ?", String.class, janela);
    }

    private int versao(long janela) {
        return jdbc.queryForObject("select versao from manutencao_agendada where id = ?", Integer.class, janela);
    }

    private Instant ativadaEm(long janela) {
        return jdbc.queryForObject("select ativada_em from manutencao_agendada where id = ?", Timestamp.class, janela)
                .toInstant();
    }

    private Instant encerradaEm(long janela) {
        return jdbc.queryForObject("select encerrada_em from manutencao_agendada where id = ?", Timestamp.class, janela)
                .toInstant();
    }

    private Instant fimPrevisto(long janela) {
        return jdbc.queryForObject("select fim_previsto from manutencao_agendada where id = ?", Timestamp.class, janela)
                .toInstant();
    }

    private int contar(String tipoEvento) {
        return jdbc.queryForObject("select count(*) from notificacao where tipo_evento = ?", Integer.class, tipoEvento);
    }

    private int totalNotificacoes() {
        return jdbc.queryForObject("select count(*) from notificacao", Integer.class);
    }

    private long idDe(String tipoEvento) {
        return jdbc.queryForObject("select id from notificacao where tipo_evento = ?", Long.class, tipoEvento);
    }

    private long ancora(String tipoEvento) {
        return jdbc.queryForObject("select manutencao_agendada_id from notificacao where tipo_evento = ?", Long.class,
                tipoEvento);
    }

    private String mensagem(String tipoEvento) {
        return jdbc.queryForObject("select mensagem from notificacao where tipo_evento = ?", String.class, tipoEvento);
    }

    private String statusDe(String tipoEvento) {
        return jdbc.queryForObject("select status from notificacao where tipo_evento = ?", String.class, tipoEvento);
    }

    private Instant criadaEm(String tipoEvento) {
        return jdbc.queryForObject("select created_at from notificacao where tipo_evento = ?", Timestamp.class,
                tipoEvento).toInstant();
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    private static String hora(Instant instante) {
        return HORA.format(instante.atZone(FUSO));
    }

    /** Mesma regra do builder: so HH:mm no mesmo dia local da referencia. */
    private static String relativa(Instant instante, Instant referencia) {
        return instante.atZone(FUSO).toLocalDate().equals(referencia.atZone(FUSO).toLocalDate())
                ? HORA_CURTA.format(instante.atZone(FUSO)) : hora(instante);
    }

    private static String rodape(Instant referencia) {
        String offset = FUSO.getRules().getOffset(referencia).getId();
        return "Horários: UTC" + ("Z".equals(offset) ? "+00:00" : offset) + " (America/Sao_Paulo)";
    }
}

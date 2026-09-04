package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.incidente.dto.CloseIncidenteRequest;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.incidente.service.IncidenteService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Corrida real contra PostgreSQL para a criacao de notificacao.
 *
 * <p>Existe porque o bug que originou esta correcao nao aparecia em teste de unidade: o
 * antigo {@code criarPendente} fazia SELECT-de-verificacao e absorvia a
 * DataIntegrityViolationException num catch, e com repositorio mockado esse catch parecia
 * correto. Contra o banco de verdade ele nao era. Rodando este teste sobre a versao antiga
 * do service, a thread perdedora falha com {@code org.hibernate.AssertionFailure: Entry
 * for instance of Notificacao has a null identifier (this can happen if the session is
 * flushed after an exception occurs)}: a violacao de constraint deixa a sessao
 * inconsistente e absorver a excecao so adia o estouro. Precisa de duas transacoes fisicas
 * concorrentes para reproduzir.
 *
 * <p>A janela e forcada de forma deterministica: uma transacao insere e segura sem
 * commitar, e o teste so a libera depois de confirmar em {@code pg_stat_activity} que a
 * outra sessao esta genuinamente bloqueada no indice unico. Sem essa confirmacao o teste
 * falha em vez de passar por acidente de escalonamento.
 */
@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-test",
        "app.auth.jwt.access-token-minutes=15",
        "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false"
})
class NotificacaoConcorrenciaPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant T0 = Instant.parse("2026-09-01T08:00:00Z");
    private static final Duration LIMITE = Duration.ofSeconds(10);

    @Autowired private JdbcTemplate jdbc;
    @Autowired private NotificacaoService notificacaoService;
    @Autowired private IncidenteService incidenteService;
    @Autowired private IncidenteRepository incidenteRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    private long incidenteAberto;
    private long monitorId;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @BeforeEach
    void montarCenario() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");

        long tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        long unidade = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        long equipamento = insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, "
                + "em_manutencao) values (?, ?, 'SW-CORE', '10.0.0.10', true, false) returning id", unidade, tipo);
        monitorId = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                + "falhas_para_incidente, sucessos_para_recovery) "
                + "values (?, 'ICMP', 'ICMP CORE', 60, 2000, true, 3, 2) returning id", equipamento);
        incidenteAberto = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitorId, Timestamp.from(T0));
    }

    @Test
    void duasTransacoesConcorrentesNaMesmaAncoraProduzemUmaUnicaLinha() throws Exception {
        CountDownLatch aInseriu = new CountDownLatch(1);
        CountDownLatch aPodeCommitar = new CountDownLatch(1);
        List<Throwable> falhas = new CopyOnWriteArrayList<>();

        Thread a = new Thread(() -> executarEmTransacao(falhas, () -> {
            criarNotificacaoDeFechamento();
            aInseriu.countDown();
            aguardar(aPodeCommitar);
        }), "notificacao-A");

        Thread b = new Thread(() -> executarEmTransacao(falhas, this::criarNotificacaoDeFechamento), "notificacao-B");

        a.start();
        assertThat(aInseriu.await(LIMITE.toSeconds(), TimeUnit.SECONDS)).isTrue();
        b.start();

        // Sem esta confirmacao o teste poderia passar com B rodando so depois do commit de
        // A — caminho trivial, que ja funcionava antes da correcao.
        assertThat(aguardarBloqueioNoIndiceUnico())
                .as("B precisa estar bloqueado no indice unico; sem isso a janela do bug nao foi exercitada")
                .isTrue();

        aPodeCommitar.countDown();
        a.join(LIMITE.toMillis());
        b.join(LIMITE.toMillis());

        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();
        assertThat(contarNotificacoes()).isEqualTo(1);
    }

    @Test
    void chamadaRepetidaNaoDuplicaNemLancaExcecao() {
        emTransacao(() -> {
            criarNotificacaoDeFechamento();
            criarNotificacaoDeFechamento();
            criarNotificacaoDeFechamento();
        });

        assertThat(contarNotificacoes()).isEqualTo(1);
    }

    @Test
    void doNothingSemAlvoNaoAfrouxaCheckNemChaveEstrangeira() {
        // Evento de incidente pendurado em episodio viola ck_notificacao_evento_coerente:
        // ON CONFLICT DO NOTHING so ignora conflito de indice unico, nunca CHECK.
        assertThatThrownBy(() -> jdbc.update("insert into notificacao (episodio_latencia_id, canal, tipo_evento, "
                + "status, mensagem) values (null, 'TELEGRAM', 'INCIDENTE_ABERTO', 'PENDENTE', 'x') "
                + "on conflict do nothing"))
                .isInstanceOf(Exception.class);

        assertThatThrownBy(() -> jdbc.update("insert into notificacao (incidente_id, canal, tipo_evento, status, "
                + "mensagem) values (999999, 'TELEGRAM', 'INCIDENTE_ABERTO', 'PENDENTE', 'x') on conflict do nothing"))
                .isInstanceOf(Exception.class);

        assertThat(contarNotificacoes()).isZero();
    }

    /**
     * Laco completo entre o bug original e a correcao. {@code fechar()} nao tem CAS: as
     * duas threads leem ABERTO e as duas escrevem. Isso continua sendo last-write-wins na
     * linha do incidente — benigno, e nao e o que se corrigiu. O que mudou e o efeito
     * colateral: antes a segunda notificacao podia vazar como 500, agora convergem para
     * exatamente uma linha.
     */
    @Test
    void doisFecharConcorrentesFechamUmaVezEGeramUmaUnicaNotificacao() throws Exception {
        CyclicBarrier partida = new CyclicBarrier(2);
        List<Throwable> falhas = new CopyOnWriteArrayList<>();
        CloseIncidenteRequest requisicao = new CloseIncidenteRequest(T0.plusSeconds(600), null);

        Runnable fechar = () -> {
            try {
                partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
                incidenteService.fechar(incidenteAberto, requisicao);
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        };

        Thread a = new Thread(fechar, "fechar-A");
        Thread b = new Thread(fechar, "fechar-B");
        a.start();
        b.start();
        a.join(LIMITE.toMillis());
        b.join(LIMITE.toMillis());

        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();
        assertThat(jdbc.queryForObject("select status from incidente where id = ?", String.class, incidenteAberto))
                .isEqualTo("FECHADO");
        assertThat(jdbc.queryForObject("select count(*) from incidente where status = 'FECHADO'", Integer.class))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from notificacao where tipo_evento = 'INCIDENTE_FECHADO'",
                Integer.class)).isEqualTo(1);
    }

    private void criarNotificacaoDeFechamento() {
        // Carregado dentro da transacao corrente: o message builder navega monitor,
        // equipamento e unidade, todos lazy.
        notificacaoService.criarParaIncidenteFechado(incidenteRepository.findById(incidenteAberto).orElseThrow());
    }

    private void emTransacao(Runnable acao) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> acao.run());
    }

    private void executarEmTransacao(List<Throwable> falhas, Runnable acao) {
        try {
            emTransacao(acao);
        } catch (Throwable erro) {
            falhas.add(erro);
        }
    }

    /** Confirma que alguma sessao esta esperando por lock no INSERT em notificacao. */
    private boolean aguardarBloqueioNoIndiceUnico() throws InterruptedException {
        Instant limite = Instant.now().plus(LIMITE);
        while (Instant.now().isBefore(limite)) {
            Integer bloqueadas = jdbc.queryForObject("select count(*) from pg_stat_activity "
                    + "where datname = current_database() and wait_event_type = 'Lock' "
                    + "and query ilike '%insert into notificacao%'", Integer.class);
            if (bloqueadas != null && bloqueadas > 0) {
                return true;
            }
            Thread.sleep(50);
        }
        return false;
    }

    private void aguardar(CountDownLatch latch) {
        try {
            if (!latch.await(LIMITE.toSeconds(), TimeUnit.SECONDS)) {
                throw new IllegalStateException("liberacao da transacao nao chegou no tempo esperado");
            }
        } catch (InterruptedException erro) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(erro);
        }
    }

    private int contarNotificacoes() {
        return jdbc.queryForObject("select count(*) from notificacao", Integer.class);
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}

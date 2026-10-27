package br.com.inframonitor.monitoring.latency;

import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.medicao.entity.Medicao;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.mockito.invocation.InvocationOnMock;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;

/**
 * Integracao real contra PostgreSQL para o encerramento do episodio de latencia disputado
 * entre o motor (normalizacao) e a entrada em manutencao — A2 e A2b da auditoria de
 * concorrencia.
 *
 * <p>A2: o processor lia o episodio aberto, chamava encerrar() e fazia saveAndFlush —
 * UPDATE de todas as colunas WHERE id = ?, sem versao. Uma manutencao commitada entre a
 * leitura e a escrita era sobrescrita: motivo NORMALIZACAO por cima de MANUTENCAO, e os
 * dois avisos (LATENCIA_ENCERRADA_MANUTENCAO e LATENCIA_NORMALIZADA) no grupo.
 *
 * <p>A2b: a manutencao le os ids dos episodios abertos ANTES do bulk update. Se o motor
 * normaliza um deles nesse intervalo, o bulk update o pula, mas a releitura sem filtro
 * mandava LATENCIA_ENCERRADA_MANUTENCAO de um episodio que a manutencao nao encerrou.
 *
 * <p>Gancho deterministico: {@code @MockitoSpyBean} nos repositorios, com doAnswer que so
 * pausa na thread de nome combinado ("motor" ou "manutencao"): chama o metodo real,
 * sinaliza que leu e espera o outro lado commitar. Qualquer outra thread passa direto.
 *
 * <p>Requer Docker. Sem Docker disponivel o teste e ignorado, nunca falha.
 */
@RequerDocker
@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-test",
        "app.auth.jwt.access-token-minutes=15",
        "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false"
})
class EpisodioLatenciaConcorrenciaPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant T0 = Instant.parse("2026-09-01T08:00:00Z");
    private static final Instant PENULTIMA_EM = T0.plusSeconds(120);
    private static final Instant ULTIMA_EM = T0.plusSeconds(180);
    private static final Duration LIMITE = Duration.ofSeconds(10);
    // Atraso aleatorio (0..N ms) depois da barreira, no idioma de
    // FechamentoManualConcorrenciaPostgresIntegrationTest: sem ele um dos lados vence
    // sempre e so um desfecho legitimo aparece. Aqui o atrasado e a manutencao: o motor
    // faz cinco leituras antes do CAS e, atrasado 0..4 ms, perdia 29/30. Manutencao
    // atrasada 0..6 ms: 6 MANUTENCAO / 24 NORMALIZACAO; 0..3 ms: 12 / 18.
    private static final long ATRASO_MAX_MANUTENCAO_MS = 3;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private EquipamentoService equipamentoService;
    @Autowired private LatencyEpisodeProcessor processor;
    @MockitoSpyBean private MedicaoRepository medicaoRepository;
    @MockitoSpyBean private MonitorEpisodioLatenciaRepository episodioRepository;
    // O mesmo limiar que o processor recebe: as medicoes do cenario ficam abaixo dele.
    @Value("${monitoring.latencia-degradada-ms:250}") private int limiarMs;
    @Value("${monitoring.latencia-ciclos:2}") private int ciclos;

    private long operadorId;

    @BeforeEach
    void limparBanco() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        operadorId = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Operador', 'operador@latencia.test', 'hash-irrelevante', 'OPERADOR', true, false) "
                + "returning id");
        // O cenario tem exatamente duas medicoes normais; outro valor pediria outro cenario.
        assertThat(ciclos).isEqualTo(2);
    }

    // ---------------------------------------------------------------------------
    // Deterministicos
    // ---------------------------------------------------------------------------

    /**
     * A2: o motor ja leu o episodio aberto e para na leitura das medicoes; a manutencao
     * encerra o episodio e commita; so entao o motor tenta normalizar.
     */
    @Test
    void normalizacaoComLeituraVelhaNaoSobrescreveManutencao() throws Exception {
        Cenario cenario = cenario();
        CountDownLatch leu = new CountDownLatch(1);
        CountDownLatch manutencaoCommitou = new CountDownLatch(1);
        doAnswer(invocacao -> {
            Object real = metodoReal(invocacao);
            if ("motor".equals(Thread.currentThread().getName())) {
                leu.countDown();
                assertThat(manutencaoCommitou.await(LIMITE.toSeconds(), TimeUnit.SECONDS)).isTrue();
            }
            return real;
        }).when(medicaoRepository).findByMonitorIdOrderByExecutadoEmDescIdDesc(anyLong(), any(Pageable.class));

        List<Throwable> falhas = new CopyOnWriteArrayList<>();
        Thread motor = new Thread(() -> executar(falhas, () -> processor.process(cenario.ultima())), "motor");
        motor.start();
        assertThat(leu.await(LIMITE.toSeconds(), TimeUnit.SECONDS)).as("motor chegou ao gancho; falhas=%s", falhas).isTrue();
        equipamentoService.entrarEmManutencao(cenario.equipamentoId(), operadorId);
        manutencaoCommitou.countDown();
        motor.join(LIMITE.toMillis());
        assertThat(motor.isAlive()).isFalse();
        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();

        Map<String, Object> linha = linha(cenario.episodioId());
        assertThat(linha).containsEntry("motivo_encerramento", "MANUTENCAO");
        assertThat(linha.get("encerrado_em")).isNotEqualTo(Timestamp.from(ULTIMA_EM));
        assertThat(contar(cenario.episodioId(), "LATENCIA_ENCERRADA_MANUTENCAO")).isEqualTo(1);
        assertThat(mensagemCoincideComLinha(cenario.episodioId(), "LATENCIA_ENCERRADA_MANUTENCAO")).isTrue();
        assertThat(contar(cenario.episodioId(), "LATENCIA_NORMALIZADA")).isZero();
    }

    /**
     * A2b: a manutencao ja leu os ids dos episodios abertos e para; o motor normaliza e
     * commita; so entao a manutencao faz o bulk update (que pula o episodio) e notifica.
     */
    @Test
    void manutencaoComLeituraVelhaNaoAvisaEpisodioNormalizado() throws Exception {
        Cenario cenario = cenario();
        CountDownLatch leu = new CountDownLatch(1);
        CountDownLatch motorCommitou = new CountDownLatch(1);
        doAnswer(invocacao -> {
            Object real = metodoReal(invocacao);
            if ("manutencao".equals(Thread.currentThread().getName())) {
                leu.countDown();
                assertThat(motorCommitou.await(LIMITE.toSeconds(), TimeUnit.SECONDS)).isTrue();
            }
            return real;
        }).when(episodioRepository).abertosDoEquipamento(anyLong());

        List<Throwable> falhas = new CopyOnWriteArrayList<>();
        Thread manutencao = new Thread(() -> executar(falhas,
                () -> equipamentoService.entrarEmManutencao(cenario.equipamentoId(), operadorId)), "manutencao");
        manutencao.start();
        assertThat(leu.await(LIMITE.toSeconds(), TimeUnit.SECONDS)).as("manutencao chegou ao gancho; falhas=%s", falhas).isTrue();
        processor.process(cenario.ultima());
        motorCommitou.countDown();
        manutencao.join(LIMITE.toMillis());
        assertThat(manutencao.isAlive()).isFalse();
        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();

        Map<String, Object> linha = linha(cenario.episodioId());
        assertThat(linha).containsEntry("motivo_encerramento", "NORMALIZACAO")
                .containsEntry("encerrado_em", Timestamp.from(ULTIMA_EM));
        assertThat(contar(cenario.episodioId(), "LATENCIA_NORMALIZADA")).isEqualTo(1);
        assertThat(mensagemCoincideComLinha(cenario.episodioId(), "LATENCIA_NORMALIZADA")).isTrue();
        assertThat(contar(cenario.episodioId(), "LATENCIA_ENCERRADA_MANUTENCAO")).isZero();
        // A manutencao em si aconteceu: o flag e a janela nao dependem do episodio.
        assertThat(jdbc.queryForObject("select em_manutencao from equipamento where id = ?", Boolean.class,
                cenario.equipamentoId())).isTrue();
    }

    // ---------------------------------------------------------------------------
    // Corrida real, repetida
    // ---------------------------------------------------------------------------

    /**
     * Legitimos: M — motivo MANUTENCAO, exatamente uma LATENCIA_ENCERRADA_MANUTENCAO com o
     * "Fim:" igual ao encerrado_em da linha, nenhuma LATENCIA_NORMALIZADA. N — motivo
     * NORMALIZACAO, encerrado_em = executado_em da ultima medicao, exatamente uma
     * LATENCIA_NORMALIZADA (criarParaLatenciaNormalizada cria sempre uma PENDENTE,
     * absorvida pela uq se repetida) com o "Fim:" da linha, nenhuma
     * LATENCIA_ENCERRADA_MANUTENCAO.
     */
    @RepeatedTest(30)
    void normalizacaoEEntrarEmManutencaoConcorrentes() throws Exception {
        Cenario cenario = cenario();

        List<Throwable> falhas = correr(
                () -> {
                    Thread.sleep(ThreadLocalRandom.current().nextLong(ATRASO_MAX_MANUTENCAO_MS + 1));
                    equipamentoService.entrarEmManutencao(cenario.equipamentoId(), operadorId);
                },
                () -> processor.process(cenario.ultima()));
        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();

        long episodioId = cenario.episodioId();
        Map<String, Object> linha = linha(episodioId);
        Object motivo = linha.get("motivo_encerramento");
        int encerradasPorManutencao = contar(episodioId, "LATENCIA_ENCERRADA_MANUTENCAO");
        int normalizadas = contar(episodioId, "LATENCIA_NORMALIZADA");
        boolean manutencao = "MANUTENCAO".equals(motivo) && encerradasPorManutencao == 1 && normalizadas == 0
                && mensagemCoincideComLinha(episodioId, "LATENCIA_ENCERRADA_MANUTENCAO");
        boolean normalizacao = "NORMALIZACAO".equals(motivo)
                && Timestamp.from(ULTIMA_EM).equals(linha.get("encerrado_em"))
                && normalizadas == 1 && encerradasPorManutencao == 0
                && mensagemCoincideComLinha(episodioId, "LATENCIA_NORMALIZADA");
        System.out.println("[corrida-latencia-manutencao] desfecho=" + (manutencao ? "MANUTENCAO"
                : normalizacao ? "NORMALIZACAO" : "ILEGITIMO") + " motivo=" + motivo
                + " encerradasPorManutencao=" + encerradasPorManutencao + " normalizadas=" + normalizadas
                + " encerradoEm=" + linha.get("encerrado_em"));

        assertThat(linha.get("encerrado_em")).isNotNull();
        assertThat(manutencao || normalizacao).as("um encerramento so: motivo, fim e aviso do MESMO vencedor")
                .isTrue();
    }

    // ---------------------------------------------------------------------------
    // Fixtures
    // ---------------------------------------------------------------------------

    private record Cenario(long equipamentoId, long episodioId, Medicao ultima) {
    }

    /**
     * Equipamento e monitor ativos, episodio aberto com LATENCIA_ALTA ja ENVIADA (a
     * manutencao entao avisa em vez de so cancelar), janela aberta e duas medicoes
     * SUCESSO abaixo do limiar: a ultima normaliza o episodio.
     */
    private Cenario cenario() {
        long tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        long unidade = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        long equipamentoId = insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, "
                + "ativo, em_manutencao) values (?, ?, 'SW-CORE', '10.0.0.10', true, false) returning id",
                unidade, tipo);
        long monitorId = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, "
                + "ativo, falhas_para_incidente, sucessos_para_recovery) "
                + "values (?, 'ICMP', 'ICMP CORE', 60, 2000, true, 3, 2) returning id", equipamentoId);
        long episodioId = insert("insert into monitor_episodio_latencia (monitor_id, iniciado_em, limiar_ms) "
                + "values (?, ?, ?) returning id", monitorId, Timestamp.from(T0), limiarMs);
        insert("insert into notificacao (episodio_latencia_id, canal, tipo_evento, status, mensagem, enviado_em) "
                + "values (?, 'TELEGRAM', 'LATENCIA_ALTA', 'ENVIADA', 'msg', ?) returning id",
                episodioId, Timestamp.from(T0));
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA') "
                + "returning id", monitorId, Timestamp.from(T0));
        int normal = limiarMs / 2;
        insert("insert into medicao (monitor_id, status, latencia_ms, mensagem, executado_em) "
                + "values (?, 'SUCESSO', ?, 'ok', ?) returning id", monitorId, normal, Timestamp.from(PENULTIMA_EM));
        long ultimaId = insert("insert into medicao (monitor_id, status, latencia_ms, mensagem, executado_em) "
                + "values (?, 'SUCESSO', ?, 'ok', ?) returning id", monitorId, normal, Timestamp.from(ULTIMA_EM));
        return new Cenario(equipamentoId, episodioId, medicaoRepository.findById(ultimaId).orElseThrow());
    }

    /**
     * Chamada ao repositorio de verdade. callRealMethod nao serve: o bean e um proxy JDK
     * do Spring Data e o metodo da interface e abstrato. O spy do Spring ja nasce com uma
     * resposta padrao que chega ao proxy original; o gancho reusa essa resposta.
     */
    private static Object metodoReal(InvocationOnMock invocacao) throws Throwable {
        return Mockito.mockingDetails(invocacao.getMock()).getMockCreationSettings().getDefaultAnswer()
                .answer(invocacao);
    }

    private interface Acao {
        void executar() throws Exception;
    }

    private void executar(List<Throwable> falhas, Acao acao) {
        try {
            acao.executar();
        } catch (Throwable erro) {
            falhas.add(erro);
        }
    }

    /** Duas threads reais, cada uma na sua transacao, alinhadas por barreira. */
    private List<Throwable> correr(Acao primeira, Acao segunda) throws InterruptedException {
        CyclicBarrier partida = new CyclicBarrier(2);
        List<Throwable> falhas = new CopyOnWriteArrayList<>();
        Thread a = new Thread(() -> largar(partida, falhas, primeira), "corrida-A");
        Thread b = new Thread(() -> largar(partida, falhas, segunda), "corrida-B");
        a.start();
        b.start();
        a.join(LIMITE.toMillis());
        b.join(LIMITE.toMillis());
        return falhas;
    }

    private void largar(CyclicBarrier partida, List<Throwable> falhas, Acao acao) {
        executar(falhas, () -> {
            partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
            acao.executar();
        });
    }

    /** Exatamente uma notificacao do tipo, e o "Fim:" dela e o encerrado_em da linha. */
    private boolean mensagemCoincideComLinha(long episodioId, String tipoEvento) {
        List<String> mensagens = jdbc.queryForList("select mensagem from notificacao where episodio_latencia_id = ? "
                + "and tipo_evento = ?", String.class, episodioId, tipoEvento);
        Timestamp encerradoEm = jdbc.queryForObject("select encerrado_em from monitor_episodio_latencia "
                + "where id = ?", Timestamp.class, episodioId);
        return mensagens.size() == 1 && encerradoEm != null
                && mensagens.get(0).contains("Fim: " + java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm").withZone(java.time.ZoneId.of("America/Sao_Paulo")).format(encerradoEm.toInstant()));
    }

    private Map<String, Object> linha(long episodioId) {
        return jdbc.queryForMap("select motivo_encerramento, encerrado_em from monitor_episodio_latencia "
                + "where id = ?", episodioId);
    }

    private int contar(long episodioId, String tipoEvento) {
        return jdbc.queryForObject("select count(*) from notificacao where episodio_latencia_id = ? "
                + "and tipo_evento = ?", Integer.class, episodioId, tipoEvento);
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}

package br.com.inframonitor.medicao;

import br.com.inframonitor.dashboard.DashboardReadRepository;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.relatorio.service.DisponibilidadeSqlRepository;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Trava de desempenho das consultas que liam a medicao inteira. Mede linhas lidas, nao tempo. O
 * contador vem das estatisticas pg_stat_xact_*, que contam o que a PROPRIA transacao leu da medicao
 * (heap em seq scan mais entradas de indice; o PostgreSQL 16 nao tem a view
 * pg_stat_xact_user_indexes, a funcao pg_stat_get_xact_tuples_returned da o mesmo numero por
 * indice), entao o numero e deterministico e independe da maquina e do plano escolhido. Tempo seria
 * instavel em CI; "sem seq scan" nao pegaria o plano que varre ix_medicao_executado_em inteiro.
 *
 * <p>O cenario inclui os monitores que derrubavam o plano com "=": um sem medicao nenhuma e um
 * inativo cuja ultima medicao e anterior a todo o resto. Sem eles o teste passaria por sorte.
 *
 * <p>A prova de reversao fica no proprio teste: o oraculo (a consulta antiga, congelada em
 * src/test/resources/oraculo-medicao) passa pelo mesmo medidor e precisa estourar o teto. Se o
 * codigo de producao voltar ao desenho antigo, a assercao de producao falha com o mesmo numero.
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
class LeituraDeMedicaoLimitadaPostgresIntegrationTest {
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final int MONITORES_COM_HISTORICO = 20;
    private static final int MEDICOES_POR_MONITOR = 2_000;
    private static final int MEDICOES = MONITORES_COM_HISTORICO * MEDICOES_POR_MONITOR;
    /** Os 20 com historico, mais o sem medicao e o inativo antigo. */
    private static final int MONITORES = MONITORES_COM_HISTORICO + 2;
    /** Folga de 10 leituras por monitor para empates e ordenacao incremental; a medicao tem 40 mil linhas. */
    private static final long TETO = 10L * MONITORES;
    private static final Instant INICIO = Instant.parse("2026-07-01T00:00:00Z");

    @Autowired private JdbcTemplate jdbc;
    @Autowired private TransactionTemplate transacao;
    @Autowired private MonitorRepository monitorRepository;
    @Autowired private MedicaoRepository medicaoRepository;
    @Autowired private DashboardReadRepository dashboard;
    @Autowired private DisponibilidadeSqlRepository disponibilidade;
    @Autowired private NamedParameterJdbcTemplate named;

    private long unidadeId;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @BeforeEach
    void montarHistorico() {
        jdbc.execute("truncate table janela_monitoramento, medicao, incidente, notificacao, monitor, "
                + "equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        long tipo = jdbc.queryForObject("insert into tipo_equipamento (nome) values ('Switch') returning id", Long.class);
        long unidade = jdbc.queryForObject("insert into unidade (nome, sigla) values ('Sede', 'SEDE') returning id", Long.class);
        unidadeId = unidade;
        for (int i = 1; i <= MONITORES; i++) {
            boolean ativo = i != MONITORES;
            long equipamento = jdbc.queryForObject("insert into equipamento (unidade_id, tipo_equipamento_id, nome, "
                    + "ip_address) values (?, ?, ?, ?) returning id", Long.class, unidade, tipo, "EQ-" + i, "10.0.0." + i);
            long monitor = jdbc.queryForObject("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, "
                    + "timeout_ms, ativo) values (?, 'ICMP', ?, 60, 2000, ?) returning id", Long.class,
                    equipamento, "ping-" + i, ativo);
            if (ativo) {
                jdbc.update("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA')",
                        monitor, Timestamp.from(INICIO));
            }
        }
        // Janela fechada e vazia antes de todo o historico: no LATERAL com "=" ela varria o resto do monitor.
        jdbc.update("insert into janela_monitoramento (monitor_id, inicio_em, fim_em, origem) values (1, ?, ?, 'PRECISA')",
                Timestamp.from(INICIO.minusSeconds(10 * 86_400)), Timestamp.from(INICIO.minusSeconds(9 * 86_400)));
        // O inativo tem uma medicao so, anterior a todo o historico; o penultimo nao tem nenhuma.
        jdbc.update("insert into medicao (monitor_id, status, latencia_ms, executado_em) values (?, 'SUCESSO', 10, ?)",
                MONITORES, Timestamp.from(INICIO.minusSeconds(86_400)));
        // Mesma ordem de gravacao do motor (tempo, depois monitor): o indice fica com o formato real.
        jdbc.update("""
                insert into medicao (monitor_id, status, latencia_ms, executado_em)
                select m.id, 'SUCESSO', 10, ?::timestamptz + t * interval '1 minute'
                  from generate_series(0, ? - 1) t cross join monitor m
                 where m.id <= ?
                 order by t, m.id
                """, Timestamp.from(INICIO), MEDICOES_POR_MONITOR, MONITORES_COM_HISTORICO);
        jdbc.execute("analyze");
        assertThat(jdbc.queryForObject("select count(*) from medicao", Long.class)).isEqualTo(MEDICOES + 1);
    }

    @Test
    void agendadorLeUmaMedicaoPorMonitor() {
        long oraculo = linhasDeMedicaoLidas(() -> jdbc.queryForList(oraculo("agendador-original.sql")));
        long atual = linhasDeMedicaoLidas(monitorRepository::findActiveExecutionCandidates);

        assertThat(oraculo).as("oraculo precisa estourar o teto, senao o teste nao detecta reversao").isGreaterThanOrEqualTo(MEDICOES);
        assertThat(atual).as("agendador").isLessThanOrEqualTo(TETO);
    }

    @Test
    void estadosDoPainelLeemUmaMedicaoPorMonitor() {
        String oraculo = oraculo("estados-original.sql").replace("?1", "250");
        long lidoPeloOraculo = linhasDeMedicaoLidas(() ->
                jdbc.queryForList(oraculo + " select status, count(*) from equipamento_estado group by status"));

        assertThat(lidoPeloOraculo).isGreaterThanOrEqualTo(MEDICOES);
        assertThat(linhasDeMedicaoLidas(() -> dashboard.resumo(250))).as("resumo").isLessThanOrEqualTo(TETO);
        assertThat(linhasDeMedicaoLidas(() -> dashboard.equipamentos(250))).as("equipamentos").isLessThanOrEqualTo(TETO);
    }

    @Test
    void ultimaMedicaoPorMonitorNaoVarreOIndiceGlobal() {
        List<Long> todos = jdbc.queryForList("select id from monitor", Long.class);
        String oraculo = oraculo("ultima-medicao-original.sql").replace(":monitorIds",
                String.join(",", todos.stream().map(String::valueOf).toList()));
        long lidoPeloOraculo = linhasDeMedicaoLidas(() -> jdbc.queryForList(oraculo));

        // O oraculo ja era LATERAL; o defeito dele e de plano, nao de forma: com "=" e poucos
        // monitores o PostgreSQL varre ix_medicao_executado_em para tras, e o monitor sem medicao (e o
        // inativo antigo) percorre o indice inteiro. Neste cenario isso acontece de forma estavel.
        assertThat(lidoPeloOraculo).as("oraculo").isGreaterThan(TETO);
        assertThat(linhasDeMedicaoLidas(() -> medicaoRepository.findLatestByMonitorIds(todos)))
                .as("findLatestByMonitorIds").isLessThanOrEqualTo(TETO);
    }

    /** Desde a V24 o SLA le a primeira medicao da propria janela: zero linhas da medicao. */
    @Test
    void slaNaoLeAMedicao() {
        // Periodo de um dia no fim do historico: o custo antigo nao dependia do periodo pedido.
        Instant fim = INICIO.plus(Duration.ofMinutes(MEDICOES_POR_MONITOR));
        Instant inicio = fim.minus(Duration.ofDays(1));
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("inicio", Timestamp.from(inicio))
                .addValue("fim", Timestamp.from(fim)).addValue("unidadeId", null).addValue("equipamentoId", null)
                .addValue("monitorId", null).addValue("tipoId", null);
        long oraculo = linhasDeMedicaoLidas(() ->
                named.queryForList(oraculo("sla-base-original.sql") + " select * from linhas", p));

        assertThat(oraculo).as("oraculo precisa estourar o teto, senao o teste nao detecta reversao").isGreaterThanOrEqualTo(MEDICOES);
        assertThat(linhasDeMedicaoLidas(() -> disponibilidade.unidades(inicio, fim, null, 0, 20, "unidade_nome ASC")))
                .as("unidades").isZero();
        assertThat(linhasDeMedicaoLidas(() -> disponibilidade.equipamentos(inicio, fim, null, null, null, null, 0, 20,
                "equipamento_nome ASC"))).as("equipamentos").isZero();
        assertThat(linhasDeMedicaoLidas(() -> disponibilidade.diariaPorUnidade(inicio, fim, unidadeId)))
                .as("diaria").isZero();
    }

    @FunctionalInterface
    private interface Consulta { Object executar(); }

    /**
     * Linhas da medicao lidas pela consulta, na mesma transacao e sem paralelismo: um worker
     * paralelo conta no proprio backend e escaparia do pg_stat_xact do lider. A diferenca antes e
     * depois descarta o que ficou pendente de transacoes anteriores da mesma conexao.
     */
    private long linhasDeMedicaoLidas(Consulta consulta) {
        Long lidas = transacao.execute(status -> {
            jdbc.execute("set local max_parallel_workers_per_gather = 0");
            long antes = contadorDeLeitura();
            consulta.executar();
            return contadorDeLeitura() - antes;
        });
        return lidas == null ? -1 : lidas;
    }

    private long contadorDeLeitura() {
        // Na tabela, tuples_returned e o seq_tup_read; em cada indice, o idx_tup_read.
        return jdbc.queryForObject("""
                select pg_stat_get_xact_tuples_returned('medicao'::regclass)
                     + (select coalesce(sum(pg_stat_get_xact_tuples_returned(i.indexrelid)), 0)
                          from pg_index i where i.indrelid = 'medicao'::regclass)
                """, Long.class);
    }

    private static String oraculo(String arquivo) {
        try {
            return new ClassPathResource("oraculo-medicao/" + arquivo).getContentAsString(StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}

package br.com.inframonitor.medicao;

import br.com.inframonitor.dashboard.DashboardReadRepository;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.monitoring.execution.MonitorCandidate;
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
import org.testcontainers.containers.PostgreSQLContainer;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * As tres consultas que liam a medicao inteira (agendador, ESTADOS do painel, CTE janelas do SLA)
 * foram reescritas para ler O(monitores). Este teste trava a reescrita no resultado: cada uma
 * precisa devolver exatamente o mesmo que a versao antiga, congelada em
 * src/test/resources/oraculo-medicao, sobre um cenario com os casos de borda.
 *
 * <p>Os mesmos oraculos foram comparados com os bancos reais do dev e da carga (clones), registrado
 * em Docs/Back-End-Docs/medicao-crescimento-e-retencao.md; aqui fica a parte que roda em toda suite.
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
class ConsultasSobreMedicaoEquivalenciaPostgresIntegrationTest {
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant T = Instant.parse("2026-08-01T00:00:00Z");
    private static final int LIMIAR_DEGRADADO_MS = 250;

    @Autowired private JdbcTemplate jdbc;
    @Autowired private NamedParameterJdbcTemplate named;
    @Autowired private MonitorRepository monitorRepository;
    @Autowired private MedicaoRepository medicaoRepository;

    private long u1, u2, e1, m4;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @BeforeEach
    void montarCenario() {
        jdbc.execute("truncate table janela_monitoramento, medicao, incidente, notificacao, monitor, "
                + "equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        long tipo = jdbc.queryForObject("insert into tipo_equipamento (nome) values ('Switch') returning id", Long.class);
        u1 = unidade("Unidade 1");
        u2 = unidade("Unidade 2");

        // E1/M1: historico longo, janela fechada e janela aberta, medicoes nas duas, no vao entre
        // elas, exatamente no inicio da aberta (entra) e exatamente no fim da fechada (nao entra).
        e1 = equipamento(u1, tipo, "E1", "10.0.0.1", true, false);
        long m1 = monitor(e1, "M1", true);
        janela(m1, T.minus(dias(10)), T.minus(dias(5)));
        janela(m1, T.minus(dias(4)), null);
        for (Instant t = T.minus(dias(12)); t.isBefore(T.plus(dias(19))); t = t.plus(Duration.ofHours(6))) {
            medicao(m1, "SUCESSO", 20, t);
        }
        medicao(m1, "SUCESSO", 30, T.minus(dias(5)));
        medicao(m1, "FALHA", null, T.minus(dias(4)));
        incidente(m1, "FECHADO", T.minus(dias(6)), T.minus(dias(3)));
        incidente(m1, "ABERTO", T.plus(dias(18)), null);

        // E2/M2: monitor sem medicao nenhuma, com janela aberta.
        long e2 = equipamento(u1, tipo, "E2", "10.0.0.2", true, false);
        janela(monitor(e2, "M2", true), T.minus(dias(2)), null);

        // E3/M3: uma unica medicao, com latencia acima do limiar (DEGRADADO).
        long e3 = equipamento(u1, tipo, "E3", "10.0.0.3", true, false);
        long m3 = monitor(e3, "M3", true);
        janela(m3, T.minus(dias(3)), null);
        medicao(m3, "SUCESSO", 300, T.minus(dias(1)));

        // E4/M4: janela recem-aberta, ainda sem medicao, depois de uma fechada com historico; e
        // uma medicao anterior ao inicio da primeira janela, que nao pode contar.
        long e4 = equipamento(u2, tipo, "E4", "10.0.1.4", true, false);
        m4 = monitor(e4, "M4", true);
        medicao(m4, "SUCESSO", 15, T.minus(dias(9)));
        janela(m4, T.minus(dias(8)), T.minus(dias(1)));
        medicao(m4, "SUCESSO", 15, T.minus(dias(7)));
        medicao(m4, "SUCESSO", 15, T.minus(dias(2)));
        janela(m4, T.plus(dias(19)).plus(Duration.ofHours(12)), null);

        // E5/M5: em manutencao (fora do agendador), janela fechada com medicoes.
        long e5 = equipamento(u2, tipo, "E5", "10.0.1.5", true, true);
        long m5 = monitor(e5, "M5", true);
        janela(m5, T.minus(dias(6)), T.minus(dias(2)));
        medicao(m5, "SUCESSO", 10, T.minus(dias(5)));
        incidente(m5, "ABERTO", T.minus(dias(4)), null);

        // E6/M6: equipamento inativo, monitor inativo, com medicoes.
        long e6 = equipamento(u2, tipo, "E6", "10.0.1.6", false, false);
        long m6 = monitor(e6, "M6", false);
        medicao(m6, "SUCESSO", 10, T.minus(dias(3)));

        // E7: sem monitor (SEM_MONITORAMENTO).
        equipamento(u2, tipo, "E7", "10.0.1.7", true, false);

        // E8: dois monitores; M8a com empate em executado_em (o id maior decide) e insercao fora
        // de ordem; M8b ativo so com falhas.
        long e8 = equipamento(u2, tipo, "E8", "10.0.1.8", true, false);
        long m8a = monitor(e8, "M8a", true);
        long m8b = monitor(e8, "M8b", true);
        janela(m8a, T.minus(dias(1)), null);
        janela(m8b, T.minus(dias(1)), null);
        medicao(m8a, "SUCESSO", 10, T.plus(dias(1)));
        medicao(m8a, "SUCESSO", 10, T.minus(Duration.ofHours(12)));
        medicao(m8a, "SUCESSO", 10, T.plus(dias(2)));
        medicao(m8a, "SUCESSO", 400, T.plus(dias(2)));
        medicao(m8b, "FALHA", null, T.plus(dias(1)));
        medicao(m8b, "FALHA", null, T.plus(dias(3)));
    }

    @Test
    void agendadorDevolveOMesmoQueOOraculo() throws IOException {
        List<MonitorCandidate> oraculo = jdbc.query(oraculo("agendador-original.sql"), (r, n) -> new MonitorCandidate(
                r.getLong("monitor_id"), TipoMonitor.valueOf(r.getString("tipo")), r.getInt("intervalo_segundos"),
                r.getInt("timeout_ms"), r.getString("ip"),
                r.getTimestamp("ultima_medicao_em") == null ? null : r.getTimestamp("ultima_medicao_em").toInstant()));

        List<MonitorCandidate> atual = monitorRepository.findActiveExecutionCandidates();

        Comparator<MonitorCandidate> porMonitor = Comparator.comparing(MonitorCandidate::monitorId);
        assertThat(atual).hasSize(6);
        assertThat(atual.stream().sorted(porMonitor).toList()).isEqualTo(oraculo.stream().sorted(porMonitor).toList());
        assertThat(atual).anySatisfy(c -> assertThat(c.ultimaMedicaoEm()).isNull());
    }

    @Test
    void ultimaMedicaoPorMonitorDevolveOMesmoQueOOraculo() throws IOException {
        List<Long> todos = jdbc.queryForList("select id from monitor order by id", Long.class);
        List<Map<String, Object>> esperado = named.queryForList(
                oraculo("ultima-medicao-original.sql") + " order by md.monitor_id",
                new MapSqlParameterSource("monitorIds", todos));

        List<Map<String, Object>> atual = medicaoRepository.findLatestByMonitorIds(todos).stream()
                .sorted(Comparator.comparing(m -> m.getMonitor().getId()))
                .map(m -> Map.<String, Object>of("id", m.getId(), "monitor_id", m.getMonitor().getId()))
                .toList();

        assertThat(atual).hasSize(esperado.size()).hasSizeGreaterThan(5);
        assertThat(atual).isEqualTo(esperado.stream()
                .map(l -> Map.<String, Object>of("id", l.get("id"), "monitor_id", l.get("monitor_id"))).toList());
    }

    @Test
    void estadosDoPainelDevolvemOMesmoQueOOraculo() throws IOException {
        String oraculo = oraculo("estados-original.sql").replace("?1", ":limiar");
        String atual = DashboardReadRepository.ESTADOS.replace("?1", ":limiar");
        MapSqlParameterSource p = new MapSqlParameterSource("limiar", LIMIAR_DEGRADADO_MS);

        for (String consulta : List.of(" select * from monitor_estado order by id",
                " select * from equipamento_estado order by id")) {
            List<Map<String, Object>> esperado = named.queryForList(oraculo + consulta, p);
            assertThat(named.queryForList(atual + consulta, p)).as(consulta).isEqualTo(esperado);
        }
        assertThat(named.queryForList(atual + " select status from monitor_estado", p))
                .extracting(linha -> linha.get("status"))
                .contains("SEM_DADOS", "DEGRADADO", "DISPONIVEL", "INDISPONIVEL", "DESABILITADO");
    }

    @Test
    void slaDevolveOMesmoQueOOraculoEmTodosOsPeriodosEFiltros() throws IOException {
        String oraculo = oraculo("sla-base-original.sql");
        Instant fim = T.plus(dias(20));
        List<Instant[]> periodos = List.of(
                periodo(fim.minus(dias(30)), fim),
                periodo(T.minus(dias(6)), T.minus(dias(3))),
                periodo(fim.minus(dias(365)), fim),
                periodo(fim.minus(dias(1)), fim),
                periodo(T.minus(dias(400)), T.minus(dias(300))),
                periodo(T.plus(dias(30)), T.plus(dias(40))),
                periodo(T.minus(dias(5)).minus(Duration.ofHours(1)), T.minus(dias(5)).plus(Duration.ofHours(1))));
        List<Long[]> filtros = List.of(
                new Long[] {null, null, null}, new Long[] {u1, null, null}, new Long[] {u2, null, null},
                new Long[] {null, e1, null}, new Long[] {null, null, m4});

        int calculados = 0;
        for (Instant[] periodo : periodos) {
            for (Long[] filtro : filtros) {
                MapSqlParameterSource p = params(periodo, filtro[0], filtro[1], filtro[2]);
                String linhas = " select * from linhas order by equipamento_id, monitor_id";
                List<Map<String, Object>> esperado = named.queryForList(oraculo + linhas, p);
                List<Map<String, Object>> atual = named.queryForList(DisponibilidadeSqlRepository.BASE + linhas, p);
                assertThat(atual).as("periodo %s..%s filtro %s", periodo[0], periodo[1], Arrays.toString(filtro)).isEqualTo(esperado);
                calculados += (int) atual.stream().filter(l -> "CALCULADO".equals(l.get("estado"))).count();
            }
            for (long unidade : List.of(u1, u2)) {
                MapSqlParameterSource p = params(periodo, unidade, null, null).addValue("tz", "America/Sao_Paulo");
                assertThat(named.queryForList(DisponibilidadeSqlRepository.BASE + DisponibilidadeSqlRepository.DIARIA, p))
                        .as("diaria unidade %d periodo %s..%s", unidade, periodo[0], periodo[1])
                        .isEqualTo(named.queryForList(oraculo + DisponibilidadeSqlRepository.DIARIA, p));
            }
        }
        // O cenario precisa exercitar o calculo, nao so concordar em SEM_DADOS.
        assertThat(calculados).isGreaterThan(20);
    }

    private String oraculo(String arquivo) throws IOException {
        return new ClassPathResource("oraculo-medicao/" + arquivo).getContentAsString(StandardCharsets.UTF_8);
    }

    private static MapSqlParameterSource params(Instant[] periodo, Long unidadeId, Long equipamentoId, Long monitorId) {
        return new MapSqlParameterSource().addValue("inicio", Timestamp.from(periodo[0]))
                .addValue("fim", Timestamp.from(periodo[1])).addValue("unidadeId", unidadeId)
                .addValue("equipamentoId", equipamentoId).addValue("monitorId", monitorId).addValue("tipoId", null);
    }

    private static Instant[] periodo(Instant inicio, Instant fim) { return new Instant[] {inicio, fim}; }

    private static Duration dias(long n) { return Duration.ofDays(n); }

    private long unidade(String nome) {
        return jdbc.queryForObject("insert into unidade (nome, sigla) values (?, ?) returning id", Long.class,
                nome, nome.replace(" ", ""));
    }

    private long equipamento(long unidade, long tipo, String nome, String ip, boolean ativo, boolean emManutencao) {
        return jdbc.queryForObject("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, "
                + "em_manutencao) values (?, ?, ?, ?, ?, ?) returning id", Long.class,
                unidade, tipo, nome, ip, ativo, emManutencao);
    }

    private long monitor(long equipamento, String nome, boolean ativo) {
        return jdbc.queryForObject("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo) "
                + "values (?, 'ICMP', ?, 60, 2000, ?) returning id", Long.class, equipamento, nome, ativo);
    }

    private void janela(long monitor, Instant inicio, Instant fim) {
        jdbc.update("insert into janela_monitoramento (monitor_id, inicio_em, fim_em, origem) values (?, ?, ?, 'PRECISA')",
                monitor, Timestamp.from(inicio), fim == null ? null : Timestamp.from(fim));
    }

    private void medicao(long monitor, String status, Integer latencia, Instant em) {
        jdbc.update("insert into medicao (monitor_id, status, latencia_ms, executado_em) values (?, ?, ?, ?)",
                monitor, status, latencia, Timestamp.from(em));
    }

    private void incidente(long monitor, String status, Instant inicio, Instant fim) {
        jdbc.update("insert into incidente (monitor_id, status, iniciado_em, encerrado_em, motivo) values (?, ?, ?, ?, 'teste')",
                monitor, status, Timestamp.from(inicio), fim == null ? null : Timestamp.from(fim));
    }
}

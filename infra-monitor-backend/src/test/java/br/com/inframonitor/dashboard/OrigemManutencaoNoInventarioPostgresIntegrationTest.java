package br.com.inframonitor.dashboard;

import br.com.inframonitor.dashboard.dto.DashboardEquipamentoListaResponse;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A lista de equipamentos distingue a origem da manutencao: botao manual e janela ATIVA
 * agendada. Com varias janelas ATIVAS cobrindo o mesmo equipamento, vale a de maior fim.
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
class OrigemManutencaoNoInventarioPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant INICIO = Instant.parse("2026-09-01T08:00:00Z");
    private static final Instant FIM_CURTO = Instant.parse("2026-09-01T10:00:00Z");
    private static final Instant FIM_LONGO = Instant.parse("2026-09-01T12:00:00Z");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private DashboardService dashboard;

    private long usuarioId;
    private long unidadeId;
    private long tipoId;

    @BeforeEach
    void limparBanco() {
        jdbc.execute("truncate table manutencao_agendada_equipamento, manutencao_agendada, janela_monitoramento, "
                + "medicao, notificacao, monitor_episodio_latencia, incidente, monitor, equipamento, "
                + "tipo_equipamento, unidade, usuarios restart identity cascade");
        usuarioId = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Operador', 'operador@origem.test', 'hash-irrelevante', 'OPERADOR', true, false) "
                + "returning id");
        tipoId = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        unidadeId = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
    }

    @Test
    void distingueManualJanelaEEscolheAJanelaDeMaiorFim() {
        long soManual = equipamento("A-MANUAL", "10.0.0.1", true);
        long soJanela = equipamento("B-JANELA", "10.0.0.2", false);
        long combinado = equipamento("C-COMBINADO", "10.0.0.3", true);

        // Janela de escopo UNIDADE cobre todos os equipamentos da unidade.
        long janelaUnidade = janela("UNIDADE", FIM_CURTO);
        // Janela de escopo EQUIPAMENTOS so cobre o combinado, e tem fim maior.
        long janelaLonga = janela("EQUIPAMENTOS", FIM_LONGO);
        jdbc.update("insert into manutencao_agendada_equipamento (manutencao_id, equipamento_id) values (?, ?)",
                janelaLonga, combinado);

        List<DashboardEquipamentoListaResponse> lista = dashboard.equipamentos();

        DashboardEquipamentoListaResponse manual = linha(lista, soManual);
        assertThat(manual.manutencaoManual()).isTrue();
        assertThat(manual.janelaAtivaId()).isEqualTo(janelaUnidade);
        assertThat(manual.janelaAtivaFim()).isEqualTo(FIM_CURTO);

        DashboardEquipamentoListaResponse janela = linha(lista, soJanela);
        assertThat(janela.manutencaoManual()).isFalse();
        assertThat(janela.emManutencao()).isTrue();
        assertThat(janela.janelaAtivaId()).isEqualTo(janelaUnidade);
        assertThat(janela.janelaAtivaFim()).isEqualTo(FIM_CURTO);

        DashboardEquipamentoListaResponse comb = linha(lista, combinado);
        assertThat(comb.manutencaoManual()).isTrue();
        assertThat(comb.janelaAtivaId()).isEqualTo(janelaLonga);
        assertThat(comb.janelaAtivaFim()).isEqualTo(FIM_LONGO);
    }

    @Test
    void semManualNemJanelaOsTresCamposVemVazios() {
        long livre = equipamento("LIVRE", "10.0.0.9", false, false);

        DashboardEquipamentoListaResponse r = linha(dashboard.equipamentos(), livre);

        assertThat(r.manutencaoManual()).isFalse();
        assertThat(r.janelaAtivaId()).isNull();
        assertThat(r.janelaAtivaFim()).isNull();
    }

    @Test
    void janelaNaoAtivaOuDeOutraUnidadeNaoAparece() {
        long equipamento = equipamento("EQ", "10.0.0.8", false, false);
        long outraUnidade = insert("insert into unidade (nome, sigla, ativo) values ('Filial', 'FIL', true) returning id");
        jdbc.update("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, motivo, "
                + "status, criado_por_id) values (?, 'UNIDADE', ?, ?, 'futura', 'AGENDADA', ?)",
                unidadeId, Timestamp.from(INICIO), Timestamp.from(FIM_LONGO), usuarioId);
        jdbc.update("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, motivo, "
                + "status, criado_por_id, ativada_em) values (?, 'UNIDADE', ?, ?, 'outra', 'ATIVA', ?, ?)",
                outraUnidade, Timestamp.from(INICIO), Timestamp.from(FIM_LONGO), usuarioId, Timestamp.from(INICIO));

        DashboardEquipamentoListaResponse r = linha(dashboard.equipamentos(), equipamento);

        assertThat(r.janelaAtivaId()).isNull();
        assertThat(r.janelaAtivaFim()).isNull();
    }

    private DashboardEquipamentoListaResponse linha(List<DashboardEquipamentoListaResponse> lista, long id) {
        return lista.stream().filter(l -> l.id() == id).findFirst().orElseThrow();
    }

    /** Equipamento em manutencao efetiva (a janela ATIVA o cobre). */
    private long equipamento(String nome, String ip, boolean manual) {
        return equipamento(nome, ip, manual, true);
    }

    private long equipamento(String nome, String ip, boolean manual, boolean efetivo) {
        return insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, "
                + "em_manutencao, manutencao_manual) values (?, ?, ?, ?, true, ?, ?) returning id",
                unidadeId, tipoId, nome, ip, efetivo, manual);
    }

    private long janela(String escopo, Instant fim) {
        return insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, motivo, "
                + "status, criado_por_id, ativada_em) values (?, ?, ?, ?, 'teste', 'ATIVA', ?, ?) returning id",
                unidadeId, escopo, Timestamp.from(INICIO), Timestamp.from(fim), usuarioId, Timestamp.from(INICIO));
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}

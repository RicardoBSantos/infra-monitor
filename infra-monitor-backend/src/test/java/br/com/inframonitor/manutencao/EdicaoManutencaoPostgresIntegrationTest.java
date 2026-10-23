package br.com.inframonitor.manutencao;

import br.com.inframonitor.manutencao.entity.TipoAlteracao;
import br.com.inframonitor.manutencao.repository.EdicaoManutencao;
import br.com.inframonitor.testsupport.RequerDocker;
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
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Lock, CAS, registro e ultima alteracao de janelas (F2) contra PostgreSQL real.
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
        "notification.dispatcher.enabled=false",
        "manutencao.agendada.enabled=true",
        "manutencao.agendada.intervalo-ms=3600000"
})
class EdicaoManutencaoPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private EdicaoManutencao edicao;
    @Autowired private PlatformTransactionManager tm;

    private long operador, u, outra, e1, e2;

    @BeforeEach
    void cenario() {
        jdbc.execute("truncate table manutencao_agendada_alteracao, manutencao_agendada_equipamento, manutencao_agendada, "
                + "equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        operador = id("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Ana', 'ana@edicao.test', 'h', 'OPERADOR', true, false) returning id");
        long tipo = id("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        u = id("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        outra = id("insert into unidade (nome, sigla, ativo) values ('Norte', 'NRT', true) returning id");
        e1 = id("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ativo, em_manutencao) "
                + "values (" + u + ", " + tipo + ", 'SW-01', true, false) returning id");
        e2 = id("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ativo, em_manutencao) "
                + "values (" + outra + ", " + tipo + ", 'SW-02', true, false) returning id");
    }

    @Test
    void travarExigeStatusEVersao() {
        long j = janela("AGENDADA", e1);
        TransactionTemplate tx = new TransactionTemplate(tm);
        assertThat(tx.<Optional<EdicaoManutencao.Retrato>>execute(s -> edicao.travar(j, "AGENDADA", 0))).hasValueSatisfying(r -> {
            assertThat(r.unidadeId()).isEqualTo(u);
            assertThat(r.equipamentoIds()).containsExactly(e1);
            assertThat(r.motivo()).isEqualTo("Original");
        });
        assertThat(tx.<Optional<EdicaoManutencao.Retrato>>execute(s -> edicao.travar(j, "AGENDADA", 1))).isEmpty();
        assertThat(tx.<Optional<EdicaoManutencao.Retrato>>execute(s -> edicao.travar(j, "ATIVA", 0))).isEmpty();
        assertThat(tx.<Optional<EdicaoManutencao.EstadoAtual>>execute(s -> edicao.estado(j))).contains(new EdicaoManutencao.EstadoAtual("AGENDADA", 0));
    }

    @Test
    void gravarEdicaoTrocaLigacaoEIncrementaVersao() {
        long j = janela("AGENDADA", e1);
        Instant agora = Instant.now();
        var novo = new EdicaoManutencao.Retrato(outra, "EQUIPAMENTOS", List.of(e2), agora.plusSeconds(3600),
                agora.plusSeconds(7200), "Novo");
        TransactionTemplate tx = new TransactionTemplate(tm);
        assertThat(tx.<Boolean>execute(s -> edicao.gravarEdicao(j, 0, novo, agora))).isTrue();
        assertThat(tx.<Boolean>execute(s -> edicao.gravarEdicao(j, 0, novo, agora))).as("versao velha").isFalse();
        assertThat(jdbc.queryForList("select equipamento_id from manutencao_agendada_equipamento where manutencao_id = ?",
                Long.class, j)).containsExactly(e2);
        assertThat(jdbc.queryForMap("select unidade_id, motivo, versao from manutencao_agendada where id = ?", j))
                .containsEntry("unidade_id", outra).containsEntry("motivo", "Novo").containsEntry("versao", 1);
    }

    @Test
    void gravarFimRespeitaTetoEAgora() {
        long j = janela("ATIVA", e1);   // inicio = agora - 1 min
        Instant agora = Instant.now();
        TransactionTemplate tx = new TransactionTemplate(tm);
        Duration max = Duration.ofHours(72);
        assertThat(tx.<Boolean>execute(s -> edicao.gravarFim(j, 0, agora.plus(Duration.ofHours(73)), agora, max))).isFalse();
        assertThat(tx.<Boolean>execute(s -> edicao.gravarFim(j, 0, agora.minusSeconds(1), agora, max))).isFalse();
        assertThat(tx.<Boolean>execute(s -> edicao.gravarFim(j, 0, agora.plus(Duration.ofHours(2)), agora, max))).isTrue();
    }

    @Test
    void registrarEUltimaPorJanela() {
        long j = janela("AGENDADA", e1);
        Instant t = Instant.now().truncatedTo(ChronoUnit.MICROS);
        var r = new EdicaoManutencao.Retrato(u, "EQUIPAMENTOS", List.of(e1), t, t.plusSeconds(60), "x");
        TransactionTemplate tx = new TransactionTemplate(tm);
        tx.executeWithoutResult(s -> edicao.registrar(j, TipoAlteracao.EDICAO, operador, t, r, r.comFim(t.plusSeconds(90))));
        tx.executeWithoutResult(s -> edicao.registrar(j, TipoAlteracao.PRORROGACAO, operador, t.plusSeconds(5), r, r));
        assertThat(edicao.ultimas(List.of(j))).containsOnlyKeys(j).extractingByKey(j)
                .satisfies(x -> {
                    assertThat(x.tipo()).isEqualTo(TipoAlteracao.PRORROGACAO);
                    assertThat(x.porNome()).isEqualTo("Ana");
                });
        assertThat(jdbc.queryForObject("select depois->>'fimPrevisto' from manutencao_agendada_alteracao "
                + "where tipo = 'EDICAO'", String.class)).isEqualTo(t.plusSeconds(90).toString());
        assertThat(edicao.ultimas(List.of())).isEmpty();
    }

    private long janela(String status, long equipamento) {
        Instant inicio = "ATIVA".equals(status) ? Instant.now().minusSeconds(60) : Instant.now().plusSeconds(3600);
        long j = jdbc.queryForObject("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, "
                + "motivo, status, criado_por_id, ativada_em) values (?, 'EQUIPAMENTOS', ?, ?, 'Original', ?, ?, ?) returning id",
                Long.class, u, Timestamp.from(inicio), Timestamp.from(inicio.plusSeconds(3600)), status, operador,
                "ATIVA".equals(status) ? Timestamp.from(inicio) : null);
        jdbc.update("insert into manutencao_agendada_equipamento values (?, ?)", j, equipamento);
        return j;
    }

    private long id(String sql) { return jdbc.queryForObject(sql, Long.class); }
}

package br.com.inframonitor.relatorio.integration;

import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.relatorio.exportacao.RelatorioExportService;
import br.com.inframonitor.relatorio.service.RelatorioService;
import br.com.inframonitor.security.UsuarioPrincipal;
import br.com.inframonitor.usuario.entity.Papel;
import br.com.inframonitor.testsupport.LimpezaBanco;
import br.com.inframonitor.testsupport.RequerDocker;
import br.com.inframonitor.tipoequipamento.dto.CreateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.service.TipoEquipamentoService;
import br.com.inframonitor.unidade.dto.CreateUnidadeRequest;
import br.com.inframonitor.unidade.service.UnidadeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.io.OutputStream;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * D-07: depois de ~5 execucoes na mesma conexao o pgjdbc prepara no servidor e o PostgreSQL pode adotar
 * o plano generico, que estima 1 linha nos filtros {@code cast(:x as bigint) is null or ...} e relê
 * {@code medicao} por equipamento. As consultas de latencia forcam plano custom por transacao.
 * Pool de 1 conexao: {@code pg_prepared_statements} e por sessao, e a leitura precisa ser na mesma conexao.
 */
@RequerDocker
@SpringBootTest(properties = {"app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-test", "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false", "notification.dispatcher.enabled=false",
        "spring.datasource.hikari.maximum-pool-size=1"})
class LatenciaPlanoCustomPostgresIntegrationTest {
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    static final Instant INICIO = Instant.parse("2026-03-01T00:00:00Z"), FIM = Instant.parse("2026-03-02T00:00:00Z");

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        POSTGRES.start();
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        // Flyway com a propria conexao: o pool de 1 da aplicacao nao comporta a conexao de bloqueio do Flyway.
        r.add("spring.flyway.url", POSTGRES::getJdbcUrl);
        r.add("spring.flyway.user", POSTGRES::getUsername);
        r.add("spring.flyway.password", POSTGRES::getPassword);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired UnidadeService unidades;
    @Autowired TipoEquipamentoService tipos;
    @Autowired EquipamentoService equipamentos;
    @Autowired RelatorioService relatorios;
    @Autowired RelatorioExportService exportacoes;

    @BeforeEach
    void semear() {
        LimpezaBanco.limpar(jdbc);
        long tipo = tipos.criar(new CreateTipoEquipamentoRequest("Tipo plano", null)).id();
        for (int u = 1; u <= 2; u++) {
            long unidade = unidades.criar(new CreateUnidadeRequest("Unidade P" + u, "P" + u, null, null, null,
                    null, null, null, null)).id();
            for (int e = 1; e <= (u == 1 ? 2 : 1); e++) {
                long eq = equipamentos.criar(new CreateEquipamentoRequest(unidade, tipo, "Eq " + u + "." + e,
                        null, null, null, null, null, null, null)).id();
                jdbc.update("insert into monitor (equipamento_id,tipo,nome,intervalo_segundos,timeout_ms) "
                        + "values (?,'ICMP',?,60,1000)", eq, "Mon " + u + "." + e);
            }
        }
        jdbc.update("insert into medicao (monitor_id,status,latencia_ms,executado_em) "
                + "select m.id,'SUCESSO',(10 + g % 50),?::timestamptz + (g * interval '30 seconds') "
                + "from monitor m cross join generate_series(1,700) g", INICIO.toString());
        jdbc.execute("analyze medicao");
    }

    @Test
    void consultasDeLatenciaNuncaUsamPlanoGenerico() {
        for (int i = 0; i < 12; i++) {
            assertThat(relatorios.latencia(INICIO, FIM, null, null, null, 0, 10, null).content()).hasSize(3);
            assertThat(relatorios.latenciaUnidades(INICIO, FIM, null, 0, 10, null).content()).hasSize(2);
        }
        // Mesma conexao (pool de 1): enxerga os prepared statements do servidor usados pelo servico.
        Long generic = jdbc.queryForObject("select coalesce(sum(generic_plans),0) from pg_prepared_statements "
                + "where statement ilike '%count(md.id) quantidade%'", Long.class);
        Long custom = jdbc.queryForObject("select coalesce(sum(custom_plans),0) from pg_prepared_statements "
                + "where statement ilike '%count(md.id) quantidade%'", Long.class);
        assertThat(generic).as("planos genericos").isZero();
        assertThat(custom).as("planos custom").isGreaterThanOrEqualTo(24);
    }

    /**
     * Escopo nas exportacoes: so o CSV de latencia forca plano custom. O CSV de medicoes fica de fora (a serie
     * D-07 do benchmark de capacidade nao mediu degrau nele) e chega ao plano generico. As consultas de
     * exportacao sao as unicas com quebra de linha no SQL, o que as separa das da tela.
     */
    @Test
    void soOCsvDeLatenciaForcaPlanoCustom() throws Exception {
        UsuarioPrincipal admin = new UsuarioPrincipal(1L, Papel.ADMIN);
        for (int i = 0; i < 12; i++) {
            exportacoes.latencia(INICIO, FIM, null, null, null, null, admin).body().writeTo(OutputStream.nullOutputStream());
            exportacoes.medicoes(INICIO, FIM, null, null, null, null, null, admin).body().writeTo(OutputStream.nullOutputStream());
        }
        assertThat(planos("generic_plans", "%percentile_cont%")).as("CSV de latencia: planos genericos").isZero();
        assertThat(planos("generic_plans", "%md.latencia_ms,md.executado_em%"))
                .as("CSV de medicoes: sem plano custom forcado, o servidor adota o generico").isPositive();
    }

    private long planos(String coluna, String padrao) {
        return jdbc.queryForObject("select coalesce(sum(" + coluna + "),0) from pg_prepared_statements "
                + "where statement like ? and position(chr(10) in statement) > 0", Long.class, padrao);
    }
}

package br.com.inframonitor.equipamento;

import br.com.inframonitor.equipamento.validation.RegraIpv4;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Integracao real contra PostgreSQL para a CHECK {@code ck_equipamento_ip_ipv4} (V20):
 * o banco recusa, por SQL direto, o que a API ja recusa em {@link RegraIpv4}, e as duas
 * regras concordam caso a caso.
 *
 * <p>Requer Docker. Sem Docker disponivel o teste e ignorado, nunca falha.
 */
@EnabledIf("dockerDisponivel")
@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-test",
        "app.auth.jwt.access-token-minutes=15",
        "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false"
})
class IpEquipamentoCheckPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    static boolean dockerDisponivel() {
        return DockerClientFactory.instance().isDockerAvailable();
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;

    private final AtomicInteger sequencia = new AtomicInteger();
    private long unidadeId;
    private long tipoId;

    @BeforeEach
    void limparBanco() {
        jdbc.execute("truncate table equipamento, tipo_equipamento, unidade restart identity cascade");
        unidadeId = jdbc.queryForObject(
                "insert into unidade (nome, sigla) values ('Unidade IP', 'UIP') returning id", Long.class);
        tipoId = jdbc.queryForObject(
                "insert into tipo_equipamento (nome) values ('Tipo IP') returning id", Long.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"2001:db8::1", "010.0.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
            "256.0.0.1", "servidor", " 10.0.0.1", "10.0.0.1 "})
    void checkRecusaIpInvalidoGravadoPorSql(String ip) {
        assertThatThrownBy(() -> inserirEquipamento(ip))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_equipamento_ip_ipv4");
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"10.0.0.1", "1.0.0.0", "223.255.255.255", "127.0.0.1", "192.168.0.10", "10.0.0.0"})
    void checkAceitaIpv4DeHostENulo(String ip) {
        inserirEquipamento(ip);
        assertThat(jdbc.queryForObject("select count(*) from equipamento", Integer.class)).isEqualTo(1);
    }

    @Test
    void regraDoBancoConcordaComARegraJava() {
        // Mesmos casos dos dois lados: se a regex da V20 e RegraIpv4 divergirem, este teste diz qual.
        List<String> casos = List.of("10.0.0.1", "2001:db8::1", "010.0.0.1", "0.1.1.1", "223.1.1.1", "224.1.1.1",
                "10.0.0.255", "10.0.0.256", "1.2.3", "99.99.99.99", "100.100.100.100", "199.249.250.255");
        for (String caso : casos) {
            boolean banco = Boolean.TRUE.equals(jdbc.queryForObject(
                    "select ?::varchar ~ (select substring(pg_get_constraintdef(oid) from '''(.*)''') "
                            + "from pg_constraint where conname = 'ck_equipamento_ip_ipv4')", Boolean.class, caso));
            assertThat(banco).as(caso).isEqualTo(RegraIpv4.motivoDeRecusa(caso) == null);
        }
    }

    private void inserirEquipamento(String ip) {
        jdbc.update("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address) "
                + "values (?, ?, ?, ?)", unidadeId, tipoId, "Equip " + sequencia.incrementAndGet(), ip);
    }
}

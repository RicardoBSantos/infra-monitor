package br.com.inframonitor;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.health.actuate.endpoint.HealthDescriptor;
import org.springframework.boot.health.actuate.endpoint.HealthEndpoint;
import org.springframework.boot.health.contributor.Status;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Sobe o contexto completo contra um PostgreSQL real e verifica que o Flyway
 * migrou o banco e que o health do Actuator enxerga a conexao.
 *
 * Requer Docker. Sem Docker disponivel o teste e ignorado em vez de falhar.
 */
@EnabledIf("dockerDisponivel")
@SpringBootTest
class InfraMonitorApplicationTests {

    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine");

    static boolean dockerDisponivel() {
        return DockerClientFactory.instance().isDockerAvailable();
    }

    @DynamicPropertySource
    static void propriedadesDoBanco(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired
    private DataSource dataSource;

    @Autowired
    private HealthEndpoint healthEndpoint;

    @Test
    void contextoCarregaEFlywayAplicaMigrations() throws Exception {
        try (Connection conexao = dataSource.getConnection();
             Statement statement = conexao.createStatement();
             ResultSet resultado = statement.executeQuery(
                     "select count(*) from flyway_schema_history where success = true")) {

            assertThat(resultado.next()).isTrue();
            assertThat(resultado.getInt(1)).isPositive();
        }
    }

    @Test
    void healthReportaAplicacaoEBancoDisponiveis() {
        HealthDescriptor saude = healthEndpoint.health();
        HealthDescriptor banco = healthEndpoint.healthForPath("db");

        assertThat(saude.getStatus()).isEqualTo(Status.UP);
        assertThat(banco).isNotNull();
        assertThat(banco.getStatus()).isEqualTo(Status.UP);
    }
}

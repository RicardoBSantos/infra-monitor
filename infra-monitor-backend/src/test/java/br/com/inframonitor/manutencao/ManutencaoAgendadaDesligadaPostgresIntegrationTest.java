package br.com.inframonitor.manutencao;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.manutencao.dto.CriarManutencaoRequest;
import br.com.inframonitor.manutencao.entity.EscopoManutencao;
import br.com.inframonitor.manutencao.service.ManutencaoAgendadaService;
import br.com.inframonitor.manutencao.service.ReconciliacaoInicial;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Com o reconciliador desligado nenhuma janela seria ativada: a criacao e recusada com a
 * instrucao de como ligar, em vez de aceitar uma janela que nunca entraria (P-06).
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
        "manutencao.agendada.enabled=false"
})
class ManutencaoAgendadaDesligadaPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private ManutencaoAgendadaService service;
    @Autowired private ReconciliacaoInicial reconciliacaoInicial;

    private long operadorId;
    private long unidadeId;

    @BeforeEach
    void montarCenario() {
        jdbc.execute("truncate table manutencao_agendada_alteracao, manutencao_agendada_equipamento, manutencao_agendada, equipamento, "
                + "tipo_equipamento, unidade, usuarios restart identity cascade");
        operadorId = jdbc.queryForObject("insert into usuarios (nome, email, senha_hash, papel, ativo, "
                + "troca_senha_obrigatoria) values ('Operador', 'operador@desligada.test', 'hash-irrelevante', "
                + "'OPERADOR', true, false) returning id", Long.class);
        unidadeId = jdbc.queryForObject("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) "
                + "returning id", Long.class);
    }

    @Test
    void criarComJobDesligadoDevolve409ComInstrucao() {
        assertThatThrownBy(() -> service.criar(requisicaoValida(), operadorId))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Agendamento de manutencao desligado neste servidor: nenhuma janela seria ativada. "
                        + "Para ligar, defina MANUTENCAO_AGENDADA_ENABLED=true nas variaveis de ambiente do servico "
                        + "do backend e reinicie-o. Enquanto isso, use \"Iniciar manutencao\" no equipamento.");
        assertThat(jdbc.queryForObject("select count(*) from manutencao_agendada", Integer.class)).isZero();
    }

    @Test
    void parametrosDizemDesligado() {
        assertThat(service.parametros().agendadorLigado()).isFalse();
        assertThat(service.parametros().duracaoMaximaHoras()).isEqualTo(72);
    }

    @Test
    void reconciliacaoInicialProntaDeCaraComJobDesligado() {
        // Ninguem fara a primeira passada: o motor nao pode esperar por ela (MA12).
        assertThat(reconciliacaoInicial.pronta()).isTrue();
    }

    private CriarManutencaoRequest requisicaoValida() {
        Instant inicio = Instant.now().plus(Duration.ofHours(1));
        return new CriarManutencaoRequest(unidadeId, EscopoManutencao.UNIDADE, null, inicio,
                inicio.plus(Duration.ofHours(1)), "Troca de nobreak");
    }
}

package br.com.inframonitor.equipamento;

import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
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

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Lost update de em_manutencao: atualizar/ativar/desativar fazem dirty-check da linha
 * inteira e regravavam o valor que estava na sessao por cima de uma virada commitada
 * por outra transacao (reconciliador, botao) no meio. Com updatable = false a coluna
 * fica fora do UPDATE gerado pelo Hibernate.
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
class FlagManutencaoNaoSobrescritoPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Duration LIMITE = Duration.ofSeconds(10);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private EquipamentoRepository equipamentoRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    @BeforeEach
    void limparBanco() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
    }

    @Test
    void atualizarComEntidadeVelhaNaoRegravaEmManutencao() {
        long id = equipamento(false);
        new TransactionTemplate(transactionManager).executeWithoutResult(s -> {
            Equipamento velho = equipamentoRepository.findById(id).orElseThrow(); // em_manutencao = false na sessao
            emOutraThread(() -> jdbc.update("update equipamento set em_manutencao = true where id = ?", id));
            velho.setNome("SW-CORE-RENOMEADO"); // dirty-check dispara UPDATE da linha
        });
        Map<String, Object> linha = jdbc.queryForMap("select nome, em_manutencao from equipamento where id = ?", id);
        assertThat(linha).containsEntry("nome", "SW-CORE-RENOMEADO").containsEntry("em_manutencao", true);
    }

    private long equipamento(boolean emManutencao) {
        long tipo = jdbc.queryForObject("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id",
                Long.class);
        long unidade = jdbc.queryForObject(
                "insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id", Long.class);
        return jdbc.queryForObject("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, "
                + "em_manutencao) values (?, ?, 'SW-CORE', '10.0.0.10', true, ?) returning id",
                Long.class, unidade, tipo, emManutencao);
    }

    /** Roda e commita em outra thread (outra transacao), esperando terminar. */
    private void emOutraThread(Runnable acao) {
        List<Throwable> falhas = new CopyOnWriteArrayList<>();
        Thread thread = new Thread(() -> {
            try {
                acao.run();
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "concorrente-commitado");
        thread.start();
        try {
            thread.join(LIMITE.toMillis());
        } catch (InterruptedException erro) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(erro);
        }
        assertThat(thread.isAlive()).as("acao concorrente ainda viva apos " + LIMITE).isFalse();
        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();
    }
}

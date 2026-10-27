package br.com.inframonitor.notificacao;

import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V23 (F3): as duas ancoras novas de notificacao e a sessao do botao manual. Insere por SQL
 * puro porque o que se prova aqui sao as constraints do banco, nao o codigo da aplicacao.
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
class NotificacaoAncorasManutencaoPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private NotificacaoRepository notificacaoRepository;

    private Instant agora;
    private long usuario;
    private long tipo;
    private long unidade;
    private long equipamento;
    private long janela;
    private long sessao;

    @BeforeEach
    void montarCenario() {
        jdbc.execute("truncate table manutencao_manual, manutencao_agendada_alteracao, manutencao_agendada_equipamento, "
                + "manutencao_agendada, janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        agora = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        usuario = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Operador', 'operador@v23.test', 'hash-irrelevante', 'OPERADOR', true, false) returning id");
        tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        unidade = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        equipamento = novoEquipamento("SW-01", false);
        janela = insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, motivo, "
                + "status, criado_por_id) values (?, 'UNIDADE', ?, ?, 'Teste', 'AGENDADA', ?) returning id",
                unidade, Timestamp.from(agora.plusSeconds(3600)), Timestamp.from(agora.plusSeconds(7200)), usuario);
        sessao = insert("insert into manutencao_manual (equipamento_id, iniciada_em, iniciada_por_id) "
                + "values (?, ?, ?) returning id", equipamento, Timestamp.from(agora), usuario);
    }

    @Test
    void ancoraDuplaRecusada() {
        long incidente = incidente();

        assertThatThrownBy(() -> jdbc.update("insert into notificacao (incidente_id, manutencao_agendada_id, canal, "
                + "tipo_evento, status, tentativas, mensagem, created_at, updated_at) "
                + "values (?, ?, 'TELEGRAM', 'INCIDENTE_ABERTO', 'PENDENTE', 0, 'm', now(), now())", incidente, janela))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_notificacao_ancora_exclusiva");
    }

    @Test
    void eventoDeJanelaExigeAncoraDeJanela() {
        assertThatThrownBy(() -> notificacaoManual("MANUTENCAO_INICIADA", sessao))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_notificacao_evento_coerente");
        assertThatThrownBy(() -> notificacaoJanela("MANUTENCAO_MANUAL_INICIADA", janela))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_notificacao_evento_coerente");
    }

    @Test
    void inicioUnicoPorJanela() {
        notificacaoJanela("MANUTENCAO_INICIADA", janela);

        assertThatThrownBy(() -> notificacaoJanela("MANUTENCAO_INICIADA", janela))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uq_notificacao_manutencao_evento");

        notificacaoJanela("MANUTENCAO_FIM_ALTERADO", janela);
        notificacaoJanela("MANUTENCAO_FIM_ALTERADO", janela);
        assertThat(jdbc.queryForObject("select count(*) from notificacao where tipo_evento = 'MANUTENCAO_FIM_ALTERADO'",
                Long.class)).isEqualTo(2);
    }

    @Test
    void eventoManualUnicoPorSessao() {
        notificacaoManual("MANUTENCAO_MANUAL_INICIADA", sessao);

        assertThatThrownBy(() -> notificacaoManual("MANUTENCAO_MANUAL_INICIADA", sessao))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uq_notificacao_manual_canal_evento");
    }

    @Test
    void sessaoAbertaUnicaPorEquipamento() {
        assertThatThrownBy(() -> jdbc.update("insert into manutencao_manual (equipamento_id, iniciada_em, "
                + "iniciada_por_id) values (?, ?, ?)", equipamento, Timestamp.from(agora), usuario))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uq_manutencao_manual_aberta");

        jdbc.update("update manutencao_manual set encerrada_em = ?, encerrada_por_id = ? where id = ?",
                Timestamp.from(agora.plusSeconds(60)), usuario, sessao);
        jdbc.update("insert into manutencao_manual (equipamento_id, iniciada_em, iniciada_por_id) values (?, ?, ?)",
                equipamento, Timestamp.from(agora.plusSeconds(120)), usuario);
        assertThat(jdbc.queryForObject("select count(*) from manutencao_manual where equipamento_id = ?",
                Long.class, equipamento)).isEqualTo(2);
    }

    @Test
    void legadoSemInicioSoSemAutor() {
        long outro = novoEquipamento("SW-02", false);

        assertThatThrownBy(() -> jdbc.update("insert into manutencao_manual (equipamento_id, iniciada_por_id) "
                + "values (?, ?)", outro, usuario))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_manutencao_manual_legado");
    }

    @Test
    void backfillCriaSessaoSemInicio() throws Exception {
        jdbc.execute("truncate table manutencao_manual restart identity cascade");
        long noBotao = novoEquipamento("SW-BOTAO", true);
        novoEquipamento("SW-FORA", false);

        jdbc.execute(trechoBackfill());

        assertThat(jdbc.queryForObject("select count(*) from manutencao_manual", Long.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from manutencao_manual where equipamento_id = ? "
                + "and iniciada_em is null and iniciada_por_id is null and encerrada_em is null",
                Long.class, noBotao)).isEqualTo(1);
    }

    @Test
    void entidadesMapeiamColunas() {
        long n = notificacaoJanela("MANUTENCAO_INICIADA", janela);
        long m = notificacaoManual("MANUTENCAO_MANUAL_INICIADA", sessao);

        Notificacao daJanela = notificacaoRepository.findById(n).orElseThrow();
        Notificacao doBotao = notificacaoRepository.findById(m).orElseThrow();

        assertThat(daJanela.getManutencaoAgendada().getId()).isEqualTo(janela);
        assertThat(daJanela.getManutencaoManual()).isNull();
        assertThat(daJanela.descreverAncora()).isEqualTo("manutencao=" + janela);
        assertThat(doBotao.getManutencaoManual().getId()).isEqualTo(sessao);
        assertThat(doBotao.descreverAncora()).isEqualTo("manutencaoManual=" + sessao);
    }

    /** O INSERT ... SELECT do backfill, lido do proprio arquivo da V23 (nao copiado para o teste). */
    private String trechoBackfill() throws Exception {
        try (var in = getClass().getResourceAsStream("/db/migration/V23__add_notificacao_manutencao_e_manutencao_manual.sql")) {
            assertThat(in).as("V23 no classpath").isNotNull();
            String sql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            int ini = sql.indexOf("INSERT INTO manutencao_manual");
            assertThat(ini).isGreaterThanOrEqualTo(0);
            int fim = sql.indexOf(';', ini);
            return sql.substring(ini, fim + 1);
        }
    }

    private long incidente() {
        long monitor = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                + "falhas_para_incidente, sucessos_para_recovery) values (?, 'ICMP', 'ICMP', 60, 2000, true, 3, 2) "
                + "returning id", equipamento);
        return insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Teste') returning id", monitor, Timestamp.from(agora));
    }

    private long notificacaoJanela(String evento, long janelaId) {
        return insert("insert into notificacao (manutencao_agendada_id, canal, tipo_evento, status, tentativas, "
                + "mensagem, created_at, updated_at) values (?, 'TELEGRAM', ?, 'PENDENTE', 0, 'm', now(), now()) "
                + "returning id", janelaId, evento);
    }

    private long notificacaoManual(String evento, long sessaoId) {
        return insert("insert into notificacao (manutencao_manual_id, canal, tipo_evento, status, tentativas, "
                + "mensagem, created_at, updated_at) values (?, 'TELEGRAM', ?, 'PENDENTE', 0, 'm', now(), now()) "
                + "returning id", sessaoId, evento);
    }

    private long novoEquipamento(String nome, boolean manual) {
        return insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ativo, em_manutencao, "
                + "manutencao_manual) values (?, ?, ?, true, ?, ?) returning id", unidade, tipo, nome, manual, manual);
    }

    private long insert(String sql, Object... args) {
        Long id = jdbc.queryForObject(sql, Long.class, args);
        assertThat(id).isNotNull();
        return id;
    }
}

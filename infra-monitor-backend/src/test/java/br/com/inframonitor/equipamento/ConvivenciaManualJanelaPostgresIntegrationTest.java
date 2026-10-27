package br.com.inframonitor.equipamento;

import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.dto.EquipamentoResponse;
import br.com.inframonitor.equipamento.dto.UpdateEquipamentoRequest;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.equipamento.service.EstadoManutencaoEquipamento;
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
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Convivencia do botao manual com a janela agendada (tabela 4.1 do desenho): efetiva =
 * manual OR janela ATIVA cobrindo, materializada em em_manutencao por
 * {@link EstadoManutencaoEquipamento}. Cada caso confere os dois flags, a janela de SLA do
 * monitor e, quando ha, o incidente.
 *
 * <p>As janelas entram por SQL: o reconciliador e a API sao das tasks seguintes. O que se
 * prova aqui e o escritor unico reagindo ao que o banco diz.
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
class ConvivenciaManualJanelaPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant T0 = Instant.parse("2026-09-01T08:00:00Z");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private EquipamentoService equipamentoService;
    @Autowired private EstadoManutencaoEquipamento estado;

    private long operadorId;
    private long tipo;
    private long u;
    private long outraUnidade;
    private long e;
    private long m;

    @BeforeEach
    void montarCenario() {
        jdbc.execute("truncate table manutencao_agendada_equipamento, manutencao_agendada, janela_monitoramento, "
                + "medicao, notificacao, monitor_episodio_latencia, incidente, monitor, equipamento, "
                + "tipo_equipamento, unidade, usuarios restart identity cascade");
        operadorId = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Operador', 'operador@convivencia.test', 'hash-irrelevante', 'OPERADOR', true, false) "
                + "returning id");
        tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        u = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        outraUnidade = insert("insert into unidade (nome, sigla, ativo) values ('Norte', 'NRT', true) returning id");
        e = insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, "
                + "em_manutencao) values (?, ?, 'SW-CORE', '10.0.0.10', true, false) returning id", u, tipo);
        m = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                + "falhas_para_incidente, sucessos_para_recovery) "
                + "values (?, 'ICMP', 'ICMP CORE', 60, 2000, true, 3, 2) returning id", e);
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA') "
                + "returning id", m, Timestamp.from(T0));
    }

    @Test
    void janelaAtivaSemManualEntraComEfeitos() {
        long i = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", m, Timestamp.from(T0));
        janelaAtivaDoEquipamento(e, u);

        assertThat(estado.reavaliar(e)).isTrue();

        assertThat(flags(e)).containsEntry("em_manutencao", true).containsEntry("manutencao_manual", false);
        assertThat(incidente(i)).containsEntry("status", "FECHADO").containsEntry("motivo_encerramento", "MANUTENCAO")
                .containsEntry("fechado_por", operadorId);   // autor = criado_por da janela (MA10)
        assertThat(janelasSlaAbertas(m)).isZero();
    }

    @Test
    void janelaTerminaComManualLigadoNaoSai() {
        estado.iniciarManual(e, operadorId);
        long j = janelaAtivaDoEquipamento(e, u);
        jdbc.update("update manutencao_agendada set status='CONCLUIDA', encerrada_em = now() where id = ?", j);

        assertThat(estado.reavaliar(e)).isTrue();

        assertThat(flags(e)).containsEntry("em_manutencao", true).containsEntry("manutencao_manual", true);
        assertThat(janelasSlaAbertas(m)).isZero();
    }

    @Test
    void encerrarManualDuranteJanelaAtivaContinuaEmManutencao() {
        estado.iniciarManual(e, operadorId);
        janelaAtivaDoEquipamento(e, u);

        EquipamentoResponse r = equipamentoService.sairDeManutencao(e, operadorId);

        assertThat(r.emManutencao()).isTrue();
        assertThat(r.manutencaoManual()).isFalse();
        assertThat(flags(e)).containsEntry("em_manutencao", true).containsEntry("manutencao_manual", false);
        assertThat(janelasSlaAbertas(m)).isZero();   // nenhum efeito de saida
    }

    @Test
    void manualLigadoDuranteJanelaNaoRodaEfeitosDeNovo() {
        janelaAtivaDoEquipamento(e, u);
        estado.reavaliar(e);
        int notificacoesAntes = contarNotificacoes();

        estado.iniciarManual(e, operadorId);

        assertThat(flags(e)).containsEntry("manutencao_manual", true).containsEntry("em_manutencao", true);
        assertThat(contarNotificacoes()).isEqualTo(notificacoesAntes);
    }

    @Test
    void osDoisTerminamSaiEReabreJanelaSla() {
        estado.iniciarManual(e, operadorId);
        long j = janelaAtivaDoEquipamento(e, u);
        jdbc.update("update manutencao_agendada set status='CONCLUIDA', encerrada_em = now() where id = ?", j);

        EquipamentoResponse r = equipamentoService.sairDeManutencao(e, operadorId);

        assertThat(r.emManutencao()).isFalse();
        assertThat(flags(e)).containsEntry("em_manutencao", false).containsEntry("manutencao_manual", false);
        assertThat(janelasSlaAbertas(m)).isEqualTo(1);
    }

    @Test
    void escopoUnidadeCobreEquipamentoCriadoDuranteAJanela() {
        janelaAtivaDaUnidade(u);

        EquipamentoResponse r = equipamentoService.criar(new CreateEquipamentoRequest(u, tipo, "SW-NOVO",
                "10.0.0.11", null, null, null, null, null, null));

        assertThat(r.emManutencao()).isTrue();
        assertThat(r.manutencaoManual()).isFalse();
        assertThat(flags(r.id())).containsEntry("em_manutencao", true).containsEntry("manutencao_manual", false);
    }

    @Test
    void equipamentoMovidoParaForaDaUnidadeSaiDaJanela() {
        janelaAtivaDaUnidade(u);
        assertThat(estado.reavaliar(e)).isTrue();
        assertThat(janelasSlaAbertas(m)).isZero();

        EquipamentoResponse r = equipamentoService.atualizar(e, mudarPara(outraUnidade));

        assertThat(r.emManutencao()).isFalse();
        assertThat(r.unidade().id()).isEqualTo(outraUnidade);
        assertThat(flags(e)).containsEntry("em_manutencao", false);
        assertThat(janelasSlaAbertas(m)).isEqualTo(1);
    }

    @Test
    void escopoEquipamentosSegueOIdAoMudarDeUnidade() {
        janelaAtivaDoEquipamento(e, u);
        assertThat(estado.reavaliar(e)).isTrue();

        EquipamentoResponse r = equipamentoService.atualizar(e, mudarPara(outraUnidade));

        assertThat(r.emManutencao()).isTrue();
        assertThat(flags(e)).containsEntry("em_manutencao", true);
        assertThat(janelasSlaAbertas(m)).isZero();
    }

    // ---------------------------------------------------------------------------
    // Fixtures
    // ---------------------------------------------------------------------------

    private long janelaAtivaDoEquipamento(long equipamentoId, long unidadeId) {
        long id = insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, motivo, "
                + "status, criado_por_id, ativada_em) values (?, 'EQUIPAMENTOS', now() - interval '10 minutes', "
                + "now() + interval '1 hour', 'Troca do switch', 'ATIVA', ?, now() - interval '10 minutes') returning id",
                unidadeId, operadorId);
        jdbc.update("insert into manutencao_agendada_equipamento values (?, ?)", id, equipamentoId);
        return id;
    }

    private long janelaAtivaDaUnidade(long unidadeId) {
        return insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, motivo, "
                + "status, criado_por_id, ativada_em) values (?, 'UNIDADE', now() - interval '10 minutes', "
                + "now() + interval '1 hour', 'Quadro eletrico', 'ATIVA', ?, now() - interval '10 minutes') returning id",
                unidadeId, operadorId);
    }

    private UpdateEquipamentoRequest mudarPara(long unidadeId) {
        return new UpdateEquipamentoRequest(unidadeId, tipo, "SW-CORE", "10.0.0.10", null, null, null, null, null,
                null);
    }

    private Map<String, Object> flags(long equipamentoId) {
        return jdbc.queryForMap("select em_manutencao, manutencao_manual from equipamento where id = ?", equipamentoId);
    }

    private Map<String, Object> incidente(long incidenteId) {
        return jdbc.queryForMap("select status, motivo_encerramento, fechado_por from incidente where id = ?",
                incidenteId);
    }

    private int janelasSlaAbertas(long monitorId) {
        return jdbc.queryForObject("select count(*) from janela_monitoramento where monitor_id = ? and fim_em is null",
                Integer.class, monitorId);
    }

    private int contarNotificacoes() {
        // Sem o aviso do proprio botao (F3): o que se prova e que os efeitos de entrada nao rodam de novo.
        return jdbc.queryForObject("select count(*) from notificacao where tipo_evento <> 'MANUTENCAO_MANUAL_INICIADA'",
                Integer.class);
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}

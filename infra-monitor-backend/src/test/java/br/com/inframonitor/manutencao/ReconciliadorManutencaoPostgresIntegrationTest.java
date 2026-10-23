package br.com.inframonitor.manutencao;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.service.EstadoManutencaoEquipamento;
import br.com.inframonitor.manutencao.config.ManutencaoAgendadaProperties;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao.Transicao;
import br.com.inframonitor.manutencao.service.ReconciliacaoInicial;
import br.com.inframonitor.manutencao.service.ReconciliadorManutencao;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

import static java.time.temporal.ChronoUnit.HOURS;
import static java.time.temporal.ChronoUnit.MINUTES;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;

/**
 * Reconciliador contra PostgreSQL real, com foco no "sistema parado" (MA08): janelas cujos
 * horarios ja passaram sem nenhum tick ate agora. O teste chama {@code reconciliar(agora)}
 * direto; o intervalo de uma hora deixa o {@code @Scheduled} fora do caminho (ele dispara uma
 * vez na subida do contexto, antes do truncate de cada teste, entao nao ve as linhas daqui).
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
class ReconciliadorManutencaoPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private ReconciliadorManutencao reconciliador;
    @Autowired private CoberturaManutencao cobertura;
    // Spy so para injetar falha num equipamento; nos demais testes delega ao bean real.
    @MockitoSpyBean private EstadoManutencaoEquipamento estado;
    @Autowired private ManutencaoAgendadaProperties props;
    @Autowired private PlatformTransactionManager transactionManager;
    @Autowired @Qualifier("monitoringClock") private Clock clock;

    // Precisao de microssegundo do TIMESTAMPTZ: comparar o instante gravado com o enviado.
    private final Instant agora = Instant.now().truncatedTo(ChronoUnit.MILLIS);

    private long operadorId;
    private long tipo;
    private long u;
    private long equipamento;
    private long monitor;
    private long aberto;

    @BeforeEach
    void montarCenario() {
        jdbc.execute("truncate table manutencao_agendada_alteracao, manutencao_agendada_equipamento, manutencao_agendada, janela_monitoramento, "
                + "medicao, notificacao, monitor_episodio_latencia, incidente, monitor, equipamento, "
                + "tipo_equipamento, unidade, usuarios restart identity cascade");
        operadorId = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Operador', 'operador@reconciliador.test', 'hash-irrelevante', 'OPERADOR', true, false) "
                + "returning id");
        tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        u = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        equipamento = novoEquipamento("SW-01");
        monitor = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                + "falhas_para_incidente, sucessos_para_recovery) "
                + "values (?, 'ICMP', 'ICMP 01', 60, 2000, true, 3, 2) returning id", equipamento);
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA') "
                + "returning id", monitor, Timestamp.from(agora.minus(Duration.ofDays(1))));
        aberto = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitor,
                Timestamp.from(agora.minus(Duration.ofDays(1))));
    }

    @Test
    void inicioPerdidoComFimNoFuturoAtivaAtrasada() {
        long j = janela("AGENDADA", agora.minus(47, MINUTES), agora.plus(1, HOURS), equipamento);

        var r = reconciliador.reconciliar(agora);

        assertThat(r.ativadas()).extracting(Transicao::manutencaoId).containsExactly(j);
        assertThat(r.ativadas().get(0).atraso()).isGreaterThanOrEqualTo(Duration.ofMinutes(47));
        assertThat(r.reavaliados()).isEqualTo(1);
        assertThat(linhaJanela(j)).containsEntry("status", "ATIVA");
        assertThat(((Timestamp) linhaJanela(j).get("ativada_em")).toInstant()).isEqualTo(agora); // real, nao previsto
        assertThat(flags(equipamento)).containsEntry("em_manutencao", true);
        assertThat(incidente(aberto)).containsEntry("motivo_encerramento", "MANUTENCAO");
    }

    @Test
    void janelaInteiraPerdidaExpiraSemEfeito() {
        long j = janela("AGENDADA", agora.minus(3, HOURS), agora.minus(1, HOURS), equipamento);
        var antes = fotografia();

        var r = reconciliador.reconciliar(agora);

        assertThat(r.expiradas()).extracting(Transicao::manutencaoId).containsExactly(j);
        assertThat(r.ativadas()).isEmpty();
        assertThat(r.reavaliados()).isZero();
        assertThat(linhaJanela(j)).containsEntry("status", "EXPIRADA");
        assertThat(linhaJanela(j).get("ativada_em")).isNull();
        assertThat(fotografia()).isEqualTo(antes);
    }

    @Test
    void fimPerdidoConcluiNoInstanteReal() {
        long j = janelaAtivaComEfeitosAplicados(agora.minus(3, HOURS), agora.minus(1, HOURS), equipamento);
        assertThat(janelasSlaAbertas(monitor)).isZero();

        var r = reconciliador.reconciliar(agora);

        assertThat(r.concluidas()).extracting(Transicao::manutencaoId).containsExactly(j);
        assertThat(r.concluidas().get(0).atraso()).isEqualTo(Duration.ofHours(1));
        assertThat(linhaJanela(j)).containsEntry("status", "CONCLUIDA");
        assertThat(((Timestamp) linhaJanela(j).get("encerrada_em")).toInstant()).isEqualTo(agora);
        assertThat(linhaJanela(j).get("encerrada_por_id")).isNull();
        // Janela de SLA reaberta AGORA, nao no fim previsto: o buraco fica fora do denominador.
        assertThat(inicioDaJanelaSlaAberta(monitor)).isAfterOrEqualTo(agora.minusSeconds(5));
        assertThat(flags(equipamento)).containsEntry("em_manutencao", false);
    }

    @Test
    void divergenciaECorrigidaMesmoSemTransicao() {
        // Janela ja ATIVA (gravada por SQL) e flag desligado: nenhum CAS muda nada, so a divergencia entra.
        long j = janela("ATIVA", agora.minus(10, MINUTES), agora.plus(1, HOURS), equipamento);

        var r = reconciliador.reconciliar(agora);

        assertThat(r.ativadas()).isEmpty();
        assertThat(r.expiradas()).isEmpty();
        assertThat(r.concluidas()).isEmpty();
        assertThat(r.reavaliados()).isEqualTo(1);
        assertThat(linhaJanela(j)).containsEntry("status", "ATIVA");
        assertThat(flags(equipamento)).containsEntry("em_manutencao", true);
        assertThat(incidente(aberto)).containsEntry("motivo_encerramento", "MANUTENCAO");
    }

    @Test
    void janelaUnidadeCobreEquipamentoNovoNoTick() {
        long j = janelaUnidade(agora.minus(20, MINUTES), agora.plus(1, HOURS));
        reconciliador.reconciliar(agora.minus(19, MINUTES));
        assertThat(linhaJanela(j)).containsEntry("status", "ATIVA");
        assertThat(flags(equipamento)).containsEntry("em_manutencao", true);

        // Equipamento criado direto no banco: nenhum hook de cadastro o reavalia.
        long novo = novoEquipamento("SW-NOVO");
        assertThat(flags(novo)).containsEntry("em_manutencao", false);

        var r = reconciliador.reconciliar(agora);

        assertThat(r.reavaliados()).isEqualTo(1);
        assertThat(flags(novo)).containsEntry("em_manutencao", true);
    }

    @Test
    void equipamentoComFalhaNaoSeguraOsOutros() {
        long sumido = novoEquipamento("SW-SUMIDO");
        long outro = novoEquipamento("SW-02");
        long j = janelaUnidade(agora.minus(5, MINUTES), agora.plus(1, HOURS));
        // Ordem por id: o primeiro falha de vez, o segundo "sumiu" entre cobertosPor e o lock
        // (a corrida real nao se reproduz por SQL; o spy lanca o que o lock lancaria).
        doThrow(new IllegalStateException("simulada")).when(estado).reavaliar(equipamento);
        doThrow(new RecursoNaoEncontradoException("Equipamento nao encontrado")).when(estado).reavaliar(sumido);

        var r = reconciliador.reconciliar(agora);

        assertThat(r.ativadas()).extracting(Transicao::manutencaoId).containsExactly(j);
        assertThat(r.reavaliados()).isEqualTo(3);
        assertThat(flags(equipamento)).containsEntry("em_manutencao", false);   // fica para a divergencia
        assertThat(flags(outro)).containsEntry("em_manutencao", true);
    }

    @Test
    void marcaReconciliacaoInicialPronta() {
        // Instancia propria: o bean do contexto ja foi marcado pela passada da subida.
        var inicial = new ReconciliacaoInicial(props);
        var proprio = new ReconciliadorManutencao(cobertura, estado, inicial, props, transactionManager, clock);
        assertThat(inicial.pronta()).isFalse();

        proprio.reconciliar(agora);

        assertThat(inicial.pronta()).isTrue();
    }

    // ---------------------------------------------------------------------------

    /** Janela de escopo EQUIPAMENTOS, com os carimbos que o CHECK de coerencia exige. */
    private long janela(String status, Instant inicio, Instant fim, long equipamentoId) {
        Timestamp ativadaEm = "ATIVA".equals(status) ? Timestamp.from(inicio) : null;
        long id = insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, motivo, "
                + "status, criado_por_id, ativada_em) values (?, 'EQUIPAMENTOS', ?, ?, 'Teste', ?, ?, ?) returning id",
                u, Timestamp.from(inicio), Timestamp.from(fim), status, operadorId, ativadaEm);
        jdbc.update("insert into manutencao_agendada_equipamento (manutencao_id, equipamento_id) values (?, ?)",
                id, equipamentoId);
        return id;
    }

    private long janelaUnidade(Instant inicio, Instant fim) {
        return insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, motivo, "
                + "status, criado_por_id) values (?, 'UNIDADE', ?, ?, 'Teste', 'AGENDADA', ?) returning id",
                u, Timestamp.from(inicio), Timestamp.from(fim), operadorId);
    }

    /** AGENDADA no passado; um tick logo depois do inicio a ativa com todos os efeitos de entrada. */
    private long janelaAtivaComEfeitosAplicados(Instant inicio, Instant fim, long equipamentoId) {
        long id = janela("AGENDADA", inicio, fim, equipamentoId);
        reconciliador.reconciliar(inicio.plus(1, MINUTES));
        assertThat(linhaJanela(id)).containsEntry("status", "ATIVA");
        assertThat(flags(equipamentoId)).containsEntry("em_manutencao", true);
        return id;
    }

    private long novoEquipamento(String nome) {
        return insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ativo, em_manutencao) "
                + "values (?, ?, ?, true, false) returning id", u, tipo, nome);
    }

    private Map<String, Object> linhaJanela(long id) {
        return jdbc.queryForMap("select * from manutencao_agendada where id = ?", id);
    }

    private Map<String, Object> flags(long equipamentoId) {
        return jdbc.queryForMap("select em_manutencao, manutencao_manual from equipamento where id = ?", equipamentoId);
    }

    private Map<String, Object> incidente(long id) {
        return jdbc.queryForMap("select status, motivo_encerramento from incidente where id = ?", id);
    }

    /** Tudo que um efeito de entrada ou saida tocaria: incidentes, janelas de SLA, notificacoes e flags. */
    private List<List<Map<String, Object>>> fotografia() {
        return List.of(
                jdbc.queryForList("select * from incidente order by id"),
                jdbc.queryForList("select * from janela_monitoramento order by id"),
                jdbc.queryForList("select * from notificacao order by id"),
                jdbc.queryForList("select id, em_manutencao, manutencao_manual from equipamento order by id"));
    }

    private int janelasSlaAbertas(long monitorId) {
        return jdbc.queryForObject("select count(*) from janela_monitoramento where monitor_id = ? and fim_em is null",
                Integer.class, monitorId);
    }

    private Instant inicioDaJanelaSlaAberta(long monitorId) {
        return jdbc.queryForObject("select inicio_em from janela_monitoramento where monitor_id = ? and fim_em is null",
                Timestamp.class, monitorId).toInstant();
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}

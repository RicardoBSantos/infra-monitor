package br.com.inframonitor.notificacao;

import br.com.inframonitor.manutencao.entity.EscopoManutencao;
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import br.com.inframonitor.notificacao.service.DadosAnuncio;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import br.com.inframonitor.testsupport.RequerDocker;
import org.hibernate.Hibernate;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * F3, MA32/MA33: o fim de uma manutencao so e despachado depois do inicio, e o texto do fim
 * nasce do resultado do UPDATE que cancela o inicio. PostgreSQL real porque o que se prova e a
 * query da fila e o RETURNING, nao mocks.
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
class FilaAnuncioManutencaoPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final String NAO_ENTREGUE = "não foi entregue";
    private static final String TALVEZ = "pode não ter sido entregue";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private NotificacaoService service;
    @Autowired private NotificacaoRepository repository;
    @Autowired private org.springframework.transaction.support.TransactionTemplate tx;

    private Instant agora;
    private long usuario;
    private long unidade;
    private long equipamento;
    private long janela;
    private long outraJanela;
    private long sessao;

    @BeforeEach
    void montarCenario() {
        jdbc.execute("truncate table manutencao_manual, manutencao_agendada_alteracao, manutencao_agendada_equipamento, "
                + "manutencao_agendada, janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        agora = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        usuario = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Operador', 'operador@fila.test', 'hash-irrelevante', 'OPERADOR', true, false) returning id");
        long tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        unidade = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        equipamento = insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ativo, em_manutencao, "
                + "manutencao_manual) values (?, ?, 'SW-01', true, false, false) returning id", unidade, tipo);
        janela = novaJanela();
        outraJanela = novaJanela();
        sessao = insert("insert into manutencao_manual (equipamento_id, iniciada_em, iniciada_por_id) "
                + "values (?, ?, ?) returning id", equipamento, Timestamp.from(agora), usuario);
    }

    // ---- MA33: ordem na fila ------------------------------------------------------------------

    @Test
    void fimNaoFicaProntoComInicioPendenteOuEnviando() {
        for (String estado : List.of("PENDENTE", "ENVIANDO")) {
            limparNotificacoes();
            long inicio = linha(janela, null, "MANUTENCAO_INICIADA", estado);
            long fim = linha(janela, null, "MANUTENCAO_ENCERRADA", "PENDENTE");
            long alterado = linha(janela, null, "MANUTENCAO_FIM_ALTERADO", "PENDENTE");

            assertThat(prontos()).as("inicio " + estado).doesNotContain(fim, alterado);
            if (estado.equals("PENDENTE")) {
                assertThat(prontos()).contains(inicio);
            }
        }
        limparNotificacoes();
        linha(null, sessao, "MANUTENCAO_MANUAL_INICIADA", "ENVIANDO");
        long fimManual = linha(null, sessao, "MANUTENCAO_MANUAL_ENCERRADA", "PENDENTE");
        assertThat(prontos()).doesNotContain(fimManual);
    }

    @Test
    void fimFicaProntoComInicioEnviadaFalhaOuCancelada() {
        for (String estado : List.of("ENVIADA", "FALHA", "CANCELADA")) {
            limparNotificacoes();
            linha(janela, null, "MANUTENCAO_INICIADA", estado);
            long fim = linha(janela, null, "MANUTENCAO_ENCERRADA", "PENDENTE");
            assertThat(prontos()).as("janela, inicio " + estado).contains(fim);

            limparNotificacoes();
            linha(null, sessao, "MANUTENCAO_MANUAL_INICIADA", estado);
            long fimManual = linha(null, sessao, "MANUTENCAO_MANUAL_ENCERRADA", "PENDENTE");
            assertThat(prontos()).as("sessao, inicio " + estado).contains(fimManual);
        }
    }

    @Test
    void inicioNuncaSeBloqueia() {
        long inicio = linha(janela, null, "MANUTENCAO_INICIADA", "PENDENTE");
        long inicioManual = linha(null, sessao, "MANUTENCAO_MANUAL_INICIADA", "PENDENTE");

        assertThat(prontos()).contains(inicio, inicioManual);
    }

    @Test
    void fimDeOutraJanelaNaoBloqueia() {
        linha(janela, null, "MANUTENCAO_INICIADA", "PENDENTE");
        long fimDaOutra = linha(outraJanela, null, "MANUTENCAO_ENCERRADA", "PENDENTE");

        assertThat(prontos()).contains(fimDaOutra);
    }

    // ---- MA32: texto do fim a partir do UPDATE ------------------------------------------------

    @Test
    void encerradaComInicioPendenteSemTentativaCancelaEDizNaoEntregue() {
        long inicio = linha(janela, null, "MANUTENCAO_INICIADA", "PENDENTE");

        service.criarParaManutencaoEncerrada(dadosJanela(), agora, agora.plusSeconds(60), termino(), List.of());

        assertThat(status(inicio)).isEqualTo("CANCELADA");
        assertThat(mensagemDoFim("MANUTENCAO_ENCERRADA")).contains(NAO_ENTREGUE).doesNotContain(TALVEZ);
    }

    @Test
    void encerradaComInicioPendenteComTentativaDizTalvez() {
        long inicio = linha(janela, null, "MANUTENCAO_INICIADA", "PENDENTE");
        jdbc.update("update notificacao set tentativas = 2 where id = ?", inicio);

        service.criarParaManutencaoEncerrada(dadosJanela(), agora, agora.plusSeconds(60), termino(), List.of());

        assertThat(status(inicio)).isEqualTo("CANCELADA");
        assertThat(mensagemDoFim("MANUTENCAO_ENCERRADA")).contains(TALVEZ);
    }

    @Test
    void encerradaComInicioFalhaDizTalvez() {
        long inicio = linha(janela, null, "MANUTENCAO_INICIADA", "FALHA");

        service.criarParaManutencaoEncerrada(dadosJanela(), agora, agora.plusSeconds(60), termino(), List.of());

        assertThat(status(inicio)).isEqualTo("FALHA");
        assertThat(mensagemDoFim("MANUTENCAO_ENCERRADA")).contains(TALVEZ);
    }

    @Test
    void encerradaComInicioEnviadaDizNada() {
        linha(janela, null, "MANUTENCAO_INICIADA", "ENVIADA");

        service.criarParaManutencaoEncerrada(dadosJanela(), agora, agora.plusSeconds(60), termino(), List.of());

        assertThat(mensagemDoFim("MANUTENCAO_ENCERRADA")).doesNotContain(NAO_ENTREGUE).doesNotContain(TALVEZ);
    }

    @Test
    void manualEncerradaSegueAMesmaRegra() {
        long inicio = linha(null, sessao, "MANUTENCAO_MANUAL_INICIADA", "PENDENTE");

        service.criarParaManualEncerrada(dadosManual(), agora.plusSeconds(60), "Fulano", false, null);

        assertThat(status(inicio)).isEqualTo("CANCELADA");
        assertThat(mensagemDoFim("MANUTENCAO_MANUAL_ENCERRADA")).contains(NAO_ENTREGUE);
    }

    // ---- idempotencia -------------------------------------------------------------------------

    @Test
    void encerramentoDuplicadoNaoGeraSegundaLinha() {
        service.criarParaManutencaoIniciada(dadosJanela(), agora, false);
        service.criarParaManutencaoEncerrada(dadosJanela(), agora, agora.plusSeconds(60), termino(), List.of());
        service.criarParaManutencaoEncerrada(dadosJanela(), agora, agora.plusSeconds(60), termino(), List.of());

        assertThat(contar("MANUTENCAO_ENCERRADA")).isEqualTo(1);
        assertThat(contar("MANUTENCAO_INICIADA")).isEqualTo(1);
    }

    @Test
    void fimAlteradoRepete() {
        service.criarParaManutencaoFimAlterado(dadosJanela(), agora.plusSeconds(3600), agora.plusSeconds(7200),
                "Fulano", agora);
        service.criarParaManutencaoFimAlterado(dadosJanela(), agora.plusSeconds(7200), agora.plusSeconds(9000),
                "Fulano", agora.plusSeconds(1));

        assertThat(contar("MANUTENCAO_FIM_ALTERADO")).isEqualTo(2);
    }

    @Test
    void manualIniciadaInsereUmaVez() {
        service.criarParaManualIniciada(dadosManual(), false, null, agora);
        service.criarParaManualIniciada(dadosManual(), false, null, agora);

        assertThat(contar("MANUTENCAO_MANUAL_INICIADA")).isEqualTo(1);
    }

    // ---- regressao: as ancoras antigas continuam inserindo -----------------------------------

    @Test
    void ancorasAntigasContinuamInserindo() {
        long monitor = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                + "falhas_para_incidente, sucessos_para_recovery) values (?, 'ICMP', 'ICMP', 60, 2000, true, 3, 2) "
                + "returning id", equipamento);
        long incidente = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Teste') returning id", monitor, Timestamp.from(agora));

        int inseriu = tx.execute(s -> repository.inserirPendenteSeAusente(incidente, null, null, null,
                CanalNotificacao.TELEGRAM.name(), "INCIDENTE_ABERTO", "m", agora));
        int repetiu = tx.execute(s -> repository.inserirPendenteSeAusente(incidente, null, null, null,
                CanalNotificacao.TELEGRAM.name(), "INCIDENTE_ABERTO", "m", agora));

        assertThat(inseriu).isEqualTo(1);
        assertThat(repetiu).isZero();
    }

    // ---- retorno da Task 2: dispatcher usa a entidade desanexada ----------------------------

    @Test
    void dispatcherLogaAncoraDeJanelaComEntidadeReal() {
        long id = linha(janela, null, "MANUTENCAO_INICIADA", "PENDENTE");
        long idManual = linha(null, sessao, "MANUTENCAO_MANUAL_INICIADA", "PENDENTE");

        // Fora de transacao: a entidade chega ao dispatcher desanexada.
        Notificacao daJanela = repository.findById(id).orElseThrow();
        Notificacao doBotao = repository.findById(idManual).orElseThrow();

        assertThat(daJanela.descreverAncora()).isEqualTo("manutencao=" + janela);
        assertThat(doBotao.descreverAncora()).isEqualTo("manutencaoManual=" + sessao);
        assertThat(Hibernate.isInitialized(daJanela.getManutencaoAgendada().getUnidade())).isTrue();
        assertThat(Hibernate.isInitialized(doBotao.getManutencaoManual().getEquipamento().getUnidade())).isTrue();
    }

    // ---- apoio --------------------------------------------------------------------------------

    private List<Long> prontos() {
        return repository.findIdsReadyForDispatch(CanalNotificacao.TELEGRAM, StatusNotificacao.PENDENTE, 5,
                Instant.now().plusSeconds(5), PageRequest.of(0, 50));
    }

    private DadosAnuncio.Janela dadosJanela() {
        return new DadosAnuncio.Janela(janela, "Centro", EscopoManutencao.UNIDADE, 1, List.of("SW-01"), "Teste",
                agora.plusSeconds(3600), agora.plusSeconds(7200), "Operador");
    }

    private DadosAnuncio.Manual dadosManual() {
        return new DadosAnuncio.Manual(sessao, "Centro", "SW-01", "10.0.0.1", agora, "Operador");
    }

    private DadosAnuncio.Termino termino() {
        return new DadosAnuncio.Termino(DadosAnuncio.TipoTermino.COMO_PREVISTO, null, null, null);
    }

    private long novaJanela() {
        return insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, motivo, "
                + "status, criado_por_id) values (?, 'UNIDADE', ?, ?, 'Teste', 'AGENDADA', ?) returning id",
                unidade, Timestamp.from(agora.plusSeconds(3600)), Timestamp.from(agora.plusSeconds(7200)), usuario);
    }

    private void limparNotificacoes() {
        jdbc.execute("delete from notificacao");
    }

    private long linha(Long janelaId, Long sessaoId, String evento, String status) {
        return insert("insert into notificacao (manutencao_agendada_id, manutencao_manual_id, canal, tipo_evento, "
                + "status, tentativas, mensagem, enviado_em, created_at, updated_at) "
                + "values (?, ?, 'TELEGRAM', ?, ?, 0, 'm', case when ? = 'ENVIADA' then now() end, now(), now()) returning id",
                janelaId, sessaoId, evento, status, status);
    }

    private String status(long id) {
        return jdbc.queryForObject("select status from notificacao where id = ?", String.class, id);
    }

    private String mensagemDoFim(String evento) {
        return jdbc.queryForObject("select mensagem from notificacao where tipo_evento = ?", String.class, evento);
    }

    private long contar(String evento) {
        return jdbc.queryForObject("select count(*) from notificacao where tipo_evento = ?", Long.class, evento);
    }

    private long insert(String sql, Object... args) {
        Long id = jdbc.queryForObject(sql, Long.class, args);
        assertThat(id).isNotNull();
        return id;
    }
}

package br.com.inframonitor.incidente;

import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.incidente.dto.CloseIncidenteRequest;
import br.com.inframonitor.incidente.dto.IncidenteResponse;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.incidente.service.IncidenteService;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
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
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integracao real contra PostgreSQL para o fechamento manual de incidente (A1 da
 * auditoria de concorrencia). O caminho antigo lia a entidade, chamava fechar() e fazia
 * saveAndFlush: UPDATE de todas as colunas WHERE id = ?, sem versao, que sobrescrevia um
 * fechamento do motor, um fechamento por manutencao ou um reconhecimento commitados
 * entre a leitura e a escrita.
 *
 * <p>Os tres testes deterministicos forcam essa intercalacao: a transacao externa carrega
 * o incidente na sessao, outra thread commita a acao concorrente e so entao o fechamento
 * manual roda dentro da transacao externa, enxergando a instancia velha em cache. As
 * corridas repetidas medem a distribuicao de desfechos legitimos.
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
class FechamentoManualConcorrenciaPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant T0 = Instant.parse("2026-09-01T08:00:00Z");
    private static final Instant FIM_MOTOR = T0.plusSeconds(300);
    private static final Instant FIM_MANUAL = T0.plusSeconds(600);
    private static final Instant FIM_MANUAL_2 = T0.plusSeconds(660);
    private static final Duration LIMITE = Duration.ofSeconds(10);
    // Atraso aleatorio (0..N ms) depois da barreira, no idioma de
    // ManutencaoPostgresIntegrationTest: sem ele um dos lados vence sempre e so um
    // desfecho legitimo aparece. N calibrado pela latencia de cada caminho concorrente.
    private static final long ATRASO_MAX_MOTOR_MS = 8;
    private static final long ATRASO_MAX_SEGUNDO_OPERADOR_MS = 6;
    // Aqui o atrasado e o manual; a manutencao ja e mais lenta ate escrever no incidente,
    // e atrasar o manual alem de ~4 ms faz a manutencao vencer quase sempre (12 ms: 2/30
    // MAN; 20 ms: 1/30).
    private static final long ATRASO_MAX_MANUAL_VS_MANUTENCAO_MS = 4;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private EquipamentoService equipamentoService;
    @Autowired private IncidenteService incidenteService;
    @Autowired private IncidenteRepository incidenteRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    private long operadorId;

    @BeforeEach
    void limparBanco() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        operadorId = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Operador', 'operador@fechamento.test', 'hash-irrelevante', 'OPERADOR', true, false) "
                + "returning id");
    }

    // ---------------------------------------------------------------------------
    // Deterministicos: instancia velha na sessao do fechamento manual
    // ---------------------------------------------------------------------------

    @Test
    void fecharManualComInstanciaVelhaNaoSobrescreveFechamentoAutomatico() {
        long incidenteId = incidenteAberto(montarEquipamentoEMonitor());

        AtomicReference<IncidenteResponse> resposta = new AtomicReference<>();
        emTransacao(() -> {
            incidenteRepository.findById(incidenteId).orElseThrow();
            emOutraThread(() -> incidenteService.fecharAutomaticamente(
                    incidenteRepository.findById(incidenteId).orElseThrow(), FIM_MOTOR, 2));
            resposta.set(incidenteService.fechar(incidenteId, new CloseIncidenteRequest(FIM_MANUAL, "manual"),
                    operadorId));
        });

        // Quem perdeu o CAS responde com o estado atual, nao com o fechamento que tentou.
        assertThat(resposta.get().motivoEncerramento()).isEqualTo(MotivoEncerramentoIncidente.RECUPERACAO_AUTOMATICA);
        assertThat(resposta.get().encerradoEm()).isEqualTo(FIM_MOTOR);
        Map<String, Object> linha = linha(incidenteId);
        assertThat(linha).containsEntry("status", "FECHADO")
                .containsEntry("motivo_encerramento", "RECUPERACAO_AUTOMATICA");
        assertThat(linha.get("fechado_por")).isNull();
        assertThat(contar(incidenteId, "INCIDENTE_FECHADO")).isEqualTo(1);
    }

    @Test
    void fecharManualComInstanciaVelhaNaoSobrescreveManutencao() {
        long equipamentoId = montarEquipamento();
        long monitorId = montarMonitor(equipamentoId);
        long incidenteId = incidenteAberto(monitorId);
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA') "
                + "returning id", monitorId, Timestamp.from(T0));
        aberturaJaEnviada(incidenteId);

        AtomicReference<IncidenteResponse> resposta = new AtomicReference<>();
        emTransacao(() -> {
            incidenteRepository.findById(incidenteId).orElseThrow();
            emOutraThread(() -> equipamentoService.entrarEmManutencao(equipamentoId, operadorId));
            resposta.set(incidenteService.fechar(incidenteId, new CloseIncidenteRequest(FIM_MANUAL, "manual"),
                    operadorId));
        });

        assertThat(resposta.get().motivoEncerramento()).isEqualTo(MotivoEncerramentoIncidente.MANUTENCAO);
        assertThat(resposta.get().encerradoEm()).isNotEqualTo(FIM_MANUAL);
        assertThat(linha(incidenteId)).containsEntry("status", "FECHADO")
                .containsEntry("motivo_encerramento", "MANUTENCAO");
        assertThat(contar(incidenteId, "INCIDENTE_ENCERRADO_MANUTENCAO")).isEqualTo(1);
        assertThat(contar(incidenteId, "INCIDENTE_FECHADO")).isZero();
    }

    @Test
    void fecharManualComInstanciaVelhaNaoApagaReconhecimento() {
        long incidenteId = incidenteAberto(montarEquipamentoEMonitor());

        emTransacao(() -> {
            incidenteRepository.findById(incidenteId).orElseThrow();
            emOutraThread(() -> incidenteService.reconhecer(incidenteId, operadorId));
            incidenteService.fechar(incidenteId, new CloseIncidenteRequest(FIM_MANUAL, "manual"), operadorId);
        });

        Map<String, Object> linha = linha(incidenteId);
        assertThat(linha).containsEntry("status", "FECHADO")
                .containsEntry("motivo_encerramento", "FECHAMENTO_MANUAL")
                .containsEntry("reconhecido_por", operadorId);
        assertThat(linha.get("reconhecido_em")).isNotNull();
    }

    /**
     * Incidente aberto a mao traz observacao; fechar sem observacao nao pode apaga-la.
     * Mesma regra de Incidente.fechar, que so sobrescreve com valor nao nulo.
     */
    @Test
    void fecharManualSemObservacaoPreservaObservacaoDaAbertura() {
        long incidenteId = insert("insert into incidente (monitor_id, status, iniciado_em, motivo, observacao) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade', 'aberto pelo NOC') returning id",
                montarEquipamentoEMonitor(), Timestamp.from(T0));

        IncidenteResponse resposta = incidenteService.fechar(incidenteId,
                new CloseIncidenteRequest(FIM_MANUAL, null), operadorId);

        assertThat(resposta.observacao()).isEqualTo("aberto pelo NOC");
        assertThat(linha(incidenteId)).containsEntry("status", "FECHADO")
                .containsEntry("motivo_encerramento", "FECHAMENTO_MANUAL")
                .containsEntry("observacao", "aberto pelo NOC");
    }

    // ---------------------------------------------------------------------------
    // Corridas reais, repetidas
    // ---------------------------------------------------------------------------

    /**
     * Legitimos: MAN — FECHAMENTO_MANUAL, fechado_por = operador, observacao do operador;
     * AUTO — RECUPERACAO_AUTOMATICA, fechado_por nulo, observacao do motor. Nos dois,
     * exatamente uma INCIDENTE_FECHADO e o "Fim:" da mensagem igual ao encerrado_em da
     * linha: sem CAS, o manual regrava a linha depois do motor e a mensagem ja criada
     * continua descrevendo a recuperacao.
     */
    @RepeatedTest(30)
    void fecharManualEFecharAutomaticamenteConcorrentes() throws Exception {
        long incidenteId = incidenteAberto(montarEquipamentoEMonitor());
        Incidente carregadoPeloMotor = incidenteRepository.findById(incidenteId).orElseThrow();

        List<Throwable> falhas = correr(
                () -> incidenteService.fechar(incidenteId, new CloseIncidenteRequest(FIM_MANUAL, "manual"),
                        operadorId),
                () -> {
                    Thread.sleep(ThreadLocalRandom.current().nextLong(ATRASO_MAX_MOTOR_MS + 1));
                    incidenteService.fecharAutomaticamente(carregadoPeloMotor, FIM_MOTOR, 2);
                });
        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();

        Map<String, Object> linha = linha(incidenteId);
        Object motivo = linha.get("motivo_encerramento");
        Object fechadoPor = linha.get("fechado_por");
        String observacao = (String) linha.get("observacao");
        int fechadas = contar(incidenteId, "INCIDENTE_FECHADO");
        boolean coerente = fechadas == 1 && mensagemFechamentoCoincideComLinha(incidenteId);
        boolean manual = coerente && "FECHAMENTO_MANUAL".equals(motivo) && Long.valueOf(operadorId).equals(fechadoPor)
                && "manual".equals(observacao);
        boolean motor = coerente && "RECUPERACAO_AUTOMATICA".equals(motivo) && fechadoPor == null
                && observacao != null && observacao.startsWith("Recuperacao detectada");
        System.out.println("[corrida-manual-motor] desfecho=" + (manual ? "MAN" : motor ? "AUTO" : "ILEGITIMO")
                + " motivo=" + motivo + " fechadoPor=" + fechadoPor + " fechadas=" + fechadas
                + " mensagemCoerente=" + mensagemFechamentoCoincideComLinha(incidenteId));

        assertThat(linha.get("status")).isEqualTo("FECHADO");
        assertThat(manual || motor).as("um fechamento so: motivo, autor, observacao e aviso do MESMO vencedor")
                .isTrue();
    }

    /**
     * Legitimo: fechado_por de um dos dois operadores, com a observacao e o encerrado_em
     * desse mesmo operador, e uma INCIDENTE_FECHADO cuja mensagem descreve esse fechamento.
     */
    @RepeatedTest(30)
    void doisFechamentosManuaisConcorrentes() throws Exception {
        long incidenteId = incidenteAberto(montarEquipamentoEMonitor());
        long segundoOperadorId = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, "
                + "troca_senha_obrigatoria) values ('Operador 2', 'operador2@fechamento.test', 'hash-irrelevante', "
                + "'OPERADOR', true, false) returning id");

        List<Throwable> falhas = correr(
                () -> incidenteService.fechar(incidenteId, new CloseIncidenteRequest(FIM_MANUAL, "op1"), operadorId),
                () -> {
                    Thread.sleep(ThreadLocalRandom.current().nextLong(ATRASO_MAX_SEGUNDO_OPERADOR_MS + 1));
                    incidenteService.fechar(incidenteId, new CloseIncidenteRequest(FIM_MANUAL_2, "op2"),
                            segundoOperadorId);
                });
        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();

        Map<String, Object> linha = linha(incidenteId);
        Object fechadoPor = linha.get("fechado_por");
        Object observacao = linha.get("observacao");
        Instant encerradoEm = ((Timestamp) linha.get("encerrado_em")).toInstant();
        int fechadas = contar(incidenteId, "INCIDENTE_FECHADO");
        boolean coerente = fechadas == 1 && "FECHAMENTO_MANUAL".equals(linha.get("motivo_encerramento"))
                && mensagemFechamentoCoincideComLinha(incidenteId);
        boolean op1 = coerente && Long.valueOf(operadorId).equals(fechadoPor) && "op1".equals(observacao)
                && FIM_MANUAL.equals(encerradoEm);
        boolean op2 = coerente && Long.valueOf(segundoOperadorId).equals(fechadoPor) && "op2".equals(observacao)
                && FIM_MANUAL_2.equals(encerradoEm);
        System.out.println("[corrida-manual-manual] desfecho=" + (op1 ? "OP1" : op2 ? "OP2" : "ILEGITIMO")
                + " fechadoPor=" + fechadoPor + " observacao=" + observacao + " fechadas=" + fechadas
                + " mensagemCoerente=" + mensagemFechamentoCoincideComLinha(incidenteId));

        assertThat(linha.get("status")).isEqualTo("FECHADO");
        assertThat(op1 || op2).as("autor, observacao, encerrado_em e aviso do MESMO operador").isTrue();
    }

    /**
     * Legitimos: MANUTENCAO — so INCIDENTE_ENCERRADO_MANUTENCAO; MAN — FECHAMENTO_MANUAL,
     * fechado_por = operador, observacao do operador e so INCIDENTE_FECHADO, com o "Fim:"
     * da mensagem igual ao encerrado_em da linha. Nunca os dois avisos.
     */
    @RepeatedTest(30)
    void fecharManualEEntrarEmManutencaoConcorrentes() throws Exception {
        long equipamentoId = montarEquipamento();
        long monitorId = montarMonitor(equipamentoId);
        long incidenteId = incidenteAberto(monitorId);
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA') "
                + "returning id", monitorId, Timestamp.from(T0));
        aberturaJaEnviada(incidenteId);

        List<Throwable> falhas = correr(
                () -> equipamentoService.entrarEmManutencao(equipamentoId, operadorId),
                () -> {
                    Thread.sleep(ThreadLocalRandom.current().nextLong(ATRASO_MAX_MANUAL_VS_MANUTENCAO_MS + 1));
                    incidenteService.fechar(incidenteId, new CloseIncidenteRequest(FIM_MANUAL, "manual"), operadorId);
                });
        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();

        Map<String, Object> linha = linha(incidenteId);
        Object motivo = linha.get("motivo_encerramento");
        int encerradasPorManutencao = contar(incidenteId, "INCIDENTE_ENCERRADO_MANUTENCAO");
        int fechadas = contar(incidenteId, "INCIDENTE_FECHADO");
        boolean manutencao = "MANUTENCAO".equals(motivo) && encerradasPorManutencao == 1 && fechadas == 0;
        boolean manual = "FECHAMENTO_MANUAL".equals(motivo) && fechadas == 1 && encerradasPorManutencao == 0
                && Long.valueOf(operadorId).equals(linha.get("fechado_por")) && "manual".equals(linha.get("observacao"))
                && mensagemFechamentoCoincideComLinha(incidenteId);
        System.out.println("[corrida-manual-manutencao] desfecho=" + (manutencao ? "MANUTENCAO"
                : manual ? "MAN" : "ILEGITIMO") + " motivo=" + motivo + " encerradasPorManutencao="
                + encerradasPorManutencao + " fechadas=" + fechadas);

        assertThat(linha.get("status")).isEqualTo("FECHADO");
        assertThat(manutencao || manual).as("um encerramento so: motivo e aviso do MESMO vencedor").isTrue();
    }

    // ---------------------------------------------------------------------------
    // Fixtures
    // ---------------------------------------------------------------------------

    private interface Acao {
        void executar() throws Exception;
    }

    /** Duas threads reais, cada uma na sua transacao, alinhadas por barreira. */
    private List<Throwable> correr(Acao primeira, Acao segunda) throws InterruptedException {
        CyclicBarrier partida = new CyclicBarrier(2);
        List<Throwable> falhas = new CopyOnWriteArrayList<>();
        Thread a = new Thread(() -> largar(partida, falhas, primeira), "corrida-A");
        Thread b = new Thread(() -> largar(partida, falhas, segunda), "corrida-B");
        a.start();
        b.start();
        a.join(LIMITE.toMillis());
        b.join(LIMITE.toMillis());
        // join com prazo volta em silencio; thread viva aqui e travamento, nao desfecho.
        assertThat(a.isAlive() || b.isAlive()).as("thread da corrida ainda viva apos " + LIMITE).isFalse();
        return falhas;
    }

    private void largar(CyclicBarrier partida, List<Throwable> falhas, Acao acao) {
        try {
            partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
            acao.executar();
        } catch (Throwable erro) {
            falhas.add(erro);
        }
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

    private boolean mensagemFechamentoCoincideComLinha(long incidenteId) {
        List<String> mensagens = jdbc.queryForList("select mensagem from notificacao where incidente_id = ? "
                + "and tipo_evento = 'INCIDENTE_FECHADO'", String.class, incidenteId);
        Timestamp encerradoEm = jdbc.queryForObject("select encerrado_em from incidente where id = ?",
                Timestamp.class, incidenteId);
        return mensagens.size() == 1 && encerradoEm != null
                && mensagens.get(0).contains("Fim: " + java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm").withZone(java.time.ZoneId.of("America/Sao_Paulo")).format(encerradoEm.toInstant()));
    }

    private Map<String, Object> linha(long incidenteId) {
        return jdbc.queryForMap("select status, motivo_encerramento, fechado_por, observacao, encerrado_em, "
                + "reconhecido_em, reconhecido_por from incidente where id = ?", incidenteId);
    }

    private int contar(long incidenteId, String tipoEvento) {
        return jdbc.queryForObject("select count(*) from notificacao where incidente_id = ? and tipo_evento = ?",
                Integer.class, incidenteId, tipoEvento);
    }

    private long incidenteAberto(long monitorId) {
        return insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitorId, Timestamp.from(T0));
    }

    private void aberturaJaEnviada(long incidenteId) {
        // ENVIADA: a manutencao gera INCIDENTE_ENCERRADO_MANUTENCAO em vez de so cancelar.
        insert("insert into notificacao (incidente_id, canal, tipo_evento, status, mensagem, enviado_em) "
                + "values (?, 'TELEGRAM', 'INCIDENTE_ABERTO', 'ENVIADA', 'msg', ?) returning id",
                incidenteId, Timestamp.from(T0));
    }

    private long montarEquipamentoEMonitor() {
        return montarMonitor(montarEquipamento());
    }

    private long montarEquipamento() {
        long tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        long unidade = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        return insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, "
                + "em_manutencao) values (?, ?, 'SW-CORE', '10.0.0.10', true, false) returning id", unidade, tipo);
    }

    private long montarMonitor(long equipamentoId) {
        return insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                        + "falhas_para_incidente, sucessos_para_recovery) "
                        + "values (?, 'ICMP', 'ICMP CORE', 60, 2000, true, 3, 2) returning id",
                equipamentoId);
    }

    private void emTransacao(Runnable acao) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> acao.run());
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}

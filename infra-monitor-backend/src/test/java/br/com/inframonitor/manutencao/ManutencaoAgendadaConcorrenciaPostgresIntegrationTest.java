package br.com.inframonitor.manutencao;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.equipamento.dto.EquipamentoResponse;
import br.com.inframonitor.equipamento.dto.UpdateEquipamentoRequest;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.equipamento.service.EstadoManutencaoEquipamento;
import br.com.inframonitor.incidente.service.IncidenteService;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao.Transicao;
import br.com.inframonitor.manutencao.service.ManutencaoAgendadaService;
import br.com.inframonitor.manutencao.service.ReconciliadorManutencao;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static java.time.temporal.ChronoUnit.HOURS;
import static java.time.temporal.ChronoUnit.MINUTES;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Corridas REAIS da manutencao agendada (F1, Task 6): duas threads, cada uma nas suas
 * transacoes, alinhadas por {@link CyclicBarrier}, com atraso aleatorio depois da barreira
 * calibrado para que, quando a corrida admite dois desfechos legitimos, os dois aparecam nas
 * 30 repeticoes. Cada repeticao imprime {@code [corrida-<nome>] desfecho=<ROTULO>} e falha
 * com ILEGITIMO. Uma falha de thread (excecao, deadlock abortado pelo Postgres) tambem e
 * ILEGITIMO: o operador ou o tick receberiam erro por causa da corrida.
 *
 * <p>Provas de reversao de cada guarda: Docs/validacao-producao/manutencao-agendada-f1.md.
 *
 * <p>O {@code @Scheduled} do reconciliador dispara uma vez na subida do contexto, com o banco
 * vazio; o intervalo de uma hora o tira do caminho. As corridas chamam {@code reconciliar}
 * direto, como o tick faria.
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
class ManutencaoAgendadaConcorrenciaPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Duration LIMITE = Duration.ofSeconds(10);

    // Atrasos aleatorios (0..N ms) depois da barreira. Sem eles um lado vence sempre e so um
    // desfecho legitimo aparece. Os numeros abaixo sao MEDICAO DE CALIBRACAO (30 repeticoes cada,
    // Docker local, 2026-10-22), nao a distribuicao final: essa fica no doc de validacao.
    // 1: medicao de calibracao — atrasar o CANCELAR (0..8 ms) deu 30/30 ATIV: o CAS de ativacao e a
    //    primeira instrucao do reconciliador e chega antes. Atrasando o RECONCILIADOR em 0..8 ms: 20 CANC / 10 ATIV.
    private static final long ATRASO_RECONCILIADOR_VS_CANCELAR_MS = 8;
    // 2: medicao de calibracao — concluirVencidas e o TERCEIRO CAS do reconciliador. Atrasar o reconciliador (0..8) deu
    //    30/30 OPER; atrasar o ENCERRAR 0..8 deu 30/30 AUTO, 0..4 deu 22 AUTO / 8 OPER, 0..2 deu 15/15.
    private static final long ATRASO_ENCERRAR_VS_CONCLUSAO_MS = 2;
    // 3: medicao de calibracao — atrasar o botao (0..8) deu 30/30 FICOU (a ativacao commita antes da leitura da cobertura).
    //    Atrasando o RECONCILIADOR em 0..8 ms: 19 SAIU_E_VOLTOU / 11 FICOU.
    private static final long ATRASO_RECONCILIADOR_VS_MANUAL_MS = 8;
    // 4: dois encerrar simetricos; atraso pequeno so para variar quem chega primeiro. Medicao de
    //    calibracao: com ele a reversao do FOR UPDATE da 20/30 vermelho.
    private static final long ATRASO_SEGUNDO_ENCERRAR_MS = 4;
    // 5: o motor e um INSERT so; o reconciliador precisa ativar e chegar ao lock do equipamento.
    //    Medicao de calibracao, 0..8 ms no motor: 19 INC_PRIMEIRO / 11 MANUT_PRIMEIRO.
    private static final long ATRASO_MOTOR_MS = 8;
    // 6: duas passadas simetricas; 0..4 ms alterna quem ganha o CAS de ativacao (medicao de
    //    calibracao: 24 A / 6 B).
    private static final long ATRASO_SEGUNDA_PASSADA_MS = 4;
    // 7: medicao de calibracao — 0..8 ms no PUT: ele sempre le em_manutencao = false, e em ~metade das repeticoes grava
    //    depois da virada (a reversao de updatable = false da 16/30 vermelho).
    private static final long ATRASO_PUT_MS = 8;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private ReconciliadorManutencao reconciliador;
    @Autowired private ManutencaoAgendadaService service;
    @Autowired private EstadoManutencaoEquipamento estado;
    @Autowired private EquipamentoService equipamentoService;
    @Autowired private IncidenteService incidenteService;
    @Autowired private MonitorRepository monitorRepository;

    private Instant agora;
    private long operadorId;
    private long tipo;
    private long u;
    private long equipamento;
    private long monitor;

    @BeforeEach
    void montarCenario() {
        jdbc.execute("truncate table manutencao_agendada_alteracao, manutencao_agendada_equipamento, manutencao_agendada, janela_monitoramento, "
                + "medicao, notificacao, monitor_episodio_latencia, incidente, monitor, equipamento, "
                + "tipo_equipamento, unidade, usuarios restart identity cascade");
        agora = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        operadorId = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Operador', 'operador@corridas.test', 'hash-irrelevante', 'OPERADOR', true, false) "
                + "returning id");
        tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        u = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        equipamento = novoEquipamento("SW-01");
        monitor = novoMonitor(equipamento);
    }

    // ---------------------------------------------------------------------------
    // 1. Job ativa x operador cancela
    // ---------------------------------------------------------------------------

    /** Legitimos: CANC (CANCELADA, equipamento fora) ou ATIV (ATIVA, cancelar -> 409, equipamento em manutencao). */
    @RepeatedTest(30)
    void ativacaoECancelamentoConcorrentes() throws Exception {
        long j = janela("AGENDADA", agora.minusSeconds(1), agora.plus(1, HOURS), equipamento);
        AtomicReference<Throwable> recusa = new AtomicReference<>();

        List<Throwable> falhas = correr(
                () -> {
                    atrasar(ATRASO_RECONCILIADOR_VS_CANCELAR_MS);
                    reconciliador.reconciliar(Instant.now());
                },
                () -> {
                    try {
                        service.cancelar(j, operadorId);
                    } catch (ConflitoException e) {
                        recusa.set(e);
                    }
                });

        String s = situacao(j);
        boolean em = emManutencao(equipamento);
        int slaAbertas = janelasSlaAbertas(monitor);
        // Efeitos coerentes com o flag: fora mede (1 SLA aberta), em manutencao nao mede (0).
        boolean canc = falhas.isEmpty() && "CANCELADA".equals(s) && !em && slaAbertas == 1 && recusa.get() == null;
        boolean ativ = falhas.isEmpty() && "ATIVA".equals(s) && em && slaAbertas == 0 && recusa.get() != null;
        System.out.println("[corrida-ativar-cancelar] desfecho=" + (canc ? "CANC" : ativ ? "ATIV" : "ILEGITIMO")
                + " situacao=" + s + " emManutencao=" + em + " slaAbertas=" + slaAbertas + " recusado="
                + (recusa.get() != null) + " falhas=" + resumo(falhas));

        assertThat(resumo(falhas)).isEmpty();
        assertThat(canc || ativ).as("cancelada e fora, ou ativa, recusada e em manutencao").isTrue();
    }

    // ---------------------------------------------------------------------------
    // 2. Encerrar agora x conclusao automatica
    // ---------------------------------------------------------------------------

    /**
     * Legitimos: OPER (encerrada_por = operador, o reconciliador NAO relata a conclusao) ou AUTO
     * (encerrada_por nulo, o operador recebe 409 e o reconciliador relata). Nos dois: CONCLUIDA,
     * equipamento fora, UMA janela de SLA aberta (saida aplicada uma vez). ILEGITIMO inclui os
     * dois lados afirmando que concluiram a mesma janela.
     */
    @RepeatedTest(30)
    void encerrarAgoraEConclusaoAutomatica() throws Exception {
        long j = janelaAtivaComEfeitosAplicados(agora.minus(1, HOURS), agora.minusSeconds(1), equipamento);
        AtomicReference<Throwable> recusa = new AtomicReference<>();
        AtomicReference<ReconciliadorManutencao.Resultado> passada = new AtomicReference<>();

        List<Throwable> falhas = correr(
                () -> {
                    passada.set(reconciliador.reconciliar(Instant.now()));
                },
                () -> {
                    atrasar(ATRASO_ENCERRAR_VS_CONCLUSAO_MS);
                    try {
                        service.encerrar(j, operadorId);
                    } catch (ConflitoException e) {
                        recusa.set(e);
                    }
                });

        Map<String, Object> linha = linhaJanela(j);
        Object encerradaPor = linha.get("encerrada_por_id");
        boolean autoRelatou = passada.get() != null && passada.get().concluidas().stream()
                .map(Transicao::manutencaoId).anyMatch(id -> id == j);
        boolean em = emManutencao(equipamento);
        int slaAbertas = janelasSlaAbertas(monitor);
        boolean comum = falhas.isEmpty() && "CONCLUIDA".equals(linha.get("status")) && !em && slaAbertas == 1;
        boolean oper = comum && Long.valueOf(operadorId).equals(encerradaPor) && recusa.get() == null && !autoRelatou;
        boolean auto = comum && encerradaPor == null && recusa.get() != null && autoRelatou;
        System.out.println("[corrida-encerrar-concluir] desfecho=" + (oper ? "OPER" : auto ? "AUTO" : "ILEGITIMO")
                + " situacao=" + linha.get("status") + " encerradaPor=" + encerradaPor + " recusado="
                + (recusa.get() != null) + " autoRelatou=" + autoRelatou + " emManutencao=" + em
                + " slaAbertas=" + slaAbertas + " falhas=" + resumo(falhas));

        assertThat(resumo(falhas)).isEmpty();
        assertThat(oper || auto).as("um encerramento so, de um autor so, saida aplicada uma vez").isTrue();
    }

    // ---------------------------------------------------------------------------
    // 3. Botao encerrar manual x janela ativando no mesmo equipamento
    // ---------------------------------------------------------------------------

    /**
     * Inicial: manual ligado (efeitos aplicados), janela AGENDADA devida. Legitimo unico em estado
     * final: ATIVA, manual = false, em_manutencao = true, ZERO janelas de SLA abertas. Desfechos
     * pela ordem observada: SAIU_E_VOLTOU (houve saida + entrada: janela de SLA criada e fechada
     * durante a corrida) ou FICOU (nunca saiu: nenhuma janela de SLA nova).
     */
    @RepeatedTest(30)
    void encerrarManualEAtivacaoDeJanela() throws Exception {
        estado.iniciarManual(equipamento, operadorId);
        assertThat(janelasSlaAbertas(monitor)).isZero();
        long j = janela("AGENDADA", agora.minusSeconds(1), agora.plus(1, HOURS), equipamento);
        long ultimaSla = ultimaJanelaSla();

        List<Throwable> falhas = correr(
                () -> {
                    atrasar(ATRASO_RECONCILIADOR_VS_MANUAL_MS);
                    reconciliador.reconciliar(Instant.now());
                },
                () -> equipamentoService.sairDeManutencao(equipamento));

        String s = situacao(j);
        Map<String, Object> flags = flags(equipamento);
        boolean em = (Boolean) flags.get("em_manutencao");
        boolean manual = (Boolean) flags.get("manutencao_manual");
        int slaAbertas = janelasSlaAbertas(monitor);
        int slaNovas = jdbc.queryForObject("select count(*) from janela_monitoramento where id > ?",
                Integer.class, ultimaSla);
        boolean legitimo = falhas.isEmpty() && "ATIVA".equals(s) && !manual && em && slaAbertas == 0;
        String desfecho = !legitimo ? "ILEGITIMO" : slaNovas > 0 ? "SAIU_E_VOLTOU" : "FICOU";
        System.out.println("[corrida-manual-ativacao] desfecho=" + desfecho + " situacao=" + s
                + " emManutencao=" + em + " manual=" + manual + " slaAbertas=" + slaAbertas + " slaNovas=" + slaNovas
                + " falhas=" + resumo(falhas));

        assertThat(resumo(falhas)).isEmpty();
        assertThat(legitimo).as("janela ATIVA cobrindo deixa o equipamento em manutencao, sem SLA aberta").isTrue();
    }

    // ---------------------------------------------------------------------------
    // 4. Duas janelas sobrepostas terminando juntas
    // ---------------------------------------------------------------------------

    /** Legitimo: as duas CONCLUIDA, em_manutencao = false, exatamente UMA janela de SLA aberta (saida uma vez). */
    @RepeatedTest(30)
    void duasJanelasSobrepostasTerminandoJuntas() throws Exception {
        long j1 = janela("AGENDADA", agora.minus(10, MINUTES), agora.plus(1, HOURS), equipamento);
        long j2 = janela("AGENDADA", agora.minus(10, MINUTES), agora.plus(1, HOURS), equipamento);
        reconciliador.reconciliar(agora);
        assertThat(situacao(j1)).isEqualTo("ATIVA");
        assertThat(situacao(j2)).isEqualTo("ATIVA");
        assertThat(emManutencao(equipamento)).isTrue();

        List<Throwable> falhas = correr(() -> service.encerrar(j1, operadorId),
                () -> {
                    atrasar(ATRASO_SEGUNDO_ENCERRAR_MS);
                    service.encerrar(j2, operadorId);
                });

        boolean em = emManutencao(equipamento);
        int slaAbertas = janelasSlaAbertas(monitor);
        boolean legitimo = falhas.isEmpty() && "CONCLUIDA".equals(situacao(j1)) && "CONCLUIDA".equals(situacao(j2))
                && !em && slaAbertas == 1;
        System.out.println("[corrida-duas-janelas] desfecho=" + (legitimo ? "UMA_SAIDA" : "ILEGITIMO")
                + " j1=" + situacao(j1) + " j2=" + situacao(j2) + " emManutencao=" + em + " slaAbertas=" + slaAbertas
                + " falhas=" + resumo(falhas));

        assertThat(resumo(falhas)).isEmpty();
        assertThat(legitimo).as("as duas concluidas, equipamento fora, saida aplicada uma vez").isTrue();
    }

    // ---------------------------------------------------------------------------
    // 5. Janela ativando x motor abrindo incidente
    // ---------------------------------------------------------------------------

    /**
     * Motor com 3 falhas ja gravadas apos a ancora, chamando abrirAutomaticamente (INSERT
     * condicional). Legitimos: MANUT_PRIMEIRO (nenhum incidente novo) ou INC_PRIMEIRO (incidente
     * FECHADO com MANUTENCAO). ILEGITIMO: incidente ABERTO com em_manutencao = true, ou abertura
     * PENDENTE orfa.
     */
    @RepeatedTest(30)
    void ativacaoEMotorAbrindoIncidente() throws Exception {
        for (int i = 3; i >= 1; i--) {
            jdbc.update("insert into medicao (monitor_id, status, mensagem, executado_em) values (?, 'FALHA', 'x', ?)",
                    monitor, Timestamp.from(agora.minusSeconds(i)));
        }
        Monitor carregado = monitorRepository.findById(monitor).orElseThrow();
        janela("AGENDADA", agora.minusSeconds(1), agora.plus(1, HOURS), equipamento);

        List<Throwable> falhas = correr(() -> reconciliador.reconciliar(Instant.now()),
                () -> {
                    atrasar(ATRASO_MOTOR_MS);
                    incidenteService.abrirAutomaticamente(carregado, Instant.now(), 3);
                });

        boolean em = emManutencao(equipamento);
        List<Map<String, Object>> incidentes = jdbc.queryForList(
                "select status, motivo_encerramento from incidente where monitor_id = ?", monitor);
        int orfas = jdbc.queryForObject("select count(*) from notificacao where tipo_evento = 'INCIDENTE_ABERTO' "
                + "and status = 'PENDENTE'", Integer.class);
        boolean manutPrimeiro = falhas.isEmpty() && em && orfas == 0 && incidentes.isEmpty();
        boolean incPrimeiro = falhas.isEmpty() && em && orfas == 0 && incidentes.size() == 1
                && "FECHADO".equals(incidentes.get(0).get("status"))
                && "MANUTENCAO".equals(incidentes.get(0).get("motivo_encerramento"));
        System.out.println("[corrida-ativacao-motor] desfecho=" + (manutPrimeiro ? "MANUT_PRIMEIRO"
                : incPrimeiro ? "INC_PRIMEIRO" : "ILEGITIMO") + " emManutencao=" + em + " incidentes=" + incidentes
                + " aberturasPendentes=" + orfas + " falhas=" + resumo(falhas));

        assertThat(resumo(falhas)).isEmpty();
        assertThat(manutPrimeiro || incPrimeiro).as("nenhum incidente ABERTO com o equipamento em manutencao")
                .isTrue();
    }

    // ---------------------------------------------------------------------------
    // 6. Duas passadas do reconciliador com janelas de unidade sobrepostas
    // ---------------------------------------------------------------------------

    /**
     * Duas janelas UNIDADE (mesma unidade, 3 equipamentos com incidente aberto cada) ativando
     * juntas, com duas passadas em paralelo (tick sobreposto ou dois nos). Legitimo: sem deadlock
     * (threads terminam no LIMITE, sem erro), cada incidente fechado UMA vez com UMA notificacao de
     * encerramento, todos em_manutencao = true. Rotulo: qual passada ganhou o CAS de ativacao.
     */
    @RepeatedTest(30)
    void duasPassadasDoReconciliadorComJanelasDeUnidadeSobrepostas() throws Exception {
        long e2 = novoEquipamento("SW-02");
        long e3 = novoEquipamento("SW-03");
        List<Long> equipamentos = List.of(equipamento, e2, e3);
        for (long e : equipamentos) {
            long m = e == equipamento ? monitor : novoMonitor(e);
            long inc = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                    + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", m, Timestamp.from(agora.minus(1, HOURS)));
            insert("insert into notificacao (incidente_id, canal, tipo_evento, status, mensagem, enviado_em) "
                    + "values (?, 'TELEGRAM', 'INCIDENTE_ABERTO', 'ENVIADA', 'msg', ?) returning id",
                    inc, Timestamp.from(agora.minus(1, HOURS)));
        }
        janelaUnidade(agora.minusSeconds(1), agora.plus(1, HOURS));
        janelaUnidade(agora.minusSeconds(1), agora.plus(2, HOURS));
        AtomicReference<ReconciliadorManutencao.Resultado> a = new AtomicReference<>();
        AtomicReference<ReconciliadorManutencao.Resultado> b = new AtomicReference<>();

        List<Throwable> falhas = correr(() -> a.set(reconciliador.reconciliar(Instant.now())),
                () -> {
                    atrasar(ATRASO_SEGUNDA_PASSADA_MS);
                    b.set(reconciliador.reconciliar(Instant.now()));
                });

        int emManutencao = jdbc.queryForObject("select count(*) from equipamento where em_manutencao", Integer.class);
        int fechadosPorManutencao = jdbc.queryForObject("select count(*) from incidente where status = 'FECHADO' "
                + "and motivo_encerramento = 'MANUTENCAO'", Integer.class);
        List<Integer> avisosPorIncidente = jdbc.queryForList("select (select count(*) from notificacao n "
                + "where n.incidente_id = i.id and n.tipo_evento = 'INCIDENTE_ENCERRADO_MANUTENCAO') from incidente i "
                + "order by i.id", Integer.class);
        int ativas = jdbc.queryForObject("select count(*) from manutencao_agendada where status = 'ATIVA'",
                Integer.class);
        boolean legitimo = falhas.isEmpty() && emManutencao == 3 && fechadosPorManutencao == 3 && ativas == 2
                && avisosPorIncidente.equals(List.of(1, 1, 1));
        int ativouA = a.get() == null ? -1 : a.get().ativadas().size();
        int ativouB = b.get() == null ? -1 : b.get().ativadas().size();
        String quem = ativouA == 2 && ativouB == 0 ? "ATIVOU_A" : ativouB == 2 && ativouA == 0 ? "ATIVOU_B"
                : "ATIVOU_DIVIDIDO";
        System.out.println("[corrida-duas-passadas] desfecho=" + (legitimo ? quem : "ILEGITIMO")
                + " emManutencao=" + emManutencao + " fechadosPorManutencao=" + fechadosPorManutencao
                + " avisosPorIncidente=" + avisosPorIncidente + " ativadasA=" + ativouA + " ativadasB=" + ativouB
                + " falhas=" + resumo(falhas));

        assertThat(resumo(falhas)).isEmpty();
        assertThat(legitimo).as("sem deadlock, cada incidente fechado uma vez, todos em manutencao").isTrue();
    }

    // ---------------------------------------------------------------------------
    // 7. Atualizar equipamento (PUT) x job virando o flag
    // ---------------------------------------------------------------------------

    /**
     * Legitimo: nome novo E em_manutencao = true. Rotulo pela leitura que o PUT fez:
     * PUT_LEU_FORA (carregou em_manutencao = false, antes da virada: e o caso em que um
     * dirty-check da linha inteira regravaria o flag velho) ou PUT_LEU_DENTRO.
     */
    @RepeatedTest(30)
    void atualizarEquipamentoEJobVirandoFlag() throws Exception {
        janela("AGENDADA", agora.minusSeconds(1), agora.plus(1, HOURS), equipamento);
        AtomicReference<EquipamentoResponse> resposta = new AtomicReference<>();
        UpdateEquipamentoRequest renomear = new UpdateEquipamentoRequest(u, tipo, "SW-01-RENOMEADO", null, null,
                null, null, null, null, null);

        List<Throwable> falhas = correr(() -> reconciliador.reconciliar(Instant.now()),
                () -> {
                    atrasar(ATRASO_PUT_MS);
                    resposta.set(equipamentoService.atualizar(equipamento, renomear));
                });

        Map<String, Object> linha = jdbc.queryForMap("select nome, em_manutencao from equipamento where id = ?",
                equipamento);
        boolean legitimo = falhas.isEmpty() && "SW-01-RENOMEADO".equals(linha.get("nome"))
                && Boolean.TRUE.equals(linha.get("em_manutencao"));
        String leitura = resposta.get() == null ? "?" : resposta.get().emManutencao() ? "PUT_LEU_DENTRO" : "PUT_LEU_FORA";
        System.out.println("[corrida-put-flag] desfecho=" + (legitimo ? leitura : "ILEGITIMO")
                + " nome=" + linha.get("nome") + " emManutencao=" + linha.get("em_manutencao")
                + " putLeu=" + leitura + " falhas=" + resumo(falhas));

        assertThat(resumo(falhas)).isEmpty();
        assertThat(legitimo).as("o PUT nao regrava o flag virado pelo job").isTrue();
    }

    // ---------------------------------------------------------------------------
    // Fixtures (correr/largar no idioma de FechamentoManualConcorrenciaPostgresIntegrationTest)
    // ---------------------------------------------------------------------------

    private interface Acao {
        void executar() throws Exception;
    }

    /** Duas threads reais, cada uma nas suas transacoes, alinhadas por barreira. */
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

    private static void atrasar(long maximoMs) throws InterruptedException {
        Thread.sleep(ThreadLocalRandom.current().nextLong(maximoMs + 1));
    }

    private static List<String> resumo(List<Throwable> falhas) {
        return falhas.stream().map(Throwable::toString).toList();
    }

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
        assertThat(situacao(id)).isEqualTo("ATIVA");
        assertThat(emManutencao(equipamentoId)).isTrue();
        assertThat(janelasSlaAbertas(monitor)).isZero();
        return id;
    }

    private long novoEquipamento(String nome) {
        return insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ativo, em_manutencao) "
                + "values (?, ?, ?, true, false) returning id", u, tipo, nome);
    }

    /** Monitor ativo com a janela de SLA aberta, como o cadastro deixaria. */
    private long novoMonitor(long equipamentoId) {
        long id = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                + "falhas_para_incidente, sucessos_para_recovery) "
                + "values (?, 'ICMP', 'ICMP', 60, 2000, true, 3, 2) returning id", equipamentoId);
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA') "
                + "returning id", id, Timestamp.from(agora.minus(Duration.ofDays(1))));
        return id;
    }

    private String situacao(long manutencaoId) {
        return jdbc.queryForObject("select status from manutencao_agendada where id = ?", String.class, manutencaoId);
    }

    private Map<String, Object> linhaJanela(long id) {
        return jdbc.queryForMap("select * from manutencao_agendada where id = ?", id);
    }

    private boolean emManutencao(long equipamentoId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("select em_manutencao from equipamento where id = ?",
                Boolean.class, equipamentoId));
    }

    private Map<String, Object> flags(long equipamentoId) {
        return jdbc.queryForMap("select em_manutencao, manutencao_manual from equipamento where id = ?", equipamentoId);
    }

    private int janelasSlaAbertas(long monitorId) {
        return jdbc.queryForObject("select count(*) from janela_monitoramento where monitor_id = ? and fim_em is null",
                Integer.class, monitorId);
    }

    private long ultimaJanelaSla() {
        return jdbc.queryForObject("select coalesce(max(id), 0) from janela_monitoramento", Long.class);
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}

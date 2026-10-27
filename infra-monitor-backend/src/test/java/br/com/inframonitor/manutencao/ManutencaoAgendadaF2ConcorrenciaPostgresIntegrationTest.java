package br.com.inframonitor.manutencao;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.dto.UpdateEquipamentoRequest;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.manutencao.dto.AlterarFimRequest;
import br.com.inframonitor.manutencao.dto.EditarManutencaoRequest;
import br.com.inframonitor.manutencao.entity.EscopoManutencao;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao.Transicao;
import br.com.inframonitor.manutencao.service.ManutencaoAgendadaService;
import br.com.inframonitor.manutencao.service.ReconciliadorManutencao;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
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
 * Corridas da F2 (spec §4). C1–C3 sao guardas de CAS/lock; C4 NAO e CAS: e convergencia em ate
 * uma passada do reconciliador de nivel (MA26). Provas de reversao:
 * Docs/validacao-producao/manutencao-agendada-f2.md.
 *
 * <p>Mesmo idioma de {@link ManutencaoAgendadaConcorrenciaPostgresIntegrationTest}: duas threads
 * reais, cada uma nas suas transacoes, alinhadas por {@link CyclicBarrier}, atraso aleatorio
 * depois da barreira calibrado para que os dois desfechos legitimos aparecam em 30 repeticoes.
 * Cada repeticao imprime {@code [corrida-<nome>] desfecho=<ROTULO>}; falha de thread e ILEGITIMO.
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
class ManutencaoAgendadaF2ConcorrenciaPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Duration LIMITE = Duration.ofSeconds(10);

    // Atrasos aleatorios (0..N ms) depois da barreira. MEDICAO DE CALIBRACAO (30 repeticoes cada, Docker local,
    // 2026-10-23), nao a distribuicao final: essa fica no doc de validacao.
    // C1: medicao de calibracao — atrasar o RECONCILIADOR deu EDICAO 27/3 (0..8), 26/4 (0..4), 26/4 (0..2): o lock da
    //    edicao e a primeira instrucao e chega antes. Atrasando a EDICAO: 23/7 (0..0), 9 EDICAO / 21 JOB (0..1),
    //    5/25 (0..2). Recalibrado em 2026-10-26 (F3: o reconciliador passou a ler as candidatas antes do CAS de
    //    cada janela e a anunciar na transacao): 0..1 deu 30/30 EDICAO; 0..3 deu 14 EDICAO / 16 JOB; 0..6 deu 4/26.
    private static final long ATRASO_C1_MS = 3;
    // C2: medicao de calibracao — concluirVencidas e o TERCEIRO CAS do reconciliador. Atrasar o reconciliador (0..2,
    //    0..4, 0..8) deu 30/30 PRORROGOU. Atrasando o ALTERAR FIM: 24 PRORROGOU / 6 CONCLUIU (0..2), 14/16 (0..4),
    //    9/21 (0..8).
    private static final long ATRASO_C2_MS = 4;
    // C3: dois pedidos simetricos, o segundo atrasado. Medicao de calibracao (edicoes / fins, B:C): 0..4 deu 26:4 /
    //    29:1, 0..2 deu 24:6 / 26:4, 0..1 deu 21:9 / 22:8, 0..0 deu 15:15 / 19:11.
    private static final long ATRASO_C3_MS = 1;
    // C4: qualquer distribuicao DIRETO/UMA_PASSADA e legitima. Medicao de calibracao, reconciliador 0..8:
    //    6 DIRETO / 24 UMA_PASSADA (a criacao le a cobertura cedo e commita tarde; a passada da corrida nao a ve).
    private static final long ATRASO_C4_MS = 8;

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
    @Autowired private EquipamentoService equipamentoService;

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
    // C1. Editar AGENDADA x job ativando
    // ---------------------------------------------------------------------------

    /**
     * Janela AGENDADA devida (inicio = agora - 1 s) com A. A edicao troca A por B e MANTEM o inicio:
     * mudar o inicio para o futuro seria barrado pelo CHECK ck_manutencao_agendada_ativacao e
     * mascararia a prova. Legitimos: EDICAO (ATIVA com B; B dentro; A fora) ou JOB (409; ATIVA com A;
     * A dentro; B fora). ILEGITIMO: ligacao e efeitos discordando.
     *
     * <p>Guarda dupla: o {@code status} no WHERE da edicao e o {@code versao + 1} da ativacao barram
     * a corrida cada um sozinho; a reversao so fica vermelha removendo os dois (ver o doc de evidencia).
     */
    @RepeatedTest(30)
    void editarAgendadaEJobAtivando() throws Exception {
        long b = novoEquipamento("SW-B");
        Instant inicio = agora.minusSeconds(1);
        long j = janela("AGENDADA", inicio, agora.plus(1, HOURS), equipamento);
        int v = versao(j);
        AtomicReference<Throwable> recusa = new AtomicReference<>();
        EditarManutencaoRequest req = new EditarManutencaoRequest(u, EscopoManutencao.EQUIPAMENTOS, List.of(b), inicio,
                agora.plus(1, HOURS), "Trocado", v);

        List<Throwable> falhas = correr(
                () -> reconciliador.reconciliar(Instant.now()),
                () -> { atrasar(ATRASO_C1_MS);
                        try { service.editar(j, req, operadorId); } catch (ConflitoException e) { recusa.set(e); } });

        String s = situacao(j);
        List<Long> lig = ligados(j);
        boolean emA = emManutencao(equipamento), emB = emManutencao(b);
        boolean edicao = falhas.isEmpty() && recusa.get() == null && "ATIVA".equals(s) && lig.equals(List.of(b))
                && emB && !emA && alteracoes(j) == 1;
        boolean job = falhas.isEmpty() && recusa.get() != null && "ATIVA".equals(s) && lig.equals(List.of(equipamento))
                && emA && !emB && alteracoes(j) == 0;
        System.out.println("[corrida-editar-ativar] desfecho=" + (edicao ? "EDICAO" : job ? "JOB" : "ILEGITIMO")
                + " situacao=" + s + " ligados=" + lig + " emA=" + emA + " emB=" + emB + " recusado="
                + (recusa.get() != null) + " falhas=" + resumo(falhas));
        assertThat(resumo(falhas)).isEmpty();
        assertThat(edicao || job).as("ligacao e efeitos concordam").isTrue();
    }

    // ---------------------------------------------------------------------------
    // C2. Alterar fim x job concluindo
    // ---------------------------------------------------------------------------

    /**
     * ATIVA com fim vencido (fim = agora - 1 s). Legitimos: PRORROGOU (ATIVA, fim = +1 h, dentro, 1
     * alteracao) ou CONCLUIU (409, CONCLUIDA, fim antigo, fora, 0 alteracoes). ILEGITIMO: CONCLUIDA
     * com fim alterado (historia reescrita) ou ATIVA com o equipamento fora.
     *
     * <p>Guarda dupla, como em C1: {@code status} no WHERE do alterar fim e {@code versao + 1} da conclusao.
     */
    @RepeatedTest(30)
    void prorrogarEJobConcluindo() throws Exception {
        Instant fimAntigo = agora.minusSeconds(1);
        long j = janelaAtivaComEfeitosAplicados(agora.minus(1, HOURS), fimAntigo, equipamento);
        int v = versao(j);
        Instant novoFim = Instant.now().plus(1, HOURS).truncatedTo(ChronoUnit.MILLIS);
        AtomicReference<Throwable> recusa = new AtomicReference<>();

        List<Throwable> falhas = correr(
                () -> reconciliador.reconciliar(Instant.now()),
                () -> { atrasar(ATRASO_C2_MS);
                        try { service.alterarFim(j, new AlterarFimRequest(novoFim, v), operadorId); }
                        catch (ConflitoException e) { recusa.set(e); } });

        Map<String, Object> linha = jdbc.queryForMap("select status, fim_previsto from manutencao_agendada where id = ?", j);
        Instant fim = ((Timestamp) linha.get("fim_previsto")).toInstant();
        boolean em = emManutencao(equipamento);
        boolean prorrogou = falhas.isEmpty() && recusa.get() == null && "ATIVA".equals(linha.get("status"))
                && fim.equals(novoFim) && em && alteracoes(j) == 1;
        boolean concluiu = falhas.isEmpty() && recusa.get() != null && "CONCLUIDA".equals(linha.get("status"))
                && fim.equals(fimAntigo) && !em && alteracoes(j) == 0;
        System.out.println("[corrida-prorrogar-concluir] desfecho=" + (prorrogou ? "PRORROGOU" : concluiu ? "CONCLUIU"
                : "ILEGITIMO") + " situacao=" + linha.get("status") + " fim=" + fim + " em=" + em
                + " recusado=" + (recusa.get() != null) + " falhas=" + resumo(falhas));
        assertThat(resumo(falhas)).isEmpty();
        assertThat(prorrogou || concluiu).as("historia nao reescrita").isTrue();
    }

    // ---------------------------------------------------------------------------
    // C3. Duas edicoes com a mesma versao (editar x editar; fim x fim)
    // ---------------------------------------------------------------------------

    /** Legitimo: exatamente um ganha, estado final inteiro dele, uma alteracao. ILEGITIMO: dois ganham / mistura. */
    @RepeatedTest(30)
    void duasEdicoesComAMesmaVersao() throws Exception {
        long b = novoEquipamento("SW-B");
        long c = novoEquipamento("SW-C");
        Instant inicio = agora.plus(2, HOURS);
        long j = janela("AGENDADA", inicio, inicio.plus(1, HOURS), equipamento);
        int v = versao(j);
        var reqB = new EditarManutencaoRequest(u, EscopoManutencao.EQUIPAMENTOS, List.of(b), inicio,
                inicio.plus(2, HOURS), "Pedido B", v);
        var reqC = new EditarManutencaoRequest(u, EscopoManutencao.EQUIPAMENTOS, List.of(c), inicio.plus(1, HOURS),
                inicio.plus(3, HOURS), "Pedido C", v);
        AtomicReference<Throwable> recusaB = new AtomicReference<>(), recusaC = new AtomicReference<>();

        List<Throwable> falhas = correr(
                () -> { try { service.editar(j, reqB, operadorId); } catch (ConflitoException e) { recusaB.set(e); } },
                () -> { atrasar(ATRASO_C3_MS);
                        try { service.editar(j, reqC, operadorId); } catch (ConflitoException e) { recusaC.set(e); } });

        Map<String, Object> l = jdbc.queryForMap("select motivo, inicio_previsto, versao from manutencao_agendada where id = ?", j);
        List<Long> lig = ligados(j);
        boolean venceuB = recusaB.get() == null && recusaC.get() != null && "Pedido B".equals(l.get("motivo"))
                && lig.equals(List.of(b)) && ((Timestamp) l.get("inicio_previsto")).toInstant().equals(inicio);
        boolean venceuC = recusaC.get() == null && recusaB.get() != null && "Pedido C".equals(l.get("motivo"))
                && lig.equals(List.of(c)) && ((Timestamp) l.get("inicio_previsto")).toInstant().equals(inicio.plus(1, HOURS));
        boolean legitimo = falhas.isEmpty() && (venceuB || venceuC) && alteracoes(j) == 1
                && Integer.valueOf(v + 1).equals(l.get("versao"));
        System.out.println("[corrida-duas-edicoes] desfecho=" + (!legitimo ? "ILEGITIMO" : venceuB ? "B" : "C")
                + " motivo=" + l.get("motivo") + " ligados=" + lig + " alteracoes=" + alteracoes(j)
                + " falhas=" + resumo(falhas));
        assertThat(resumo(falhas)).isEmpty();
        assertThat(legitimo).isTrue();
    }

    @RepeatedTest(30)
    void duasAlteracoesDeFimComAMesmaVersao() throws Exception {
        long j = janelaAtivaComEfeitosAplicados(agora.minus(1, HOURS), agora.plus(1, HOURS), equipamento);
        int v = versao(j);
        Instant fimB = agora.plus(2, HOURS), fimC = agora.plus(3, HOURS);
        AtomicReference<Throwable> recusaB = new AtomicReference<>(), recusaC = new AtomicReference<>();

        List<Throwable> falhas = correr(
                () -> { try { service.alterarFim(j, new AlterarFimRequest(fimB, v), operadorId); }
                        catch (ConflitoException e) { recusaB.set(e); } },
                () -> { atrasar(ATRASO_C3_MS);
                        try { service.alterarFim(j, new AlterarFimRequest(fimC, v), operadorId); }
                        catch (ConflitoException e) { recusaC.set(e); } });

        Instant fim = jdbc.queryForObject("select fim_previsto from manutencao_agendada where id = ?", Timestamp.class, j)
                .toInstant();
        boolean venceuB = recusaB.get() == null && recusaC.get() != null && fim.equals(fimB);
        boolean venceuC = recusaC.get() == null && recusaB.get() != null && fim.equals(fimC);
        boolean legitimo = falhas.isEmpty() && (venceuB || venceuC) && alteracoes(j) == 1;
        System.out.println("[corrida-dois-fins] desfecho=" + (!legitimo ? "ILEGITIMO" : venceuB ? "B" : "C")
                + " fim=" + fim + " alteracoes=" + alteracoes(j) + " falhas=" + resumo(falhas));
        assertThat(resumo(falhas)).isEmpty();
        assertThat(legitimo).isTrue();
    }

    // ---------------------------------------------------------------------------
    // C4. Janela UNIDADE concluindo x equipamento criado (convergencia, NAO CAS)
    // ---------------------------------------------------------------------------

    /**
     * NAO E CAS (MA26): a criacao do equipamento e a conclusao da janela nao dividem lock. A
     * garantia e o reconciliador de NIVEL: depois das duas threads, no maximo UMA passada extra deixa
     * zero divergentes. Desfechos: DIRETO (ja convergido ao fim das threads) ou UMA_PASSADA (o novo
     * equipamento ficou em manutencao com a janela concluida e a passada seguinte corrigiu).
     * ILEGITIMO: divergente apos a passada extra, ou falha de thread.
     */
    @RepeatedTest(30)
    void janelaDeUnidadeConcluindoEEquipamentoCriado() throws Exception {
        long j = janelaUnidade(agora.minus(1, HOURS), agora.minusSeconds(1));
        reconciliador.reconciliar(agora.minus(1, HOURS).plus(1, MINUTES));   // ativa; fim ainda no futuro do tick
        assertThat(situacao(j)).isEqualTo("ATIVA");
        AtomicReference<Long> criado = new AtomicReference<>();
        CreateEquipamentoRequest novo = new CreateEquipamentoRequest(u, tipo, "SW-NOVO", null, null, null, null, null,
                null, null);

        List<Throwable> falhas = correr(
                () -> { atrasar(ATRASO_C4_MS); reconciliador.reconciliar(Instant.now()); },
                () -> criado.set(equipamentoService.criar(novo).id()));

        int divergentesAntes = divergentes();
        reconciliador.reconciliar(Instant.now());   // a passada extra
        int divergentesDepois = divergentes();
        boolean legitimo = falhas.isEmpty() && "CONCLUIDA".equals(situacao(j)) && divergentesDepois == 0
                && !emManutencao(criado.get());
        System.out.println("[corrida-unidade-criacao] desfecho=" + (!legitimo ? "ILEGITIMO"
                : divergentesAntes == 0 ? "DIRETO" : "UMA_PASSADA") + " divergentesAntes=" + divergentesAntes
                + " divergentesDepois=" + divergentesDepois + " falhas=" + resumo(falhas));
        assertThat(resumo(falhas)).isEmpty();
        assertThat(legitimo).isTrue();
    }

    // ---------------------------------------------------------------------------
    // Sem corrida: unidade dinamica no escopo UNIDADE
    // ---------------------------------------------------------------------------

    @Test
    void equipamentoMovidoParaForaDaUnidadeSaiNaHora() {
        long norte = insert("insert into unidade (nome, sigla, ativo) values ('Norte', 'NRT', true) returning id");
        long j = janelaUnidade(agora.minus(1, HOURS), agora.plus(1, HOURS));
        reconciliador.reconciliar(agora);
        assertThat(emManutencao(equipamento)).isTrue();
        equipamentoService.atualizar(equipamento, new UpdateEquipamentoRequest(norte, tipo, "SW-01", null, null, null,
                null, null, null, null));
        assertThat(emManutencao(equipamento)).isFalse();
        assertThat(situacao(j)).isEqualTo("ATIVA");
    }

    @Test
    void equipamentoExcluidoDuranteJanelaDeUnidadeNaoQuebraConclusao() {
        long avulso = novoEquipamento("SW-AVULSO");
        long j = janelaUnidade(agora.minus(1, HOURS), agora.plus(1, HOURS));
        reconciliador.reconciliar(agora);
        assertThat(emManutencao(avulso)).isTrue();
        equipamentoService.excluir(avulso);
        var r = reconciliador.reconciliar(agora.plus(2, HOURS));
        assertThat(r.concluidas()).extracting(Transicao::manutencaoId).containsExactly(j);
        assertThat(situacao(j)).isEqualTo("CONCLUIDA");
    }

    private int versao(long j) {
        return jdbc.queryForObject("select versao from manutencao_agendada where id = ?", Integer.class, j);
    }

    private List<Long> ligados(long j) {
        return jdbc.queryForList("select equipamento_id from manutencao_agendada_equipamento where manutencao_id = ? "
                + "order by equipamento_id", Long.class, j);
    }

    private int alteracoes(long j) {
        return jdbc.queryForObject("select count(*) from manutencao_agendada_alteracao where manutencao_id = ?",
                Integer.class, j);
    }

    private int divergentes() {
        return jdbc.queryForObject("select count(*) from equipamento e where e.em_manutencao <> (e.manutencao_manual or "
                + CoberturaManutencao.COBERTO_E + ")", Integer.class);
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

    private boolean emManutencao(long equipamentoId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("select em_manutencao from equipamento where id = ?",
                Boolean.class, equipamentoId));
    }

    private int janelasSlaAbertas(long monitorId) {
        return jdbc.queryForObject("select count(*) from janela_monitoramento where monitor_id = ? and fim_em is null",
                Integer.class, monitorId);
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}

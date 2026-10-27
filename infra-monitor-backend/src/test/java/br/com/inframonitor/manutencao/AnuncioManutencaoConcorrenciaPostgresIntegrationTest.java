package br.com.inframonitor.manutencao;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.equipamento.service.EstadoManutencaoEquipamento;
import br.com.inframonitor.manutencao.dto.AlterarFimRequest;
import br.com.inframonitor.manutencao.service.ManutencaoAgendadaService;
import br.com.inframonitor.manutencao.service.ReconciliadorManutencao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
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
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static java.time.temporal.ChronoUnit.HOURS;
import static java.time.temporal.ChronoUnit.MINUTES;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Corridas REAIS dos anuncios de manutencao (F3, Task 8; desenho secao 5): duas threads, cada uma
 * nas suas transacoes, alinhadas por {@link CyclicBarrier}, com atraso aleatorio depois da barreira
 * calibrado para que, quando a corrida admite dois desfechos legitimos, os dois aparecam nas 30
 * repeticoes. Cada repeticao imprime {@code [corrida-<nome>] desfecho=<ROTULO>} e falha com
 * ILEGITIMO. Falha de thread (excecao, deadlock abortado pelo Postgres) tambem e ILEGITIMO.
 *
 * <p>Provas de reversao de cada guarda: Docs/validacao-producao/manutencao-agendada-f3.md.
 *
 * <p>O {@code @Scheduled} do reconciliador dispara uma vez na subida do contexto, com o banco vazio;
 * o intervalo de uma hora o tira do caminho. As corridas chamam {@code reconciliar} direto.
 *
 * <p>Requer Docker. Sem Docker disponivel o teste e ignorado, nunca falha.
 */
@RequerDocker
@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-anuncio-corridas-test",
        "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false",
        "manutencao.agendada.enabled=true",
        "manutencao.agendada.intervalo-ms=3600000"
})
class AnuncioManutencaoConcorrenciaPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Duration LIMITE = Duration.ofSeconds(10);
    private static final String NAO_ENTREGUE = "O aviso de início não foi entregue";
    private static final String TALVEZ_ENTREGUE = "O aviso de início pode não ter sido entregue";

    // Atrasos aleatorios (0..N ms) depois da barreira. Sem eles um lado vence sempre e so um desfecho
    // legitimo aparece. MEDICAO DE CALIBRACAO (30 repeticoes cada, Docker local, 2026-10-26), nao a
    // distribuicao final: essa fica no doc de validacao.
    // 1: medicao de calibracao — o CAS de conclusao vem depois de duas leituras e de uma transacao do
    //    reconciliador; atrasando o ENCERRAR: 0..4 deu 26 AUTO / 4 OPER, 0..2 deu 21/9, 0..1 deu 21/9.
    private static final long ATRASO_ENCERRAR_VS_CONCLUSAO_MS = 1;
    // 2: medicao de calibracao — atrasando o ALTERAR FIM: 0..4 deu 11 PRORROGOU / 19 RECUSADO (duas vezes),
    //    0..3 deu 20/10.
    private static final long ATRASO_ALTERAR_FIM_MS = 3;
    // 3: medicao de calibracao — a reserva e um UPDATE so; o encerrar le a janela antes do cancelamento.
    //    Atrasando a RESERVA: 0..4 deu 3 CANCELOU / 27 RESERVOU, 0..10 deu 21/9, 0..7 deu 17/13.
    private static final long ATRASO_RESERVA_MS = 7;
    // 4: dois cliques simetricos; atraso pequeno so para variar quem chega primeiro. Medicao de calibracao,
    //    0..2 no segundo: 24 PRIMEIRO / 6 SEGUNDO, depois 21/9 e 22/8.
    private static final long ATRASO_SEGUNDO_CLIQUE_MS = 2;
    // 5: medicao de calibracao — o reconciliador ativa e so depois reavalia o equipamento; atrasando o BOTAO:
    //    0..8 deu 23 BOTAO_PRIMEIRO / 7 JANELA_PRIMEIRO, 0..15 deu 14/16 e depois 7/23.
    private static final long ATRASO_BOTAO_MS = 15;

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
    @Autowired private NotificacaoRepository notificacoes;
    @Autowired private PlatformTransactionManager transactionManager;

    private Instant agora;
    private long criadorId;
    private long operadorId;
    private long tipo;
    private long u;
    private long equipamento;
    private long monitor;

    @BeforeEach
    void montarCenario() {
        jdbc.execute("truncate table manutencao_agendada_alteracao, manutencao_agendada_equipamento, manutencao_agendada, "
                + "janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, incidente, monitor, "
                + "manutencao_manual, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        agora = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        criadorId = usuario("Criador Janela", "criador@corridas.test");
        operadorId = usuario("Operador Botao", "operador@corridas.test");
        tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        u = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        equipamento = insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ativo, em_manutencao) "
                + "values (?, ?, 'SW-01', true, false) returning id", u, tipo);
        monitor = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                + "falhas_para_incidente, sucessos_para_recovery) "
                + "values (?, 'ICMP', 'ICMP', 60, 2000, true, 3, 2) returning id", equipamento);
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA') "
                + "returning id", monitor, Timestamp.from(agora.minus(Duration.ofDays(1))));
    }

    // ---------------------------------------------------------------------------
    // 1. Job conclui x "Encerrar agora"
    // ---------------------------------------------------------------------------

    /**
     * Janela ATIVA vencida (fim = agora - 1 s). Legitimos: AUTO (encerrada_por nulo, operador recebe
     * 409, fim "como previsto") ou OPER (encerrada_por = operador, fim "antecipado por"). ILEGITIMO:
     * numero de MANUTENCAO_ENCERRADA diferente de 1, ou "antecipado" sem encerrada_por_id (e vice-versa).
     */
    @RepeatedTest(30)
    void conclusaoJobVsEncerrarAgora() throws Exception {
        long j = janelaAtivaComEfeitosAplicados(agora.minus(1, HOURS), agora.minusSeconds(1));
        AtomicReference<Throwable> recusa = new AtomicReference<>();

        List<Throwable> falhas = correr(
                () -> reconciliador.reconciliar(Instant.now()),
                () -> {
                    atrasar(ATRASO_ENCERRAR_VS_CONCLUSAO_MS);
                    try {
                        service.encerrar(j, operadorId);
                    } catch (ConflitoException e) {
                        recusa.set(e);
                    }
                });

        Map<String, Object> linha = jdbc.queryForMap("select status, encerrada_por_id from manutencao_agendada "
                + "where id = ?", j);
        Object encerradaPor = linha.get("encerrada_por_id");
        List<String> fins = mensagens("MANUTENCAO_ENCERRADA");
        boolean antecipado = fins.size() == 1 && fins.get(0).contains("Término: antecipado por Operador Botao");
        boolean comoPrevisto = fins.size() == 1 && fins.get(0).contains("Término: como previsto");
        boolean comum = falhas.isEmpty() && "CONCLUIDA".equals(linha.get("status")) && fins.size() == 1;
        boolean oper = comum && Long.valueOf(operadorId).equals(encerradaPor) && recusa.get() == null && antecipado;
        boolean auto = comum && encerradaPor == null && recusa.get() != null && comoPrevisto;
        System.out.println("[corrida-conclusao-encerrar] desfecho=" + (oper ? "OPER" : auto ? "AUTO" : "ILEGITIMO")
                + " situacao=" + linha.get("status") + " encerradaPor=" + encerradaPor + " recusado="
                + (recusa.get() != null) + " encerradas=" + fins.size() + " antecipado=" + antecipado
                + " comoPrevisto=" + comoPrevisto + " falhas=" + resumo(falhas));

        assertThat(resumo(falhas)).isEmpty();
        assertThat(oper || auto).as("uma ENCERRADA; 'antecipado' se e somente se encerrada_por_id").isTrue();
    }

    // ---------------------------------------------------------------------------
    // 2. "Alterar fim" x job conclui
    // ---------------------------------------------------------------------------

    /**
     * Janela ATIVA vencida; o operador prorroga com a versao lida. Depois da corrida uma passada no
     * fim novo conclui o que ainda estiver ATIVA, para conferir o texto do fim. Legitimos: PRORROGOU
     * (FIM_ALTERADO + 1 PRORROGACAO; fim "após prorrogação") ou RECUSADO (409, nenhum FIM_ALTERADO,
     * nenhuma PRORROGACAO; fim "como previsto"). ILEGITIMO: FIM_ALTERADO sem a PRORROGACAO registrada,
     * ou ENCERRADA incoerente com ela.
     */
    @RepeatedTest(30)
    void alterarFimVsConclusao() throws Exception {
        long j = janelaAtivaComEfeitosAplicados(agora.minus(1, HOURS), agora.minusSeconds(1));
        int v = jdbc.queryForObject("select versao from manutencao_agendada where id = ?", Integer.class, j);
        Instant novoFim = Instant.now().plus(1, HOURS).truncatedTo(ChronoUnit.MILLIS);
        AtomicReference<Throwable> recusa = new AtomicReference<>();

        List<Throwable> falhas = correr(
                () -> reconciliador.reconciliar(Instant.now()),
                () -> {
                    atrasar(ATRASO_ALTERAR_FIM_MS);
                    try {
                        service.alterarFim(j, new AlterarFimRequest(novoFim, v), operadorId);
                    } catch (ConflitoException e) {
                        recusa.set(e);
                    }
                });
        int fimAlterado = mensagens("MANUTENCAO_FIM_ALTERADO").size();
        int prorrogacoes = jdbc.queryForObject("select count(*) from manutencao_agendada_alteracao "
                + "where manutencao_id = ? and tipo = 'PRORROGACAO'", Integer.class, j);
        // O que a corrida deixou ATIVA termina aqui, sem corrida, para o texto do fim existir nos dois desfechos.
        reconciliador.reconciliar(novoFim.plus(1, MINUTES));

        List<String> fins = mensagens("MANUTENCAO_ENCERRADA");
        boolean aposProrrogacao = fins.size() == 1 && fins.get(0).contains("Término: como previsto, após prorrogação");
        boolean comoPrevisto = fins.size() == 1 && fins.get(0).contains("Término: como previsto")
                && !fins.get(0).contains("após");
        boolean comum = falhas.isEmpty() && "CONCLUIDA".equals(situacao(j)) && fins.size() == 1;
        boolean prorrogou = comum && recusa.get() == null && fimAlterado == 1 && prorrogacoes == 1 && aposProrrogacao;
        boolean recusado = comum && recusa.get() != null && fimAlterado == 0 && prorrogacoes == 0 && comoPrevisto;
        System.out.println("[corrida-alterar-fim-conclusao] desfecho=" + (prorrogou ? "PRORROGOU"
                : recusado ? "RECUSADO" : "ILEGITIMO") + " recusado=" + (recusa.get() != null)
                + " fimAlterado=" + fimAlterado + " prorrogacoes=" + prorrogacoes + " encerradas=" + fins.size()
                + " aposProrrogacao=" + aposProrrogacao + " comoPrevisto=" + comoPrevisto
                + " falhas=" + resumo(falhas));

        assertThat(resumo(falhas)).isEmpty();
        assertThat(prorrogou || recusado).as("FIM_ALTERADO so com a PRORROGACAO registrada; fim coerente com ela")
                .isTrue();
    }

    // ---------------------------------------------------------------------------
    // 3. Fim da janela x dispatcher reservando o inicio
    // ---------------------------------------------------------------------------

    /**
     * Inicio PENDENTE (sem tentativa). Thread A reserva o inicio como o dispatcher (PENDENTE ->
     * ENVIANDO); thread B encerra a janela. Legitimos: CANCELOU (inicio CANCELADA, reserva 0, fim diz
     * "não foi entregue") ou RESERVOU (inicio ENVIANDO, reserva 1, fim sem nenhuma das duas frases).
     * ILEGITIMO: inicio saindo e fim dizendo que nao foi entregue, ou cancelado e fim normal.
     */
    @RepeatedTest(30)
    void fimVsDispatcherReservaInicio() throws Exception {
        long j = janela("AGENDADA", agora.minusSeconds(1), agora.plus(1, HOURS));
        reconciliador.reconciliar(agora);
        assertThat(situacao(j)).isEqualTo("ATIVA");
        long inicio = jdbc.queryForObject("select id from notificacao where tipo_evento = 'MANUTENCAO_INICIADA' "
                + "and status = 'PENDENTE' and tentativas = 0 and erro is null", Long.class);
        TransactionTemplate dispatcher = new TransactionTemplate(transactionManager);
        AtomicInteger reservou = new AtomicInteger(-1);

        List<Throwable> falhas = correr(
                () -> {
                    atrasar(ATRASO_RESERVA_MS);
                    reservou.set(dispatcher.execute(s -> notificacoes.reserveForDispatch(inicio, Instant.now())));
                },
                () -> service.encerrar(j, operadorId));

        String statusInicio = jdbc.queryForObject("select status from notificacao where id = ?", String.class, inicio);
        List<String> fins = mensagens("MANUTENCAO_ENCERRADA");
        boolean naoEntregue = fins.size() == 1 && fins.get(0).contains(NAO_ENTREGUE);
        boolean talvez = fins.size() == 1 && fins.get(0).contains(TALVEZ_ENTREGUE);
        boolean comum = falhas.isEmpty() && "CONCLUIDA".equals(situacao(j)) && fins.size() == 1;
        boolean cancelou = comum && "CANCELADA".equals(statusInicio) && reservou.get() == 0 && naoEntregue && !talvez;
        boolean reservouInicio = comum && "ENVIANDO".equals(statusInicio) && reservou.get() == 1 && !naoEntregue
                && !talvez;
        System.out.println("[corrida-fim-reserva-inicio] desfecho=" + (cancelou ? "CANCELOU"
                : reservouInicio ? "RESERVOU" : "ILEGITIMO") + " inicio=" + statusInicio + " reservou="
                + reservou.get() + " encerradas=" + fins.size() + " naoEntregue=" + naoEntregue
                + " talvezEntregue=" + talvez + " falhas=" + resumo(falhas));

        assertThat(resumo(falhas)).isEmpty();
        assertThat(cancelou || reservouInicio).as("o texto do fim diz o que aconteceu com o inicio").isTrue();
    }

    // ---------------------------------------------------------------------------
    // 4. Dois cliques "Iniciar manutencao"
    // ---------------------------------------------------------------------------

    /**
     * Dois usuarios clicam juntos. Legitimo: 1 sessao aberta, 1 MANUTENCAO_MANUAL_INICIADA, nenhuma
     * excecao (o segundo e idempotente). Rotulo: de quem ficou a sessao.
     */
    @RepeatedTest(30)
    void doisCliquesIniciar() throws Exception {
        List<Throwable> falhas = correr(
                () -> estado.iniciarManual(equipamento, criadorId),
                () -> {
                    atrasar(ATRASO_SEGUNDO_CLIQUE_MS);
                    estado.iniciarManual(equipamento, operadorId);
                });

        List<Long> autores = jdbc.queryForList("select iniciada_por_id from manutencao_manual "
                + "where equipamento_id = ? and encerrada_em is null", Long.class, equipamento);
        int sessoes = jdbc.queryForObject("select count(*) from manutencao_manual", Integer.class);
        int avisos = mensagens("MANUTENCAO_MANUAL_INICIADA").size();
        boolean legitimo = falhas.isEmpty() && sessoes == 1 && autores.size() == 1 && avisos == 1;
        String quem = !legitimo ? "ILEGITIMO" : autores.get(0) == criadorId ? "PRIMEIRO_CLIQUE" : "SEGUNDO_CLIQUE";
        System.out.println("[corrida-dois-cliques] desfecho=" + quem + " sessoes=" + sessoes + " abertas="
                + autores.size() + " avisos=" + avisos + " falhas=" + resumo(falhas));

        assertThat(resumo(falhas)).isEmpty();
        assertThat(legitimo).as("uma sessao, um aviso, segundo clique sem erro").isTrue();
    }

    // ---------------------------------------------------------------------------
    // 5. "Iniciar manutencao" x ativacao da janela no mesmo equipamento
    // ---------------------------------------------------------------------------

    /**
     * Incidente ABERTO no equipamento; janela AGENDADA devida criada por outro usuario. Legitimos:
     * BOTAO_PRIMEIRO (texto sem janela, "Sem fim previsto"; incidente fechado pelo usuario do botao)
     * ou JANELA_PRIMEIRO (texto cita a janela; incidente fechado pelo criador da janela). Nos dois:
     * 1 sessao, 1 MANUAL_INICIADA, 1 MANUTENCAO_INICIADA. ILEGITIMO: texto cita a janela e o incidente
     * foi fechado pelo botao, ou nao cita e foi fechado pelo criador.
     */
    @RepeatedTest(30)
    void iniciarManualVsAtivacaoJanela() throws Exception {
        long incidente = incidenteAberto();
        long j = janela("AGENDADA", agora.minusSeconds(1), agora.plus(1, HOURS));

        List<Throwable> falhas = correr(
                () -> reconciliador.reconciliar(Instant.now()),
                () -> {
                    atrasar(ATRASO_BOTAO_MS);
                    estado.iniciarManual(equipamento, operadorId);
                });

        List<String> manuais = mensagens("MANUTENCAO_MANUAL_INICIADA");
        int sessoes = jdbc.queryForObject("select count(*) from manutencao_manual", Integer.class);
        int inicios = mensagens("MANUTENCAO_INICIADA").size();
        Map<String, Object> inc = jdbc.queryForMap("select status, fechado_por from incidente where id = ?", incidente);
        Object fechadoPor = inc.get("fechado_por");
        boolean citaJanela = manuais.size() == 1 && manuais.get(0).contains("Já estava na janela #" + j);
        boolean semFim = manuais.size() == 1 && manuais.get(0).contains("Sem fim previsto");
        boolean comum = falhas.isEmpty() && sessoes == 1 && manuais.size() == 1 && inicios == 1
                && "ATIVA".equals(situacao(j)) && "FECHADO".equals(inc.get("status"));
        boolean botao = comum && !citaJanela && semFim && Long.valueOf(operadorId).equals(fechadoPor);
        boolean janelaPrimeiro = comum && citaJanela && !semFim && Long.valueOf(criadorId).equals(fechadoPor);
        System.out.println("[corrida-botao-ativacao] desfecho=" + (botao ? "BOTAO_PRIMEIRO"
                : janelaPrimeiro ? "JANELA_PRIMEIRO" : "ILEGITIMO") + " citaJanela=" + citaJanela
                + " semFim=" + semFim + " fechadoPor=" + fechadoPor + " (botao=" + operadorId + ", criador="
                + criadorId + ") sessoes=" + sessoes + " manuais=" + manuais.size() + " inicios=" + inicios
                + " falhas=" + resumo(falhas));

        assertThat(resumo(falhas)).isEmpty();
        assertThat(botao || janelaPrimeiro).as("texto cita a janela se e somente se os efeitos nao rodaram pelo botao")
                .isTrue();
    }

    /**
     * Sem corrida: o intervalo que a corrida 5 so as vezes pega. Janela ATIVA cobrindo, mas a
     * reavaliacao ainda nao rodou (em_manutencao = false). O botao le o flag travado: os efeitos de
     * entrada rodam por ele, entao o texto NAO pode citar a janela. Fixa "texto e efeitos leem o
     * mesmo flag travado".
     */
    @Test
    void janelaAtivaComFlagAindaFalsoBotaoNaoCitaJanelaEFechaPeloBotao() {
        long incidente = incidenteAberto();
        long j = janela("ATIVA", agora.minus(10, MINUTES), agora.plus(1, HOURS));
        assertThat(jdbc.queryForObject("select em_manutencao from equipamento where id = ?", Boolean.class,
                equipamento)).isFalse();

        estado.iniciarManual(equipamento, operadorId);

        List<String> manuais = mensagens("MANUTENCAO_MANUAL_INICIADA");
        assertThat(manuais).hasSize(1);
        assertThat(manuais.get(0)).contains("Sem fim previsto: volta só quando alguém encerrar.")
                .doesNotContain("Já estava").doesNotContain("#" + j);
        assertThat(jdbc.queryForMap("select status, fechado_por from incidente where id = ?", incidente))
                .containsEntry("status", "FECHADO").containsEntry("fechado_por", operadorId);
    }

    // ---------------------------------------------------------------------------
    // Fixtures (correr/largar no idioma de ManutencaoAgendadaConcorrenciaPostgresIntegrationTest)
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

    /** Janela de escopo EQUIPAMENTOS criada pelo criador, com os carimbos que o CHECK de coerencia exige. */
    private long janela(String status, Instant inicio, Instant fim) {
        Timestamp ativadaEm = "ATIVA".equals(status) ? Timestamp.from(inicio) : null;
        long id = insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, motivo, "
                + "status, criado_por_id, ativada_em) values (?, 'EQUIPAMENTOS', ?, ?, 'Teste', ?, ?, ?) returning id",
                u, Timestamp.from(inicio), Timestamp.from(fim), status, criadorId, ativadaEm);
        jdbc.update("insert into manutencao_agendada_equipamento (manutencao_id, equipamento_id) values (?, ?)",
                id, equipamento);
        return id;
    }

    /** AGENDADA no passado; um tick logo depois do inicio a ativa (com o anuncio) e aplica a entrada. */
    private long janelaAtivaComEfeitosAplicados(Instant inicio, Instant fim) {
        long id = janela("AGENDADA", inicio, fim);
        reconciliador.reconciliar(inicio.plus(1, MINUTES));
        assertThat(situacao(id)).isEqualTo("ATIVA");
        assertThat(mensagens("MANUTENCAO_INICIADA")).hasSize(1);
        return id;
    }

    /** Incidente ABERTO com a abertura ja enviada: a entrada em manutencao o fecha e avisa. */
    private long incidenteAberto() {
        long id = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitor,
                Timestamp.from(agora.minus(5, MINUTES)));
        jdbc.update("insert into notificacao (incidente_id, canal, tipo_evento, status, mensagem, enviado_em) "
                + "values (?, 'TELEGRAM', 'INCIDENTE_ABERTO', 'ENVIADA', 'abertura', ?)", id,
                Timestamp.from(agora.minus(5, MINUTES)));
        return id;
    }

    private long usuario(String nome, String email) {
        return insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values (?, ?, 'hash-irrelevante', 'OPERADOR', true, false) returning id", nome, email);
    }

    private String situacao(long manutencaoId) {
        return jdbc.queryForObject("select status from manutencao_agendada where id = ?", String.class, manutencaoId);
    }

    private List<String> mensagens(String tipoEvento) {
        return jdbc.queryForList("select mensagem from notificacao where tipo_evento = ? order by id", String.class,
                tipoEvento);
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}

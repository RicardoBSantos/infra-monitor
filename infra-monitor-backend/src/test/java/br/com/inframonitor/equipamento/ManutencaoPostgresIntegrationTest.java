package br.com.inframonitor.equipamento;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.incidente.service.IncidenteService;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
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
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Integracao real contra PostgreSQL para a V19 (motivo de encerramento e eventos de
 * manutencao) e para a transacao de {@code EquipamentoService.entrarEmManutencao}.
 *
 * <p>Existe porque os testes de unidade e de corrida sequencial (mesma thread, duas
 * chamadas em fila) nao provam nada sobre concorrencia real: eles passam mesmo sem o
 * CAS de {@code marcarEmManutencaoSeNaoEstiver}, porque o filtro de status das
 * leituras ja resolve o caso sequencial. O que so o banco real prova sao as CHECKs
 * novas recusando o que deveriam recusar, e a corrida genuina entre a entrada em
 * manutencao e a abertura automatica de incidente, cada uma em sua propria transacao
 * fisica, alinhadas por {@link CyclicBarrier}.
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
class ManutencaoPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant T0 = Instant.parse("2026-09-01T08:00:00Z");
    private static final Duration LIMITE = Duration.ofSeconds(10);
    // Atraso aleatorio (0..N ms) do motor depois da barreira nas corridas de fechamento.
    // Sem ele o UPDATE unico do motor commita sempre antes de a manutencao (ou reconhecer)
    // chegar a escrever, e so um desfecho legitimo aparece; N calibrado pela latencia
    // de cada caminho concorrente, para que os dois desfechos legitimos ocorram.
    private static final long ATRASO_MAX_MOTOR_MANUTENCAO_MS = 12;
    // reconhecer e um UPDATE so, bem mais curto que a manutencao: janela menor.
    private static final long ATRASO_MAX_MOTOR_RECONHECER_MS = 4;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private EquipamentoService equipamentoService;
    @Autowired private EquipamentoRepository equipamentoRepository;
    @Autowired private IncidenteService incidenteService;
    @Autowired private IncidenteRepository incidenteRepository;
    @Autowired private MonitorRepository monitorRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    private long operadorId;

    @BeforeEach
    void limparBanco() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        operadorId = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Operador', 'operador@manutencao.test', 'hash-irrelevante', 'OPERADOR', true, false) "
                + "returning id");
    }

    // ---------------------------------------------------------------------------
    // 1. ck_incidente_motivo_encerramento_coerente
    // ---------------------------------------------------------------------------

    @Test
    void checkRecusaMotivoDeEncerramentoEmIncidenteAberto() {
        long monitorId = montarEquipamentoEMonitor(false);

        assertThatThrownBy(() -> jdbc.update("insert into incidente (monitor_id, status, iniciado_em, motivo, "
                        + "motivo_encerramento) values (?, 'ABERTO', ?, 'Indisponibilidade', 'MANUTENCAO')",
                monitorId, Timestamp.from(T0)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(erro -> {
                    String mensagem = causaRaiz(erro).getMessage();
                    System.out.println("[ck_incidente_motivo_encerramento_coerente] mensagem real do Postgres: "
                            + mensagem);
                    assertThat(mensagem).containsIgnoringCase("ck_incidente_motivo_encerramento_coerente");
                });

        assertThat(jdbc.queryForObject("select count(*) from incidente", Integer.class)).isZero();
    }

    // ---------------------------------------------------------------------------
    // 2. ck_notificacao_evento_coerente
    // ---------------------------------------------------------------------------

    @Test
    void checkRecusaLatenciaEncerradaPorManutencaoPenduradaEmIncidente() {
        long monitorId = montarEquipamentoEMonitor(false);
        long incidenteId = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitorId, Timestamp.from(T0));

        assertThatThrownBy(() -> jdbc.update("insert into notificacao (incidente_id, canal, tipo_evento, status, "
                        + "mensagem) values (?, 'TELEGRAM', 'LATENCIA_ENCERRADA_MANUTENCAO', 'PENDENTE', 'x')",
                incidenteId))
                .isInstanceOf(DataIntegrityViolationException.class)
                .satisfies(erro -> {
                    String mensagem = causaRaiz(erro).getMessage();
                    System.out.println("[ck_notificacao_evento_coerente] mensagem real do Postgres: " + mensagem);
                    assertThat(mensagem).containsIgnoringCase("ck_notificacao_evento_coerente");
                });

        assertThat(jdbc.queryForObject("select count(*) from notificacao", Integer.class)).isZero();
    }

    // ---------------------------------------------------------------------------
    // 3. Ciclo inteiro: incidente aberto -> entra em manutencao -> FECHADO/MANUTENCAO
    // ---------------------------------------------------------------------------

    @Test
    void entrarEmManutencaoFechaIncidenteJanelaENotificacaoPelaMatriz() {
        long equipamentoId = montarEquipamento(false);
        long monitorId = montarMonitor(equipamentoId);
        long incidenteId = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitorId, Timestamp.from(T0));
        // Janela aberta: sem ela nao ha o que fechar, e o teste nao provaria nada sobre o
        // passo 4 de entrarEmManutencao.
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA') "
                + "returning id", monitorId, Timestamp.from(T0));
        // Notificacao de abertura ja despachada (ENVIADA): tratarEncerramentoPorManutencao
        // deve gerar o evento de encerramento por manutencao, nao apenas cancelar.
        insert("insert into notificacao (incidente_id, canal, tipo_evento, status, mensagem, enviado_em) "
                + "values (?, 'TELEGRAM', 'INCIDENTE_ABERTO', 'ENVIADA', 'msg', ?) returning id",
                incidenteId, Timestamp.from(T0));

        equipamentoService.entrarEmManutencao(equipamentoId, operadorId);

        assertThat(jdbc.queryForObject("select em_manutencao from equipamento where id = ?", Boolean.class,
                equipamentoId)).isTrue();

        assertThat(jdbc.queryForMap("select status, motivo_encerramento, fechado_por, encerrado_em from incidente "
                        + "where id = ?", incidenteId))
                .containsEntry("status", "FECHADO")
                .containsEntry("motivo_encerramento", "MANUTENCAO")
                .containsEntry("fechado_por", operadorId);
        assertThat(jdbc.queryForObject("select encerrado_em from incidente where id = ?", Timestamp.class,
                incidenteId)).isNotNull();

        assertThat(jdbc.queryForObject("select fim_em from janela_monitoramento where monitor_id = ?",
                Timestamp.class, monitorId)).isNotNull();

        assertThat(jdbc.queryForObject("select count(*) from notificacao where incidente_id = ? "
                + "and tipo_evento = 'INCIDENTE_ENCERRADO_MANUTENCAO' and status = 'PENDENTE'",
                Integer.class, incidenteId)).isEqualTo(1);
    }

    // ---------------------------------------------------------------------------
    // 4. inserirSeElegivel: 0 sob manutencao, 1 fora dela
    // ---------------------------------------------------------------------------

    @Test
    void inserirSeElegivelDevolveZeroSobManutencaoEUmForaDela() {
        long equipamentoId = montarEquipamento(true);
        long monitorId = montarMonitor(equipamentoId);

        // Metodos @Modifying exigem transacao ativa: o proprio teste abre uma, no mesmo
        // idioma de NotificacaoConcorrenciaPostgresIntegrationTest.emTransacao.
        int sobManutencao = emTransacao(() -> incidenteRepository.inserirSeElegivel(monitorId, T0,
                "Indisponibilidade", T0));
        assertThat(sobManutencao).isZero();
        assertThat(jdbc.queryForObject("select count(*) from incidente", Integer.class)).isZero();

        emTransacao(() -> equipamentoRepository.desmarcarManutencaoSeEstiver(equipamentoId, T0.plusSeconds(60)));

        int foraDaManutencao = emTransacao(() -> incidenteRepository.inserirSeElegivel(monitorId,
                T0.plusSeconds(120), "Indisponibilidade", T0.plusSeconds(120)));
        assertThat(foraDaManutencao).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from incidente where status = 'ABERTO'", Integer.class))
                .isEqualTo(1);
    }

    // ---------------------------------------------------------------------------
    // 5. Corrida real: duas transacoes fisicas, repetida varias vezes
    // ---------------------------------------------------------------------------

    /**
     * Duas threads reais, cada uma com sua propria transacao, alinhadas na largada por
     * um {@link CyclicBarrier}: uma entra em manutencao, a outra chama
     * {@code abrirAutomaticamente} para o mesmo monitor. Repete o cenario do zero a
     * cada rodada porque uma corrida que so roda uma vez nao prova nada — o
     * escalonador do SO pode favorecer sempre a mesma ordem.
     *
     * <p>Dois desfechos sao legitimos: (a) a manutencao ganha e nenhum incidente
     * chega a abrir; (b) o incidente abre antes do flag e e fechado com
     * motivo_encerramento = MANUTENCAO, com a notificacao de abertura tratada pela
     * matriz (cancelada se ainda PENDENTE, ou sucedida por
     * INCIDENTE_ENCERRADO_MANUTENCAO se ja tiver sido despachada). O desfecho
     * ilegitimo — incidente ABERTO/RECONHECIDO sobrevivendo, ou notificacao de
     * abertura PENDENTE sem tratamento — reprova o teste.
     */
    @RepeatedTest(30)
    void entrarEmManutencaoEAbrirAutomaticamenteConcorrentesNuncaDeixamIncidenteOuNotificacaoOrfa()
            throws Exception {
        // @BeforeEach ja truncou e recriou o operador para esta repeticao: cada
        // invocacao de @RepeatedTest passa pelo ciclo de vida completo do JUnit.
        long equipamentoId = montarEquipamento(false);
        long monitorId = montarMonitor(equipamentoId);
        Monitor monitor = monitorRepository.findById(monitorId).orElseThrow();

        CyclicBarrier partida = new CyclicBarrier(2);
        List<Throwable> falhas = new CopyOnWriteArrayList<>();

        Thread manutencao = new Thread(() -> {
            try {
                partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
                equipamentoService.entrarEmManutencao(equipamentoId, operadorId);
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "manutencao");

        Thread abertura = new Thread(() -> {
            try {
                partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
                incidenteService.abrirAutomaticamente(monitor, Instant.now(), 3);
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "abertura-automatica");

        manutencao.start();
        abertura.start();
        manutencao.join(LIMITE.toMillis());
        abertura.join(LIMITE.toMillis());

        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();

        Integer incidentesAbertos = jdbc.queryForObject("select count(*) from incidente where monitor_id = ? "
                + "and status in ('ABERTO', 'RECONHECIDO')", Integer.class, monitorId);
        Integer notificacoesOrfas = jdbc.queryForObject("select count(*) from notificacao n "
                + "join incidente i on i.id = n.incidente_id where i.monitor_id = ? "
                + "and n.tipo_evento = 'INCIDENTE_ABERTO' and n.status = 'PENDENTE'", Integer.class, monitorId);

        // Diagnostico de qual desfecho legitimo ocorreu nesta repeticao, so' para o
        // relatorio da correcao da corrida: (a) manutencao ganhou e nenhum incidente
        // chegou a existir para o monitor; (b) o incidente abriu antes do flag e foi
        // fechado com motivo MANUTENCAO. Nao participa de nenhuma asserção.
        Integer totalIncidentes = jdbc.queryForObject("select count(*) from incidente where monitor_id = ?",
                Integer.class, monitorId);
        System.out.println("[corrida-manutencao] desfecho=" + (totalIncidentes == 0 ? "a-manutencao-ganhou"
                : "b-incidente-abriu-e-foi-fechado") + " totalIncidentes=" + totalIncidentes);

        assertThat(incidentesAbertos)
                .as("nenhum incidente pode sobreviver ABERTO/RECONHECIDO a entrada em manutencao")
                .isZero();
        assertThat(notificacoesOrfas)
                .as("nenhuma notificacao de abertura pode ficar PENDENTE sem ser cancelada ou substituida")
                .isZero();
    }

    /**
     * Corrida real entre a entrada em manutencao e o fechamento automatico do MESMO
     * incidente. A instancia que o motor fecha e carregada ANTES da barreira, como no
     * IncidentProcessor real (le, decide, fecha). Sem CAS, o UPDATE do Hibernate grava
     * todas as colunas WHERE id = ? e sobrescreve o fechamento por manutencao.
     *
     * <p>Legitimos: (M) manutencao ganhou — FECHADO/MANUTENCAO, fechado_por = operador,
     * uma INCIDENTE_ENCERRADO_MANUTENCAO e nenhuma INCIDENTE_FECHADO; (R) recuperacao
     * ganhou — FECHADO/RECUPERACAO_AUTOMATICA, fechado_por nulo, uma INCIDENTE_FECHADO
     * e nenhuma INCIDENTE_ENCERRADO_MANUTENCAO.
     */
    @RepeatedTest(30)
    void entrarEmManutencaoEFecharAutomaticamenteConcorrentesTerminamEmUmSoFechamento() throws Exception {
        long equipamentoId = montarEquipamento(false);
        long monitorId = montarMonitor(equipamentoId);
        long incidenteId = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitorId, Timestamp.from(T0));
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA') "
                + "returning id", monitorId, Timestamp.from(T0));
        insert("insert into notificacao (incidente_id, canal, tipo_evento, status, mensagem, enviado_em) "
                + "values (?, 'TELEGRAM', 'INCIDENTE_ABERTO', 'ENVIADA', 'msg', ?) returning id",
                incidenteId, Timestamp.from(T0));
        Incidente carregadoPeloMotor = incidenteRepository.findById(incidenteId).orElseThrow();

        CyclicBarrier partida = new CyclicBarrier(2);
        List<Throwable> falhas = new CopyOnWriteArrayList<>();
        Thread manutencao = new Thread(() -> {
            try {
                partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
                equipamentoService.entrarEmManutencao(equipamentoId, operadorId);
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "manutencao");
        Thread recuperacao = new Thread(() -> {
            try {
                partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
                Thread.sleep(ThreadLocalRandom.current().nextLong(ATRASO_MAX_MOTOR_MANUTENCAO_MS + 1));
                incidenteService.fecharAutomaticamente(carregadoPeloMotor, T0.plusSeconds(300), 2);
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "fechamento-automatico");
        manutencao.start();
        recuperacao.start();
        manutencao.join(LIMITE.toMillis());
        recuperacao.join(LIMITE.toMillis());

        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();

        var linha = jdbc.queryForMap("select status, motivo_encerramento, fechado_por from incidente where id = ?",
                incidenteId);
        Integer encerradasPorManutencao = jdbc.queryForObject("select count(*) from notificacao where incidente_id = ? "
                + "and tipo_evento = 'INCIDENTE_ENCERRADO_MANUTENCAO'", Integer.class, incidenteId);
        Integer fechadas = jdbc.queryForObject("select count(*) from notificacao where incidente_id = ? "
                + "and tipo_evento = 'INCIDENTE_FECHADO'", Integer.class, incidenteId);
        Object motivo = linha.get("motivo_encerramento");
        Object fechadoPor = linha.get("fechado_por");

        boolean manutencaoGanhou = "MANUTENCAO".equals(motivo) && Long.valueOf(operadorId).equals(fechadoPor)
                && encerradasPorManutencao == 1 && fechadas == 0;
        boolean recuperacaoGanhou = "RECUPERACAO_AUTOMATICA".equals(motivo) && fechadoPor == null
                && fechadas == 1 && encerradasPorManutencao == 0;
        System.out.println("[corrida-fechamento-manutencao] desfecho=" + (manutencaoGanhou ? "M-manutencao-ganhou"
                : recuperacaoGanhou ? "R-recuperacao-ganhou" : "ILEGITIMO") + " motivo=" + motivo
                + " fechadoPor=" + fechadoPor + " encerradasPorManutencao=" + encerradasPorManutencao
                + " fechadas=" + fechadas);

        assertThat(linha.get("status")).isEqualTo("FECHADO");
        assertThat(manutencaoGanhou || recuperacaoGanhou)
                .as("um fechamento so: motivo, autor e notificacao do MESMO vencedor")
                .isTrue();
    }

    /**
     * Corrida real entre reconhecer (CAS contra ABERTO) e o fechamento automatico.
     * Sem CAS no fechamento, o motor grava reconhecido_em/reconhecido_por de volta a
     * NULL a partir da instancia carregada antes — a trilha de quem reconheceu some
     * mesmo com reconhecer tendo respondido sucesso.
     *
     * <p>Legitimos: (F) o fechamento ganhou — FECHADO sem reconhecimento e reconhecer
     * recebeu 409; (RF) reconhecer ganhou e depois o motor fechou — FECHADO com
     * reconhecimento preservado.
     */
    @RepeatedTest(30)
    void reconhecerEFecharAutomaticamenteConcorrentesNaoApagamReconhecimento() throws Exception {
        long monitorId = montarEquipamentoEMonitor(false);
        long incidenteId = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitorId, Timestamp.from(T0));
        Incidente carregadoPeloMotor = incidenteRepository.findById(incidenteId).orElseThrow();

        CyclicBarrier partida = new CyclicBarrier(2);
        List<Throwable> falhas = new CopyOnWriteArrayList<>();
        AtomicBoolean reconhecimentoRecusado = new AtomicBoolean();
        Thread reconhecimento = new Thread(() -> {
            try {
                partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
                incidenteService.reconhecer(incidenteId, operadorId);
            } catch (ConflitoException recusado) {
                reconhecimentoRecusado.set(true);
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "reconhecer");
        Thread recuperacao = new Thread(() -> {
            try {
                partida.await(LIMITE.toSeconds(), TimeUnit.SECONDS);
                Thread.sleep(ThreadLocalRandom.current().nextLong(ATRASO_MAX_MOTOR_RECONHECER_MS + 1));
                incidenteService.fecharAutomaticamente(carregadoPeloMotor, T0.plusSeconds(300), 2);
            } catch (Throwable erro) {
                falhas.add(erro);
            }
        }, "fechamento-automatico");
        reconhecimento.start();
        recuperacao.start();
        reconhecimento.join(LIMITE.toMillis());
        recuperacao.join(LIMITE.toMillis());

        assertThat(falhas.stream().map(Throwable::toString).toList()).isEmpty();

        var linha = jdbc.queryForMap("select status, reconhecido_em, reconhecido_por from incidente where id = ?",
                incidenteId);
        boolean reconhecido = linha.get("reconhecido_por") != null && linha.get("reconhecido_em") != null;
        boolean fechamentoGanhou = reconhecimentoRecusado.get() && !reconhecido;
        boolean reconhecerGanhou = !reconhecimentoRecusado.get() && reconhecido;
        System.out.println("[corrida-fechamento-reconhecer] desfecho=" + (fechamentoGanhou ? "F-fechamento-ganhou"
                : reconhecerGanhou ? "RF-reconhecido-e-fechado" : "ILEGITIMO") + " recusado="
                + reconhecimentoRecusado.get() + " reconhecidoPor=" + linha.get("reconhecido_por"));

        assertThat(linha.get("status")).isEqualTo("FECHADO");
        assertThat(fechamentoGanhou || reconhecerGanhou)
                .as("reconhecer que respondeu sucesso nao pode ter o reconhecimento apagado pelo motor")
                .isTrue();
    }

    /**
     * Ordem fixa, sem corrida: o motor carrega o incidente, a manutencao roda inteira e
     * so entao o motor fecha com a instancia velha. E a intercalacao que a corrida quase
     * nunca produz, e a que discrimina o CAS: sem ele, o UPDATE de todas as colunas
     * sobrescreve MANUTENCAO/operador e soma INCIDENTE_FECHADO.
     */
    @Test
    void fecharAutomaticamenteComInstanciaVelhaNaoSobrescreveFechamentoPorManutencao() {
        long equipamentoId = montarEquipamento(false);
        long monitorId = montarMonitor(equipamentoId);
        long incidenteId = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitorId, Timestamp.from(T0));
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA') "
                + "returning id", monitorId, Timestamp.from(T0));
        insert("insert into notificacao (incidente_id, canal, tipo_evento, status, mensagem, enviado_em) "
                + "values (?, 'TELEGRAM', 'INCIDENTE_ABERTO', 'ENVIADA', 'msg', ?) returning id",
                incidenteId, Timestamp.from(T0));
        Incidente carregadoPeloMotor = incidenteRepository.findById(incidenteId).orElseThrow();

        equipamentoService.entrarEmManutencao(equipamentoId, operadorId);
        incidenteService.fecharAutomaticamente(carregadoPeloMotor, T0.plusSeconds(300), 2);

        assertThat(jdbc.queryForMap("select status, motivo_encerramento, fechado_por from incidente where id = ?",
                incidenteId))
                .containsEntry("status", "FECHADO")
                .containsEntry("motivo_encerramento", "MANUTENCAO")
                .containsEntry("fechado_por", operadorId);
        assertThat(jdbc.queryForObject("select count(*) from notificacao where incidente_id = ? "
                + "and tipo_evento = 'INCIDENTE_ENCERRADO_MANUTENCAO'", Integer.class, incidenteId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from notificacao where incidente_id = ? "
                + "and tipo_evento = 'INCIDENTE_FECHADO'", Integer.class, incidenteId)).isZero();
    }

    /**
     * Ordem fixa: o motor carrega o incidente, reconhecer responde sucesso e so entao o
     * motor fecha com a instancia velha. Sem CAS, reconhecido_em/reconhecido_por voltam
     * a NULL a partir da instancia carregada antes do reconhecimento.
     */
    @Test
    void fecharAutomaticamenteComInstanciaVelhaNaoApagaReconhecimento() {
        long monitorId = montarEquipamentoEMonitor(false);
        long incidenteId = insert("insert into incidente (monitor_id, status, iniciado_em, motivo) "
                + "values (?, 'ABERTO', ?, 'Indisponibilidade') returning id", monitorId, Timestamp.from(T0));
        Incidente carregadoPeloMotor = incidenteRepository.findById(incidenteId).orElseThrow();

        incidenteService.reconhecer(incidenteId, operadorId);
        incidenteService.fecharAutomaticamente(carregadoPeloMotor, T0.plusSeconds(300), 2);

        var linha = jdbc.queryForMap("select status, reconhecido_em, reconhecido_por from incidente where id = ?",
                incidenteId);
        assertThat(linha).containsEntry("status", "FECHADO").containsEntry("reconhecido_por", operadorId);
        assertThat(linha.get("reconhecido_em")).isNotNull();
    }

    // ---------------------------------------------------------------------------
    // Fixtures
    // ---------------------------------------------------------------------------

    private long montarEquipamentoEMonitor(boolean emManutencao) {
        return montarMonitor(montarEquipamento(emManutencao));
    }

    private long montarEquipamento(boolean emManutencao) {
        long tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        long unidade = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        return insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ativo, "
                        + "em_manutencao) values (?, ?, 'SW-CORE', '10.0.0.10', true, ?) returning id",
                unidade, tipo, emManutencao);
    }

    private long montarMonitor(long equipamentoId) {
        return insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                        + "falhas_para_incidente, sucessos_para_recovery) "
                        + "values (?, 'ICMP', 'ICMP CORE', 60, 2000, true, 3, 2) returning id",
                equipamentoId);
    }

    private <T> T emTransacao(java.util.function.Supplier<T> acao) {
        return new TransactionTemplate(transactionManager).execute(status -> acao.get());
    }

    private void emTransacao(Runnable acao) {
        new TransactionTemplate(transactionManager).executeWithoutResult(status -> acao.run());
    }

    private Throwable causaRaiz(Throwable erro) {
        Throwable atual = erro;
        while (atual.getCause() != null && atual.getCause() != atual) {
            atual = atual.getCause();
        }
        return atual;
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}

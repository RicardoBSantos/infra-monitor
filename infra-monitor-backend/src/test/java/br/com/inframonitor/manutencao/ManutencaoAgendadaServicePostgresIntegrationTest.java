package br.com.inframonitor.manutencao;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.dto.ReferenciaResponse;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.equipamento.service.EstadoManutencaoEquipamento;
import br.com.inframonitor.manutencao.dto.CriarManutencaoRequest;
import br.com.inframonitor.manutencao.dto.ManutencaoResponse;
import br.com.inframonitor.manutencao.entity.EscopoManutencao;
import br.com.inframonitor.manutencao.entity.SituacaoManutencao;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao;
import br.com.inframonitor.manutencao.service.ManutencaoAgendadaService;
import br.com.inframonitor.testsupport.RequerDocker;
import br.com.inframonitor.unidade.service.UnidadeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;

/**
 * Servico de janelas agendadas contra PostgreSQL real: validacoes de criacao, ativacao
 * imediata, CAS de cancelar/encerrar, listagem e recusa de exclusao.
 *
 * <p>O reconciliador fica ligado (a criacao exige) mas com intervalo de uma hora: nenhum tick
 * interfere no que cada teste observa.
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
class ManutencaoAgendadaServicePostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final PageRequest PAGINA = PageRequest.of(0, 20);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired private JdbcTemplate jdbc;
    @Autowired private ManutencaoAgendadaService service;
    @Autowired private EquipamentoService equipamentoService;
    @Autowired private UnidadeService unidadeService;
    @Autowired private CoberturaManutencao cobertura;
    // Spy so para injetar falha num equipamento; nos demais testes delega ao bean real.
    @MockitoSpyBean private EstadoManutencaoEquipamento estado;

    private long operadorId;
    private long tipo;
    private long u;
    private long norte;
    private long e1;
    private long e2;
    private long eNorte;
    private long eInativo;
    private long monitor;

    @BeforeEach
    void montarCenario() {
        jdbc.execute("truncate table manutencao_agendada_equipamento, manutencao_agendada, janela_monitoramento, "
                + "medicao, notificacao, monitor_episodio_latencia, incidente, monitor, equipamento, "
                + "tipo_equipamento, unidade, usuarios restart identity cascade");
        operadorId = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Operador', 'operador@janela.test', 'hash-irrelevante', 'OPERADOR', true, false) "
                + "returning id");
        tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        u = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        norte = insert("insert into unidade (nome, sigla, ativo) values ('Norte', 'NRT', true) returning id");
        e1 = equipamento(u, "SW-01", true);
        e2 = equipamento(u, "SW-02", true);
        eNorte = equipamento(norte, "SW-NORTE", true);
        eInativo = equipamento(u, "SW-VELHO", false);
        monitor = insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                + "falhas_para_incidente, sucessos_para_recovery) "
                + "values (?, 'ICMP', 'ICMP 01', 60, 2000, true, 3, 2) returning id", e1);
        insert("insert into janela_monitoramento (monitor_id, inicio_em, origem) values (?, ?, 'PRECISA') "
                + "returning id", monitor, Timestamp.from(Instant.now().minus(Duration.ofDays(1))));
    }

    // ---------------------------------------------------------------------------
    // Criacao
    // ---------------------------------------------------------------------------

    @Test
    void criaJanelaFuturaAgendada() {
        Instant inicio = Instant.now().plus(Duration.ofHours(2)).truncatedTo(ChronoUnit.SECONDS);
        ManutencaoResponse r = service.criar(requisicao(EscopoManutencao.UNIDADE, null, inicio,
                inicio.plus(Duration.ofHours(1)), "  Troca de nobreak  "), operadorId);

        assertThat(r.situacao()).isEqualTo(SituacaoManutencao.AGENDADA);
        assertThat(r.unidade()).isEqualTo(new ReferenciaResponse(u, "Centro"));
        assertThat(r.escopo()).isEqualTo(EscopoManutencao.UNIDADE);
        assertThat(r.equipamentos()).isEmpty();
        assertThat(r.motivo()).isEqualTo("Troca de nobreak");
        assertThat(r.criadoPor()).isEqualTo(new ReferenciaResponse(operadorId, "Operador"));
        assertThat(r.ativadaEm()).isNull();
        assertThat(r.encerradaPor()).isNull();
        assertThat(r.canceladaPor()).isNull();
        assertThat(r.sobreposicoes()).isEmpty();
        assertThat(r.inicioPrevisto()).isEqualTo(inicio);
        assertThat(emManutencao(e1)).isFalse();
    }

    @Test
    void criaComInicioAgoraAtivaNaHora() {
        Instant inicio = Instant.now();
        ManutencaoResponse r = service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(e2, e1), inicio,
                inicio.plus(Duration.ofHours(1)), "Firmware"), operadorId);

        assertThat(r.situacao()).isEqualTo(SituacaoManutencao.ATIVA);
        assertThat(r.ativadaEm()).isNotNull();
        assertThat(r.equipamentos()).extracting(ReferenciaResponse::id).containsExactly(e1, e2);
        assertThat(emManutencao(e1)).isTrue();
        assertThat(emManutencao(e2)).isTrue();
        assertThat(emManutencao(eNorte)).isFalse();
        assertThat(janelasSlaAbertas(monitor)).isZero();
    }

    @Test
    void criaComInicioQuatroMinutosAtrasAtiva() {
        Instant inicio = Instant.now().minus(Duration.ofMinutes(4));
        ManutencaoResponse r = service.criar(requisicao(EscopoManutencao.UNIDADE, List.of(), inicio,
                inicio.plus(Duration.ofHours(1)), "Rede eletrica"), operadorId);

        assertThat(r.situacao()).isEqualTo(SituacaoManutencao.ATIVA);
        assertThat(emManutencao(e1)).isTrue();
        assertThat(emManutencao(eNorte)).isFalse();
    }

    @Test
    void recusaInicioSeisMinutosAtras() {
        Instant inicio = Instant.now().minus(Duration.ofMinutes(6));
        assertThatThrownBy(() -> service.criar(requisicao(EscopoManutencao.UNIDADE, null, inicio,
                inicio.plus(Duration.ofHours(1)), "x"), operadorId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Nao e possivel agendar manutencao com inicio no passado");
        assertThat(contarJanelas()).isZero();
    }

    @Test
    void recusaFimAntesDoInicio() {
        Instant inicio = Instant.now().plus(Duration.ofHours(1));
        assertThatThrownBy(() -> service.criar(requisicao(EscopoManutencao.UNIDADE, null, inicio,
                inicio.minus(Duration.ofMinutes(1)), "x"), operadorId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("O fim da janela deve ser depois do inicio");
    }

    @Test
    void recusaDuracaoAcimaDoMaximo() {
        Instant inicio = Instant.now().plus(Duration.ofHours(1));
        assertThatThrownBy(() -> service.criar(requisicao(EscopoManutencao.UNIDADE, null, inicio,
                inicio.plus(Duration.ofHours(72).plusMinutes(1)), "x"), operadorId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("A janela nao pode passar de 72 horas");
        // Exatamente no limite passa.
        assertThat(service.criar(requisicao(EscopoManutencao.UNIDADE, null, inicio,
                inicio.plus(Duration.ofHours(72)), "x"), operadorId).situacao())
                .isEqualTo(SituacaoManutencao.AGENDADA);
    }

    @Test
    void recusaEscopoEquipamentosSemEquipamento() {
        Instant inicio = Instant.now().plus(Duration.ofHours(1));
        assertThatThrownBy(() -> service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(), inicio,
                inicio.plus(Duration.ofHours(1)), "x"), operadorId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Selecione ao menos um equipamento");
        assertThatThrownBy(() -> service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, null, inicio,
                inicio.plus(Duration.ofHours(1)), "x"), operadorId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Selecione ao menos um equipamento");
    }

    @Test
    void recusaEquipamentoDeOutraUnidade() {
        Instant inicio = Instant.now().plus(Duration.ofHours(1));
        assertThatThrownBy(() -> service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(e1, eNorte),
                inicio, inicio.plus(Duration.ofHours(1)), "x"), operadorId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("O equipamento SW-NORTE nao pertence a unidade");
        assertThat(contarJanelas()).isZero();
    }

    @Test
    void recusaEquipamentoInexistente() {
        Instant inicio = Instant.now().plus(Duration.ofHours(1));
        assertThatThrownBy(() -> service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(e1, 9999L),
                inicio, inicio.plus(Duration.ofHours(1)), "x"), operadorId))
                .isInstanceOf(RecursoNaoEncontradoException.class);
    }

    @Test
    void recusaEquipamentoInativo() {
        Instant inicio = Instant.now().plus(Duration.ofHours(1));
        assertThatThrownBy(() -> service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(eInativo),
                inicio, inicio.plus(Duration.ofHours(1)), "x"), operadorId))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel agendar manutencao do equipamento SW-VELHO porque ele esta inativo");
    }

    @Test
    void recusaUnidadeInativa() {
        jdbc.update("update unidade set ativo = false where id = ?", norte);
        Instant inicio = Instant.now().plus(Duration.ofHours(1));
        assertThatThrownBy(() -> service.criar(new CriarManutencaoRequest(norte, EscopoManutencao.UNIDADE, null,
                inicio, inicio.plus(Duration.ofHours(1)), "x"), operadorId))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel agendar manutencao em unidade inativa");
    }

    @Test
    void recusaUnidadeInexistente() {
        Instant inicio = Instant.now().plus(Duration.ofHours(1));
        assertThatThrownBy(() -> service.criar(new CriarManutencaoRequest(9999L, EscopoManutencao.UNIDADE, null,
                inicio, inicio.plus(Duration.ofHours(1)), "x"), operadorId))
                .isInstanceOf(RecursoNaoEncontradoException.class);
    }

    @Test
    void recusaUnidadeComEquipamentos() {
        Instant inicio = Instant.now().plus(Duration.ofHours(1));
        assertThatThrownBy(() -> service.criar(requisicao(EscopoManutencao.UNIDADE, List.of(e1), inicio,
                inicio.plus(Duration.ofHours(1)), "x"), operadorId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Escopo UNIDADE nao recebe equipamentos");
    }

    @Test
    void recusaMotivoEmBranco() {
        Instant inicio = Instant.now().plus(Duration.ofHours(1));
        assertThatThrownBy(() -> service.criar(requisicao(EscopoManutencao.UNIDADE, null, inicio,
                inicio.plus(Duration.ofHours(1)), "   "), operadorId))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void informaSobreposicao() {
        Instant inicio = Instant.now().plus(Duration.ofHours(2));
        ManutencaoResponse primeira = service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(e1), inicio,
                inicio.plus(Duration.ofHours(2)), "Primeira"), operadorId);
        // Equipamento diferente na mesma unidade: nao sobrepoe.
        ManutencaoResponse vizinha = service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(e2), inicio,
                inicio.plus(Duration.ofHours(2)), "Vizinha"), operadorId);
        ManutencaoResponse segunda = service.criar(requisicao(EscopoManutencao.UNIDADE, null,
                inicio.plus(Duration.ofHours(1)), inicio.plus(Duration.ofHours(3)), "Segunda"), operadorId);

        assertThat(vizinha.sobreposicoes()).isEmpty();
        assertThat(segunda.sobreposicoes()).containsExactly(primeira.id(), vizinha.id());
        // Encostar no fim nao sobrepoe.
        ManutencaoResponse depois = service.criar(requisicao(EscopoManutencao.UNIDADE, null,
                inicio.plus(Duration.ofHours(3)), inicio.plus(Duration.ofHours(4)), "Depois"), operadorId);
        assertThat(depois.sobreposicoes()).isEmpty();
    }

    // ---------------------------------------------------------------------------
    // Cancelar / encerrar
    // ---------------------------------------------------------------------------

    @Test
    void cancelaAgendada() {
        ManutencaoResponse r = service.criar(futura(EscopoManutencao.UNIDADE, null), operadorId);

        ManutencaoResponse cancelada = service.cancelar(r.id(), operadorId);

        assertThat(cancelada.situacao()).isEqualTo(SituacaoManutencao.CANCELADA);
        assertThat(cancelada.canceladaEm()).isNotNull();
        assertThat(cancelada.canceladaPor()).isEqualTo(new ReferenciaResponse(operadorId, "Operador"));
        assertThat(cancelada.sobreposicoes()).isEmpty();
        assertThatThrownBy(() -> service.cancelar(r.id(), operadorId))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel cancelar: a janela esta CANCELADA.");
    }

    @Test
    void cancelarAtivaDevolve409ComSituacao() {
        ManutencaoResponse r = service.criar(agora(EscopoManutencao.UNIDADE, null), operadorId);

        assertThatThrownBy(() -> service.cancelar(r.id(), operadorId))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel cancelar: a janela esta ATIVA. Use Encerrar agora.");
        assertThat(emManutencao(e1)).isTrue();
    }

    @Test
    void cancelarInexistenteDevolve404() {
        assertThatThrownBy(() -> service.cancelar(9999L, operadorId))
                .isInstanceOf(RecursoNaoEncontradoException.class);
    }

    @Test
    void encerraAtivaEOsEquipamentosSaem() {
        ManutencaoResponse r = service.criar(agora(EscopoManutencao.UNIDADE, null), operadorId);
        assertThat(emManutencao(e1)).isTrue();
        assertThat(janelasSlaAbertas(monitor)).isZero();

        ManutencaoResponse encerrada = service.encerrar(r.id(), operadorId);

        assertThat(encerrada.situacao()).isEqualTo(SituacaoManutencao.CONCLUIDA);
        assertThat(encerrada.encerradaEm()).isNotNull();
        assertThat(encerrada.encerradaPor()).isEqualTo(new ReferenciaResponse(operadorId, "Operador"));
        assertThat(emManutencao(e1)).isFalse();
        assertThat(emManutencao(e2)).isFalse();
        assertThat(janelasSlaAbertas(monitor)).isEqualTo(1);
    }

    @Test
    void encerrarSegueQuandoUmEquipamentoSumiuAntesDoLock() {
        ManutencaoResponse r = service.criar(agora(EscopoManutencao.UNIDADE, null), operadorId);
        // A corrida real (exclusao entre cobertosPor e o FOR UPDATE) nao se reproduz por SQL:
        // equipamento apagado antes some do cobertosPor. O spy lanca o que travarEstadoManutencao
        // lancaria nesse instante.
        doThrow(new RecursoNaoEncontradoException("Equipamento nao encontrado")).when(estado).reavaliar(e1);

        ManutencaoResponse encerrada = service.encerrar(r.id(), operadorId);

        assertThat(encerrada.situacao()).isEqualTo(SituacaoManutencao.CONCLUIDA);
        assertThat(emManutencao(e2)).isFalse();
        assertThat(emManutencao(eInativo)).isFalse();
    }

    @Test
    void encerrarReavaliaTodosEDepoisSobeAPrimeiraFalha() {
        ManutencaoResponse r = service.criar(agora(EscopoManutencao.UNIDADE, null), operadorId);
        IllegalStateException falha = new IllegalStateException("simulada");
        doThrow(falha).when(estado).reavaliar(e1);

        assertThatThrownBy(() -> service.encerrar(r.id(), operadorId)).isSameAs(falha);

        assertThat(situacao(r.id())).isEqualTo("CONCLUIDA");
        assertThat(emManutencao(e1)).isTrue();    // o que falhou fica para a divergencia do reconciliador
        assertThat(emManutencao(e2)).isFalse();
        assertThat(emManutencao(eInativo)).isFalse();
    }

    @Test
    void criarAtivaReavaliaTodosMesmoComFalhaNoPrimeiro() {
        IllegalStateException falha = new IllegalStateException("simulada");
        doThrow(falha).when(estado).reavaliar(e1);

        assertThatThrownBy(() -> service.criar(agora(EscopoManutencao.UNIDADE, null), operadorId)).isSameAs(falha);

        assertThat(jdbc.queryForObject("select status from manutencao_agendada", String.class)).isEqualTo("ATIVA");
        assertThat(emManutencao(e1)).isFalse();
        assertThat(emManutencao(e2)).isTrue();
    }

    @Test
    void encerrarAgendadaDevolve409() {
        ManutencaoResponse r = service.criar(futura(EscopoManutencao.UNIDADE, null), operadorId);

        assertThatThrownBy(() -> service.encerrar(r.id(), operadorId))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel encerrar: a janela esta AGENDADA.");
    }

    // ---------------------------------------------------------------------------
    // Listagem
    // ---------------------------------------------------------------------------

    @Test
    void listaVigentesComAtivaPrimeiro() {
        Instant base = Instant.now().plus(Duration.ofDays(1));
        long cedo = janela("AGENDADA", u, base.plus(Duration.ofHours(1)), "cedo");
        long tarde = janela("AGENDADA", u, base.plus(Duration.ofHours(3)), "tarde");
        long ativa = janela("ATIVA", u, base.plus(Duration.ofHours(2)), "ativa");
        janela("CONCLUIDA", u, base, "fora");

        List<ManutencaoResponse> vigentes = service.listar("VIGENTES", "", PAGINA).getContent();

        assertThat(vigentes).extracting(ManutencaoResponse::id).containsExactly(ativa, cedo, tarde);
    }

    @Test
    void listaHistoricoPorInicioDesc() {
        Instant base = Instant.now().minus(Duration.ofDays(3));
        long concluida = janela("CONCLUIDA", u, base.plus(Duration.ofHours(1)), "a");
        long cancelada = janela("CANCELADA", u, base.plus(Duration.ofHours(3)), "b");
        long expirada = janela("EXPIRADA", norte, base.plus(Duration.ofHours(2)), "c");
        janela("AGENDADA", u, Instant.now().plus(Duration.ofDays(1)), "fora");

        List<ManutencaoResponse> historico = service.listar("HISTORICO", null, PAGINA).getContent();

        assertThat(historico).extracting(ManutencaoResponse::id).containsExactly(cancelada, expirada, concluida);
        assertThat(historico.get(0).canceladaPor()).isEqualTo(new ReferenciaResponse(operadorId, "Operador"));
    }

    @Test
    void buscaPorMotivoEUnidadeSemDiferenciarCaixa() {
        Instant base = Instant.now().plus(Duration.ofDays(1));
        long nobreak = janela("AGENDADA", u, base, "Troca de NOBREAK");
        long firmware = janela("AGENDADA", norte, base.plus(Duration.ofHours(1)), "Firmware");

        assertThat(service.listar("VIGENTES", "nobreak", PAGINA).getContent())
                .extracting(ManutencaoResponse::id).containsExactly(nobreak);
        assertThat(service.listar("VIGENTES", "  NORTE ", PAGINA).getContent())
                .extracting(ManutencaoResponse::id).containsExactly(firmware);
        assertThat(service.listar("VIGENTES", "centro", PAGINA).getContent())
                .extracting(ManutencaoResponse::id).containsExactly(nobreak);
        assertThat(service.listar("VIGENTES", "nada", PAGINA).getTotalElements()).isZero();
    }

    @Test
    void buscaTrataCuringaDigitadoComoTexto() {
        Instant base = Instant.now().plus(Duration.ofDays(1));
        long mil = janela("AGENDADA", u, base, "Link 1000 Mbps");
        long cem = janela("AGENDADA", u, base.plus(Duration.ofHours(1)), "Uso em 100% do link");
        long sublinhado = janela("AGENDADA", u, base.plus(Duration.ofHours(2)), "porta_ge1");
        long barra = janela("AGENDADA", u, base.plus(Duration.ofHours(3)), "rota a\\b");

        assertThat(service.listar("VIGENTES", "100%", PAGINA).getContent())
                .extracting(ManutencaoResponse::id).containsExactly(cem);
        assertThat(service.listar("VIGENTES", "1_00", PAGINA).getTotalElements()).isZero();   // curinga casaria "1000"
        assertThat(service.listar("VIGENTES", "porta_", PAGINA).getContent())
                .extracting(ManutencaoResponse::id).containsExactly(sublinhado);
        assertThat(service.listar("VIGENTES", "a\\b", PAGINA).getContent())
                .extracting(ManutencaoResponse::id).containsExactly(barra);
        assertThat(service.listar("VIGENTES", "1000", PAGINA).getContent())
                .extracting(ManutencaoResponse::id).containsExactly(mil);
        assertThat(service.listar("HISTORICO", "100%", PAGINA).getTotalElements()).isZero();
    }

    @Test
    void recusaSituacaoDeListagemInvalida() {
        assertThatThrownBy(() -> service.listar("ATIVA", "", PAGINA))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void parametrosDizemLigado() {
        assertThat(service.parametros().agendadorLigado()).isTrue();
        assertThat(service.parametros().duracaoMaximaHoras()).isEqualTo(72);
    }

    @Test
    void transicoesEmLoteDoReconciliadorPassamNosChecks() {
        Instant agora = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        long devida = janela("AGENDADA", u, agora.minus(Duration.ofMinutes(10)), "devida");        // fim em +50 min
        long perdida = janela("AGENDADA", u, agora.minus(Duration.ofHours(2)), "perdida");        // fim em -1 h
        long vencida = janela("ATIVA", norte, agora.minus(Duration.ofHours(2)), "vencida");       // fim em -1 h
        long futura = janela("AGENDADA", u, agora.plus(Duration.ofHours(1)), "futura");

        List<CoberturaManutencao.Transicao> ativadas = cobertura.ativarDevidas(agora);
        List<CoberturaManutencao.Transicao> expiradas = cobertura.expirarPerdidas(agora);
        List<CoberturaManutencao.Transicao> concluidas = cobertura.concluirVencidas(agora);

        assertThat(ativadas).containsExactly(new CoberturaManutencao.Transicao(devida,
                agora.minus(Duration.ofMinutes(10)), agora));
        assertThat(ativadas.get(0).atraso()).isEqualTo(Duration.ofMinutes(10));
        assertThat(expiradas).extracting(CoberturaManutencao.Transicao::manutencaoId).containsExactly(perdida);
        assertThat(concluidas).extracting(CoberturaManutencao.Transicao::manutencaoId).containsExactly(vencida);
        assertThat(concluidas.get(0).previsto()).isEqualTo(agora.minus(Duration.ofHours(1)));
        assertThat(situacao(devida)).isEqualTo("ATIVA");
        assertThat(situacao(perdida)).isEqualTo("EXPIRADA");
        assertThat(situacao(vencida)).isEqualTo("CONCLUIDA");
        assertThat(situacao(futura)).isEqualTo("AGENDADA");
        // Segunda passada: CAS nao repete nada.
        assertThat(cobertura.ativarDevidas(agora)).isEmpty();
        assertThat(cobertura.concluirVencidas(agora)).isEmpty();
    }

    // ---------------------------------------------------------------------------
    // Exclusao recusada
    // ---------------------------------------------------------------------------

    @Test
    void excluirEquipamentoComJanela409() {
        ManutencaoResponse r = service.criar(futura(EscopoManutencao.EQUIPAMENTOS, List.of(e2)), operadorId);
        service.cancelar(r.id(), operadorId);   // vale mesmo para janela ja encerrada: e historico

        assertThatThrownBy(() -> equipamentoService.excluir(e2))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel excluir o equipamento porque ele consta em janelas de manutencao");
    }

    @Test
    void excluirUnidadeComJanela409() {
        long vazia = insert("insert into unidade (nome, sigla, ativo) values ('Vazia', 'VZA', true) returning id");
        Instant inicio = Instant.now().plus(Duration.ofHours(1));
        service.criar(new CriarManutencaoRequest(vazia, EscopoManutencao.UNIDADE, null, inicio,
                inicio.plus(Duration.ofHours(1)), "x"), operadorId);

        assertThatThrownBy(() -> unidadeService.excluir(vazia))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel excluir a unidade porque ela consta em janelas de manutencao");
    }

    // ---------------------------------------------------------------------------

    private CriarManutencaoRequest futura(EscopoManutencao escopo, List<Long> ids) {
        Instant inicio = Instant.now().plus(Duration.ofHours(1));
        return requisicao(escopo, ids, inicio, inicio.plus(Duration.ofHours(1)), "Manutencao");
    }

    private CriarManutencaoRequest agora(EscopoManutencao escopo, List<Long> ids) {
        Instant inicio = Instant.now();
        return requisicao(escopo, ids, inicio, inicio.plus(Duration.ofHours(1)), "Manutencao");
    }

    private CriarManutencaoRequest requisicao(EscopoManutencao escopo, List<Long> ids, Instant inicio, Instant fim,
                                              String motivo) {
        return new CriarManutencaoRequest(u, escopo, ids, inicio, fim, motivo);
    }

    /** Janela direto no banco, com os carimbos que o CHECK de coerencia exige para cada situacao. */
    private long janela(String status, long unidadeId, Instant inicio, String motivo) {
        Timestamp i = Timestamp.from(inicio);
        Timestamp f = Timestamp.from(inicio.plus(Duration.ofHours(1)));
        return switch (status) {
            case "AGENDADA", "EXPIRADA" -> insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, "
                    + "fim_previsto, motivo, status, criado_por_id) values (?, 'UNIDADE', ?, ?, ?, ?, ?) returning id",
                    unidadeId, i, f, motivo, status, operadorId);
            case "ATIVA" -> insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, fim_previsto, "
                    + "motivo, status, criado_por_id, ativada_em) values (?, 'UNIDADE', ?, ?, ?, 'ATIVA', ?, ?) "
                    + "returning id", unidadeId, i, f, motivo, operadorId, i);
            case "CONCLUIDA" -> insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, "
                    + "fim_previsto, motivo, status, criado_por_id, ativada_em, encerrada_em) "
                    + "values (?, 'UNIDADE', ?, ?, ?, 'CONCLUIDA', ?, ?, ?) returning id",
                    unidadeId, i, f, motivo, operadorId, i, f);
            case "CANCELADA" -> insert("insert into manutencao_agendada (unidade_id, escopo, inicio_previsto, "
                    + "fim_previsto, motivo, status, criado_por_id, cancelada_em, cancelada_por_id) "
                    + "values (?, 'UNIDADE', ?, ?, ?, 'CANCELADA', ?, ?, ?) returning id",
                    unidadeId, i, f, motivo, operadorId, i, operadorId);
            default -> throw new IllegalArgumentException(status);
        };
    }

    private long equipamento(long unidadeId, String nome, boolean ativo) {
        return insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ativo, em_manutencao) "
                + "values (?, ?, ?, ?, false) returning id", unidadeId, tipo, nome, ativo);
    }

    private boolean emManutencao(long equipamentoId) {
        Map<String, Object> linha = jdbc.queryForMap("select em_manutencao from equipamento where id = ?",
                equipamentoId);
        return (Boolean) linha.get("em_manutencao");
    }

    private int janelasSlaAbertas(long monitorId) {
        return jdbc.queryForObject("select count(*) from janela_monitoramento where monitor_id = ? and fim_em is null",
                Integer.class, monitorId);
    }

    private String situacao(long janelaId) {
        return jdbc.queryForObject("select status from manutencao_agendada where id = ?", String.class, janelaId);
    }

    private int contarJanelas() {
        return jdbc.queryForObject("select count(*) from manutencao_agendada", Integer.class);
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}

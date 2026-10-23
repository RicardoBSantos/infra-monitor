package br.com.inframonitor.manutencao;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.dto.ReferenciaResponse;
import br.com.inframonitor.manutencao.config.ManutencaoAgendadaProperties;
import br.com.inframonitor.manutencao.dto.AlterarFimRequest;
import br.com.inframonitor.manutencao.dto.CriarManutencaoRequest;
import br.com.inframonitor.manutencao.dto.EditarManutencaoRequest;
import br.com.inframonitor.manutencao.dto.ManutencaoResponse;
import br.com.inframonitor.manutencao.entity.EscopoManutencao;
import br.com.inframonitor.manutencao.entity.SituacaoManutencao;
import br.com.inframonitor.manutencao.entity.TipoAlteracao;
import br.com.inframonitor.manutencao.service.ManutencaoAgendadaService;
import br.com.inframonitor.testsupport.RequerDocker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Edicao de AGENDADA, alteracao de fim de ATIVA, leitura por id e filtro por unidade (F2),
 * contra PostgreSQL real.
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
class ManutencaoAgendadaEdicaoPostgresIntegrationTest {

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
    @Autowired private ManutencaoAgendadaProperties propriedades;

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
        jdbc.execute("truncate table manutencao_agendada_alteracao, manutencao_agendada_equipamento, manutencao_agendada, janela_monitoramento, "
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

    private EditarManutencaoRequest edicao(ManutencaoResponse j, long unidadeId, EscopoManutencao escopo,
                                           List<Long> ids, Instant inicio, Instant fim, String motivo) {
        return new EditarManutencaoRequest(unidadeId, escopo, ids, inicio, fim, motivo, j.versao());
    }

    private ManutencaoResponse futura(List<Long> ids) {
        Instant inicio = Instant.now().plus(Duration.ofHours(2)).truncatedTo(ChronoUnit.SECONDS);
        return service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, ids, inicio, inicio.plus(Duration.ofHours(1)),
                "Original"), operadorId);
    }

    @Test
    void editarAgendadaTrocaTudoERegistra() {
        ManutencaoResponse j = futura(List.of(e1));
        Instant inicio = j.inicioPrevisto().plus(Duration.ofHours(1));
        ManutencaoResponse r = service.editar(j.id(), edicao(j, u, EscopoManutencao.EQUIPAMENTOS, List.of(e2, e1),
                inicio, inicio.plus(Duration.ofHours(3)), " Novo motivo "), operadorId);

        assertThat(r.motivo()).isEqualTo("Novo motivo");
        assertThat(r.equipamentos()).extracting(ReferenciaResponse::id).containsExactly(e1, e2);
        assertThat(r.versao()).isEqualTo(1);
        assertThat(r.ultimaAlteracao().tipo()).isEqualTo(TipoAlteracao.EDICAO);
        assertThat(r.ultimaAlteracao().por()).isEqualTo(new ReferenciaResponse(operadorId, "Operador"));
        assertThat(jdbc.queryForObject("select antes->>'motivo' from manutencao_agendada_alteracao where manutencao_id = ?",
                String.class, j.id())).isEqualTo("Original");
    }

    /** Salvar sem mudar nada nao gasta versao nem escreve EDICAO: a tela segue com a versao que tem. */
    @Test
    void editarSemMudancaNaoIncrementaVersaoNemRegistra() {
        ManutencaoResponse j = futura(List.of(e1, e2));
        ManutencaoResponse r = service.editar(j.id(), edicao(j, u, EscopoManutencao.EQUIPAMENTOS, List.of(e2, e1),
                j.inicioPrevisto(), j.fimPrevisto(), " Original "), operadorId);

        assertThat(r.versao()).isZero();
        assertThat(r.ultimaAlteracao()).isNull();
        assertThat(jdbc.queryForObject("select count(*) from manutencao_agendada_alteracao where manutencao_id = ?",
                Long.class, j.id())).isZero();
        // A mesma versao continua valendo para a proxima edicao de verdade.
        assertThat(service.editar(j.id(), edicao(j, u, EscopoManutencao.EQUIPAMENTOS, List.of(e1),
                j.inicioPrevisto(), j.fimPrevisto(), "Outro"), operadorId).versao()).isEqualTo(1);
    }

    @Test
    void editarComVersaoVelhaDa409() {
        ManutencaoResponse j = futura(List.of(e1));
        service.editar(j.id(), edicao(j, u, EscopoManutencao.UNIDADE, List.of(), j.inicioPrevisto(), j.fimPrevisto(), "A"),
                operadorId);
        assertThatThrownBy(() -> service.editar(j.id(), edicao(j, u, EscopoManutencao.UNIDADE, List.of(),
                j.inicioPrevisto(), j.fimPrevisto(), "B"), operadorId))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("A janela foi alterada por outra pessoa. Recarregue e tente de novo.");
    }

    @Test
    void editarAtivaDa409ComUseAlterarFim() {
        Instant agora = Instant.now();
        ManutencaoResponse j = service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(e1), agora,
                agora.plus(Duration.ofHours(1)), "Ativa"), operadorId);
        ManutencaoResponse atual = service.obterPorId(j.id());
        assertThatThrownBy(() -> service.editar(j.id(), edicao(atual, u, EscopoManutencao.EQUIPAMENTOS, List.of(e1),
                atual.inicioPrevisto(), atual.fimPrevisto(), "X"), operadorId))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel editar: a janela esta ATIVA. Use Alterar fim.");
    }

    /** MA21, caso 1: a JANELA mudou de alvo. Id da unidade antiga e recusado. */
    @Test
    void editarTrocandoUnidadeRecusaIdAntigo() {
        ManutencaoResponse j = futura(List.of(e1));
        assertThatThrownBy(() -> service.editar(j.id(), edicao(j, norte, EscopoManutencao.EQUIPAMENTOS, List.of(e1),
                j.inicioPrevisto(), j.fimPrevisto(), "Outra unidade"), operadorId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("O equipamento SW-01 nao pertence a unidade");
        ManutencaoResponse ok = service.editar(j.id(), edicao(j, norte, EscopoManutencao.EQUIPAMENTOS, List.of(eNorte),
                j.inicioPrevisto(), j.fimPrevisto(), "Outra unidade"), operadorId);
        assertThat(ok.unidade().id()).isEqualTo(norte);
    }

    /** MA21, caso 2: o EQUIPAMENTO mudou sozinho; a janela nao mudou de unidade. Continua. */
    @Test
    void editarMantemVinculadoInativoOuMovido() {
        ManutencaoResponse j = futura(List.of(e1, e2));
        jdbc.update("update equipamento set ativo = false where id = ?", e1);
        jdbc.update("update equipamento set unidade_id = ? where id = ?", norte, e2);
        ManutencaoResponse r = service.editar(j.id(), edicao(j, u, EscopoManutencao.EQUIPAMENTOS, List.of(e1, e2),
                j.inicioPrevisto(), j.fimPrevisto(), "So o motivo"), operadorId);
        assertThat(r.equipamentos()).extracting(ReferenciaResponse::id).containsExactlyInAnyOrder(e1, e2);
        // Id NOVO continua passando pelas regras: inativo recusado.
        ManutencaoResponse atual = service.obterPorId(j.id());
        assertThatThrownBy(() -> service.editar(j.id(), edicao(atual, u, EscopoManutencao.EQUIPAMENTOS,
                List.of(e1, e2, eInativo), atual.inicioPrevisto(), atual.fimPrevisto(), "x"), operadorId))
                .isInstanceOf(ConflitoException.class);
    }

    @Test
    void editarComInicioAgoraAtivaNaHora() {
        ManutencaoResponse j = futura(List.of(e1));
        Instant agora = Instant.now();
        ManutencaoResponse r = service.editar(j.id(), edicao(j, u, EscopoManutencao.EQUIPAMENTOS, List.of(e1), agora,
                agora.plus(Duration.ofHours(1)), "Agora"), operadorId);
        assertThat(r.situacao()).isEqualTo(SituacaoManutencao.ATIVA);
        assertThat(emManutencao(e1)).isTrue();
    }

    /** MA25: agendador desligado edita a AGENDADA mas NAO ativa, mesmo com inicio agora. */
    @Test
    void editarComAgendadorDesligadoNaoAtiva() {
        ManutencaoResponse j = futura(List.of(e1));
        propriedades.setEnabled(false);
        try {
            Instant agora = Instant.now();
            ManutencaoResponse r = service.editar(j.id(), edicao(j, u, EscopoManutencao.EQUIPAMENTOS, List.of(e1),
                    agora, agora.plus(Duration.ofHours(1)), "Desligado"), operadorId);
            assertThat(r.situacao()).isEqualTo(SituacaoManutencao.AGENDADA);
            assertThat(emManutencao(e1)).isFalse();
        } finally {
            propriedades.setEnabled(true);
        }
    }

    @Test
    void editarRecusaInicioNoPassadoComoNaCriacao() {
        ManutencaoResponse j = futura(List.of(e1));
        Instant passado = Instant.now().minus(Duration.ofHours(1));
        assertThatThrownBy(() -> service.editar(j.id(), edicao(j, u, EscopoManutencao.EQUIPAMENTOS, List.of(e1), passado,
                passado.plus(Duration.ofHours(2)), "x"), operadorId))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Nao e possivel agendar manutencao com inicio no passado");
    }

    @Test
    void alterarFimProrrogaAntecipaERespeitaTeto() {
        Instant agora = Instant.now();
        ManutencaoResponse j = service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(e1), agora,
                agora.plus(Duration.ofHours(1)), "Ativa"), operadorId);
        ManutencaoResponse a = service.obterPorId(j.id());

        ManutencaoResponse p = service.alterarFim(j.id(), new AlterarFimRequest(a.fimPrevisto().plus(Duration.ofHours(1)),
                a.versao()), operadorId);
        assertThat(p.ultimaAlteracao().tipo()).isEqualTo(TipoAlteracao.PRORROGACAO);
        assertThat(p.inicioPrevisto()).isEqualTo(a.inicioPrevisto());

        ManutencaoResponse an = service.alterarFim(j.id(), new AlterarFimRequest(agora.plus(Duration.ofMinutes(30)),
                p.versao()), operadorId);
        assertThat(an.ultimaAlteracao().tipo()).isEqualTo(TipoAlteracao.ANTECIPACAO);

        assertThatThrownBy(() -> service.alterarFim(j.id(), new AlterarFimRequest(
                a.inicioPrevisto().plus(Duration.ofHours(72)).plusSeconds(1), an.versao()), operadorId))
                .hasMessage("A janela nao pode passar de 72 horas desde o inicio");
        assertThatThrownBy(() -> service.alterarFim(j.id(), new AlterarFimRequest(Instant.now().minusSeconds(1),
                an.versao()), operadorId))
                .hasMessage("O novo fim ja passou. Para terminar agora use Encerrar agora");
        assertThat(emManutencao(e1)).isTrue();
    }

    @Test
    void alterarFimDeConcluidaDa409ComContinuacao() {
        Instant agora = Instant.now();
        ManutencaoResponse j = service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(e1), agora,
                agora.plus(Duration.ofHours(1)), "Ativa"), operadorId);
        int versao = service.obterPorId(j.id()).versao();
        service.encerrar(j.id(), operadorId);
        assertThatThrownBy(() -> service.alterarFim(j.id(), new AlterarFimRequest(agora.plus(Duration.ofHours(2)),
                versao), operadorId))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel alterar o fim: a janela esta CONCLUIDA. Agende uma continuacao.");
    }

    @Test
    void alterarFimComAgendadorDesligadoDa409() {
        Instant agora = Instant.now();
        ManutencaoResponse j = service.criar(requisicao(EscopoManutencao.EQUIPAMENTOS, List.of(e1), agora,
                agora.plus(Duration.ofHours(1)), "Ativa"), operadorId);
        propriedades.setEnabled(false);
        try {
            assertThatThrownBy(() -> service.alterarFim(j.id(), new AlterarFimRequest(agora.plus(Duration.ofHours(2)), 1),
                    operadorId))
                    .isInstanceOf(ConflitoException.class).hasMessageContaining("MANUTENCAO_AGENDADA_ENABLED=true");
        } finally {
            propriedades.setEnabled(true);
        }
    }

    @Test
    void listarPorUnidadeEUltimaAlteracaoNaPagina() {
        ManutencaoResponse centro = futura(List.of(e1));
        Instant inicio = Instant.now().plus(Duration.ofHours(3));
        service.criar(requisicao(norte, EscopoManutencao.UNIDADE, null, inicio, inicio.plus(Duration.ofHours(1)), "Norte"),
                operadorId);
        service.editar(centro.id(), edicao(centro, u, EscopoManutencao.EQUIPAMENTOS, List.of(e1),
                centro.inicioPrevisto(), centro.fimPrevisto(), "Editada"), operadorId);

        Page<ManutencaoResponse> soCentro = service.listar("VIGENTES", "", u, PAGINA);
        assertThat(soCentro.getContent()).extracting(ManutencaoResponse::id).containsExactly(centro.id());
        assertThat(soCentro.getContent().get(0).ultimaAlteracao()).isNotNull();
        assertThat(service.listar("VIGENTES", "", null, PAGINA).getTotalElements()).isEqualTo(2);
        assertThat(service.obterPorId(centro.id()).motivo()).isEqualTo("Editada");
        assertThatThrownBy(() -> service.obterPorId(9999L)).isInstanceOf(RecursoNaoEncontradoException.class);
    }

    private CriarManutencaoRequest requisicao(EscopoManutencao escopo, List<Long> ids, Instant inicio, Instant fim,
                                              String motivo) {
        return requisicao(u, escopo, ids, inicio, fim, motivo);
    }

    private CriarManutencaoRequest requisicao(long unidade, EscopoManutencao escopo, List<Long> ids, Instant inicio,
                                              Instant fim, String motivo) {
        return new CriarManutencaoRequest(unidade, escopo, ids, inicio, fim, motivo);
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

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }
}

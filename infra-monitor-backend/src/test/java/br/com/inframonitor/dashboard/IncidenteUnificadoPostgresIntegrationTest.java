package br.com.inframonitor.dashboard;

import br.com.inframonitor.dashboard.dto.DashboardIncidenteResponse;
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
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * GET /api/v1/dashboard/incidentes contra PostgreSQL real. A query e um UNION nativo com
 * LATERAL: nao ha como exercitar em teste de unidade com repositorio mockado.
 *
 * <p>Os dados sao inseridos por SQL, e nao pelos services, porque o ponto do teste e
 * justamente forcar a colisao de id entre {@code incidente} e
 * {@code monitor_episodio_latencia} — duas sequencias independentes que comecam em 1.
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
class IncidenteUnificadoPostgresIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant T0 = Instant.parse("2026-09-01T08:00:00Z");

    @Autowired private JdbcTemplate jdbc;
    @Autowired private DashboardIncidenteService service;

    private long unidadeA;
    private long unidadeB;
    private long monitorA;
    private long monitorB;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @BeforeEach
    void montarCenario() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");

        long tipo = insert("insert into tipo_equipamento (nome, ativo) values ('Switch', true) returning id");
        unidadeA = insert("insert into unidade (nome, sigla, ativo) values ('Centro', 'CTR', true) returning id");
        unidadeB = insert("insert into unidade (nome, sigla, ativo) values ('Itabaiana', 'ITB', true) returning id");
        monitorA = monitor(equipamento(unidadeA, tipo, "SW-CORE"), "ICMP CORE");
        monitorB = monitor(equipamento(unidadeB, tipo, "LINK-WAN"), "ICMP WAN");

        long operador = insert("insert into usuarios (nome, email, senha_hash, papel, ativo, troca_senha_obrigatoria) "
                + "values ('Ricardo', 'ricardo@infra', 'x', 'OPERADOR', true, false) returning id");

        // incidente 1 e episodio 1 coexistem: a colisao de id e o cenario, nao um acidente.
        long incidenteAberto = incidente(monitorA, "ABERTO", T0, null, null, null);
        long incidenteReconhecido = incidente(monitorB, "RECONHECIDO", T0.plusSeconds(60), null,
                T0.plusSeconds(120), operador);
        long incidenteFechado = incidente(monitorA, "FECHADO", T0.minusSeconds(3600), T0.minusSeconds(1800),
                null, null);

        episodio(monitorA, T0.plusSeconds(30), null);                          // id 1, aberto
        episodio(monitorB, T0.minusSeconds(600), T0.minusSeconds(300));        // id 2, encerrado

        // Duas notificacoes na mesma ancora: e o que um LEFT JOIN direto duplicaria.
        notificacaoIncidente(incidenteFechado, "INCIDENTE_ABERTO", T0.minusSeconds(3590));
        notificacaoIncidente(incidenteFechado, "INCIDENTE_FECHADO", T0.minusSeconds(1790));
        notificacaoIncidente(incidenteAberto, "INCIDENTE_ABERTO", T0.plusSeconds(5));
        notificacaoIncidente(incidenteReconhecido, "INCIDENTE_ABERTO", T0.plusSeconds(65));
        notificacaoEpisodio(1L, "LATENCIA_ALTA", T0.plusSeconds(35));
        notificacaoEpisodio(2L, "LATENCIA_ALTA", T0.minusSeconds(590));
        notificacaoEpisodio(2L, "LATENCIA_NORMALIZADA", T0.minusSeconds(290));
    }

    @Test
    void uneIncidenteEEpisodioSemDuplicarLinhaPorNotificacao() {
        var pagina = service.listar(null, null, null, null, null, 0, 20, null);

        // 3 incidentes + 2 episodios. Sete notificacoes no total nao alteram a contagem.
        assertThat(pagina.totalElements()).isEqualTo(5);
        assertThat(pagina.content()).hasSize(5);
        assertThat(pagina.content()).extracting(DashboardIncidenteResponse::tipo)
                .containsOnly("INCIDENTE", "LATENCIA");
    }

    @Test
    void idColideEntreOsDoisTiposEOTipoDesambigua() {
        var linhas = service.listar(null, null, null, null, null, 0, 20, null).content();

        var chaves = linhas.stream().map(l -> l.tipo() + "-" + l.id()).toList();
        assertThat(chaves).doesNotHaveDuplicates();
        // O mesmo id 1 existe nas duas tabelas: so o par (tipo, id) identifica a linha.
        assertThat(chaves).contains("INCIDENTE-1", "LATENCIA-1");
    }

    @Test
    void notificadoVemDaAncoraCertaESempreAMaisRecente() {
        var linhas = service.listar(null, null, null, null, null, 0, 20, null).content();

        var fechado = linha(linhas, "INCIDENTE", 3L);
        assertThat(fechado.notificacaoCanal()).isEqualTo("TELEGRAM");
        assertThat(fechado.notificacaoStatus()).isEqualTo("ENVIADA");

        var episodioEncerrado = linha(linhas, "LATENCIA", 2L);
        assertThat(episodioEncerrado.notificacaoCanal()).isEqualTo("TELEGRAM");
    }

    @Test
    void statusDoEpisodioUsaOVocabularioDoIncidente() {
        var linhas = service.listar(null, null, null, null, null, 0, 20, null).content();

        assertThat(linha(linhas, "LATENCIA", 1L).status()).isEqualTo("ABERTO");
        assertThat(linha(linhas, "LATENCIA", 2L).status()).isEqualTo("FECHADO");
    }

    @Test
    void abaReconhecidosNuncaTrazEpisodio() {
        var linhas = service.listar(null, null, "RECONHECIDO", null, null, 0, 20, null).content();

        assertThat(linhas).hasSize(1);
        assertThat(linhas.get(0).tipo()).isEqualTo("INCIDENTE");
        assertThat(linhas.get(0).reconhecidoPorNome()).isEqualTo("Ricardo");
    }

    @Test
    void severidadeDerivaDoTipoSemColunaPersistida() {
        assertThat(service.listar(null, "ALTA", null, null, null, 0, 20, null).content())
                .extracting(DashboardIncidenteResponse::tipo).containsOnly("INCIDENTE");
        assertThat(service.listar(null, "MEDIA", null, null, null, 0, 20, null).content())
                .extracting(DashboardIncidenteResponse::tipo).containsOnly("LATENCIA");
    }

    @Test
    void contadoresRespeitamOsFiltrosDaListaMenosODeStatus() {
        var global = service.contadores(null, null, null, null);
        assertThat(global.abertos()).isEqualTo(2);        // incidente 1 + episodio 1
        assertThat(global.reconhecidos()).isEqualTo(1);
        assertThat(global.resolvidos()).isEqualTo(2);     // incidente 3 + episodio 2
        assertThat(global.todos()).isEqualTo(5);

        // Filtrado por unidade os numeros tem de acompanhar a lista, nao o total global.
        var porUnidade = service.contadores(unidadeB, null, null, null);
        assertThat(porUnidade.todos()).isEqualTo(2);
        assertThat(porUnidade.reconhecidos()).isEqualTo(1);
        assertThat(porUnidade.abertos()).isZero();
        assertThat(porUnidade.todos())
                .isEqualTo(service.listar(unidadeB, null, null, null, null, 0, 20, null).totalElements());
    }

    @Test
    void periodoFiltraPorSobreposicaoEExigeOsDoisExtremos() {
        // Janela depois do fim do que ja se resolveu: so o que ainda estava acontecendo.
        var janela = service.listar(null, null, null, T0, T0.plusSeconds(3600), 0, 20, null);
        assertThat(janela.content()).extracting(l -> l.tipo() + "-" + l.id())
                .containsExactlyInAnyOrder("INCIDENTE-1", "INCIDENTE-2", "LATENCIA-1");

        assertThatThrownBy(() -> service.listar(null, null, null, T0, null, 0, 20, null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void paginacaoEEstavelComIdColidindoEntreTabelas() {
        var primeira = service.listar(null, null, null, null, null, 0, 2, "iniciadoEm,desc");
        var segunda = service.listar(null, null, null, null, null, 1, 2, "iniciadoEm,desc");
        var terceira = service.listar(null, null, null, null, null, 2, 2, "iniciadoEm,desc");

        var todas = concat(primeira.content(), segunda.content(), terceira.content());
        assertThat(todas).hasSize(5);
        assertThat(todas.stream().map(l -> l.tipo() + "-" + l.id()).toList()).doesNotHaveDuplicates();
        assertThat(primeira.totalElements()).isEqualTo(5);
        assertThat(terceira.last()).isTrue();
    }

    /**
     * A marca de manutencao da lista unificada (front) depende desta projecao: sem o
     * campo preenchido aqui, a condicao do template nunca e verdadeira. NULL continua
     * sendo o caso comum — o incidente fechado do cenario base nunca foi classificado,
     * porque fechou antes da V19, e isso nao pode virar excecao.
     */
    @Test
    void motivoEncerramentoApareceQuandoProjetadoENuloNoRestante() {
        long incidenteManutencao = incidente(monitorA, "FECHADO", T0.minusSeconds(7200), T0.minusSeconds(7000),
                null, null, "MANUTENCAO");

        var linhas = service.listar(null, null, null, null, null, 0, 20, null).content();

        assertThat(linha(linhas, "INCIDENTE", incidenteManutencao).motivoEncerramento()).isEqualTo("MANUTENCAO");
        // Incidente fechado do cenario base, sem classificacao: NULL e honesto, nao erro.
        assertThat(linha(linhas, "INCIDENTE", 3L).motivoEncerramento()).isNull();
        // Episodio de latencia tem coluna propria no banco, mas esta leitura nao a projeta.
        assertThat(linha(linhas, "LATENCIA", 1L).motivoEncerramento()).isNull();
    }

    @Test
    void recusaSeveridadeStatusEOrdenacaoForaDoContrato() {
        assertThatThrownBy(() -> service.listar(null, "CRITICA", null, null, null, 0, 20, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.listar(null, null, "PENDENTE", null, null, 0, 20, null))
                .isInstanceOf(IllegalArgumentException.class);
        // O valor e concatenado no SQL: so nome de coluna da whitelist passa.
        assertThatThrownBy(() -> service.listar(null, null, null, null, null, 0, 20, "id; drop table incidente,desc"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private DashboardIncidenteResponse linha(List<DashboardIncidenteResponse> linhas, String tipo, Long id) {
        return linhas.stream().filter(l -> l.tipo().equals(tipo) && l.id().equals(id)).findFirst().orElseThrow();
    }

    @SafeVarargs
    private List<DashboardIncidenteResponse> concat(List<DashboardIncidenteResponse>... partes) {
        return java.util.Arrays.stream(partes).flatMap(List::stream).toList();
    }

    private long insert(String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

    private long equipamento(long unidadeId, long tipoId, String nome) {
        return insert("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ativo, em_manutencao) "
                + "values (?, ?, ?, true, false) returning id", unidadeId, tipoId, nome);
    }

    private long monitor(long equipamentoId, String nome) {
        return insert("insert into monitor (equipamento_id, tipo, nome, intervalo_segundos, timeout_ms, ativo, "
                + "falhas_para_incidente, sucessos_para_recovery) "
                + "values (?, 'ICMP', ?, 60, 2000, true, 3, 2) returning id", equipamentoId, nome);
    }

    private long incidente(long monitorId, String status, Instant iniciadoEm, Instant encerradoEm,
                           Instant reconhecidoEm, Long reconhecidoPor) {
        return incidente(monitorId, status, iniciadoEm, encerradoEm, reconhecidoEm, reconhecidoPor, null);
    }

    private long incidente(long monitorId, String status, Instant iniciadoEm, Instant encerradoEm,
                           Instant reconhecidoEm, Long reconhecidoPor, String motivoEncerramento) {
        return insert("insert into incidente (monitor_id, status, iniciado_em, encerrado_em, motivo, "
                + "reconhecido_em, reconhecido_por, motivo_encerramento) "
                + "values (?, ?, ?, ?, 'Indisponibilidade', ?, ?, ?) returning id",
                monitorId, status, Timestamp.from(iniciadoEm), encerradoEm == null ? null : Timestamp.from(encerradoEm),
                reconhecidoEm == null ? null : Timestamp.from(reconhecidoEm), reconhecidoPor, motivoEncerramento);
    }

    private void episodio(long monitorId, Instant iniciadoEm, Instant encerradoEm) {
        jdbc.update("insert into monitor_episodio_latencia (monitor_id, iniciado_em, encerrado_em, limiar_ms) "
                + "values (?, ?, ?, 250)", monitorId, Timestamp.from(iniciadoEm),
                encerradoEm == null ? null : Timestamp.from(encerradoEm));
    }

    private void notificacaoIncidente(long incidenteId, String tipoEvento, Instant criadaEm) {
        jdbc.update("insert into notificacao (incidente_id, canal, tipo_evento, status, mensagem, enviado_em, created_at) "
                + "values (?, 'TELEGRAM', ?, 'ENVIADA', 'msg', ?, ?)",
                incidenteId, tipoEvento, Timestamp.from(criadaEm), Timestamp.from(criadaEm));
    }

    private void notificacaoEpisodio(long episodioId, String tipoEvento, Instant criadaEm) {
        jdbc.update("insert into notificacao (episodio_latencia_id, canal, tipo_evento, status, mensagem, "
                + "enviado_em, created_at) values (?, 'TELEGRAM', ?, 'ENVIADA', 'msg', ?, ?)",
                episodioId, tipoEvento, Timestamp.from(criadaEm), Timestamp.from(criadaEm));
    }
}

package br.com.inframonitor.dashboard;

import br.com.inframonitor.common.api.Paginacao;
import br.com.inframonitor.dashboard.dto.DashboardEquipamentoListaResponse;
import br.com.inframonitor.dashboard.dto.DashboardEquipamentoResponse;
import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.medicao.entity.Medicao;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.testsupport.RequerDocker;
import br.com.inframonitor.tipoequipamento.dto.CreateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.service.TipoEquipamentoService;
import br.com.inframonitor.unidade.dto.CreateUnidadeRequest;
import br.com.inframonitor.unidade.service.UnidadeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * GET /api/v1/dashboard/equipamentos sobre um inventario do tamanho do real: 220 equipamentos
 * em 11 unidades.
 *
 * <p>Dois riscos cobertos aqui:
 * <ol>
 *   <li>o inventario inteiro sair em uma unica resposta, sem o teto de 100 de {@link Paginacao};</li>
 *   <li>a classificacao SQL de {@link DashboardReadRepository} divergir do
 *       {@link OperationalStatusResolver}. A formula ja estava duplicada em SQL e em Java antes
 *       desta rodada; o teste trava as duas em paridade em vez de acrescentar uma terceira copia.</li>
 * </ol>
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
class InventarioDashboardPostgresIntegrationTest {
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final int UNIDADES = 11;
    private static final int EQUIPAMENTOS_POR_UNIDADE = 20;
    private static final int TOTAL = UNIDADES * EQUIPAMENTOS_POR_UNIDADE;
    /** Igual ao default de monitoring.latencia-degradada-ms. */
    private static final int LIMIAR_DEGRADADO_MS = 250;
    private static final Instant AGORA = Instant.parse("2026-08-31T12:00:00Z");

    @Autowired private JdbcTemplate jdbc;
    @Autowired private UnidadeService unidades;
    @Autowired private TipoEquipamentoService tipos;
    @Autowired private EquipamentoService equipamentos;
    @Autowired private EquipamentoRepository equipamentoRepository;
    @Autowired private MonitorRepository monitorRepository;
    @Autowired private MedicaoRepository medicoes;
    @Autowired private IncidenteRepository incidentes;
    @Autowired private DashboardService dashboard;

    private final List<Long> unidadeIds = new ArrayList<>();
    private Long operadorId;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @BeforeEach
    void montarInventario() {
        jdbc.execute("truncate table janela_monitoramento, medicao, incidente, notificacao, monitor, "
                + "equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        unidadeIds.clear();
        operadorId = jdbc.queryForObject("insert into usuarios (nome, email, senha_hash, papel, "
                + "troca_senha_obrigatoria) values ('Operador', 'operador@teste.local', 'hash', "
                + "'OPERADOR', false) returning id", Long.class);
        long tipo = tipos.criar(new CreateTipoEquipamentoRequest("Switch", null)).id();

        for (int u = 0; u < UNIDADES; u++) {
            long unidadeId = unidades.criar(new CreateUnidadeRequest(
                    "Unidade %02d".formatted(u), "U%02d".formatted(u), null, null, null, null, null, null, null)).id();
            unidadeIds.add(unidadeId);

            for (int e = 0; e < EQUIPAMENTOS_POR_UNIDADE; e++) {
                long id = equipamentos.criar(new CreateEquipamentoRequest(unidadeId, tipo,
                        "EQ-%02d-%02d".formatted(u, e), "10.%d.0.%d".formatted(u, e + 1),
                        "eq-%02d-%02d.local".formatted(u, e), null, "Rack %02d".formatted(e),
                        "SN-%02d%02d".formatted(u, e), null, null)).id();
                aplicarPerfilOperacional(id, e % 7);
            }
        }
    }

    /** Rodizio de perfis para que todos os ramos do resolver aparecam em cada unidade. */
    private void aplicarPerfilOperacional(long equipamentoId, int perfil) {
        switch (perfil) {
            case 0 -> medicao(monitor(equipamentoId), 13);                              // DISPONIVEL
            case 1 -> medicao(monitor(equipamentoId), LIMIAR_DEGRADADO_MS + 40);        // DEGRADADO
            case 2 -> {                                                                  // INDISPONIVEL
                Monitor monitor = monitor(equipamentoId);
                medicao(monitor, null);
                incidentes.saveAndFlush(new Incidente(monitor, AGORA, "queda", null));
            }
            case 3 -> monitor(equipamentoId);                                            // SEM_DADOS
            case 4 -> { }                                                                // SEM_MONITORAMENTO
            case 5 -> {                                                                  // EM_MANUTENCAO
                medicao(monitor(equipamentoId), 12);
                equipamentos.entrarEmManutencao(equipamentoId, operadorId);
            }
            case 6 -> {                                                                  // DESABILITADO
                medicao(monitor(equipamentoId), 12);
                equipamentos.desativar(equipamentoId);
            }
            default -> throw new IllegalStateException("perfil desconhecido: " + perfil);
        }
    }

    @Test
    void devolveOInventarioInteiroSemTetoDePaginacao() {
        List<DashboardEquipamentoListaResponse> inventario = dashboard.equipamentos();

        assertThat(TOTAL).isGreaterThan(Paginacao.TAMANHO_MAXIMO);
        assertThat(inventario).hasSize(TOTAL);
        assertThat(inventario).extracting(DashboardEquipamentoListaResponse::id).doesNotHaveDuplicates();
        assertThat(inventario).isSortedAccordingTo(Comparator.comparing(DashboardEquipamentoListaResponse::nome));
    }

    @Test
    void preencheOsCamposQueABuscaDaTelaFiltraEmMemoria() {
        assertThat(dashboard.equipamentos()).allSatisfy(linha -> {
            assertThat(linha.unidadeId()).isNotNull();
            assertThat(linha.unidadeNome()).startsWith("Unidade ");
            assertThat(linha.tipoNome()).isEqualTo("Switch");
            assertThat(linha.hostname()).endsWith(".local");
            assertThat(linha.ip()).startsWith("10.");
            // Sem estes dois carregados, a busca da tela prometeria um filtro que não existe.
            assertThat(linha.localizacao()).startsWith("Rack ");
            assertThat(linha.numeroSerie()).startsWith("SN-");
        });
    }

    @Test
    void statusELatenciaBatemComOResolverJavaEmTodosOsEquipamentos() {
        Map<Long, DashboardEquipamentoResponse> viaResolver = new HashMap<>();
        for (Long unidadeId : unidadeIds) {
            dashboard.equipamentosDaUnidade(unidadeId, null, null, PageRequest.of(0, 100, Sort.by("nome")))
                    .forEach(equipamento -> viaResolver.put(equipamento.id(), equipamento));
        }
        assertThat(viaResolver).hasSize(TOTAL);

        List<DashboardEquipamentoListaResponse> viaSql = dashboard.equipamentos();

        assertThat(viaSql).allSatisfy(linha -> {
            DashboardEquipamentoResponse esperado = viaResolver.get(linha.id());
            assertThat(esperado).as("equipamento %s", linha.nome()).isNotNull();
            assertThat(linha.status()).as("status de %s", linha.nome()).isEqualTo(esperado.status());
            assertThat(linha.ativo()).as("ativo de %s", linha.nome()).isEqualTo(esperado.ativo());
            Integer latenciaEsperada = esperado.ultimaMedicao() == null ? null : esperado.ultimaMedicao().latenciaMs();
            assertThat(linha.latenciaMs()).as("latencia de %s", linha.nome()).isEqualTo(latenciaEsperada);
        });

        // Sem isto a paridade acima poderia passar cobrindo um unico ramo.
        assertThat(viaSql).extracting(DashboardEquipamentoListaResponse::status)
                .contains(StatusOperacionalEquipamento.DISPONIVEL, StatusOperacionalEquipamento.DEGRADADO,
                        StatusOperacionalEquipamento.INDISPONIVEL, StatusOperacionalEquipamento.SEM_DADOS,
                        StatusOperacionalEquipamento.SEM_MONITORAMENTO, StatusOperacionalEquipamento.EM_MANUTENCAO,
                        StatusOperacionalEquipamento.DESABILITADO);
    }

    @Test
    void equipamentoIndisponivelVemSemLatencia() {
        assertThat(dashboard.equipamentos())
                .filteredOn(linha -> linha.status() == StatusOperacionalEquipamento.INDISPONIVEL)
                .isNotEmpty()
                .allSatisfy(linha -> assertThat(linha.latenciaMs()).isNull());
    }

    private Monitor monitor(long equipamentoId) {
        Equipamento equipamento = equipamentoRepository.findById(equipamentoId).orElseThrow();
        return monitorRepository.saveAndFlush(new Monitor(equipamento, TipoMonitor.ICMP, "ICMP", 60, 2_000));
    }

    private void medicao(Monitor monitor, Integer latenciaMs) {
        medicoes.saveAndFlush(new Medicao(monitor,
                latenciaMs == null ? StatusMedicao.FALHA : StatusMedicao.SUCESSO, latenciaMs, null, AGORA));
    }
}

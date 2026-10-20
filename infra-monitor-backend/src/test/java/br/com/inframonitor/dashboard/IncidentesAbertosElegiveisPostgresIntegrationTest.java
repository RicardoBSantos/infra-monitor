package br.com.inframonitor.dashboard;

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
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Incidente aberto de monitor desativado, de equipamento inativo ou em manutencao e orfao:
 * fica na lista de incidentes, mas nao entra em nenhuma contagem operacional do dashboard.
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
class IncidentesAbertosElegiveisPostgresIntegrationTest {
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
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

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @BeforeEach
    void montarCenario() {
        jdbc.execute("truncate table janela_monitoramento, medicao, incidente, notificacao, monitor, "
                + "equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        long tipo = tipos.criar(new CreateTipoEquipamentoRequest("Switch", null)).id();
        long unidadeId = unidades.criar(new CreateUnidadeRequest(
                "Unidade Teste", "UT", null, null, null, null, null, null, null)).id();

        long normal = equipamento(unidadeId, tipo, "NORMAL", 1);
        long monitorOff = equipamento(unidadeId, tipo, "MONITOR-OFF", 2);
        long equipOff = equipamento(unidadeId, tipo, "EQUIP-OFF", 3);
        long manut = equipamento(unidadeId, tipo, "MANUT", 4);
        equipamento(unidadeId, tipo, "SAUDAVEL", 5);

        Monitor monitorDoOff = monitorDe(monitorOff);
        Monitor monitorDoEquipOff = monitorDe(equipOff);
        Monitor monitorDaManut = monitorDe(manut);
        Monitor monitorNormal = monitorDe(normal);

        jdbc.update("update monitor set ativo = false where id = ?", monitorDoOff.getId());
        jdbc.update("update equipamento set ativo = false where id = ?", equipOff);
        jdbc.update("update equipamento set em_manutencao = true where id = ?", manut);

        // Incidentes depois dos ajustes, direto no repositorio: a guarda de elegibilidade de proposito nao participa.
        for (Monitor m : new Monitor[]{monitorNormal, monitorDoOff, monitorDoEquipOff, monitorDaManut}) {
            incidentes.saveAndFlush(new Incidente(m, AGORA, "queda", null));
        }
    }

    private long equipamento(long unidadeId, long tipo, String nome, int n) {
        long id = equipamentos.criar(new CreateEquipamentoRequest(unidadeId, tipo, nome, "10.0.0." + n,
                nome.toLowerCase() + ".local", null, null, null, null, null)).id();
        Equipamento e = equipamentoRepository.findById(id).orElseThrow();
        Monitor monitor = monitorRepository.saveAndFlush(new Monitor(e, TipoMonitor.ICMP, "ICMP", 60, 2_000));
        medicoes.saveAndFlush(new Medicao(monitor, StatusMedicao.SUCESSO, 10, null, AGORA));
        return id;
    }

    private Monitor monitorDe(long equipamentoId) {
        return monitorRepository.findAll().stream()
                .filter(m -> m.getEquipamento().getId().equals(equipamentoId)).findFirst().orElseThrow();
    }

    @Test
    void soIncidenteDeMonitorAtivoEmEquipamentoAtivoForaDeManutencaoConta() {
        var linha = dashboard.unidades().stream().filter(u -> u.nome().equals("Unidade Teste")).findFirst().orElseThrow();
        assertThat(linha.incidentesAbertos()).isEqualTo(1);
        assertThat(linha.status()).isEqualTo(StatusOperacionalUnidade.DEGRADADA); // NORMAL offline, SAUDAVEL disponivel

        assertThat(dashboard.unidade(linha.id()).incidentesAbertos()).isEqualTo(1);

        var resumo = dashboard.resumo();
        assertThat(resumo.incidentes().abertos()).isEqualTo(1);
        // Monitor de equipamento em manutencao com incidente orfao nao vira INDISPONIVEL.
        assertThat(resumo.monitores().indisponiveis()).isEqualTo(1);

        var porNome = dashboard.equipamentosDaUnidade(linha.id(), null, null, PageRequest.of(0, 20, Sort.by("nome")))
                .stream().collect(Collectors.toMap(DashboardEquipamentoResponse::nome, DashboardEquipamentoResponse::incidentesAbertos));
        assertThat(porNome).containsEntry("NORMAL", 1L).containsEntry("MONITOR-OFF", 0L)
                .containsEntry("EQUIP-OFF", 0L).containsEntry("MANUT", 0L).containsEntry("SAUDAVEL", 0L);
    }
}

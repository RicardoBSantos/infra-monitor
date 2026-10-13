package br.com.inframonitor.monitoring.incident;

import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.incidente.service.IncidenteService;
import br.com.inframonitor.medicao.entity.Medicao;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.monitoring.latency.LatencyEpisodeProcessor;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatenciaRepository;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import br.com.inframonitor.testsupport.RequerDocker;
import br.com.inframonitor.tipoequipamento.dto.CreateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.service.TipoEquipamentoService;
import br.com.inframonitor.unidade.dto.CreateUnidadeRequest;
import br.com.inframonitor.unidade.service.UnidadeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Prova de reversao da corrida entre o motor de monitoramento e a entrada em
 * manutencao: uma medicao ja "em voo" nao pode abrir incidente (nem episodio de
 * latencia) depois que o equipamento entrou em manutencao, e — o ponto critico —
 * quando a insercao nao acontece, nenhuma notificacao pode nascer.
 *
 * <p>Sobe um PostgreSQL real via Testcontainers porque o coracao da mudanca e o
 * INSERT ... SELECT ... WHERE nativo com ON CONFLICT DO NOTHING: mock nenhum
 * exercita o indice parcial nem o predicado de elegibilidade lido do banco.
 */
@RequerDocker
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-abertura-condicional-test",
        "monitoring.engine.enabled=false", "notification.telegram.enabled=false", "notification.dispatcher.enabled=false",
        // Ciclo unico: uma so medicao degradada ja fecha a sequencia do episodio de latencia.
        "monitoring.latencia-ciclos=1"
})
class AberturaCondicionalTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant AGORA = Instant.parse("2026-09-22T10:00:00Z");

    @DynamicPropertySource static void db(DynamicPropertyRegistry r) {
        POSTGRES.start();
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired UnidadeService unidades;
    @Autowired TipoEquipamentoService tipos;
    @Autowired EquipamentoService equipamentoService;
    @Autowired EquipamentoRepository equipamentoRepository;
    @Autowired MonitorRepository monitorRepository;
    @Autowired MedicaoRepository medicaoRepository;
    @Autowired IncidenteRepository incidenteRepository;
    @Autowired IncidenteService incidenteService;
    @Autowired MonitorEpisodioLatenciaRepository episodioRepository;
    @Autowired LatencyEpisodeProcessor latencyEpisodeProcessor;
    @Autowired NotificacaoRepository notificacaoRepository;

    private Equipamento equipamento;
    private Monitor monitor;
    private Instant agora;
    private Medicao medicaoDegradada;

    @BeforeEach void preparar() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade restart identity cascade");

        Long unidadeId = unidades.criar(new CreateUnidadeRequest("Unidade Corrida", "COR", null, null, null, null,
                null, null, null)).id();
        Long tipoId = tipos.criar(new CreateTipoEquipamentoRequest("Tipo Corrida", null)).id();
        Long equipamentoId = equipamentoService.criar(new CreateEquipamentoRequest(unidadeId, tipoId,
                "Equipamento Corrida", null, null, null, null, null, null, null)).id();
        equipamento = equipamentoRepository.findById(equipamentoId).orElseThrow();

        monitor = monitorRepository.saveAndFlush(new Monitor(equipamento, TipoMonitor.ICMP, "Monitor Corrida", 60, 2000));

        agora = AGORA;
        medicaoDegradada = medicaoRepository.saveAndFlush(new Medicao(monitor, StatusMedicao.SUCESSO, 999, null, agora));
    }

    @Test
    void naoAbreIncidenteParaEquipamentoEmManutencao() {
        equipamento.setEmManutencao(true);
        equipamentoRepository.saveAndFlush(equipamento);

        Optional<Incidente> aberto = incidenteService.abrirAutomaticamente(monitor, agora, 3);

        assertThat(aberto).isEmpty();
        assertThat(incidenteRepository.existsByMonitorId(monitor.getId())).isFalse();
        // O ponto critico: sem insercao, NENHUMA notificacao nasce.
        assertThat(notificacaoRepository.count()).isZero();
    }

    @Test
    void naoAbreEpisodioDeLatenciaParaEquipamentoEmManutencao() {
        equipamento.setEmManutencao(true);
        equipamentoRepository.saveAndFlush(equipamento);

        latencyEpisodeProcessor.process(medicaoDegradada);

        assertThat(episodioRepository.findFirstByMonitorIdAndEncerradoEmIsNull(monitor.getId())).isEmpty();
        assertThat(notificacaoRepository.count()).isZero();
    }

    @Test
    void segundaAberturaConcorrenteNaoDuplicaNemNotifica() {
        incidenteService.abrirAutomaticamente(monitor, agora, 3);
        Optional<Incidente> segunda = incidenteService.abrirAutomaticamente(monitor, agora, 3);

        assertThat(segunda).isEmpty();
        assertThat(notificacaoRepository.count()).isEqualTo(1);
    }
}

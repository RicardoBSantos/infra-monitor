package br.com.inframonitor.monitoring.incident;

import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.medicao.entity.Medicao;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.relatorio.entity.JanelaMonitoramento;
import br.com.inframonitor.relatorio.entity.OrigemJanelaMonitoramento;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
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

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Prova de reversao: com a manutencao, a cauda de medicoes do monitor congela onde
 * estava. Sem uma ancora na janela de monitoramento, a primeira falha nova depois da
 * saida completaria uma sequencia iniciada ANTES da manutencao e abriria um incidente
 * retroativo, disparando Telegram na medicao errada.
 *
 * <p>Sobe PostgreSQL real via Testcontainers para exercitar o mesmo caminho que o motor
 * usa em producao: JanelaMonitoramentoRepository.aberta(Long) e o INSERT ... SELECT ...
 * ON CONFLICT DO NOTHING de IncidenteService.abrirAutomaticamente.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-cauda-congelada-test",
        "monitoring.engine.enabled=false", "notification.telegram.enabled=false", "notification.dispatcher.enabled=false"
})
class CaudaCongeladaTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

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
    @Autowired JanelaMonitoramentoRepository janelaRepository;
    @Autowired IncidentProcessor incidentProcessor;

    private Monitor monitor;

    @BeforeEach void preparar() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade restart identity cascade");

        Long unidadeId = unidades.criar(new CreateUnidadeRequest("Unidade Cauda", "CAU", null, null, null, null,
                null, null, null)).id();
        Long tipoId = tipos.criar(new CreateTipoEquipamentoRequest("Tipo Cauda", null)).id();
        Long equipamentoId = equipamentoService.criar(new CreateEquipamentoRequest(unidadeId, tipoId,
                "Equipamento Cauda", null, null, null, null, null, null, null)).id();
        Equipamento equipamento = equipamentoRepository.findById(equipamentoId).orElseThrow();

        // falhasParaIncidente = 3
        monitor = monitorRepository.saveAndFlush(
                new Monitor(equipamento, TipoMonitor.ICMP, "Monitor Cauda", 60, 2000, 3, 2));
    }

    @Test
    void caudaCongeladaPelaManutencaoNaoAbreIncidenteNaPrimeiraFalhaNova() {
        // 3 falhas ANTES da manutencao, janela fechada, janela reaberta, 1 falha NOVA
        medicao(StatusMedicao.FALHA, "2026-09-22T10:00:00Z");
        medicao(StatusMedicao.FALHA, "2026-09-22T10:00:30Z");
        medicao(StatusMedicao.FALHA, "2026-09-22T10:01:00Z");
        fecharJanela("2026-09-22T10:00:00Z", "2026-09-22T10:01:10Z");
        abrirJanela("2026-09-22T11:00:00Z");
        Medicao novaFalha = medicao(StatusMedicao.FALHA, "2026-09-22T11:00:10Z");

        incidentProcessor.process(novaFalha);

        // Sem a ancora, a cauda [FALHA(nova), FALHA(velha), FALHA(velha)] abriria um
        // incidente com iniciadoEm de ANTES da manutencao e dispararia Telegram.
        assertThat(incidenteRepository.existsByMonitorId(monitor.getId())).isFalse();
    }

    @Test
    void tresFalhasNOVASDepoisDaJanelaAbremIncidente() {
        abrirJanela("2026-09-22T11:00:00Z");
        medicao(StatusMedicao.FALHA, "2026-09-22T11:00:10Z");
        medicao(StatusMedicao.FALHA, "2026-09-22T11:00:40Z");
        Medicao terceira = medicao(StatusMedicao.FALHA, "2026-09-22T11:01:10Z");

        incidentProcessor.process(terceira);

        assertThat(incidenteRepository.existsByMonitorId(monitor.getId())).isTrue();
    }

    private Medicao medicao(StatusMedicao status, String executadoEm) {
        return medicaoRepository.saveAndFlush(new Medicao(monitor, status, null, null, Instant.parse(executadoEm)));
    }

    private void abrirJanela(String inicioEm) {
        janelaRepository.saveAndFlush(
                new JanelaMonitoramento(monitor, Instant.parse(inicioEm), OrigemJanelaMonitoramento.PRECISA));
    }

    private void fecharJanela(String inicioEm, String fimEm) {
        JanelaMonitoramento janela = new JanelaMonitoramento(monitor, Instant.parse(inicioEm),
                OrigemJanelaMonitoramento.PRECISA);
        janela.fechar(Instant.parse(fimEm));
        janelaRepository.saveAndFlush(janela);
    }
}

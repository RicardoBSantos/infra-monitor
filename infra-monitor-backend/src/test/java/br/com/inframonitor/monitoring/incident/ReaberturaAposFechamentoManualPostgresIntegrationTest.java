package br.com.inframonitor.monitoring.incident;

import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.incidente.dto.CloseIncidenteRequest;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.incidente.service.IncidenteService;
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
import java.time.temporal.ChronoUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Prova de reversao: monitor fechado a mao com o alvo ainda fora do ar nao pode reabrir
 * incidente com as falhas que pertenciam ao incidente fechado. A ancora e a gravacao do
 * fechamento (updated_at, relogio real), nao o encerrado_em informado.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-reabertura-manual-test",
        "monitoring.engine.enabled=false", "notification.telegram.enabled=false", "notification.dispatcher.enabled=false"
})
class ReaberturaAposFechamentoManualPostgresIntegrationTest {

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
    @Autowired IncidenteService incidenteService;

    private Monitor monitor;
    private long operadorId;
    private Instant agora;

    @BeforeEach void preparar() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        operadorId = jdbc.queryForObject("insert into usuarios (nome, email, senha_hash, papel, ativo, "
                + "troca_senha_obrigatoria) values ('Operador', 'operador@reabertura.test', 'hash-irrelevante', "
                + "'OPERADOR', true, false) returning id", Long.class);

        Long unidadeId = unidades.criar(new CreateUnidadeRequest("Unidade Reabertura", "REA", null, null, null, null,
                null, null, null)).id();
        Long tipoId = tipos.criar(new CreateTipoEquipamentoRequest("Tipo Reabertura", null)).id();
        Long equipamentoId = equipamentoService.criar(new CreateEquipamentoRequest(unidadeId, tipoId,
                "Equipamento Reabertura", null, null, null, null, null, null, null)).id();
        Equipamento equipamento = equipamentoRepository.findById(equipamentoId).orElseThrow();

        monitor = monitorRepository.saveAndFlush(
                new Monitor(equipamento, TipoMonitor.ICMP, "Monitor Reabertura", 60, 2000, 3, 2));
        agora = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        abrirJanela(agora.minusSeconds(3600));
    }

    @Test
    void alvoForaDoArFechadoManualmenteSoReabreNaTerceiraFalhaNova() {
        Incidente aberto = abrirComTresFalhas();
        incidenteService.fechar(aberto.getId(), new CloseIncidenteRequest(Instant.now(), null), operadorId);

        Instant base = Instant.now().truncatedTo(ChronoUnit.MILLIS).plusSeconds(1);
        incidentProcessor.process(medicao(StatusMedicao.FALHA, base));
        assertThat(incidentesAbertos()).as("1a falha nova").isZero();
        incidentProcessor.process(medicao(StatusMedicao.FALHA, base.plusSeconds(30)));
        assertThat(incidentesAbertos()).as("2a falha nova").isZero();
        incidentProcessor.process(medicao(StatusMedicao.FALHA, base.plusSeconds(60)));
        assertThat(incidentesAbertos()).as("3a falha nova").isEqualTo(1);

        Incidente novo = incidenteRepository
                .findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(monitor.getId(), StatusIncidente.EM_ABERTO)
                .orElseThrow();
        assertThat(novo.getId()).isNotEqualTo(aberto.getId());
        assertThat(novo.getIniciadoEm()).isEqualTo(base);
    }

    @Test
    void fechamentoRetroativoNaoAntecipaReabertura() {
        Incidente aberto = abrirComTresFalhas();
        // encerradoEm retroativo: as 3 falhas que abriram ficam "depois" dele.
        incidenteService.fechar(aberto.getId(),
                new CloseIncidenteRequest(aberto.getIniciadoEm(), null), operadorId);

        incidentProcessor.process(medicao(StatusMedicao.FALHA,
                Instant.now().truncatedTo(ChronoUnit.MILLIS).plusSeconds(1)));

        assertThat(incidentesAbertos()).isZero();
    }

    private Incidente abrirComTresFalhas() {
        medicao(StatusMedicao.FALHA, agora.minusSeconds(90));
        medicao(StatusMedicao.FALHA, agora.minusSeconds(60));
        incidentProcessor.process(medicao(StatusMedicao.FALHA, agora.minusSeconds(30)));
        return incidenteRepository
                .findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(monitor.getId(), StatusIncidente.EM_ABERTO)
                .orElseThrow();
    }

    private long incidentesAbertos() {
        return jdbc.queryForObject("select count(*) from incidente where monitor_id = ? and status <> 'FECHADO'",
                Long.class, monitor.getId());
    }

    private Medicao medicao(StatusMedicao status, Instant executadoEm) {
        return medicaoRepository.saveAndFlush(new Medicao(monitor, status, null, null, executadoEm));
    }

    private void abrirJanela(Instant inicioEm) {
        janelaRepository.saveAndFlush(new JanelaMonitoramento(monitor, inicioEm, OrigemJanelaMonitoramento.PRECISA));
    }
}

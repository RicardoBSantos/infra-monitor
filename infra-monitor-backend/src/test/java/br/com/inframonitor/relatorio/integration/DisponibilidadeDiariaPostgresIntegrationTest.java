package br.com.inframonitor.relatorio.integration;

import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.medicao.entity.Medicao;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.relatorio.dto.DisponibilidadeDiariaUnidadeResponse;
import br.com.inframonitor.relatorio.entity.JanelaMonitoramento;
import br.com.inframonitor.relatorio.entity.OrigemJanelaMonitoramento;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import br.com.inframonitor.relatorio.service.DisponibilidadeSqlRepository;
import br.com.inframonitor.relatorio.service.RelatorioService;
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
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Serie diaria de disponibilidade (7.3). O ponto critico coberto aqui e a fronteira
 * do dia: os baldes seguem o calendario local, nao UTC.
 */
@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-test",
        "app.auth.jwt.access-token-minutes=15",
        "app.reports.timezone=America/Sao_Paulo",
        "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false"
})
class DisponibilidadeDiariaPostgresIntegrationTest {
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final ZoneId ZONA = ZoneId.of("America/Sao_Paulo");

    @Autowired private JdbcTemplate jdbc;
    @Autowired private UnidadeService unidades;
    @Autowired private TipoEquipamentoService tipos;
    @Autowired private EquipamentoService equipamentos;
    @Autowired private EquipamentoRepository equipamentoRepository;
    @Autowired private MonitorRepository monitorRepository;
    @Autowired private JanelaMonitoramentoRepository janelas;
    @Autowired private MedicaoRepository medicoes;
    @Autowired private IncidenteRepository incidentes;
    @Autowired private DisponibilidadeSqlRepository disponibilidadeSql;
    @Autowired private RelatorioService relatorios;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @BeforeEach
    void limparBanco() {
        jdbc.execute("truncate table janela_monitoramento, medicao, incidente, notificacao, monitor, equipamento, tipo_equipamento, unidade restart identity cascade");
    }

    /**
     * Incidente das 23:00 as 00:00 locais do dia 10 cai no dia 11 em UTC.
     * Com baldes locais ele tem de pesar no dia 10.
     */
    @Test
    void bucketizaPorDiaLocalMantendoIncidenteDeFimDeNoiteNoDiaCorreto() {
        Equipamento equipamento = criarEquipamento("fuso");
        long unidadeId = equipamento.getUnidade().getId();
        // 2026-02-10T00:00 ate 2026-02-12T00:00 no horario local (UTC-3).
        Monitor monitor = criarMonitorComJanela(equipamento, "M", "2026-02-10T03:00:00Z", "2026-02-12T03:00:00Z");
        medicao(monitor, "2026-02-10T03:00:00Z");
        incidente(monitor, "2026-02-11T02:00:00Z", "2026-02-11T03:00:00Z");

        List<DisponibilidadeDiariaUnidadeResponse> serie = disponibilidadeSql.diariaPorUnidade(
                Instant.parse("2026-02-10T03:00:00Z"), Instant.parse("2026-02-12T03:00:00Z"), unidadeId);

        assertThat(serie).extracting(DisponibilidadeDiariaUnidadeResponse::data)
                .containsExactly(LocalDate.parse("2026-02-10"), LocalDate.parse("2026-02-11"));
        assertThat(serie).allSatisfy(dia -> assertThat(dia.tempoMonitoradoSegundos()).isEqualTo(86_400));
        // (86400 - 3600) / 86400 no dia 10; dia 11 intacto.
        assertThat(serie.get(0).disponibilidadePercentual()).isEqualByComparingTo("95.83");
        assertThat(serie.get(1).disponibilidadePercentual()).isEqualByComparingTo("100.00");
    }

    @Test
    void omiteDiaSemMonitoramentoEmVezDeZerar() {
        Equipamento equipamento = criarEquipamento("lacuna");
        long unidadeId = equipamento.getUnidade().getId();
        Monitor monitor = criarMonitorComJanela(equipamento, "M", "2026-02-10T03:00:00Z", "2026-02-11T03:00:00Z");
        medicao(monitor, "2026-02-10T03:00:00Z");
        JanelaMonitoramento segunda = new JanelaMonitoramento(monitor, Instant.parse("2026-02-12T03:00:00Z"), OrigemJanelaMonitoramento.PRECISA);
        segunda.fechar(Instant.parse("2026-02-13T03:00:00Z"));
        janelas.saveAndFlush(segunda);
        medicao(monitor, "2026-02-12T03:00:00Z");

        List<DisponibilidadeDiariaUnidadeResponse> serie = disponibilidadeSql.diariaPorUnidade(
                Instant.parse("2026-02-10T03:00:00Z"), Instant.parse("2026-02-13T03:00:00Z"), unidadeId);

        assertThat(serie).extracting(DisponibilidadeDiariaUnidadeResponse::data)
                .containsExactly(LocalDate.parse("2026-02-10"), LocalDate.parse("2026-02-12"));
    }

    /** A janela do endpoint comeca a 00:00 local de D-29: so o ultimo dia pode ser parcial. */
    @Test
    void janelaDoEndpointCobre30DiasDeCalendarioComApenasOUltimoParcial() {
        Equipamento equipamento = criarEquipamento("janela");
        long unidadeId = equipamento.getUnidade().getId();
        Instant inicioJanela = ZonedDateTime.now(ZONA).toLocalDate().minusDays(40).atStartOfDay(ZONA).toInstant();
        Monitor monitor = monitorRepository.saveAndFlush(new Monitor(equipamento, TipoMonitor.ICMP, "M", 60, 1000));
        janelas.saveAndFlush(new JanelaMonitoramento(monitor, inicioJanela, OrigemJanelaMonitoramento.PRECISA));
        medicoes.saveAndFlush(new Medicao(monitor, StatusMedicao.SUCESSO, 1, null, inicioJanela));

        List<DisponibilidadeDiariaUnidadeResponse> serie = relatorios.disponibilidadeDiariaUnidade(unidadeId);

        LocalDate hoje = LocalDate.now(ZONA);
        assertThat(serie).isNotEmpty();
        assertThat(serie.getFirst().data()).isEqualTo(hoje.minusDays(29));
        assertThat(serie).hasSizeLessThanOrEqualTo(30);
        assertThat(serie).allSatisfy(dia -> assertThat(dia.data()).isBetween(hoje.minusDays(29), hoje));
        // Dias fechados sao integrais; apenas o dia corrente pode vir parcial.
        assertThat(serie.subList(0, serie.size() - 1))
                .allSatisfy(dia -> assertThat(dia.tempoMonitoradoSegundos()).isEqualTo(86_400));
        assertThat(serie.getLast().tempoMonitoradoSegundos()).isLessThanOrEqualTo(86_400);
    }

    private Equipamento criarEquipamento(String nome) {
        long unidade = unidades.criar(new CreateUnidadeRequest("Unidade " + nome, "U" + nome, null, null, null, null, null, null, null)).id();
        long tipo = tipos.criar(new CreateTipoEquipamentoRequest("Tipo " + nome, null)).id();
        long id = equipamentos.criar(new CreateEquipamentoRequest(unidade, tipo, "Equipamento " + nome, null, null, null, null, null, null, null)).id();
        return equipamentoRepository.findById(id).orElseThrow();
    }

    private Monitor criarMonitorComJanela(Equipamento e, String nome, String inicio, String fim) {
        Monitor monitor = monitorRepository.saveAndFlush(new Monitor(e, TipoMonitor.ICMP, nome, 60, 1000));
        JanelaMonitoramento janela = new JanelaMonitoramento(monitor, Instant.parse(inicio), OrigemJanelaMonitoramento.PRECISA);
        janela.fechar(Instant.parse(fim));
        janelas.saveAndFlush(janela);
        return monitor;
    }

    private void medicao(Monitor monitor, String em) {
        medicoes.saveAndFlush(new Medicao(monitor, StatusMedicao.SUCESSO, 1, null, Instant.parse(em)));
    }

    private void incidente(Monitor monitor, String inicio, String fim) {
        Incidente incidente = new Incidente(monitor, Instant.parse(inicio), "teste", null);
        incidente.fechar(Instant.parse(fim), null, null, MotivoEncerramentoIncidente.FECHAMENTO_MANUAL);
        incidentes.saveAndFlush(incidente);
    }
}

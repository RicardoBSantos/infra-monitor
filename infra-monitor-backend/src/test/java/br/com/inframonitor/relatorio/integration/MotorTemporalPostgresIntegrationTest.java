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
import br.com.inframonitor.monitor.dto.CreateMonitorRequest;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.monitor.service.MonitorService;
import br.com.inframonitor.relatorio.entity.JanelaMonitoramento;
import br.com.inframonitor.relatorio.entity.OrigemJanelaMonitoramento;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import br.com.inframonitor.relatorio.temporal.DisponibilidadeEquipamentoTemporalService;
import br.com.inframonitor.tipoequipamento.dto.CreateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.service.TipoEquipamentoService;
import br.com.inframonitor.unidade.dto.CreateUnidadeRequest;
import br.com.inframonitor.unidade.service.UnidadeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-test",
        "app.auth.jwt.access-token-minutes=15",
        "spring.main.allow-bean-definition-overriding=true",
        "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false",
        "notification.dispatcher.enabled=false"
})
@Import(MotorTemporalPostgresIntegrationTest.MutableClockConfiguration.class)
class MotorTemporalPostgresIntegrationTest {
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final MutableClock CLOCK = new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));

    @Autowired private JdbcTemplate jdbc;
    @Autowired private UnidadeService unidades;
    @Autowired private TipoEquipamentoService tipos;
    @Autowired private EquipamentoService equipamentos;
    @Autowired private EquipamentoRepository equipamentoRepository;
    @Autowired private MonitorService monitores;
    @Autowired private MonitorRepository monitorRepository;
    @Autowired private JanelaMonitoramentoRepository janelas;
    @Autowired private MedicaoRepository medicoes;
    @Autowired private IncidenteRepository incidentes;
    @Autowired private DisponibilidadeEquipamentoTemporalService disponibilidade;
    @Autowired private TransactionTemplate transacoes;

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
        CLOCK.set(Instant.parse("2026-01-01T00:00:00Z"));
    }

    @Test
    void cicloMonitorCriaAtivoNaoCriaInativoFechaReabreEPreservaHistorico() {
        Equipamento equipamento = criarEquipamento("monitor");
        Instant t0 = Instant.parse("2026-02-01T10:00:00Z");
        Instant t1 = Instant.parse("2026-02-01T11:00:00Z");
        Instant t2 = Instant.parse("2026-02-01T12:00:00Z");
        CLOCK.set(t0);
        long ativo = monitores.criar(new CreateMonitorRequest(equipamento.getId(), TipoMonitor.ICMP, "Ativo", 60, 1000, null, null)).id();
        CLOCK.set(t1);
        monitores.desativar(ativo);
        CLOCK.set(t2);
        monitores.ativar(ativo);

        List<JanelaMonitoramento> doAtivo = janelas.findAll().stream().filter(j -> j.getMonitor().getId().equals(ativo)).toList();
        assertThat(doAtivo).hasSize(2);
        assertThat(doAtivo.get(0).getInicioEm()).isEqualTo(t0);
        assertThat(doAtivo.get(0).getFimEm()).isEqualTo(t1);
        assertThat(doAtivo.get(1).getInicioEm()).isEqualTo(t2);
        assertThat(doAtivo.get(1).getFimEm()).isNull();
        assertThat(doAtivo).allMatch(j -> j.getOrigem() == OrigemJanelaMonitoramento.PRECISA);

        Monitor inativo = new Monitor(equipamento, TipoMonitor.ICMP, "Inativo", 60, 1000);
        inativo.setAtivo(false);
        monitorRepository.saveAndFlush(inativo);
        assertThat(janelas.findAll().stream().filter(j -> j.getMonitor().getId().equals(inativo.getId()))).isEmpty();
        assertThat(doAtivo.get(0).getFimEm()).isEqualTo(t1);
        assertThat(janelas.findAll().stream().filter(j -> j.getFimEm() == null)).hasSize(1);
    }

    @Test
    void cicloEquipamentoFechaTodosEReabreSomenteMonitoresAdministrativamenteAtivos() {
        Equipamento equipamento = criarEquipamento("equipamento");
        CLOCK.set(Instant.parse("2026-02-01T10:00:00Z"));
        long a = monitores.criar(new CreateMonitorRequest(equipamento.getId(), TipoMonitor.ICMP, "A", 60, 1000, null, null)).id();
        long b = monitores.criar(new CreateMonitorRequest(equipamento.getId(), TipoMonitor.ICMP, "B", 60, 1000, null, null)).id();
        Instant t1 = Instant.parse("2026-02-01T11:00:00Z");
        CLOCK.set(t1);
        equipamentos.desativar(equipamento.getId());
        assertThat(janelas.findAll().stream().filter(j -> j.getMonitor().getId().equals(a) || j.getMonitor().getId().equals(b)))
                .allMatch(j -> t1.equals(j.getFimEm()));

        Monitor monitorA = monitorRepository.findById(a).orElseThrow();
        Monitor monitorB = monitorRepository.findById(b).orElseThrow();
        monitorB.setAtivo(false);
        monitorRepository.saveAndFlush(monitorB);
        Instant t2 = Instant.parse("2026-02-01T12:00:00Z");
        CLOCK.set(t2);
        equipamentos.ativar(equipamento.getId());
        assertThat(monitorRepository.findById(a).orElseThrow().isAtivo()).isTrue();
        assertThat(monitorRepository.findById(b).orElseThrow().isAtivo()).isFalse();
        assertThat(janelas.findAll().stream().filter(j -> j.getMonitor().getId().equals(a) && j.getFimEm() == null).map(JanelaMonitoramento::getInicioEm)).containsExactly(t2);
        assertThat(janelas.findAll().stream().filter(j -> j.getMonitor().getId().equals(b) && j.getFimEm() == null)).isEmpty();
    }

    @Test
    void rollbackRealNaoPersisteStatusNemJanelaParcial() {
        Equipamento equipamento = criarEquipamento("rollback");
        CLOCK.set(Instant.parse("2026-02-01T10:00:00Z"));
        long monitorId = monitores.criar(new CreateMonitorRequest(equipamento.getId(), TipoMonitor.ICMP, "R", 60, 1000, null, null)).id();
        Instant inicioOriginal = janelas.findAll().getFirst().getInicioEm();
        CLOCK.set(Instant.parse("2026-02-01T11:00:00Z"));
        assertThatThrownBy(() -> transacoes.executeWithoutResult(status -> {
            monitores.desativar(monitorId);
            throw new IllegalStateException("falha controlada");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(monitorRepository.findById(monitorId).orElseThrow().isAtivo()).isTrue();
        List<JanelaMonitoramento> persistidas = janelas.findAll();
        assertThat(persistidas).hasSize(1);
        assertThat(persistidas.getFirst().getInicioEm()).isEqualTo(inicioOriginal);
        assertThat(persistidas.getFirst().getFimEm()).isNull();
    }

    @Test
    void semMonitoramentoEMultiplosMonitoresPermanecemResultadosIndependentes() {
        Equipamento semMonitor = criarEquipamento("sem-monitor");
        var sem = disponibilidade.calcular(semMonitor, Instant.parse("2026-02-01T10:00:00Z"), Instant.parse("2026-02-01T11:00:00Z"));
        assertThat(sem).singleElement().satisfies(r -> {
            assertThat(r.monitorId()).isNull(); assertThat(r.estadoAnalitico().name()).isEqualTo("SEM_MONITORAMENTO");
            assertThat(r.tempoMonitoradoSegundos()).isNull(); assertThat(r.tempoIndisponivelSegundos()).isNull(); assertThat(r.tempoDisponivelSegundos()).isNull(); assertThat(r.disponibilidadePercentual()).isNull(); assertThat(r.incidentes()).isZero(); assertThat(r.qualidadeJanela()).isNull();
        });
        Equipamento equipamento = criarEquipamento("dois");
        Monitor a = criarMonitorComJanela(equipamento, "A", "2026-02-01T10:00:00Z", "2026-02-01T11:00:00Z");
        Monitor b = criarMonitorComJanela(equipamento, "B", "2026-02-01T10:00:00Z", "2026-02-01T11:00:00Z");
        medicao(a, "2026-02-01T10:00:00Z"); medicao(b, "2026-02-01T10:00:00Z");
        incidente(b, "2026-02-01T10:00:00Z", "2026-02-01T10:30:00Z");
        var resultados = disponibilidade.calcular(equipamento, Instant.parse("2026-02-01T10:00:00Z"), Instant.parse("2026-02-01T11:00:00Z"));
        assertThat(resultados).hasSize(2);
        assertThat(resultados).extracting(r -> r.monitorId()).containsExactlyInAnyOrder(a.getId(), b.getId());
        assertThat(resultados).extracting(r -> r.disponibilidadePercentual()).containsExactlyInAnyOrder(new BigDecimal("100.00"), new BigDecimal("50.00"));
    }

    @Test
    void cenariosBPersistidoCPersistidoESemDadosUsamServicoReal() {
        Equipamento bEquipamento = criarEquipamento("B");
        Monitor b = criarMonitorComJanela(bEquipamento, "B", "2026-02-01T10:00:00Z", "2026-02-01T11:00:00Z");
        medicao(b, "2026-02-01T10:00:00Z");
        incidente(b, "2026-02-01T10:10:00Z", "2026-02-01T10:30:00Z");
        incidente(b, "2026-02-01T10:20:00Z", "2026-02-01T10:40:00Z");
        var rb = disponibilidade.calcular(bEquipamento, Instant.parse("2026-02-01T10:00:00Z"), Instant.parse("2026-02-01T11:00:00Z")).getFirst();
        assertThat(rb.tempoMonitoradoSegundos()).isEqualTo(3600); assertThat(rb.tempoIndisponivelSegundos()).isEqualTo(1800); assertThat(rb.tempoDisponivelSegundos()).isEqualTo(1800); assertThat(rb.disponibilidadePercentual()).isEqualByComparingTo("50.00"); assertThat(rb.incidentes()).isEqualTo(2);

        Equipamento cEquipamento = criarEquipamento("C");
        Monitor c = criarMonitorComJanela(cEquipamento, "C1", "2026-02-01T08:00:00Z", "2026-02-01T09:00:00Z");
        JanelaMonitoramento segunda = new JanelaMonitoramento(c, Instant.parse("2026-02-01T10:00:00Z"), OrigemJanelaMonitoramento.PRECISA);
        segunda.fechar(Instant.parse("2026-02-01T12:00:00Z"));
        janelas.saveAndFlush(segunda); medicao(c, "2026-02-01T08:00:00Z"); medicao(c, "2026-02-01T10:00:00Z"); incidente(c, "2026-02-01T08:30:00Z", "2026-02-01T10:30:00Z");
        var rc = disponibilidade.calcular(cEquipamento, Instant.parse("2026-02-01T08:00:00Z"), Instant.parse("2026-02-01T12:00:00Z")).getFirst();
        assertThat(rc.tempoMonitoradoSegundos()).isEqualTo(10800); assertThat(rc.tempoIndisponivelSegundos()).isEqualTo(3600); assertThat(rc.tempoDisponivelSegundos()).isEqualTo(7200); assertThat(rc.disponibilidadePercentual()).isEqualByComparingTo("66.67");

        Equipamento semDadosEquipamento = criarEquipamento("sem-dados");
        criarMonitorComJanela(semDadosEquipamento, "SD", "2026-02-01T10:00:00Z", "2026-02-01T11:00:00Z");
        var sd = disponibilidade.calcular(semDadosEquipamento, Instant.parse("2026-02-01T10:00:00Z"), Instant.parse("2026-02-01T11:00:00Z")).getFirst();
        assertThat(sd.estadoAnalitico().name()).isEqualTo("SEM_DADOS"); assertThat(sd.tempoMonitoradoSegundos()).isNull(); assertThat(sd.tempoIndisponivelSegundos()).isNull(); assertThat(sd.tempoDisponivelSegundos()).isNull(); assertThat(sd.disponibilidadePercentual()).isNull();
    }

    private Equipamento criarEquipamento(String nome) {
        long unidade = unidades.criar(new CreateUnidadeRequest("Unidade " + nome, "U" + nome.replaceAll("[^A-Za-z]", ""), null, null, null, null, null, null, null)).id();
        long tipo = tipos.criar(new CreateTipoEquipamentoRequest("Tipo " + nome, null)).id();
        long id = equipamentos.criar(new CreateEquipamentoRequest(unidade, tipo, "Equipamento " + nome, null, null, null, null, null, null, null)).id();
        return equipamentoRepository.findById(id).orElseThrow();
    }
    private Monitor criarMonitorComJanela(Equipamento e, String nome, String inicio, String fim) {
        Monitor monitor = monitorRepository.saveAndFlush(new Monitor(e, TipoMonitor.ICMP, nome, 60, 1000));
        JanelaMonitoramento janela = new JanelaMonitoramento(monitor, Instant.parse(inicio), OrigemJanelaMonitoramento.PRECISA);
        janela.fechar(Instant.parse(fim)); janelas.saveAndFlush(janela); return monitor;
    }
    private void medicao(Monitor monitor, String em) { medicoes.saveAndFlush(new Medicao(monitor, StatusMedicao.SUCESSO, 1, null, Instant.parse(em))); }
    private void incidente(Monitor monitor, String inicio, String fim) { Incidente incidente = new Incidente(monitor, Instant.parse(inicio), "teste", null); incidente.fechar(Instant.parse(fim), null, null, MotivoEncerramentoIncidente.FECHAMENTO_MANUAL); incidentes.saveAndFlush(incidente); }

    @TestConfiguration(proxyBeanMethods = false)
    static class MutableClockConfiguration { @Bean("monitoringClock") Clock monitoringClock() { return CLOCK; } }
    static class MutableClock extends Clock {
        private Instant instant; MutableClock(Instant instant) { this.instant = instant; }
        void set(Instant instant) { this.instant = instant; }
        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return instant; }
    }
}

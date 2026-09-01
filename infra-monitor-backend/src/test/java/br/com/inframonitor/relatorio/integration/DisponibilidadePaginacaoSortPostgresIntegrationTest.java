package br.com.inframonitor.relatorio.integration;

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
import br.com.inframonitor.relatorio.dto.DisponibilidadeEquipamentoResponse;
import br.com.inframonitor.relatorio.entity.JanelaMonitoramento;
import br.com.inframonitor.relatorio.entity.OrigemJanelaMonitoramento;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import br.com.inframonitor.relatorio.service.RelatorioService;
import br.com.inframonitor.relatorio.temporal.DisponibilidadeTemporalCalculator;
import br.com.inframonitor.relatorio.temporal.ResultadoDisponibilidadeTemporal;
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

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(properties = {"app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes", "app.auth.jwt.issuer=infra-monitor-test", "monitoring.engine.enabled=false", "notification.telegram.enabled=false", "notification.dispatcher.enabled=false"})
class DisponibilidadePaginacaoSortPostgresIntegrationTest {
    static final PostgreSQLContainer<?> DB = new PostgreSQLContainer<>("postgres:16-alpine");
    static final Instant BASE = Instant.parse("2026-05-01T00:00:00Z");
    @DynamicPropertySource static void db(DynamicPropertyRegistry r) { DB.start(); r.add("spring.datasource.url", DB::getJdbcUrl); r.add("spring.datasource.username", DB::getUsername); r.add("spring.datasource.password", DB::getPassword); }

    @Autowired JdbcTemplate jdbc; @Autowired UnidadeService unidades; @Autowired TipoEquipamentoService tipos;
    @Autowired EquipamentoService equipamentoService; @Autowired EquipamentoRepository equipamentos; @Autowired MonitorRepository monitores;
    @Autowired JanelaMonitoramentoRepository janelas; @Autowired MedicaoRepository medicoes; @Autowired IncidenteRepository incidentes; @Autowired RelatorioService relatorios;

    @BeforeEach void reset() { jdbc.execute("truncate table janela_monitoramento, medicao, incidente, notificacao, monitor, equipamento, tipo_equipamento, unidade restart identity cascade"); }

    @Test void cenariosBCSqlEMotorUsamMesmosDadosELacunaNaoEntra() {
        Instant b0 = at(10), b1 = at(11); Equipamento eb = equipamento("B", "B"); Monitor mb = monitor(eb, "B", b0, b1);
        medir(mb, b0); incidente(mb, at(10, 10), at(10, 30)); incidente(mb, at(10, 20), at(10, 40));
        DisponibilidadeEquipamentoResponse sqlB = equipamento(b0, b1, eb.getId(), "equipamentoNome,asc").getFirst();
        ResultadoDisponibilidadeTemporal motorB = motor(b0, b1, List.of(j(b0, b1, b0)), List.of(i(1, at(10, 10), at(10, 30)), i(2, at(10, 20), at(10, 40))));
        assertMetrics(sqlB, motorB, 3600, 1800, 1800, "50.00", 2);

        Instant c0 = at(8), c1 = at(12); Equipamento ec = equipamento("C", "C"); Monitor mc = monitor(ec, "C", at(8), at(9)); janela(mc, at(10), at(12));
        medir(mc, at(8)); medir(mc, at(10)); incidente(mc, at(8, 30), at(10, 30));
        DisponibilidadeEquipamentoResponse sqlC = equipamento(c0, c1, ec.getId(), "equipamentoNome,asc").getFirst();
        ResultadoDisponibilidadeTemporal motorC = motor(c0, c1, List.of(j(at(8), at(9), at(8)), j(at(10), at(12), at(10))), List.of(i(1, at(8, 30), at(10, 30))));
        assertMetrics(sqlC, motorC, 10800, 3600, 7200, "66.67", 1);
        assertThat(sqlC.tempoMonitoradoSegundos()).isEqualTo(3 * 3600L);
        assertThat(sqlC.tempoIndisponivelSegundos()).isEqualTo(3600L); // 09:00-10:00 is in neither union.
    }

    @Test void sortEquipamentosPorTemposEIncidentesAscEDesc() {
        Instant inicio = at(0), fim = at(3); criarLinha("M1", inicio, at(1), 0, 1); criarLinha("M2", inicio, at(2), 0, 1); criarLinha("M3", inicio, fim, 0, 1);
        assertThat(medidas(inicio, fim, "tempoMonitoradoSegundos,asc", true)).containsExactly(3600L, 7200L, 10800L);
        assertThat(medidas(inicio, fim, "tempoMonitoradoSegundos,desc", true)).containsExactly(10800L, 7200L, 3600L);

        reset(); criarLinha("I1", inicio, fim, 300, 1); criarLinha("I2", inicio, fim, 600, 1); criarLinha("I3", inicio, fim, 1800, 1);
        assertThat(medidas(inicio, fim, "tempoIndisponivelSegundos,asc", false)).containsExactly(300L, 600L, 1800L);
        assertThat(medidas(inicio, fim, "tempoIndisponivelSegundos,desc", false)).containsExactly(1800L, 600L, 300L);

        reset(); criarLinha("N1", inicio, fim, 100, 1); criarLinha("N3", inicio, fim, 100, 3); criarLinha("N2", inicio, fim, 100, 2);
        assertThat(equipamento(inicio, fim, null, "incidentes,asc").stream().map(DisponibilidadeEquipamentoResponse::incidentes)).containsExactly(1L, 2L, 3L);
        assertThat(equipamento(inicio, fim, null, "incidentes,desc").stream().map(DisponibilidadeEquipamentoResponse::incidentes)).containsExactly(3L, 2L, 1L);
    }

    @Test void sortUnidadesPorPercentualEquipamentosEIncidentesAscEDesc() {
        Instant inicio = at(0), fim = at(3); criarLinha("P99", inicio, fim, 108, 1); criarLinha("P91", inicio, fim, 972, 1); criarLinha("P75", inicio, fim, 2700, 1);
        assertThat(unidades(inicio, fim, "disponibilidadePercentual,asc").stream().map(x -> x.disponibilidadePercentual())).containsExactly(new BigDecimal("75.00"), new BigDecimal("91.00"), new BigDecimal("99.00"));
        assertThat(unidades(inicio, fim, "disponibilidadePercentual,desc").stream().map(x -> x.disponibilidadePercentual())).containsExactly(new BigDecimal("99.00"), new BigDecimal("91.00"), new BigDecimal("75.00"));

        reset(); unidadeComEquipamentos("E1", 1); unidadeComEquipamentos("E3", 3); unidadeComEquipamentos("E2", 2);
        assertThat(unidades(inicio, fim, "equipamentosTotal,asc").stream().map(x -> x.equipamentosTotal())).containsExactly(1L, 2L, 3L);
        assertThat(unidades(inicio, fim, "equipamentosTotal,desc").stream().map(x -> x.equipamentosTotal())).containsExactly(3L, 2L, 1L);

        reset(); criarLinha("Q0", inicio, fim, 0, 0); criarLinha("Q4", inicio, fim, 100, 4); criarLinha("Q2", inicio, fim, 100, 2);
        assertThat(unidades(inicio, fim, "incidentes,asc").stream().map(x -> x.incidentes())).containsExactly(0L, 2L, 4L);
        assertThat(unidades(inicio, fim, "incidentes,desc").stream().map(x -> x.incidentes())).containsExactly(4L, 2L, 0L);
    }

    @Test void nullsLastEMesmaMetricaTemOrdemDeterministica() {
        Instant inicio = at(0), fim = at(1); criarLinha("Calculado", inicio, fim, 0, 0);
        Equipamento semDados = equipamento("SemDados", "SemDados"); monitor(semDados, "SD", inicio, fim);
        equipamento("SemMonitor", "SemMonitor");
        var asc = equipamento(inicio, fim, null, "disponibilidadePercentual,asc"); var desc = equipamento(inicio, fim, null, "disponibilidadePercentual,desc");
        assertThat(asc.getFirst().estadoAnalitico().name()).isEqualTo("CALCULADO"); assertThat(desc.getFirst().estadoAnalitico().name()).isEqualTo("CALCULADO");
        assertThat(asc.subList(1, 3)).extracting(x -> x.estadoAnalitico().name()).containsExactly("SEM_DADOS", "SEM_MONITORAMENTO");
        assertThat(desc.subList(1, 3)).extracting(x -> x.estadoAnalitico().name()).containsExactly("SEM_DADOS", "SEM_MONITORAMENTO");

        reset(); criarLinha("Tie-B", inicio, fim, 0, 0); criarLinha("Tie-A", inicio, fim, 0, 0);
        var primeira = equipamento(inicio, fim, null, "disponibilidadePercentual,desc").stream().map(DisponibilidadeEquipamentoResponse::equipamentoId).toList();
        var segunda = equipamento(inicio, fim, null, "disponibilidadePercentual,desc").stream().map(DisponibilidadeEquipamentoResponse::equipamentoId).toList();
        assertThat(primeira).containsExactlyElementsOf(segunda);
        assertThat(equipamento(inicio, fim, 0, 1, "disponibilidadePercentual,desc").getFirst().equipamentoId()).isEqualTo(primeira.getFirst());
        assertThat(equipamento(inicio, fim, 1, 1, "disponibilidadePercentual,desc").getFirst().equipamentoId()).isEqualTo(primeira.get(1));
    }

    @Test void regressoesU2D1D2ESortInvalido() {
        Instant inicio = at(0), fim = at(10);
        long unidade = criarUnidade("U2"); Equipamento a = criarEquipamento(unidade, "A"), b = criarEquipamento(unidade, "B");
        criarMonitorComDados(a, "A", inicio, at(1), 0, 0); criarMonitorComDados(b, "B", at(1), fim, 3240, 1);
        var ponderada = unidades(inicio, fim, "unidadeNome,asc").getFirst(); assertThat(ponderada.tempoMonitoradoSegundos()).isEqualTo(36000L); assertThat(ponderada.tempoIndisponivelSegundos()).isEqualTo(3240L); assertThat(ponderada.tempoDisponivelSegundos()).isEqualTo(32760L); assertThat(ponderada.disponibilidadePercentual()).isEqualByComparingTo("91.00").isNotEqualByComparingTo("95.00");

        reset(); IntStream.range(0, 25).forEach(n -> criarLinha("D" + n, at(0), at(1), 0, 0));
        var p0 = equipamento(at(0), at(1), 0, 10, "equipamentoNome,asc"); var p1 = equipamento(at(0), at(1), 1, 10, "equipamentoNome,asc"); var p2 = equipamento(at(0), at(1), 2, 10, "equipamentoNome,asc");
        assertThat(p0).hasSize(10); assertThat(p1).hasSize(10); assertThat(p2).hasSize(5); assertThat(relatorios.disponibilidade(at(0), at(1), null, null, null, null, 0, 10, "equipamentoNome,asc").totalElements()).isEqualTo(25L);
        reset(); Instant d2Fim = at(0).plusSeconds(1000); int[] valores = {10,20,30,40,50,60,70,80,90,91,92,93,94,95,99}; for (int valor : valores) criarLinha("S" + valor, at(0), d2Fim, (100 - valor) * 10, 1);
        assertThat(equipamento(at(0), d2Fim, null, "disponibilidadePercentual,desc").stream().limit(5).map(x -> x.disponibilidadePercentual())).containsExactly(new BigDecimal("99.00"), new BigDecimal("95.00"), new BigDecimal("94.00"), new BigDecimal("93.00"), new BigDecimal("92.00"));
        assertThat(equipamento(at(0), d2Fim, null, "disponibilidadePercentual,asc").stream().limit(5).map(x -> x.disponibilidadePercentual())).containsExactly(new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("30.00"), new BigDecimal("40.00"), new BigDecimal("50.00"));
        assertThatThrownBy(() -> relatorios.disponibilidade(at(0), at(1), null, null, null, null, 0, 10, "campo,asc")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> relatorios.disponibilidade(at(0), at(1), null, null, null, null, 0, 10, "incidentes,sideways")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> relatorios.disponibilidade(at(0), at(1), null, null, null, null, 0, 10, "incidentes desc; drop table monitor,asc")).isInstanceOf(IllegalArgumentException.class);
    }

    private List<Long> medidas(Instant inicio, Instant fim, String sort, boolean monitorado) { return equipamento(inicio, fim, null, sort).stream().map(x -> monitorado ? x.tempoMonitoradoSegundos() : x.tempoIndisponivelSegundos()).toList(); }
    private List<DisponibilidadeEquipamentoResponse> equipamento(Instant inicio, Instant fim, Long equipamento, String sort) { return relatorios.disponibilidade(inicio, fim, null, equipamento, null, null, 0, 100, sort).content(); }
    private List<DisponibilidadeEquipamentoResponse> equipamento(Instant inicio, Instant fim, int page, int size, String sort) { return relatorios.disponibilidade(inicio, fim, null, null, null, null, page, size, sort).content(); }
    private List<br.com.inframonitor.relatorio.dto.DisponibilidadeUnidadeResponse> unidades(Instant inicio, Instant fim, String sort) { return relatorios.unidades(inicio, fim, null, 0, 100, sort).content(); }
    private Instant at(int h) { return BASE.plusSeconds(h * 3600L); } private Instant at(int h, int m) { return at(h).plusSeconds(m * 60L); }
    private Equipamento equipamento(String unidade, String nome) { return criarEquipamento(criarUnidade(unidade), nome); }
    private long criarUnidade(String nome) { return unidades.criar(new CreateUnidadeRequest("U" + nome, nome, null, null, null, null, null, null, null)).id(); }
    private Equipamento criarEquipamento(long unidade, String nome) { long tipo = tipos.criar(new CreateTipoEquipamentoRequest("T" + nome + System.nanoTime(), null)).id(); return equipamentos.findById(equipamentoService.criar(new CreateEquipamentoRequest(unidade, tipo, nome, null, null, null, null, null)).id()).orElseThrow(); }
    private Monitor monitor(Equipamento e, String nome, Instant inicio, Instant fim) { Monitor m = monitores.saveAndFlush(new Monitor(e, TipoMonitor.ICMP, nome, 60, 1000)); janela(m, inicio, fim); return m; }
    private void janela(Monitor m, Instant inicio, Instant fim) { JanelaMonitoramento j = new JanelaMonitoramento(m, inicio, OrigemJanelaMonitoramento.PRECISA); j.fechar(fim); janelas.saveAndFlush(j); }
    private void medir(Monitor m, Instant em) { medicoes.saveAndFlush(new Medicao(m, StatusMedicao.SUCESSO, 1, null, em)); }
    private void incidente(Monitor m, Instant inicio, Instant fim) { Incidente i = new Incidente(m, inicio, "x", null); i.fechar(fim, null); incidentes.saveAndFlush(i); }
    private void criarLinha(String nome, Instant inicio, Instant fim, int indisponivel, int quantidade) { Equipamento e = equipamento(nome, nome); criarMonitorComDados(e, nome, inicio, fim, indisponivel, quantidade); }
    private void criarMonitorComDados(Equipamento e, String nome, Instant inicio, Instant fim, int indisponivel, int quantidade) { Monitor m = monitor(e, nome, inicio, fim); medir(m, inicio); for (int n = 0; n < quantidade; n++) { Instant a = inicio.plusSeconds(n * 200L); incidente(m, a, a.plusSeconds(indisponivel / Math.max(quantidade, 1))); } }
    private void unidadeComEquipamentos(String nome, int quantidade) { long u = criarUnidade(nome); IntStream.range(0, quantidade).forEach(n -> criarEquipamento(u, nome + n)); }
    private DisponibilidadeTemporalCalculator.Janela j(Instant inicio, Instant fim, Instant primeira) { return new DisponibilidadeTemporalCalculator.Janela(inicio, fim, primeira, OrigemJanelaMonitoramento.PRECISA); }
    private DisponibilidadeTemporalCalculator.Incidente i(long id, Instant inicio, Instant fim) { return new DisponibilidadeTemporalCalculator.Incidente(id, inicio, fim); }
    private ResultadoDisponibilidadeTemporal motor(Instant inicio, Instant fim, List<DisponibilidadeTemporalCalculator.Janela> janelas, List<DisponibilidadeTemporalCalculator.Incidente> incidentes) { return DisponibilidadeTemporalCalculator.calcular(inicio, fim, janelas, incidentes); }
    private void assertMetrics(DisponibilidadeEquipamentoResponse sql, ResultadoDisponibilidadeTemporal motor, long monitorado, long indisponivel, long disponivel, String percentual, long quantidade) { assertThat(sql.tempoMonitoradoSegundos()).isEqualTo(monitorado).isEqualTo(motor.tempoMonitoradoSegundos()); assertThat(sql.tempoIndisponivelSegundos()).isEqualTo(indisponivel).isEqualTo(motor.tempoIndisponivelSegundos()); assertThat(sql.tempoDisponivelSegundos()).isEqualTo(disponivel).isEqualTo(motor.tempoDisponivelSegundos()); assertThat(sql.disponibilidadePercentual()).isEqualByComparingTo(percentual).isEqualByComparingTo(motor.disponibilidadePercentual()); assertThat(sql.incidentes()).isEqualTo(quantidade).isEqualTo(motor.incidentes()); }
}

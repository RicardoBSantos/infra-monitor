package br.com.inframonitor.relatorio.service;

import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.medicao.entity.Medicao;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.relatorio.dto.DisponibilidadeEquipamentoResponse;
import br.com.inframonitor.relatorio.dto.HistoricoIncidenteResponse;
import br.com.inframonitor.relatorio.entity.JanelaMonitoramento;
import br.com.inframonitor.relatorio.entity.OrigemJanelaMonitoramento;
import br.com.inframonitor.relatorio.exportacao.RelatorioExportService;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import br.com.inframonitor.security.UsuarioPrincipal;
import br.com.inframonitor.testsupport.RequerDocker;
import br.com.inframonitor.tipoequipamento.dto.CreateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.service.TipoEquipamentoService;
import br.com.inframonitor.unidade.dto.CreateUnidadeRequest;
import br.com.inframonitor.unidade.service.UnidadeService;
import br.com.inframonitor.usuario.entity.Papel;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A duracao de um incidente encerrado por manutencao termina no clique de alguem,
 * nao numa recuperacao medida. Quem le um relatorio precisa saber qual dos tres
 * caminhos (recuperacao automatica, fechamento manual, manutencao) encerrou o
 * incidente — daqui vem {@code motivo_encerramento} na projecao, na API e no CSV.
 *
 * <p>{@code disponibilidadeNaoFiltraIncidenteEncerradoPorManutencao} trava a decisao
 * consciente de NAO filtrar esse motivo no calculo de disponibilidade: a queda real
 * que motivou a manutencao continua contando, e quem exclui o periodo de manutencao
 * em si e a janela de monitoramento fechada, nao um filtro por motivo.
 */
@RequerDocker
@SpringBootTest(properties = {"app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-test", "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false", "notification.dispatcher.enabled=false"})
class RelatorioMotivoEncerramentoTest {
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    static final Instant INICIO = Instant.parse("2026-09-01T00:00:00Z");
    static final Instant FIM = Instant.parse("2026-09-01T10:00:00Z");

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry r) {
        POSTGRES.start();
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired UnidadeService unidades;
    @Autowired TipoEquipamentoService tipos;
    @Autowired EquipamentoService equipamentoService;
    @Autowired EquipamentoRepository equipamentos;
    @Autowired MonitorRepository monitores;
    @Autowired JanelaMonitoramentoRepository janelas;
    @Autowired MedicaoRepository medicoes;
    @Autowired IncidenteRepository incidentes;
    @Autowired RelatorioService relatorios;
    @Autowired RelatorioExportService exportService;

    @BeforeEach
    void limpar() {
        jdbc.execute("truncate table janela_monitoramento, medicao, incidente, notificacao, monitor, equipamento, tipo_equipamento, unidade restart identity cascade");
    }

    @Test
    void csvTrazMotivoEncerramentoNaUltimaColuna() throws Exception {
        Equipamento e = equipamento("CSV", "Roteador CSV");
        Monitor m = monitor(e, "M", INICIO, FIM);
        medir(m, INICIO);
        incidenteManutencao(m, INICIO.plusSeconds(3600), INICIO.plusSeconds(3900));

        var download = exportService.incidentes(INICIO, FIM, e.getUnidade().getId(), e.getId(), m.getId(),
                StatusIncidente.FECHADO, "", new UsuarioPrincipal(1L, Papel.ADMIN));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        download.body().writeTo(out);
        byte[] bytes = out.toByteArray();
        String csv = new String(bytes, 3, bytes.length - 3, StandardCharsets.UTF_8);

        String cabecalho = csv.lines().findFirst().orElseThrow();
        assertThat(cabecalho).endsWith("motivo_encerramento");
        // Coluna no FIM: nao ha consumidor externo, o sistema nao esta em producao,
        // mas mover coluna existente continua sendo gratuito de evitar.
        String primeiraLinha = csv.lines().skip(1).findFirst().orElseThrow();
        assertThat(primeiraLinha).endsWith(",MANUTENCAO");
    }

    @Test
    void historicoDeIncidentesExpoeOMotivoDeEncerramento() {
        Equipamento e = equipamento("HIST", "Roteador Historico");
        Monitor m = monitor(e, "M", INICIO, FIM);
        medir(m, INICIO);
        incidenteManutencao(m, INICIO.plusSeconds(3600), INICIO.plusSeconds(3900));

        var pagina = relatorios.incidentes(INICIO, FIM, e.getUnidade().getId(), e.getId(), m.getId(),
                StatusIncidente.FECHADO, 0, 20, "");
        assertThat(pagina.content()).hasSize(1);
        assertThat(pagina.content().getFirst().motivoEncerramento()).isEqualTo("MANUTENCAO");
    }

    /**
     * A janela fechada em FIM recorta o periodo de manutencao — nao um filtro em
     * cima de motivo_encerramento. A queda de 09:00 as 09:30, que foi o que motivou
     * a manutencao, ocorreu DENTRO da janela monitorada e continua contando na
     * disponibilidade do equipamento.
     */
    @Test
    void disponibilidadeNaoFiltraIncidenteEncerradoPorManutencao() {
        Equipamento e = equipamento("DISP", "Roteador Disponibilidade");
        Monitor m = monitor(e, "M", INICIO, FIM);
        medir(m, INICIO);
        Instant quedaInicio = INICIO.plusSeconds(9 * 3600);
        Instant quedaFim = quedaInicio.plusSeconds(1800);
        incidenteManutencao(m, quedaInicio, quedaFim);

        DisponibilidadeEquipamentoResponse resposta = relatorios
                .disponibilidade(INICIO, FIM, null, e.getId(), null, null, 0, 20, "equipamentoNome,asc")
                .content().getFirst();

        assertThat(resposta.tempoMonitoradoSegundos()).isEqualTo(10 * 3600L);
        // A queda real de 30 minutos continua contando, mesmo tendo sido encerrada por manutencao.
        assertThat(resposta.tempoIndisponivelSegundos()).isEqualTo(1800L);
        assertThat(resposta.disponibilidadePercentual()).isEqualByComparingTo(new BigDecimal("95.00"));
        assertThat(resposta.incidentes()).isEqualTo(1L);
    }

    private Equipamento equipamento(String unidade, String nome) {
        long u = unidades.criar(new CreateUnidadeRequest("Unidade " + unidade, unidade, null, null, null, null, null, null, null)).id();
        long t = tipos.criar(new CreateTipoEquipamentoRequest("Tipo " + unidade, null)).id();
        long id = equipamentoService.criar(new CreateEquipamentoRequest(u, t, nome, null, null, null, null, null, null, null)).id();
        return equipamentos.findById(id).orElseThrow();
    }

    private Monitor monitor(Equipamento e, String nome, Instant inicio, Instant fim) {
        Monitor m = monitores.saveAndFlush(new Monitor(e, TipoMonitor.ICMP, nome, 60, 1000));
        JanelaMonitoramento j = new JanelaMonitoramento(m, inicio, OrigemJanelaMonitoramento.PRECISA);
        j.fechar(fim);
        janelas.saveAndFlush(j);
        return m;
    }

    private void medir(Monitor m, Instant em) {
        medicoes.saveAndFlush(new Medicao(m, StatusMedicao.SUCESSO, 1, null, em));
    }

    private void incidenteManutencao(Monitor m, Instant inicio, Instant fim) {
        Incidente i = new Incidente(m, inicio, "queda que motivou a manutencao", null);
        i.fechar(fim, null, null, MotivoEncerramentoIncidente.MANUTENCAO);
        incidentes.saveAndFlush(i);
    }
}

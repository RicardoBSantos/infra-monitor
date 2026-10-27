package br.com.inframonitor.relatorio.integration;

import br.com.inframonitor.medicao.dto.CreateMedicaoRequest;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.service.MedicaoService;
import br.com.inframonitor.monitor.dto.CreateMonitorRequest;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.service.MonitorService;
import br.com.inframonitor.relatorio.dto.DisponibilidadeEquipamentoResponse;
import br.com.inframonitor.relatorio.service.DisponibilidadeSqlRepository;
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
import java.time.temporal.ChronoUnit;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A primeira medicao da janela (V24) pelos caminhos reais da aplicacao: o motor grava pelo
 * MedicaoService, o fechamento passa pelo Hibernate, e o SLA le so a coluna.
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
class PrimeiraMedicaoNaAplicacaoPostgresIntegrationTest {
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired private JdbcTemplate jdbc;
    @Autowired private MonitorService monitores;
    @Autowired private MedicaoService medicoes;
    @Autowired private DisponibilidadeSqlRepository disponibilidade;

    private long monitorId;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @BeforeEach
    void montarMonitorComJanelaAberta() {
        jdbc.execute("truncate table janela_monitoramento, medicao, incidente, notificacao, monitor, "
                + "equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        long tipo = jdbc.queryForObject("insert into tipo_equipamento (nome) values ('Switch') returning id", Long.class);
        long unidade = jdbc.queryForObject("insert into unidade (nome, sigla) values ('Sede', 'SEDE') returning id", Long.class);
        long equipamento = jdbc.queryForObject("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address) "
                + "values (?, ?, 'SW', '10.0.0.1') returning id", Long.class, unidade, tipo);
        // criar() abre a janela pelo CicloJanelaMonitoramentoService, com Instant.now() do relogio do motor.
        monitorId = monitores.criar(new CreateMonitorRequest(equipamento, TipoMonitor.ICMP, "ping", 60, 2000, null, null)).id();
    }

    @Test
    void medicaoPeloServicoRegistraAPrimeiraEOFechamentoPeloHibernateNaoApaga() {
        Instant primeira = Instant.now().truncatedTo(ChronoUnit.MICROS).plusSeconds(1);
        medicoes.criar(new CreateMedicaoRequest(monitorId, StatusMedicao.SUCESSO, 12, null, primeira));
        medicoes.criar(new CreateMedicaoRequest(monitorId, StatusMedicao.SUCESSO, 12, null, primeira.plusSeconds(60)));
        assertThat(primeiraDaJanela()).isEqualTo(primeira);

        monitores.desativar(monitorId);

        assertThat(jdbc.queryForObject("select fim_em is not null from janela_monitoramento where monitor_id = ?",
                Boolean.class, monitorId)).isTrue();
        assertThat(primeiraDaJanela()).as("update de todas as colunas do Hibernate nao pode regravar a coluna")
                .isEqualTo(primeira);
    }

    /** Pre-requisito de retencao: apagar o detalhe nao muda o SLA de um periodo ja medido. */
    @Test
    void slaNaoMudaQuandoAsMedicoesSaoApagadas() {
        Instant inicio = Instant.now().truncatedTo(ChronoUnit.MICROS).plusSeconds(1);
        for (int i = 0; i < 10; i++) {
            medicoes.criar(new CreateMedicaoRequest(monitorId, StatusMedicao.SUCESSO, 12, null, inicio.plusSeconds(60L * i)));
        }
        Instant fim = inicio.plusSeconds(3_600);
        List<DisponibilidadeEquipamentoResponse> antes = sla(inicio.minusSeconds(3_600), fim);
        assertThat(antes).singleElement().satisfies(l -> assertThat(l.tempoMonitoradoSegundos()).isPositive());

        jdbc.update("delete from medicao where monitor_id = ?", monitorId);

        assertThat(sla(inicio.minusSeconds(3_600), fim)).isEqualTo(antes);
    }

    private List<DisponibilidadeEquipamentoResponse> sla(Instant inicio, Instant fim) {
        return disponibilidade.equipamentos(inicio, fim, null, null, monitorId, null, 0, 20, "equipamento_nome ASC").content();
    }

    private Instant primeiraDaJanela() {
        Timestamp valor = jdbc.queryForObject("select primeira_medicao_em from janela_monitoramento where monitor_id = ?",
                Timestamp.class, monitorId);
        return valor == null ? null : valor.toInstant();
    }
}

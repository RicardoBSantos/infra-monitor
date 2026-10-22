package br.com.inframonitor.relatorio.service;

import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.monitor.service.MonitorService;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import br.com.inframonitor.testsupport.RequerDocker;
import br.com.inframonitor.tipoequipamento.dto.CreateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.service.TipoEquipamentoService;
import br.com.inframonitor.unidade.dto.CreateUnidadeRequest;
import br.com.inframonitor.unidade.service.UnidadeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Prova, na direcao de ABERTURA, do invariante da B.5: chamar
 * {@link CicloJanelaMonitoramentoService#abrirEquipamento} abre janela para um monitor
 * se e somente se aquele monitor e' candidato a execucao no momento da chamada —
 * equipamento.ativo AND monitor.ativo AND NOT equipamento.em_manutencao, a mesma
 * expressao do WHERE de {@link MonitorRepository#findActiveExecutionCandidates()}. A
 * matriz sempre chama {@code abrirEquipamento}, mesmo nos casos "nao candidato": prova
 * que um nao-candidato nao abre janela, nao que deixar de ser candidato fecha uma
 * janela ja aberta — essa segunda direcao e' coberta por outros testes (ex.:
 * {@code ativarEquipamentoEmManutencaoNaoAbreJanela} cobre um caso especifico, e o
 * fechamento em si e' exercido pelos testes de {@code CicloJanelaMonitoramentoService}).
 *
 * <p>Sobe um PostgreSQL real via Testcontainers porque o coracao da prova e' comparar
 * o estado persistido de janela_monitoramento com o resultado da query nativa/JPQL de
 * candidatos — nenhum mock exercita as duas pontas ao mesmo tempo.
 */
@RequerDocker
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-invariante-janela-test",
        "monitoring.engine.enabled=false", "notification.telegram.enabled=false", "notification.dispatcher.enabled=false"
})
class InvarianteJanelaTest {

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
    @Autowired MonitorService monitorService;
    @Autowired JanelaMonitoramentoRepository janelaRepository;
    @Autowired CicloJanelaMonitoramentoService cicloJanela;

    private Equipamento equipamento;
    private Monitor monitor;

    @BeforeEach void preparar() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, monitor_episodio_latencia, "
                + "incidente, monitor, equipamento, tipo_equipamento, unidade restart identity cascade");

        Long unidadeId = unidades.criar(new CreateUnidadeRequest("Unidade Invariante", "INV", null, null, null, null,
                null, null, null)).id();
        Long tipoId = tipos.criar(new CreateTipoEquipamentoRequest("Tipo Invariante", null)).id();
        Long equipamentoId = equipamentoService.criar(new CreateEquipamentoRequest(unidadeId, tipoId,
                "Equipamento Invariante", null, null, null, null, null, null, null)).id();
        equipamento = equipamentoRepository.findById(equipamentoId).orElseThrow();

        monitor = monitorRepository.saveAndFlush(new Monitor(equipamento, TipoMonitor.ICMP, "Monitor Invariante", 60, 2000));
    }

    @ParameterizedTest(name = "equipamento.ativo={0} monitor.ativo={1} emManutencao={2} -> janela aberta={3}")
    @CsvSource({
        "true,  true,  false, true",   // 1: unico caso observado
        "true,  true,  true,  false",  // 2: premissa 1 - nao se pinga, nao se mede
        "true,  false, false, false",  // 3
        "true,  false, true,  false",  // 4
        "false, true,  false, false",  // 5
        "false, true,  true,  false",  // 6
        "false, false, false, false",  // 7
        "false, false, true,  false"   // 8
    })
    void invarianteJanelaAbertaSseCandidatoAExecucao(boolean equipamentoAtivo, boolean monitorAtivo,
                                                      boolean emManutencao, boolean esperaJanelaAberta) {
        equipamento.setAtivo(equipamentoAtivo);
        equipamentoRepository.saveAndFlush(equipamento);
        // em_manutencao e updatable = false: so SQL escreve.
        jdbc.update("update equipamento set em_manutencao = ? where id = ?", emManutencao, equipamento.getId());
        monitor.setAtivo(monitorAtivo);
        monitorRepository.saveAndFlush(monitor);

        cicloJanela.abrirEquipamento(equipamento.getId());

        boolean temJanela = janelaRepository.aberta(monitor.getId()).isPresent();
        boolean eCandidato = monitorRepository.findActiveExecutionCandidates().stream()
                .anyMatch(c -> c.monitorId().equals(monitor.getId()));

        assertThat(temJanela).isEqualTo(esperaJanelaAberta);
        // O coracao do invariante: os dois lados tem de concordar SEMPRE.
        assertThat(temJanela).isEqualTo(eCandidato);
    }

    @Test
    void ativarEquipamentoEmManutencaoNaoAbreJanela() {
        equipamento.setAtivo(false);
        equipamentoRepository.saveAndFlush(equipamento);
        // em_manutencao e updatable = false: so SQL escreve.
        jdbc.update("update equipamento set em_manutencao = ? where id = ?", true, equipamento.getId());

        equipamentoService.ativar(equipamento.getId());

        assertThat(janelaRepository.aberta(monitor.getId())).isEmpty();
    }

    @Test
    void ativarMonitorDeEquipamentoEmManutencaoNaoAbreJanela() {
        equipamentoRepository.saveAndFlush(equipamento);
        // em_manutencao e updatable = false: so SQL escreve.
        jdbc.update("update equipamento set em_manutencao = ? where id = ?", true, equipamento.getId());
        monitor.setAtivo(false);
        monitorRepository.saveAndFlush(monitor);

        monitorService.ativar(monitor.getId());

        assertThat(janelaRepository.aberta(monitor.getId())).isEmpty();
    }
}

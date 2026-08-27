package br.com.inframonitor;

import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.dashboard.DashboardService;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.medicao.dto.CreateMedicaoRequest;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.medicao.service.MedicaoService;
import br.com.inframonitor.monitor.dto.CreateMonitorRequest;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.service.MonitorService;
import br.com.inframonitor.notificacao.dispatcher.NotificationDispatcher;
import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import br.com.inframonitor.notificacao.sender.SendResult;
import br.com.inframonitor.notificacao.telegram.TelegramClient;
import br.com.inframonitor.tipoequipamento.dto.CreateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.service.TipoEquipamentoService;
import br.com.inframonitor.unidade.dto.CreateUnidadeRequest;
import br.com.inframonitor.unidade.service.UnidadeService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Fluxo completo em PostgreSQL real, com Telegram falso: nenhuma chamada de rede
 * e nenhum ping real sao feitos por este teste.
 */
@EnabledIf("dockerDisponivel")
@SpringBootTest(properties = {
        "app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-test",
        "app.auth.jwt.access-token-minutes=15",
        "monitoring.engine.enabled=false",
        "notification.telegram.enabled=true",
        "notification.telegram.bot-token=test-token",
        "notification.telegram.chat-id=test-chat",
        "notification.dispatcher.enabled=true",
        "notification.dispatcher.poll-delay-ms=3600000"
})
@Import(BackendEndToEndIntegrationTest.FakeTelegramConfiguration.class)
class BackendEndToEndIntegrationTest {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired private UnidadeService unidadeService;
    @Autowired private TipoEquipamentoService tipoEquipamentoService;
    @Autowired private EquipamentoService equipamentoService;
    @Autowired private MonitorService monitorService;
    @Autowired private DashboardService dashboardService;
    @Autowired private MedicaoService medicaoService;
    @Autowired private IncidenteRepository incidenteRepository;
    @Autowired private NotificacaoRepository notificacaoRepository;
    @Autowired private NotificationDispatcher dispatcher;
    @Autowired private FakeTelegramClient telegramClient;

    static boolean dockerDisponivel() {
        return DockerClientFactory.instance().isDockerAvailable();
    }

    @DynamicPropertySource
    static void propriedadesDoBanco(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Test
    void percorreInventarioIncidenteNotificacaoTelegramFalsoERecovery() throws Exception {
        Long unidadeId = unidadeService.criar(new CreateUnidadeRequest("Matriz E2E", "E2E", null, "2800308", null, null, null, null, null)).id();
        Long tipoId = tipoEquipamentoService.criar(new CreateTipoEquipamentoRequest("Switch E2E", null)).id();
        Long equipamentoId = equipamentoService.criar(new CreateEquipamentoRequest(
                unidadeId, tipoId, "SW-CORE-E2E", "10.0.0.1", null, null, null)).id();
        Long monitorId = monitorService.criar(new CreateMonitorRequest(
                equipamentoId, TipoMonitor.ICMP, "ICMP principal", 60, 2_000, 3, 2)).id();

        Instant inicio = Instant.parse("2026-08-19T12:00:00Z");
        registrar(monitorId, StatusMedicao.FALHA, inicio);
        registrar(monitorId, StatusMedicao.FALHA, inicio.plusSeconds(60));
        registrar(monitorId, StatusMedicao.FALHA, inicio.plusSeconds(120));

        var incidenteAberto = incidenteRepository.findFirstByMonitorIdAndStatusOrderByIniciadoEmDescIdDesc(
                monitorId, StatusIncidente.ABERTO).orElseThrow();
        assertThat(incidenteAberto.getIniciadoEm()).isEqualTo(inicio);
        var resumoDuranteIncidente = dashboardService.resumo();
        assertThat(resumoDuranteIncidente.equipamentos().indisponiveis()).isEqualTo(1);
        assertThat(resumoDuranteIncidente.monitores().indisponiveis()).isEqualTo(1);
        assertThat(resumoDuranteIncidente.incidentes().abertos()).isEqualTo(1);
        Notificacao abertura = notificacao(incidenteAberto.getId(), TipoEventoNotificacao.INCIDENTE_ABERTO);
        assertThat(abertura.getStatus()).isEqualTo(StatusNotificacao.PENDENTE);

        dispatcher.submit(abertura.getId());
        assertThat(telegramClient.awaitMessages(1)).isTrue();
        assertThat(awaitStatus(abertura.getId(), StatusNotificacao.ENVIADA)).isTrue();

        registrar(monitorId, StatusMedicao.SUCESSO, inicio.plusSeconds(180));
        registrar(monitorId, StatusMedicao.SUCESSO, inicio.plusSeconds(240));

        var incidenteFechado = incidenteRepository.findFirstByMonitorIdAndStatusOrderByIniciadoEmDescIdDesc(
                monitorId, StatusIncidente.FECHADO).orElseThrow();
        assertThat(incidenteFechado.getEncerradoEm()).isEqualTo(inicio.plusSeconds(240));
        Notificacao recovery = notificacao(incidenteFechado.getId(), TipoEventoNotificacao.INCIDENTE_FECHADO);
        assertThat(recovery.getStatus()).isEqualTo(StatusNotificacao.PENDENTE);

        dispatcher.submit(recovery.getId());
        assertThat(telegramClient.awaitMessages(2)).isTrue();
        assertThat(awaitStatus(recovery.getId(), StatusNotificacao.ENVIADA)).isTrue();
        assertThat(telegramClient.messages()).hasSize(2)
                .allSatisfy(message -> assertThat(message).contains("SW-CORE-E2E"));
    }

    private void registrar(Long monitorId, StatusMedicao status, Instant executadoEm) {
        medicaoService.criar(new CreateMedicaoRequest(monitorId, status, null, null, executadoEm));
    }

    private Notificacao notificacao(Long incidenteId, TipoEventoNotificacao evento) {
        return notificacaoRepository.findByIncidenteId(incidenteId).stream()
                .filter(notificacao -> notificacao.getTipoEvento() == evento)
                .findFirst()
                .orElseThrow();
    }

    private boolean awaitStatus(Long notificacaoId, StatusNotificacao status) throws InterruptedException {
        long deadline = System.nanoTime() + 5_000_000_000L;
        while (System.nanoTime() < deadline) {
            if (notificacaoRepository.findById(notificacaoId).orElseThrow().getStatus() == status) {
                return true;
            }
            Thread.sleep(10);
        }
        return false;
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class FakeTelegramConfiguration {
        @Bean
        @Primary
        FakeTelegramClient fakeTelegramClient() {
            return new FakeTelegramClient();
        }
    }

    static class FakeTelegramClient implements TelegramClient {
        private final List<String> messages = new ArrayList<>();

        @Override
        public synchronized SendResult sendMessage(String message) {
            messages.add(message);
            notifyAll();
            return SendResult.sent();
        }

        synchronized boolean awaitMessages(int expected) throws InterruptedException {
            long deadline = System.nanoTime() + 5_000_000_000L;
            while (messages.size() < expected) {
                long remainingNanos = deadline - System.nanoTime();
                if (remainingNanos <= 0) {
                    return false;
                }
                wait(Math.max(1, remainingNanos / 1_000_000L));
            }
            return true;
        }

        synchronized List<String> messages() {
            return List.copyOf(messages);
        }
    }
}

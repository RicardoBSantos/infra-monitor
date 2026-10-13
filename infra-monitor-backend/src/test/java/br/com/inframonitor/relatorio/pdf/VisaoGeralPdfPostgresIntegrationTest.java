package br.com.inframonitor.relatorio.pdf;

import br.com.inframonitor.testsupport.RequerDocker;
import br.com.inframonitor.usuario.entity.Papel;
import br.com.inframonitor.usuario.entity.Usuario;
import br.com.inframonitor.usuario.repository.UsuarioRepository;
import br.com.inframonitor.security.UsuarioPrincipal;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

@RequerDocker
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.auth.jwt.secret=test-only-pdf-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-pdf-test", "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false", "notification.dispatcher.enabled=false"
})
class VisaoGeralPdfPostgresIntegrationTest {
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant INICIO = Instant.parse("2026-08-01T00:00:00Z");
    private static final Instant FIM = Instant.parse("2026-08-26T00:00:00Z");
    private static final String PASSWORD = "senha-pdf-teste-segura";
    private static final Pattern TOKEN = Pattern.compile("\"accessToken\"\\s*:\\s*\"([^\"]+)\"");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        POSTGRES.start();
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired UsuarioRepository usuarios;
    @Autowired PasswordEncoder encoder;
    @Autowired VisaoGeralPdfService pdfService;
    @Autowired NamedParameterJdbcTemplate namedJdbc;

    @BeforeEach
    void setup() {
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        Long tipoId = jdbc.queryForObject("insert into tipo_equipamento(nome,slug) values ('Roteador','roteador') returning id", Long.class);
        for (int index = 1; index <= 25; index++) {
            boolean unicode = index == 21;
            String unidade = unicode ? "Unidade São José" : String.format("Unidade %02d", index);
            String equipamento = unicode ? "Produção" : String.format("Equipamento %02d", index);
            String monitor = unicode ? "Monitoração" : String.format("Monitor %02d", index);
            Long unidadeId = jdbc.queryForObject("insert into unidade(nome,sigla) values (?,?) returning id", Long.class,
                    unidade, "U" + index);
            Long equipamentoId = jdbc.queryForObject("insert into equipamento(unidade_id,tipo_equipamento_id,nome) values (?,?,?) returning id",
                    Long.class, unidadeId, tipoId, equipamento);
            Long monitorId = jdbc.queryForObject("insert into monitor(equipamento_id,tipo,nome,intervalo_segundos,timeout_ms) values (?,'ICMP',?,60,1000) returning id",
                    Long.class, equipamentoId, monitor);
            jdbc.update("insert into janela_monitoramento(monitor_id,inicio_em,fim_em,origem) values (?,?,?,'PRECISA')",
                    monitorId, Timestamp.from(INICIO), Timestamp.from(FIM));
            jdbc.update("insert into medicao(monitor_id,status,latencia_ms,mensagem,executado_em) values (?,'SUCESSO',?,null,?)",
                    monitorId, 10 + index, Timestamp.from(INICIO));
            jdbc.update("insert into medicao(monitor_id,status,latencia_ms,mensagem,executado_em) values (?,'FALHA',null,null,?)",
                    monitorId, Timestamp.from(INICIO.plusSeconds(index)));
            long incidentHour = index <= 20 ? 23 : index - 20;
            Long incidentId = jdbc.queryForObject("insert into incidente(monitor_id,status,iniciado_em,motivo) values (?,'ABERTO',?,'falha') returning id",
                    Long.class, monitorId, Timestamp.from(INICIO.plusSeconds(incidentHour * 3600)));
            jdbc.update("insert into notificacao(incidente_id,canal,tipo_evento,status,tentativas,mensagem,erro,created_at) values (?,'TELEGRAM','INCIDENTE_ABERTO','FALHA',1,'mensagem','erro seguro',?)",
                    incidentId, Timestamp.from(INICIO.plusSeconds(index * 60L)));
            if (unicode) {
                for (int latency = 20; latency <= 100; latency += 10) {
                    jdbc.update("insert into medicao(monitor_id,status,latencia_ms,mensagem,executado_em) values (?,'SUCESSO',?,null,?)",
                            monitorId, latency, Timestamp.from(INICIO.plusSeconds(latency * 10L)));
                }
            }
        }
        String hash = encoder.encode(PASSWORD);
        for (Papel papel : Papel.values()) usuarios.saveAndFlush(new Usuario(papel.name(),
                papel.name().toLowerCase() + "@pdf.test", hash, papel, false));
        usuarios.saveAndFlush(new Usuario("Troca", "troca@pdf.test", hash, Papel.VISUALIZADOR, true));
        usuarios.saveAndFlush(new Usuario("Inativo", "inativo@pdf.test", hash, Papel.VISUALIZADOR, false));
    }

    @Test
    void pdfUsaUniversoGlobalMaiorQuePaginaEPreservaAnaliticaUnicodeEP95Postgres() throws Exception {
        HttpResponse<byte[]> response = get(periodPath(INICIO, FIM), login("admin@pdf.test"));
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Content-Type").orElse("")).isEqualTo("application/pdf");
        assertThat(response.headers().firstValue("Content-Disposition").orElse("")).contains(
                "attachment", "filename=\"visao-geral_2026-08-01_2026-08-26.pdf\"",
                "filename*=UTF-8''visao-geral_2026-08-01_2026-08-26.pdf");
        assertThat(response.body()).startsWith("%PDF".getBytes(StandardCharsets.US_ASCII));
        assertThat(response.body().length).isGreaterThan(1_000);
        try (PDDocument document = Loader.loadPDF(response.body())) {
            assertThat(document.getNumberOfPages()).isGreaterThanOrEqualTo(1);
            String text = new PDFTextStripper().getText(document);
            assertThat(text).contains("Visão Geral", "01/08/2026 00:00:00 UTC", "26/08/2026 00:00:00 UTC",
                    "Incidentes abertos", "Medições com falha", "Notificações com falha", "25",
                    "Unidade São José", "Produção", "Monitoração", "CALCULADO", "PRECISA",
                    "Latência por Monitor", "96 ms", "NULLS LAST", "SEM_DADOS", "SEM_MONITORAMENTO", "INFERIDA");
            assertThat(text).doesNotContain("null", "undefined", "NaN", "Authorization", "Bearer", "JWT_SECRET",
                    "senhaHash", "Telegram token", "stack trace");
        }
    }

    @Test
    void rbacCompletoEContaInativa() throws Exception {
        for (String email : new String[]{"admin@pdf.test", "operador@pdf.test", "visualizador@pdf.test"})
            assertThat(get(periodPath(INICIO, FIM), login(email)).statusCode()).isEqualTo(200);
        assertJson(get(periodPath(INICIO, FIM), null), 401, "UNAUTHORIZED");
        assertJson(get(periodPath(INICIO, FIM), login("troca@pdf.test")), 403, "PASSWORD_CHANGE_REQUIRED");
        String inactiveToken = login("inativo@pdf.test");
        jdbc.update("update usuarios set ativo=false where email='inativo@pdf.test'");
        assertJson(get(periodPath(INICIO, FIM), inactiveToken), 401, "UNAUTHORIZED");
    }

    /**
     * O caso que o bug passou. A tela contava incidentes chamando o endpoint paginado com
     * status=ABERTO fixo, e um incidente RECONHECIDO — que continua em aberto — sumia do KPI.
     * O teste fixa as tres coisas ao mesmo tempo: o indicador conta 25, o PDF do mesmo periodo
     * imprime 25, e o caminho antigo devolve 24 — a divergencia que nao pode voltar.
     */
    @Test
    void indicadoresContamReconhecidoEBatemComOPdfEnquantoOEndpointPaginadoNao() throws Exception {
        String token = login("admin@pdf.test");
        jdbc.update("update incidente set status='RECONHECIDO' where id=(select min(id) from incidente)");

        HttpResponse<byte[]> indicadores = getPath("/api/v1/relatorios/visao-geral/indicadores",
                periodPath(INICIO, FIM), token);
        assertThat(indicadores.statusCode()).isEqualTo(200);
        assertThat(body(indicadores)).contains("\"incidentesAbertos\":25", "\"medicoesComFalha\":25",
                "\"notificacoesComFalha\":25");

        try (PDDocument document = Loader.loadPDF(get(periodPath(INICIO, FIM), token).body())) {
            assertThat(new PDFTextStripper().getText(document)).contains("Incidentes abertos", "25");
        }

        assertThat(body(getPath("/api/v1/relatorios/incidentes",
                periodPath(INICIO, FIM) + "&status=ABERTO&size=1", token))).contains("\"totalElements\":24");
        assertThat(body(getPath("/api/v1/relatorios/incidentes",
                periodPath(INICIO, FIM) + "&status=RECONHECIDO&size=1", token))).contains("\"totalElements\":1");
    }

    @Test
    void indicadoresExigemAutenticacaoEValidamOMesmoTetoDe31Dias() throws Exception {
        String path = "/api/v1/relatorios/visao-geral/indicadores";
        assertJson(getPath(path, periodPath(INICIO, FIM), null), 401, "UNAUTHORIZED");
        for (String email : new String[]{"admin@pdf.test", "operador@pdf.test", "visualizador@pdf.test"})
            assertThat(getPath(path, periodPath(INICIO, FIM), login(email)).statusCode()).isEqualTo(200);
        String token = login("admin@pdf.test");
        assertJson(getPath(path, periodPath(FIM, INICIO), token), 400, "INVALID_REQUEST");
        assertJson(getPath(path, periodPath(INICIO, INICIO.plusSeconds(31L * 86400 + 1)), token), 400,
                "INVALID_REQUEST");
    }

    @Test
    void validaPeriodoEDevolveErrosJsonSemPdf() throws Exception {
        String token = login("admin@pdf.test");
        assertJson(get("?fim=" + FIM, token), 400, null);
        assertJson(get("?inicio=" + INICIO, token), 400, null);
        assertJson(get(periodPath(FIM, INICIO), token), 400, "INVALID_REQUEST");
        assertThat(get(periodPath(INICIO, INICIO), token).statusCode()).isEqualTo(200);
        assertJson(get(periodPath(INICIO, INICIO.plusSeconds(31L * 86400 + 1)), token), 400, "INVALID_REQUEST");
    }

    @Test
    void benchmarkWarmRegistraConsultasGeracaoTotalBytesMemoriaEPaginas() throws Exception {
        VisaoGeralPdfService.Download warmup = pdfService.exportar(INICIO, FIM, new UsuarioPrincipal(1L, Papel.ADMIN));
        assertThat(warmup.bytes()).isNotEmpty();
        for (int run = 1; run <= 3; run++) {
            long memoryBefore = usedMemory();
            VisaoGeralPdfService.Download response = pdfService.exportar(INICIO, FIM,
                    new UsuarioPrincipal(1L, Papel.ADMIN));
            long memory = Math.max(0, usedMemory() - memoryBefore);
            try (PDDocument document = Loader.loadPDF(response.bytes())) {
                System.out.printf("R04.4 BENCHMARK warm=%d massa=25-unidades-59-medicoes consultasMs=%d geracaoMs=%d totalMs=%d bytes=%d memoriaAproximadaBytes=%d paginas=%d linhasTabelas=15%n",
                        run, response.consultasMillis(), response.geracaoMillis(), response.totalMillis(),
                        response.bytes().length, memory, document.getNumberOfPages());
            }
            assertThat(response.bytes()).startsWith("%PDF".getBytes(StandardCharsets.US_ASCII));
        }
    }

    @Test
    void explainAnalyzeBuffersDasConsultasNovas() {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("inicio", Timestamp.from(INICIO)).addValue("fim", Timestamp.from(FIM))
                .addValue("unidadeId", null).addValue("equipamentoId", null)
                .addValue("monitorId", null).addValue("tipoId", null);
        explain("KPIS", VisaoGeralPdfRepository.KPIS, parameters);
        explain("TOP_UNIDADES", br.com.inframonitor.relatorio.service.DisponibilidadeSqlRepository.BASE + " " +
                br.com.inframonitor.relatorio.service.DisponibilidadeSqlRepository.UNIDADES +
                " order by disponibilidade asc nulls last, unidade_nome asc, unidade_id asc limit 5", parameters);
        explain("TOP_EQUIPAMENTOS", br.com.inframonitor.relatorio.service.DisponibilidadeSqlRepository.BASE +
                " select * from linhas order by disponibilidade asc nulls last, equipamento_nome asc, equipamento_id asc, " +
                "monitor_nome asc nulls last, monitor_id asc nulls last limit 5", parameters);
        explain("LATENCIA", VisaoGeralPdfRepository.LATENCIA, parameters);
    }

    private void explain(String name, String sql, MapSqlParameterSource parameters) {
        java.util.List<String> plan = namedJdbc.queryForList("explain (analyze, buffers, format text) " + sql,
                parameters, String.class);
        assertThat(plan).anyMatch(line -> line.contains("Execution Time"));
        System.out.println("R04.4 EXPLAIN " + name + System.lineSeparator() + String.join(System.lineSeparator(), plan));
    }

    private HttpResponse<byte[]> get(String query, String token) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + port +
                "/api/v1/relatorios/visao-geral/export/pdf" + query)).GET();
        if (token != null) request.header("Authorization", "Bearer " + token);
        return HttpClient.newHttpClient().send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private HttpResponse<byte[]> getPath(String path, String query, String token) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path + query))
                .GET();
        if (token != null) request.header("Authorization", "Bearer " + token);
        return HttpClient.newHttpClient().send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
    }

    private static String body(HttpResponse<byte[]> response) {
        return new String(response.body(), StandardCharsets.UTF_8);
    }

    private String login(String email) throws Exception {
        String json = "{\"email\":\"" + email + "\",\"senha\":\"" + PASSWORD + "\"}";
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/auth/login"))
                .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(json)).build();
        String body = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString()).body();
        Matcher matcher = TOKEN.matcher(body); assertThat(matcher.find()).isTrue(); return matcher.group(1);
    }

    private static String periodPath(Instant inicio, Instant fim) { return "?inicio=" + inicio + "&fim=" + fim; }
    private static void assertJson(HttpResponse<byte[]> response, int status, String code) {
        assertThat(response.statusCode()).isEqualTo(status);
        assertThat(response.headers().firstValue("Content-Type").orElse("")).contains("application/json");
        String text = new String(response.body(), StandardCharsets.UTF_8);
        if (code != null) assertThat(text).contains("\"code\":\"" + code + "\"");
        assertThat(text).doesNotContain("stackTrace", "%PDF");
    }
    private static long usedMemory() { Runtime runtime = Runtime.getRuntime(); return runtime.totalMemory() - runtime.freeMemory(); }
}

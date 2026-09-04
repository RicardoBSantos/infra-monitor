package br.com.inframonitor.relatorio.exportacao;

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
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.Notificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import br.com.inframonitor.relatorio.entity.JanelaMonitoramento;
import br.com.inframonitor.relatorio.entity.OrigemJanelaMonitoramento;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import br.com.inframonitor.tipoequipamento.dto.CreateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.service.TipoEquipamentoService;
import br.com.inframonitor.unidade.dto.CreateUnidadeRequest;
import br.com.inframonitor.unidade.service.UnidadeService;
import br.com.inframonitor.usuario.entity.Papel;
import br.com.inframonitor.usuario.entity.Usuario;
import br.com.inframonitor.usuario.repository.UsuarioRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.auth.jwt.secret=test-only-export-jwt-secret-with-at-least-32-bytes",
        "app.auth.jwt.issuer=infra-monitor-export-test", "monitoring.engine.enabled=false",
        "notification.telegram.enabled=false", "notification.dispatcher.enabled=false"
})
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class RelatorioExportPostgresIntegrationTest {
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant INICIO = Instant.parse("2026-08-01T00:00:00Z");
    private static final Instant FIM = Instant.parse("2026-08-01T23:59:59Z");
    private static final String PASSWORD = "senha-export-teste-segura";
    private static final Pattern TOKEN = Pattern.compile("\"accessToken\"\\s*:\\s*\"([^\"]+)\"");
    private static final byte[] BOM = {(byte)0xef,(byte)0xbb,(byte)0xbf};

    @DynamicPropertySource static void database(DynamicPropertyRegistry registry){
        POSTGRES.start();registry.add("spring.datasource.url",POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username",POSTGRES::getUsername);registry.add("spring.datasource.password",POSTGRES::getPassword);
    }

    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired UnidadeService unidades;
    @Autowired TipoEquipamentoService tipos;
    @Autowired EquipamentoService equipamentosService;
    @Autowired EquipamentoRepository equipamentos;
    @Autowired MonitorRepository monitores;
    @Autowired JanelaMonitoramentoRepository janelas;
    @Autowired MedicaoRepository medicoes;
    @Autowired IncidenteRepository incidentes;
    @Autowired NotificacaoRepository notificacoes;
    @Autowired UsuarioRepository usuarios;
    @Autowired PasswordEncoder encoder;
    private Long unidadeId,equipamentoId,monitorId,tipoId,incidenteId;

    @BeforeEach void setup(){
        jdbc.execute("truncate table janela_monitoramento, medicao, notificacao, incidente, monitor, equipamento, tipo_equipamento, unidade, usuarios restart identity cascade");
        unidadeId=unidades.criar(new CreateUnidadeRequest("Unidade São José", "SJ", null, null, null, null, null, null, null)).id();
        tipoId=tipos.criar(new CreateTipoEquipamentoRequest("Roteador",null)).id();
        equipamentoId=equipamentosService.criar(new CreateEquipamentoRequest(unidadeId,tipoId,"Equipamento, Principal",null,null,null,null, null, null, null)).id();
        Equipamento equipamento=equipamentos.findById(equipamentoId).orElseThrow();
        Monitor monitor=monitores.saveAndFlush(new Monitor(equipamento,TipoMonitor.ICMP,"Monitor \"ICMP\"",60,1000));monitorId=monitor.getId();
        JanelaMonitoramento janela=new JanelaMonitoramento(monitor,INICIO,OrigemJanelaMonitoramento.PRECISA);janela.fechar(FIM);janelas.saveAndFlush(janela);
        medicoes.saveAndFlush(new Medicao(monitor,StatusMedicao.SUCESSO,25,null,INICIO.plusSeconds(60)));
        Incidente incidente=new Incidente(monitor,INICIO.plusSeconds(120),"=1+1","linha 1\nlinha 2");incidente.fechar(INICIO.plusSeconds(180),null,null);incidenteId=incidentes.saveAndFlush(incidente).getId();
        Notificacao notificacao=notificacoes.saveAndFlush(new Notificacao(incidente,CanalNotificacao.TELEGRAM,TipoEventoNotificacao.INCIDENTE_ABERTO,"mensagem fora do CSV"));
        jdbc.update("update notificacao set created_at=? where id=?",java.sql.Timestamp.from(INICIO.plusSeconds(150)),notificacao.getId());
        String hash=encoder.encode(PASSWORD);
        for(Papel papel:Papel.values())usuarios.saveAndFlush(new Usuario(papel.name(),papel.name().toLowerCase()+"@export.test",hash,papel,false));
        usuarios.saveAndFlush(new Usuario("Troca","troca@export.test",hash,Papel.VISUALIZADOR,true));
        usuarios.saveAndFlush(new Usuario("Inativo","inativo@export.test",hash,Papel.VISUALIZADOR,false));
    }

    @Test @Order(1) void seisEndpointsRetornamCsvComContratoFiltrosESort() throws Exception {
        String token=login("admin@export.test");
        List<Expected> endpoints=List.of(
                new Expected("/disponibilidade/equipamentos/export?unidadeId="+unidadeId+"&sort=equipamentoNome,asc","unidade_id,unidade_nome,equipamento_id,equipamento_nome,monitor_id,monitor_nome,tipo_monitor,inicio,fim,estado_analitico,qualidade_janela,tempo_monitorado_segundos,tempo_indisponivel_segundos,tempo_disponivel_segundos,disponibilidade_percentual,incidentes","disponibilidade-equipamentos_2026-08-01_2026-08-01.csv"),
                new Expected("/disponibilidade/unidades/export?unidadeId="+unidadeId,"unidade_id,unidade_nome,inicio,fim,estado_analitico,equipamentos_total,equipamentos_monitorados,equipamentos_sem_monitoramento,equipamentos_sem_dados,tempo_monitorado_segundos,tempo_indisponivel_segundos,tempo_disponivel_segundos,disponibilidade_percentual,incidentes","disponibilidade-unidades_2026-08-01_2026-08-01.csv"),
                new Expected("/incidentes/export?monitorId="+monitorId+"&status=FECHADO","incidente_id,unidade_id,unidade_nome,equipamento_id,equipamento_nome,monitor_id,monitor_nome,tipo_monitor,status,iniciado_em,encerrado_em,duracao_segundos_no_periodo,motivo,observacao","incidentes_2026-08-01_2026-08-01.csv"),
                new Expected("/medicoes/export?monitorId="+monitorId+"&status=SUCESSO&sort=executadoEm,desc","medicao_id,unidade_id,unidade_nome,equipamento_id,equipamento_nome,monitor_id,monitor_nome,tipo_monitor,status,latencia_ms,executado_em","medicoes_2026-08-01_2026-08-01.csv"),
                new Expected("/latencia/export?monitorId="+monitorId,"unidade_id,unidade_nome,equipamento_id,equipamento_nome,monitor_id,monitor_nome,inicio,fim,min_latencia_ms,avg_latencia_ms,max_latencia_ms,p95_latencia_ms,amostras","latencia_2026-08-01_2026-08-01.csv"),
                new Expected("/notificacoes/export?incidenteId="+incidenteId+"&status=PENDENTE&canal=TELEGRAM&tipoEvento=INCIDENTE_ABERTO","notificacao_id,incidente_id,tipo_evento,canal,status,tentativas,created_at,enviado_em","notificacoes_2026-08-01_2026-08-01.csv"));
        for(Expected expected:endpoints){
            HttpResponse<byte[]> response=get(expected.path(),token);
            assertThat(response.statusCode()).as(expected.path()).isEqualTo(200);
            assertThat(response.headers().firstValue("Content-Type").orElse("")).startsWith("text/csv").containsIgnoringCase("UTF-8");
            String disposition=response.headers().firstValue("Content-Disposition").orElse("");
            assertThat(disposition).contains("attachment", "filename=\""+expected.filename()+"\"", "filename*=UTF-8''"+expected.filename());
            assertThat(response.headers().firstValue("Cache-Control").orElse("")).contains("no-store");
            assertThat(Arrays.copyOf(response.body(),3)).containsExactly(BOM);
            String csv=new String(response.body(),3,response.body().length-3,StandardCharsets.UTF_8);
            assertThat(csv).startsWith(expected.header()+"\r\n");
            if(!expected.path().startsWith("/notificacoes"))assertThat(csv).contains("São José");
            if(expected.path().startsWith("/incidentes"))assertThat(csv).contains("'=1+1", "\"linha 1\nlinha 2\"");
            if(expected.path().startsWith("/notificacoes"))assertThat(csv).doesNotContain("mensagem fora do CSV", "erro", "senha", "Bearer", "Authorization");
        }
    }

    @Test @Order(2) void rbacErrosJsonEParametrosDePaginacao() throws Exception {
        String path="/medicoes/export";
        assertThat(get(path,null).statusCode()).isEqualTo(401);
        for(String email:new String[]{"admin@export.test","operador@export.test","visualizador@export.test"})assertThat(get(path,login(email)).statusCode()).isEqualTo(200);
        HttpResponse<byte[]> troca=get(path,login("troca@export.test"));assertJson(troca,403,"PASSWORD_CHANGE_REQUIRED");
        String inactiveToken=login("inativo@export.test");jdbc.update("update usuarios set ativo=false where email='inativo@export.test'");assertJson(get(path,inactiveToken),401,"UNAUTHORIZED");
        assertJson(get(path+"?page=0",login("admin@export.test")),400,"INVALID_REQUEST");
        assertJson(get(path+"?sort=nome%20desc%3Bdrop%20table%20usuarios,asc",login("admin@export.test")),400,"INVALID_REQUEST");
        assertJson(get(path+"?inicio="+FIM+"&fim="+INICIO,login("admin@export.test"),false),400,"INVALID_REQUEST");
    }

    @Test @Order(3) void corsExpoeContentDispositionSemCredentials() throws Exception {
        HttpRequest request=HttpRequest.newBuilder(uri("/medicoes/export"))
                .method("OPTIONS",HttpRequest.BodyPublishers.noBody()).header("Origin","http://localhost:4200")
                .header("Access-Control-Request-Method","GET").header("Access-Control-Request-Headers","Authorization").build();
        HttpResponse<byte[]> response=HttpClient.newHttpClient().send(request,HttpResponse.BodyHandlers.ofByteArray());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Access-Control-Allow-Headers").orElse("")).containsIgnoringCase("Authorization");
        assertThat(response.headers().firstValue("Access-Control-Allow-Credentials")).isEmpty();
        HttpResponse<byte[]> download=get("/medicoes/export",login("admin@export.test"),true,"http://localhost:4200");
        assertThat(download.headers().firstValue("Access-Control-Expose-Headers").orElse("")).containsIgnoringCase("Content-Disposition");
    }

    @Test @Order(4) void cemMilPermitidoECemMilEUmRetorna422SemCsvParcial() throws Exception {
        jdbc.execute("truncate table medicao restart identity");
        jdbc.update("insert into medicao(monitor_id,status,latencia_ms,mensagem,executado_em) select ?, 'SUCESSO', (g%100)::int, null, ?::timestamptz + g * interval '1 millisecond' from generate_series(1,100000) g",monitorId,java.sql.Timestamp.from(INICIO));
        String token=login("admin@export.test");long memoryBefore=usedMemory();long started=System.nanoTime();
        HttpResponse<byte[]> allowed=get("/medicoes/export",token);long elapsedMs=(System.nanoTime()-started)/1_000_000;long memoryDelta=Math.max(0,usedMemory()-memoryBefore);
        assertThat(allowed.statusCode()).isEqualTo(200);assertThat(Arrays.copyOf(allowed.body(),3)).containsExactly(BOM);
        assertThat(countCrLf(allowed.body())).isEqualTo(100001);
        System.out.printf("R04.2 BENCHMARK medicoes linhas=100000 tempoMs=%d bytes=%d memoriaAproximadaBytes=%d%n",elapsedMs,allowed.body().length,memoryDelta);

        jdbc.update("insert into medicao(monitor_id,status,latencia_ms,mensagem,executado_em) values (?, 'SUCESSO', 1, null, ?)",monitorId,java.sql.Timestamp.from(INICIO.plusSeconds(200)));
        HttpResponse<byte[]> rejected=get("/medicoes/export",token);assertJson(rejected,422,"EXPORT_LIMIT_EXCEEDED");
        assertThat(rejected.headers().firstValue("Content-Type").orElse("")).contains("application/json");
        assertThat(Arrays.copyOf(rejected.body(),Math.min(3,rejected.body().length))).isNotEqualTo(BOM);
    }

    private HttpResponse<byte[]> get(String path,String token)throws Exception{return get(path,token,true,null);}
    private HttpResponse<byte[]> get(String path,String token,boolean addPeriod)throws Exception{return get(path,token,addPeriod,null);}
    private HttpResponse<byte[]> get(String path,String token,boolean addPeriod,String origin)throws Exception{
        String separator=path.contains("?")?"&":"?";String full=addPeriod?path+separator+"inicio="+INICIO+"&fim="+FIM:path;
        HttpRequest.Builder request=HttpRequest.newBuilder(uri(full)).GET();if(token!=null)request.header("Authorization","Bearer "+token);if(origin!=null)request.header("Origin",origin);
        return HttpClient.newHttpClient().send(request.build(),HttpResponse.BodyHandlers.ofByteArray());
    }
    private URI uri(String path){return URI.create("http://localhost:"+port+"/api/v1/relatorios"+path);}
    private String login(String email)throws Exception{String json="{\"email\":\""+email+"\",\"senha\":\""+PASSWORD+"\"}";HttpRequest request=HttpRequest.newBuilder(URI.create("http://localhost:"+port+"/api/v1/auth/login")).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json)).build();String body=HttpClient.newHttpClient().send(request,HttpResponse.BodyHandlers.ofString()).body();Matcher matcher=TOKEN.matcher(body);assertThat(matcher.find()).isTrue();return matcher.group(1);}
    private void assertJson(HttpResponse<byte[]> response,int status,String code){assertThat(response.statusCode()).isEqualTo(status);assertThat(response.headers().firstValue("Content-Type").orElse("")).contains("application/json");assertThat(new String(response.body(),StandardCharsets.UTF_8)).contains("\"code\":\""+code+"\"").doesNotContain("stackTrace");}
    private static long countCrLf(byte[] bytes){long count=0;for(int i=1;i<bytes.length;i++)if(bytes[i-1]=='\r'&&bytes[i]=='\n')count++;return count;}
    private static long usedMemory(){Runtime runtime=Runtime.getRuntime();return runtime.totalMemory()-runtime.freeMemory();}
    private record Expected(String path,String header,String filename){}
}

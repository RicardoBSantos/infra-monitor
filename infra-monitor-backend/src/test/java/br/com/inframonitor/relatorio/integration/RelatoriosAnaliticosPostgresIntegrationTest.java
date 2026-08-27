package br.com.inframonitor.relatorio.integration;

import br.com.inframonitor.equipamento.dto.CreateEquipamentoRequest;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.service.EquipamentoService;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.medicao.entity.*;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.entity.*;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.notificacao.entity.*;
import br.com.inframonitor.notificacao.repository.NotificacaoRepository;
import br.com.inframonitor.relatorio.dto.*;
import br.com.inframonitor.relatorio.entity.*;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import br.com.inframonitor.relatorio.service.RelatorioService;
import br.com.inframonitor.tipoequipamento.dto.CreateTipoEquipamentoRequest;
import br.com.inframonitor.tipoequipamento.service.TipoEquipamentoService;
import br.com.inframonitor.unidade.dto.CreateUnidadeRequest;
import br.com.inframonitor.unidade.service.UnidadeService;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(properties={"app.auth.jwt.secret=test-only-jwt-secret-with-at-least-32-bytes","app.auth.jwt.issuer=infra-monitor-test","monitoring.engine.enabled=false","notification.telegram.enabled=false","notification.dispatcher.enabled=false"})
class RelatoriosAnaliticosPostgresIntegrationTest {
 static final PostgreSQLContainer<?> POSTGRES=new PostgreSQLContainer<>("postgres:16-alpine"); static final Instant INICIO=Instant.parse("2026-03-01T10:00:00Z"), FIM=Instant.parse("2026-03-01T20:00:00Z");
 @DynamicPropertySource static void db(DynamicPropertyRegistry r){POSTGRES.start();r.add("spring.datasource.url",POSTGRES::getJdbcUrl);r.add("spring.datasource.username",POSTGRES::getUsername);r.add("spring.datasource.password",POSTGRES::getPassword);}
 @Autowired JdbcTemplate jdbc; @Autowired UnidadeService unidades; @Autowired TipoEquipamentoService tipos; @Autowired EquipamentoService equipamentoService; @Autowired EquipamentoRepository equipamentos; @Autowired MonitorRepository monitores; @Autowired JanelaMonitoramentoRepository janelas; @Autowired MedicaoRepository medicoes; @Autowired IncidenteRepository incidentes; @Autowired NotificacaoRepository notificacoes; @Autowired RelatorioService relatorios;
 Map<String,Long> unidadesPorSigla=new HashMap<>();
 @BeforeEach void clear(){jdbc.execute("truncate table janela_monitoramento, medicao, incidente, notificacao, monitor, equipamento, tipo_equipamento, unidade restart identity cascade");unidadesPorSigla.clear();}

 @Test void unidadeSomaTemposSemMediaSimplesEDeduplicaEquipamentos(){
  Equipamento a=eq("U2","A"), b=eq("U2","B"); Monitor ma=monitor(a,"A",INICIO,INICIO.plusSeconds(3600)), mb=monitor(b,"B",INICIO,INICIO.plusSeconds(32400)); medicao(ma,INICIO,10);medicao(mb,INICIO,10);incidente(mb,INICIO,INICIO.plusSeconds(3240),"B");
  DisponibilidadeUnidadeResponse r=relatorios.unidades(INICIO,FIM.plusSeconds(32400),a.getUnidade().getId(),0,20,"").content().getFirst();
  assertThat(r.tempoMonitoradoSegundos()).isEqualTo(36000);assertThat(r.tempoIndisponivelSegundos()).isEqualTo(3240);assertThat(r.tempoDisponivelSegundos()).isEqualTo(32760);assertThat(r.disponibilidadePercentual()).isEqualByComparingTo("91.00");assertThat(r.disponibilidadePercentual()).isNotEqualByComparingTo("95.00");assertThat(r.equipamentosTotal()).isEqualTo(2);assertThat(r.equipamentosMonitorados()).isEqualTo(2);
  Equipamento multi=eq("U3","multi");Monitor x=monitor(multi,"X",INICIO,INICIO.plusSeconds(3600)),y=monitor(multi,"Y",INICIO,INICIO.plusSeconds(3600));medicao(x,INICIO,1);medicao(y,INICIO,1);DisponibilidadeUnidadeResponse u3=relatorios.unidades(INICIO,INICIO.plusSeconds(3600),multi.getUnidade().getId(),0,20,"").content().getFirst();assertThat(u3.equipamentosTotal()).isOne();assertThat(u3.equipamentosMonitorados()).isOne();assertThat(u3.tempoMonitoradoSegundos()).isEqualTo(7200);
 }
 @Test void unidadeClassificaSemMonitoramentoSemDadosEDenominadorZero(){
  Equipamento calculado=eq("U4","calculado"), semMonitor=eq("U4","sem-monitor");Monitor m=monitor(calculado,"C",INICIO,INICIO.plusSeconds(3600));medicao(m,INICIO,1);DisponibilidadeUnidadeResponse u4=relatorios.unidades(INICIO,INICIO.plusSeconds(3600),calculado.getUnidade().getId(),0,20,"").content().getFirst();assertThat(u4.equipamentosTotal()).isEqualTo(2);assertThat(u4.equipamentosSemMonitoramento()).isOne();
  Equipamento sd=eq("U5","sem-dados"); monitor(sd,"SD",INICIO,INICIO.plusSeconds(3600));DisponibilidadeUnidadeResponse u5=relatorios.unidades(INICIO,INICIO.plusSeconds(3600),sd.getUnidade().getId(),0,20,"").content().getFirst();assertThat(u5.equipamentosSemDados()).isOne();
  Equipamento zeroSemMonitor=eq("U6","no-monitor"), zeroSemDados=eq("U6","no-data");monitor(zeroSemDados,"Z",INICIO,INICIO.plusSeconds(3600));DisponibilidadeUnidadeResponse u6=relatorios.unidades(INICIO,INICIO.plusSeconds(3600),zeroSemMonitor.getUnidade().getId(),0,20,"").content().getFirst();assertThat(u6.disponibilidadePercentual()).isNull();assertThat(u6.tempoMonitoradoSegundos()).isNull();
 }
 @Test void incidentesRecortamDuracaoEIncluemApenasInterseccoes(){
  Equipamento e=eq("HI","inc");Monitor m=monitor(e,"M",INICIO,FIM); String[] motivos={"dentro","cruza-inicio","cruza-fim","cobre","aberto","fora"};incidente(m,INICIO.plusSeconds(3600),INICIO.plusSeconds(7200),motivos[0]);incidente(m,INICIO.minusSeconds(3600),INICIO.plusSeconds(1800),motivos[1]);incidente(m,FIM.minusSeconds(1800),FIM.plusSeconds(3600),motivos[2]);incidente(m,INICIO.minusSeconds(1),FIM.plusSeconds(1),motivos[3]);incidente(m,FIM.minusSeconds(600),null,motivos[4]);incidente(m,FIM.plusSeconds(1),FIM.plusSeconds(2),motivos[5]);
  var rs=relatorios.incidentes(INICIO,FIM,e.getUnidade().getId(),e.getId(),m.getId(),StatusIncidente.FECHADO,0,20,"").content();assertThat(rs).hasSize(4);Map<String,Long> duracoes=new HashMap<>();rs.forEach(r->duracoes.put(r.motivo(),r.duracaoSegundosNoPeriodo()));assertThat(duracoes).containsEntry("dentro",3600L).containsEntry("cruza-inicio",1800L).containsEntry("cruza-fim",1800L).containsEntry("cobre",36000L);assertThat(relatorios.incidentes(INICIO,FIM,e.getUnidade().getId(),e.getId(),m.getId(),StatusIncidente.ABERTO,0,20,"").content()).singleElement().extracting(HistoricoIncidenteResponse::duracaoSegundosNoPeriodo).isEqualTo(600L);
 }
 @Test void medicoesIncluemAmbosLimites(){Equipamento e=eq("HM","med");Monitor m=monitor(e,"M",INICIO,FIM);medicao(m,INICIO.minusSeconds(1),1);medicao(m,INICIO,2);medicao(m,FIM,3);medicao(m,FIM.plusSeconds(1),4);var rs=relatorios.medicoes(INICIO,FIM,e.getUnidade().getId(),e.getId(),m.getId(),StatusMedicao.SUCESSO,0,20,"").content();assertThat(rs).extracting(HistoricoMedicaoResponse::latenciaMs).containsExactlyInAnyOrder(2,3);}
 @Test void latenciaUsaPercentileContDoPostgresEExcluiFalhasENulos(){Equipamento e=eq("LAT","lat");Monitor a=monitor(e,"A",INICIO,FIM), b=monitor(e,"B",INICIO,FIM);for(int v=10;v<=100;v+=10)medicao(a,INICIO.plusSeconds(v),v);medicoes.saveAndFlush(new Medicao(a,StatusMedicao.FALHA,null,null,INICIO));medicoes.saveAndFlush(new Medicao(a,StatusMedicao.SUCESSO,null,null,INICIO));LatenciaIcmpResponse r=relatorios.latencia(INICIO,FIM,e.getUnidade().getId(),e.getId(),a.getId(),0,20,"").content().getFirst();assertThat(r.minLatenciaMs()).isEqualTo(10);assertThat(r.avgLatenciaMs()).isEqualByComparingTo(new BigDecimal("55.00"));assertThat(r.maxLatenciaMs()).isEqualTo(100);assertThat(r.count()).isEqualTo(10);assertThat(r.p95LatenciaMs()).isEqualTo(96);assertThat(relatorios.latencia(INICIO,FIM,e.getUnidade().getId(),e.getId(),b.getId(),0,20,"").content().getFirst().count()).isZero();}
 @Test void notificacoesFiltramCreatedAtEPreservamCamposNulos(){Equipamento e=eq("NOT","not");Monitor m=monitor(e,"M",INICIO,FIM);Incidente i=incidente(m,INICIO,INICIO.plusSeconds(1),"n");Notificacao dentro=new Notificacao(i,CanalNotificacao.TELEGRAM,TipoEventoNotificacao.INCIDENTE_ABERTO,"x");dentro.marcarFalha("erro");Notificacao fora=new Notificacao(i,CanalNotificacao.TELEGRAM,TipoEventoNotificacao.INCIDENTE_FECHADO,"x");notificacoes.saveAndFlush(dentro);notificacoes.saveAndFlush(fora);jdbc.update("update notificacao set created_at=? where id=?",java.sql.Timestamp.from(INICIO.plusSeconds(1)),dentro.getId());jdbc.update("update notificacao set created_at=? where id=?",java.sql.Timestamp.from(FIM.plusSeconds(1)),fora.getId());var r=relatorios.notificacoes(INICIO,FIM,i.getId(),StatusNotificacao.FALHA,CanalNotificacao.TELEGRAM,TipoEventoNotificacao.INCIDENTE_ABERTO,0,20,"").content();assertThat(r).singleElement().satisfies(x->{assertThat(x.enviadoEm()).isNull();assertThat(x.erro()).isEqualTo("erro");assertThat(x.tentativas()).isEqualTo(1);assertThat(x.status()).isEqualTo("FALHA");assertThat(x.canal()).isEqualTo("TELEGRAM");assertThat(x.tipoEvento()).isEqualTo("INCIDENTE_ABERTO");});}
 private Equipamento eq(String unidade,String nome){long u=unidadesPorSigla.computeIfAbsent(unidade,s->unidades.criar(new CreateUnidadeRequest("Unidade "+s,s,null,null,null,null,null,null,null)).id());long t=tipos.criar(new CreateTipoEquipamentoRequest("Tipo "+unidade+nome,null)).id();long id=equipamentoService.criar(new CreateEquipamentoRequest(u,t,nome,null,null,null,null)).id();return equipamentos.findById(id).orElseThrow();}
 private Monitor monitor(Equipamento e,String nome,Instant inicio,Instant fim){Monitor m=monitores.saveAndFlush(new Monitor(e,TipoMonitor.ICMP,nome,60,1000));JanelaMonitoramento j=new JanelaMonitoramento(m,inicio,OrigemJanelaMonitoramento.PRECISA);j.fechar(fim);janelas.saveAndFlush(j);return m;}
 private void medicao(Monitor m,Instant em,Integer lat){medicoes.saveAndFlush(new Medicao(m,StatusMedicao.SUCESSO,lat,null,em));}
 private Incidente incidente(Monitor m,Instant inicio,Instant fim,String motivo){Incidente i=new Incidente(m,inicio,motivo,null);if(fim!=null)i.fechar(fim,null);return incidentes.saveAndFlush(i);}
 /** Agregado por unidade: a media e ponderada pelas medicoes, nao a media das medias dos monitores. */
 @Test void latenciaPorUnidadeAgregaMonitoresPonderadoPelasMedicoes(){
  Equipamento a=eq("LU","A"); Monitor ma=monitor(a,"A",INICIO,FIM), mb=monitor(a,"B",INICIO,FIM);
  for(int v=1;v<=9;v++)medicao(ma,INICIO.plusSeconds(v),10);           // 9 medicoes de 10 ms
  medicao(mb,INICIO.plusSeconds(20),100);                              // 1 medicao de 100 ms
  medicoes.saveAndFlush(new Medicao(mb,StatusMedicao.FALHA,null,null,INICIO));
  long unidadeId=a.getUnidade().getId();
  LatenciaUnidadeResponse r=relatorios.latenciaUnidades(INICIO,FIM,unidadeId,0,20,"").content().getFirst();
  assertThat(r.unidadeId()).isEqualTo(unidadeId);
  assertThat(r.count()).isEqualTo(10);
  assertThat(r.minLatenciaMs()).isEqualTo(10);
  assertThat(r.maxLatenciaMs()).isEqualTo(100);
  // Ponderada: (9*10 + 100)/10 = 19.00. A media das medias dos monitores daria 55.00.
  assertThat(r.avgLatenciaMs()).isEqualByComparingTo(new BigDecimal("19.00"));
  // Uma linha por unidade, independentemente do numero de monitores.
  assertThat(relatorios.latenciaUnidades(INICIO,FIM,unidadeId,0,20,"").content()).hasSize(1);
  // O endpoint por monitor continua com o comportamento anterior, duas linhas e p95 preenchido.
  assertThat(relatorios.latencia(INICIO,FIM,unidadeId,null,null,0,20,"").content()).hasSize(2);
 }
 @Test void latenciaPorUnidadeMantemUnidadeSemMedicaoComContagemZero(){
  Equipamento a=eq("LZ","A"); monitor(a,"A",INICIO,FIM);
  LatenciaUnidadeResponse r=relatorios.latenciaUnidades(INICIO,FIM,a.getUnidade().getId(),0,20,"").content().getFirst();
  assertThat(r.count()).isZero(); assertThat(r.avgLatenciaMs()).isNull(); assertThat(r.minLatenciaMs()).isNull();
 }
}

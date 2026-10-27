package br.com.inframonitor.relatorio.exportacao;

import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.medicao.entity.StatusMedicao;
import br.com.inframonitor.notificacao.entity.CanalNotificacao;
import br.com.inframonitor.notificacao.entity.StatusNotificacao;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import br.com.inframonitor.relatorio.service.DisponibilidadeSqlRepository;
import br.com.inframonitor.relatorio.service.RelatorioService;
import br.com.inframonitor.security.UsuarioPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@Service
public class RelatorioExportService {
    private static final Logger audit = LoggerFactory.getLogger("REPORT_EXPORT_AUDIT");
    private static final String INCIDENTES = """
        select i.id incidente_id,u.id unidade_id,u.nome unidade_nome,e.id equipamento_id,e.nome equipamento_nome,
               m.id monitor_id,m.nome monitor_nome,m.tipo tipo_monitor,i.status,i.iniciado_em,i.encerrado_em,
               extract(epoch from greatest(interval '0', least(coalesce(i.encerrado_em,:fim),:fim)-greatest(i.iniciado_em,:inicio)))::bigint duracao,
               i.motivo,i.observacao,i.motivo_encerramento
          from incidente i join monitor m on m.id=i.monitor_id join equipamento e on e.id=m.equipamento_id
          join unidade u on u.id=e.unidade_id
         where i.iniciado_em<:fim and (i.encerrado_em is null or i.encerrado_em>=:inicio)
           and (cast(:unidadeId as bigint) is null or u.id=:unidadeId)
           and (cast(:equipamentoId as bigint) is null or e.id=:equipamentoId)
           and (cast(:monitorId as bigint) is null or m.id=:monitorId)
           and (cast(:status as varchar) is null or i.status=:status)
        """;
    private static final String MEDICOES = """
        select md.id medicao_id,u.id unidade_id,u.nome unidade_nome,e.id equipamento_id,e.nome equipamento_nome,
               m.id monitor_id,m.nome monitor_nome,m.tipo tipo_monitor,md.status,md.latencia_ms,md.executado_em
          from medicao md join monitor m on m.id=md.monitor_id join equipamento e on e.id=m.equipamento_id
          join unidade u on u.id=e.unidade_id
         where md.executado_em>=:inicio and md.executado_em<=:fim
           and (cast(:unidadeId as bigint) is null or u.id=:unidadeId)
           and (cast(:equipamentoId as bigint) is null or e.id=:equipamentoId)
           and (cast(:monitorId as bigint) is null or m.id=:monitorId)
           and (cast(:status as varchar) is null or md.status=:status)
        """;
    private static final String LATENCIA = """
        select u.id unidade_id,u.nome unidade_nome,e.id equipamento_id,e.nome equipamento_nome,
               m.id monitor_id,m.nome monitor_nome,min(md.latencia_ms) min_latencia,round(avg(md.latencia_ms),2) avg_latencia,
               max(md.latencia_ms) max_latencia,count(md.id) quantidade,
               percentile_cont(0.95) within group(order by md.latencia_ms) p95
          from monitor m join equipamento e on e.id=m.equipamento_id join unidade u on u.id=e.unidade_id
          left join medicao md on md.monitor_id=m.id and md.status='SUCESSO' and md.latencia_ms is not null
              and md.executado_em>=:inicio and md.executado_em<=:fim
         where m.tipo='ICMP' and (cast(:unidadeId as bigint) is null or u.id=:unidadeId)
           and (cast(:equipamentoId as bigint) is null or e.id=:equipamentoId)
           and (cast(:monitorId as bigint) is null or m.id=:monitorId)
         group by u.id,u.nome,e.id,e.nome,m.id,m.nome
        """;
    private static final String NOTIFICACOES = """
        select id,incidente_id,canal,tipo_evento,status,tentativas,enviado_em,created_at,
               manutencao_agendada_id,manutencao_manual_id
          from notificacao where created_at>=:inicio and created_at<=:fim
           and (cast(:incidenteId as bigint) is null or incidente_id=:incidenteId)
           and (cast(:status as varchar) is null or status=:status)
           and (cast(:canal as varchar) is null or canal=:canal)
           and (cast(:tipo as varchar) is null or tipo_evento=:tipo)
        """;

    private final RelatorioService reports;
    private final RelatorioExportQueryRepository repository;

    public RelatorioExportService(RelatorioService reports, RelatorioExportQueryRepository repository) {
        this.reports = reports; this.repository = repository;
    }

    public ExportDownload disponibilidadeEquipamentos(Instant inicio, Instant fim, Long unidadeId, Long equipamentoId,
            Long monitorId, Long tipoId, String sort, UsuarioPrincipal principal) {
        String order = reports.validarExportacaoDisponibilidade(inicio,fim,unidadeId,equipamentoId,monitorId,tipoId,sort);
        Map<String,Object> p = hierarchy(inicio,fim,unidadeId,equipamentoId,monitorId); p.put("tipoId",tipoId);
        String data = DisponibilidadeSqlRepository.BASE + " select * from linhas order by " + order + ", equipamento_id, monitor_id";
        return prepare("disponibilidade-equipamentos", inicio, fim, principal, safeFilters(p,order),
                new RelatorioExportQueryRepository.QueryDefinition(
                    DisponibilidadeSqlRepository.BASE + " select count(*) from linhas", data, p,
                    headers("unidade_id,unidade_nome,equipamento_id,equipamento_nome,monitor_id,monitor_nome,tipo_monitor,inicio,fim,estado_analitico,qualidade_janela,tempo_monitorado_segundos,tempo_indisponivel_segundos,tempo_disponivel_segundos,disponibilidade_percentual,incidentes"),
                    r -> new Object[]{lng(r,"unidade_id"),r.getString("unidade_nome"),lng(r,"equipamento_id"),r.getString("equipamento_nome"),lng(r,"monitor_id"),r.getString("monitor_nome"),r.getObject("monitor_id")==null?null:"ICMP",inicio,fim,r.getString("estado"),r.getString("qualidade"),lng(r,"tempo_monitorado"),lng(r,"tempo_indisponivel"),lng(r,"tempo_disponivel"),r.getBigDecimal("disponibilidade"),r.getLong("incidentes")}));
    }

    public ExportDownload disponibilidadeUnidades(Instant inicio, Instant fim, Long unidadeId, String sort, UsuarioPrincipal principal) {
        String order=reports.validarExportacaoUnidades(inicio,fim,unidadeId,sort);
        Map<String,Object> p=hierarchy(inicio,fim,unidadeId,null,null); p.put("tipoId",null);
        String grouped=DisponibilidadeSqlRepository.UNIDADES;
        return prepare("disponibilidade-unidades",inicio,fim,principal,safeFilters(p,order),new RelatorioExportQueryRepository.QueryDefinition(
                DisponibilidadeSqlRepository.BASE+" select count(*) from ("+grouped+") export_count",
                DisponibilidadeSqlRepository.BASE+" "+grouped+" order by "+order+", unidade_id",p,
                headers("unidade_id,unidade_nome,inicio,fim,estado_analitico,equipamentos_total,equipamentos_monitorados,equipamentos_sem_monitoramento,equipamentos_sem_dados,tempo_monitorado_segundos,tempo_indisponivel_segundos,tempo_disponivel_segundos,disponibilidade_percentual,incidentes"),
                r->new Object[]{lng(r,"unidade_id"),r.getString("unidade_nome"),inicio,fim,estadoUnidade(r),r.getLong("equipamentos_total"),r.getLong("equipamentos_monitorados"),r.getLong("equipamentos_sem_monitoramento"),r.getLong("equipamentos_sem_dados"),lng(r,"tempo_monitorado"),lng(r,"tempo_indisponivel"),lng(r,"tempo_disponivel"),r.getBigDecimal("disponibilidade"),r.getLong("incidentes")}));
    }

    public ExportDownload incidentes(Instant inicio,Instant fim,Long unidadeId,Long equipamentoId,Long monitorId,
            StatusIncidente status,String sort,UsuarioPrincipal principal){
        String order=reports.validarExportacaoIncidentes(inicio,fim,unidadeId,equipamentoId,monitorId,sort);
        Map<String,Object> p=hierarchy(inicio,fim,unidadeId,equipamentoId,monitorId);p.put("status",status);
        return prepare("incidentes",inicio,fim,principal,safeFilters(p,order),definition(INCIDENTES,order+", incidente_id",p,
                "incidente_id,unidade_id,unidade_nome,equipamento_id,equipamento_nome,monitor_id,monitor_nome,tipo_monitor,status,iniciado_em,encerrado_em,duracao_segundos_no_periodo,motivo,observacao,motivo_encerramento",
                r->new Object[]{lng(r,"incidente_id"),lng(r,"unidade_id"),r.getString("unidade_nome"),lng(r,"equipamento_id"),r.getString("equipamento_nome"),lng(r,"monitor_id"),r.getString("monitor_nome"),r.getString("tipo_monitor"),r.getString("status"),instant(r,"iniciado_em"),instant(r,"encerrado_em"),r.getLong("duracao"),r.getString("motivo"),r.getString("observacao"),r.getString("motivo_encerramento")}));
    }

    public ExportDownload medicoes(Instant inicio,Instant fim,Long unidadeId,Long equipamentoId,Long monitorId,
            StatusMedicao status,String sort,UsuarioPrincipal principal){
        String order=reports.validarExportacaoMedicoes(inicio,fim,unidadeId,equipamentoId,monitorId,sort);
        Map<String,Object> p=hierarchy(inicio,fim,unidadeId,equipamentoId,monitorId);p.put("status",status);
        return prepare("medicoes",inicio,fim,principal,safeFilters(p,order),definition(MEDICOES,order+", medicao_id",p,
                "medicao_id,unidade_id,unidade_nome,equipamento_id,equipamento_nome,monitor_id,monitor_nome,tipo_monitor,status,latencia_ms,executado_em",
                r->new Object[]{lng(r,"medicao_id"),lng(r,"unidade_id"),r.getString("unidade_nome"),lng(r,"equipamento_id"),r.getString("equipamento_nome"),lng(r,"monitor_id"),r.getString("monitor_nome"),r.getString("tipo_monitor"),r.getString("status"),r.getObject("latencia_ms"),instant(r,"executado_em")}));
    }

    public ExportDownload latencia(Instant inicio,Instant fim,Long unidadeId,Long equipamentoId,Long monitorId,
            String sort,UsuarioPrincipal principal){
        String order=reports.validarExportacaoLatencia(inicio,fim,unidadeId,equipamentoId,monitorId,sort);
        Map<String,Object> p=hierarchy(inicio,fim,unidadeId,equipamentoId,monitorId);
        return prepare("latencia",inicio,fim,principal,safeFilters(p,order),definition(LATENCIA,order+", monitor_id",p,
                "unidade_id,unidade_nome,equipamento_id,equipamento_nome,monitor_id,monitor_nome,inicio,fim,min_latencia_ms,avg_latencia_ms,max_latencia_ms,p95_latencia_ms,amostras",
                r->new Object[]{lng(r,"unidade_id"),r.getString("unidade_nome"),lng(r,"equipamento_id"),r.getString("equipamento_nome"),lng(r,"monitor_id"),r.getString("monitor_nome"),inicio,fim,r.getObject("min_latencia"),r.getBigDecimal("avg_latencia"),r.getObject("max_latencia"),p95(r.getObject("p95")),r.getLong("quantidade")}));
    }

    public ExportDownload notificacoes(Instant inicio,Instant fim,Long incidenteId,StatusNotificacao status,
            CanalNotificacao canal,TipoEventoNotificacao tipo,String sort,UsuarioPrincipal principal){
        String order=reports.validarExportacaoNotificacoes(inicio,fim,incidenteId,sort);
        Map<String,Object> p=period(inicio,fim);p.put("incidenteId",incidenteId);p.put("status",status);p.put("canal",canal);p.put("tipo",tipo);
        return prepare("notificacoes",inicio,fim,principal,safeFilters(p,order),definition(NOTIFICACOES,order+", id",p,
                "notificacao_id,incidente_id,tipo_evento,canal,status,tentativas,created_at,enviado_em,manutencao_id,manutencao_manual_id",
                r->new Object[]{lng(r,"id"),lng(r,"incidente_id"),r.getString("tipo_evento"),r.getString("canal"),r.getString("status"),r.getInt("tentativas"),instant(r,"created_at"),instant(r,"enviado_em"),lng(r,"manutencao_agendada_id"),lng(r,"manutencao_manual_id")}));
    }

    private ExportDownload prepare(String report,Instant inicio,Instant fim,UsuarioPrincipal principal,String filters,
            RelatorioExportQueryRepository.QueryDefinition definition){
        String correlationId=UUID.randomUUID().toString();long started=System.nanoTime();
        audit.info("event=EXPORT_STARTED correlationId={} userId={} papel={} relatorio={} inicio={} fim={} filtros={} timestamp={} resultado=STARTED",
                correlationId,principal.id(),principal.papel(),report,inicio,fim,filters,Instant.now());
        try{
            RelatorioExportQueryRepository.PreparedExport prepared=repository.prepare(definition);
            StreamingResponseBody body=output->{
                try{
                    RelatorioExportQueryRepository.StreamResult result=prepared.stream(output);
                    audit.info("event=EXPORT_SUCCEEDED correlationId={} userId={} papel={} relatorio={} inicio={} fim={} filtros={} quantidade={} bytes={} duracaoMs={} timestamp={} resultado=SUCCEEDED",
                            correlationId,principal.id(),principal.papel(),report,inicio,fim,filters,result.rows(),result.bytes(),elapsed(started),Instant.now());
                }catch(Exception ex){
                    audit.warn("event=EXPORT_FAILED correlationId={} userId={} papel={} relatorio={} inicio={} fim={} filtros={} quantidade={} bytes=0 duracaoMs={} timestamp={} resultado=FAILED code={}",
                            correlationId,principal.id(),principal.papel(),report,inicio,fim,filters,prepared.expectedRows(),elapsed(started),Instant.now(),ex.getClass().getSimpleName());
                    if(ex instanceof java.io.IOException io)throw io;throw new java.io.IOException("Falha na exportacao",ex);
                }
            };
            return new ExportDownload(filename(report,inicio,fim),prepared.expectedRows(),body);
        }catch(RuntimeException ex){
            long quantity=ex instanceof ExportLimitExceededException limit?limit.count():0;
            audit.warn("event=EXPORT_FAILED correlationId={} userId={} papel={} relatorio={} inicio={} fim={} filtros={} quantidade={} bytes=0 duracaoMs={} timestamp={} resultado=FAILED code={}",
                    correlationId,principal.id(),principal.papel(),report,inicio,fim,filters,quantity,elapsed(started),Instant.now(),ex.getClass().getSimpleName());
            throw ex;
        }
    }

    private static RelatorioExportQueryRepository.QueryDefinition definition(String base,String order,Map<String,Object> p,String headers,RelatorioExportQueryRepository.ResultRowMapper mapper){return new RelatorioExportQueryRepository.QueryDefinition("select count(*) from ("+base+") export_count",base+" order by "+order,p,headers(headers),mapper);}
    private static Map<String,Object> period(Instant a,Instant b){Map<String,Object> p=new HashMap<>();p.put("inicio",a);p.put("fim",b);return p;}
    private static Map<String,Object> hierarchy(Instant a,Instant b,Long u,Long e,Long m){Map<String,Object> p=period(a,b);p.put("unidadeId",u);p.put("equipamentoId",e);p.put("monitorId",m);return p;}
    private static String[] headers(String value){return value.split(",");}
    private static String safeFilters(Map<String,Object> p,String order){StringBuilder b=new StringBuilder();p.entrySet().stream().filter(e->!e.getKey().equals("inicio")&&!e.getKey().equals("fim")&&e.getValue()!=null).sorted(Map.Entry.comparingByKey()).forEach(e->b.append(e.getKey()).append('=').append(e.getValue() instanceof Enum<?> x?x.name():e.getValue()).append(';'));return b.append("sort=").append(order.replace(' ','_')).toString();}
    private static String filename(String report,Instant inicio,Instant fim){DateTimeFormatter d=DateTimeFormatter.ISO_LOCAL_DATE;return report+"_"+d.format(inicio.atZone(ZoneOffset.UTC))+"_"+d.format(fim.atZone(ZoneOffset.UTC))+".csv";}
    private static long elapsed(long started){return (System.nanoTime()-started)/1_000_000;}
    private static Long lng(ResultSet r,String column)throws SQLException{Object value=r.getObject(column);return value==null?null:((Number)value).longValue();}
    private static Instant instant(ResultSet r,String column)throws SQLException{OffsetDateTime value=r.getObject(column,OffsetDateTime.class);return value==null?null:value.toInstant();}
    private static Integer p95(Object value){if(value==null)return null;return BigDecimal.valueOf(((Number)value).doubleValue()).add(new BigDecimal("0.000000001")).setScale(0,RoundingMode.HALF_UP).intValueExact();}
    private static String estadoUnidade(ResultSet r)throws SQLException{if(r.getObject("tempo_monitorado")!=null)return "CALCULADO";return r.getLong("equipamentos_sem_monitoramento")==r.getLong("equipamentos_total")?"SEM_MONITORAMENTO":"SEM_DADOS";}

    public record ExportDownload(String filename,long rows,StreamingResponseBody body) { }
}

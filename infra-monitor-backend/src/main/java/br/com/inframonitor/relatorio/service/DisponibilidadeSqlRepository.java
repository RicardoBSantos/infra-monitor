package br.com.inframonitor.relatorio.service;

import br.com.inframonitor.common.api.PaginaResposta;
import br.com.inframonitor.relatorio.dto.DisponibilidadeEquipamentoResponse;
import br.com.inframonitor.relatorio.dto.DisponibilidadeUnidadeResponse;
import br.com.inframonitor.relatorio.temporal.EstadoAnalitico;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.Map;

/** PostgreSQL implementation of the already-homologated temporal availability formula. */
@Repository
public class DisponibilidadeSqlRepository {
    private final NamedParameterJdbcTemplate jdbc;
    public DisponibilidadeSqlRepository(NamedParameterJdbcTemplate jdbc) { this.jdbc = jdbc; }

    /* The range_agg/unnest pairs are the SQL equivalent of IntervaloTemporal.unir(). */
    public static final String BASE = """
      with universo as (
        select u.id unidade_id,u.nome unidade_nome,e.id equipamento_id,e.nome equipamento_nome,
               m.id monitor_id,m.nome monitor_nome
          from equipamento e join unidade u on u.id=e.unidade_id
          left join monitor m on m.equipamento_id=e.id and m.tipo='ICMP'
         where (cast(:unidadeId as bigint) is null or u.id=:unidadeId)
           and (cast(:equipamentoId as bigint) is null or e.id=:equipamentoId)
           and (cast(:monitorId as bigint) is null or m.id=:monitorId)
           and (cast(:tipoId as bigint) is null or e.tipo_equipamento_id=:tipoId)
      ), janelas as (
        select x.monitor_id,j.id janela_id,j.origem,
               greatest(:inicio,j.inicio_em, min(md.executado_em)) inicio_em,
               least(:fim,coalesce(j.fim_em,:fim)) fim_em
          from universo x join janela_monitoramento j on j.monitor_id=x.monitor_id
          join medicao md on md.monitor_id=j.monitor_id and md.executado_em>=j.inicio_em
                         and (j.fim_em is null or md.executado_em<j.fim_em)
         where j.inicio_em<:fim and (j.fim_em is null or j.fim_em>:inicio)
         group by x.monitor_id,j.id,j.origem,j.inicio_em,j.fim_em
        having greatest(:inicio,j.inicio_em,min(md.executado_em)) < least(:fim,coalesce(j.fim_em,:fim))
      ), janelas_unidas as (
        select monitor_id, range_agg(tstzrange(inicio_em,fim_em,'[)')) faixas,
               bool_or(origem='INFERIDA') inferida
          from janelas group by monitor_id
      ), monitorado as (
        select monitor_id,inferida,
               sum(extract(epoch from (upper(faixa)-lower(faixa))))::bigint tempo_monitorado
          from janelas_unidas cross join lateral unnest(faixas) faixa
         group by monitor_id,inferida
      ), quedas as (
        select i.monitor_id,i.id incidente_id,
               greatest(i.iniciado_em,lower(faixa)) inicio_em,
               least(coalesce(i.encerrado_em,:fim),upper(faixa)) fim_em
          from incidente i join janelas_unidas j on j.monitor_id=i.monitor_id
          cross join lateral unnest(j.faixas) faixa
         where i.iniciado_em < upper(faixa)
           and coalesce(i.encerrado_em,:fim) > lower(faixa)
      ), quedas_unidas as (
        select monitor_id,range_agg(tstzrange(inicio_em,fim_em,'[)')) faixas
          from quedas where inicio_em<fim_em group by monitor_id
      ), indisponivel as (
        select monitor_id,sum(extract(epoch from (upper(faixa)-lower(faixa))))::bigint tempo_indisponivel
          from quedas_unidas cross join lateral unnest(faixas) faixa group by monitor_id
      ), incidentes as (
        select monitor_id,count(distinct incidente_id)::bigint incidentes from quedas
         where inicio_em<fim_em group by monitor_id
      ), linhas as (
        select x.*,
          case when x.monitor_id is null then 'SEM_MONITORAMENTO'
               when mt.monitor_id is null then 'SEM_DADOS' else 'CALCULADO' end estado,
          case when mt.monitor_id is null then null when mt.inferida then 'INFERIDA' else 'PRECISA' end qualidade,
          mt.tempo_monitorado,coalesce(ind.tempo_indisponivel,0)::bigint tempo_indisponivel,
          case when mt.monitor_id is null then null else mt.tempo_monitorado-coalesce(ind.tempo_indisponivel,0) end tempo_disponivel,
          case when mt.monitor_id is null then null else round(((mt.tempo_monitorado-coalesce(ind.tempo_indisponivel,0))*100.0)/mt.tempo_monitorado,2) end disponibilidade,
          case when x.monitor_id is null then 0 else coalesce(ic.incidentes,0) end incidentes
        from universo x left join monitorado mt on mt.monitor_id=x.monitor_id
          left join indisponivel ind on ind.monitor_id=x.monitor_id left join incidentes ic on ic.monitor_id=x.monitor_id
      )
      """;

    public static final String UNIDADES = """
      select unidade_id,max(unidade_nome) unidade_nome,
      count(distinct equipamento_id)::bigint equipamentos_total,
      count(distinct equipamento_id) filter(where estado='CALCULADO')::bigint equipamentos_monitorados,
      count(distinct equipamento_id) filter(where estado='SEM_MONITORAMENTO')::bigint equipamentos_sem_monitoramento,
      count(distinct equipamento_id) filter(where estado='SEM_DADOS')::bigint equipamentos_sem_dados,
      sum(tempo_monitorado) filter(where estado='CALCULADO')::bigint tempo_monitorado,
      sum(tempo_indisponivel) filter(where estado='CALCULADO')::bigint tempo_indisponivel,
      sum(tempo_disponivel) filter(where estado='CALCULADO')::bigint tempo_disponivel,
      case when sum(tempo_monitorado) filter(where estado='CALCULADO') is null then null else round(sum(tempo_disponivel) filter(where estado='CALCULADO')*100.0/sum(tempo_monitorado) filter(where estado='CALCULADO'),2) end disponibilidade,
      sum(incidentes)::bigint incidentes from linhas group by unidade_id
      """;

    public PaginaResposta<DisponibilidadeEquipamentoResponse> equipamentos(Instant inicio, Instant fim, Long unidadeId, Long equipamentoId, Long monitorId, Long tipoId, int page, int size, String order) {
        var p=params(inicio,fim,unidadeId,equipamentoId,monitorId,tipoId).addValue("limit",size).addValue("offset",page*size);
        long total=jdbc.queryForObject(BASE+" select count(*) from linhas",p,Long.class);
        var rows=jdbc.query(BASE+" select * from linhas order by "+order+", equipamento_id, monitor_id limit :limit offset :offset",p,(r,n)->mapEquipamento(r,inicio,fim));
        int pages=(int)((total+size-1)/size); return new PaginaResposta<>(rows,page,size,total,pages,page==0,page>=pages-1);
    }
    public PaginaResposta<DisponibilidadeUnidadeResponse> unidades(Instant inicio, Instant fim, Long unidadeId, int page, int size, String order) {
        var p=params(inicio,fim,unidadeId,null,null,null).addValue("limit",size).addValue("offset",page*size);
        long total=jdbc.queryForObject(BASE+" select count(*) from ("+UNIDADES+") q",p,Long.class);
        var rows=jdbc.query(BASE+" "+UNIDADES+" order by "+order+", unidade_id limit :limit offset :offset",p,(r,n)->new DisponibilidadeUnidadeResponse(r.getLong("unidade_id"),r.getString("unidade_nome"),inicio,fim, r.getObject("tempo_monitorado")==null?EstadoAnalitico.SEM_DADOS:EstadoAnalitico.CALCULADO,r.getLong("equipamentos_total"),r.getLong("equipamentos_monitorados"),r.getLong("equipamentos_sem_monitoramento"),r.getLong("equipamentos_sem_dados"),lng(r,"tempo_monitorado"),lng(r,"tempo_indisponivel"),lng(r,"tempo_disponivel"),r.getBigDecimal("disponibilidade"),r.getLong("incidentes")));
        int pages=(int)((total+size-1)/size); return new PaginaResposta<>(rows,page,size,total,pages,page==0,page>=pages-1);
    }
    private MapSqlParameterSource params(Instant a,Instant b,Long u,Long e,Long m,Long t){return new MapSqlParameterSource().addValue("inicio",Timestamp.from(a)).addValue("fim",Timestamp.from(b)).addValue("unidadeId",u).addValue("equipamentoId",e).addValue("monitorId",m).addValue("tipoId",t);}
    private DisponibilidadeEquipamentoResponse mapEquipamento(ResultSet r,Instant inicio,Instant fim)throws SQLException{return new DisponibilidadeEquipamentoResponse(r.getLong("equipamento_id"),r.getString("equipamento_nome"),r.getLong("unidade_id"),r.getString("unidade_nome"),lng(r,"monitor_id"),r.getString("monitor_nome"),r.getObject("monitor_id")==null?null:"ICMP",inicio,fim,EstadoAnalitico.valueOf(r.getString("estado")),r.getString("qualidade")==null?null:br.com.inframonitor.relatorio.entity.OrigemJanelaMonitoramento.valueOf(r.getString("qualidade")),lng(r,"tempo_monitorado"),lng(r,"tempo_indisponivel"),lng(r,"tempo_disponivel"),r.getBigDecimal("disponibilidade"),r.getLong("incidentes"));}
    private Long lng(ResultSet r,String name)throws SQLException{Object v=r.getObject(name);return v==null?null:((Number)v).longValue();}
}

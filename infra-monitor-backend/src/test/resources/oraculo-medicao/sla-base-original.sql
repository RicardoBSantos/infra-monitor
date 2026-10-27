-- Oraculo congelado: BASE de DisponibilidadeSqlRepository antes da V24 (CTE janelas junta todas as medicoes da janela).
-- Nao editar: os testes de equivalencia e de leitura limitada comparam a versao atual com esta.
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

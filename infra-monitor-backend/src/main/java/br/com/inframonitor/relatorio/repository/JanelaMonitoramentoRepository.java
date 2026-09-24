package br.com.inframonitor.relatorio.repository;
import br.com.inframonitor.relatorio.entity.JanelaMonitoramento;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import java.util.*;
public interface JanelaMonitoramentoRepository extends JpaRepository<JanelaMonitoramento,Long> {
 @Query("select j from JanelaMonitoramento j where j.monitor.id=:id and j.fimEm is null") Optional<JanelaMonitoramento> aberta(@Param("id") Long id);
 @Query("select j from JanelaMonitoramento j where j.monitor.equipamento.id=:id and j.fimEm is null") List<JanelaMonitoramento> abertasDoEquipamento(@Param("id") Long id);
 @Query("select j from JanelaMonitoramento j join fetch j.monitor where j.monitor.id in :ids and j.inicioEm < :fim and (j.fimEm is null or j.fimEm > :inicio)") List<JanelaMonitoramento> noPeriodo(@Param("ids") Collection<Long> ids,@Param("inicio") java.time.Instant inicio,@Param("fim") java.time.Instant fim);
 @Modifying(clearAutomatically = true, flushAutomatically = true)
 @Query("delete from JanelaMonitoramento j where j.monitor.id = :id") int apagarDoMonitor(@Param("id") Long id);
}

package br.com.inframonitor.relatorio.temporal;
import br.com.inframonitor.relatorio.entity.OrigemJanelaMonitoramento;
import java.time.*; import java.math.*; import java.util.*;
/** Deterministic [inicio,fim) calculator. Persistence adapters must prefilter each monitor. */
public final class DisponibilidadeTemporalCalculator {
 private DisponibilidadeTemporalCalculator(){}
 public record Janela(Instant inicio,Instant fim,Instant primeiraMedicao,OrigemJanelaMonitoramento origem){}
 public record Incidente(long id,Instant inicio,Instant fim){}
 public static ResultadoDisponibilidadeTemporal calcular(Instant inicio,Instant fim,List<Janela> janelas,List<Incidente> incidentes){
  if(!inicio.isBefore(fim)) return ResultadoDisponibilidadeTemporal.semDados(null);
  List<IntervaloTemporal> efetivas=new ArrayList<>(); boolean inferida=false;
  for(var j:janelas){ if(j.primeiraMedicao==null) continue; Instant a=max(inicio,j.inicio,j.primeiraMedicao), b=min(fim,j.fim==null?fim:j.fim); if(a.isBefore(b)){efetivas.add(new IntervaloTemporal(a,b)); inferida|=j.origem==OrigemJanelaMonitoramento.INFERIDA;} }
  efetivas=unir(efetivas); if(efetivas.isEmpty()) return ResultadoDisponibilidadeTemporal.semDados(null);
  List<IntervaloTemporal> quedas=new ArrayList<>(); Set<Long> ids=new HashSet<>();
  for(var i:incidentes){Instant ib=i.fim==null?fim:min(i.fim,fim); for(var j:efetivas){Instant a=max(i.inicio,j.inicio()),b=min(ib,j.fim());if(a.isBefore(b)){quedas.add(new IntervaloTemporal(a,b));ids.add(i.id);}}}
  long total=segundos(efetivas), indis=segundos(unir(quedas)), disp=total-indis;
  return new ResultadoDisponibilidadeTemporal(EstadoAnalitico.CALCULADO,inferida?OrigemJanelaMonitoramento.INFERIDA:OrigemJanelaMonitoramento.PRECISA,total,indis,disp,BigDecimal.valueOf(disp).multiply(BigDecimal.valueOf(100)).divide(BigDecimal.valueOf(total),2,RoundingMode.HALF_UP),ids.size()); }
 private static List<IntervaloTemporal> unir(List<IntervaloTemporal> xs){var s=new ArrayList<>(xs);s.sort(Comparator.comparing(IntervaloTemporal::inicio));var out=new ArrayList<IntervaloTemporal>();for(var x:s){if(out.isEmpty()||x.inicio().isAfter(out.getLast().fim()))out.add(x);else{var p=out.removeLast();out.add(new IntervaloTemporal(p.inicio(),max(p.fim(),x.fim())));}}return out;}
 private static long segundos(List<IntervaloTemporal>x){return x.stream().mapToLong(i->Duration.between(i.inicio(),i.fim()).getSeconds()).sum();} private static Instant max(Instant...x){return Arrays.stream(x).max(Comparator.naturalOrder()).orElseThrow();}private static Instant min(Instant...x){return Arrays.stream(x).min(Comparator.naturalOrder()).orElseThrow();}
}

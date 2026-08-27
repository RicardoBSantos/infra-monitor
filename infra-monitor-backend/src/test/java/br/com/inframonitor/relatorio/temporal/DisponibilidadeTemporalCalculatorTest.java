package br.com.inframonitor.relatorio.temporal;
import br.com.inframonitor.relatorio.entity.OrigemJanelaMonitoramento; import org.junit.jupiter.api.Test; import java.time.*; import java.util.*; import static org.junit.jupiter.api.Assertions.*;
class DisponibilidadeTemporalCalculatorTest {
 private static final Instant D=Instant.parse("2025-01-01T00:00:00Z"); private Instant t(int h,int m){return D.plusSeconds(h*3600L+m*60L);} private DisponibilidadeTemporalCalculator.Janela j(int a,int b,int first){return new DisponibilidadeTemporalCalculator.Janela(t(a,0),t(b,0),t(first,0),OrigemJanelaMonitoramento.PRECISA);} private DisponibilidadeTemporalCalculator.Incidente i(long id,int ah,int am,int bh,int bm){return new DisponibilidadeTemporalCalculator.Incidente(id,t(ah,am),t(bh,bm));}
 private ResultadoDisponibilidadeTemporal c(List<DisponibilidadeTemporalCalculator.Janela> j,List<DisponibilidadeTemporalCalculator.Incidente> i,int a,int b){return DisponibilidadeTemporalCalculator.calcular(t(a,0),t(b,0),j,i);} private void v(ResultadoDisponibilidadeTemporal r,long m,long x,long d,String p){assertEquals(m,r.tempoMonitoradoSegundos());assertEquals(x,r.tempoIndisponivelSegundos());assertEquals(d,r.tempoDisponivelSegundos());assertEquals(p,r.disponibilidadePercentual().toPlainString());}
 @Test void cenarioA(){v(c(List.of(j(10,11,10)),List.of(),10,11),3600,0,3600,"100.00");}
 @Test void cenarioB(){var r=c(List.of(j(10,11,10)),List.of(i(1,10,10,10,30),i(2,10,20,10,40)),10,11);v(r,3600,1800,1800,"50.00");assertEquals(2,r.incidentes());}
 @Test void cenarioC(){v(c(List.of(j(8,9,8),j(10,12,10)),List.of(i(1,8,30,10,30)),8,12),10800,3600,7200,"66.67");}
 @Test void cenarioD(){v(c(List.of(j(10,11,10).equals(null)?null:new DisponibilidadeTemporalCalculator.Janela(t(10,0),t(11,0),t(10,15),OrigemJanelaMonitoramento.PRECISA)),List.of(),10,11),2700,0,2700,"100.00");}
 @Test void cenarioE(){var j=new DisponibilidadeTemporalCalculator.Janela(t(10,0),t(11,0),t(10,15),OrigemJanelaMonitoramento.PRECISA);v(c(List.of(j),List.of(i(1,10,5,10,20)),10,11),2700,300,2400,"88.89");}
 @Test void cenarioF(){v(c(List.of(j(10,12,10)),List.of(new DisponibilidadeTemporalCalculator.Incidente(1,t(11,30),null)),10,12),7200,1800,5400,"75.00");}
 @Test void cenarioG(){v(c(List.of(j(10,11,10)),List.of(i(1,9,0,12,0)),10,11),3600,3600,0,"0.00");}
 @Test void cenarioH(){var r=c(List.of(j(10,11,10)),List.of(i(1,10,10,10,25),i(2,10,20,10,40),i(3,10,35,10,50)),10,11);v(r,3600,2400,1200,"33.33");assertEquals(3,r.incidentes());}
 @Test void cenarioI(){v(c(List.of(j(10,11,10)),List.of(i(1,8,0,9,0)),10,11),3600,0,3600,"100.00");}
 @Test void cenarioJ_K_P(){assertEquals(EstadoAnalitico.SEM_DADOS,c(List.of(new DisponibilidadeTemporalCalculator.Janela(t(10,0),t(11,0),null,OrigemJanelaMonitoramento.PRECISA)),List.of(),10,11).estadoAnalitico());assertEquals(EstadoAnalitico.SEM_DADOS,c(List.of(j(10,11,10)),List.of(),8,9).estadoAnalitico());assertNull(c(List.of(j(10,11,10)),List.of(),10,10).disponibilidadePercentual());}
 @Test void cenarioM_N_O(){var inf=new DisponibilidadeTemporalCalculator.Janela(t(10,0),t(11,0),t(10,0),OrigemJanelaMonitoramento.INFERIDA);assertEquals(OrigemJanelaMonitoramento.INFERIDA,c(List.of(inf),List.of(),10,11).qualidadeJanela());assertEquals(OrigemJanelaMonitoramento.INFERIDA,c(List.of(j(8,9,8),inf),List.of(),8,11).qualidadeJanela());}
}

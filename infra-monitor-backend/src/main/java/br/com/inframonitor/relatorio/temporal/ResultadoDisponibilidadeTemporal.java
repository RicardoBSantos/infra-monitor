package br.com.inframonitor.relatorio.temporal;
import br.com.inframonitor.relatorio.entity.OrigemJanelaMonitoramento;
import java.math.BigDecimal;
public record ResultadoDisponibilidadeTemporal(EstadoAnalitico estadoAnalitico, OrigemJanelaMonitoramento qualidadeJanela, Long tempoMonitoradoSegundos, Long tempoIndisponivelSegundos, Long tempoDisponivelSegundos, BigDecimal disponibilidadePercentual, long incidentes) {
 public static ResultadoDisponibilidadeTemporal semDados(OrigemJanelaMonitoramento q){return new ResultadoDisponibilidadeTemporal(EstadoAnalitico.SEM_DADOS,q,null,null,null,null,0);}
}

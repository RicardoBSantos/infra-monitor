package br.com.inframonitor.relatorio.entity;
import br.com.inframonitor.monitor.entity.Monitor;
import jakarta.persistence.*;
import java.time.Instant;
/**
 * A coluna primeira_medicao_em (V24) NAO e mapeada de proposito: e mantida por gatilho no banco, e o
 * update de todas as colunas que o Hibernate emite em fechar() regravaria por cima o valor do gatilho.
 * Quem precisa dela e o SQL de disponibilidade, que le direto da tabela.
 */
@Entity @Table(name="janela_monitoramento")
public class JanelaMonitoramento {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
 @ManyToOne(fetch=FetchType.LAZY,optional=false) @JoinColumn(name="monitor_id") private Monitor monitor;
 @Column(name="inicio_em",nullable=false) private Instant inicioEm;
 @Column(name="fim_em") private Instant fimEm;
 @Enumerated(EnumType.STRING) @Column(nullable=false) private OrigemJanelaMonitoramento origem;
 protected JanelaMonitoramento(){}
 public JanelaMonitoramento(Monitor m,Instant inicio,OrigemJanelaMonitoramento o){monitor=m;inicioEm=inicio;origem=o;}
 public Long getId(){return id;} public Monitor getMonitor(){return monitor;} public Instant getInicioEm(){return inicioEm;} public Instant getFimEm(){return fimEm;} public OrigemJanelaMonitoramento getOrigem(){return origem;}
 public void fechar(Instant fim){ if(fim.isBefore(inicioEm)) throw new IllegalArgumentException("Fim da janela anterior ao inicio"); fimEm=fim; }
}

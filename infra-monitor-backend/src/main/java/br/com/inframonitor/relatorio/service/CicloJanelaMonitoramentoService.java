package br.com.inframonitor.relatorio.service;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.relatorio.entity.*;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
@Service
public class CicloJanelaMonitoramentoService {
 private final JanelaMonitoramentoRepository repo; private final Clock clock;
 public CicloJanelaMonitoramentoService(JanelaMonitoramentoRepository r, @Qualifier("monitoringClock") Clock clock){repo=r;this.clock=clock;}
 @Transactional public void abrir(Monitor m){ if(repo.aberta(m.getId()).isEmpty()) repo.save(new JanelaMonitoramento(m,Instant.now(clock),OrigemJanelaMonitoramento.PRECISA)); }
 @Transactional public void fechar(Monitor m){repo.aberta(m.getId()).ifPresent(j->j.fechar(Instant.now(clock)));}
 @Transactional public void fecharEquipamento(Long id){repo.abertasDoEquipamento(id).forEach(j->j.fechar(Instant.now(clock)));}
}

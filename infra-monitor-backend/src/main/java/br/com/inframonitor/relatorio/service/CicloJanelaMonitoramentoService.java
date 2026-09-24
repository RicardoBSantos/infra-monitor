package br.com.inframonitor.relatorio.service;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.relatorio.entity.*;
import br.com.inframonitor.relatorio.repository.JanelaMonitoramentoRepository;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.List;
@Service
public class CicloJanelaMonitoramentoService {
 private final JanelaMonitoramentoRepository repo; private final MonitorRepository monitorRepository; private final Clock clock;
 public CicloJanelaMonitoramentoService(JanelaMonitoramentoRepository r, MonitorRepository monitorRepository, @Qualifier("monitoringClock") Clock clock){repo=r;this.monitorRepository=monitorRepository;this.clock=clock;}

 /**
  * Invariante: existe janela aberta para um monitor se e somente se ele e' candidato
  * a execucao — equipamento.ativo AND monitor.ativo AND NOT equipamento.em_manutencao,
  * a mesma expressao do WHERE de findActiveExecutionCandidates. Se divergirem, ou se
  * mede tempo em que nao se pinga (SLA punindo silencio administrativo), ou se pinga
  * tempo que nao se mede (queda invisivel).
  *
  * <p>A guarda mora AQUI e nao nos chamadores: abrir tem tres pontos de entrada, e
  * repetir a condicao em tres lugares e garantir que um dia sobre um sem ela.
  */
 @Transactional public void abrir(Monitor m){
   if(!m.isAtivo() || !m.getEquipamento().isAtivo() || m.getEquipamento().isEmManutencao()) return;
   if(repo.aberta(m.getId()).isEmpty()) repo.save(new JanelaMonitoramento(m,Instant.now(clock),OrigemJanelaMonitoramento.PRECISA));
 }

 @Transactional public void fechar(Monitor m){repo.aberta(m.getId()).ifPresent(j->j.fechar(Instant.now(clock)));}
 @Transactional public void fecharEquipamento(Long id){repo.abertasDoEquipamento(id).forEach(j->j.fechar(Instant.now(clock)));}

 /**
  * Irmao simetrico de fecharEquipamento. Absorve o bloco inline que vivia em
  * EquipamentoService.ativar. Dois chamadores: ativar e sairDeManutencao.
  *
  * <p>Reavalia o predicado inteiro, e nao so' a manutencao: as linhas 4, 6 e 8 da
  * matriz sao alcancaveis porque entrarEmManutencao nao valida ativo.
  */
 @Transactional public void abrirEquipamento(Long equipamentoId){
   monitorRepository.findByEquipamentoIdIn(List.of(equipamentoId)).forEach(this::abrir);
 }

 /**
  * Exclusao fisica de monitor: a FK de janela_monitoramento e ON DELETE RESTRICT, e
  * criar/ativar sempre abrem janela — sem isto nenhum monitor ativo sem historico podia
  * ser excluido. Apagar, nao fechar: so e chamado depois das guardas de medicao e
  * incidente, entao nao ha periodo observado a preservar no relatorio.
  */
 @Transactional public void apagarDoMonitor(Long monitorId){repo.apagarDoMonitor(monitorId);}
}

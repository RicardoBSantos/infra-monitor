package br.com.inframonitor.equipamento.service;

import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatencia;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatenciaRepository;
import br.com.inframonitor.monitoring.latency.MotivoEncerramentoEpisodio;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import br.com.inframonitor.relatorio.service.CicloJanelaMonitoramentoService;
import br.com.inframonitor.usuario.entity.Usuario;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.List;

/**
 * Efeitos de entrar e de sair da manutencao efetiva, sem decidir SE entram: quem decide e
 * {@link EstadoManutencaoEquipamento}, que ja virou em_manutencao sob o lock da linha do
 * equipamento antes de chamar aqui.
 *
 * <p>NAO e @Transactional de proposito: roda dentro da transacao de quem chama, para que a
 * virada do flag e os efeitos commitem juntos ou nao commitem.
 */
@Component
public class EfeitosManutencao {

    private final IncidenteRepository incidenteRepository;
    private final MonitorEpisodioLatenciaRepository episodioRepository;
    private final CicloJanelaMonitoramentoService cicloJanela;
    private final NotificacaoService notificacaoService;

    public EfeitosManutencao(IncidenteRepository incidenteRepository, MonitorEpisodioLatenciaRepository episodioRepository,
                             CicloJanelaMonitoramentoService cicloJanela, NotificacaoService notificacaoService) {
        this.incidenteRepository = incidenteRepository;
        this.episodioRepository = episodioRepository;
        this.cicloJanela = cicloJanela;
        this.notificacaoService = notificacaoService;
    }

    /**
     * Fechamento, janela, notificacao. O flag ja foi gravado por quem chama: qualquer
     * processor a caminho encontra em_manutencao = true e nao abre nada; qualquer um que
     * tenha aberto ANTES do flag e' fechado pelo passo 2.
     */
    public void aplicarEntrada(Long equipamentoId, Usuario autor, Instant agora) {
        // 2. incidentes em aberto: os ids sao lidos ANTES do bulk update, porque depois
        //    dele eles ja nao satisfazem o filtro e a notificacao precisa saber quais
        //    eram.
        List<Long> incidentesAfetadosIds = incidenteRepository.abertosDoEquipamento(equipamentoId).stream()
                .map(Incidente::getId).toList();
        incidenteRepository.fecharPorManutencao(equipamentoId, autor, agora);
        // 3. episodios de latencia em aberto
        List<Long> episodiosAfetadosIds = episodioRepository.abertosDoEquipamento(equipamentoId).stream()
                .map(MonitorEpisodioLatencia::getId).toList();
        episodioRepository.encerrarPorManutencao(equipamentoId, agora);
        // 4. janelas: sem isto o SLA continua descontando o periodo de manutencao
        cicloJanela.fecharEquipamento(equipamentoId);
        // 5. notificacoes: cancela a abertura pendente, avisa o encerramento quando a
        //    abertura ja foi despachada. RELEITURA por id, e nao os objetos capturados
        //    no passo 2/3: fecharPorManutencao/encerrarPorManutencao sao bulk update
        //    (clearAutomatically) e nao repropagam para instancias Java ja carregadas
        //    — a mesma licao que fez IncidenteService.reconhecer reler antes de
        //    responder. Sem reler, NotificacaoMessageBuilder monta a mensagem com
        //    encerradoEm ainda nulo ("Fim: null"), porque os objetos antigos continuam
        //    com status ABERTO e encerradoEm nulo em memoria.
        //    So notifica o que ESTA manutencao fechou: um id lido no passo 2 pode ter
        //    sido fechado pelo motor (fecharAutomaticamente, CAS) antes do bulk update,
        //    que entao o pula; notificar esse incidente somaria INCIDENTE_ENCERRADO_MANUTENCAO
        //    ao INCIDENTE_FECHADO do motor.
        incidenteRepository.findAllById(incidentesAfetadosIds).stream()
                .filter(incidente -> incidente.getMotivoEncerramento() == MotivoEncerramentoIncidente.MANUTENCAO)
                .forEach(incidente -> notificacaoService.tratarEncerramentoPorManutencao(incidente, agora));
        //    Mesmo filtro dos incidentes: um episodio lido no passo 3 pode ter sido normalizado
        //    pelo motor (CAS) antes do bulk update, que entao o pula.
        episodioRepository.findAllById(episodiosAfetadosIds).stream()
                .filter(episodio -> episodio.getMotivoEncerramento() == MotivoEncerramentoEpisodio.MANUTENCAO)
                .forEach(episodio -> notificacaoService.tratarEncerramentoPorManutencao(episodio, agora));
    }

    /**
     * Saida: REAVALIA o predicado inteiro da janela de SLA, e nao so' a manutencao.
     * As linhas 4, 6 e 8 da matriz da B.5 sao alcancaveis porque entrar em manutencao
     * nao valida ativo: sair nao pode presumir que o equipamento esta ativo.
     */
    public void aplicarSaida(Long equipamentoId) {
        cicloJanela.abrirEquipamento(equipamentoId);
    }
}

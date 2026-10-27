package br.com.inframonitor.equipamento.service;

import br.com.inframonitor.equipamento.repository.SessaoManutencaoManual;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao;
import br.com.inframonitor.notificacao.service.ColetaDoAnuncio;
import br.com.inframonitor.notificacao.service.DadosAnuncio;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Monta os dados dos anuncios do botao manual e entrega a {@link NotificacaoService}. Roda na
 * transacao de {@link EstadoManutencaoEquipamento}: anuncio e flag confirmam juntos ou nenhum.
 */
@Service
public class AnuncioManutencaoManual {

    private static final Logger log = LoggerFactory.getLogger(AnuncioManutencaoManual.class);

    private final SessaoManutencaoManual sessoes;
    private final CoberturaManutencao cobertura;
    private final NotificacaoService notificacoes;
    private final ColetaDoAnuncio coleta;

    public AnuncioManutencaoManual(SessaoManutencaoManual sessoes, CoberturaManutencao cobertura,
                                   NotificacaoService notificacoes, ColetaDoAnuncio coleta) {
        this.sessoes = sessoes;
        this.cobertura = cobertura;
        this.notificacoes = notificacoes;
        this.coleta = coleta;
    }

    /**
     * {@code jaEmManutencao} e o em_manutencao lido sob o lock (o mesmo estado que decide os efeitos de entrada).
     * So quando true se busca a janela para citar; se nenhuma cobre (flag divergente), o texto diz so "ja estava".
     */
    public void anunciarInicio(long sessaoId, long equipamentoId, boolean jaEmManutencao, Instant agora) {
        DadosAnuncio.Manual dados = sessoes.dados(sessaoId).orElseThrow();
        DadosAnuncio.JanelaVigente janela = jaEmManutencao ? cobertura.janelaVigente(equipamentoId).orElse(null) : null;
        notificacoes.criarParaManualIniciada(dados, jaEmManutencao, janela, agora);
    }

    /**
     * {@code segue} e o resultado da reavaliacao: o equipamento continua em manutencao por janela.
     *
     * <p>MA31, correcao de 2026-10-26: no FIM a falha ao reunir os dados nao desfaz o encerramento (o
     * equipamento ficaria em manutencao com os alertas suprimidos): ERROR no log e texto de reserva. A
     * coleta roda num savepoint para que um erro de SQL nao aborte a transacao do lock. O cancelamento e
     * o INSERT continuam estourando.
     */
    public void anunciarFim(long sessaoId, long equipamentoId, String encerradaPorNome, boolean segue,
                            Instant encerradaEm) {
        AtomicReference<String> nome = new AtomicReference<>();   // o que a coleta obteve antes de falhar
        DadosFim d;
        try {
            d = coleta.emSavepoint(() -> {
                DadosAnuncio.Manual dados = sessoes.dados(sessaoId).orElseThrow();
                nome.set(dados.equipamentoNome());
                return new DadosFim(dados, segue ? cobertura.janelaVigente(equipamentoId).orElse(null) : null);
            });
        } catch (RuntimeException e) {
            log.error("Falha ao reunir os dados do anuncio de fim da manutencao manual do equipamento {} (sessao {}); "
                    + "gravado o texto de reserva", equipamentoId, sessaoId, e);
            notificacoes.criarParaManualEncerradaReserva(sessaoId, nome.get(), equipamentoId, encerradaEm);
            return;
        }
        notificacoes.criarParaManualEncerrada(d.dados(), equipamentoId, encerradaEm, encerradaPorNome, segue,
                d.janela());
    }

    private record DadosFim(DadosAnuncio.Manual dados, DadosAnuncio.JanelaVigente janela) {
    }
}

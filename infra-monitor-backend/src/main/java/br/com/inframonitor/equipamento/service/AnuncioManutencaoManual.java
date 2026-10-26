package br.com.inframonitor.equipamento.service;

import br.com.inframonitor.equipamento.repository.SessaoManutencaoManual;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao;
import br.com.inframonitor.notificacao.service.DadosAnuncio;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import org.springframework.stereotype.Service;

import java.time.Instant;

/**
 * Monta os dados dos anuncios do botao manual e entrega a {@link NotificacaoService}. Roda na
 * transacao de {@link EstadoManutencaoEquipamento}: anuncio e flag confirmam juntos ou nenhum.
 */
@Service
public class AnuncioManutencaoManual {

    private final SessaoManutencaoManual sessoes;
    private final CoberturaManutencao cobertura;
    private final NotificacaoService notificacoes;

    public AnuncioManutencaoManual(SessaoManutencaoManual sessoes, CoberturaManutencao cobertura,
                                   NotificacaoService notificacoes) {
        this.sessoes = sessoes;
        this.cobertura = cobertura;
        this.notificacoes = notificacoes;
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

    /** {@code segue} e o resultado da reavaliacao: o equipamento continua em manutencao por janela. */
    public void anunciarFim(long sessaoId, long equipamentoId, String encerradaPorNome, boolean segue,
                            Instant encerradaEm) {
        DadosAnuncio.Manual dados = sessoes.dados(sessaoId).orElseThrow();
        DadosAnuncio.JanelaVigente janela = segue ? cobertura.janelaVigente(equipamentoId).orElse(null) : null;
        notificacoes.criarParaManualEncerrada(dados, encerradaEm, encerradaPorNome, segue, janela);
    }
}

package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.manutencao.entity.EscopoManutencao;

import java.time.Instant;
import java.util.List;

/** Dados prontos para os textos de manutencao: o builder nao toca em banco nem em entidade. */
public final class DadosAnuncio {

    private DadosAnuncio() {
    }

    /** {@code nomesEquipamentos} ordenados por nome, todos (o builder corta em 5). */
    public record Janela(long id, String unidadeNome, EscopoManutencao escopo, int totalEquipamentos,
                         List<String> nomesEquipamentos, String motivo, Instant inicioPrevisto,
                         Instant fimPrevisto, String criadoPorNome) {
    }

    public record Manual(long sessaoId, String unidadeNome, String equipamentoNome, String ip,
                         Instant iniciadaEm, String iniciadaPorNome) {
    }

    public record JanelaVigente(long id, Instant fimPrevisto) {
    }

    public enum TipoTermino { COMO_PREVISTO, ANTECIPADO, APOS_PRORROGACAO, APOS_ANTECIPACAO }

    public record Termino(TipoTermino tipo, String autorNome, Instant fimOriginal, Instant fimFinal) {
    }

    /** {@code janelaId} nulo significa manutencao manual. */
    public record Seguinte(String equipamentoNome, Long janelaId) {
    }

    public enum EntregaInicio { ENTREGUE, NAO_ENTREGUE, TALVEZ_ENTREGUE }
}

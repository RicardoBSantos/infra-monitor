package br.com.inframonitor.manutencao.service;

import br.com.inframonitor.manutencao.config.ManutencaoAgendadaProperties;
import br.com.inframonitor.manutencao.entity.EscopoManutencao;
import br.com.inframonitor.manutencao.entity.TipoAlteracao;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao;
import br.com.inframonitor.notificacao.service.DadosAnuncio;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Anuncios da janela (MA27/MA28): chamado DE DENTRO do {@code transacao.execute} que faz o CAS da
 * transicao, pelo reconciliador e pelo service. Le tudo na transacao corrente e entrega a
 * {@link NotificacaoService}, que entra nela (MA31): CAS e anuncio confirmam juntos ou nenhum. Por
 * isso uma falha aqui nao e engolida: desfaz a transicao, e a passada seguinte (ou o reconciliador,
 * depois de criar/editar) tenta de novo. Exatamente uma vez acima de disponibilidade.
 *
 * <p>O {@code agora} de cada metodo e o MESMO instante que o CAS gravou (ativada_em, encerrada_em,
 * alterado_em): o chamador o captura numa variavel e passa aos dois.
 *
 * <p>Nao condicional: o service tambem transiciona (encerrar, alterar fim) e precisa dele mesmo com
 * o agendador desligado.
 */
@Component
public class AnuncioManutencao {

    private final NamedParameterJdbcTemplate jdbc;
    private final CoberturaManutencao cobertura;
    private final NotificacaoService notificacoes;
    private final ManutencaoAgendadaProperties props;

    public AnuncioManutencao(NamedParameterJdbcTemplate jdbc, CoberturaManutencao cobertura,
                             NotificacaoService notificacoes, ManutencaoAgendadaProperties props) {
        this.jdbc = jdbc;
        this.cobertura = cobertura;
        this.notificacoes = notificacoes;
        this.props = props;
    }

    /**
     * Depois do CAS AGENDADA -> ATIVA. Atrasado quando a ativacao real passou do previsto por mais de
     * duas passadas do reconciliador: o sistema esteve fora no horario. So o job pode dizer isso
     * ({@code peloJob}): criar/editar com inicio ate 5 min no passado ativa com o servidor no ar.
     */
    public void anunciarInicio(long janelaId, Instant agora, boolean peloJob) {
        Linha l = ler(janelaId);
        boolean atrasado = peloJob && Duration.between(l.janela().inicioPrevisto(), agora)
                .compareTo(Duration.ofMillis(2 * props.getIntervaloMs())) > 0;
        notificacoes.criarParaManutencaoIniciada(l.janela(), agora, atrasado);
    }

    /**
     * Depois do CAS ATIVA -> CONCLUIDA (job ou pessoa). "Seguem em manutencao" e lido aqui, antes da
     * reavaliacao dos equipamentos, que vem por equipamento depois do commit: mostra a intencao.
     */
    public void anunciarFim(long janelaId, Instant agora) {
        Linha l = ler(janelaId);
        List<DadosAnuncio.Seguinte> seguem = cobertura.seguemEmManutencao(janelaId, l.cobertos());
        notificacoes.criarParaManutencaoEncerrada(l.janela(), l.ativadaEm(), agora, termino(janelaId, l), seguem);
    }

    /** Depois de gravar o fim e registrar a alteracao. Nome do autor lido mesmo se o usuario estiver inativo. */
    public void anunciarFimAlterado(long janelaId, Instant fimAnterior, Instant fimNovo, long autorId, Instant agora) {
        Linha l = ler(janelaId);
        notificacoes.criarParaManutencaoFimAlterado(l.janela(), fimAnterior, fimNovo, nomeUsuario(autorId), agora);
    }

    /**
     * Encerrada por pessoa: antecipado (previsto = fim vigente). Senao, a ultima alteracao de fim decide:
     * fim original = o "antes" da primeira, fim final = o "depois" da ultima, autor = o da ultima.
     */
    private DadosAnuncio.Termino termino(long janelaId, Linha l) {
        if (l.encerradaPorNome() != null) {
            return new DadosAnuncio.Termino(DadosAnuncio.TipoTermino.ANTECIPADO, l.encerradaPorNome(),
                    l.janela().fimPrevisto(), l.janela().fimPrevisto());
        }
        List<Alteracao> alteracoes = jdbc.query("""
                SELECT a.tipo, (a.antes->>'fimPrevisto') AS antes_fim, (a.depois->>'fimPrevisto') AS depois_fim,
                       u.nome
                  FROM manutencao_agendada_alteracao a JOIN usuarios u ON u.id = a.alterado_por_id
                 WHERE a.manutencao_id = :id AND a.tipo IN ('PRORROGACAO', 'ANTECIPACAO')
                 ORDER BY a.alterado_em, a.id""", Map.of("id", janelaId),
                (rs, i) -> new Alteracao(TipoAlteracao.valueOf(rs.getString("tipo")),
                        Instant.parse(rs.getString("antes_fim")), Instant.parse(rs.getString("depois_fim")),
                        rs.getString("nome")));
        if (alteracoes.isEmpty()) {
            return new DadosAnuncio.Termino(DadosAnuncio.TipoTermino.COMO_PREVISTO, null,
                    l.janela().fimPrevisto(), l.janela().fimPrevisto());
        }
        Alteracao ultima = alteracoes.get(alteracoes.size() - 1);
        DadosAnuncio.TipoTermino tipo = ultima.tipo() == TipoAlteracao.PRORROGACAO
                ? DadosAnuncio.TipoTermino.APOS_PRORROGACAO : DadosAnuncio.TipoTermino.APOS_ANTECIPACAO;
        return new DadosAnuncio.Termino(tipo, ultima.autorNome(), alteracoes.get(0).fimAntes(), ultima.fimDepois());
    }

    private Linha ler(long janelaId) {
        Linha base = jdbc.queryForObject("""
                SELECT ma.id, un.nome AS unidade_nome, ma.escopo, ma.motivo, ma.inicio_previsto, ma.fim_previsto,
                       ma.ativada_em, criador.nome AS criador_nome, encerrador.nome AS encerrador_nome
                  FROM manutencao_agendada ma
                  JOIN unidade un ON un.id = ma.unidade_id
                  JOIN usuarios criador ON criador.id = ma.criado_por_id
                  LEFT JOIN usuarios encerrador ON encerrador.id = ma.encerrada_por_id
                 WHERE ma.id = :id""", Map.of("id", janelaId), (rs, i) -> linha(rs));
        // Contagem e nomes lidos no instante da transicao (escopo UNIDADE e dinamico).
        List<Long> cobertos = cobertura.cobertosPor(janelaId);
        EscopoManutencao escopo = base.janela().escopo();
        List<String> nomes = escopo == EscopoManutencao.EQUIPAMENTOS ? cobertura.nomes(cobertos) : List.of();
        DadosAnuncio.Janela j = base.janela();
        return new Linha(new DadosAnuncio.Janela(j.id(), j.unidadeNome(), escopo, cobertos.size(), nomes, j.motivo(),
                j.inicioPrevisto(), j.fimPrevisto(), j.criadoPorNome()), base.ativadaEm(), base.encerradaPorNome(),
                cobertos);
    }

    private static Linha linha(ResultSet rs) throws SQLException {
        DadosAnuncio.Janela j = new DadosAnuncio.Janela(rs.getLong("id"), rs.getString("unidade_nome"),
                EscopoManutencao.valueOf(rs.getString("escopo")), 0, List.of(), rs.getString("motivo"),
                instante(rs, "inicio_previsto"), instante(rs, "fim_previsto"), rs.getString("criador_nome"));
        return new Linha(j, instante(rs, "ativada_em"), rs.getString("encerrador_nome"), List.of());
    }

    private String nomeUsuario(long usuarioId) {
        return jdbc.queryForObject("SELECT nome FROM usuarios WHERE id = :id", Map.of("id", usuarioId), String.class);
    }

    private static Instant instante(ResultSet rs, String coluna) throws SQLException {
        Timestamp ts = rs.getTimestamp(coluna);
        return ts == null ? null : ts.toInstant();
    }

    private record Linha(DadosAnuncio.Janela janela, Instant ativadaEm, String encerradaPorNome, List<Long> cobertos) {
    }

    private record Alteracao(TipoAlteracao tipo, Instant fimAntes, Instant fimDepois, String autorNome) {
    }
}

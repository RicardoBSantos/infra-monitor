package br.com.inframonitor.configuracao.service;

import br.com.inframonitor.configuracao.TelaModoTv;
import br.com.inframonitor.configuracao.dto.AtualizarConfiguracaoModoTvRequest;
import br.com.inframonitor.configuracao.dto.ConfiguracaoModoTvResponse;
import br.com.inframonitor.configuracao.dto.TelaModoTvRequest;
import br.com.inframonitor.configuracao.dto.TelaModoTvResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Configuracao do modo TV por JDBC, sem entidade JPA: producao pode subir com Flyway desligado e o jar novo
 * antes da V27. Tabela ausente ou sem privilegio: GET devolve os padroes, PUT lanca
 * {@link ConfiguracaoIndisponivelException} (503).
 */
@Service
public class ConfiguracaoModoTvService {
    private static final Logger log = LoggerFactory.getLogger(ConfiguracaoModoTvService.class);
    /** 42P01 undefined_table, 42501 insufficient_privilege. */
    private static final Set<String> ESTRUTURAIS = Set.of("42P01", "42501");

    static final ConfiguracaoModoTvResponse PADRAO = new ConfiguracaoModoTvResponse(true, 60, List.of(
            new TelaModoTvResponse(TelaModoTv.MAPA, 1, 60),
            new TelaModoTvResponse(TelaModoTv.PAINEL, 2, 60),
            new TelaModoTvResponse(TelaModoTv.INCIDENTES, 3, 60),
            new TelaModoTvResponse(TelaModoTv.RELATORIOS, 4, 60)), false, null);

    private record Linha(long id, boolean ativo, int intervalo, Instant atualizadoEm) { }

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    public ConfiguracaoModoTvService(JdbcTemplate jdbc, PlatformTransactionManager tm) {
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(tm);
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public ConfiguracaoModoTvResponse obter() {
        try {
            ConfiguracaoModoTvResponse r = tx.execute(s -> ler());
            return r != null ? r : PADRAO;
        } catch (DataAccessException | TransactionException e) {
            if (!estrutural(e)) throw e;
            log.warn("Configuracao do modo TV indisponivel (V27 aplicada?); usando padroes: {}", raiz(e));
            return PADRAO;
        }
    }

    public ConfiguracaoModoTvResponse atualizar(AtualizarConfiguracaoModoTvRequest req, long usuarioId) {
        try {
            return tx.execute(s -> gravar(req, usuarioId));
        } catch (DataAccessException | TransactionException e) {
            if (!estrutural(e)) throw e;
            log.warn("Configuracao do modo TV indisponivel (V27 aplicada?); PUT recusado: {}", raiz(e));
            throw new ConfiguracaoIndisponivelException(e);
        }
    }

    private ConfiguracaoModoTvResponse gravar(AtualizarConfiguracaoModoTvRequest req, long usuarioId) {
        ConfiguracaoModoTvResponse atual = ler();
        ConfiguracaoModoTvResponse base = atual != null ? atual : PADRAO;
        boolean ativo = req.ativo() != null ? req.ativo() : base.ativo();
        int intervalo = req.intervaloAtualizacaoSegundos() != null ? req.intervaloAtualizacaoSegundos() : base.intervaloAtualizacaoSegundos();
        long id = jdbc.queryForObject("""
                insert into configuracao_modo_tv (ativo, intervalo_atualizacao_segundos, atualizado_em, atualizado_por)
                values (?, ?, ?, ?)
                on conflict ((true)) do update set ativo = excluded.ativo,
                    intervalo_atualizacao_segundos = excluded.intervalo_atualizacao_segundos,
                    atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por
                returning id""", Long.class, ativo, intervalo, Timestamp.from(Instant.now()), usuarioId);
        List<TelaModoTvRequest> telas = req.telas();
        if (telas != null) {
            jdbc.update("delete from configuracao_modo_tv_tela where configuracao_id = ?", id);
            int ordem = 1;
            for (TelaModoTvRequest t : telas) {
                inserirTela(id, t.tela(), ordem++, t.duracaoSegundos());
            }
        } else if (atual == null) {
            // Primeiro PUT sem telas: grava as telas padrao, para a linha nunca existir sem lista.
            for (TelaModoTvResponse t : PADRAO.telas()) {
                inserirTela(id, t.tela(), t.ordem(), t.duracaoSegundos());
            }
        }
        return ler();
    }

    private void inserirTela(long id, TelaModoTv tela, int ordem, int duracao) {
        jdbc.update("insert into configuracao_modo_tv_tela (configuracao_id, tela, ordem, duracao_segundos) values (?, ?, ?, ?)",
                id, tela.name(), ordem, duracao);
    }

    private ConfiguracaoModoTvResponse ler() {
        List<Linha> linhas = jdbc.query("select id, ativo, intervalo_atualizacao_segundos, atualizado_em from configuracao_modo_tv",
                (rs, n) -> new Linha(rs.getLong(1), rs.getBoolean(2), rs.getInt(3), rs.getTimestamp(4).toInstant()));
        if (linhas.isEmpty()) return null;
        Linha l = linhas.get(0);
        List<TelaModoTvResponse> telas = new ArrayList<>(jdbc.query(
                "select tela, ordem, duracao_segundos from configuracao_modo_tv_tela where configuracao_id = ? order by ordem",
                (rs, n) -> new TelaModoTvResponse(TelaModoTv.valueOf(rs.getString(1)), rs.getInt(2), rs.getInt(3)), l.id()));
        return new ConfiguracaoModoTvResponse(l.ativo(), l.intervalo(), telas, true, l.atualizadoEm());
    }

    static boolean estrutural(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof BadSqlGrammarException) return true;
            if (t instanceof SQLException q && q.getSQLState() != null && ESTRUTURAIS.contains(q.getSQLState())) return true;
            if (t.getCause() == t) break;
        }
        return false;
    }

    private static String raiz(Throwable e) {
        Throwable r = e;
        while (r.getCause() != null && r.getCause() != r) r = r.getCause();
        return String.valueOf(r.getMessage()).replace('\n', ' ');
    }
}

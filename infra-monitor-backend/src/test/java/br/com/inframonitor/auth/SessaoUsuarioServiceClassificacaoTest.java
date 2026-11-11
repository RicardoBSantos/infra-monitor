package br.com.inframonitor.auth;

import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.transaction.CannotCreateTransactionException;

import java.sql.SQLException;

import static org.assertj.core.api.Assertions.assertThat;

/** Estrutural (tabela ausente, sem privilegio) vira "sem sessao"; o resto e transitorio e nao pode derrubar a sessao. */
class SessaoUsuarioServiceClassificacaoTest {

    @Test
    void tabelaAusenteESemPrivilegioSaoEstruturais() {
        assertThat(SessaoUsuarioService.estrutural(new BadSqlGrammarException("update", "sql", new SQLException("nao existe", "42P01")))).isTrue();
        assertThat(SessaoUsuarioService.estrutural(new UncategorizedSQLException("update", "sql", new SQLException("permission denied", "42501")))).isTrue();
        assertThat(SessaoUsuarioService.estrutural(new CannotCreateTransactionException("tx", new SQLException("nao existe", "42P01")))).isTrue();
    }

    @Test
    void falhasTransitoriasNaoSaoEstruturais() {
        assertThat(SessaoUsuarioService.estrutural(new QueryTimeoutException("timeout"))).isFalse();
        assertThat(SessaoUsuarioService.estrutural(new CannotGetJdbcConnectionException("pool", new SQLException("timeout", "08001")))).isFalse();
        assertThat(SessaoUsuarioService.estrutural(new CannotCreateTransactionException("tx", new SQLException("restart", "57P01")))).isFalse();
    }
}

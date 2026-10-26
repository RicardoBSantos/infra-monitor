package br.com.inframonitor.notificacao.service;

import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Savepoint;
import java.util.function.Supplier;

/**
 * Coleta dos dados de um anuncio de FIM num savepoint da transacao corrente (MA31, correcao de
 * 2026-10-26). Um erro de SQL na coleta aborta a transacao no Postgres; voltando ao savepoint, o CAS
 * ja feito continua valendo e o fim de reserva ainda entra. Savepoint JDBC direto na conexao da
 * transacao: o gerenciador de transacao do Boot nao permite NESTED, e liga-lo valeria para a app toda.
 *
 * <p>A excecao da coleta sempre sobe: quem chama decide (log + texto de reserva).
 */
@Component
public class ColetaDoAnuncio {

    private final DataSource dataSource;

    public ColetaDoAnuncio(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    public <T> T emSavepoint(Supplier<T> coleta) {
        if (!TransactionSynchronizationManager.isActualTransactionActive()) {
            return coleta.get();   // sem transacao nao ha o que abortar
        }
        Connection conexao = DataSourceUtils.getConnection(dataSource);
        try {
            Savepoint savepoint = conexao.setSavepoint();
            T dados;
            try {
                dados = coleta.get();
            } catch (RuntimeException e) {
                conexao.rollback(savepoint);
                throw e;
            }
            conexao.releaseSavepoint(savepoint);
            return dados;
        } catch (SQLException e) {
            throw new IllegalStateException("Falha no savepoint da coleta do anuncio", e);
        } finally {
            DataSourceUtils.releaseConnection(conexao, dataSource);
        }
    }
}

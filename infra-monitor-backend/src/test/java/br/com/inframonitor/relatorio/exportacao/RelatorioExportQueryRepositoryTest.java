package br.com.inframonitor.relatorio.exportacao;

import org.junit.jupiter.api.Test;

import javax.sql.DataSource;
import java.io.ByteArrayOutputStream;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class RelatorioExportQueryRepositoryTest {
    @Test
    void configuraTransacaoSnapshotCursorForwardOnlyEFetchSize() throws Exception {
        DataSource dataSource=mock(DataSource.class);Connection connection=mock(Connection.class);
        PreparedStatement count=mock(PreparedStatement.class),data=mock(PreparedStatement.class);
        ResultSet countRows=mock(ResultSet.class),dataRows=mock(ResultSet.class);
        when(dataSource.getConnection()).thenReturn(connection);when(connection.prepareStatement(anyString())).thenReturn(count);
        when(count.executeQuery()).thenReturn(countRows);when(countRows.next()).thenReturn(true);when(countRows.getLong(1)).thenReturn(0L);
        when(connection.prepareStatement(anyString(),eq(ResultSet.TYPE_FORWARD_ONLY),eq(ResultSet.CONCUR_READ_ONLY))).thenReturn(data);
        when(data.executeQuery()).thenReturn(dataRows);when(dataRows.next()).thenReturn(false);
        var repository=new RelatorioExportQueryRepository(dataSource,100000,321,60);
        var definition=new RelatorioExportQueryRepository.QueryDefinition("select count(*) from x","select * from x",Map.of(),new String[]{"id"},row->new Object[]{row.getLong(1)});

        var prepared=repository.prepare(definition);var output=new ByteArrayOutputStream();var result=prepared.stream(output);

        verify(connection).setAutoCommit(false);verify(connection).setReadOnly(true);
        verify(connection).setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
        verify(data).setFetchDirection(ResultSet.FETCH_FORWARD);verify(data).setFetchSize(321);
        verify(connection).commit();verify(connection).close();
        assertThat(result.rows()).isZero();assertThat(output.toByteArray()).startsWith(CsvWriter.UTF8_BOM);
    }

    @Test
    void limiteEVerificadoAntesDeCriarCursorOuEscreverCsv() throws Exception {
        DataSource dataSource=mock(DataSource.class);Connection connection=mock(Connection.class);
        PreparedStatement count=mock(PreparedStatement.class);ResultSet rows=mock(ResultSet.class);
        when(dataSource.getConnection()).thenReturn(connection);when(connection.prepareStatement(anyString())).thenReturn(count);
        when(count.executeQuery()).thenReturn(rows);when(rows.next()).thenReturn(true);when(rows.getLong(1)).thenReturn(100001L);
        var repository=new RelatorioExportQueryRepository(dataSource,100000,500,60);
        var definition=new RelatorioExportQueryRepository.QueryDefinition("select count(*)","select 1",Map.of(),new String[]{"id"},row->new Object[]{1});

        assertThatThrownBy(()->repository.prepare(definition)).isInstanceOf(ExportLimitExceededException.class);
        verify(connection,never()).prepareStatement(anyString(),anyInt(),anyInt());verify(connection).rollback();verify(connection).close();
    }
}

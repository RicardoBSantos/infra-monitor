package br.com.inframonitor.relatorio.exportacao;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;

import javax.sql.DataSource;
import java.io.IOException;
import java.io.OutputStream;
import java.sql.*;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Abre e mantem o mesmo snapshot PostgreSQL entre o count e o cursor de exportacao. */
@Repository
public class RelatorioExportQueryRepository {
    private static final int PUBLIC_MAX_ROWS = 100_000;
    private static final Pattern PARAMETER = Pattern.compile("(?<!:):([A-Za-z][A-Za-z0-9]*)");
    private final DataSource dataSource;
    private final int limit;
    private final int fetchSize;
    private final int timeoutSeconds;

    public RelatorioExportQueryRepository(DataSource dataSource,
            @Value("${app.reports.export.max-rows:100000}") int configuredLimit,
            @Value("${app.reports.export.fetch-size:500}") int fetchSize,
            @Value("${app.reports.export.timeout-seconds:60}") int timeoutSeconds) {
        this.dataSource = dataSource;
        this.limit = Math.min(Math.max(1, configuredLimit), PUBLIC_MAX_ROWS);
        this.fetchSize = Math.max(1, fetchSize);
        this.timeoutSeconds = Math.max(1, timeoutSeconds);
    }

    public PreparedExport prepare(QueryDefinition definition) {
        Connection connection = null;
        try {
            connection = dataSource.getConnection();
            connection.setAutoCommit(false);
            connection.setReadOnly(true);
            connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            Instant deadline = Instant.now().plusSeconds(timeoutSeconds);
            long count = count(connection, definition.countSql(), definition.parameters(), deadline);
            if (count > limit) {
                throw new ExportLimitExceededException(limit, count);
            }
            return new PreparedExport(connection, definition, count, deadline, fetchSize);
        } catch (RuntimeException ex) {
            closeAfterFailure(connection);
            throw ex;
        } catch (SQLException ex) {
            closeAfterFailure(connection);
            if (ex instanceof SQLTimeoutException || "57014".equals(ex.getSQLState())) throw new ExportTimeoutException();
            throw new IllegalStateException("Falha ao preparar exportacao", ex);
        }
    }

    private long count(Connection connection, String sql, Map<String, Object> parameters, Instant deadline) throws SQLException {
        ParsedQuery parsed = parse(sql, parameters);
        try (PreparedStatement statement = connection.prepareStatement(parsed.sql())) {
            statement.setQueryTimeout(remainingSeconds(deadline));
            bind(statement, parsed);
            try (ResultSet rows = statement.executeQuery()) {
                rows.next();
                return rows.getLong(1);
            }
        }
    }

    private static ParsedQuery parse(String sql, Map<String, Object> parameters) {
        Matcher matcher = PARAMETER.matcher(sql);
        StringBuilder parsed = new StringBuilder(sql.length());
        List<Parameter> values = new ArrayList<>();
        int previous = 0;
        while (matcher.find()) {
            parsed.append(sql, previous, matcher.start()).append('?');
            String name = matcher.group(1);
            if (!parameters.containsKey(name)) throw new IllegalArgumentException("Parametro SQL ausente: " + name);
            values.add(new Parameter(name, parameters.get(name)));
            previous = matcher.end();
        }
        parsed.append(sql, previous, sql.length());
        return new ParsedQuery(parsed.toString(), values);
    }

    private static void bind(PreparedStatement statement, ParsedQuery query) throws SQLException {
        for (int index = 0; index < query.parameters().size(); index++) {
            Parameter parameter = query.parameters().get(index);
            Object value = parameter.value();
            int jdbcIndex = index + 1;
            if (value instanceof Instant instant) statement.setTimestamp(jdbcIndex, Timestamp.from(instant));
            else if (value instanceof Long number) statement.setLong(jdbcIndex, number);
            else if (value instanceof Integer number) statement.setInt(jdbcIndex, number);
            else if (value instanceof Enum<?> enumeration) statement.setString(jdbcIndex, enumeration.name());
            else if (value instanceof String text) statement.setString(jdbcIndex, text);
            else if (value == null) statement.setNull(jdbcIndex, sqlType(parameter.name()));
            else statement.setObject(jdbcIndex, value);
        }
    }

    private static int sqlType(String name) {
        if (name.endsWith("Id") || name.equals("tipoId")) return Types.BIGINT;
        if (name.equals("inicio") || name.equals("fim")) return Types.TIMESTAMP_WITH_TIMEZONE;
        return Types.VARCHAR;
    }

    private static int remainingSeconds(Instant deadline) throws SQLTimeoutException {
        long remaining = Duration.between(Instant.now(), deadline).toSeconds();
        if (remaining < 1) throw new SQLTimeoutException("Tempo limite da exportacao excedido");
        return (int) Math.min(Integer.MAX_VALUE, remaining);
    }

    private static void closeAfterFailure(Connection connection) {
        if (connection == null) return;
        try { connection.rollback(); } catch (SQLException ignored) { }
        try { connection.close(); } catch (SQLException ignored) { }
    }

    public record QueryDefinition(String countSql, String dataSql, Map<String, Object> parameters,
                                  String[] headers, ResultRowMapper mapper) { }
    @FunctionalInterface public interface ResultRowMapper { Object[] map(ResultSet row) throws SQLException; }
    private record Parameter(String name, Object value) { }
    private record ParsedQuery(String sql, List<Parameter> parameters) { }

    public static final class PreparedExport {
        private final Connection connection;
        private final QueryDefinition definition;
        private final long expectedRows;
        private final Instant deadline;
        private final int fetchSize;
        private boolean consumed;

        PreparedExport(Connection connection, QueryDefinition definition, long expectedRows, Instant deadline, int fetchSize) {
            this.connection = connection; this.definition = definition; this.expectedRows = expectedRows;
            this.deadline = deadline; this.fetchSize = fetchSize;
        }
        public long expectedRows() { return expectedRows; }

        public StreamResult stream(OutputStream rawOutput) throws IOException {
            if (consumed) throw new IllegalStateException("Exportacao ja consumida");
            consumed = true;
            CountingOutputStream output = new CountingOutputStream(rawOutput);
            long written = 0;
            try {
                ParsedQuery parsed = parse(definition.dataSql(), definition.parameters());
                try (PreparedStatement statement = connection.prepareStatement(parsed.sql(), ResultSet.TYPE_FORWARD_ONLY,
                        ResultSet.CONCUR_READ_ONLY)) {
                    statement.setFetchDirection(ResultSet.FETCH_FORWARD);
                    statement.setFetchSize(fetchSize);
                    statement.setQueryTimeout(remainingSeconds(deadline));
                    bind(statement, parsed);
                    CsvWriter csv = new CsvWriter(output);
                    csv.writeHeader(definition.headers());
                    try (ResultSet rows = statement.executeQuery()) {
                        while (rows.next()) {
                            csv.writeRow(definition.mapper().map(rows));
                            written++;
                        }
                    }
                    csv.flush();
                }
                if (written != expectedRows) throw new SQLException("Snapshot inconsistente na exportacao");
                connection.commit();
                return new StreamResult(written, output.count());
            } catch (SQLException ex) {
                try { connection.rollback(); } catch (SQLException ignored) { }
                throw new IOException("Falha durante streaming CSV", ex);
            } finally {
                try { connection.close(); } catch (SQLException ignored) { }
            }
        }
    }

    public record StreamResult(long rows, long bytes) { }
}

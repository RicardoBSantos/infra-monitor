package br.com.inframonitor.medicao.retencao;

import java.sql.*;
import java.time.Instant;
import org.springframework.jdbc.core.JdbcOperations;

/** Must run inside the SAME REPEATABLE READ snapshot as the report. */
public final class DetailedHistoryGuard {
    public static final String SQL =
            "select historico_detalhado_desde from medicao_retencao_estado where id=1";
    private DetailedHistoryGuard() { }
    public static void requireAvailable(Instant availableFrom, Instant start) {
        if (availableFrom != null && (start == null || start.isBefore(availableFrom)))
            throw new DetailedHistoryUnavailableException(availableFrom);
    }
    public static void requireAvailable(JdbcOperations jdbc, Instant start) {
        Timestamp watermark = jdbc.queryForObject(SQL, Timestamp.class);
        requireAvailable(watermark == null ? null : watermark.toInstant(), start);
    }
    public static void requireAvailable(Connection connection, Instant start) throws SQLException {
        try (PreparedStatement s = connection.prepareStatement(SQL)) {
            s.setQueryTimeout(3);
            try (ResultSet r = s.executeQuery()) {
                if (!r.next()) throw new SQLException("Retention state is missing");
                Timestamp watermark = r.getTimestamp(1);
                requireAvailable(watermark == null ? null : watermark.toInstant(), start);
            }
        }
    }
}

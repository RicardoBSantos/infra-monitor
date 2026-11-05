package br.com.inframonitor.medicao.retencao;

import java.sql.*;
import java.time.Instant;

/** All methods use the job-owned connection; never open another transaction. */
public class RetentionRepository {
    public static final long ADVISORY_KEY = 7318294029L;
    public record Batch(long eligibleObserved, long deleted, String reason) { }

    public boolean tryLock(Connection c) throws SQLException {
        try (PreparedStatement s = c.prepareStatement("select pg_try_advisory_lock(?)")) {
            s.setLong(1, ADVISORY_KEY);
            try (ResultSet r = s.executeQuery()) { r.next(); return r.getBoolean(1); }
        }
    }
    public long cursor(Connection c) throws SQLException {
        try (Statement s = c.createStatement(); ResultSet r = s.executeQuery(
                "select cursor_monitor_id from medicao_retencao_estado where id=1")) {
            if (!r.next()) throw new SQLException("Retention state is missing");
            return r.getLong(1);
        }
    }
    public Long nextMonitor(Connection c, long cursor) throws SQLException {
        Long next = nextAfter(c, cursor);
        return next != null ? next : nextAfter(c, 0);
    }
    private Long nextAfter(Connection c, long cursor) throws SQLException {
        try (PreparedStatement s = c.prepareStatement(
                "select id from monitor where tipo='ICMP' and id>? order by id limit 1")) {
            s.setLong(1, cursor);
            try (ResultSet r = s.executeQuery()) { return r.next() ? r.getLong(1) : null; }
        }
    }
    public Batch batch(Connection c, long monitor, Instant cutoff, int latency, int maxTail,
                       int limit, boolean delete) throws SQLException {
        int k;
        // Strong parent lock also conflicts with FK KEY SHARE held by an INSERT.
        // Skip active writers rather than wait; lock lasts only for this short batch.
        try (PreparedStatement s = c.prepareStatement("""
                select falhas_para_incidente,sucessos_para_recovery from monitor
                where id=? and tipo='ICMP' for update skip locked
                """)) {
            s.setLong(1, monitor);
            try (ResultSet r = s.executeQuery()) {
                if (!r.next()) return new Batch(0, 0, "MONITOR_LOCKED_OR_REMOVED");
                k = RetentionPolicy.tail(r.getInt(1), r.getInt(2), latency, maxTail);
            }
        }
        Timestamp anchorAt;
        long anchorId;
        try (PreparedStatement s = c.prepareStatement("""
                select executado_em,id from medicao where monitor_id between ? and ?
                order by monitor_id,executado_em desc,id desc offset ? limit 1
                """)) {
            s.setLong(1, monitor); s.setLong(2, monitor); s.setInt(3, k - 1);
            try (ResultSet r = s.executeQuery()) {
                if (!r.next()) return new Batch(0, 0, "FEWER_THAN_K");
                anchorAt = r.getTimestamp(1); anchorId = r.getLong(2);
            }
        }
        String candidates = """
                select id from medicao
                where monitor_id=? and executado_em < ?
                  and (executado_em,id) < (?,?)
                order by executado_em,id limit ?
                """;
        if (!delete) {
            try (PreparedStatement s = c.prepareStatement(
                    "select count(*) from (" + candidates + ") candidates")) {
                bind(s, monitor, cutoff, anchorAt, anchorId, limit);
                try (ResultSet r = s.executeQuery()) {
                    r.next(); return new Batch(r.getLong(1), 0, "DRY_RUN");
                }
            }
        }
        long deleted;
        try (PreparedStatement s = c.prepareStatement("""
                with candidates as materialized (
                """ + candidates + """
                 for update skip locked
                ), removed as (
                  delete from medicao d using candidates c
                  where d.id=c.id returning d.id
                )
                select count(*) from removed
                """)) {
            bind(s, monitor, cutoff, anchorAt, anchorId, limit);
            try (ResultSet r = s.executeQuery()) { r.next(); deleted = r.getLong(1); }
        }
        // Same transaction: neither deletion nor marker can commit alone.
        try (PreparedStatement s = c.prepareStatement("""
                update medicao_retencao_estado
                set cursor_monitor_id=?,total_excluidas=total_excluidas+?,
                    historico_detalhado_desde=case when ?>0
                      then greatest(coalesce(historico_detalhado_desde,?::timestamptz),
                                    ?::timestamptz)
                      else historico_detalhado_desde end,
                    alterado_em=clock_timestamp()
                where id=1
                """)) {
            s.setLong(1, monitor); s.setLong(2, deleted); s.setLong(3, deleted);
            s.setTimestamp(4, Timestamp.from(cutoff)); s.setTimestamp(5, Timestamp.from(cutoff));
            if (s.executeUpdate() != 1) throw new SQLException("Retention state is missing");
        }
        return new Batch(deleted, deleted, "DELETION");
    }
    public void advanceCursor(Connection c, long monitor) throws SQLException {
        try (PreparedStatement s = c.prepareStatement(
                "update medicao_retencao_estado set cursor_monitor_id=? where id=1")) {
            s.setLong(1, monitor);
            if (s.executeUpdate() != 1) throw new SQLException("Retention state is missing");
        }
    }
    private void bind(PreparedStatement s, long monitor, Instant cutoff,
                      Timestamp anchorAt, long anchorId, int limit) throws SQLException {
        s.setLong(1, monitor); s.setTimestamp(2, Timestamp.from(cutoff));
        s.setTimestamp(3, anchorAt); s.setLong(4, anchorId); s.setInt(5, limit);
    }
}

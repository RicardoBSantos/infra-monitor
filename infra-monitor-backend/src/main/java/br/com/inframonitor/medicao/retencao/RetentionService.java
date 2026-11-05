package br.com.inframonitor.medicao.retencao;

import javax.sql.DataSource;
import java.sql.*;
import java.time.*;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class RetentionService {
    private static final Logger log = LoggerFactory.getLogger(RetentionService.class);
    private final DataSource dataSource;
    private final RetentionProperties properties;
    private final Clock clock;
    private final int latencyCycles;
    private final RetentionRepository repository = new RetentionRepository();
    private final AtomicBoolean running = new AtomicBoolean();
    private volatile long observationCursor;
    public record Result(String status, long eligibleObserved, long deleted, int batches) { }

    public RetentionService(DataSource dataSource, RetentionProperties properties,
                            @Qualifier("monitoringClock") Clock clock,
                            @Value("${monitoring.latencia-ciclos:2}") int latencyCycles) {
        this.dataSource = dataSource; this.properties = properties;
        this.clock = clock; this.latencyCycles = latencyCycles;
    }

    public Result runOnce() {
        if (Thread.currentThread().isInterrupted()) return new Result("INTERRUPTED", 0, 0, 0);
        if (!properties.enabled()) return new Result("DISABLED", 0, 0, 0);
        if (!properties.dryRun() && !properties.deletionApproved()) {
            log.info("Retention blocked: deletion approval is absent");
            return new Result("BLOCKED", 0, 0, 0);
        }
        if (!running.compareAndSet(false, true)) return new Result("SKIPPED_CONCURRENT", 0, 0, 0);
        long started = System.nanoTime();
        long deadline = started + properties.maxRunTime().toNanos();
        Instant cutoff = RetentionPolicy.cutoff(clock, properties.days());
        long observed = 0, deleted = 0;
        int batches = 0;
        String status = "COMPLETED";
        Connection c = null;
        boolean locked = false, committing = false;
        log.info("Retention start mode={} cutoff={}", properties.mayDelete() ? "DELETE" : "DRY_RUN", cutoff);
        try {
            RetentionPolicy.tail(1, 1, latencyCycles, properties.maxOperationalTail());
            c = dataSource.getConnection();
            c.setAutoCommit(true);
            c.setReadOnly(false);
            c.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);
            locked = repository.tryLock(c);
            if (!locked) { status = "SKIPPED_CONCURRENT"; return new Result(status, 0, 0, 0); }
            long cursor = properties.mayDelete() ? repository.cursor(c) : observationCursor;
            // Verify state even on the first dry-run, failing closed on a missing migration/row.
            repository.cursor(c);
            Set<Long> visited = new HashSet<>();
            while (batches < properties.maxBatches() && deleted < properties.maxRowsPerRun()) {
                if (Thread.currentThread().isInterrupted()) { status = "INTERRUPTED"; break; }
                if (System.nanoTime() >= deadline) { status = "LIMITED"; break; }
                c.setAutoCommit(false);
                long batchStart = System.nanoTime();
                long batchDeadline = Math.min(deadline, batchStart + properties.batchTimeout().toNanos());
                long millis = Math.max(1, (batchDeadline - System.nanoTime()) / 1000000);
                localTimeouts(c, millis, Math.min(millis, properties.lockTimeout().toMillis()));
                Long monitor = repository.nextMonitor(c, cursor);
                if (monitor == null || !visited.add(monitor)) { c.rollback(); break; }
                cursor = monitor;
                int limit = (int)Math.min(properties.batchSize(), properties.maxRowsPerRun() - deleted);
                RetentionRepository.Batch batch = repository.batch(c, monitor, cutoff, latencyCycles,
                        properties.maxOperationalTail(), limit, properties.mayDelete());
                if (Thread.currentThread().isInterrupted() || System.nanoTime() >= batchDeadline) {
                    c.rollback(); status = Thread.currentThread().isInterrupted() ? "INTERRUPTED" : "LIMITED";
                    break;
                }
                if (properties.mayDelete()) {
                    repository.advanceCursor(c, monitor);
                    committing = true;
                    c.commit();
                    committing = false;
                    deleted += batch.deleted();
                } else {
                    c.rollback(); // No counters, cursor or watermark persisted by dry-run.
                    observationCursor = cursor;
                }
                observed += batch.eligibleObserved();
                batches++;
                if (!batch.reason().equals("DELETION") && !batch.reason().equals("DRY_RUN"))
                    log.info("Retention batch skipped monitor={} reason={}", monitor, batch.reason());
            }
            if (batches == properties.maxBatches() || deleted == properties.maxRowsPerRun())
                status = "LIMITED";
        } catch (SQLException ex) {
            status = committing ? "COMMIT_CONFIRMATION_UNKNOWN" : "FAILED";
            log.error("Retention failed status={} sqlState={}", status, ex.getSQLState());
        } catch (RuntimeException ex) {
            status = "FAILED";
            log.error("Retention blocked exceptionType={}", ex.getClass().getSimpleName());
        } finally {
            release(c, locked);
            running.set(false);
            log.info("Retention end status={} mode={} eligibleObservedLowerBound={} deletedConfirmed={} batches={} durationMs={}",
                    status, properties.mayDelete() ? "DELETE" : "DRY_RUN", observed, deleted, batches,
                    (System.nanoTime() - started) / 1000000);
        }
        return new Result(status, observed, deleted, batches);
    }

    private void localTimeouts(Connection c, long statementMillis, long lockMillis) throws SQLException {
        try (PreparedStatement s = c.prepareStatement(
                "select set_config('statement_timeout',?,true),set_config('lock_timeout',?,true)")) {
            s.setString(1, statementMillis + "ms"); s.setString(2, Math.max(1, lockMillis) + "ms");
            s.execute();
        }
    }

    private void release(Connection c, boolean locked) {
        if (c == null) return;
        boolean safeToClose = true;
        try {
            if (!c.getAutoCommit()) c.rollback();
            c.setAutoCommit(true);
            if (locked) {
                try (PreparedStatement s = c.prepareStatement("select pg_advisory_unlock(?)")) {
                    s.setQueryTimeout(3);
                    s.setLong(1, RetentionRepository.ADVISORY_KEY);
                    try (ResultSet r = s.executeQuery()) {
                        if (!r.next() || !r.getBoolean(1)) throw new SQLException("Advisory unlock failed");
                    }
                }
            }
        } catch (SQLException | RuntimeException ex) {
            // Destroy the physical session; a pooled session must NEVER retain this lock.
            log.error("Retention session invalidated after cleanup failure");
            try { c.abort(Runnable::run); }
            catch (SQLException | RuntimeException abortFailure) {
                // Fail closed: quarantine instead of returning a potentially locked session.
                safeToClose = false;
                log.error("Retention connection quarantined: physical abort could not be confirmed");
            }
        } finally {
            if (safeToClose) try { c.close(); } catch (SQLException ignored) { }
        }
    }
}

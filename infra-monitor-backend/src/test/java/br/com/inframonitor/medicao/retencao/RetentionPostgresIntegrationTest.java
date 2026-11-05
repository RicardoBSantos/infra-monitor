package br.com.inframonitor.medicao.retencao;

import br.com.inframonitor.testsupport.RequerDocker;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import javax.sql.DataSource;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;

@RequerDocker
class RetentionPostgresIntegrationTest {
    private static final PostgreSQLContainer<?> DB = new PostgreSQLContainer<>("postgres:16-alpine");
    private static final Instant NOW = Instant.parse("2026-11-05T15:00:00Z");
    private static final Instant CUT = Instant.parse("2026-10-06T00:00:00Z");
    private DataSource ds;
    private JdbcTemplate jdbc;

    @BeforeEach void isolatedDatabaseOnly() {
        DB.start();
        // No URL/environment fallback: every destructive test operation uses this container.
        ds = new DriverManagerDataSource(DB.getJdbcUrl(),DB.getUsername(),DB.getPassword());
        Flyway flyway = Flyway.configure().dataSource(ds).cleanDisabled(false).load();
        flyway.clean();
        flyway.migrate();
        jdbc = new JdbcTemplate(ds);
    }
    @AfterAll static void stop() { DB.stop(); }

    @Test void keepsThirtyCompleteDaysAndCurrentUtcDay() {
        long m = monitor();
        long old = sample(m,CUT.minusNanos(1000));
        long edge = sample(m,CUT);
        long day = sample(m,NOW.truncatedTo(java.time.temporal.ChronoUnit.DAYS));
        long current = sample(m,NOW);
        RetentionService.Result result = service(false,true,1000,50).runOnce();
        assertThat(result.deleted()).isEqualTo(1);
        assertThat(ids()).containsExactly(edge,day,current).doesNotContain(old);
        assertThat(watermark()).isEqualTo(CUT);
    }
    @Test void actualKIncludingLatencyIsPreservedForInactiveMonitor() {
        long m = monitor();
        jdbc.update("update monitor set ativo=false,falhas_para_incidente=4,sucessos_para_recovery=5 where id=?",m);
        List<Long> all = new ArrayList<>();
        for (int n=0;n<10;n++) all.add(sample(m,CUT.minusSeconds(100-n)));
        RetentionService run = new RetentionService(ds,props(false,true,1000,50),
                Clock.fixed(NOW,ZoneOffset.UTC),7);
        assertThat(run.runOnce().deleted()).isEqualTo(3);
        assertThat(ids()).containsExactlyElementsOf(all.subList(3,10));
    }
    @Test void fewerThanKIsNeverDeleted() {
        long m = monitor();
        sample(m,CUT.minusSeconds(100)); sample(m,CUT.minusSeconds(90));
        assertThat(service(false,true,1000,50).runOnce().deleted()).isZero();
        assertThat(ids()).hasSize(2);
        assertThat(watermark()).isNull();
    }
    @Test void monitorWithoutMeasurementsIsSafe() {
        monitor();
        assertThat(service(false,true,1000,50).runOnce().status()).isEqualTo("COMPLETED");
        assertThat(ids()).isEmpty();
    }
    @Test void timestampTiesUseIdAndKeepLastThree() {
        long m=monitor();
        List<Long> all=new ArrayList<>();
        for(int n=0;n<8;n++) all.add(sample(m,CUT.minusSeconds(10)));
        assertThat(service(false,true,1000,50).runOnce().deleted()).isEqualTo(5);
        assertThat(ids()).containsExactlyElementsOf(all.subList(5,8));
    }
    @Test void dryRunDoesNotWriteStateOrDelete() {
        seedDeletable();
        List<Long> before=ids();
        RetentionService.Result result=service(true,false,1000,50).runOnce();
        assertThat(result.eligibleObserved()).isEqualTo(5);
        assertThat(result.deleted()).isZero();
        assertThat(ids()).isEqualTo(before);
        assertThat(watermark()).isNull();
        assertThat(jdbc.queryForObject("select total_excluidas+cursor_monitor_id from medicao_retencao_estado",Long.class)).isZero();
    }
    @Test void deletionWithoutApprovalIsBlocked() {
        seedDeletable();
        assertThat(service(false,false,1000,50).runOnce().status()).isEqualTo("BLOCKED");
        assertThat(ids()).hasSize(8);
    }
    @Test void approvedDeletionAndReexecutionAreIdempotent() {
        seedDeletable();
        assertThat(service(false,true,1000,50).runOnce().deleted()).isEqualTo(5);
        assertThat(service(false,true,1000,50).runOnce().deleted()).isZero();
        assertThat(jdbc.queryForObject("select total_excluidas from medicao_retencao_estado",Long.class)).isEqualTo(5);
    }
    @Test void smallBatchIsBoundedAndCursorIsFair() {
        seedDeletable();
        seedDeletable();
        assertThat(service(false,true,2,1).runOnce().deleted()).isEqualTo(2);
        long cursor=jdbc.queryForObject("select cursor_monitor_id from medicao_retencao_estado",Long.class);
        assertThat(service(false,true,2,1).runOnce().deleted()).isEqualTo(2);
        assertThat(jdbc.queryForObject("select cursor_monitor_id from medicao_retencao_estado",Long.class)).isGreaterThan(cursor);
    }
    @Test void advisoryLockPreventsAnotherExecution() throws Exception {
        seedDeletable();
        try(Connection c=ds.getConnection(); PreparedStatement s=c.prepareStatement("select pg_advisory_lock(?)")) {
            s.setLong(1,RetentionRepository.ADVISORY_KEY); s.execute();
            assertThat(service(false,true,1000,50).runOnce().status()).isEqualTo("SKIPPED_CONCURRENT");
            assertThat(ids()).hasSize(8);
        }
        assertThat(service(false,true,1000,50).runOnce().deleted()).isEqualTo(5);
    }
    @Test void inflightInsertMakesRetentionSkipTheMonitor() throws Exception {
        long m=seedDeletable();
        try(Connection c=ds.getConnection()) {
            c.setAutoCommit(false);
            insert(c,m,NOW.plusSeconds(1));
            assertThat(service(false,true,1000,50).runOnce().deleted()).isZero();
            c.commit();
        }
        assertThat(service(false,true,1000,50).runOnce().deleted()).isEqualTo(5);
        assertThat(ids()).hasSize(4);
    }
    @Test void insertWaitsUntilBatchReleasesParentLock() throws Exception {
        long m=seedDeletable();
        ExecutorService pool=Executors.newSingleThreadExecutor();
        CountDownLatch entered=new CountDownLatch(1);
        try(Connection c=ds.getConnection()) {
            c.setAutoCommit(false);
            RetentionRepository.Batch batch=new RetentionRepository().batch(c,m,CUT,2,1000,1000,true);
            assertThat(batch.deleted()).isEqualTo(5);
            Future<?> pending=pool.submit(()->{
                entered.countDown();
                try(Connection other=ds.getConnection()) { insert(other,m,NOW.plusSeconds(1)); }
                catch(SQLException ex) { throw new IllegalStateException(ex); }
            });
            assertThat(entered.await(5,TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(()->pending.get(200,TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
            c.commit();
            pending.get(10,TimeUnit.SECONDS);
            assertThat(ids()).hasSize(4);
        } finally { pool.shutdownNow(); }
    }
    @Test void failedBatchRollsBackDeletionAndMarker() {
        seedDeletable();
        jdbc.execute("""
            create function reject_retention_marker() returns trigger language plpgsql as $$
            begin raise exception 'test failure'; end $$;
            """);
        jdbc.execute("""
            create trigger reject_marker before update on medicao_retencao_estado
            for each row execute function reject_retention_marker()
            """);
        assertThat(service(false,true,1000,50).runOnce().status()).isEqualTo("FAILED");
        assertThat(ids()).hasSize(8);
        assertThat(watermark()).isNull();
    }
    @Test void missingStateFailsClosed() {
        seedDeletable();
        jdbc.update("delete from medicao_retencao_estado");
        assertThat(service(false,true,1000,50).runOnce().status()).isEqualTo("FAILED");
        assertThat(ids()).hasSize(8);
    }
    @Test void incidentsNotificationsAndV24AnchorRemainIntact() {
        long m=monitor();
        long window=id("insert into janela_monitoramento(monitor_id,inicio_em,origem) values (?,?,'PRECISA') returning id",m,CUT.minusSeconds(1000));
        for(int n=0;n<5;n++) sample(m,CUT.minusSeconds(100-n));
        for(int n=0;n<3;n++) sample(m,NOW.plusSeconds(n));
        long incident=id("insert into incidente(monitor_id,status,iniciado_em) values (?,'ABERTO',?) returning id",m,CUT.minusSeconds(500));
        id("insert into notificacao(incidente_id,canal,tipo_evento,status,mensagem) values (?,'TELEGRAM','INCIDENTE_ABERTO','PENDENTE','test') returning id",incident);
        Instant first=jdbc.queryForObject("select primeira_medicao_em from janela_monitoramento where id=?",Timestamp.class,window).toInstant();
        assertThat(service(false,true,1000,50).runOnce().deleted()).isEqualTo(5);
        assertThat(jdbc.queryForObject("select count(*) from incidente",Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from notificacao",Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select primeira_medicao_em from janela_monitoramento where id=?",Timestamp.class,window).toInstant()).isEqualTo(first);
    }
    @Test void historicalReportsFailWhileProtectedIntervalRemainsAvailable() throws Exception {
        seedDeletable();
        service(false,true,1000,50).runOnce();
        assertThatThrownBy(()->DetailedHistoryGuard.requireAvailable(jdbc,CUT.minusSeconds(1)))
                .isInstanceOf(DetailedHistoryUnavailableException.class);
        assertThatCode(()->DetailedHistoryGuard.requireAvailable(jdbc,CUT)).doesNotThrowAnyException();
        try(Connection c=ds.getConnection()) {
            c.setAutoCommit(false);
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            assertThatThrownBy(()->DetailedHistoryGuard.requireAvailable(c,CUT.minusSeconds(1)))
                    .isInstanceOf(DetailedHistoryUnavailableException.class);
            c.rollback();
        }
    }
    @Test void reportSnapshotCannotSeeNewDeletionWithOldMarker() throws Exception {
        seedDeletable();
        try(Connection c=ds.getConnection()) {
            c.setAutoCommit(false);
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            DetailedHistoryGuard.requireAvailable(c,CUT.minusSeconds(1000));
            assertThat(service(false,true,1000,50).runOnce().deleted()).isEqualTo(5);
            try(Statement s=c.createStatement(); ResultSet r=s.executeQuery("select count(*) from medicao")) {
                r.next(); assertThat(r.getLong(1)).isEqualTo(8);
            }
            c.rollback();
        }
        assertThat(ids()).hasSize(3);
    }
    @Test void disabledRunAndLongerRetentionDoNotResetWatermark() {
        seedDeletable();
        service(false,true,1000,50).runOnce();
        RetentionProperties disabled=new RetentionProperties(false,true,false,60,1000,50,50000,1000,
                Duration.ofSeconds(30),Duration.ofSeconds(3),Duration.ofMillis(200),Duration.ofMinutes(15),Duration.ofMinutes(15));
        assertThat(new RetentionService(ds,disabled,Clock.fixed(NOW,ZoneOffset.UTC),2).runOnce().status()).isEqualTo("DISABLED");
        assertThat(watermark()).isEqualTo(CUT);
    }
    @Test void interruptBeforeFirstBatchDoesNotDelete() {
        seedDeletable();
        try {
            Thread.currentThread().interrupt();
            assertThat(service(false,true,1000,50).runOnce().status()).isEqualTo("INTERRUPTED");
        } finally { Thread.interrupted(); }
        assertThat(ids()).hasSize(8);
    }

    private RetentionProperties props(boolean dry,boolean approved,int batch,int maxBatches) {
        return new RetentionProperties(true,dry,approved,30,batch,maxBatches,50000,1000,
                Duration.ofSeconds(30),Duration.ofSeconds(3),Duration.ofMillis(200),
                Duration.ofMinutes(15),Duration.ofMinutes(15));
    }
    private RetentionService service(boolean dry,boolean approved,int batch,int maxBatches) {
        return new RetentionService(ds,props(dry,approved,batch,maxBatches),Clock.fixed(NOW,ZoneOffset.UTC),2);
    }
    private long monitor() {
        long type=id("insert into tipo_equipamento(nome) values (?) returning id","type-"+UUID.randomUUID());
        long unit=id("insert into unidade(nome,sigla) values (?,?) returning id","unit-"+UUID.randomUUID(),UUID.randomUUID().toString().substring(0,6));
        long equipment=id("insert into equipamento(unidade_id,tipo_equipamento_id,nome) values (?,?,'test') returning id",unit,type);
        return id("insert into monitor(equipamento_id,tipo,nome,intervalo_segundos,timeout_ms) values (?,'ICMP','test',60,2000) returning id",equipment);
    }
    private long seedDeletable() {
        long m=monitor();
        for(int n=0;n<5;n++) sample(m,CUT.minusSeconds(100-n));
        for(int n=0;n<3;n++) sample(m,NOW.plusSeconds(n));
        return m;
    }
    private long sample(long m,Instant at) {
        return id("insert into medicao(monitor_id,status,latencia_ms,executado_em) values (?,'SUCESSO',10,?) returning id",m,at);
    }
    private void insert(Connection c,long m,Instant at) throws SQLException {
        try(PreparedStatement s=c.prepareStatement("insert into medicao(monitor_id,status,latencia_ms,executado_em) values (?,'SUCESSO',10,?)")) {
            s.setLong(1,m); s.setTimestamp(2,Timestamp.from(at)); s.executeUpdate();
        }
    }
    private long id(String sql,Object... parameters) {
        Object[] values=Arrays.stream(parameters).map(v->v instanceof Instant t ? Timestamp.from(t) : v).toArray();
        return jdbc.queryForObject(sql,Long.class,values);
    }
    private List<Long> ids() { return jdbc.queryForList("select id from medicao order by id",Long.class); }
    private Instant watermark() {
        Timestamp value=jdbc.queryForObject(DetailedHistoryGuard.SQL,Timestamp.class);
        return value==null ? null : value.toInstant();
    }
}

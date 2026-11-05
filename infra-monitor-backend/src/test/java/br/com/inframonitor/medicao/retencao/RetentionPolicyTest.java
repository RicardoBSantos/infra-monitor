package br.com.inframonitor.medicao.retencao;

import java.time.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class RetentionPolicyTest {
    @ParameterizedTest
    @CsvSource({
        "2026-11-05T15:00:00Z,2026-10-06T00:00:00Z",
        "2026-03-01T00:00:00Z,2026-01-30T00:00:00Z",
        "2027-01-01T23:59:59Z,2026-12-02T00:00:00Z",
        "2028-03-01T12:00:00Z,2028-01-31T00:00:00Z"
    })
    void completeUtcDaysAcrossCalendarBoundaries(String now, String expected) {
        Clock clock = Clock.fixed(Instant.parse(now), ZoneId.of("America/Sao_Paulo"));
        assertThat(RetentionPolicy.cutoff(clock, 30)).isEqualTo(Instant.parse(expected));
    }
    @Test void clockZoneDoesNotMoveUtcBoundary() {
        Instant now = Instant.parse("2026-11-05T01:00:00Z");
        assertThat(RetentionPolicy.cutoff(Clock.fixed(now, ZoneId.of("Pacific/Honolulu")),30))
                .isEqualTo(Instant.parse("2026-10-06T00:00:00Z"));
    }
    @Test void tailUsesActualMaximum() {
        assertThat(RetentionPolicy.tail(7,12,20,1000)).isEqualTo(20);
    }
    @Test void invalidTailAndShortRetentionFailClosed() {
        assertThatThrownBy(() -> RetentionPolicy.tail(0,2,3,1000)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> RetentionPolicy.tail(1,2,1001,1000)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> RetentionPolicy.cutoff(Clock.systemUTC(),29)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void disabledAndUnapprovedDoNotObtainAConnection() {
        javax.sql.DataSource ds = mock(javax.sql.DataSource.class);
        RetentionService disabled = new RetentionService(ds, props(false,false,true),Clock.systemUTC(),2);
        RetentionService blocked = new RetentionService(ds, props(true,false,false),Clock.systemUTC(),2);
        assertThat(disabled.runOnce().status()).isEqualTo("DISABLED");
        assertThat(blocked.runOnce().status()).isEqualTo("BLOCKED");
        verifyNoInteractions(ds);
    }
    @Test void allThreeConditionsAreRequired() {
        for (boolean enabled : new boolean[]{false,true})
            for (boolean dry : new boolean[]{false,true})
                for (boolean approved : new boolean[]{false,true})
                    assertThat(props(enabled,dry,approved).mayDelete())
                            .isEqualTo(enabled && !dry && approved);
    }
    @Test void invalidConfigurationIsRejected() {
        assertThatThrownBy(() -> new RetentionProperties(true,false,true,29,100,50,5000,1000,
                Duration.ofSeconds(30),Duration.ofSeconds(3),Duration.ofMillis(200),
                Duration.ofMinutes(15),Duration.ofMinutes(15))).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void watermarkBoundaryAndOpenEndedHistory() {
        Instant available = Instant.parse("2026-10-06T00:00:00Z");
        assertThatCode(() -> DetailedHistoryGuard.requireAvailable(available,available)).doesNotThrowAnyException();
        assertThatThrownBy(() -> DetailedHistoryGuard.requireAvailable(available,available.minusNanos(1)))
                .isInstanceOf(DetailedHistoryUnavailableException.class);
        assertThatThrownBy(() -> DetailedHistoryGuard.requireAvailable(available,null))
                .isInstanceOf(DetailedHistoryUnavailableException.class);
    }
    private RetentionProperties props(boolean enabled, boolean dry, boolean approved) {
        return new RetentionProperties(enabled,dry,approved,30,1000,50,50000,1000,
                Duration.ofSeconds(30),Duration.ofSeconds(3),Duration.ofMillis(200),
                Duration.ofMinutes(15),Duration.ofMinutes(15));
    }
}

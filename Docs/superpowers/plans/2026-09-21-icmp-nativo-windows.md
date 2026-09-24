# ICMP nativo no Windows — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o monitor ICMP decidir pelo status ICMP real em vez do código de saída do `ping`, eliminando os falsos positivos de "TTL expirado" e "host inacessível".

**Architecture:** Um contrato `IcmpResult(StatusIcmp, rttMs, codigoNativo)` substitui `IcmpProcessResult`. Duas implementações de `IcmpCommandRunner`: `WindowsNativeIcmpRunner` (IcmpSendEcho via JNA, atrás da interface fina `Iphlpapi`) e `ProcessoPingIcmpRunner` (executa `ping` e lê o texto com `PingOutputParser`). A escolha vem da propriedade `monitoring.icmp.implementacao`.

**Tech Stack:** Java 21, Spring Boot 4.1.0, Maven (`./mvnw`), JNA 5.19.0 (`net.java.dev.jna:jna` + `jna-platform`), JUnit 5, Mockito.

**Spec:** `Docs/superpowers/specs/2026-09-21-icmp-nativo-windows-design.md`

## Global Constraints

- Diretório base de todos os comandos: `infra-monitor-backend/`.
- **Sem Lombok.** Classes e `record` explícitos.
- Sem abstração especulativa: nada de `Base*`, nada de interface sem mais de uma implementação.
- Datas com `Instant` e Java Time API.
- **NÃO ligar** `monitoring.engine.enabled`, `MONITORING_ENGINE_ENABLED`, `TELEGRAM_ENABLED` nem o dispatcher em lugar nenhum. Nenhum teste pode subir o motor contra o banco de dev.
- **NÃO alterar nenhuma migration e não criar migration nova.** `StatusMedicao` continua só `SUCESSO`/`FALHA`.
- **NÃO tocar em nenhum arquivo sob `infra-monitor-frontend/`.**
- JNA já está no `pom.xml` (`jna.version` = `5.19.0`, escopo compile). Não mexer.
- Mensagens de falha gravadas em `medicao.mensagem`, em português, exatamente: `Timeout`, `Host de destino inacessível`, `Rede de destino inacessível`, `TTL expirado em trânsito`, `Erro ICMP <código>`.
- `IcmpSendEcho` **tem** de receber `IP_OPTION_INFORMATION` com `Ttl = 128`. Com `NULL` o A.0 mediu timeout espúrio em 9 de 10 tentativas.
- A suíte `./mvnw test` tem de ficar verde ao fim de cada tarefa.
- Ao fim de cada tarefa, commit com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` na última linha.

---

### Task 1: Contrato novo e leitura do texto do ping

**Files:**
- Create: `src/main/java/br/com/inframonitor/monitoring/icmp/StatusIcmp.java`
- Create: `src/main/java/br/com/inframonitor/monitoring/icmp/IcmpResult.java`
- Create: `src/main/java/br/com/inframonitor/monitoring/icmp/processo/PingOutputParser.java`
- Create: `src/main/java/br/com/inframonitor/monitoring/icmp/processo/ProcessoPingIcmpRunner.java`
- Delete: `src/main/java/br/com/inframonitor/monitoring/icmp/IcmpProcessResult.java`
- Delete: `src/main/java/br/com/inframonitor/monitoring/icmp/LinuxPingCommandRunner.java`
- Modify: `src/main/java/br/com/inframonitor/monitoring/icmp/IcmpCommandRunner.java`
- Modify: `src/main/java/br/com/inframonitor/monitoring/icmp/IcmpMonitorExecutor.java`
- Test: `src/test/java/br/com/inframonitor/monitoring/icmp/processo/PingOutputParserTest.java`
- Test: `src/test/java/br/com/inframonitor/monitoring/icmp/IcmpMonitorExecutorTest.java` (já existe, reescrever)

**Interfaces:**
- Produces: `StatusIcmp` (enum: `SUCESSO, TIMEOUT, HOST_INACESSIVEL, REDE_INACESSIVEL, TTL_EXPIRADO, ERRO`); `IcmpResult(StatusIcmp status, Integer rttMs, Integer codigoNativo)` com fábricas estáticas `sucesso(int rttMs)`, `falha(StatusIcmp status)`, `erro(int codigoNativo)`; `IcmpCommandRunner.run(String ip, int timeoutMs) -> IcmpResult`; `PingOutputParser.analisar(String ipAlvo, String saida, boolean processoTerminou) -> IcmpResult`.
- Consumes: nada.

- [ ] **Step 1: Escrever os testes do parser (falhando)**

Criar `src/test/java/br/com/inframonitor/monitoring/icmp/processo/PingOutputParserTest.java`:

```java
package br.com.inframonitor.monitoring.icmp.processo;

import br.com.inframonitor.monitoring.icmp.IcmpResult;
import br.com.inframonitor.monitoring.icmp.StatusIcmp;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * As fixtures pt-BR sao saidas REAIS capturadas em 2026-09-21 na maquina de
 * desenvolvimento, contra os alvos da rede Sesc. A fixture do iputils esta
 * marcada como formato de referencia: NAO foi capturada nesta maquina.
 */
class PingOutputParserTest {

    // Capturada: ping -n 1 -w 3000 10.79.10.6
    private static final String WIN_PT_SUCESSO = """
            Disparando 10.79.10.6 com 32 bytes de dados:
            Resposta de 10.79.10.6: bytes=32 tempo<1ms TTL=127

            Estatisticas do Ping para 10.79.10.6:
                Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de perda),
            Aproximar um numero redondo de vezes em milissegundos:
                Minimo = 0ms, Maximo = 0ms, Media = 0ms
            """;

    // Capturada: ping -n 1 -w 3000 10.72.10.16
    private static final String WIN_PT_TTL_EXPIRADO = """
            Disparando 10.72.10.16 com 32 bytes de dados:
            Resposta de 192.168.0.252: A vida util (TTL) expirou em transito.

            Estatisticas do Ping para 10.72.10.16:
                Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de perda),
            """;

    // Capturada: ping -n 1 -w 3000 10.79.20.250
    private static final String WIN_PT_HOST_INACESSIVEL = """
            Disparando 10.79.20.250 com 32 bytes de dados:
            Resposta de 10.79.20.163: Host de destino inacessivel.

            Estatisticas do Ping para 10.79.20.250:
                Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de perda),
            """;

    // Capturada: ping -n 1 -w 3000 10.73.10.15
    private static final String WIN_PT_TIMEOUT = """
            Disparando 10.73.10.15 com 32 bytes de dados:
            Esgotado o tempo limite do pedido.

            Estatisticas do Ping para 10.73.10.15:
                Pacotes: Enviados = 1, Recebidos = 0, Perdidos = 1 (100% de perda),
            """;

    private static final String WIN_PT_FALHA_GERAL = """
            Disparando 10.99.99.99 com 32 bytes de dados:
            Falha geral.

            Estatisticas do Ping para 10.99.99.99:
                Pacotes: Enviados = 1, Recebidos = 0, Perdidos = 1 (100% de perda),
            """;

    private static final String WIN_EN_SUCESSO = """
            Pinging 10.79.10.6 with 32 bytes of data:
            Reply from 10.79.10.6: bytes=32 time=12ms TTL=127
            """;

    private static final String WIN_EN_TTL_EXPIRADO = """
            Pinging 10.72.10.16 with 32 bytes of data:
            Reply from 192.168.0.252: TTL expired in transit.
            """;

    private static final String WIN_EN_HOST_INACESSIVEL = """
            Pinging 10.79.20.250 with 32 bytes of data:
            Reply from 10.79.20.163: Destination host unreachable.
            """;

    private static final String WIN_EN_REDE_INACESSIVEL = """
            Pinging 10.88.0.1 with 32 bytes of data:
            Reply from 10.79.20.163: Destination net unreachable.
            """;

    // FORMATO DE REFERENCIA (iputils) - NAO CAPTURADO NESTA MAQUINA.
    private static final String LINUX_SUCESSO = """
            PING 10.79.10.6 (10.79.10.6) 56(84) bytes of data.
            64 bytes from 10.79.10.6: icmp_seq=1 ttl=127 time=0.412 ms

            --- 10.79.10.6 ping statistics ---
            1 packets transmitted, 1 received, 0% packet loss, time 0ms
            """;

    // FORMATO DE REFERENCIA (iputils) - NAO CAPTURADO NESTA MAQUINA.
    private static final String LINUX_HOST_INACESSIVEL = """
            PING 10.79.20.250 (10.79.20.250) 56(84) bytes of data.
            From 10.79.20.163 icmp_seq=1 Destination Host Unreachable

            --- 10.79.20.250 ping statistics ---
            1 packets transmitted, 0 received, +1 errors, 100% packet loss, time 0ms
            """;

    @Test
    @DisplayName("tempo<1ms vira sucesso com latencia zero")
    void sucessoPortuguesComMenorQue() {
        IcmpResult r = PingOutputParser.analisar("10.79.10.6", WIN_PT_SUCESSO, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.SUCESSO);
        assertThat(r.rttMs()).isZero();
    }

    @Test
    @DisplayName("Reply from ... time=12ms vira sucesso com 12 ms")
    void sucessoIngles() {
        IcmpResult r = PingOutputParser.analisar("10.79.10.6", WIN_EN_SUCESSO, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.SUCESSO);
        assertThat(r.rttMs()).isEqualTo(12);
    }

    @Test
    @DisplayName("TTL expirou em transito NAO e sucesso, mesmo com o processo saindo com 0")
    void ttlExpiradoPortugues() {
        IcmpResult r = PingOutputParser.analisar("10.72.10.16", WIN_PT_TTL_EXPIRADO, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.TTL_EXPIRADO);
        assertThat(r.rttMs()).isNull();
    }

    @Test
    void ttlExpiradoIngles() {
        IcmpResult r = PingOutputParser.analisar("10.72.10.16", WIN_EN_TTL_EXPIRADO, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.TTL_EXPIRADO);
    }

    @Test
    @DisplayName("Host de destino inacessivel NAO e sucesso")
    void hostInacessivelPortugues() {
        IcmpResult r = PingOutputParser.analisar("10.79.20.250", WIN_PT_HOST_INACESSIVEL, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.HOST_INACESSIVEL);
        assertThat(r.rttMs()).isNull();
    }

    @Test
    void hostInacessivelIngles() {
        IcmpResult r = PingOutputParser.analisar("10.79.20.250", WIN_EN_HOST_INACESSIVEL, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.HOST_INACESSIVEL);
    }

    @Test
    void redeInacessivelIngles() {
        IcmpResult r = PingOutputParser.analisar("10.88.0.1", WIN_EN_REDE_INACESSIVEL, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.REDE_INACESSIVEL);
    }

    @Test
    void timeoutPortugues() {
        IcmpResult r = PingOutputParser.analisar("10.73.10.15", WIN_PT_TIMEOUT, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.TIMEOUT);
    }

    @Test
    @DisplayName("Falha geral vira ERRO, nao timeout")
    void falhaGeral() {
        IcmpResult r = PingOutputParser.analisar("10.99.99.99", WIN_PT_FALHA_GERAL, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.ERRO);
    }

    @Test
    @DisplayName("processo que nao terminou dentro do timeout vira TIMEOUT sem olhar o texto")
    void processoNaoTerminou() {
        IcmpResult r = PingOutputParser.analisar("10.73.10.15", "", false);
        assertThat(r.status()).isEqualTo(StatusIcmp.TIMEOUT);
    }

    @Test
    @DisplayName("resposta de outro IP nunca e sucesso, mesmo tendo ttl= na linha")
    void respostaDeOutroIpNaoESucesso() {
        String saida = "Resposta de 192.168.0.252: bytes=32 tempo=1ms TTL=64\n";
        IcmpResult r = PingOutputParser.analisar("10.72.10.16", saida, true);
        assertThat(r.status()).isNotEqualTo(StatusIcmp.SUCESSO);
    }

    @Test
    @DisplayName("formato de referencia do iputils: sucesso com virgula/ponto decimal")
    void linuxSucessoFormatoDeReferencia() {
        IcmpResult r = PingOutputParser.analisar("10.79.10.6", LINUX_SUCESSO, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.SUCESSO);
        assertThat(r.rttMs()).isZero();
    }

    @Test
    @DisplayName("formato de referencia do iputils: host inacessivel")
    void linuxHostInacessivelFormatoDeReferencia() {
        IcmpResult r = PingOutputParser.analisar("10.79.20.250", LINUX_HOST_INACESSIVEL, true);
        assertThat(r.status()).isEqualTo(StatusIcmp.HOST_INACESSIVEL);
    }
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./mvnw -o test -Dtest=PingOutputParserTest`
Expected: FAIL na compilação — `PingOutputParser`, `IcmpResult` e `StatusIcmp` não existem.

- [ ] **Step 3: Criar o enum e o record**

`src/main/java/br/com/inframonitor/monitoring/icmp/StatusIcmp.java`:

```java
package br.com.inframonitor.monitoring.icmp;

/** Resultado de uma sondagem ICMP, no vocabulario da pilha de rede, nao no da medicao. */
public enum StatusIcmp {
    SUCESSO,
    TIMEOUT,
    HOST_INACESSIVEL,
    REDE_INACESSIVEL,
    TTL_EXPIRADO,
    ERRO
}
```

`src/main/java/br/com/inframonitor/monitoring/icmp/IcmpResult.java`:

```java
package br.com.inframonitor.monitoring.icmp;

/**
 * rttMs so e preenchido em SUCESSO: o RoundTripTime vem preenchido mesmo em
 * resposta de erro ICMP (medido: 1042 ms num host inacessivel) e nao significa
 * nada la. codigoNativo so e preenchido em ERRO, para compor a mensagem.
 */
public record IcmpResult(StatusIcmp status, Integer rttMs, Integer codigoNativo) {

    public static IcmpResult sucesso(int rttMs) {
        return new IcmpResult(StatusIcmp.SUCESSO, Math.max(rttMs, 0), null);
    }

    public static IcmpResult falha(StatusIcmp status) {
        if (status == StatusIcmp.SUCESSO) {
            throw new IllegalArgumentException("falha(SUCESSO) nao faz sentido; use sucesso(rttMs)");
        }
        return new IcmpResult(status, null, null);
    }

    public static IcmpResult erro(int codigoNativo) {
        return new IcmpResult(StatusIcmp.ERRO, null, codigoNativo);
    }
}
```

- [ ] **Step 4: Criar o parser**

`src/main/java/br/com/inframonitor/monitoring/icmp/processo/PingOutputParser.java`:

```java
package br.com.inframonitor.monitoring.icmp.processo;

import br.com.inframonitor.monitoring.icmp.IcmpResult;
import br.com.inframonitor.monitoring.icmp.StatusIcmp;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Le a saida de texto do ping. O codigo de saida do processo e deliberadamente
 * ignorado: no Windows ele e 0 tanto para uma resposta valida quanto para
 * "TTL expirou em transito" e "Host de destino inacessivel".
 */
public final class PingOutputParser {

    /** Aceita "tempo<1ms", "tempo=1ms", "time=12ms" e "time=0.412 ms". */
    private static final Pattern LATENCIA =
            Pattern.compile("(?:tempo|time)\\s*([=<])\\s*(\\d+(?:[.,]\\d+)?)\\s*ms",
                    Pattern.CASE_INSENSITIVE);

    private PingOutputParser() { }

    public static IcmpResult analisar(String ipAlvo, String saida, boolean processoTerminou) {
        if (!processoTerminou) {
            return IcmpResult.falha(StatusIcmp.TIMEOUT);
        }
        String texto = saida == null ? "" : saida;
        String normalizado = texto.toLowerCase(Locale.ROOT);

        if (respondeuDoAlvo(ipAlvo, texto)) {
            return IcmpResult.sucesso(latenciaMs(texto));
        }
        if (contemAlgum(normalizado, "ttl expirou em transito", "ttl) expirou", "ttl expired in transit")) {
            return IcmpResult.falha(StatusIcmp.TTL_EXPIRADO);
        }
        if (contemAlgum(normalizado, "rede de destino inacessivel", "destination net unreachable")) {
            return IcmpResult.falha(StatusIcmp.REDE_INACESSIVEL);
        }
        if (contemAlgum(normalizado, "host de destino inacessivel", "destination host unreachable")) {
            return IcmpResult.falha(StatusIcmp.HOST_INACESSIVEL);
        }
        if (contemAlgum(normalizado, "esgotado o tempo limite", "request timed out", "tempo limite do pedido")) {
            return IcmpResult.falha(StatusIcmp.TIMEOUT);
        }
        return IcmpResult.erro(0);
    }

    /**
     * Sucesso so quando ha UMA linha que cita o IP do alvo e tem "ttl=". A
     * resposta de um roteador intermediario cita o IP dele, nunca o do alvo.
     */
    private static boolean respondeuDoAlvo(String ipAlvo, String texto) {
        if (ipAlvo == null || ipAlvo.isBlank()) {
            return false;
        }
        for (String linha : texto.split("\\R")) {
            String minuscula = linha.toLowerCase(Locale.ROOT);
            if (minuscula.contains(ipAlvo.toLowerCase(Locale.ROOT)) && minuscula.contains("ttl=")) {
                return true;
            }
        }
        return false;
    }

    private static int latenciaMs(String texto) {
        Matcher m = LATENCIA.matcher(texto);
        if (!m.find()) {
            return 0;
        }
        if ("<".equals(m.group(1))) {
            return 0;
        }
        double valor = Double.parseDouble(m.group(2).replace(',', '.'));
        return (int) Math.round(valor);
    }

    private static boolean contemAlgum(String normalizado, String... agulhas) {
        for (String agulha : agulhas) {
            if (normalizado.contains(agulha)) {
                return true;
            }
        }
        return false;
    }
}
```

Atenção: a normalização é `toLowerCase` apenas. As fixtures de teste usam
texto **sem acento** de propósito (`inacessivel`, `transito`), porque a saída
real do `ping.exe` chega no console em codepage 850 e o acento não sobrevive
à leitura em UTF-8. As agulhas acima também são sem acento. As mensagens
gravadas em `medicao.mensagem` **são** acentuadas — são literais Java, não
vêm do processo.

- [ ] **Step 5: Rodar os testes do parser**

Run: `./mvnw -o test -Dtest=PingOutputParserTest`
Expected: PASS, 14 testes.

- [ ] **Step 6: Trocar a interface e escrever o runner de processo**

`src/main/java/br/com/inframonitor/monitoring/icmp/IcmpCommandRunner.java` passa a ser:

```java
package br.com.inframonitor.monitoring.icmp;

import java.io.IOException;

public interface IcmpCommandRunner {
    IcmpResult run(String ip, int timeoutMs) throws IOException, InterruptedException;
}
```

Apagar `IcmpProcessResult.java` e `LinuxPingCommandRunner.java`.

Criar `src/main/java/br/com/inframonitor/monitoring/icmp/processo/ProcessoPingIcmpRunner.java`:

```java
package br.com.inframonitor.monitoring.icmp.processo;

import br.com.inframonitor.monitoring.icmp.IcmpCommandRunner;
import br.com.inframonitor.monitoring.icmp.IcmpResult;

import java.io.IOException;
import java.nio.charset.Charset;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * Executa o binario ping e le a SAIDA. Nunca invoca um shell.
 * Substitui LinuxPingCommandRunner, que descartava a saida e decidia pelo
 * codigo de saida do processo.
 */
public class ProcessoPingIcmpRunner implements IcmpCommandRunner {

    @Override
    public IcmpResult run(String ip, int timeoutMs) throws IOException, InterruptedException {
        ProcessBuilder builder = new ProcessBuilder(comando(ip, timeoutMs)).redirectErrorStream(true);
        Process process = builder.start();
        String saida;
        boolean terminou;
        try {
            saida = new String(process.getInputStream().readAllBytes(), Charset.defaultCharset());
            terminou = process.waitFor(timeoutMs + 1_000L, TimeUnit.MILLISECONDS);
        } finally {
            if (process.isAlive()) {
                encerrar(process);
            }
        }
        return PingOutputParser.analisar(ip, saida, terminou);
    }

    private java.util.List<String> comando(String ip, int timeoutMs) {
        if (isWindows()) {
            return java.util.List.of("ping", "-n", "1", "-w", String.valueOf(timeoutMs), ip);
        }
        // -W e em segundos e nao aceita fracao; arredonda para cima para nunca
        // ficar menor que o timeout pedido.
        long segundos = Math.max(1L, (timeoutMs + 999L) / 1000L);
        return java.util.List.of("ping", "-n", "-c", "1", "-W", String.valueOf(segundos), ip);
    }

    private void encerrar(Process process) throws InterruptedException {
        process.destroy();
        if (!process.waitFor(250, TimeUnit.MILLISECONDS)) {
            process.destroyForcibly();
            process.waitFor(250, TimeUnit.MILLISECONDS);
        }
    }

    static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }
}
```

Note que a anotação `@Component` **saiu**: na Task 3 quem cria o bean é a
configuração que escolhe a implementação. Entre a Task 1 e a Task 3 o bean
não existe, e o `IcmpMonitorExecutor` só é criado com
`monitoring.engine.enabled=true`, que está desligado — a suíte continua verde.

- [ ] **Step 7: Reescrever o executor**

`src/main/java/br/com/inframonitor/monitoring/icmp/IcmpMonitorExecutor.java`:

```java
package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitoring.execution.MonitorCandidate;
import br.com.inframonitor.monitoring.execution.MonitorExecutionResult;
import br.com.inframonitor.monitoring.execution.MonitorExecutor;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.Clock;
import java.time.Instant;

@Component
@ConditionalOnProperty(prefix = "monitoring.engine", name = "enabled", havingValue = "true")
public class IcmpMonitorExecutor implements MonitorExecutor {

    private final IcmpCommandRunner commandRunner;
    private final Clock clock;

    public IcmpMonitorExecutor(IcmpCommandRunner commandRunner, @Qualifier("monitoringClock") Clock clock) {
        this.commandRunner = commandRunner;
        this.clock = clock;
    }

    @Override
    public TipoMonitor supports() {
        return TipoMonitor.ICMP;
    }

    /**
     * Decide SO pelo status. Nao ha cronometro em volta da chamada: a latencia
     * gravada e o RTT que a pilha de rede informou, nunca o tempo de processo.
     */
    @Override
    public MonitorExecutionResult execute(MonitorCandidate monitor) {
        Instant executedAt = clock.instant();
        try {
            IcmpResult result = commandRunner.run(monitor.ip(), monitor.timeoutMs());
            if (result.status() == StatusIcmp.SUCESSO) {
                return MonitorExecutionResult.success(result.rttMs() == null ? 0 : result.rttMs(), executedAt);
            }
            return MonitorExecutionResult.failure(mensagem(result), executedAt);
        } catch (IOException exception) {
            return MonitorExecutionResult.failure("Erro ao executar a sondagem ICMP", executedAt);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return MonitorExecutionResult.failure("Sondagem ICMP interrompida", executedAt);
        }
    }

    static String mensagem(IcmpResult result) {
        return switch (result.status()) {
            case SUCESSO -> null;
            case TIMEOUT -> "Timeout";
            case HOST_INACESSIVEL -> "Host de destino inacessível";
            case REDE_INACESSIVEL -> "Rede de destino inacessível";
            case TTL_EXPIRADO -> "TTL expirado em trânsito";
            case ERRO -> "Erro ICMP " + (result.codigoNativo() == null ? 0 : result.codigoNativo());
        };
    }
}
```

- [ ] **Step 8: Reescrever o teste do executor**

Substituir todo o conteúdo de `src/test/java/br/com/inframonitor/monitoring/icmp/IcmpMonitorExecutorTest.java`:

```java
package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitoring.execution.MonitorCandidate;
import br.com.inframonitor.monitoring.execution.MonitorExecutionResult;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class IcmpMonitorExecutorTest {

    private static final Instant AGORA = Instant.parse("2026-09-21T12:00:00Z");
    private static final Clock RELOGIO = Clock.fixed(AGORA, ZoneOffset.UTC);
    private static final MonitorCandidate MONITOR =
            new MonitorCandidate(1L, TipoMonitor.ICMP, 60, 3_000, "10.79.10.6", null);

    private static IcmpMonitorExecutor executorQueDevolve(IcmpResult resultado) {
        return new IcmpMonitorExecutor((ip, timeoutMs) -> resultado, RELOGIO);
    }

    @Test
    @DisplayName("SUCESSO grava o RTT informado, sem cronometro")
    void sucessoGravaRtt() {
        MonitorExecutionResult r = executorQueDevolve(IcmpResult.sucesso(7)).execute(MONITOR);
        assertThat(r.success()).isTrue();
        assertThat(r.latencyMs()).isEqualTo(7);
        assertThat(r.message()).isNull();
        assertThat(r.executedAt()).isEqualTo(AGORA);
    }

    @Test
    @DisplayName("TTL expirado e FALHA, nao sucesso")
    void ttlExpiradoEFalha() {
        MonitorExecutionResult r = executorQueDevolve(IcmpResult.falha(StatusIcmp.TTL_EXPIRADO)).execute(MONITOR);
        assertThat(r.success()).isFalse();
        assertThat(r.message()).isEqualTo("TTL expirado em trânsito");
        assertThat(r.latencyMs()).isNull();
    }

    @Test
    @DisplayName("host inacessivel e FALHA, nao sucesso")
    void hostInacessivelEFalha() {
        MonitorExecutionResult r = executorQueDevolve(IcmpResult.falha(StatusIcmp.HOST_INACESSIVEL)).execute(MONITOR);
        assertThat(r.success()).isFalse();
        assertThat(r.message()).isEqualTo("Host de destino inacessível");
    }

    @Test
    void redeInacessivelEFalha() {
        MonitorExecutionResult r = executorQueDevolve(IcmpResult.falha(StatusIcmp.REDE_INACESSIVEL)).execute(MONITOR);
        assertThat(r.success()).isFalse();
        assertThat(r.message()).isEqualTo("Rede de destino inacessível");
    }

    @Test
    void timeoutEFalha() {
        MonitorExecutionResult r = executorQueDevolve(IcmpResult.falha(StatusIcmp.TIMEOUT)).execute(MONITOR);
        assertThat(r.success()).isFalse();
        assertThat(r.message()).isEqualTo("Timeout");
    }

    @Test
    @DisplayName("codigo desconhecido vai para a mensagem")
    void erroLevaOCodigo() {
        MonitorExecutionResult r = executorQueDevolve(IcmpResult.erro(11050)).execute(MONITOR);
        assertThat(r.success()).isFalse();
        assertThat(r.message()).isEqualTo("Erro ICMP 11050");
    }

    @Test
    @DisplayName("todas as mensagens cabem em medicao.mensagem VARCHAR(255)")
    void mensagensCabemNaColuna() {
        for (StatusIcmp status : StatusIcmp.values()) {
            IcmpResult resultado = status == StatusIcmp.SUCESSO
                    ? IcmpResult.sucesso(1)
                    : status == StatusIcmp.ERRO ? IcmpResult.erro(2147483647) : IcmpResult.falha(status);
            String mensagem = IcmpMonitorExecutor.mensagem(resultado);
            if (mensagem != null) {
                assertThat(mensagem.length()).isLessThanOrEqualTo(255);
            }
        }
    }

    @Test
    void ioExceptionViraFalha() {
        IcmpMonitorExecutor executor = new IcmpMonitorExecutor((ip, timeoutMs) -> {
            throw new IOException("sem permissao");
        }, RELOGIO);
        MonitorExecutionResult r = executor.execute(MONITOR);
        assertThat(r.success()).isFalse();
        assertThat(r.message()).isEqualTo("Erro ao executar a sondagem ICMP");
    }
}
```

- [ ] **Step 9: Rodar a suíte inteira**

Run: `./mvnw -o test`
Expected: PASS. Anotar a contagem de testes (`Tests run: N`).

- [ ] **Step 10: Commit**

```bash
git add -A src/main/java/br/com/inframonitor/monitoring/icmp src/test/java/br/com/inframonitor/monitoring/icmp pom.xml
git commit -m "$(cat <<'EOF'
fix(icmp): decidir pelo status ICMP em vez do codigo de saida do ping

O ping.exe do Windows sai com 0 tanto para uma resposta valida quanto para
"TTL expirou em transito" e "Host de destino inacessivel". Dois dos quatro
alvos de homologacao eram gravados como SUCESSO.

IcmpProcessResult(timedOut, exitCode, elapsedMs) da lugar a
IcmpResult(StatusIcmp, rttMs, codigoNativo). A saida do processo passa a ser
lida por PingOutputParser em vez de descartada, e o cronometro em volta da
chamada some: a latencia gravada e o RTT informado pela rede.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Implementação nativa do Windows via IcmpSendEcho

**Files:**
- Create: `src/main/java/br/com/inframonitor/monitoring/icmp/nativo/Iphlpapi.java`
- Create: `src/main/java/br/com/inframonitor/monitoring/icmp/nativo/IcmpEchoReply.java`
- Create: `src/main/java/br/com/inframonitor/monitoring/icmp/nativo/WindowsNativeIcmpRunner.java`
- Test: `src/test/java/br/com/inframonitor/monitoring/icmp/nativo/WindowsNativeIcmpRunnerTest.java`

**Interfaces:**
- Consumes: `IcmpResult`, `StatusIcmp`, `IcmpCommandRunner` (Task 1).
- Produces: `Iphlpapi` (interface fina, simulável) com `Pointer icmpCreateFile()`, `Retorno icmpSendEcho(Pointer handle, int destino, Pointer requisicao, short tamanho, Pointer opcoes, Pointer reply, int tamanhoReply, int timeoutMs)`, `void icmpCloseHandle(Pointer handle)`; `Iphlpapi.Retorno(int valor, int ultimoErro)`; `WindowsNativeIcmpRunner(Iphlpapi)`; `WindowsNativeIcmpRunner.mapear(int codigo) -> StatusIcmp`.

- [ ] **Step 1: Escrever o teste do mapeamento (falhando)**

Criar `src/test/java/br/com/inframonitor/monitoring/icmp/nativo/WindowsNativeIcmpRunnerTest.java`:

```java
package br.com.inframonitor.monitoring.icmp.nativo;

import br.com.inframonitor.monitoring.icmp.IcmpResult;
import br.com.inframonitor.monitoring.icmp.StatusIcmp;
import com.sun.jna.Memory;
import com.sun.jna.Pointer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A camada JNA esta isolada atras de Iphlpapi e e simulada aqui: nenhum teste
 * desta classe toca a rede nem carrega a biblioteca nativa.
 */
class WindowsNativeIcmpRunnerTest {

    /** Iphlpapi de mentira: devolve o que o teste mandar e conta os handles. */
    private static final class IphlpapiFalsa implements Iphlpapi {
        private final Iphlpapi.Retorno retorno;
        private final Integer statusNoReply;
        private final int rttNoReply;
        final List<String> chamadas = new ArrayList<>();
        Memory bufferOpcoes;

        IphlpapiFalsa(Iphlpapi.Retorno retorno, Integer statusNoReply, int rttNoReply) {
            this.retorno = retorno;
            this.statusNoReply = statusNoReply;
            this.rttNoReply = rttNoReply;
        }

        @Override
        public Pointer icmpCreateFile() {
            chamadas.add("create");
            return new Memory(8);
        }

        @Override
        public Retorno icmpSendEcho(Pointer handle, int destino, Pointer requisicao, short tamanho,
                                    Pointer opcoes, Pointer reply, int tamanhoReply, int timeoutMs) {
            chamadas.add("send");
            if (opcoes != null) {
                bufferOpcoes = null;
                ttlRecebido = opcoes.getByte(0);
            }
            if (statusNoReply != null) {
                reply.setInt(4, statusNoReply);
                reply.setInt(8, rttNoReply);
            }
            return retorno;
        }

        @Override
        public void icmpCloseHandle(Pointer handle) {
            chamadas.add("close");
        }

        byte ttlRecebido;
    }

    private static IcmpResult rodar(Iphlpapi.Retorno retorno, Integer statusNoReply, int rtt) {
        return new WindowsNativeIcmpRunner(new IphlpapiFalsa(retorno, statusNoReply, rtt))
                .run("10.79.10.6", 3_000);
    }

    @ParameterizedTest(name = "reply Status {0} vira {1}")
    @CsvSource({
            "0, SUCESSO",
            "11002, REDE_INACESSIVEL",
            "11003, HOST_INACESSIVEL",
            "11010, TIMEOUT",
            "11013, TTL_EXPIRADO"
    })
    @DisplayName("retorno >= 1: o status vem do ICMP_ECHO_REPLY")
    void mapeiaStatusDoReply(int codigo, StatusIcmp esperado) {
        IcmpResult r = rodar(new Iphlpapi.Retorno(1, 0), codigo, 5);
        assertThat(r.status()).isEqualTo(esperado);
    }

    @ParameterizedTest(name = "GetLastError {0} vira {1}")
    @CsvSource({
            "11002, REDE_INACESSIVEL",
            "11003, HOST_INACESSIVEL",
            "11010, TIMEOUT",
            "11013, TTL_EXPIRADO"
    })
    @DisplayName("retorno 0: o codigo vem do GetLastError, nao do reply")
    void mapeiaStatusDoUltimoErro(int codigo, StatusIcmp esperado) {
        IcmpResult r = rodar(new Iphlpapi.Retorno(0, codigo), null, 0);
        assertThat(r.status()).isEqualTo(esperado);
    }

    @Test
    @DisplayName("codigo desconhecido vira ERRO carregando o codigo")
    void codigoDesconhecidoViraErro() {
        IcmpResult r = rodar(new Iphlpapi.Retorno(1, 0), 11050, 0);
        assertThat(r.status()).isEqualTo(StatusIcmp.ERRO);
        assertThat(r.codigoNativo()).isEqualTo(11050);
    }

    @Test
    @DisplayName("RTT so sobrevive no sucesso; em erro ele vem preenchido e e lixo")
    void rttSoNoSucesso() {
        assertThat(rodar(new Iphlpapi.Retorno(1, 0), 0, 12).rttMs()).isEqualTo(12);
        assertThat(rodar(new Iphlpapi.Retorno(1, 0), 11003, 2998).rttMs()).isNull();
    }

    @Test
    @DisplayName("o handle e sempre fechado, inclusive quando IcmpSendEcho lanca")
    void handleSempreFechado() {
        IphlpapiFalsa falsa = new IphlpapiFalsa(new Iphlpapi.Retorno(1, 0), 0, 1) {
            @Override
            public Retorno icmpSendEcho(Pointer h, int d, Pointer rq, short t, Pointer o,
                                        Pointer rp, int tr, int tm) {
                chamadas.add("send");
                throw new IllegalStateException("estouro nativo");
            }
        };
        IcmpResult r = new WindowsNativeIcmpRunner(falsa).run("10.79.10.6", 3_000);
        assertThat(r.status()).isEqualTo(StatusIcmp.ERRO);
        assertThat(falsa.chamadas).containsExactly("create", "send", "close");
    }

    @Test
    @DisplayName("um handle por chamada: create e close em toda sondagem")
    void umHandlePorChamada() {
        IphlpapiFalsa falsa = new IphlpapiFalsa(new Iphlpapi.Retorno(1, 0), 0, 1);
        WindowsNativeIcmpRunner runner = new WindowsNativeIcmpRunner(falsa);
        runner.run("10.79.10.6", 3_000);
        runner.run("10.79.10.6", 3_000);
        assertThat(falsa.chamadas).containsExactly("create", "send", "close", "create", "send", "close");
    }

    @Test
    @DisplayName("IP_OPTION_INFORMATION vai com Ttl 128 - sem isso o A.0 mediu timeout espurio 9 em 10")
    void passaTtl128() {
        IphlpapiFalsa falsa = new IphlpapiFalsa(new Iphlpapi.Retorno(1, 0), 0, 1);
        new WindowsNativeIcmpRunner(falsa).run("10.79.10.6", 3_000);
        assertThat(falsa.ttlRecebido).isEqualTo((byte) 128);
    }

    @Test
    @DisplayName("IP vira inteiro em ordem de rede")
    void enderecoEmOrdemDeRede() {
        assertThat(WindowsNativeIcmpRunner.paraOrdemDeRede("10.79.10.6"))
                .isEqualTo(10 | (79 << 8) | (10 << 16) | (6 << 24));
    }
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./mvnw -o test -Dtest=WindowsNativeIcmpRunnerTest`
Expected: FAIL na compilação — `Iphlpapi` e `WindowsNativeIcmpRunner` não existem.

- [ ] **Step 3: Criar a interface fina da JNA**

`src/main/java/br/com/inframonitor/monitoring/icmp/nativo/Iphlpapi.java`:

```java
package br.com.inframonitor.monitoring.icmp.nativo;

import com.sun.jna.LastErrorException;
import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.win32.StdCallLibrary;
import com.sun.jna.win32.W32APIOptions;

/**
 * Camada fina sobre IPHLPAPI. Existe para que WindowsNativeIcmpRunner possa ser
 * testado sem carregar a biblioteca nativa nem tocar a rede.
 */
public interface Iphlpapi {

    /**
     * Quando IcmpSendEcho devolve 0 nenhuma resposta chegou e o codigo esta em
     * GetLastError, nao no reply. Os dois caminhos foram observados na mesma
     * rede em 2026-09-21.
     */
    record Retorno(int valor, int ultimoErro) { }

    Pointer icmpCreateFile();

    Retorno icmpSendEcho(Pointer handle, int destino, Pointer requisicao, short tamanho,
                         Pointer opcoes, Pointer reply, int tamanhoReply, int timeoutMs);

    void icmpCloseHandle(Pointer handle);

    /** Ligacao real com a DLL. So e carregada no Windows. */
    final class Jna implements Iphlpapi {

        private interface Biblioteca extends StdCallLibrary {
            Biblioteca INSTANCE = Native.load("Iphlpapi", Biblioteca.class, W32APIOptions.DEFAULT_OPTIONS);

            Pointer IcmpCreateFile() throws LastErrorException;

            int IcmpSendEcho(Pointer handle, int destinationAddress, Pointer requestData, short requestSize,
                             Pointer requestOptions, Pointer replyBuffer, int replySize, int timeout)
                    throws LastErrorException;

            boolean IcmpCloseHandle(Pointer handle) throws LastErrorException;
        }

        @Override
        public Pointer icmpCreateFile() {
            return Biblioteca.INSTANCE.IcmpCreateFile();
        }

        @Override
        public Retorno icmpSendEcho(Pointer handle, int destino, Pointer requisicao, short tamanho,
                                    Pointer opcoes, Pointer reply, int tamanhoReply, int timeoutMs) {
            try {
                int valor = Biblioteca.INSTANCE.IcmpSendEcho(handle, destino, requisicao, tamanho,
                        opcoes, reply, tamanhoReply, timeoutMs);
                return new Retorno(valor, 0);
            } catch (LastErrorException excecao) {
                // JNA lanca quando GetLastError != 0 apos a chamada; o valor de
                // retorno foi 0 e o codigo real esta aqui.
                return new Retorno(0, excecao.getErrorCode());
            }
        }

        @Override
        public void icmpCloseHandle(Pointer handle) {
            Biblioteca.INSTANCE.IcmpCloseHandle(handle);
        }
    }
}
```

- [ ] **Step 4: Criar a Structure do reply**

`src/main/java/br/com/inframonitor/monitoring/icmp/nativo/IcmpEchoReply.java`:

```java
package br.com.inframonitor.monitoring.icmp.nativo;

import com.sun.jna.Pointer;
import com.sun.jna.Structure;

/** ICMP_ECHO_REPLY. Em x64 o campo data fica alinhado em 8, por isso a ordem importa. */
@Structure.FieldOrder({"address", "status", "roundTripTime", "dataSize", "reserved", "data",
        "ttl", "tos", "flags", "optionsSize", "optionsData"})
public class IcmpEchoReply extends Structure {
    public int address;
    public int status;
    public int roundTripTime;
    public short dataSize;
    public short reserved;
    public Pointer data;
    public byte ttl;
    public byte tos;
    public byte flags;
    public byte optionsSize;
    public Pointer optionsData;

    public IcmpEchoReply(Pointer buffer) {
        super(buffer);
        read();
    }
}
```

- [ ] **Step 5: Criar o runner nativo**

`src/main/java/br/com/inframonitor/monitoring/icmp/nativo/WindowsNativeIcmpRunner.java`:

```java
package br.com.inframonitor.monitoring.icmp.nativo;

import br.com.inframonitor.monitoring.icmp.IcmpCommandRunner;
import br.com.inframonitor.monitoring.icmp.IcmpResult;
import br.com.inframonitor.monitoring.icmp.StatusIcmp;
import com.sun.jna.Memory;
import com.sun.jna.Pointer;

/** Sondagem ICMP pela API do Windows. O status vem como numero, imune ao idioma do sistema. */
public class WindowsNativeIcmpRunner implements IcmpCommandRunner {

    private static final int IP_SUCCESS = 0;
    private static final int IP_DEST_NET_UNREACHABLE = 11002;
    private static final int IP_DEST_HOST_UNREACHABLE = 11003;
    private static final int IP_REQ_TIMED_OUT = 11010;
    private static final int IP_TTL_EXPIRED_TRANSIT = 11013;

    private static final int TAMANHO_REQUISICAO = 32;
    /** ICMP_ECHO_REPLY (40 em x64) + dados + 8 para a mensagem de erro ICMP; com folga. */
    private static final int TAMANHO_REPLY = 168;
    /** IP_OPTION_INFORMATION em x64: Ttl, Tos, Flags, OptionsSize, padding, PUCHAR. */
    private static final int TAMANHO_OPCOES = 16;
    /** Mesmo default do ping.exe. Com RequestOptions NULL o A.0 mediu timeout espurio 9 em 10. */
    private static final byte TTL_PADRAO = (byte) 128;

    private final Iphlpapi iphlpapi;

    public WindowsNativeIcmpRunner(Iphlpapi iphlpapi) {
        this.iphlpapi = iphlpapi;
    }

    @Override
    public IcmpResult run(String ip, int timeoutMs) {
        Pointer handle = null;
        try {
            handle = iphlpapi.icmpCreateFile();
            if (handle == null || Pointer.nativeValue(handle) == 0L || Pointer.nativeValue(handle) == -1L) {
                return IcmpResult.erro(IP_REQ_TIMED_OUT);
            }
            try (Memory requisicao = new Memory(TAMANHO_REQUISICAO);
                 Memory reply = new Memory(TAMANHO_REPLY);
                 Memory opcoes = new Memory(TAMANHO_OPCOES)) {
                requisicao.clear();
                reply.clear();
                opcoes.clear();
                opcoes.setByte(0, TTL_PADRAO);

                Iphlpapi.Retorno retorno = iphlpapi.icmpSendEcho(handle, paraOrdemDeRede(ip), requisicao,
                        (short) TAMANHO_REQUISICAO, opcoes, reply, TAMANHO_REPLY, timeoutMs);

                if (retorno.valor() == 0) {
                    return paraResultado(retorno.ultimoErro(), 0);
                }
                IcmpEchoReply lido = new IcmpEchoReply(reply);
                return paraResultado(lido.status, lido.roundTripTime);
            }
        } catch (RuntimeException excecao) {
            return IcmpResult.erro(0);
        } finally {
            if (handle != null) {
                try {
                    iphlpapi.icmpCloseHandle(handle);
                } catch (RuntimeException ignorada) {
                    // Fechar o handle nunca pode derrubar a sondagem.
                }
            }
        }
    }

    private static IcmpResult paraResultado(int codigo, int rttMs) {
        StatusIcmp status = mapear(codigo);
        if (status == StatusIcmp.SUCESSO) {
            return IcmpResult.sucesso(rttMs);
        }
        if (status == StatusIcmp.ERRO) {
            return IcmpResult.erro(codigo);
        }
        return IcmpResult.falha(status);
    }

    static StatusIcmp mapear(int codigo) {
        return switch (codigo) {
            case IP_SUCCESS -> StatusIcmp.SUCESSO;
            case IP_DEST_NET_UNREACHABLE -> StatusIcmp.REDE_INACESSIVEL;
            case IP_DEST_HOST_UNREACHABLE -> StatusIcmp.HOST_INACESSIVEL;
            case IP_REQ_TIMED_OUT -> StatusIcmp.TIMEOUT;
            case IP_TTL_EXPIRED_TRANSIT -> StatusIcmp.TTL_EXPIRADO;
            default -> StatusIcmp.ERRO;
        };
    }

    /** IPAddr e um ULONG em ordem de rede: o primeiro octeto ocupa o byte menos significativo. */
    static int paraOrdemDeRede(String ip) {
        String[] octetos = ip.split("[.]");
        if (octetos.length != 4) {
            throw new IllegalArgumentException("IPv4 invalido: " + ip);
        }
        return (Integer.parseInt(octetos[0]) & 0xFF)
                | ((Integer.parseInt(octetos[1]) & 0xFF) << 8)
                | ((Integer.parseInt(octetos[2]) & 0xFF) << 16)
                | ((Integer.parseInt(octetos[3]) & 0xFF) << 24);
    }
}
```

- [ ] **Step 6: Rodar os testes**

Run: `./mvnw -o test -Dtest=WindowsNativeIcmpRunnerTest`
Expected: PASS.

Se o teste `handleSempreFechado` falhar porque `IphlpapiFalsa` é `final`, remova o
`final` da classe interna — ela é estendida anonimamente nesse teste.

- [ ] **Step 7: Suíte inteira**

Run: `./mvnw -o test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src/main/java/br/com/inframonitor/monitoring/icmp/nativo src/test/java/br/com/inframonitor/monitoring/icmp/nativo
git commit -m "$(cat <<'EOF'
feat(icmp): sondagem nativa no Windows via IcmpSendEcho

O status ICMP vem como numero, imune ao idioma do sistema, e cobre os dois
caminhos: retorno >= 1 traz o status no ICMP_ECHO_REPLY, retorno 0 traz o
codigo no GetLastError.

IP_OPTION_INFORMATION vai com Ttl 128: com RequestOptions NULL a API devolveu
timeout espurio em 9 de 10 sondagens contra o alvo de TTL expirado.

Um handle por chamada, fechado em finally. IcmpSendEcho e thread-safe, mas o
compartilhamento do mesmo HANDLE entre as 4 threads de worker nao e garantido.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Escolha da implementação por propriedade

**Files:**
- Create: `src/main/java/br/com/inframonitor/monitoring/icmp/IcmpImplementacao.java`
- Create: `src/main/java/br/com/inframonitor/monitoring/icmp/IcmpProperties.java`
- Create: `src/main/java/br/com/inframonitor/monitoring/icmp/IcmpRunnerConfiguration.java`
- Modify: `src/main/resources/application.yml`
- Test: `src/test/java/br/com/inframonitor/monitoring/icmp/IcmpRunnerConfigurationTest.java`

**Interfaces:**
- Consumes: `IcmpCommandRunner`, `WindowsNativeIcmpRunner`, `ProcessoPingIcmpRunner`.
- Produces: `IcmpImplementacao` (`AUTO`, `NATIVO_WINDOWS`, `PROCESSO_PING`); `IcmpRunnerConfiguration.escolher(IcmpImplementacao, boolean windows) -> IcmpImplementacao` (nunca devolve `AUTO`).

- [ ] **Step 1: Teste da escolha (falhando)**

`src/test/java/br/com/inframonitor/monitoring/icmp/IcmpRunnerConfigurationTest.java`:

```java
package br.com.inframonitor.monitoring.icmp;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class IcmpRunnerConfigurationTest {

    @Test
    @DisplayName("auto no Windows escolhe o nativo")
    void autoNoWindows() {
        assertThat(IcmpRunnerConfiguration.escolher(IcmpImplementacao.AUTO, true))
                .isEqualTo(IcmpImplementacao.NATIVO_WINDOWS);
    }

    @Test
    @DisplayName("auto fora do Windows escolhe a leitura de texto")
    void autoForaDoWindows() {
        assertThat(IcmpRunnerConfiguration.escolher(IcmpImplementacao.AUTO, false))
                .isEqualTo(IcmpImplementacao.PROCESSO_PING);
    }

    @Test
    @DisplayName("valvula de escape: processo-ping forcado vence o sistema operacional")
    void forcarProcessoNoWindows() {
        assertThat(IcmpRunnerConfiguration.escolher(IcmpImplementacao.PROCESSO_PING, true))
                .isEqualTo(IcmpImplementacao.PROCESSO_PING);
    }

    @Test
    void forcarNativo() {
        assertThat(IcmpRunnerConfiguration.escolher(IcmpImplementacao.NATIVO_WINDOWS, true))
                .isEqualTo(IcmpImplementacao.NATIVO_WINDOWS);
    }

    @Test
    @DisplayName("escolher nunca devolve AUTO")
    void nuncaDevolveAuto() {
        for (IcmpImplementacao pedida : IcmpImplementacao.values()) {
            assertThat(IcmpRunnerConfiguration.escolher(pedida, true)).isNotEqualTo(IcmpImplementacao.AUTO);
            assertThat(IcmpRunnerConfiguration.escolher(pedida, false)).isNotEqualTo(IcmpImplementacao.AUTO);
        }
    }
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `./mvnw -o test -Dtest=IcmpRunnerConfigurationTest`
Expected: FAIL na compilação.

- [ ] **Step 3: Criar o enum e as propriedades**

`src/main/java/br/com/inframonitor/monitoring/icmp/IcmpImplementacao.java`:

```java
package br.com.inframonitor.monitoring.icmp;

public enum IcmpImplementacao {
    AUTO,
    NATIVO_WINDOWS,
    PROCESSO_PING
}
```

`src/main/java/br/com/inframonitor/monitoring/icmp/IcmpProperties.java`:

```java
package br.com.inframonitor.monitoring.icmp;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("monitoring.icmp")
public class IcmpProperties {

    /** auto | nativo-windows | processo-ping. Valvula de escape se o nativo falhar em producao. */
    private IcmpImplementacao implementacao = IcmpImplementacao.AUTO;

    public IcmpImplementacao getImplementacao() {
        return implementacao;
    }

    public void setImplementacao(IcmpImplementacao implementacao) {
        this.implementacao = implementacao;
    }
}
```

- [ ] **Step 4: Criar a configuração**

`src/main/java/br/com/inframonitor/monitoring/icmp/IcmpRunnerConfiguration.java`:

```java
package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitoring.icmp.nativo.Iphlpapi;
import br.com.inframonitor.monitoring.icmp.nativo.WindowsNativeIcmpRunner;
import br.com.inframonitor.monitoring.icmp.processo.ProcessoPingIcmpRunner;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Locale;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(IcmpProperties.class)
@ConditionalOnProperty(prefix = "monitoring.engine", name = "enabled", havingValue = "true")
public class IcmpRunnerConfiguration {

    private static final Logger log = LoggerFactory.getLogger(IcmpRunnerConfiguration.class);

    @Bean
    IcmpCommandRunner icmpCommandRunner(IcmpProperties properties) {
        IcmpImplementacao escolhida = escolher(properties.getImplementacao(), isWindows());
        log.info("Implementacao ICMP escolhida: {} (pedida: {}, so={})",
                escolhida, properties.getImplementacao(), System.getProperty("os.name"));
        return escolhida == IcmpImplementacao.NATIVO_WINDOWS
                ? new WindowsNativeIcmpRunner(new Iphlpapi.Jna())
                : new ProcessoPingIcmpRunner();
    }

    /** Resolve AUTO; nunca devolve AUTO. */
    static IcmpImplementacao escolher(IcmpImplementacao pedida, boolean windows) {
        if (pedida != IcmpImplementacao.AUTO) {
            return pedida;
        }
        return windows ? IcmpImplementacao.NATIVO_WINDOWS : IcmpImplementacao.PROCESSO_PING;
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }
}
```

- [ ] **Step 5: Documentar a propriedade no application.yml**

Em `src/main/resources/application.yml`, dentro do bloco `monitoring:` que já
existe (mesmo nível de indentação de `engine:`), acrescentar:

```yaml
  icmp:
    # auto | nativo-windows | processo-ping
    # auto: IcmpSendEcho no Windows, leitura do texto do ping no resto.
    # Valvula de escape: forcar processo-ping se a JNA falhar em producao.
    implementacao: ${MONITORING_ICMP_IMPLEMENTACAO:auto}
```

Não alterar mais nada no arquivo. **Não** ligar `monitoring.engine.enabled`.

- [ ] **Step 6: Rodar os testes**

Run: `./mvnw -o test -Dtest=IcmpRunnerConfigurationTest`
Expected: PASS, 5 testes.

- [ ] **Step 7: Suíte inteira**

Run: `./mvnw -o test`
Expected: PASS. O contexto Spring dos testes tem de continuar subindo — se
`InfraMonitorApplicationTests` reclamar de bean duplicado de `IcmpCommandRunner`,
confirme que `@Component` foi mesmo removido de `ProcessoPingIcmpRunner`.

- [ ] **Step 8: Commit**

```bash
git add -A src/main/java/br/com/inframonitor/monitoring/icmp src/test/java/br/com/inframonitor/monitoring/icmp src/main/resources/application.yml
git commit -m "$(cat <<'EOF'
feat(icmp): escolher a implementacao por monitoring.icmp.implementacao

auto decide pelo sistema operacional; nativo-windows e processo-ping forcam.
A escolha e registrada em log na subida. Serve de valvula de escape caso a
JNA falhe num servidor de producao: e variavel de ambiente, nao redeploy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Prova de reversão e teste contra a rede real

**Files:**
- Test: `src/test/java/br/com/inframonitor/monitoring/icmp/ProvaDeReversaoIcmpTest.java`
- Test: `src/test/java/br/com/inframonitor/monitoring/icmp/IcmpRedeRealIT.java`
- Modify: `pom.xml` (excluir a tag `rede-real` da execução padrão do Surefire)
- Delete: `src/test/java/br/com/inframonitor/scratch/IcmpJnaProbe.java`

**Interfaces:**
- Consumes: `PingOutputParser`, `StatusIcmp`, `IcmpResult`, `WindowsNativeIcmpRunner`, `Iphlpapi.Jna`.
- Produces: nada.

- [ ] **Step 1: Escrever a prova de reversão**

`src/test/java/br/com/inframonitor/monitoring/icmp/ProvaDeReversaoIcmpTest.java`:

```java
package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitoring.icmp.processo.PingOutputParser;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Trava contra a regressao. A logica antiga era "exitCode != 0 e falha" e a
 * saida do processo era descartada. Este teste roda as MESMAS fixtures reais
 * contra aquela logica e prova que ela dava SUCESSO onde nao havia resposta.
 *
 * Se alguem reverter a correcao, os dois primeiros testes aqui passam a
 * concordar com o parser e este arquivo falha.
 */
class ProvaDeReversaoIcmpTest {

    // Saidas reais capturadas em 2026-09-21. Os tres primeiros saem com exit 0.
    private static final String TTL_EXPIRADO = """
            Disparando 10.72.10.16 com 32 bytes de dados:
            Resposta de 192.168.0.252: A vida util (TTL) expirou em transito.
            """;
    private static final int TTL_EXPIRADO_EXIT_CODE = 0;

    private static final String HOST_INACESSIVEL = """
            Disparando 10.79.20.250 com 32 bytes de dados:
            Resposta de 10.79.20.163: Host de destino inacessivel.
            """;
    private static final int HOST_INACESSIVEL_EXIT_CODE = 0;

    private static final String SUCESSO = """
            Disparando 10.79.10.6 com 32 bytes de dados:
            Resposta de 10.79.10.6: bytes=32 tempo<1ms TTL=127
            """;
    private static final int SUCESSO_EXIT_CODE = 0;

    private static final String TIMEOUT = """
            Disparando 10.73.10.15 com 32 bytes de dados:
            Esgotado o tempo limite do pedido.
            """;
    private static final int TIMEOUT_EXIT_CODE = 1;

    /** A logica antiga, reproduzida aqui para nao depender de codigo apagado. */
    private static boolean logicaAntigaDiziaSucesso(int exitCode) {
        return exitCode == 0;
    }

    @Test
    @DisplayName("TTL expirado: a logica antiga dizia SUCESSO, a nova diz TTL_EXPIRADO")
    void ttlExpiradoEraFalsoPositivo() {
        assertThat(logicaAntigaDiziaSucesso(TTL_EXPIRADO_EXIT_CODE))
                .as("exit code 0 - a logica antiga gravaria SUCESSO")
                .isTrue();
        assertThat(PingOutputParser.analisar("10.72.10.16", TTL_EXPIRADO, true).status())
                .isEqualTo(StatusIcmp.TTL_EXPIRADO);
    }

    @Test
    @DisplayName("Host inacessivel: a logica antiga dizia SUCESSO, a nova diz HOST_INACESSIVEL")
    void hostInacessivelEraFalsoPositivo() {
        assertThat(logicaAntigaDiziaSucesso(HOST_INACESSIVEL_EXIT_CODE))
                .as("exit code 0 - a logica antiga gravaria SUCESSO")
                .isTrue();
        assertThat(PingOutputParser.analisar("10.79.20.250", HOST_INACESSIVEL, true).status())
                .isEqualTo(StatusIcmp.HOST_INACESSIVEL);
    }

    @Test
    @DisplayName("os dois casos que a logica antiga acertava continuam certos")
    void casosQueJaEstavamCertosNaoRegridem() {
        assertThat(logicaAntigaDiziaSucesso(SUCESSO_EXIT_CODE)).isTrue();
        assertThat(PingOutputParser.analisar("10.79.10.6", SUCESSO, true).status())
                .isEqualTo(StatusIcmp.SUCESSO);

        assertThat(logicaAntigaDiziaSucesso(TIMEOUT_EXIT_CODE)).isFalse();
        assertThat(PingOutputParser.analisar("10.73.10.15", TIMEOUT, true).status())
                .isEqualTo(StatusIcmp.TIMEOUT);
    }

    @Test
    @DisplayName("placar: 2 dos 4 alvos de homologacao eram falso positivo")
    void placarDosFalsosPositivos() {
        record Caso(String ip, String saida, int exitCode) { }
        var casos = java.util.List.of(
                new Caso("10.79.10.6", SUCESSO, SUCESSO_EXIT_CODE),
                new Caso("10.72.10.16", TTL_EXPIRADO, TTL_EXPIRADO_EXIT_CODE),
                new Caso("10.79.20.250", HOST_INACESSIVEL, HOST_INACESSIVEL_EXIT_CODE),
                new Caso("10.73.10.15", TIMEOUT, TIMEOUT_EXIT_CODE));

        long falsosPositivos = casos.stream()
                .filter(c -> logicaAntigaDiziaSucesso(c.exitCode()))
                .filter(c -> PingOutputParser.analisar(c.ip(), c.saida(), true).status() != StatusIcmp.SUCESSO)
                .count();

        assertThat(falsosPositivos).isEqualTo(2);
    }
}
```

- [ ] **Step 2: Rodar**

Run: `./mvnw -o test -Dtest=ProvaDeReversaoIcmpTest`
Expected: PASS, 4 testes.

- [ ] **Step 3: Escrever o teste de rede real**

`src/test/java/br/com/inframonitor/monitoring/icmp/IcmpRedeRealIT.java`:

```java
package br.com.inframonitor.monitoring.icmp;

import br.com.inframonitor.monitoring.icmp.nativo.Iphlpapi;
import br.com.inframonitor.monitoring.icmp.nativo.WindowsNativeIcmpRunner;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Toca a rede Sesc de verdade. Fica FORA da execucao padrao (tag rede-real) e
 * so roda no Windows. Para rodar:
 *
 *   ./mvnw -o test -Dgroups=rede-real -Dtest=IcmpRedeRealIT
 */
@Tag("rede-real")
@EnabledOnOs(OS.WINDOWS)
class IcmpRedeRealIT {

    private static final int TIMEOUT_MS = 3_000;

    private static IcmpResult sondar(String ip) {
        return new WindowsNativeIcmpRunner(new Iphlpapi.Jna()).run(ip, TIMEOUT_MS);
    }

    @Test
    @DisplayName("10.79.10.6 responde")
    void alvoQueResponde() {
        IcmpResult r = sondar("10.79.10.6");
        System.out.println("10.79.10.6 -> " + r);
        assertThat(r.status()).isEqualTo(StatusIcmp.SUCESSO);
        assertThat(r.rttMs()).isNotNull().isLessThan(TIMEOUT_MS);
    }

    @Test
    @DisplayName("10.72.10.16 tem TTL expirado em transito")
    void alvoComTtlExpirado() {
        IcmpResult r = sondar("10.72.10.16");
        System.out.println("10.72.10.16 -> " + r);
        assertThat(r.status()).isEqualTo(StatusIcmp.TTL_EXPIRADO);
        assertThat(r.rttMs()).as("RTT so vale em SUCESSO").isNull();
    }

    @Test
    @DisplayName("10.79.20.250 e host inacessivel, com ARP frio e quente")
    void alvoInacessivelDuasVezes() {
        IcmpResult frio = sondar("10.79.20.250");
        IcmpResult quente = sondar("10.79.20.250");
        System.out.println("10.79.20.250 frio -> " + frio + " | quente -> " + quente);
        assertThat(frio.status()).isEqualTo(StatusIcmp.HOST_INACESSIVEL);
        assertThat(quente.status()).isEqualTo(StatusIcmp.HOST_INACESSIVEL);
    }

    @Test
    @DisplayName("10.73.10.15 da timeout")
    void alvoQueDaTimeout() {
        IcmpResult r = sondar("10.73.10.15");
        System.out.println("10.73.10.15 -> " + r);
        assertThat(r.status()).isEqualTo(StatusIcmp.TIMEOUT);
    }

    @Test
    @DisplayName("nenhum dos quatro alvos e classificado como ERRO")
    void nenhumAlvoCaiEmErro() {
        for (String ip : new String[]{"10.79.10.6", "10.72.10.16", "10.79.20.250", "10.73.10.15"}) {
            assertThat(sondar(ip).status()).as(ip).isNotEqualTo(StatusIcmp.ERRO);
        }
    }
}
```

- [ ] **Step 4: Excluir a tag da execução padrão**

No `pom.xml`, dentro de `<build><plugins>`, acrescentar ao lado do
`spring-boot-maven-plugin` que já existe:

```xml
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <configuration>
                    <!-- rede-real toca a rede Sesc; roda so sob demanda com -Dgroups=rede-real -->
                    <excludedGroups>rede-real</excludedGroups>
                </configuration>
            </plugin>
```

- [ ] **Step 5: Confirmar que o teste de rede fica fora do padrão**

Run: `./mvnw -o test`
Expected: PASS, e **nenhum** teste de `IcmpRedeRealIT` na contagem.

- [ ] **Step 6: Rodar o teste de rede explicitamente e guardar a saída**

Run: `./mvnw -o test -Dgroups=rede-real -Dtest=IcmpRedeRealIT -DfailIfNoTests=false`
Expected: PASS, 5 testes. Copiar a saída completa — ela entra no relatório da Task 5.

Se `10.72.10.16` vier `TIMEOUT` em vez de `TTL_EXPIRADO`, a causa provável é o
`IP_OPTION_INFORMATION` não ter chegado com `Ttl = 128`. Confira
`WindowsNativeIcmpRunner.TAMANHO_OPCOES` (tem de ser 16, não 8) antes de
culpar a rede.

- [ ] **Step 7: Apagar o probe descartável**

```bash
rm -f src/test/java/br/com/inframonitor/scratch/IcmpJnaProbe.java
rmdir src/test/java/br/com/inframonitor/scratch 2>/dev/null || true
```

Run: `./mvnw -o test`
Expected: PASS. Anotar a contagem final (`Tests run: N`).

- [ ] **Step 8: Commit**

```bash
git add -A src/test/java/br/com/inframonitor pom.xml
git commit -m "$(cat <<'EOF'
test(icmp): prova de reversao e sondagem contra a rede real

ProvaDeReversaoIcmpTest roda as fixtures reais contra a logica antiga
(exitCode != 0) e trava o placar: 2 dos 4 alvos de homologacao eram falso
positivo. Falha se a correcao for revertida.

IcmpRedeRealIT toca a rede Sesc; fica fora da execucao padrao pela tag
rede-real, excluida no surefire, e so roda no Windows.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Documentação do ciclo de validação

**Files:**
- Create: `Docs/validacao-producao/validacao-producao.md`
- Create: `Docs/validacao-producao/icmp-falsos-positivos.md`

**Interfaces:**
- Consumes: as saídas guardadas nas Tasks 1–4.
- Produces: nada (documentação).

Seguir a convenção de `Docs/mapa-architecture/`: um arquivo-índice curto que
aponta para os documentos do ciclo, e um documento por assunto. Ler
`Docs/mapa-architecture/mapa-architecture.md` antes de escrever, para copiar o
formato.

- [ ] **Step 1: Escrever o índice**

`Docs/validacao-producao/validacao-producao.md` — índice do ciclo, com:
- para que serve o ciclo (rodada de correções antes da validação com
  equipamentos reais);
- links para `icmp-falsos-positivos.md` e para
  `Docs/superpowers/specs/2026-09-21-icmp-nativo-windows-design.md`;
- a lista de dívidas do ciclo, cada uma com uma linha:
  1. nada detecta um período em que o monitoramento parou;
  2. o formato de saída do `ping` do Linux não foi verificado em máquina Linux;
  3. a execução como SYSTEM não foi verificada (`schtasks /ru SYSTEM` devolveu
     `ERRO: Acesso negado.`; a máquina não é administradora).

- [ ] **Step 2: Escrever o documento dos falsos positivos**

`Docs/validacao-producao/icmp-falsos-positivos.md`, com:
- a tabela dos 4 alvos com a saída real do `ping.exe` e o `exitCode`,
  marcando os dois falsos positivos;
- a saída bruta do `IcmpSendEcho` nos 4 alvos (retorno, Status do reply,
  GetLastError, RoundTripTime);
- a comparação `RoundTripTime` × `tempo=` do `ping.exe` em 10 amostras;
- a descoberta do `RequestOptions = NULL` (1 acerto em 10 sem TTL explícito,
  5 em 5 com `Ttl = 128`) e por que virou requisito;
- a decisão pela JNA, dizendo explicitamente que reverte a orientação de
  `Docs/Back-End-Docs/prompt-09-monitoring-engine-icmp.md`, e o motivo: no
  Windows o código de saída não expõe o status ICMP e o texto que expõe
  depende do idioma do sistema;
- a justificativa de handle por chamada em vez de handle por thread;
- a saída do `IcmpRedeRealIT` guardada na Task 4.

- [ ] **Step 3: Commit**

```bash
git add -A Docs/validacao-producao Docs/superpowers
git commit -m "$(cat <<'EOF'
docs(validacao): registrar os falsos positivos do ICMP e a decisao pela JNA

Reverte por escrito a orientacao de prompt-09-monitoring-engine-icmp.md de
executar o binario ping em qualquer sistema, com a evidencia que motivou a
troca e as tres dividas do ciclo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Auto-revisão do plano

**Cobertura do pedido A:**

| Requisito | Tarefa |
|---|---|
| A.0 trava de viabilidade | já executada antes deste plano; evidência vai para a Task 5 |
| A.1 contrato novo, sem cronômetro, mensagens em português | Task 1 |
| A.1 confirmar nome e tamanho do campo de mensagem | Task 1, Step 8 (`mensagensCabemNaColuna`) |
| A.2 Windows via IcmpSendEcho, códigos 0/11002/11003/11010/11013 | Task 2 |
| A.2 handle sempre fechado, seguro com 4 workers, justificativa | Task 2, Steps 1 e 5 |
| A.2 Linux com `-W`, saída lida, regex tolerante, `ttl=` + IP do alvo | Task 1, Steps 4 e 6 |
| A.2 propriedade de escolha + log na subida | Task 3 |
| A.2 renomear `LinuxPingCommandRunner` | Task 1, Step 6 (`ProcessoPingIcmpRunner`) |
| A.3 testes do leitor com fixtures reais + inglês + Linux de referência | Task 1, Step 1 |
| A.3 testes do mapeamento com JNA simulada | Task 2, Step 1 |
| A.3 prova de reversão | Task 4, Step 1 |
| A.3 teste de rede real fora do padrão | Task 4, Steps 3–6 |
| A.3 suíte verde, contagem antes/depois | Task 1 Step 9, Task 4 Step 7 |
| A.4 documento do ciclo | Task 5 |

A Parte B do pedido é proposta de desenho, sem código, e não faz parte deste
plano: sai em `Docs/validacao-producao/manutencao-proposta.md`, escrito
separadamente.

**Consistência de tipos:** `IcmpResult` tem sempre três componentes
(`status`, `rttMs`, `codigoNativo`) em todas as tarefas. `IcmpCommandRunner.run`
devolve `IcmpResult` e declara `IOException, InterruptedException` — o
`WindowsNativeIcmpRunner` não lança nenhuma das duas, o que é permitido.
`PingOutputParser.analisar(String, String, boolean)` tem a mesma assinatura na
Task 1 e na Task 4.

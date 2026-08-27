package br.com.inframonitor.notificacao.telegram;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;

class RestTelegramClientTest {
    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) server.stop(0);
    }

    @Test
    void enviaChatIdETextoEReconheceSucessoLogico() throws Exception {
        String[] request = new String[2];
        start(exchange -> {
            request[0] = exchange.getRequestURI().getPath();
            request[1] = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            respond(exchange, 200, "{\"ok\":true,\"result\":{}}");
        });

        var result = client(1_000).sendMessage("alerta operacional");

        assertThat(result.success()).isTrue();
        assertThat(request[0]).isEqualTo("/bottest-token/sendMessage");
        assertThat(request[1]).contains("\"chat_id\":\"-100123\"")
                .contains("\"text\":\"alerta operacional\"");
    }

    @Test
    void trataFalhaHttpELogicaSemExporToken() throws Exception {
        start(exchange -> respond(exchange, 400,
                "{\"ok\":false,\"description\":\"bad request test-token\"}"));

        var httpFailure = client(1_000).sendMessage("alerta");

        assertThat(httpFailure.success()).isFalse();
        assertThat(httpFailure.errorMessage()).contains("bad request").doesNotContain("test-token");

        server.stop(0);
        start(exchange -> respond(exchange, 200,
                "{\"ok\":false,\"description\":\"logical failure\"}"));
        var logicalFailure = client(1_000).sendMessage("alerta");
        assertThat(logicalFailure.success()).isFalse();
        assertThat(logicalFailure.errorMessage()).isEqualTo("logical failure");
    }

    @Test
    void timeoutNaoBloqueiaIndefinidamente() throws Exception {
        start(exchange -> {
            try { Thread.sleep(300); } catch (InterruptedException ex) { Thread.currentThread().interrupt(); }
            respond(exchange, 200, "{\"ok\":true}");
        });

        long started = System.nanoTime();
        var result = client(50).sendMessage("alerta");

        assertThat(result.success()).isFalse();
        assertThat(result.errorMessage()).contains("timeout");
        assertThat((System.nanoTime() - started) / 1_000_000).isLessThan(1_000);
    }

    private RestTelegramClient client(int readTimeoutMs) {
        TelegramProperties properties = new TelegramProperties();
        properties.setBotToken("test-token");
        properties.setChatId("-100123");
        properties.setApiBaseUrl("http://localhost:" + server.getAddress().getPort());
        properties.setConnectTimeoutMs(1_000);
        properties.setReadTimeoutMs(readTimeoutMs);
        return new RestTelegramClient(properties, new ObjectMapper());
    }

    private void start(ExchangeHandler handler) throws IOException {
        server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        server.createContext("/", handler::handle);
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
    }

    private void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    @FunctionalInterface
    private interface ExchangeHandler { void handle(HttpExchange exchange) throws IOException; }
}

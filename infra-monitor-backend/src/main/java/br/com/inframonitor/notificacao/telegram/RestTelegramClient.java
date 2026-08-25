package br.com.inframonitor.notificacao.telegram;

import br.com.inframonitor.notificacao.sender.SendResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.time.Duration;
import java.util.Map;

@Component
public class RestTelegramClient implements TelegramClient {
    private final TelegramProperties properties;
    private final ObjectMapper objectMapper;
    private final RestClient restClient;

    public RestTelegramClient(TelegramProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(properties.getConnectTimeoutMs());
        factory.setReadTimeout(properties.getReadTimeoutMs());
        this.restClient = RestClient.builder().baseUrl("https://api.telegram.org").requestFactory(factory).build();
    }

    @Override
    public SendResult sendMessage(String message) {
        try {
            String body = restClient.post().uri("/bot{token}/sendMessage", properties.getBotToken())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("chat_id", properties.getChatId(), "text", message))
                    .retrieve().body(String.class);
            JsonNode response = body == null ? null : objectMapper.readTree(body);
            return response != null && response.path("ok").asBoolean(false)
                    ? SendResult.sent() : failure(response, "Telegram recusou a mensagem");
        } catch (RestClientResponseException ex) {
            return failure(read(ex.getResponseBodyAsString()), "Telegram HTTP " + ex.getStatusCode().value());
        } catch (ResourceAccessException ex) {
            return SendResult.failure("Falha de conectividade ou timeout do Telegram", null);
        } catch (Exception ex) {
            return SendResult.failure("Falha ao comunicar com Telegram", null);
        }
    }

    private SendResult failure(JsonNode response, String fallback) {
        String description = response == null ? fallback : response.path("description").asText(fallback);
        Duration retryAfter = null;
        if (response != null && response.path("parameters").path("retry_after").canConvertToInt()) {
            retryAfter = Duration.ofSeconds(response.path("parameters").path("retry_after").asInt());
        }
        return SendResult.failure(sanitize(description), retryAfter);
    }
    private JsonNode read(String value) { try { return objectMapper.readTree(value); } catch (Exception ex) { return null; } }
    private String sanitize(String value) { return value == null ? "Falha no Telegram" : value.replaceAll("[\\r\\n]", " ").substring(0, Math.min(value.length(), 1000)); }
}

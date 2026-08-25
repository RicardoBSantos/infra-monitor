package br.com.inframonitor.notificacao.sender;

import java.time.Duration;

public record SendResult(boolean success, String errorMessage, Duration retryAfter) {
    public static SendResult sent() { return new SendResult(true, null, null); }
    public static SendResult failure(String message, Duration retryAfter) { return new SendResult(false, message, retryAfter); }
}

package br.com.inframonitor.common.exception;

import br.com.inframonitor.common.api.ErroResposta;
import br.com.inframonitor.auth.AccountDisabledException;
import br.com.inframonitor.auth.AuthenticationFailedException;
import br.com.inframonitor.relatorio.exportacao.ExportLimitExceededException;
import br.com.inframonitor.relatorio.exportacao.ExportTimeoutException;
import tools.jackson.databind.exc.InvalidFormatException;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.TypeMismatchException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import java.util.LinkedHashMap;
import java.util.Map;

/** Traduz exceções para o contrato público e estável de erros da API. */
@RestControllerAdvice
public class TratadorGlobalDeErros extends ResponseEntityExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(TratadorGlobalDeErros.class);

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex,
                                                                   HttpHeaders headers, HttpStatusCode status,
                                                                   WebRequest request) {
        Map<String, String> fields = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(error -> fields.putIfAbsent(error.getField(), error.getDefaultMessage()));
        return ResponseEntity.status(status).headers(headers).body(ErroResposta.deValidacao(status.value(),
                textoDoStatus(status), "Requisicao invalida", caminho(request), fields));
    }

    @Override
    protected ResponseEntity<Object> handleHttpMessageNotReadable(HttpMessageNotReadableException ex,
                                                                    HttpHeaders headers, HttpStatusCode status,
                                                                    WebRequest request) {
        String code = causa(ex, InvalidFormatException.class) != null ? "INVALID_ENUM" : "MALFORMED_REQUEST";
        return ResponseEntity.status(status).headers(headers).body(ErroResposta.de(status.value(), textoDoStatus(status),
                code, "Corpo da requisicao invalido", caminho(request)));
    }

    @Override
    protected ResponseEntity<Object> handleTypeMismatch(TypeMismatchException ex, HttpHeaders headers,
                                                         HttpStatusCode status, WebRequest request) {
        String code = ex.getRequiredType() != null && ex.getRequiredType().isEnum() ? "INVALID_ENUM" : "INVALID_PARAMETER";
        return ResponseEntity.status(status).headers(headers).body(ErroResposta.de(status.value(), textoDoStatus(status),
                code, "Parametro da requisicao invalido", caminho(request)));
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception ex, @Nullable Object body, HttpHeaders headers,
                                                             HttpStatusCode status, WebRequest request) {
        String code = status.is5xxServerError() ? "INTERNAL_ERROR" : "REQUEST_ERROR";
        ErroResposta resposta = ErroResposta.de(status.value(), textoDoStatus(status), code, mensagem(ex, status), caminho(request));
        return super.handleExceptionInternal(ex, resposta, headers, status, request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErroResposta> tratarInesperado(Exception ex, WebRequest request) {
        log.error("Erro nao tratado em {} tipo={}", caminho(request), ex.getClass().getSimpleName());
        return ResponseEntity.internalServerError().body(ErroResposta.de(500, "Internal Server Error", "INTERNAL_ERROR",
                "Erro interno do servidor", caminho(request)));
    }

    @ExceptionHandler(RecursoNaoEncontradoException.class)
    public ResponseEntity<ErroResposta> tratarRecursoNaoEncontrado(RecursoNaoEncontradoException ex, WebRequest request) {
        return respostaDeErro(HttpStatus.NOT_FOUND, "RESOURCE_NOT_FOUND", ex.getMessage(), request);
    }

    @ExceptionHandler({ConflitoException.class, DataIntegrityViolationException.class})
    public ResponseEntity<ErroResposta> tratarConflito(RuntimeException ex, WebRequest request) {
        String code = ex instanceof DataIntegrityViolationException ? "DATA_INTEGRITY_VIOLATION" : "BUSINESS_CONFLICT";
        String message = ex instanceof ConflitoException ? ex.getMessage() : "Conflito de integridade dos dados";
        return respostaDeErro(HttpStatus.CONFLICT, code, message, request);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErroResposta> tratarRequisicaoInvalida(IllegalArgumentException ex, WebRequest request) {
        return respostaDeErro(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", ex.getMessage(), request);
    }

    @ExceptionHandler(ExportLimitExceededException.class)
    public ResponseEntity<ErroResposta> tratarLimiteExportacao(ExportLimitExceededException ex, WebRequest request) {
        return respostaDeErro(HttpStatus.UNPROCESSABLE_ENTITY, "EXPORT_LIMIT_EXCEEDED", ex.getMessage(), request);
    }

    @ExceptionHandler(ExportTimeoutException.class)
    public ResponseEntity<ErroResposta> tratarTimeoutExportacao(ExportTimeoutException ex, WebRequest request) {
        return respostaDeErro(HttpStatus.SERVICE_UNAVAILABLE, "EXPORT_TIMEOUT", ex.getMessage(), request);
    }

    @ExceptionHandler(AuthenticationFailedException.class)
    public ResponseEntity<ErroResposta> tratarFalhaAutenticacao(AuthenticationFailedException ex, WebRequest request) {
        return respostaDeErro(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_FAILED", "Credenciais invalidas", request);
    }

    @ExceptionHandler(AccountDisabledException.class)
    public ResponseEntity<ErroResposta> tratarContaDesativada(AccountDisabledException ex, WebRequest request) {
        return respostaDeErro(HttpStatus.UNAUTHORIZED, "ACCOUNT_DISABLED", "Conta desativada", request);
    }

    private ResponseEntity<ErroResposta> respostaDeErro(HttpStatus status, String code, String message, WebRequest request) {
        return ResponseEntity.status(status).body(ErroResposta.de(status.value(), status.getReasonPhrase(), code, message, caminho(request)));
    }

    private <T extends Throwable> T causa(Throwable exception, Class<T> type) {
        for (Throwable current = exception; current != null; current = current.getCause()) {
            if (type.isInstance(current)) return type.cast(current);
        }
        return null;
    }

    private String mensagem(Exception ex, HttpStatusCode status) {
        if (status.is5xxServerError()) return "Erro interno do servidor";
        if (ex instanceof ErrorResponse erro && erro.getBody().getDetail() != null) return erro.getBody().getDetail();
        return textoDoStatus(status);
    }

    private String textoDoStatus(HttpStatusCode status) {
        HttpStatus resolved = HttpStatus.resolve(status.value());
        return resolved != null ? resolved.getReasonPhrase() : String.valueOf(status.value());
    }

    private String caminho(WebRequest request) {
        return request instanceof ServletWebRequest servlet ? servlet.getRequest().getRequestURI() : request.getDescription(false);
    }
}

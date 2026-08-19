package br.com.inframonitor.common.exception;

import br.com.inframonitor.common.api.CampoInvalido;
import br.com.inframonitor.common.api.ErroResposta;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.validation.FieldError;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import java.util.List;

/**
 * Traducao de excecoes para o corpo padrao de erro da API.
 *
 * Herda de {@link ResponseEntityExceptionHandler} para cobrir tambem as excecoes
 * do proprio Spring MVC (404, 405, 415, corpo ilegivel) com o mesmo formato.
 */
@RestControllerAdvice
public class TratadorGlobalDeErros extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(TratadorGlobalDeErros.class);

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex,
                                                                  HttpHeaders headers,
                                                                  HttpStatusCode status,
                                                                  WebRequest request) {
        List<CampoInvalido> campos = ex.getBindingResult().getFieldErrors().stream()
                .map(this::paraCampoInvalido)
                .toList();

        ErroResposta corpo = ErroResposta.deValidacao(
                status.value(),
                textoDoStatus(status),
                "Requisicao invalida",
                caminho(request),
                campos);

        return ResponseEntity.status(status).headers(headers).body(corpo);
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception ex,
                                                             @Nullable Object body,
                                                             HttpHeaders headers,
                                                             HttpStatusCode statusCode,
                                                             WebRequest request) {
        ErroResposta corpo = ErroResposta.de(
                statusCode.value(),
                textoDoStatus(statusCode),
                mensagem(ex, statusCode),
                caminho(request));

        return super.handleExceptionInternal(ex, corpo, headers, statusCode, request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErroResposta> tratarInesperado(Exception ex, WebRequest request) {
        log.error("Erro nao tratado em {}", caminho(request), ex);

        ErroResposta corpo = ErroResposta.de(
                HttpStatus.INTERNAL_SERVER_ERROR.value(),
                HttpStatus.INTERNAL_SERVER_ERROR.getReasonPhrase(),
                "Erro interno do servidor",
                caminho(request));

        return ResponseEntity.internalServerError().body(corpo);
    }

    @ExceptionHandler(RecursoNaoEncontradoException.class)
    public ResponseEntity<ErroResposta> tratarRecursoNaoEncontrado(RecursoNaoEncontradoException ex,
                                                                    WebRequest request) {
        return respostaDeErro(HttpStatus.NOT_FOUND, ex.getMessage(), request);
    }

    @ExceptionHandler({ConflitoException.class, DataIntegrityViolationException.class})
    public ResponseEntity<ErroResposta> tratarConflito(RuntimeException ex, WebRequest request) {
        String mensagem = ex instanceof ConflitoException
                ? ex.getMessage()
                : "Conflito de integridade dos dados";
        return respostaDeErro(HttpStatus.CONFLICT, mensagem, request);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErroResposta> tratarRequisicaoInvalida(IllegalArgumentException ex, WebRequest request) {
        return respostaDeErro(HttpStatus.BAD_REQUEST, ex.getMessage(), request);
    }

    private ResponseEntity<ErroResposta> respostaDeErro(HttpStatus status, String mensagem, WebRequest request) {
        ErroResposta corpo = ErroResposta.de(status.value(), status.getReasonPhrase(), mensagem, caminho(request));
        return ResponseEntity.status(status).body(corpo);
    }

    private CampoInvalido paraCampoInvalido(FieldError erro) {
        return new CampoInvalido(erro.getField(), erro.getDefaultMessage());
    }

    private String mensagem(Exception ex, HttpStatusCode statusCode) {
        if (statusCode.is5xxServerError()) {
            // Detalhes internos nao sao expostos ao cliente.
            return "Erro interno do servidor";
        }
        if (ex instanceof ErrorResponse erro && erro.getBody().getDetail() != null) {
            return erro.getBody().getDetail();
        }
        return textoDoStatus(statusCode);
    }

    private String textoDoStatus(HttpStatusCode statusCode) {
        HttpStatus status = HttpStatus.resolve(statusCode.value());
        return status != null ? status.getReasonPhrase() : String.valueOf(statusCode.value());
    }

    private String caminho(WebRequest request) {
        if (request instanceof ServletWebRequest servletRequest) {
            return servletRequest.getRequest().getRequestURI();
        }
        return request.getDescription(false);
    }
}

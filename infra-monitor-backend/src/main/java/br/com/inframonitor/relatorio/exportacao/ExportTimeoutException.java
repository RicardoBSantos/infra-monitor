package br.com.inframonitor.relatorio.exportacao;

public class ExportTimeoutException extends RuntimeException {
    public ExportTimeoutException() { super("A exportacao excedeu o tempo limite operacional"); }
}

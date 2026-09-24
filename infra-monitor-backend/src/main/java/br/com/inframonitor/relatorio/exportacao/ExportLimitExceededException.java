package br.com.inframonitor.relatorio.exportacao;

public class ExportLimitExceededException extends RuntimeException {
    private final long count;
    public ExportLimitExceededException(int limit, long count) {
        super("A exportacao excede o limite de " + limit + " linhas; restrinja o periodo ou os filtros.");
        this.count = count;
    }
    public long count() { return count; }
}

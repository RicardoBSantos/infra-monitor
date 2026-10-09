package br.com.inframonitor.relatorio.exportacao;

import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.OutputStream;

final class CountingOutputStream extends FilterOutputStream {
    private long count;
    CountingOutputStream(OutputStream output) { super(output); }
    @Override public void write(int value) throws IOException { out.write(value); count++; }
    @Override public void write(byte[] bytes, int offset, int length) throws IOException { out.write(bytes, offset, length); count += length; }
    long count() { return count; }
}

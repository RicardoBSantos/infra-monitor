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

    /** Ligacao real com a DLL. A carga e' explicita, feita uma vez na subida. */
    final class Jna implements Iphlpapi {

        private interface Biblioteca extends StdCallLibrary {

            Pointer IcmpCreateFile() throws LastErrorException;

            int IcmpSendEcho(Pointer handle, int destinationAddress, Pointer requestData, short requestSize,
                             Pointer requestOptions, Pointer replyBuffer, int replySize, int timeout)
                    throws LastErrorException;

            boolean IcmpCloseHandle(Pointer handle) throws LastErrorException;
        }

        private final Biblioteca biblioteca;

        private Jna(Biblioteca biblioteca) {
            this.biblioteca = biblioteca;
        }

        /**
         * Carrega a DLL AGORA e lanca UnsatisfiedLinkError cru se falhar.
         *
         * <p>Antes, Native.load morava no inicializador estatico do campo
         * Biblioteca.INSTANCE — campo de interface e' implicitamente static
         * final —, entao a carga so acontecia na PRIMEIRA sondagem, dentro de
         * uma thread do pool. A falha virava erro de sondagem em vez de erro de
         * subida, e o operador via a rede inteira caida.
         */
        public static Jna carregar() {
            return new Jna(Native.load("Iphlpapi", Biblioteca.class, W32APIOptions.DEFAULT_OPTIONS));
        }

        @Override
        public Pointer icmpCreateFile() {
            return biblioteca.IcmpCreateFile();
        }

        @Override
        public Retorno icmpSendEcho(Pointer handle, int destino, Pointer requisicao, short tamanho,
                                    Pointer opcoes, Pointer reply, int tamanhoReply, int timeoutMs) {
            try {
                int valor = biblioteca.IcmpSendEcho(handle, destino, requisicao, tamanho,
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
            biblioteca.IcmpCloseHandle(handle);
        }
    }
}

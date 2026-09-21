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

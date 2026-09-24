package br.com.inframonitor.monitoring.icmp.nativo;

import com.sun.jna.Pointer;
import com.sun.jna.Structure;

/** ICMP_ECHO_REPLY. Em x64 o campo data fica alinhado em 8, por isso a ordem importa. */
@Structure.FieldOrder({"address", "status", "roundTripTime", "dataSize", "reserved", "data",
        "ttl", "tos", "flags", "optionsSize", "optionsData"})
public class IcmpEchoReply extends Structure {
    public int address;
    public int status;
    public int roundTripTime;
    public short dataSize;
    public short reserved;
    public Pointer data;
    public byte ttl;
    public byte tos;
    public byte flags;
    public byte optionsSize;
    public Pointer optionsData;

    public IcmpEchoReply(Pointer buffer) {
        super(buffer);
        read();
    }
}

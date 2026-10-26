package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatencia;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

@Component
public class NotificacaoMessageBuilder {

    private static final DateTimeFormatter FORMATO_HORA = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm");

    private final ZoneId fuso;

    public NotificacaoMessageBuilder(@Value("${app.reports.timezone:America/Sao_Paulo}") String fuso) {
        this.fuso = ZoneId.of(fuso);
    }

    public String construir(Incidente incidente, TipoEventoNotificacao tipoEvento) {
        Monitor monitor = incidente.getMonitor();
        Equipamento equipamento = monitor.getEquipamento();
        boolean fechamentoManual = tipoEvento == TipoEventoNotificacao.INCIDENTE_FECHADO
                && incidente.getMotivoEncerramento() == MotivoEncerramentoIncidente.FECHAMENTO_MANUAL;
        String cabecalho;
        if (tipoEvento == TipoEventoNotificacao.INCIDENTE_ABERTO) {
            cabecalho = "INCIDENTE ABERTO";
        } else if (tipoEvento == TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO) {
            // NUNCA o texto de "resolvido": ninguem resolveu nada, o equipamento
            // saiu do radar por decisao operacional.
            cabecalho = "🔧 Incidente encerrado: equipamento entrou em manutenção";
        } else if (fechamentoManual) {
            cabecalho = "INCIDENTE ENCERRADO MANUALMENTE";
        } else {
            cabecalho = "INCIDENTE ENCERRADO";
        }
        StringBuilder mensagem = new StringBuilder(cabecalho)
                .append("\n\nUnidade: ").append(equipamento.getUnidade().getNome())
                .append("\nEquipamento: ").append(equipamento.getNome());
        if (equipamento.getIp() != null) {
            mensagem.append("\nIP: ").append(equipamento.getIp());
        }
        mensagem.append("\nMonitor: ").append(monitor.getNome())
                .append("\nInicio: ").append(hora(incidente.getIniciadoEm()));
        if (tipoEvento == TipoEventoNotificacao.INCIDENTE_ABERTO && incidente.getMotivo() != null) {
            mensagem.append("\nMotivo: ").append(incidente.getMotivo());
        }
        // Fim/Duracao valem para qualquer encerramento, manutencao inclusive: quando
        // este metodo roda, o incidente ja foi fechado (encerradoEm preenchido) pelo
        // chamador. So o cabecalho muda por motivo; o restante do corpo segue o
        // mesmo estilo dos vizinhos.
        if (tipoEvento == TipoEventoNotificacao.INCIDENTE_FECHADO
                || tipoEvento == TipoEventoNotificacao.INCIDENTE_ENCERRADO_MANUTENCAO) {
            mensagem.append("\nFim: ").append(hora(incidente.getEncerradoEm()));
            if (incidente.getIniciadoEm() != null && incidente.getEncerradoEm() != null) {
                mensagem.append("\nDuracao: ").append(formatarDuracao(Duration.between(
                        incidente.getIniciadoEm(), incidente.getEncerradoEm())));
            }
        }
        if (fechamentoManual) {
            // Recuperacao e fechamento a mao saiam com o mesmo texto: quem le no Telegram
            // achava que o equipamento tinha voltado.
            mensagem.append("\nEncerrado por: ").append(incidente.getFechadoPor() != null
                    ? incidente.getFechadoPor().getNome() : "operador nao identificado");
        }
        return mensagem.append("\n").append(rodape(incidente.getIniciadoEm())).toString();
    }

    /**
     * Latencia alta nao tem incidente: o cabecalho e o periodo saem do episodio, e o
     * limiar informado e o que estava vigente quando ele abriu.
     */
    public String construirParaEpisodio(MonitorEpisodioLatencia episodio, TipoEventoNotificacao tipoEvento) {
        Monitor monitor = episodio.getMonitor();
        Equipamento equipamento = monitor.getEquipamento();
        String cabecalho;
        if (tipoEvento == TipoEventoNotificacao.LATENCIA_ALTA) {
            cabecalho = "LATENCIA ALTA";
        } else if (tipoEvento == TipoEventoNotificacao.LATENCIA_ENCERRADA_MANUTENCAO) {
            // NUNCA o texto de "normalizada": ninguem mediu a recuperacao, o
            // equipamento saiu do radar por decisao operacional.
            cabecalho = "🔧 Latencia encerrada: equipamento entrou em manutenção";
        } else {
            cabecalho = "LATENCIA NORMALIZADA";
        }
        StringBuilder mensagem = new StringBuilder(cabecalho)
                .append("\n\nUnidade: ").append(equipamento.getUnidade().getNome())
                .append("\nEquipamento: ").append(equipamento.getNome());
        if (equipamento.getIp() != null) {
            mensagem.append("\nIP: ").append(equipamento.getIp());
        }
        mensagem.append("\nMonitor: ").append(monitor.getNome())
                .append("\nLimiar: ").append(episodio.getLimiarMs()).append(" ms")
                .append("\nInicio: ").append(hora(episodio.getIniciadoEm()));
        // Mesma logica do lado do incidente: Fim/Duracao valem para qualquer
        // encerramento, manutencao inclusive.
        if (tipoEvento == TipoEventoNotificacao.LATENCIA_NORMALIZADA
                || tipoEvento == TipoEventoNotificacao.LATENCIA_ENCERRADA_MANUTENCAO) {
            mensagem.append("\nFim: ").append(hora(episodio.getEncerradoEm()));
            if (episodio.getIniciadoEm() != null && episodio.getEncerradoEm() != null) {
                mensagem.append("\nDuracao: ").append(formatarDuracao(Duration.between(
                        episodio.getIniciadoEm(), episodio.getEncerradoEm())));
            }
        }
        return mensagem.append("\n").append(rodape(episodio.getIniciadoEm())).toString();
    }

    String hora(Instant instante) {
        // Nulo nao deve derrubar a criacao da notificacao (antes saia "null" no texto).
        return instante == null ? "-" : FORMATO_HORA.format(instante.atZone(fuso));
    }

    /** Offset do instante de referencia, nao o de hoje: vale em fusos com horario de verao. */
    String rodape(Instant referencia) {
        String offset = fuso.getRules().getOffset(referencia).getId();
        return "Horários: UTC" + ("Z".equals(offset) ? "+00:00" : offset) + " (" + fuso.getId() + ")";
    }

    String formatarDuracao(Duration duracao) {
        long segundos = duracao.getSeconds();
        long horas = segundos / 3600;
        long minutos = (segundos % 3600) / 60;
        long restantes = segundos % 60;
        return horas + "h " + minutos + "m " + restantes + "s";
    }
}

package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatencia;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import org.springframework.stereotype.Component;

import java.time.Duration;

@Component
public class NotificacaoMessageBuilder {

    public String construir(Incidente incidente, TipoEventoNotificacao tipoEvento) {
        Monitor monitor = incidente.getMonitor();
        Equipamento equipamento = monitor.getEquipamento();
        String cabecalho = tipoEvento == TipoEventoNotificacao.INCIDENTE_ABERTO
                ? "INCIDENTE ABERTO" : "INCIDENTE ENCERRADO";
        StringBuilder mensagem = new StringBuilder(cabecalho)
                .append("\n\nUnidade: ").append(equipamento.getUnidade().getNome())
                .append("\nEquipamento: ").append(equipamento.getNome());
        if (equipamento.getIp() != null) {
            mensagem.append("\nIP: ").append(equipamento.getIp());
        }
        mensagem.append("\nMonitor: ").append(monitor.getNome())
                .append("\nInicio: ").append(incidente.getIniciadoEm());
        if (tipoEvento == TipoEventoNotificacao.INCIDENTE_ABERTO && incidente.getMotivo() != null) {
            mensagem.append("\nMotivo: ").append(incidente.getMotivo());
        }
        if (tipoEvento == TipoEventoNotificacao.INCIDENTE_FECHADO) {
            mensagem.append("\nFim: ").append(incidente.getEncerradoEm());
            if (incidente.getIniciadoEm() != null && incidente.getEncerradoEm() != null) {
                mensagem.append("\nDuracao: ").append(formatarDuracao(Duration.between(
                        incidente.getIniciadoEm(), incidente.getEncerradoEm())));
            }
        }
        return mensagem.toString();
    }

    /**
     * Latencia alta nao tem incidente: o cabecalho e o periodo saem do episodio, e o
     * limiar informado e o que estava vigente quando ele abriu.
     */
    public String construirParaEpisodio(MonitorEpisodioLatencia episodio, TipoEventoNotificacao tipoEvento) {
        Monitor monitor = episodio.getMonitor();
        Equipamento equipamento = monitor.getEquipamento();
        String cabecalho = tipoEvento == TipoEventoNotificacao.LATENCIA_ALTA
                ? "LATENCIA ALTA" : "LATENCIA NORMALIZADA";
        StringBuilder mensagem = new StringBuilder(cabecalho)
                .append("\n\nUnidade: ").append(equipamento.getUnidade().getNome())
                .append("\nEquipamento: ").append(equipamento.getNome());
        if (equipamento.getIp() != null) {
            mensagem.append("\nIP: ").append(equipamento.getIp());
        }
        mensagem.append("\nMonitor: ").append(monitor.getNome())
                .append("\nLimiar: ").append(episodio.getLimiarMs()).append(" ms")
                .append("\nInicio: ").append(episodio.getIniciadoEm());
        if (tipoEvento == TipoEventoNotificacao.LATENCIA_NORMALIZADA) {
            mensagem.append("\nFim: ").append(episodio.getEncerradoEm());
            if (episodio.getIniciadoEm() != null && episodio.getEncerradoEm() != null) {
                mensagem.append("\nDuracao: ").append(formatarDuracao(Duration.between(
                        episodio.getIniciadoEm(), episodio.getEncerradoEm())));
            }
        }
        return mensagem.toString();
    }

    private String formatarDuracao(Duration duracao) {
        long segundos = duracao.getSeconds();
        long horas = segundos / 3600;
        long minutos = (segundos % 3600) / 60;
        long restantes = segundos % 60;
        return horas + "h " + minutos + "m " + restantes + "s";
    }
}

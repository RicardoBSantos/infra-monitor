package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.notificacao.entity.TipoEventoNotificacao;
import org.springframework.stereotype.Component;

@Component
public class NotificacaoMessageBuilder {

    public String construir(Incidente incidente, TipoEventoNotificacao tipoEvento) {
        Monitor monitor = incidente.getMonitor();
        Equipamento equipamento = monitor.getEquipamento();
        String cabecalho = tipoEvento == TipoEventoNotificacao.INCIDENTE_ABERTO
                ? "Incidente aberto" : "Incidente encerrado";
        StringBuilder mensagem = new StringBuilder(cabecalho)
                .append("\n\nUnidade: ").append(equipamento.getUnidade().getNome())
                .append("\nEquipamento: ").append(equipamento.getNome());
        if (equipamento.getIp() != null) {
            mensagem.append("\nIP: ").append(equipamento.getIp());
        }
        mensagem.append("\nMonitor: ").append(monitor.getNome())
                .append("\nInicio: ").append(incidente.getIniciadoEm());
        if (tipoEvento == TipoEventoNotificacao.INCIDENTE_FECHADO) {
            mensagem.append("\nFim: ").append(incidente.getEncerradoEm());
        }
        return mensagem.toString();
    }
}

package br.com.inframonitor.notificacao.service;

import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.manutencao.entity.EscopoManutencao;
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
import java.util.List;

@Component
public class NotificacaoMessageBuilder {

    private static final DateTimeFormatter FORMATO_HORA = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm");
    private static final DateTimeFormatter FORMATO_HORA_CURTA = DateTimeFormatter.ofPattern("HH:mm");
    private static final int MAXIMO_NOMES = 5;

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

    public String construirInicioJanela(DadosAnuncio.Janela j, Instant ativadaEm, boolean atrasado) {
        StringBuilder m = new StringBuilder("🔧 MANUTENÇÃO INICIADA — alertas suspensos\n");
        cabecalhoJanela(m, j);
        m.append("\nInício: ").append(hora(ativadaEm));
        if (atrasado) {
            m.append(" (previsto ").append(horaRelativa(j.inicioPrevisto(), ativadaEm))
                    .append(" — sistema esteve fora)");
        }
        m.append("\nFim previsto: ").append(hora(j.fimPrevisto()));
        linha(m, "Agendada por", j.criadoPorNome());
        return rodapeJanela(m, j, ativadaEm);
    }

    public String construirFimJanela(DadosAnuncio.Janela j, Instant ativadaEm, Instant encerradaEm,
                                     DadosAnuncio.Termino t, List<DadosAnuncio.Seguinte> seguem,
                                     DadosAnuncio.EntregaInicio entrega) {
        StringBuilder m = new StringBuilder("✅ MANUTENÇÃO ENCERRADA — alertas retomados\n");
        cabecalhoJanela(m, j);
        m.append("\nPeríodo: ").append(hora(ativadaEm)).append(" → ").append(hora(encerradaEm));
        if (ativadaEm != null && encerradaEm != null) {
            m.append(" (").append(formatarDuracao(Duration.between(ativadaEm, encerradaEm))).append(")");
        }
        m.append("\nTérmino: ").append(textoTermino(t, encerradaEm));
        if (seguem != null && !seguem.isEmpty()) {
            m.append("\nSeguem em manutenção: ").append(listarSeguintes(seguem));
        }
        avisoEntrega(m, entrega);
        return rodapeJanela(m, j, ativadaEm);
    }

    public String construirFimAlterado(DadosAnuncio.Janela j, Instant fimAnterior, Instant fimNovo,
                                       String autorNome) {
        String cabecalho = fimNovo != null && fimAnterior != null && fimNovo.isAfter(fimAnterior)
                ? "⏱️ MANUTENÇÃO PRORROGADA" : "⏱️ FIM DA MANUTENÇÃO ANTECIPADO";
        StringBuilder m = new StringBuilder(cabecalho).append("\n");
        cabecalhoJanela(m, j);
        m.append("\nFim previsto: ").append(hora(fimAnterior)).append(" → ").append(hora(fimNovo));
        linha(m, "Alterado por", autorNome);
        return rodapeJanela(m, j, j.inicioPrevisto());
    }

    public String construirManualIniciada(DadosAnuncio.Manual manual, boolean jaEmManutencao,
                                          DadosAnuncio.JanelaVigente janela) {
        StringBuilder m = new StringBuilder("🔧 EQUIPAMENTO EM MANUTENÇÃO MANUAL — alertas suspensos\n");
        dadosManual(m, manual);
        linha(m, "Iniciada por", manual.iniciadaPorNome());
        if (manual.iniciadaEm() != null) {
            m.append("\nInício: ").append(hora(manual.iniciadaEm()));
        }
        if (janela != null) {
            m.append("\nJá estava na janela #").append(janela.id()).append(" (até ")
                    .append(hora(janela.fimPrevisto())).append("); agora não volta sozinho no fim dela.");
        } else if (jaEmManutencao) {
            m.append("\nJá estava em manutenção; agora não volta sozinho.");
        } else {
            m.append("\nSem fim previsto: volta só quando alguém encerrar.");
        }
        return m.append("\n").append(rodape(referenciaOuAgora(manual.iniciadaEm()))).toString();
    }

    public String construirManualEncerrada(DadosAnuncio.Manual manual, Instant encerradaEm,
                                           String encerradaPorNome, boolean segueEmManutencao,
                                           DadosAnuncio.JanelaVigente janela,
                                           DadosAnuncio.EntregaInicio entrega) {
        StringBuilder m = new StringBuilder("✅ MANUTENÇÃO MANUAL ENCERRADA — ");
        if (segueEmManutencao && janela != null) {
            m.append("segue em manutenção pela janela #").append(janela.id()).append(" até ")
                    .append(hora(janela.fimPrevisto()));
        } else if (segueEmManutencao) {
            m.append("segue em manutenção");
        } else {
            m.append("alertas retomados");
        }
        m.append("\n");
        dadosManual(m, manual);
        if (manual.iniciadaEm() == null) {
            m.append("\nPeríodo: início não registrado (anterior ao histórico) → ").append(hora(encerradaEm));
        } else {
            m.append("\nPeríodo: ").append(hora(manual.iniciadaEm())).append(" → ").append(hora(encerradaEm));
            if (encerradaEm != null) {
                m.append(" (").append(formatarDuracao(Duration.between(manual.iniciadaEm(), encerradaEm)))
                        .append(")");
            }
        }
        linha(m, "Encerrada por", encerradaPorNome);
        avisoEntrega(m, entrega);
        return m.append("\n").append(rodape(referenciaOuAgora(encerradaEm))).toString();
    }

    private void cabecalhoJanela(StringBuilder m, DadosAnuncio.Janela j) {
        m.append("\nUnidade: ").append(j.unidadeNome())
                .append("\nEscopo: ").append(escopo(j));
        linha(m, "Motivo", j.motivo());
    }

    private String rodapeJanela(StringBuilder m, DadosAnuncio.Janela j, Instant referencia) {
        return m.append("\nJanela: #").append(j.id())
                .append("\n").append(rodape(referenciaOuAgora(referencia))).toString();
    }

    private void dadosManual(StringBuilder m, DadosAnuncio.Manual manual) {
        m.append("\nUnidade: ").append(manual.unidadeNome())
                .append("\nEquipamento: ").append(manual.equipamentoNome());
        linha(m, "IP", manual.ip());
    }

    /** Linha cujo valor ausente nao aparece. */
    private void linha(StringBuilder m, String rotulo, String valor) {
        if (valor != null && !valor.isBlank()) {
            m.append("\n").append(rotulo).append(": ").append(valor);
        }
    }

    private String escopo(DadosAnuncio.Janela j) {
        int total = j.totalEquipamentos();
        if (j.escopo() == EscopoManutencao.UNIDADE) {
            return total == 0 ? "unidade inteira (nenhum equipamento cadastrado)"
                    : "unidade inteira (" + contagem(total) + ")";
        }
        List<String> nomes = j.nomesEquipamentos();
        String lista = String.join(", ", nomes.subList(0, Math.min(MAXIMO_NOMES, nomes.size())));
        if (nomes.size() > MAXIMO_NOMES) {
            lista += " e mais " + (nomes.size() - MAXIMO_NOMES);
        }
        return contagem(total) + " — " + lista;
    }

    private String contagem(int total) {
        return total + (total == 1 ? " equipamento" : " equipamentos");
    }

    private String textoTermino(DadosAnuncio.Termino t, Instant encerradaEm) {
        String original = horaRelativa(t.fimOriginal(), encerradaEm);
        String finalHora = horaRelativa(t.fimFinal(), encerradaEm);
        return switch (t.tipo()) {
            case COMO_PREVISTO -> "como previsto";
            case ANTECIPADO -> "antecipado por " + t.autorNome() + " (previsto " + original + ")";
            case APOS_PRORROGACAO -> "como previsto, após prorrogação de " + original + " para "
                    + finalHora + " por " + t.autorNome();
            case APOS_ANTECIPACAO -> "como previsto, após antecipação de " + original + " para "
                    + finalHora + " por " + t.autorNome();
        };
    }

    private String listarSeguintes(List<DadosAnuncio.Seguinte> seguem) {
        StringBuilder itens = new StringBuilder();
        int mostrados = Math.min(MAXIMO_NOMES, seguem.size());
        for (int i = 0; i < mostrados; i++) {
            DadosAnuncio.Seguinte s = seguem.get(i);
            if (i > 0) {
                itens.append(", ");
            }
            itens.append(s.equipamentoNome()).append(s.janelaId() == null
                    ? " (manual)" : " (janela #" + s.janelaId() + ")");
        }
        if (seguem.size() > MAXIMO_NOMES) {
            itens.append(" e mais ").append(seguem.size() - MAXIMO_NOMES);
        }
        return itens.toString();
    }

    private void avisoEntrega(StringBuilder m, DadosAnuncio.EntregaInicio entrega) {
        if (entrega == DadosAnuncio.EntregaInicio.NAO_ENTREGUE) {
            m.append("\nO aviso de início não foi entregue; este é o registro completo.");
        } else if (entrega == DadosAnuncio.EntregaInicio.TALVEZ_ENTREGUE) {
            m.append("\nO aviso de início pode não ter sido entregue; este é o registro completo.");
        }
    }

    /** So HH:mm quando cai no mesmo dia local da referencia; senao a data completa. */
    private String horaRelativa(Instant instante, Instant referencia) {
        if (instante == null || referencia == null
                || !instante.atZone(fuso).toLocalDate().equals(referencia.atZone(fuso).toLocalDate())) {
            return hora(instante);
        }
        return FORMATO_HORA_CURTA.format(instante.atZone(fuso));
    }

    private Instant referenciaOuAgora(Instant referencia) {
        return referencia != null ? referencia : Instant.now();
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

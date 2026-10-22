package br.com.inframonitor.incidente.service;

import br.com.inframonitor.common.exception.ConflitoException;
import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.incidente.dto.CloseIncidenteRequest;
import br.com.inframonitor.incidente.dto.CreateIncidenteRequest;
import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import br.com.inframonitor.monitor.entity.TipoMonitor;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.notificacao.service.NotificacaoService;
import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import br.com.inframonitor.unidade.entity.Unidade;
import br.com.inframonitor.usuario.entity.Papel;
import br.com.inframonitor.usuario.entity.Usuario;
import br.com.inframonitor.usuario.repository.UsuarioRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class IncidenteServiceTest {

    private static final Instant INICIO = Instant.parse("2026-08-19T12:00:00Z");

    @Mock private IncidenteRepository incidenteRepository;
    @Mock private MonitorRepository monitorRepository;
    @Mock private NotificacaoService notificacaoService;
    @Mock private UsuarioRepository usuarioRepository;
    @InjectMocks private IncidenteService incidenteService;

    @Test
    void abreIncidenteComSucesso() {
        Monitor monitor = monitor();
        when(monitorRepository.findById(1L)).thenReturn(Optional.of(monitor));
        when(incidenteRepository.travarElegibilidadeParaAbertura(1L)).thenReturn(Optional.of(elegivel(true, true, false)));
        when(incidenteRepository.saveAndFlush(any(Incidente.class))).thenAnswer(invocation -> invocation.getArgument(0));

        var resposta = incidenteService.criar(criacao());

        ArgumentCaptor<Incidente> captor = ArgumentCaptor.forClass(Incidente.class);
        verify(incidenteRepository).saveAndFlush(captor.capture());
        assertThat(captor.getValue().getStatus()).isEqualTo(StatusIncidente.ABERTO);
        assertThat(captor.getValue().getEncerradoEm()).isNull();
        assertThat(resposta.status()).isEqualTo(StatusIncidente.ABERTO);
        verify(notificacaoService).criarParaIncidenteAberto(captor.getValue());
    }

    @Test
    void rejeitaMonitorInexistenteESegundoIncidenteAberto() {
        when(monitorRepository.findById(1L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> incidenteService.criar(criacao())).isInstanceOf(RecursoNaoEncontradoException.class);

        when(monitorRepository.findById(1L)).thenReturn(Optional.of(monitor()));
        when(incidenteRepository.travarElegibilidadeParaAbertura(1L)).thenReturn(Optional.of(elegivel(true, true, false)));
        when(incidenteRepository.existsByMonitorIdAndStatusIn(1L, StatusIncidente.EM_ABERTO)).thenReturn(true);
        assertThatThrownBy(() -> incidenteService.criar(criacao())).isInstanceOf(ConflitoException.class);
    }

    @Test
    void recusaForaDeObservacaoSemSalvarNemNotificar() {
        when(monitorRepository.findById(1L)).thenReturn(Optional.of(monitor()));
        when(incidenteRepository.travarElegibilidadeParaAbertura(1L)).thenReturn(Optional.of(elegivel(true, true, true)));

        assertThatThrownBy(() -> incidenteService.criar(criacao()))
                .isInstanceOf(ConflitoException.class)
                .hasMessage("Nao e possivel abrir incidente porque o equipamento esta em manutencao");
        verify(incidenteRepository, never()).saveAndFlush(any());
        verifyNoInteractions(notificacaoService);
    }

    private static IncidenteRepository.Elegibilidade elegivel(boolean monitorAtivo, boolean equipamentoAtivo,
                                                               boolean emManutencao) {
        return new IncidenteRepository.Elegibilidade() {
            public boolean getMonitorAtivo() { return monitorAtivo; }
            public boolean getEquipamentoAtivo() { return equipamentoAtivo; }
            public boolean getEmManutencao() { return emManutencao; }
        };
    }

    @Test
    void traduzConflitoDoIndiceParcialParaRegraDeNegocio() {
        when(monitorRepository.findById(1L)).thenReturn(Optional.of(monitor()));
        when(incidenteRepository.travarElegibilidadeParaAbertura(1L)).thenReturn(Optional.of(elegivel(true, true, false)));
        when(incidenteRepository.saveAndFlush(any(Incidente.class))).thenThrow(new DataIntegrityViolationException("uq"));

        assertThatThrownBy(() -> incidenteService.criar(criacao()))
                .isInstanceOf(ConflitoException.class).hasMessageContaining("incidente aberto");
    }

    @Test
    void permiteNovoIncidenteAposFechamentoEBuscaExistente() {
        Incidente aberto = incidente(StatusIncidente.ABERTO);
        Incidente fechado = incidente(StatusIncidente.ABERTO);
        Usuario operador = operador();
        fechado.fechar(INICIO.plusSeconds(60), null, operador, MotivoEncerramentoIncidente.FECHAMENTO_MANUAL);
        // Primeira leitura: estado antes do CAS; segunda: releitura depois do bulk update.
        when(incidenteRepository.findById(10L)).thenReturn(Optional.of(aberto), Optional.of(fechado));
        when(usuarioRepository.findById(7L)).thenReturn(Optional.of(operador));
        when(incidenteRepository.fecharManualmenteSeEmAberto(eq(10L), eq(INICIO.plusSeconds(60)), eq(null),
                eq(operador), any())).thenReturn(1);
        var resposta = incidenteService.fechar(10L, new CloseIncidenteRequest(INICIO.plusSeconds(60), null), 7L);

        assertThat(resposta.status()).isEqualTo(StatusIncidente.FECHADO);
        // Fechamento humano tem autor; o do motor e o unico que deixa fechado_por nulo.
        assertThat(resposta.fechadoPorNome()).isEqualTo(operador.getNome());
        verify(notificacaoService).criarParaIncidenteFechado(fechado);
        when(monitorRepository.findById(1L)).thenReturn(Optional.of(monitor()));
        when(incidenteRepository.travarElegibilidadeParaAbertura(1L)).thenReturn(Optional.of(elegivel(true, true, false)));
        when(incidenteRepository.saveAndFlush(any(Incidente.class))).thenAnswer(invocation -> invocation.getArgument(0));
        assertThat(incidenteService.criar(criacao()).status()).isEqualTo(StatusIncidente.ABERTO);
        assertThatThrownBy(() -> incidenteService.buscarPorId(99L)).isInstanceOf(RecursoNaoEncontradoException.class);
    }

    @Test
    void fecharQuePerdeOCasNaoNotificaEDevolveEstadoRelido() {
        Incidente lidoAberto = incidente(StatusIncidente.ABERTO);
        Incidente fechadoPeloMotor = incidente(StatusIncidente.ABERTO);
        fechadoPeloMotor.fechar(INICIO.plusSeconds(30), "Recuperacao detectada", null,
                MotivoEncerramentoIncidente.RECUPERACAO_AUTOMATICA);
        when(incidenteRepository.findById(10L)).thenReturn(Optional.of(lidoAberto), Optional.of(fechadoPeloMotor));
        when(usuarioRepository.findById(7L)).thenReturn(Optional.of(operador()));
        when(incidenteRepository.fecharManualmenteSeEmAberto(eq(10L), any(), any(), any(), any())).thenReturn(0);

        var resposta = incidenteService.fechar(10L, new CloseIncidenteRequest(INICIO.plusSeconds(60), "manual"), 7L);

        verify(notificacaoService, never()).criarParaIncidenteFechado(any());
        assertThat(resposta.motivoEncerramento()).isEqualTo(MotivoEncerramentoIncidente.RECUPERACAO_AUTOMATICA);
        assertThat(resposta.encerradoEm()).isEqualTo(INICIO.plusSeconds(30));
        assertThat(resposta.fechadoPorNome()).isNull();
    }

    @Test
    void fechaValidaDataEPermaneceIdempotente() {
        Incidente aberto = incidente(StatusIncidente.ABERTO);
        when(incidenteRepository.findById(10L)).thenReturn(Optional.of(aberto));
        assertThatThrownBy(() -> incidenteService.fechar(10L, new CloseIncidenteRequest(INICIO.minusSeconds(1), null), 7L))
                .isInstanceOf(IllegalArgumentException.class);

        Incidente fechado = incidente(StatusIncidente.ABERTO);
        fechado.fechar(INICIO.plusSeconds(60), "original", null, MotivoEncerramentoIncidente.RECUPERACAO_AUTOMATICA);
        when(incidenteRepository.findById(11L)).thenReturn(Optional.of(fechado));
        var resposta = incidenteService.fechar(11L, new CloseIncidenteRequest(INICIO.plusSeconds(120), "nova"), 7L);
        assertThat(resposta.encerradoEm()).isEqualTo(INICIO.plusSeconds(60));
        assertThat(resposta.observacao()).isEqualTo("original");
    }

    @Test
    void fluxosAutomaticosTambemGeramNotificacoes() {
        Monitor monitor = monitor();
        Incidente incidenteInserido = incidente(StatusIncidente.ABERTO);
        when(incidenteRepository.inserirSeElegivel(eq(1L), eq(INICIO), any(), any())).thenReturn(1);
        when(incidenteRepository.findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(1L, StatusIncidente.EM_ABERTO))
                .thenReturn(Optional.of(incidenteInserido));
        when(incidenteRepository.fecharAutomaticamenteSeEmAberto(eq(10L), eq(INICIO.plusSeconds(60)), any(), any()))
                .thenReturn(1);
        when(incidenteRepository.findById(10L)).thenReturn(Optional.of(incidenteInserido));

        Optional<Incidente> aberto = incidenteService.abrirAutomaticamente(monitor, INICIO, 3);
        assertThat(aberto).contains(incidenteInserido);
        incidenteService.fecharAutomaticamente(aberto.orElseThrow(), INICIO.plusSeconds(60), 2);

        verify(notificacaoService).criarParaIncidenteAberto(incidenteInserido);
        verify(notificacaoService).criarParaIncidenteFechado(incidenteInserido);
    }

    @Test
    void abrirAutomaticamenteDevolveVazioQuandoInsercaoNaoAcontece() {
        Monitor monitor = monitor();
        when(incidenteRepository.inserirSeElegivel(eq(1L), eq(INICIO), any(), any())).thenReturn(0);

        Optional<Incidente> aberto = incidenteService.abrirAutomaticamente(monitor, INICIO, 3);

        assertThat(aberto).isEmpty();
        verifyNoInteractions(notificacaoService);
    }

    @Test
    void listaPorTodosOsFiltrosEValidaPeriodo() {
        Incidente incidente = incidente(StatusIncidente.ABERTO);
        when(incidenteRepository.findAll(org.mockito.ArgumentMatchers.<Specification<Incidente>>any(),
                org.mockito.ArgumentMatchers.<Pageable>any())).thenReturn(new PageImpl<>(List.of(incidente)));

        var pagina = incidenteService.listar(1L, 2L, 3L, StatusIncidente.ABERTO, INICIO,
                INICIO.plusSeconds(60), PageRequest.of(0, 20));

        assertThat(pagina.getContent()).hasSize(1);
        verify(incidenteRepository).findAll(org.mockito.ArgumentMatchers.<Specification<Incidente>>any(),
                org.mockito.ArgumentMatchers.<Pageable>any());
        assertThatThrownBy(() -> incidenteService.listar(null, null, null, null, INICIO.plusSeconds(1), INICIO,
                PageRequest.of(0, 20))).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void listaComFiltrosOpcionaisSemCombinarSpecificationsNulas() {
        when(incidenteRepository.findAll(org.mockito.ArgumentMatchers.<Specification<Incidente>>any(),
                org.mockito.ArgumentMatchers.<Pageable>any())).thenReturn(new PageImpl<>(List.of()));
        Pageable pagina = PageRequest.of(0, 20);

        incidenteService.listar(null, null, null, null, null, null, pagina);
        incidenteService.listar(1L, null, null, null, null, null, pagina);
        incidenteService.listar(null, 2L, null, null, null, null, pagina);
        incidenteService.listar(null, null, 3L, StatusIncidente.ABERTO, INICIO, INICIO.plusSeconds(60), pagina);
    }

    @Test
    void reconheceIncidenteAberto() {
        Incidente aberto = incidente(StatusIncidente.ABERTO);
        Usuario operador = operador();
        when(incidenteRepository.findById(10L)).thenReturn(Optional.of(aberto));
        when(usuarioRepository.findById(7L)).thenReturn(Optional.of(operador));
        when(incidenteRepository.reconhecerSeAberto(eq(10L), eq(operador), any(Instant.class))).thenReturn(1);

        var resposta = incidenteService.reconhecer(10L, 7L);

        assertThat(resposta.id()).isEqualTo(10L);
        verify(incidenteRepository).reconhecerSeAberto(eq(10L), eq(operador), any(Instant.class));
        // Reconhecer nao alerta ninguem: nao ha tipo de evento para isso.
        verifyNoInteractions(notificacaoService);
    }

    @Test
    void recusaReconhecerDuasVezesEIncidenteJaFechado() {
        Usuario operador = operador();
        when(usuarioRepository.findById(7L)).thenReturn(Optional.of(operador));
        // Zero linha afetada = o UPDATE condicional nao casou com status = ABERTO.
        when(incidenteRepository.reconhecerSeAberto(eq(10L), eq(operador), any(Instant.class))).thenReturn(0);

        when(incidenteRepository.findById(10L)).thenReturn(Optional.of(incidente(StatusIncidente.RECONHECIDO)));
        assertThatThrownBy(() -> incidenteService.reconhecer(10L, 7L))
                .isInstanceOf(ConflitoException.class).hasMessageContaining("ja foi reconhecido");

        // Corrida real: o motor fechou entre o SELECT e o UPDATE do operador.
        Incidente fechadoMotor = incidente(StatusIncidente.ABERTO);
        fechadoMotor.fechar(INICIO.plusSeconds(60), null, null, MotivoEncerramentoIncidente.RECUPERACAO_AUTOMATICA);
        when(incidenteRepository.findById(10L)).thenReturn(Optional.of(fechadoMotor));
        assertThatThrownBy(() -> incidenteService.reconhecer(10L, 7L))
                .isInstanceOf(ConflitoException.class).hasMessageContaining("ja foi fechado");
    }

    @Test
    void fechaAutomaticamenteAPartirDeReconhecido() {
        Incidente reconhecido = incidente(StatusIncidente.RECONHECIDO);
        // Simula o bulk update: so as colunas de fechamento mudam na linha; a releitura
        // por findById devolve a linha ja fechada.
        when(incidenteRepository.fecharAutomaticamenteSeEmAberto(eq(10L), eq(INICIO.plusSeconds(120)), any(), any()))
                .thenAnswer(i -> {
                    reconhecido.fechar(INICIO.plusSeconds(120), i.getArgument(2), null,
                            MotivoEncerramentoIncidente.RECUPERACAO_AUTOMATICA);
                    return 1;
                });
        when(incidenteRepository.findById(10L)).thenReturn(Optional.of(reconhecido));

        Incidente fechado = incidenteService.fecharAutomaticamente(reconhecido, INICIO.plusSeconds(120), 2);

        assertThat(fechado.getStatus()).isEqualTo(StatusIncidente.FECHADO);
        assertThat(fechado.getEncerradoEm()).isEqualTo(INICIO.plusSeconds(120));
        // A trilha de quem assumiu sobrevive ao fechamento.
        assertThat(fechado.getReconhecidoPor()).isNotNull();
        // Fechamento do motor nao tem autor: fechado_por nulo e a semantica da V17.
        assertThat(fechado.getFechadoPor()).isNull();
        verify(notificacaoService).criarParaIncidenteFechado(fechado);
    }

    @Test
    void fecharAutomaticamenteNaoNotificaQuandoOutraTransacaoJaFechou() {
        Incidente carregadoAberto = incidente(StatusIncidente.ABERTO);
        Incidente fechadoPorManutencao = incidente(StatusIncidente.ABERTO);
        fechadoPorManutencao.fechar(INICIO.plusSeconds(90), null, operador(), MotivoEncerramentoIncidente.MANUTENCAO);
        when(incidenteRepository.fecharAutomaticamenteSeEmAberto(eq(10L), eq(INICIO.plusSeconds(120)), any(), any()))
                .thenReturn(0);
        when(incidenteRepository.findById(10L)).thenReturn(Optional.of(fechadoPorManutencao));

        Incidente resultado = incidenteService.fecharAutomaticamente(carregadoAberto, INICIO.plusSeconds(120), 2);

        assertThat(resultado.getMotivoEncerramento()).isEqualTo(MotivoEncerramentoIncidente.MANUTENCAO);
        verifyNoInteractions(notificacaoService);
    }

    private Usuario operador() {
        Usuario usuario = new Usuario("Operador", "op@inframonitor", "hash", Papel.OPERADOR, false);
        definirId(usuario, 7L);
        return usuario;
    }

    private CreateIncidenteRequest criacao() {
        return new CreateIncidenteRequest(1L, INICIO, " indisponibilidade ", " investigando ");
    }

    private Incidente incidente(StatusIncidente status) {
        Incidente incidente = new Incidente(monitor(), INICIO, "motivo", "observacao");
        if (status == StatusIncidente.RECONHECIDO) incidente.reconhecer(INICIO.plusSeconds(30), operador());
        if (status == StatusIncidente.FECHADO) incidente.fechar(INICIO.plusSeconds(60), null, null, MotivoEncerramentoIncidente.FECHAMENTO_MANUAL);
        definirId(incidente, 10L);
        return incidente;
    }

    private Monitor monitor() {
        Unidade unidade = new Unidade("Matriz", "MTZ", null);
        definirId(unidade, 3L);
        Equipamento equipamento = new Equipamento(unidade, new TipoEquipamento("Switch", null), "SW-01", null, null, null, null, null);
        definirId(equipamento, 2L);
        Monitor monitor = new Monitor(equipamento, TipoMonitor.ICMP, "ICMP principal", 60, 2000);
        definirId(monitor, 1L);
        return monitor;
    }

    private void definirId(Object entidade, Long id) {
        ReflectionTestUtils.setField(entidade, "id", id);
    }
}

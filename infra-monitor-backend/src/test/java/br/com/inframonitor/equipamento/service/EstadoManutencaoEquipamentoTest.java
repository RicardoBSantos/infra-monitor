package br.com.inframonitor.equipamento.service;

import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository.EstadoManutencaoTravado;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao;
import br.com.inframonitor.usuario.entity.Usuario;
import br.com.inframonitor.usuario.repository.UsuarioRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Decisao de {@link EstadoManutencaoEquipamento#reavaliar}: cobertura e autor vem de UMA
 * instrucao so (autorDaCobertura). Com duas (coberto, depois autor), uma janela commitada
 * como CONCLUIDA/CANCELADA entre elas deixava coberto = true e autor vazio, e o orElseThrow
 * derrubava a acao do usuario. O mock abaixo reproduz exatamente essa intercalacao.
 */
@ExtendWith(MockitoExtension.class)
class EstadoManutencaoEquipamentoTest {

    private static final Long ID = 7L;

    @Mock private EquipamentoRepository equipamentos;
    @Mock private CoberturaManutencao cobertura;
    @Mock private EfeitosManutencao efeitos;
    @Mock private UsuarioRepository usuarios;
    @Mock private br.com.inframonitor.equipamento.repository.SessaoManutencaoManual sessoes;
    @Mock private AnuncioManutencaoManual anuncio;
    @InjectMocks private EstadoManutencaoEquipamento estado;

    @Test
    void janelaEncerradaEntreCoberturaEAutorNaoDerrubaReavaliar() {
        travado(false, false);
        // A intercalacao da corrida: quem ainda olhasse coberto() veria a janela ATIVA,
        // mas ela ja foi encerrada quando o autor e lido.
        lenient().when(cobertura.coberto(anyLong())).thenReturn(true);
        when(cobertura.autorDaCobertura(ID)).thenReturn(Optional.empty());
        // A virada do flag em si passaria (o lock e nosso): a falha seria so o autor vazio.
        lenient().when(equipamentos.trocarEmManutencao(eq(ID), eq(false), eq(true), any(Instant.class)))
                .thenReturn(1);

        assertThat(estado.reavaliar(ID)).isFalse();

        verify(cobertura, never()).coberto(anyLong());
        verify(equipamentos, never()).trocarEmManutencao(any(), anyBoolean(), anyBoolean(), any());
        verify(efeitos, never()).aplicarEntrada(any(), any(), any());
    }

    @Test
    void autorPresenteEntraComOAutorDaJanela() {
        travado(false, false);
        Usuario criador = mock(Usuario.class);
        when(cobertura.autorDaCobertura(ID)).thenReturn(Optional.of(3L));
        when(usuarios.findById(3L)).thenReturn(Optional.of(criador));
        when(equipamentos.trocarEmManutencao(eq(ID), eq(false), eq(true), any(Instant.class))).thenReturn(1);

        assertThat(estado.reavaliar(ID)).isTrue();

        verify(efeitos).aplicarEntrada(eq(ID), eq(criador), any(Instant.class));
    }

    @Test
    void manualLigadoNaoConsultaCobertura() {
        travado(true, true);

        assertThat(estado.reavaliar(ID)).isTrue();

        verify(cobertura, never()).autorDaCobertura(anyLong());
        verify(cobertura, never()).coberto(anyLong());
    }

    @Test
    void encerrarManualFalhaAltoSeODesmarcarNaoPegaSobLock() {
        travado(true, true);
        when(usuarios.findById(5L)).thenReturn(Optional.of(mock(Usuario.class)));
        when(equipamentos.desmarcarManual(eq(ID), any(Instant.class))).thenReturn(0);

        assertThatThrownBy(() -> estado.encerrarManual(ID, 5L)).isInstanceOf(IllegalStateException.class);
        verify(efeitos, never()).aplicarSaida(any());
    }

    private void travado(boolean emManutencao, boolean manual) {
        EstadoManutencaoTravado linha = mock(EstadoManutencaoTravado.class);
        lenient().when(linha.getEmManutencao()).thenReturn(emManutencao);
        lenient().when(linha.getManutencaoManual()).thenReturn(manual);
        when(equipamentos.travarEstadoManutencao(ID)).thenReturn(Optional.of(linha));
    }
}

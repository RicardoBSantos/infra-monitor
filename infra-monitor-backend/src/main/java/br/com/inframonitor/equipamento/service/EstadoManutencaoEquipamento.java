package br.com.inframonitor.equipamento.service;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.manutencao.repository.CoberturaManutencao;
import br.com.inframonitor.usuario.entity.Usuario;
import br.com.inframonitor.usuario.repository.UsuarioRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Optional;

/**
 * Unico escritor de equipamento.em_manutencao e equipamento.manutencao_manual (MA01).
 *
 * <p>Toda operacao comeca travando a linha do equipamento (FOR UPDATE), o mesmo lock que o
 * INSERT condicional do motor e o M7 tomam. A cobertura por janela e lida DEPOIS, em instrucao
 * separada: sob READ COMMITTED, cada instrucao ve o que foi commitado antes dela comecar, e o
 * lock garante que quem commitou uma mudanca de janela e ja reavaliou este equipamento terminou
 * antes. Na mesma instrucao do lock, um EXISTS usaria o snapshot de antes da espera e podia
 * tirar da manutencao um equipamento cuja janela acabou de ativar.
 *
 * <p>A ordem importa e e' esta: o flag vem PRIMEIRO, os efeitos depois
 * ({@link EfeitosManutencao#aplicarEntrada}). Qualquer processor a caminho encontra
 * em_manutencao = true e nao abre nada (a guarda vive no WHERE do INSERT condicional de
 * incidente e de episodio); qualquer um que tenha aberto ANTES do flag e' fechado pelos
 * efeitos. A ordem inversa deixaria uma janela em que o processor abre depois do fechamento.
 *
 * <p>O lock torna as operacoes idempotentes: quem chega depois le o estado ja virado e nao
 * roda efeito nenhum, e nenhum efeito colateral roda duas vezes. Os UPDATEs continuam com
 * CAS no WHERE como segunda guarda.
 */
@Service
public class EstadoManutencaoEquipamento {

    private final EquipamentoRepository equipamentos;
    private final CoberturaManutencao cobertura;
    private final EfeitosManutencao efeitos;
    private final UsuarioRepository usuarios;

    public EstadoManutencaoEquipamento(EquipamentoRepository equipamentos, CoberturaManutencao cobertura,
                                       EfeitosManutencao efeitos, UsuarioRepository usuarios) {
        this.equipamentos = equipamentos;
        this.cobertura = cobertura;
        this.efeitos = efeitos;
        this.usuarios = usuarios;
    }

    /** Leva em_manutencao ao desejado (manual OR coberto) e devolve o estado efetivo final. */
    @Transactional
    public boolean reavaliar(Long equipamentoId) {
        var travado = equipamentos.travarEstadoManutencao(equipamentoId)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Equipamento nao encontrado"));
        // Cobertura e autor saem da MESMA instrucao: lidos em duas (coberto, depois autor), uma
        // janela commitada como CONCLUIDA/CANCELADA entre elas deixava "coberto" sem autor, e o
        // orElseThrow da entrada derrubava a acao do usuario. Com manual ligado nem se consulta.
        Optional<Long> autorDaJanela = travado.getManutencaoManual()
                ? Optional.empty() : cobertura.autorDaCobertura(equipamentoId);
        boolean desejado = travado.getManutencaoManual() || autorDaJanela.isPresent();
        boolean atual = travado.getEmManutencao();
        if (desejado == atual) {
            return atual;
        }
        Instant agora = Instant.now();
        if (equipamentos.trocarEmManutencao(equipamentoId, atual, desejado, agora) == 0) {
            // Impossivel com o lock: falhar alto e melhor que aplicar efeito sem a virada.
            throw new IllegalStateException("em_manutencao mudou sob lock do equipamento " + equipamentoId);
        }
        if (desejado) {
            // Entrar sem manual so acontece por cobertura: o autor e quem criou a janela.
            // Presente por construcao (desejado veio dele), nunca por corrida.
            efeitos.aplicarEntrada(equipamentoId, usuarioObrigatorio(autorDaJanela.orElseThrow()), agora);
        } else {
            efeitos.aplicarSaida(equipamentoId);
        }
        return desejado;
    }

    @Transactional
    public void iniciarManual(Long equipamentoId, Long usuarioId) {
        Usuario autor = usuarioObrigatorio(usuarioId);   // falha antes do lock, como EquipamentoService.autor
        var travado = equipamentos.travarEstadoManutencao(equipamentoId)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Equipamento nao encontrado"));
        if (travado.getManutencaoManual()) {
            return;      // idempotente
        }
        Instant agora = Instant.now();
        equipamentos.marcarManual(equipamentoId, agora);
        // Ja em manutencao pela janela: os efeitos ja rodaram na entrada dela.
        if (!travado.getEmManutencao()) {
            efeitos.aplicarEntrada(equipamentoId, autor, agora);
        }
    }

    @Transactional
    public void encerrarManual(Long equipamentoId) {
        var travado = equipamentos.travarEstadoManutencao(equipamentoId)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Equipamento nao encontrado"));
        if (!travado.getManutencaoManual()) {
            return;
        }
        if (equipamentos.desmarcarManual(equipamentoId, Instant.now()) == 0) {
            // Impossivel com o lock, como em reavaliar: falhar alto e melhor que reavaliar sem a virada.
            throw new IllegalStateException("manutencao_manual mudou sob lock do equipamento " + equipamentoId);
        }
        reavaliar(equipamentoId);   // mesma transacao; o lock ja e nosso
    }

    /**
     * Autor humano da acao, resolvido a partir do id do principal autenticado. Mesmo
     * padrao de IncidenteService.autor: falha alto quando o id nao chega, porque
     * gravar autor nulo mentiria sobre fechado_por (a V17 assume nulo = motor).
     */
    private Usuario usuarioObrigatorio(Long usuarioId) {
        if (usuarioId == null) {
            throw new IllegalStateException("Acao exige usuario autenticado");
        }
        return usuarios.findById(usuarioId)
                .orElseThrow(() -> new RecursoNaoEncontradoException("Usuario nao encontrado"));
    }
}

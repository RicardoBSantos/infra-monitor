package br.com.inframonitor.equipamento.entity;

import br.com.inframonitor.usuario.entity.Usuario;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * Sessao do botao de manutencao manual: ancora de notificacao e historico. Somente leitura
 * aqui; a escrita e por SQL no lock do equipamento. {@code iniciadaEm} e {@code iniciadaPor}
 * sao nulos so na sessao criada pelo backfill da V23 (anterior ao registro de sessoes).
 */
@Entity
@Table(name = "manutencao_manual")
public class ManutencaoManual {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "equipamento_id", nullable = false, updatable = false)
    private Equipamento equipamento;

    @Column(name = "iniciada_em", updatable = false)
    private Instant iniciadaEm;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "iniciada_por_id", updatable = false)
    private Usuario iniciadaPor;

    @Column(name = "encerrada_em", updatable = false)
    private Instant encerradaEm;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "encerrada_por_id", updatable = false)
    private Usuario encerradaPor;

    protected ManutencaoManual() {
    }

    public Long getId() { return id; }
    public Equipamento getEquipamento() { return equipamento; }
    public Instant getIniciadaEm() { return iniciadaEm; }
    public Usuario getIniciadaPor() { return iniciadaPor; }
    public Instant getEncerradaEm() { return encerradaEm; }
    public Usuario getEncerradaPor() { return encerradaPor; }
}

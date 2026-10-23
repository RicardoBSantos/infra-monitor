package br.com.inframonitor.manutencao.entity;

import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.unidade.entity.Unidade;
import br.com.inframonitor.usuario.entity.Usuario;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import org.hibernate.annotations.BatchSize;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;

@Entity
@Table(name = "manutencao_agendada")
public class ManutencaoAgendada {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "unidade_id", nullable = false, updatable = false)
    private Unidade unidade;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 12, updatable = false)
    private EscopoManutencao escopo;

    @Column(name = "inicio_previsto", nullable = false, updatable = false)
    private Instant inicioPrevisto;

    @Column(name = "fim_previsto", nullable = false, updatable = false)
    private Instant fimPrevisto;

    @Column(nullable = false, length = 300, updatable = false)
    private String motivo;

    // Transicoes so por SQL com CAS (CoberturaManutencao). updatable = false: a entidade nunca
    // regrava status/carimbos com o que estava na sessao.
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 10, updatable = false)
    private SituacaoManutencao situacao;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "criado_por_id", nullable = false, updatable = false)
    private Usuario criadoPor;

    @Column(name = "ativada_em", updatable = false)
    private Instant ativadaEm;

    @Column(name = "encerrada_em", updatable = false)
    private Instant encerradaEm;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "encerrada_por_id", updatable = false)
    private Usuario encerradaPor;

    @Column(name = "cancelada_em", updatable = false)
    private Instant canceladaEm;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "cancelada_por_id", updatable = false)
    private Usuario canceladaPor;

    @ManyToMany(fetch = FetchType.LAZY)
    @JoinTable(name = "manutencao_agendada_equipamento",
            joinColumns = @JoinColumn(name = "manutencao_id"),
            inverseJoinColumns = @JoinColumn(name = "equipamento_id"))
    @BatchSize(size = 50)
    private Set<Equipamento> equipamentos = new LinkedHashSet<>();

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    // Escrita so por SQL (CAS em CoberturaManutencao e EdicaoManutencao); o banco preenche o 0.
    @Column(name = "versao", nullable = false, insertable = false, updatable = false)
    private int versao;

    protected ManutencaoAgendada() {
    }

    public ManutencaoAgendada(Unidade unidade, EscopoManutencao escopo, Instant inicioPrevisto, Instant fimPrevisto,
                              String motivo, Usuario criadoPor, Set<Equipamento> equipamentos) {
        this.unidade = unidade;
        this.escopo = escopo;
        this.inicioPrevisto = inicioPrevisto;
        this.fimPrevisto = fimPrevisto;
        this.motivo = motivo;
        this.criadoPor = criadoPor;
        this.situacao = SituacaoManutencao.AGENDADA;
        this.equipamentos = new LinkedHashSet<>(equipamentos);
    }

    @PrePersist
    void aoCriar() {
        createdAt = Instant.now();
        updatedAt = createdAt;
    }

    public Long getId() { return id; }
    public Unidade getUnidade() { return unidade; }
    public EscopoManutencao getEscopo() { return escopo; }
    public Instant getInicioPrevisto() { return inicioPrevisto; }
    public Instant getFimPrevisto() { return fimPrevisto; }
    public String getMotivo() { return motivo; }
    public SituacaoManutencao getSituacao() { return situacao; }
    public Usuario getCriadoPor() { return criadoPor; }
    public Instant getAtivadaEm() { return ativadaEm; }
    public Instant getEncerradaEm() { return encerradaEm; }
    public Usuario getEncerradaPor() { return encerradaPor; }
    public Instant getCanceladaEm() { return canceladaEm; }
    public Usuario getCanceladaPor() { return canceladaPor; }
    public Set<Equipamento> getEquipamentos() { return equipamentos; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public int getVersao() { return versao; }
}

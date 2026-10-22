package br.com.inframonitor.equipamento.entity;

import br.com.inframonitor.tipoequipamento.entity.TipoEquipamento;
import br.com.inframonitor.unidade.entity.Unidade;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "equipamento")
public class Equipamento {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "unidade_id", nullable = false)
    private Unidade unidade;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tipo_equipamento_id", nullable = false)
    private TipoEquipamento tipoEquipamento;

    @Column(nullable = false, length = 150)
    private String nome;

    @Column(name = "ip_address", length = 45)
    private String ip;

    @Column(length = 255)
    private String hostname;

    @Column(columnDefinition = "TEXT")
    private String descricao;

    @Column(length = 255)
    private String localizacao;

    @Column(name = "numero_serie", length = 150)
    private String numeroSerie;

    // Colunas presentes desde V2. Ficam fora do construtor: sao opcionais e o
    // construtor de oito argumentos ja e usado por testes de outros modulos.
    @Column(length = 100)
    private String fabricante;

    @Column(length = 150)
    private String modelo;

    @Column(nullable = false)
    private boolean ativo;

    // Escritos SOMENTE por SQL nativo com CAS (EquipamentoRepository) sob FOR UPDATE.
    // updatable = false: atualizar/ativar/desativar fazem dirty-check da linha inteira e,
    // sem isto, regravariam o valor que estava na sessao por cima de uma virada feita
    // pelo reconciliador no meio (lost update provado em FlagManutencaoNaoSobrescrito...).
    @Column(name = "em_manutencao", nullable = false, updatable = false)
    private boolean emManutencao;

    @Column(name = "manutencao_manual", nullable = false, updatable = false)
    private boolean manutencaoManual;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Equipamento() {
    }

    public Equipamento(Unidade unidade, TipoEquipamento tipoEquipamento, String nome, String ip,
                       String hostname, String descricao, String localizacao, String numeroSerie) {
        this.unidade = unidade;
        this.tipoEquipamento = tipoEquipamento;
        this.nome = nome;
        this.ip = ip;
        this.hostname = hostname;
        this.descricao = descricao;
        this.localizacao = localizacao;
        this.numeroSerie = numeroSerie;
        this.ativo = true;
        this.emManutencao = false;
    }

    @PrePersist
    void registrarCriacao() {
        Instant agora = Instant.now();
        createdAt = agora;
        updatedAt = agora;
    }

    @PreUpdate
    void registrarAtualizacao() {
        updatedAt = Instant.now();
    }

    public Long getId() { return id; }
    public Unidade getUnidade() { return unidade; }
    public void setUnidade(Unidade unidade) { this.unidade = unidade; }
    public TipoEquipamento getTipoEquipamento() { return tipoEquipamento; }
    public void setTipoEquipamento(TipoEquipamento tipoEquipamento) { this.tipoEquipamento = tipoEquipamento; }
    public String getNome() { return nome; }
    public void setNome(String nome) { this.nome = nome; }
    public String getIp() { return ip; }
    public void setIp(String ip) { this.ip = ip; }
    public String getHostname() { return hostname; }
    public void setHostname(String hostname) { this.hostname = hostname; }
    public String getDescricao() { return descricao; }
    public void setDescricao(String descricao) { this.descricao = descricao; }
    public String getLocalizacao() { return localizacao; }
    public void setLocalizacao(String localizacao) { this.localizacao = localizacao; }
    public String getNumeroSerie() { return numeroSerie; }
    public void setNumeroSerie(String numeroSerie) { this.numeroSerie = numeroSerie; }
    public String getFabricante() { return fabricante; }
    public void setFabricante(String fabricante) { this.fabricante = fabricante; }
    public String getModelo() { return modelo; }
    public void setModelo(String modelo) { this.modelo = modelo; }
    public boolean isAtivo() { return ativo; }
    public void setAtivo(boolean ativo) { this.ativo = ativo; }
    public boolean isEmManutencao() { return emManutencao; }
    /** So para testes em memoria; nao persiste (updatable = false). */
    public void setEmManutencao(boolean emManutencao) { this.emManutencao = emManutencao; }
    public boolean isManutencaoManual() { return manutencaoManual; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}

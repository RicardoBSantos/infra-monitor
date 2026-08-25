package br.com.inframonitor.monitor.entity;

import br.com.inframonitor.equipamento.entity.Equipamento;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
@Table(name = "monitor")
public class Monitor {
    public static final int DEFAULT_FALHAS_PARA_INCIDENTE = 3;
    public static final int DEFAULT_SUCESSOS_PARA_RECOVERY = 2;
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "equipamento_id", nullable = false)
    private Equipamento equipamento;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private TipoMonitor tipo;

    @Column(nullable = false, length = 150)
    private String nome;

    @Column(name = "intervalo_segundos", nullable = false)
    private int intervaloSegundos;

    @Column(name = "timeout_ms", nullable = false)
    private int timeoutMs;

    @Column(name = "falhas_para_incidente", nullable = false)
    private int falhasParaIncidente;

    @Column(name = "sucessos_para_recovery", nullable = false)
    private int sucessosParaRecovery;

    @Column(nullable = false)
    private boolean ativo;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Monitor() { }

    public Monitor(Equipamento equipamento, TipoMonitor tipo, String nome, int intervaloSegundos, int timeoutMs) {
        this(equipamento, tipo, nome, intervaloSegundos, timeoutMs,
                DEFAULT_FALHAS_PARA_INCIDENTE, DEFAULT_SUCESSOS_PARA_RECOVERY);
    }

    public Monitor(Equipamento equipamento, TipoMonitor tipo, String nome, int intervaloSegundos, int timeoutMs,
                   int falhasParaIncidente, int sucessosParaRecovery) {
        this.equipamento = equipamento;
        this.tipo = tipo;
        this.nome = nome;
        this.intervaloSegundos = intervaloSegundos;
        this.timeoutMs = timeoutMs;
        this.falhasParaIncidente = falhasParaIncidente;
        this.sucessosParaRecovery = sucessosParaRecovery;
        this.ativo = true;
    }

    @PrePersist void registrarCriacao() { Instant agora = Instant.now(); createdAt = agora; updatedAt = agora; }
    @PreUpdate void registrarAtualizacao() { updatedAt = Instant.now(); }
    public Long getId() { return id; }
    public Equipamento getEquipamento() { return equipamento; }
    public void setEquipamento(Equipamento equipamento) { this.equipamento = equipamento; }
    public TipoMonitor getTipo() { return tipo; }
    public void setTipo(TipoMonitor tipo) { this.tipo = tipo; }
    public String getNome() { return nome; }
    public void setNome(String nome) { this.nome = nome; }
    public int getIntervaloSegundos() { return intervaloSegundos; }
    public void setIntervaloSegundos(int intervaloSegundos) { this.intervaloSegundos = intervaloSegundos; }
    public int getTimeoutMs() { return timeoutMs; }
    public void setTimeoutMs(int timeoutMs) { this.timeoutMs = timeoutMs; }
    public int getFalhasParaIncidente() { return falhasParaIncidente; }
    public void setFalhasParaIncidente(int falhasParaIncidente) { this.falhasParaIncidente = falhasParaIncidente; }
    public int getSucessosParaRecovery() { return sucessosParaRecovery; }
    public void setSucessosParaRecovery(int sucessosParaRecovery) { this.sucessosParaRecovery = sucessosParaRecovery; }
    public boolean isAtivo() { return ativo; }
    public void setAtivo(boolean ativo) { this.ativo = ativo; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}

package br.com.inframonitor.incidente.entity;

import br.com.inframonitor.monitor.entity.Monitor;
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
@Table(name = "incidente")
public class Incidente {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "monitor_id", nullable = false)
    private Monitor monitor;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private StatusIncidente status;

    @Column(name = "iniciado_em", nullable = false, updatable = false)
    private Instant iniciadoEm;

    @Column(name = "encerrado_em")
    private Instant encerradoEm;

    @Column(length = 255)
    private String motivo;

    @Column(length = 1000)
    private String observacao;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Incidente() {
    }

    public Incidente(Monitor monitor, Instant iniciadoEm, String motivo, String observacao) {
        this.monitor = monitor;
        this.status = StatusIncidente.ABERTO;
        this.iniciadoEm = iniciadoEm;
        this.motivo = motivo;
        this.observacao = observacao;
    }

    public void fechar(Instant encerradoEm, String observacao) {
        this.status = StatusIncidente.FECHADO;
        this.encerradoEm = encerradoEm;
        if (observacao != null) {
            this.observacao = observacao;
        }
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
    public Monitor getMonitor() { return monitor; }
    public StatusIncidente getStatus() { return status; }
    public Instant getIniciadoEm() { return iniciadoEm; }
    public Instant getEncerradoEm() { return encerradoEm; }
    public String getMotivo() { return motivo; }
    public String getObservacao() { return observacao; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}

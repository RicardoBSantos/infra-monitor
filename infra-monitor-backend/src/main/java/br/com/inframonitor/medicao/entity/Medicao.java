package br.com.inframonitor.medicao.entity;

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
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
@Table(name = "medicao")
public class Medicao {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "monitor_id", nullable = false)
    private Monitor monitor;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private StatusMedicao status;

    @Column(name = "latencia_ms")
    private Integer latenciaMs;

    @Column(length = 255)
    private String mensagem;

    @Column(name = "executado_em", nullable = false, updatable = false)
    private Instant executadoEm;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected Medicao() {
    }

    public Medicao(Monitor monitor, StatusMedicao status, Integer latenciaMs, String mensagem, Instant executadoEm) {
        this.monitor = monitor;
        this.status = status;
        this.latenciaMs = latenciaMs;
        this.mensagem = mensagem;
        this.executadoEm = executadoEm;
    }

    @PrePersist
    void registrarCriacao() {
        createdAt = Instant.now();
    }

    public Long getId() { return id; }
    public Monitor getMonitor() { return monitor; }
    public StatusMedicao getStatus() { return status; }
    public Integer getLatenciaMs() { return latenciaMs; }
    public String getMensagem() { return mensagem; }
    public Instant getExecutadoEm() { return executadoEm; }
    public Instant getCreatedAt() { return createdAt; }
}

package br.com.inframonitor.monitoring.latency;

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

/**
 * Janela em que um monitor respondeu acima do limiar de latencia.
 *
 * <p>Serve de ancora para as notificacoes de latencia, que nao tem incidente: e o
 * episodio que garante um LATENCIA_ALTA e um LATENCIA_NORMALIZADA, e nao um alerta
 * por ciclo de ping. Episodio aberto e o que tem {@code encerradoEm} nulo.
 */
@Entity
@Table(name = "monitor_episodio_latencia")
public class MonitorEpisodioLatencia {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "monitor_id", nullable = false)
    private Monitor monitor;

    @Column(name = "iniciado_em", nullable = false, updatable = false)
    private Instant iniciadoEm;

    @Column(name = "encerrado_em")
    private Instant encerradoEm;

    @Column(name = "limiar_ms", nullable = false, updatable = false)
    private int limiarMs;

    @Enumerated(EnumType.STRING)
    @Column(name = "motivo_encerramento", length = 24)
    private MotivoEncerramentoEpisodio motivoEncerramento;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected MonitorEpisodioLatencia() {
    }

    public MonitorEpisodioLatencia(Monitor monitor, Instant iniciadoEm, int limiarMs) {
        this.monitor = monitor;
        this.iniciadoEm = iniciadoEm;
        this.limiarMs = limiarMs;
    }

    public void encerrar(Instant encerradoEm, MotivoEncerramentoEpisodio motivoEncerramento) {
        this.encerradoEm = encerradoEm;
        this.motivoEncerramento = motivoEncerramento;
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
    public Instant getIniciadoEm() { return iniciadoEm; }
    public Instant getEncerradoEm() { return encerradoEm; }
    public int getLimiarMs() { return limiarMs; }
    public MotivoEncerramentoEpisodio getMotivoEncerramento() { return motivoEncerramento; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public boolean estaAberto() { return encerradoEm == null; }
}

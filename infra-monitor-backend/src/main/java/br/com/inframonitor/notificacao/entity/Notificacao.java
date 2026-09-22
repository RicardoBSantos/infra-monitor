package br.com.inframonitor.notificacao.entity;

import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.monitoring.latency.MonitorEpisodioLatencia;
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
@Table(name = "notificacao")
public class Notificacao {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Uma das duas ancoras da notificacao, nunca as duas: eventos de incidente usam
     * esta, eventos de latencia usam {@link #episodioLatencia}. O banco garante a
     * exclusividade em ck_notificacao_ancora_exclusiva.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "incidente_id")
    private Incidente incidente;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "episodio_latencia_id")
    private MonitorEpisodioLatencia episodioLatencia;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private CanalNotificacao canal;

    @Enumerated(EnumType.STRING)
    @Column(name = "tipo_evento", nullable = false, length = 40)
    private TipoEventoNotificacao tipoEvento;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private StatusNotificacao status;

    @Column(nullable = false)
    private int tentativas;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String mensagem;

    @Column(length = 1000)
    private String erro;

    @Column(name = "enviado_em")
    private Instant enviadoEm;

    @Column(name = "proxima_tentativa_em")
    private Instant proximaTentativaEm;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Notificacao() {
    }

    public Notificacao(Incidente incidente, CanalNotificacao canal, TipoEventoNotificacao tipoEvento, String mensagem) {
        this(canal, tipoEvento, mensagem);
        this.incidente = incidente;
    }

    public Notificacao(MonitorEpisodioLatencia episodioLatencia, CanalNotificacao canal,
                       TipoEventoNotificacao tipoEvento, String mensagem) {
        this(canal, tipoEvento, mensagem);
        this.episodioLatencia = episodioLatencia;
    }

    private Notificacao(CanalNotificacao canal, TipoEventoNotificacao tipoEvento, String mensagem) {
        this.canal = canal;
        this.tipoEvento = tipoEvento;
        this.status = StatusNotificacao.PENDENTE;
        this.tentativas = 0;
        this.mensagem = mensagem;
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
    public Incidente getIncidente() { return incidente; }
    public MonitorEpisodioLatencia getEpisodioLatencia() { return episodioLatencia; }
    public CanalNotificacao getCanal() { return canal; }
    public TipoEventoNotificacao getTipoEvento() { return tipoEvento; }
    public StatusNotificacao getStatus() { return status; }
    public int getTentativas() { return tentativas; }
    public String getMensagem() { return mensagem; }
    public String getErro() { return erro; }
    public Instant getEnviadoEm() { return enviadoEm; }
    public Instant getProximaTentativaEm() { return proximaTentativaEm; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }

    public void marcarEnviada(Instant agora) {
        status = StatusNotificacao.ENVIADA;
        tentativas++;
        enviadoEm = agora;
        erro = null;
        proximaTentativaEm = null;
    }

    public void agendarRetry(Instant proximaTentativa, String mensagemErro) {
        status = StatusNotificacao.PENDENTE;
        tentativas++;
        erro = mensagemErro;
        proximaTentativaEm = proximaTentativa;
    }

    public void marcarFalha(String mensagemErro) {
        status = StatusNotificacao.FALHA;
        tentativas++;
        erro = mensagemErro;
        proximaTentativaEm = null;
    }
}

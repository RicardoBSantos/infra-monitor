package br.com.inframonitor.incidente.repository;

import br.com.inframonitor.incidente.entity.Incidente;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.usuario.entity.Usuario;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.Collection;
import java.util.List;

public interface IncidenteRepository extends JpaRepository<Incidente, Long>, JpaSpecificationExecutor<Incidente> {

    boolean existsByMonitorId(Long monitorId);

    // Os metodos abaixo recebem colecao de status porque a pergunta que interessa ao
    // dominio e "existe incidente em aberto?", e em aberto sao dois estados desde a
    // V16: ABERTO e RECONHECIDO. Ver StatusIncidente.EM_ABERTO.
    boolean existsByMonitorIdAndStatusIn(Long monitorId, Collection<StatusIncidente> status);

    @Override
    @EntityGraph(attributePaths = {"monitor", "monitor.equipamento", "monitor.equipamento.unidade", "reconhecidoPor", "fechadoPor"})
    Optional<Incidente> findById(Long id);

    @Override
    @EntityGraph(attributePaths = {"monitor", "monitor.equipamento", "monitor.equipamento.unidade", "reconhecidoPor", "fechadoPor"})
    Page<Incidente> findAll(Specification<Incidente> specification, Pageable pageable);

    @EntityGraph(attributePaths = {"monitor", "monitor.equipamento", "monitor.equipamento.unidade", "reconhecidoPor", "fechadoPor"})
    Optional<Incidente> findFirstByMonitorIdAndStatusInOrderByIniciadoEmDescIdDesc(Long monitorId,
            Collection<StatusIncidente> status);

    @EntityGraph(attributePaths = "monitor")
    List<Incidente> findByMonitorIdInAndStatusIn(Collection<Long> monitorIds, Collection<StatusIncidente> status);
    @Query("select i from Incidente i where i.monitor.id in :ids and i.iniciadoEm < :fim and (i.encerradoEm is null or i.encerradoEm > :inicio)") List<Incidente> noPeriodo(@Param("ids") Collection<Long> ids,@Param("inicio") java.time.Instant inicio,@Param("fim") java.time.Instant fim);

    /**
     * Compara-e-troca contra ABERTO. O motor de incidentes roda a cada ciclo de ping e
     * pode fechar este mesmo incidente enquanto o operador clica em Reconhecer; um
     * read-modify-write comum perderia esse fechamento e ressuscitaria o incidente com
     * encerrado_em de volta para NULL. Mesmo idioma de NotificacaoRepository.reserveForDispatch.
     *
     * <p>Retorna 1 quando reconheceu e 0 quando o incidente ja saiu de ABERTO. Por ser
     * bulk update, {@code @PreUpdate} nao dispara — dai updatedAt explicito no SET — e o
     * contexto de persistencia precisa ser sincronizado nas duas pontas.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Incidente i set i.status = br.com.inframonitor.incidente.entity.StatusIncidente.RECONHECIDO, "
            + "i.reconhecidoEm = :agora, i.reconhecidoPor = :usuario, i.updatedAt = :agora "
            + "where i.id = :id and i.status = br.com.inframonitor.incidente.entity.StatusIncidente.ABERTO")
    int reconhecerSeAberto(@Param("id") Long id, @Param("usuario") Usuario usuario, @Param("agora") Instant agora);

    /**
     * Fechamento do motor como compara-e-troca contra ABERTO/RECONHECIDO, no idioma de
     * reconhecerSeAberto e fecharPorManutencao. O caminho antigo carregava a entidade,
     * chamava fechar() e fazia saveAndFlush: o UPDATE do Hibernate grava TODAS as
     * colunas WHERE id = ?, sem versao, entao sobrescrevia um fechamento por manutencao
     * que tivesse commitado no meio (motivo e autor trocados, duas notificacoes de
     * encerramento) e apagava reconhecido_em/reconhecido_por gravados por reconhecer.
     *
     * <p>So toca as colunas de fechamento. Retorna 1 quando fechou e 0 quando outra
     * transacao ja fechou. Sob READ COMMITTED, se a outra transacao segura a linha, este
     * UPDATE espera e o Postgres reavalia o WHERE sobre a versao nova (EvalPlanQual).
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Incidente i set i.status = br.com.inframonitor.incidente.entity.StatusIncidente.FECHADO, "
            + "i.encerradoEm = :encerradoEm, i.observacao = :observacao, "
            + "i.motivoEncerramento = br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente.RECUPERACAO_AUTOMATICA, "
            + "i.fechadoPor = null, i.updatedAt = :agora "
            + "where i.id = :id and i.status in (br.com.inframonitor.incidente.entity.StatusIncidente.ABERTO, "
            + "br.com.inframonitor.incidente.entity.StatusIncidente.RECONHECIDO)")
    int fecharAutomaticamenteSeEmAberto(@Param("id") Long id, @Param("encerradoEm") Instant encerradoEm,
                                        @Param("observacao") String observacao, @Param("agora") Instant agora);

    /**
     * Fechamento humano como CAS, irmao de fecharAutomaticamenteSeEmAberto: so colunas de
     * fechamento, entao reconhecido_* sobrevive, e 0 linhas quando motor, manutencao ou outro
     * operador ja fechou entre a leitura e aqui.
     *
     * <p>{@code coalesce} na observacao repete Incidente.fechar: fechar sem observacao nao
     * apaga a que o incidente aberto a mao ja trazia.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Incidente i set i.status = br.com.inframonitor.incidente.entity.StatusIncidente.FECHADO, "
            + "i.encerradoEm = :encerradoEm, i.observacao = coalesce(:observacao, i.observacao), "
            + "i.motivoEncerramento = br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente.FECHAMENTO_MANUAL, "
            + "i.fechadoPor = :usuario, i.updatedAt = :agora "
            + "where i.id = :id and i.status in (br.com.inframonitor.incidente.entity.StatusIncidente.ABERTO, "
            + "br.com.inframonitor.incidente.entity.StatusIncidente.RECONHECIDO)")
    int fecharManualmenteSeEmAberto(@Param("id") Long id, @Param("encerradoEm") Instant encerradoEm,
                                    @Param("observacao") String observacao, @Param("usuario") Usuario usuario,
                                    @Param("agora") Instant agora);

    /**
     * Abertura condicional, no idioma de NotificacaoRepository.inserirPendenteSeAusente.
     * O WHERE carrega o predicado inteiro de "este monitor deveria estar sendo
     * observado agora"; o ON CONFLICT DO NOTHING absorve uq_incidente_monitor_aberto.
     *
     * <p>Retorno 0 significa "a manutencao ganhou a corrida, ou o monitor saiu do ar
     * administrativamente, ou ja havia incidente aberto". Nos tres casos NAO se cria
     * notificacao — e e' esse o ponto, porque o caminho antigo notificava logo depois
     * do save sem olhar se algo tinha sido inserido.
     *
     * <p>{@code FOR UPDATE OF e} disputa a MESMA linha de equipamento que
     * {@code EquipamentoRepository.marcarEmManutencaoSeNaoEstiver} trava. Sem isto, sob
     * READ COMMITTED, este SELECT e aquele UPDATE tocam linhas diferentes (equipamento
     * vs. incidente) e nunca serializam: a abertura pode ler em_manutencao=false antes
     * do flag commitar, inserir o incidente, e so depois a manutencao rodar
     * fecharPorManutencao sobre uma lista de incidentes abertos que ja estava vazia no
     * momento em que foi lida — o incidente sobrevive ABERTO. Com o lock, quando a
     * manutencao ja tiver travado a linha, este SELECT espera; ao ser liberado, o
     * Postgres reavalia o WHERE via EvalPlanQual sobre a versao nova da linha
     * (em_manutencao=true) e nao insere nada. Ordem de lock equipamento-antes-de-
     * incidente e a MESMA nas duas transacoes (entrarEmManutencao tambem trava
     * equipamento primeiro e so depois escreve em incidente), entao nao ha ciclo nem
     * risco de deadlock.
     */
    @Modifying
    @Query(value = """
            INSERT INTO incidente (monitor_id, status, iniciado_em, motivo, created_at, updated_at)
            SELECT m.id, 'ABERTO', :iniciadoEm, :motivo, :agora, :agora
              FROM monitor m JOIN equipamento e ON e.id = m.equipamento_id
             WHERE m.id = :monitorId AND m.ativo AND e.ativo AND e.em_manutencao = false
             FOR UPDATE OF e
            ON CONFLICT DO NOTHING
            """, nativeQuery = true)
    int inserirSeElegivel(@Param("monitorId") Long monitorId, @Param("iniciadoEm") Instant iniciadoEm,
                          @Param("motivo") String motivo, @Param("agora") Instant agora);

    // Espelha reconhecerSeAberto. Fecha todos os monitores do equipamento numa
    // instrucao e devolve quantos fechou.
    //
    // Grafo minimo de proposito: o chamador (EquipamentoService.entrarEmManutencao) so
    // usa esta lista para extrair ids ANTES do bulk update — nao para ler campos de
    // equipamento/unidade, muito menos os escalares que o UPDATE esta prestes a mudar
    // (status, encerradoEm, motivoEncerramento). Widening o grafo aqui so esconderia o
    // sintoma (LazyInitializationException) sem resolver a causa raiz, que e' o
    // proprio bulk update nao repropagar para instancias Java ja carregadas — por isso
    // a notificacao usa findAllById (abaixo) para RELER depois do UPDATE, nunca esta
    // lista.
    @EntityGraph(attributePaths = "monitor")
    @Query("select i from Incidente i where i.monitor.equipamento.id = :equipamentoId "
            + "and i.status in (br.com.inframonitor.incidente.entity.StatusIncidente.ABERTO, "
            + "br.com.inframonitor.incidente.entity.StatusIncidente.RECONHECIDO)")
    List<Incidente> abertosDoEquipamento(@Param("equipamentoId") Long equipamentoId);

    /**
     * Instante em que o fechamento mais recente do monitor foi GRAVADO, nao o encerrado_em
     * informado: no fechamento manual o encerrado_em vem do corpo e aceita data retroativa.
     * Os tres CAS de fechamento escrevem updated_at = :agora, e FECHADO e terminal (nenhum
     * endpoint escreve num incidente fechado), entao o valor nao se move depois.
     */
    @Query("select max(i.updatedAt) from Incidente i where i.monitor.id = :monitorId "
            + "and i.status = br.com.inframonitor.incidente.entity.StatusIncidente.FECHADO")
    Optional<Instant> ultimoFechamentoRegistrado(@Param("monitorId") Long monitorId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update Incidente i set i.status = br.com.inframonitor.incidente.entity.StatusIncidente.FECHADO, "
            + "i.encerradoEm = :agora, "
            + "i.motivoEncerramento = br.com.inframonitor.incidente.entity.MotivoEncerramentoIncidente.MANUTENCAO, "
            + "i.fechadoPor = :usuario, i.updatedAt = :agora "
            + "where i.monitor.equipamento.id = :equipamentoId "
            + "and i.status in (br.com.inframonitor.incidente.entity.StatusIncidente.ABERTO, "
            + "br.com.inframonitor.incidente.entity.StatusIncidente.RECONHECIDO)")
    int fecharPorManutencao(@Param("equipamentoId") Long equipamentoId, @Param("usuario") Usuario usuario,
                            @Param("agora") Instant agora);

    /**
     * Releitura pos-bulk-update. {@code fecharPorManutencao} e {@code clearAutomatically}:
     * a instrucao roda direto no banco e nao repropaga para os objetos Java ja
     * carregados (mesma licao de IncidenteService.reconhecer, que rele antes de
     * responder). Sem isto, {@code NotificacaoMessageBuilder} montaria a mensagem de
     * encerramento com {@code encerradoEm} ainda nulo — "Fim: null", sem acusar erro.
     *
     * <p>Grafo largo de proposito, igual a findById: o acesso lazy a
     * monitor.equipamento.unidade acontece dentro do forEach de notificacao, e
     * NotificacaoService.tratarEncerramentoPorManutencao roda outro
     * clearAutomatically (cancelarPendentesDoIncidente) a cada iteracao — sem
     * pre-carregar aqui, a segunda iteracao em diante estouraria
     * LazyInitializationException.
     */
    @Override
    @EntityGraph(attributePaths = {"monitor", "monitor.equipamento", "monitor.equipamento.unidade", "reconhecidoPor", "fechadoPor"})
    List<Incidente> findAllById(Iterable<Long> ids);
}

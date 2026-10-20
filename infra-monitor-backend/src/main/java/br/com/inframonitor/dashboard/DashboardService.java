package br.com.inframonitor.dashboard;

import br.com.inframonitor.common.exception.RecursoNaoEncontradoException;
import br.com.inframonitor.dashboard.dto.DashboardEquipamentoResponse;
import br.com.inframonitor.dashboard.dto.DashboardEquipamentoListaResponse;
import br.com.inframonitor.dashboard.dto.DashboardResumoResponse;
import br.com.inframonitor.dashboard.dto.DashboardUnidadeDetalheResponse;
import br.com.inframonitor.dashboard.dto.DashboardUnidadeResponse;
import br.com.inframonitor.equipamento.entity.Equipamento;
import br.com.inframonitor.equipamento.repository.EquipamentoRepository;
import br.com.inframonitor.incidente.entity.StatusIncidente;
import br.com.inframonitor.incidente.repository.IncidenteRepository;
import br.com.inframonitor.medicao.repository.MedicaoRepository;
import br.com.inframonitor.monitor.repository.MonitorRepository;
import br.com.inframonitor.monitor.entity.Monitor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.Collection;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@Transactional(readOnly = true)
public class DashboardService {
    private final DashboardReadRepository readRepository;
    private final EquipamentoRepository equipamentoRepository;
    private final MonitorRepository monitorRepository;
    private final MedicaoRepository medicaoRepository;
    private final IncidenteRepository incidenteRepository;
    private final Clock clock;
    /** Acima deste tempo de resposta ICMP a leitura vira DEGRADADO. Configuravel por ambiente. */
    private final int limiarLatenciaDegradadaMs;

    @Autowired
    public DashboardService(DashboardReadRepository readRepository, EquipamentoRepository equipamentoRepository,
                            MonitorRepository monitorRepository, MedicaoRepository medicaoRepository,
                            IncidenteRepository incidenteRepository,
                            @Value("${monitoring.latencia-degradada-ms:250}") int limiarLatenciaDegradadaMs) {
        this(readRepository, equipamentoRepository, monitorRepository, medicaoRepository, incidenteRepository,
                Clock.systemUTC(), limiarLatenciaDegradadaMs);
    }

    DashboardService(DashboardReadRepository readRepository, EquipamentoRepository equipamentoRepository,
                     MonitorRepository monitorRepository, MedicaoRepository medicaoRepository,
                     IncidenteRepository incidenteRepository, Clock clock) {
        this(readRepository, equipamentoRepository, monitorRepository, medicaoRepository, incidenteRepository, clock, 250);
    }

    DashboardService(DashboardReadRepository readRepository, EquipamentoRepository equipamentoRepository,
                     MonitorRepository monitorRepository, MedicaoRepository medicaoRepository,
                     IncidenteRepository incidenteRepository, Clock clock, int limiarLatenciaDegradadaMs) {
        this.readRepository = readRepository; this.equipamentoRepository = equipamentoRepository;
        this.monitorRepository = monitorRepository; this.medicaoRepository = medicaoRepository;
        this.incidenteRepository = incidenteRepository; this.clock = clock;
        this.limiarLatenciaDegradadaMs = limiarLatenciaDegradadaMs;
    }

    public DashboardResumoResponse resumo() {
        var c = readRepository.resumo(limiarLatenciaDegradadaMs);
        return new DashboardResumoResponse(new DashboardResumoResponse.Unidades(c.unidadesTotal()),
                new DashboardResumoResponse.Equipamentos(c.equipamentosTotal(), c.equipamentosAtivos(), c.equipamentosDisponiveis(), c.equipamentosDegradados(), c.equipamentosIndisponiveis(), c.equipamentosSemDados(), c.equipamentosSemMonitoramento(), c.equipamentosEmManutencao()),
                new DashboardResumoResponse.Monitores(c.monitoresTotal(), c.monitoresAtivos(), c.monitoresDisponiveis(), c.monitoresDegradados(), c.monitoresIndisponiveis(), c.monitoresSemDados()),
                new DashboardResumoResponse.Incidentes(c.incidentesAbertos()), limiarLatenciaDegradadaMs, clock.instant());
    }

    public List<DashboardUnidadeResponse> unidades() { return readRepository.unidades(true, limiarLatenciaDegradadaMs).stream().map(this::unidadeResponse).toList(); }

    public List<DashboardEquipamentoListaResponse> equipamentos() {
        return readRepository.equipamentos(limiarLatenciaDegradadaMs).stream()
                .map(r -> new DashboardEquipamentoListaResponse(r.id(), r.nome(), r.tipoNome(), r.unidadeId(),
                        r.unidadeNome(), r.hostname(), r.ip(), r.status(), r.latenciaMs(), r.ativo(),
                        r.localizacao(), r.numeroSerie()))
                .toList();
    }

    public DashboardUnidadeDetalheResponse unidade(Long id) {
        var c = readRepository.unidade(id, limiarLatenciaDegradadaMs);
        if (c == null) throw new RecursoNaoEncontradoException("Unidade nao encontrada");
        return new DashboardUnidadeDetalheResponse(c.id(), c.nome(), c.codigoIbge(), c.ativo(), statusUnidade(c),
                new DashboardUnidadeDetalheResponse.Equipamentos(c.equipamentosTotal(), c.equipamentosAtivos(), c.equipamentosDisponiveis(), c.equipamentosDegradados(), c.equipamentosIndisponiveis(), c.equipamentosSemDados(), c.equipamentosSemMonitoramento(), c.equipamentosEmManutencao()),
                new DashboardUnidadeDetalheResponse.Monitores(c.monitoresAtivos(), c.monitoresIndisponiveis()), c.incidentesAbertos());
    }

    public Page<DashboardEquipamentoResponse> equipamentosDaUnidade(Long unidadeId, Long tipoEquipamentoId,
                                                                      Boolean ativo, Pageable pageable) {
        if (!readRepository.existeUnidade(unidadeId)) throw new RecursoNaoEncontradoException("Unidade nao encontrada");
        Specification<Equipamento> filtro = (root, query, cb) -> cb.equal(root.get("unidade").get("id"), unidadeId);
        if (tipoEquipamentoId != null) filtro = filtro.and((root, query, cb) -> cb.equal(root.get("tipoEquipamento").get("id"), tipoEquipamentoId));
        if (ativo != null) filtro = filtro.and((root, query, cb) -> cb.equal(root.get("ativo"), ativo));
        Page<Equipamento> pagina = equipamentoRepository.findAll(filtro, pageable);
        if (pagina.isEmpty()) return pagina.map(this::semDadosOperacionais);

        var porEquipamento = monitorRepository.findByEquipamentoIdIn(pagina.stream().map(Equipamento::getId).toList())
                .stream().collect(Collectors.groupingBy(m -> m.getEquipamento().getId()));
        var monitorIds = porEquipamento.values().stream().flatMap(Collection::stream).map(Monitor::getId).toList();
        var ultimas = monitorIds.isEmpty() ? Map.<Long, br.com.inframonitor.medicao.entity.Medicao>of()
                : medicaoRepository.findLatestByMonitorIds(monitorIds).stream()
                .collect(Collectors.toMap(m -> m.getMonitor().getId(), Function.identity()));
        var incidentes = monitorIds.isEmpty() ? Map.<Long, br.com.inframonitor.incidente.entity.Incidente>of()
                : incidenteRepository.findByMonitorIdInAndStatusIn(monitorIds, StatusIncidente.EM_ABERTO).stream()
                .collect(Collectors.toMap(i -> i.getMonitor().getId(), Function.identity()));
        return pagina.map(e -> operacional(e, porEquipamento.getOrDefault(e.getId(), List.of()), ultimas, incidentes));
    }

    private DashboardUnidadeResponse unidadeResponse(DashboardReadRepository.UnidadeCounts c) {
        return new DashboardUnidadeResponse(c.id(), c.nome(), c.codigoIbge(), c.ativo(), statusUnidade(c), c.equipamentosTotal(), c.equipamentosAtivos(), c.equipamentosDisponiveis(), c.equipamentosDegradados(), c.equipamentosIndisponiveis(), c.equipamentosSemDados(), c.equipamentosSemMonitoramento(), c.equipamentosEmManutencao(), c.incidentesAbertos(), c.latitude(), c.longitude(), c.conectaAUnidadeId());
    }

    private StatusOperacionalUnidade statusUnidade(DashboardReadRepository.UnidadeCounts c) {
        return OperationalStatusResolver.unidade(expandirStatus(c));
    }

    private List<StatusOperacionalEquipamento> expandirStatus(DashboardReadRepository.UnidadeCounts c) {
        // Aggregate SQL already classifies equipment. Reconstruct only the small status multiset required by the pure resolver.
        return java.util.stream.Stream.of(
                repetir(StatusOperacionalEquipamento.DISPONIVEL, c.equipamentosDisponiveis()),
                repetir(StatusOperacionalEquipamento.DEGRADADO, c.equipamentosDegradados()),
                repetir(StatusOperacionalEquipamento.INDISPONIVEL, c.equipamentosIndisponiveis()),
                repetir(StatusOperacionalEquipamento.SEM_DADOS, c.equipamentosSemDados()),
                repetir(StatusOperacionalEquipamento.SEM_MONITORAMENTO, c.equipamentosSemMonitoramento()),
                repetir(StatusOperacionalEquipamento.EM_MANUTENCAO, c.equipamentosEmManutencao()))
                .flatMap(Function.identity()).toList();
    }
    private java.util.stream.Stream<StatusOperacionalEquipamento> repetir(StatusOperacionalEquipamento s, long quantidade) {
        return java.util.stream.LongStream.range(0, quantidade).mapToObj(i -> s);
    }

    private DashboardEquipamentoResponse semDadosOperacionais(Equipamento e) {
        return operacional(e, List.of(), Map.of(), Map.of());
    }

    private DashboardEquipamentoResponse operacional(Equipamento equipamento, List<Monitor> monitores,
                                                       Map<Long, br.com.inframonitor.medicao.entity.Medicao> ultimas,
                                                       Map<Long, br.com.inframonitor.incidente.entity.Incidente> incidentes) {
        var statusMonitores = monitores.stream().map(m -> OperationalStatusResolver.monitor(m.isAtivo(),
                incidentes.containsKey(m.getId()), ultimas.containsKey(m.getId()),
                ultimas.containsKey(m.getId()) ? ultimas.get(m.getId()).getLatenciaMs() : null,
                limiarLatenciaDegradadaMs)).toList();
        var status = OperationalStatusResolver.equipamento(equipamento.isAtivo(), equipamento.isEmManutencao(), statusMonitores);
        var monitorAtivo = monitores.stream().filter(Monitor::isAtivo).toList();
        var ultima = monitorAtivo.stream().map(m -> ultimas.get(m.getId())).filter(java.util.Objects::nonNull)
                .max(java.util.Comparator.comparing(br.com.inframonitor.medicao.entity.Medicao::getExecutadoEm)
                        .thenComparing(br.com.inframonitor.medicao.entity.Medicao::getId)).orElse(null);
        var ultimaResponse = ultima == null ? null : new DashboardEquipamentoResponse.UltimaMedicao(
                ultima.getStatus(), ultima.getLatenciaMs(), ultima.getExecutadoEm());
        return new DashboardEquipamentoResponse(equipamento.getId(), equipamento.getNome(), equipamento.getIp(),
                equipamento.getLocalizacao(), equipamento.isAtivo(), status,
                new DashboardEquipamentoResponse.TipoEquipamento(equipamento.getTipoEquipamento().getId(), equipamento.getTipoEquipamento().getNome()),
                equipamento.isEmManutencao(), monitorAtivo.size(),
                // Mesma elegibilidade de monitor_estado.incidente_aberto em DashboardReadRepository.ESTADOS.
                equipamento.isAtivo() && !equipamento.isEmManutencao()
                        ? monitorAtivo.stream().filter(m -> incidentes.containsKey(m.getId())).count() : 0L,
                ultimaResponse,
                equipamento.getHostname());
    }
}

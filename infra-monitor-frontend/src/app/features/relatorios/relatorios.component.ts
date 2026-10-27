import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChildren } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize, Observable, take } from 'rxjs';

import { ApiError, ApiErrorCode, isApiError } from '../../core/models/api-error';
import { OPCOES_EVENTO_NOTIFICACAO, rotuloEventoNotificacao } from '../../core/models/rotulos-notificacao';
import { IncidentStatus, MeasurementStatus, NotificationChannel, NotificationEventType, NotificationStatus } from '../../core/models/api-enums';
import { EquipamentoResponse } from '../../core/models/equipamento';
import { MonitorResponse } from '../../core/models/monitor';
import { PageResponse } from '../../core/models/page-response';
import {
  DisponibilidadeEquipamentoResponse, DisponibilidadeEquipamentoSortField,
  DisponibilidadeUnidadeResponse, DisponibilidadeUnidadeSortField,
  HistoricoIncidenteResponse, HistoricoIncidenteSortField,
  HistoricoMedicaoResponse, HistoricoMedicaoSortField,
  HistoricoNotificacaoResponse, HistoricoNotificacaoSortField,
  IndicadoresVisaoGeralResponse,
  LatenciaIcmpResponse, LatenciaIcmpSortField, SortDirection,
} from '../../core/models/relatorio';
import { TipoEquipamentoResponse } from '../../core/models/tipo-equipamento';
import { UnidadeResponse } from '../../core/models/unidade';
import { EquipamentoApiService } from '../../core/services/equipamento-api.service';
import { formatarDecimal, formatarPercentual } from '../../core/format/numero';
import { plural } from '../../core/format/plural';
import { MonitorApiService } from '../../core/services/monitor-api.service';
import { RelatorioApiService } from '../../core/services/relatorio-api.service';
import { TipoEquipamentoApiService } from '../../core/services/tipo-equipamento-api.service';
import { UnidadeApiService } from '../../core/services/unidade-api.service';
import { navegarAbas } from '../../shared/a11y/navegar-abas';
import { PaginacaoComponent } from '../../shared/paginacao/paginacao.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { formatDurationSeconds } from './report-formatters';
import { apiErrorFromBlob, csvFilename, downloadCsvBlob, fallbackCsvFilename } from './report-csv-download';
import { downloadPdfBlob, fallbackPdfFilename, isPdfContentType, pdfFilename } from './report-pdf-download';

const TABS = ['overview', 'equipamentos', 'unidades', 'incidentes', 'medicoes', 'latencia', 'notificacoes'] as const;
type Tab = typeof TABS[number];
type ExportTab = Exclude<Tab, 'overview'>;
type HierarchyKind = 'availability' | 'incident' | 'measurement' | 'latency';
type LoadTarget = 'equipment' | 'unit' | 'incident' | 'measurement' | 'latency' | 'notification';
type LoadState = 'loading' | 'success' | 'empty' | 'error';
type OverviewTarget = 'indicators' | 'units' | 'equipment' | 'latency';

interface OverviewWidget<T> {
  state: ReturnType<typeof signal<LoadState>>;
  value: ReturnType<typeof signal<T | null>>;
  error: ReturnType<typeof signal<string | null>>;
}

interface ExportNotice { message: string; error: boolean; }

const sizes = [10, 20, 50, 100] as const;
const equipmentSorts = [{ value: 'equipamentoNome', label: 'Equipamento' }, { value: 'unidadeNome', label: 'Unidade' }, { value: 'monitorNome', label: 'Monitor' }, { value: 'disponibilidadePercentual', label: 'Disponibilidade' }, { value: 'tempoIndisponivelSegundos', label: 'Tempo indisponível' }, { value: 'tempoMonitoradoSegundos', label: 'Tempo monitorado' }, { value: 'incidentes', label: 'Incidentes' }] as const;
const unitSorts = [{ value: 'unidadeNome', label: 'Unidade' }, { value: 'equipamentosTotal', label: 'Equipamentos total' }, { value: 'equipamentosMonitorados', label: 'Monitorados' }, { value: 'equipamentosSemMonitoramento', label: 'Sem monitoramento' }, { value: 'tempoIndisponivelSegundos', label: 'Tempo indisponível' }, { value: 'disponibilidadePercentual', label: 'Disponibilidade' }, { value: 'incidentes', label: 'Incidentes' }] as const;
const incidentSorts = [{ value: 'iniciadoEm', label: 'Início' }, { value: 'encerradoEm', label: 'Encerramento' }, { value: 'duracaoSegundosNoPeriodo', label: 'Duração no período' }, { value: 'status', label: 'Status' }, { value: 'unidadeNome', label: 'Unidade' }, { value: 'equipamentoNome', label: 'Equipamento' }, { value: 'monitorNome', label: 'Monitor' }] as const;
const measurementSorts = [{ value: 'executadoEm', label: 'Data/hora' }, { value: 'status', label: 'Status' }, { value: 'latenciaMs', label: 'Latência' }, { value: 'unidadeNome', label: 'Unidade' }, { value: 'equipamentoNome', label: 'Equipamento' }, { value: 'monitorNome', label: 'Monitor' }] as const;
const latencySorts = [{ value: 'unidadeNome', label: 'Unidade' }, { value: 'equipamentoNome', label: 'Equipamento' }, { value: 'monitorNome', label: 'Monitor' }, { value: 'minLatenciaMs', label: 'Mínima' }, { value: 'avgLatenciaMs', label: 'Média' }, { value: 'maxLatenciaMs', label: 'Máxima' }, { value: 'count', label: 'Amostras' }] as const;
const notificationSorts = [{ value: 'createdAt', label: 'Criada em' }, { value: 'enviadoEm', label: 'Enviada em' }, { value: 'status', label: 'Status' }, { value: 'canal', label: 'Canal' }, { value: 'tipoEvento', label: 'Evento' }, { value: 'tentativas', label: 'Tentativas' }] as const;

@Component({ selector: 'app-relatorios', imports: [PaginacaoComponent, ReactiveFormsModule, RouterLink, StatusBadgeComponent], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './relatorios.component.html', styleUrl: './relatorios.component.scss' })
export class RelatoriosComponent {
  protected readonly plural = plural;
  private readonly reportsApi = inject(RelatorioApiService);
  private readonly unidadesApi = inject(UnidadeApiService);
  private readonly tiposApi = inject(TipoEquipamentoApiService);
  private readonly equipamentosApi = inject(EquipamentoApiService);
  private readonly monitoresApi = inject(MonitorApiService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);

  private readonly abas = viewChildren<ElementRef<HTMLButtonElement>>('aba');
  protected readonly activeTab = signal<Tab>('equipamentos');
  protected readonly overviewForm = this.fb.nonNullable.group({ inicio: localDateTime(-24), fim: localDateTime(0) });
  protected readonly form = this.availabilityForm();
  protected readonly incidentForm = this.hierarchyHistoryForm();
  protected readonly measurementForm = this.hierarchyHistoryForm();
  protected readonly latencyForm = this.hierarchyHistoryForm();
  protected readonly notificationForm = this.fb.nonNullable.group({ inicio: localDateTime(-24), fim: localDateTime(0), incidenteId: '', status: '', canal: '', tipoEvento: '' });

  protected readonly unidades = signal<UnidadeResponse[]>([]);
  protected readonly tipos = signal<TipoEquipamentoResponse[]>([]);
  protected readonly equipamentos = signal<EquipamentoResponse[]>([]);
  protected readonly monitores = signal<MonitorResponse[]>([]);
  protected readonly incidentEquipamentos = signal<EquipamentoResponse[]>([]);
  protected readonly incidentMonitores = signal<MonitorResponse[]>([]);
  protected readonly measurementEquipamentos = signal<EquipamentoResponse[]>([]);
  protected readonly measurementMonitores = signal<MonitorResponse[]>([]);
  protected readonly latencyEquipamentos = signal<EquipamentoResponse[]>([]);
  protected readonly latencyMonitores = signal<MonitorResponse[]>([]);

  protected readonly lookupError = signal<string | null>(null);
  protected readonly periodError = signal<string | null>(null);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly equipmentPage = signal<PageResponse<DisponibilidadeEquipamentoResponse> | null>(null);
  protected readonly unitPage = signal<PageResponse<DisponibilidadeUnidadeResponse> | null>(null);
  protected readonly incidentPage = signal<PageResponse<HistoricoIncidenteResponse> | null>(null);
  protected readonly measurementPage = signal<PageResponse<HistoricoMedicaoResponse> | null>(null);
  protected readonly latencyPage = signal<PageResponse<LatenciaIcmpResponse> | null>(null);
  protected readonly notificationPage = signal<PageResponse<HistoricoNotificacaoResponse> | null>(null);
  protected readonly equipmentState = signal<LoadState>('loading');
  protected readonly unitState = signal<LoadState>('loading');
  protected readonly incidentState = signal<LoadState>('loading');
  protected readonly measurementState = signal<LoadState>('loading');
  protected readonly latencyState = signal<LoadState>('loading');
  protected readonly notificationState = signal<LoadState>('loading');
  protected readonly exporting = signal<Record<ExportTab, boolean>>(emptyExportState(false));
  protected readonly exportNotices = signal<Record<ExportTab, ExportNotice | null>>(emptyExportState(null));
  protected readonly pdfExporting = signal(false);
  protected readonly pdfExportNotice = signal<ExportNotice | null>(null);
  protected readonly overviewWidgets = {
    // Os três KPIs são um conjunto só, servidos por uma consulta só: carregam, falham e são
    // repetidos juntos. Os rankings abaixo continuam independentes, cada um com seu estado.
    indicators: overviewWidget<IndicadoresVisaoGeralResponse>(),
    units: overviewWidget<DisponibilidadeUnidadeResponse[]>(),
    equipment: overviewWidget<DisponibilidadeEquipamentoResponse[]>(),
    latency: overviewWidget<LatenciaIcmpResponse[]>(),
  };

  protected readonly equipmentSort = signal<DisponibilidadeEquipamentoSortField>('equipamentoNome');
  protected readonly unitSort = signal<DisponibilidadeUnidadeSortField>('unidadeNome');
  protected readonly incidentSort = signal<HistoricoIncidenteSortField>('iniciadoEm');
  protected readonly measurementSort = signal<HistoricoMedicaoSortField>('executadoEm');
  protected readonly latencySort = signal<LatenciaIcmpSortField>('monitorNome');
  protected readonly notificationSort = signal<HistoricoNotificacaoSortField>('createdAt');
  protected readonly direction = signal<SortDirection>('asc');
  protected readonly unitDirection = signal<SortDirection>('asc');
  protected readonly incidentDirection = signal<SortDirection>('desc');
  protected readonly measurementDirection = signal<SortDirection>('desc');
  protected readonly latencyDirection = signal<SortDirection>('asc');
  protected readonly notificationDirection = signal<SortDirection>('desc');
  protected readonly page = signal(0);
  protected readonly size = signal<number>(20);
  protected readonly unitPageNumber = signal(0);
  protected readonly unitSize = signal<number>(20);
  protected readonly incidentPageNumber = signal(0);
  protected readonly incidentSize = signal<number>(20);
  protected readonly measurementPageNumber = signal(0);
  protected readonly measurementSize = signal<number>(50);
  protected readonly latencyPageNumber = signal(0);
  protected readonly latencySize = signal<number>(20);
  protected readonly notificationPageNumber = signal(0);
  protected readonly notificationSize = signal<number>(20);

  protected readonly sizes = sizes;
  protected readonly equipmentSorts = equipmentSorts;
  protected readonly unitSorts = unitSorts;
  protected readonly incidentSorts = incidentSorts;
  protected readonly measurementSorts = measurementSorts;
  protected readonly latencySorts = latencySorts;
  protected readonly notificationSorts = notificationSorts;
  protected readonly IncidentStatus = IncidentStatus;
  protected readonly MeasurementStatus = MeasurementStatus;
  protected readonly NotificationStatus = NotificationStatus;
  protected readonly NotificationChannel = NotificationChannel;
  protected readonly opcoesEvento = OPCOES_EVENTO_NOTIFICACAO;
  protected readonly rotuloEvento = rotuloEventoNotificacao;
  protected readonly formatDuration = formatDurationSeconds;

  constructor() { this.loadBaseLookups(); if (!this.applyQueryParams()) this.search(); }

  /**
   * Entrada por link: `/relatorios?aba=medicoes&equipamentoId=12` abre a aba pedida já
   * filtrada pelo equipamento — é o que o botão "Abrir histórico" do drawer de
   * equipamento promete. O filtro de equipamento pende do de unidade, então a unidade
   * é resolvida a partir do próprio cadastro antes de aplicar a seleção.
   *
   * Retorna `true` quando a busca inicial fica por conta da resolução assíncrona.
   */
  private applyQueryParams(): boolean {
    const params = this.route.snapshot.queryParamMap;
    const aba = params.get('aba');
    if (aba && TABS.includes(aba as Tab)) this.activeTab.set(aba as Tab);

    const equipamentoId = optionalId(params.get('equipamentoId') ?? '');
    const kind = this.kind();
    if (!equipamentoId || kind === 'notification') return false;

    const form = this.formFor(kind);
    this.equipamentosApi.getById(equipamentoId).pipe(take(1)).subscribe({
      next: equipamento => {
        form.patchValue({ unidadeId: String(equipamento.unidade.id) });
        form.controls.equipamentoId.enable({ emitEvent: false });
        this.equipamentosApi.list({ unidadeId: equipamento.unidade.id, ativo: true, size: 100 }).pipe(take(1)).subscribe({
          next: response => this.setEquipamentos(kind, response.content),
          error: error => this.lookupError.set(errorMessage(error, 'Não foi possível carregar os equipamentos da unidade.')),
        });
        form.patchValue({ equipamentoId: String(equipamentoId) });
        this.search();
      },
      // Link com equipamento inexistente não deve deixar a tela vazia: cai no relatório sem filtro.
      error: error => {
        this.lookupError.set(errorMessage(error, 'Não foi possível carregar o equipamento indicado no link.'));
        this.search();
      },
    });
    return true;
  }

  protected aoTeclarAba(evento: KeyboardEvent, indice: number) { navegarAbas(evento, indice, this.abas().map(r => r.nativeElement)); }
  protected selectTab(tab: Tab) { this.activeTab.set(tab); this.search(); }
  protected onUnidadeChange(kind: HierarchyKind) {
    const form = this.formFor(kind);
    form.patchValue({ equipamentoId: '', monitorId: '' });
    form.controls.monitorId.disable({ emitEvent: false });
    this.setEquipamentos(kind, []); this.setMonitores(kind, []);
    const id = optionalId(form.controls.unidadeId.value);
    if (id) {
      form.controls.equipamentoId.enable({ emitEvent: false });
      this.equipamentosApi.list({ unidadeId: id, ativo: true, size: 100 }).pipe(take(1)).subscribe({ next: response => this.setEquipamentos(kind, response.content), error: error => this.lookupError.set(errorMessage(error, 'Não foi possível carregar os equipamentos da unidade.')) });
    } else form.controls.equipamentoId.disable({ emitEvent: false });
    this.resetAndSearch(kind);
  }
  protected onEquipamentoChange(kind: HierarchyKind) {
    const form = this.formFor(kind);
    form.patchValue({ monitorId: '' }); this.setMonitores(kind, []);
    const id = optionalId(form.controls.equipamentoId.value);
    if (id) {
      form.controls.monitorId.enable({ emitEvent: false });
      this.monitoresApi.list({ equipamentoId: id, ativo: true, size: 100 }).pipe(take(1)).subscribe({ next: response => this.setMonitores(kind, response.content), error: error => this.lookupError.set(errorMessage(error, 'Não foi possível carregar os monitores do equipamento.')) });
    } else form.controls.monitorId.disable({ emitEvent: false });
    this.resetAndSearch(kind);
  }
  protected resetAndSearch(kind: HierarchyKind | 'notification' = this.kind()) { this.setPageNumber(kind, 0); this.search(); }
  protected search() {
    if (this.activeTab() === 'overview') {
      const period = this.validPeriod(this.overviewForm, 31);
      if (period) { this.periodError.set(null); this.loadOverview(period.inicio, period.fim); }
      return;
    }
    const kind = this.kind();
    const period = this.validPeriod(kind === 'notification' ? this.notificationForm : this.formFor(kind), this.periodLimit(kind));
    if (!period) return;
    this.periodError.set(null); this.error.set(null);
    switch (this.activeTab()) {
      case 'equipamentos': this.loadEquipment(period.inicio, period.fim); break;
      case 'unidades': this.loadUnits(period.inicio, period.fim); break;
      case 'incidentes': this.loadIncidents(period.inicio, period.fim); break;
      case 'medicoes': this.loadMeasurements(period.inicio, period.fim); break;
      case 'latencia': this.loadLatency(period.inicio, period.fim); break;
      case 'notificacoes': this.loadNotifications(period.inicio, period.fim); break;
    }
  }
  protected refresh() { this.search(); }
  protected isExporting() { const tab = this.activeTab(); return tab !== 'overview' && this.exporting()[tab]; }
  protected exportNotice() { const tab = this.activeTab(); return tab !== 'overview' ? this.exportNotices()[tab] : null; }
  protected exportCsv() {
    const tab = this.activeTab();
    if (tab === 'overview' || this.exporting()[tab]) return;
    const kind = this.kind();
    const period = this.validPeriod(kind === 'notification' ? this.notificationForm : this.formFor(kind), this.periodLimit(kind));
    if (!period) return;

    const { request, fallback } = this.exportRequest(tab, period.inicio, period.fim);
    this.setExporting(tab, true);
    this.setExportNotice(tab, null);
    request.pipe(take(1), finalize(() => this.setExporting(tab, false))).subscribe({
      next: response => {
        if (!response.body) {
          this.setExportNotice(tab, { message: 'O serviço não retornou um arquivo CSV.', error: true });
          return;
        }
        downloadCsvBlob(response.body, csvFilename(response.headers, fallback));
        this.setExportNotice(tab, { message: 'Download CSV iniciado.', error: false });
      },
      error: error => void apiErrorFromBlob(error).then(apiError => this.setExportNotice(tab, { message: exportErrorMessage(apiError), error: true })),
    });
  }
  protected exportPdf() {
    if (this.activeTab() !== 'overview' || this.pdfExporting()) return;
    const period = this.validPeriod(this.overviewForm, 31);
    if (!period) return;

    this.pdfExporting.set(true);
    this.pdfExportNotice.set(null);
    this.reportsApi.exportVisaoGeralPdf(period).pipe(
      take(1), finalize(() => this.pdfExporting.set(false)),
    ).subscribe({
      next: response => {
        if (!response.body || !isPdfContentType(response.headers)) {
          this.pdfExportNotice.set({ message: 'O serviço retornou um arquivo PDF inesperado.', error: true });
          return;
        }
        const fallback = fallbackPdfFilename(period.inicio, period.fim);
        downloadPdfBlob(response.body, pdfFilename(response.headers, fallback));
        this.pdfExportNotice.set({ message: 'Download PDF iniciado.', error: false });
      },
      error: error => void apiErrorFromBlob(error).then(apiError =>
        this.pdfExportNotice.set({ message: exportErrorMessage(apiError), error: true })),
    });
  }
  protected retryOverview(target: OverviewTarget) {
    const period = this.validPeriod(this.overviewForm, 31);
    if (period) this.loadOverviewWidget(target, period.inicio, period.fim, this.overviewGeneration);
  }
  protected setSort(value: string) {
    switch (this.activeTab()) {
      case 'equipamentos': this.equipmentSort.set(value as DisponibilidadeEquipamentoSortField); break;
      case 'unidades': this.unitSort.set(value as DisponibilidadeUnidadeSortField); break;
      case 'incidentes': this.incidentSort.set(value as HistoricoIncidenteSortField); break;
      case 'medicoes': this.measurementSort.set(value as HistoricoMedicaoSortField); break;
      case 'latencia': this.latencySort.set(value as LatenciaIcmpSortField); break;
      case 'notificacoes': this.notificationSort.set(value as HistoricoNotificacaoSortField); break;
    }
    this.resetAndSearch();
  }
  protected toggleDirection() { this.directionFor(this.activeTab()).update(value => value === 'asc' ? 'desc' : 'asc'); this.resetAndSearch(); }
  protected setSize(value: string) {
    const selected = Number(value); if (!sizes.includes(selected as typeof sizes[number])) return;
    switch (this.activeTab()) { case 'unidades': this.unitSize.set(selected); break; case 'incidentes': this.incidentSize.set(selected); break; case 'medicoes': this.measurementSize.set(selected); break; case 'latencia': this.latencySize.set(selected); break; case 'notificacoes': this.notificationSize.set(selected); break; default: this.size.set(selected); }
    this.resetAndSearch();
  }
  /** `mudarPagina` de <app-paginacao> chega 1-based e já clampado; aqui vira o delta que o estado por aba usa. */
  protected irParaPagina(pagina: number) { const delta = pagina - 1 - this.currentPageNumber(); if (delta === 0) return; this.changePage(delta); this.search(); }
  protected availability(value: number | null) { return formatarPercentual(value); }
  protected availabilityBar(value: number | null) { return value === null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, value)); }
  protected latency(value: number | null | undefined, average = false) { return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${average ? formatarDecimal(value) : value} ms`; }
  protected date(value: string | null) { if (!value) return '—'; const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(parsed); }
  protected errorText() { const error = this.error(); if (!error) return ''; if (error.status === 400) return 'A consulta não é válida. Revise o período e os filtros selecionados.'; if (error.status === 404) return 'Um recurso selecionado não foi encontrado. Atualize os filtros e tente novamente.'; if (error.status >= 500) return 'O serviço de relatórios apresentou uma falha. Tente atualizar em instantes.'; return error.message || 'Não foi possível carregar o relatório.'; }
  protected currentState() { return this.stateFor(this.activeTab())(); }
  protected currentResult(): PageResponse<unknown> | null { return this.pageFor(this.activeTab())(); }
  protected currentSort() { switch (this.activeTab()) { case 'overview': case 'equipamentos': return this.equipmentSort(); case 'unidades': return this.unitSort(); case 'incidentes': return this.incidentSort(); case 'medicoes': return this.measurementSort(); case 'latencia': return this.latencySort(); case 'notificacoes': return this.notificationSort(); } }
  protected currentSorts() { switch (this.activeTab()) { case 'overview': case 'equipamentos': return this.equipmentSorts; case 'unidades': return this.unitSorts; case 'incidentes': return this.incidentSorts; case 'medicoes': return this.measurementSorts; case 'latencia': return this.latencySorts; case 'notificacoes': return this.notificationSorts; } }
  protected currentDirection() { return this.directionFor(this.activeTab())(); }
  protected currentSize() { switch (this.activeTab()) { case 'unidades': return this.unitSize(); case 'incidentes': return this.incidentSize(); case 'medicoes': return this.measurementSize(); case 'latencia': return this.latencySize(); case 'notificacoes': return this.notificationSize(); default: return this.size(); } }

  private availabilityForm() { return this.fb.nonNullable.group({ inicio: localDateTime(-1), fim: localDateTime(0), unidadeId: '', equipamentoId: { value: '', disabled: true }, monitorId: { value: '', disabled: true }, tipoEquipamentoId: '' }); }
  private hierarchyHistoryForm() { return this.fb.nonNullable.group({ inicio: localDateTime(-24), fim: localDateTime(0), unidadeId: '', equipamentoId: { value: '', disabled: true }, monitorId: { value: '', disabled: true }, status: '' }); }
  private kind(): HierarchyKind | 'notification' { switch (this.activeTab()) { case 'incidentes': return 'incident'; case 'medicoes': return 'measurement'; case 'latencia': return 'latency'; case 'notificacoes': return 'notification'; default: return 'availability'; } }
  private periodLimit(kind: HierarchyKind | 'notification') { return kind === 'measurement' ? 31 : kind === 'latency' ? 90 : 365; }
  private formFor(kind: HierarchyKind) { return kind === 'availability' ? this.form : kind === 'incident' ? this.incidentForm : kind === 'measurement' ? this.measurementForm : this.latencyForm; }
  private setEquipamentos(kind: HierarchyKind, value: EquipamentoResponse[]) { (kind === 'availability' ? this.equipamentos : kind === 'incident' ? this.incidentEquipamentos : kind === 'measurement' ? this.measurementEquipamentos : this.latencyEquipamentos).set(value); }
  private setMonitores(kind: HierarchyKind, value: MonitorResponse[]) { (kind === 'availability' ? this.monitores : kind === 'incident' ? this.incidentMonitores : kind === 'measurement' ? this.measurementMonitores : this.latencyMonitores).set(value); }
  private loadBaseLookups() { this.unidadesApi.list(true).pipe(take(1)).subscribe({ next: response => this.unidades.set(response), error: error => this.lookupError.set(errorMessage(error, 'Não foi possível carregar as unidades.')) }); this.tiposApi.list(true).pipe(take(1)).subscribe({ next: response => this.tipos.set(response), error: error => this.lookupError.set(errorMessage(error, 'Não foi possível carregar os tipos de equipamento.')) }); }
  private loadEquipment(inicio: string, fim: string) { this.equipmentState.set('loading'); this.reportsApi.getDisponibilidadeEquipamentos({ inicio, fim, unidadeId: optionalId(this.form.controls.unidadeId.value), equipamentoId: optionalId(this.form.controls.equipamentoId.value), monitorId: optionalId(this.form.controls.monitorId.value), tipoEquipamentoId: optionalId(this.form.controls.tipoEquipamentoId.value), page: this.page(), size: this.size(), sort: { field: this.equipmentSort(), direction: this.direction() } }).pipe(take(1)).subscribe({ next: response => this.succeed('equipment', response), error: error => this.fail('equipment', error) }); }
  private loadUnits(inicio: string, fim: string) { this.unitState.set('loading'); this.reportsApi.getDisponibilidadeUnidades({ inicio, fim, unidadeId: optionalId(this.form.controls.unidadeId.value), page: this.unitPageNumber(), size: this.unitSize(), sort: { field: this.unitSort(), direction: this.unitDirection() } }).pipe(take(1)).subscribe({ next: response => this.succeed('unit', response), error: error => this.fail('unit', error) }); }
  private loadIncidents(inicio: string, fim: string) { const form = this.incidentForm.controls; this.incidentState.set('loading'); this.reportsApi.getIncidentes({ inicio, fim, unidadeId: optionalId(form.unidadeId.value), equipamentoId: optionalId(form.equipamentoId.value), monitorId: optionalId(form.monitorId.value), status: (form.status.value as IncidentStatus) || undefined, page: this.incidentPageNumber(), size: this.incidentSize(), sort: { field: this.incidentSort(), direction: this.incidentDirection() } }).pipe(take(1)).subscribe({ next: response => this.succeed('incident', response), error: error => this.fail('incident', error) }); }
  private loadMeasurements(inicio: string, fim: string) { const form = this.measurementForm.controls; this.measurementState.set('loading'); this.reportsApi.getMedicoes({ inicio, fim, unidadeId: optionalId(form.unidadeId.value), equipamentoId: optionalId(form.equipamentoId.value), monitorId: optionalId(form.monitorId.value), status: (form.status.value as MeasurementStatus) || undefined, page: this.measurementPageNumber(), size: this.measurementSize(), sort: { field: this.measurementSort(), direction: this.measurementDirection() } }).pipe(take(1)).subscribe({ next: response => this.succeed('measurement', response), error: error => this.fail('measurement', error) }); }
  private loadLatency(inicio: string, fim: string) { const form = this.latencyForm.controls; this.latencyState.set('loading'); this.reportsApi.getLatencia({ inicio, fim, unidadeId: optionalId(form.unidadeId.value), equipamentoId: optionalId(form.equipamentoId.value), monitorId: optionalId(form.monitorId.value), page: this.latencyPageNumber(), size: this.latencySize(), sort: { field: this.latencySort(), direction: this.latencyDirection() } }).pipe(take(1)).subscribe({ next: response => this.succeed('latency', response), error: error => this.fail('latency', error) }); }
  private loadNotifications(inicio: string, fim: string) { const form = this.notificationForm.controls; this.notificationState.set('loading'); this.reportsApi.getNotificacoes({ inicio, fim, incidenteId: optionalId(form.incidenteId.value), status: (form.status.value as NotificationStatus) || undefined, canal: (form.canal.value as NotificationChannel) || undefined, tipoEvento: (form.tipoEvento.value as NotificationEventType) || undefined, page: this.notificationPageNumber(), size: this.notificationSize(), sort: { field: this.notificationSort(), direction: this.notificationDirection() } }).pipe(take(1)).subscribe({ next: response => this.succeed('notification', response), error: error => this.fail('notification', error) }); }
  private exportRequest(tab: ExportTab, inicio: string, fim: string): { request: Observable<HttpResponse<Blob>>; fallback: string } {
    const availability = this.form.controls;
    const hierarchy = tab === 'incidentes' ? this.incidentForm.controls : tab === 'medicoes' ? this.measurementForm.controls : this.latencyForm.controls;
    let request: Observable<HttpResponse<Blob>>;
    switch (tab) {
      case 'equipamentos': request = this.reportsApi.exportDisponibilidadeEquipamentos({ inicio, fim, unidadeId: optionalId(availability.unidadeId.value), equipamentoId: optionalId(availability.equipamentoId.value), monitorId: optionalId(availability.monitorId.value), tipoEquipamentoId: optionalId(availability.tipoEquipamentoId.value), sort: { field: this.equipmentSort(), direction: this.direction() } }); break;
      case 'unidades': request = this.reportsApi.exportDisponibilidadeUnidades({ inicio, fim, unidadeId: optionalId(availability.unidadeId.value), sort: { field: this.unitSort(), direction: this.unitDirection() } }); break;
      case 'incidentes': request = this.reportsApi.exportIncidentes({ inicio, fim, unidadeId: optionalId(hierarchy.unidadeId.value), equipamentoId: optionalId(hierarchy.equipamentoId.value), monitorId: optionalId(hierarchy.monitorId.value), status: (hierarchy.status.value as IncidentStatus) || undefined, sort: { field: this.incidentSort(), direction: this.incidentDirection() } }); break;
      case 'medicoes': request = this.reportsApi.exportMedicoes({ inicio, fim, unidadeId: optionalId(hierarchy.unidadeId.value), equipamentoId: optionalId(hierarchy.equipamentoId.value), monitorId: optionalId(hierarchy.monitorId.value), status: (hierarchy.status.value as MeasurementStatus) || undefined, sort: { field: this.measurementSort(), direction: this.measurementDirection() } }); break;
      case 'latencia': request = this.reportsApi.exportLatencia({ inicio, fim, unidadeId: optionalId(hierarchy.unidadeId.value), equipamentoId: optionalId(hierarchy.equipamentoId.value), monitorId: optionalId(hierarchy.monitorId.value), sort: { field: this.latencySort(), direction: this.latencyDirection() } }); break;
      case 'notificacoes': {
        const notification = this.notificationForm.controls;
        request = this.reportsApi.exportNotificacoes({ inicio, fim, incidenteId: optionalId(notification.incidenteId.value), status: (notification.status.value as NotificationStatus) || undefined, canal: (notification.canal.value as NotificationChannel) || undefined, tipoEvento: (notification.tipoEvento.value as NotificationEventType) || undefined, sort: { field: this.notificationSort(), direction: this.notificationDirection() } });
        break;
      }
    }
    return { request, fallback: fallbackCsvFilename(reportPrefix(tab), inicio, fim) };
  }
  private setExporting(tab: ExportTab, value: boolean) { this.exporting.update(state => ({ ...state, [tab]: value })); }
  private setExportNotice(tab: ExportTab, value: ExportNotice | null) { this.exportNotices.update(state => ({ ...state, [tab]: value })); }
  private overviewGeneration = 0;
  private loadOverview(inicio: string, fim: string) {
    const generation = ++this.overviewGeneration;
    (Object.keys(this.overviewWidgets) as OverviewTarget[]).forEach(target => this.loadOverviewWidget(target, inicio, fim, generation));
  }
  private loadOverviewWidget(target: OverviewTarget, inicio: string, fim: string, generation: number) {
    const widget = this.overviewWidgets[target];
    widget.state.set('loading'); widget.error.set(null);
    // Os indicadores vêm prontos do servidor, da mesma query do PDF. Os rankings continuam
    // lendo `content` da lista paginada.
    const request = (target === 'indicators'
      ? this.reportsApi.getIndicadoresVisaoGeral({ inicio, fim })
      : target === 'units'
        ? this.reportsApi.getDisponibilidadeUnidades({ inicio, fim, page: 0, size: 5, sort: { field: 'disponibilidadePercentual', direction: 'asc' } })
        : target === 'equipment'
          ? this.reportsApi.getDisponibilidadeEquipamentos({ inicio, fim, page: 0, size: 5, sort: { field: 'disponibilidadePercentual', direction: 'asc' } })
          : this.reportsApi.getLatencia({ inicio, fim, page: 0, size: 5, sort: { field: 'avgLatenciaMs', direction: 'desc' } })) as Observable<PageResponse<unknown> | IndicadoresVisaoGeralResponse>;
    request.pipe(take(1)).subscribe({
      next: response => {
        if (generation !== this.overviewGeneration) return;
        const value = target === 'indicators' ? response as IndicadoresVisaoGeralResponse : (response as PageResponse<unknown>).content;
        widget.value.set(value as never);
        widget.state.set(Array.isArray(value) && value.length === 0 ? 'empty' : 'success');
      },
      error: error => {
        if (generation !== this.overviewGeneration) return;
        widget.error.set(overviewErrorMessage(error)); widget.state.set('error');
      },
    });
  }
  private succeed<T>(target: LoadTarget, response: PageResponse<T>) { this.pageFor(target).set(response as PageResponse<unknown>); this.stateFor(target).set(response.content.length ? 'success' : 'empty'); }
  private fail(target: LoadTarget, error: unknown) { this.error.set(apiErrorFrom(error)); this.stateFor(target).set('error'); }
  private validPeriod(form: { controls: { inicio: { value: string }; fim: { value: string } } }, days: number) { const inicio = form.controls.inicio.value, fim = form.controls.fim.value; if (!inicio || !fim) { this.periodError.set(!inicio ? 'Informe a data e hora inicial.' : 'Informe a data e hora final.'); return null; } const start = new Date(inicio), end = new Date(fim); if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || start > end) { this.periodError.set('A data inicial deve ser anterior ou igual à data final.'); return null; } if (end.valueOf() - start.valueOf() > days * 86400000) { this.periodError.set(`O período máximo permitido é de ${days} dias.`); return null; } return { inicio: start.toISOString(), fim: end.toISOString() }; }
  private stateFor(target: Tab | LoadTarget) { switch (target) { case 'overview': case 'equipamentos': case 'equipment': return this.equipmentState; case 'unidades': case 'unit': return this.unitState; case 'incidentes': case 'incident': return this.incidentState; case 'medicoes': case 'measurement': return this.measurementState; case 'latencia': case 'latency': return this.latencyState; case 'notificacoes': case 'notification': return this.notificationState; } }
  private pageFor(target: Tab | LoadTarget): ReturnType<typeof signal<PageResponse<unknown> | null>> { switch (target) { case 'overview': case 'equipamentos': case 'equipment': return this.equipmentPage; case 'unidades': case 'unit': return this.unitPage; case 'incidentes': case 'incident': return this.incidentPage; case 'medicoes': case 'measurement': return this.measurementPage; case 'latencia': case 'latency': return this.latencyPage; case 'notificacoes': case 'notification': return this.notificationPage; } }
  private directionFor(tab: Tab) { switch (tab) { case 'unidades': return this.unitDirection; case 'incidentes': return this.incidentDirection; case 'medicoes': return this.measurementDirection; case 'latencia': return this.latencyDirection; case 'notificacoes': return this.notificationDirection; default: return this.direction; } }
  private currentPageNumber() { switch (this.activeTab()) { case 'unidades': return this.unitPageNumber(); case 'incidentes': return this.incidentPageNumber(); case 'medicoes': return this.measurementPageNumber(); case 'latencia': return this.latencyPageNumber(); case 'notificacoes': return this.notificationPageNumber(); default: return this.page(); } }
  private setPageNumber(kind: HierarchyKind | 'notification', value: number) { if (kind === 'availability' && this.activeTab() === 'unidades') this.unitPageNumber.set(value); else if (kind === 'incident') this.incidentPageNumber.set(value); else if (kind === 'measurement') this.measurementPageNumber.set(value); else if (kind === 'latency') this.latencyPageNumber.set(value); else if (kind === 'notification') this.notificationPageNumber.set(value); else this.page.set(value); }
  private changePage(delta: number) { switch (this.activeTab()) { case 'unidades': this.unitPageNumber.update(value => value + delta); break; case 'incidentes': this.incidentPageNumber.update(value => value + delta); break; case 'medicoes': this.measurementPageNumber.update(value => value + delta); break; case 'latencia': this.latencyPageNumber.update(value => value + delta); break; case 'notificacoes': this.notificationPageNumber.update(value => value + delta); break; default: this.page.update(value => value + delta); } }
}

function optionalId(value: string) { const id = Number(value); return value && Number.isInteger(id) && id > 0 ? id : undefined; }
function localDateTime(hours: number) { const date = new Date(Date.now() + hours * 3600000); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); }
function errorMessage(error: unknown, fallback: string) { return error instanceof HttpErrorResponse && isApiError(error.error) ? error.error.message : fallback; }
function apiErrorFrom(error: unknown): ApiError { if (error instanceof HttpErrorResponse && isApiError(error.error)) return error.error; const status = error instanceof HttpErrorResponse ? error.status : 0; return { timestamp: new Date().toISOString(), status, error: 'Erro de consulta', code: status === 404 ? ApiErrorCode.ResourceNotFound : status === 400 ? ApiErrorCode.InvalidRequest : ApiErrorCode.InternalError, message: errorMessage(error, 'Não foi possível carregar os dados analíticos.'), path: '' }; }
function overviewWidget<T>(): OverviewWidget<T> { return { state: signal<LoadState>('loading'), value: signal<T | null>(null), error: signal<string | null>(null) }; }
function overviewErrorMessage(error: unknown) {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  if (status === 400) return 'Período inválido para este indicador.';
  if (status >= 500) return 'Serviço temporariamente indisponível.';
  return 'Não foi possível carregar este indicador.';
}

function emptyExportState<T>(value: T): Record<ExportTab, T> { return { equipamentos: value, unidades: value, incidentes: value, medicoes: value, latencia: value, notificacoes: value }; }
function reportPrefix(tab: ExportTab) { return tab === 'equipamentos' ? 'disponibilidade_equipamentos' : tab === 'unidades' ? 'disponibilidade_unidades' : tab; }
function exportErrorMessage(error: ApiError) {
  if (error.code === ApiErrorCode.ExportLimitExceeded || error.status === 422) return 'A exportação excede o limite permitido. Reduza o período ou aplique mais filtros.';
  if (error.status === 400) return 'A exportação não é válida. Revise o período, os filtros e a ordenação.';
  if (error.status === 401) return 'Sua sessão expirou. Entre novamente para exportar.';
  if (error.code === ApiErrorCode.PasswordChangeRequired) return 'Altere sua senha antes de exportar relatórios.';
  if (error.status === 403) return 'Você não tem permissão para exportar este relatório.';
  if (error.status === 404) return 'Um recurso selecionado não foi encontrado. Atualize os filtros e tente novamente.';
  if (error.status >= 500) return 'O serviço de exportação apresentou uma falha. Tente novamente em instantes.';
  return 'Não foi possível exportar o relatório.';
}

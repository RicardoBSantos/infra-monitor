import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin, take } from 'rxjs';
import { isApiError } from '../../core/models/api-error';
import { IncidentStatus } from '../../core/models/api-enums';
import { IncidenteListQuery, IncidenteResponse } from '../../core/models/incidente';
import { EquipamentoResponse } from '../../core/models/equipamento';
import { MonitorResponse } from '../../core/models/monitor';
import { UnidadeResponse } from '../../core/models/unidade';
import { EquipamentoApiService } from '../../core/services/equipamento-api.service';
import { IncidenteApiService } from '../../core/services/incidente-api.service';
import { MonitorApiService } from '../../core/services/monitor-api.service';
import { UnidadeApiService } from '../../core/services/unidade-api.service';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';

type State = 'loading' | 'success' | 'empty' | 'error'; type Sort = 'iniciadoEm,desc' | 'iniciadoEm,asc' | 'status,asc' | 'encerradoEm,desc' | 'id,desc';
@Component({ selector: 'app-incidente-list', imports: [DatePipe, StatusBadgeComponent], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './incidente-list.component.html', styleUrl: './incidente-list.component.scss' })
export class IncidenteListComponent {
  private readonly api = inject(IncidenteApiService); private readonly unitsApi = inject(UnidadeApiService); private readonly equipmentApi = inject(EquipamentoApiService); private readonly monitorsApi = inject(MonitorApiService); private readonly router = inject(Router);
  protected readonly page = signal<IncidenteResponse[]>([]); protected readonly unidades = signal<UnidadeResponse[]>([]); protected readonly equipamentos = signal<EquipamentoResponse[]>([]); protected readonly monitores = signal<MonitorResponse[]>([]); protected readonly state = signal<State>('loading'); protected readonly error = signal<string | null>(null); protected readonly lookupError = signal<string | null>(null);
  protected readonly pageNumber = signal(0); protected readonly pageSize = signal(20); protected readonly totalElements = signal(0); protected readonly totalPages = signal(0); protected readonly unidadeId = signal<number | undefined>(undefined); protected readonly equipamentoId = signal<number | undefined>(undefined); protected readonly monitorId = signal<number | undefined>(undefined); protected readonly status = signal<IncidentStatus | undefined>(undefined); protected readonly inicio = signal(''); protected readonly fim = signal(''); protected readonly sort = signal<Sort>('iniciadoEm,desc');
  constructor() { this.loadLookups(); this.load(); }
  protected load(): void { const query = this.query(); if (!query) return; this.state.set('loading'); this.error.set(null); this.api.list(query).pipe(take(1)).subscribe({ next: response => { this.page.set(response.content); this.pageNumber.set(response.page); this.pageSize.set(response.size); this.totalElements.set(response.totalElements); this.totalPages.set(response.totalPages); this.state.set(response.content.length ? 'success' : 'empty'); }, error: error => { this.error.set(messageFrom(error, 'Não foi possível carregar os incidentes.')); this.state.set('error'); } }); }
  private loadLookups(): void { forkJoin({ unidades: this.unitsApi.list(true), equipamentos: this.equipmentApi.list({ page: 0, size: 100, ativo: true, sort: 'nome,asc' }), monitores: this.monitorsApi.list({ page: 0, size: 100, ativo: true, sort: 'nome,asc' }) }).pipe(take(1)).subscribe({ next: result => { this.unidades.set(result.unidades); this.equipamentos.set(result.equipamentos.content); this.monitores.set(result.monitores.content); }, error: error => this.lookupError.set(messageFrom(error, 'Não foi possível carregar todas as opções de filtro.')) }); }
  protected setUnidade(value: string): void { this.unidadeId.set(numberOrUndefined(value)); this.equipamentoId.set(undefined); this.monitorId.set(undefined); this.loadEquipamentos(); this.changeFilters(); }
  protected setEquipamento(value: string): void { this.equipamentoId.set(numberOrUndefined(value)); this.monitorId.set(undefined); this.loadMonitores(); this.changeFilters(); }
  protected setMonitor(value: string): void { this.monitorId.set(numberOrUndefined(value)); this.changeFilters(); }
  protected setStatus(value: string): void { this.status.set(value === IncidentStatus.Open || value === IncidentStatus.Closed ? value : undefined); this.changeFilters(); }
  protected setInicio(value: string): void { this.inicio.set(value); this.changeFilters(); } protected setFim(value: string): void { this.fim.set(value); this.changeFilters(); } protected setSort(value: string): void { this.sort.set(value as Sort); this.changeFilters(); }
  private loadEquipamentos(): void { this.equipmentApi.list({ page: 0, size: 100, ativo: true, unidadeId: this.unidadeId(), sort: 'nome,asc' }).pipe(take(1)).subscribe({ next: response => this.equipamentos.set(response.content), error: error => this.lookupError.set(messageFrom(error, 'Não foi possível atualizar os equipamentos.')) }); }
  private loadMonitores(): void { this.monitorsApi.list({ page: 0, size: 100, ativo: true, equipamentoId: this.equipamentoId(), sort: 'nome,asc' }).pipe(take(1)).subscribe({ next: response => this.monitores.set(response.content), error: error => this.lookupError.set(messageFrom(error, 'Não foi possível atualizar os monitores.')) }); }
  protected changeFilters(): void { this.pageNumber.set(0); this.load(); } protected goToPage(page: number): void { if (page >= 0 && page < this.totalPages() && page !== this.pageNumber()) { this.pageNumber.set(page); this.load(); } } protected open(item: IncidenteResponse): void { this.router.navigate(['/incidentes', item.id]); }
  private query(): IncidenteListQuery | null { const inicio = toUtc(this.inicio()), fim = toUtc(this.fim()); if ((this.inicio() && !inicio) || (this.fim() && !fim)) { this.error.set('Informe datas e horários válidos.'); this.state.set('error'); return null; } if (inicio && fim && inicio > fim) { this.error.set('O início do período deve ser anterior ou igual ao fim.'); this.state.set('error'); return null; } return { page: this.pageNumber(), size: this.pageSize(), sort: this.sort(), unidadeId: this.unidadeId(), equipamentoId: this.equipamentoId(), monitorId: this.monitorId(), status: this.status(), inicio, fim }; }
}
function numberOrUndefined(value: string): number | undefined { const number = Number(value); return value && Number.isInteger(number) && number > 0 ? number : undefined; } function toUtc(value: string): string | undefined { if (!value) return undefined; const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date.toISOString(); } function messageFrom(error: unknown, fallback: string): string { return error instanceof HttpErrorResponse && isApiError(error.error) ? error.error.message : fallback; }

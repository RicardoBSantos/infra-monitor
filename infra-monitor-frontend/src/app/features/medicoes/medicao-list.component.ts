import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { take } from 'rxjs';
import { plural } from '../../core/format/plural';
import { isApiError } from '../../core/models/api-error';
import { MeasurementStatus } from '../../core/models/api-enums';
import { MedicaoListQuery, MedicaoResponse } from '../../core/models/medicao';
import { MonitorResponse } from '../../core/models/monitor';
import { MedicaoApiService } from '../../core/services/medicao-api.service';
import { MonitorApiService } from '../../core/services/monitor-api.service';
import { PaginacaoComponent } from '../../shared/paginacao/paginacao.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';

type State = 'loading' | 'success' | 'empty' | 'error';
type Sort = 'executadoEm,desc' | 'executadoEm,asc' | 'latenciaMs,desc' | 'latenciaMs,asc' | 'status,asc' | 'id,desc';
@Component({ selector: 'app-medicao-list', imports: [DatePipe, PaginacaoComponent, StatusBadgeComponent], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './medicao-list.component.html', styleUrl: './medicao-list.component.scss' })
export class MedicaoListComponent {
  protected readonly plural = plural;
  private readonly api = inject(MedicaoApiService); private readonly monitorsApi = inject(MonitorApiService);
  protected readonly page = signal<MedicaoResponse[]>([]); protected readonly monitors = signal<MonitorResponse[]>([]); protected readonly state = signal<State>('loading'); protected readonly error = signal<string | null>(null); protected readonly lookupError = signal<string | null>(null);
  protected readonly pageNumber = signal(0); protected readonly pageSize = signal(50); protected readonly totalElements = signal(0); protected readonly totalPages = signal(0); protected readonly monitorId = signal<number | undefined>(undefined); protected readonly status = signal<MeasurementStatus | undefined>(undefined); protected readonly inicio = signal(''); protected readonly fim = signal(''); protected readonly sort = signal<Sort>('executadoEm,desc');
  constructor() { this.loadLookups(); this.load(); }
  protected load(): void { const query = this.query(); if (!query) return; this.state.set('loading'); this.error.set(null); this.api.list(query).pipe(take(1)).subscribe({ next: response => { this.page.set(response.content); this.pageNumber.set(response.page); this.pageSize.set(response.size); this.totalElements.set(response.totalElements); this.totalPages.set(response.totalPages); this.state.set(response.content.length ? 'success' : 'empty'); }, error: error => { this.error.set(messageFrom(error, 'Não foi possível carregar as medições.')); this.state.set('error'); } }); }
  private loadLookups(): void { this.monitorsApi.list({ page: 0, size: 100, sort: 'nome,asc' }).pipe(take(1)).subscribe({ next: response => this.monitors.set(response.content), error: error => this.lookupError.set(messageFrom(error, 'Não foi possível carregar os monitores disponíveis.')) }); }
  protected setMonitor(value: string): void { this.monitorId.set(numberOrUndefined(value)); this.changeFilters(); }
  protected setStatus(value: string): void { this.status.set(value === MeasurementStatus.Success || value === MeasurementStatus.Failure ? value : undefined); this.changeFilters(); }
  protected setInicio(value: string): void { this.inicio.set(value); this.changeFilters(); }
  protected setFim(value: string): void { this.fim.set(value); this.changeFilters(); }
  protected setSort(value: string): void { this.sort.set(value as Sort); this.changeFilters(); }
  protected changeFilters(): void { this.pageNumber.set(0); this.load(); }
  protected goToPage(page: number): void { if (page >= 0 && page < this.totalPages() && page !== this.pageNumber()) { this.pageNumber.set(page); this.load(); } }
  private query(): MedicaoListQuery | null { const inicio = toUtc(this.inicio()), fim = toUtc(this.fim()); if ((this.inicio() && !inicio) || (this.fim() && !fim)) { this.error.set('Informe datas e horários válidos.'); this.state.set('error'); return null; } if (inicio && fim && inicio > fim) { this.error.set('O início do período deve ser anterior ou igual ao fim.'); this.state.set('error'); return null; } return { page: this.pageNumber(), size: this.pageSize(), sort: this.sort(), monitorId: this.monitorId(), status: this.status(), inicio, fim }; }
}
function numberOrUndefined(value: string): number | undefined { const number = Number(value); return value && Number.isInteger(number) && number > 0 ? number : undefined; }
function toUtc(value: string): string | undefined { if (!value) return undefined; const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date.toISOString(); }
function messageFrom(error: unknown, fallback: string): string { return error instanceof HttpErrorResponse && isApiError(error.error) ? error.error.message : fallback; }

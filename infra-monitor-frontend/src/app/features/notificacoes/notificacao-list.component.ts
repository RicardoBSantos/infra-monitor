import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { take } from 'rxjs';
import { plural } from '../../core/format/plural';
import { isApiError } from '../../core/models/api-error';
import { NotificationChannel, NotificationEventType, NotificationStatus } from '../../core/models/api-enums';
import { NotificacaoListQuery, NotificacaoResponse } from '../../core/models/notificacao';
import { NotificacaoApiService } from '../../core/services/notificacao-api.service';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';

const ROTULOS_EVENTO: Record<NotificationEventType, string> = {
  [NotificationEventType.IncidentOpened]: 'Incidente aberto',
  [NotificationEventType.IncidentClosed]: 'Incidente fechado',
  [NotificationEventType.HighLatency]: 'Latência alta',
  [NotificationEventType.LatencyNormalized]: 'Latência normalizada',
  [NotificationEventType.IncidentClosedByMaintenance]: 'Incidente encerrado por manutenção',
  [NotificationEventType.LatencyClosedByMaintenance]: 'Latência encerrada por manutenção',
};
type State = 'loading' | 'success' | 'empty' | 'error'; type Sort = 'createdAt,desc' | 'createdAt,asc' | 'enviadoEm,desc' | 'status,asc' | 'tentativas,desc' | 'id,desc';
@Component({ selector: 'app-notificacao-list', imports: [DatePipe, RouterLink, StatusBadgeComponent], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './notificacao-list.component.html', styleUrl: './notificacao-list.component.scss' })
export class NotificacaoListComponent {
  protected readonly plural = plural;
  private readonly api = inject(NotificacaoApiService); private readonly router = inject(Router);
  protected readonly page = signal<NotificacaoResponse[]>([]); protected readonly state = signal<State>('loading'); protected readonly error = signal<string | null>(null);
  protected readonly pageNumber = signal(0); protected readonly pageSize = signal(20); protected readonly totalElements = signal(0); protected readonly totalPages = signal(0); protected readonly incidenteId = signal<number | undefined>(undefined); protected readonly status = signal<NotificationStatus | undefined>(undefined); protected readonly canal = signal<NotificationChannel | undefined>(undefined); protected readonly tipoEvento = signal<NotificationEventType | undefined>(undefined); protected readonly inicio = signal(''); protected readonly fim = signal(''); protected readonly sort = signal<Sort>('createdAt,desc');
  constructor() { this.load(); }
  protected load(): void { const query = this.query(); if (!query) return; this.state.set('loading'); this.error.set(null); this.api.list(query).pipe(take(1)).subscribe({ next: response => { this.page.set(response.content); this.pageNumber.set(response.page); this.pageSize.set(response.size); this.totalElements.set(response.totalElements); this.totalPages.set(response.totalPages); this.state.set(response.content.length ? 'success' : 'empty'); }, error: error => { this.error.set(messageFrom(error, 'Não foi possível carregar as notificações.')); this.state.set('error'); } }); }
  protected setIncidente(value: string): void { this.incidenteId.set(numberOrUndefined(value)); this.changeFilters(); } protected setStatus(value: string): void { this.status.set(isStatus(value) ? value : undefined); this.changeFilters(); } protected setCanal(value: string): void { this.canal.set(value === NotificationChannel.Telegram ? value : undefined); this.changeFilters(); } protected setTipoEvento(value: string): void { this.tipoEvento.set(isEvent(value) ? value : undefined); this.changeFilters(); } protected setInicio(value: string): void { this.inicio.set(value); this.changeFilters(); } protected setFim(value: string): void { this.fim.set(value); this.changeFilters(); } protected setSort(value: string): void { this.sort.set(value as Sort); this.changeFilters(); }
  protected rotuloEvento(tipo: NotificationEventType): string { return ROTULOS_EVENTO[tipo] ?? tipo; }
  protected changeFilters(): void { this.pageNumber.set(0); this.load(); } protected goToPage(page: number): void { if (page >= 0 && page < this.totalPages() && page !== this.pageNumber()) { this.pageNumber.set(page); this.load(); } } protected open(item: NotificacaoResponse): void { this.router.navigate(['/notificacoes', 'detalhe', item.id]); }
  private query(): NotificacaoListQuery | null { const inicio = toUtc(this.inicio()), fim = toUtc(this.fim()); if ((this.inicio() && !inicio) || (this.fim() && !fim)) return this.invalidPeriod('Informe datas e horários válidos.'); if (inicio && fim && inicio > fim) return this.invalidPeriod('O início do período deve ser anterior ou igual ao fim.'); return { page: this.pageNumber(), size: this.pageSize(), sort: this.sort(), incidenteId: this.incidenteId(), status: this.status(), canal: this.canal(), tipoEvento: this.tipoEvento(), inicio, fim }; }
  private invalidPeriod(message: string): null { this.error.set(message); this.state.set('error'); return null; }
}
function numberOrUndefined(value: string): number | undefined { const number = Number(value); return value && Number.isInteger(number) && number > 0 ? number : undefined; } function toUtc(value: string): string | undefined { if (!value) return undefined; const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date.toISOString(); } function isStatus(value: string): value is NotificationStatus { return Object.values(NotificationStatus).includes(value as NotificationStatus); } function isEvent(value: string): value is NotificationEventType { return Object.values(NotificationEventType).includes(value as NotificationEventType); } function messageFrom(error: unknown, fallback: string): string { return error instanceof HttpErrorResponse && isApiError(error.error) ? error.error.message : fallback; }

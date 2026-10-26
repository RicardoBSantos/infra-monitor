import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { take } from 'rxjs';
import { ApiErrorCode, isApiError } from '../../core/models/api-error';
import { NotificationEventType } from '../../core/models/api-enums';
import { rotuloEventoNotificacao } from '../../core/models/rotulos-notificacao';
import { NotificacaoResponse } from '../../core/models/notificacao';
import { NotificacaoApiService } from '../../core/services/notificacao-api.service';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
type State = 'loading' | 'success' | 'error' | 'not-found';
@Component({ selector: 'app-notificacao-detail', imports: [DatePipe, RouterLink, StatusBadgeComponent], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './notificacao-detail.component.html', styleUrl: './notificacao-detail.component.scss' })
export class NotificacaoDetailComponent { private readonly api = inject(NotificacaoApiService); private readonly route = inject(ActivatedRoute); private id = 0; protected readonly item = signal<NotificacaoResponse | null>(null); protected readonly state = signal<State>('loading'); protected readonly error = signal<string | null>(null); constructor() { const id = Number(this.route.snapshot.paramMap.get('id')); if (!Number.isInteger(id) || id < 1) { this.state.set('not-found'); return; } this.load(id); } protected rotuloEvento(tipo: NotificationEventType): string { return rotuloEventoNotificacao(tipo); } protected load(id = this.id): void { if (!id) return; this.id = id; this.state.set('loading'); this.error.set(null); this.api.getById(id).pipe(take(1)).subscribe({ next: item => { this.item.set(item); this.state.set('success'); }, error: error => { if (hasCode(error, ApiErrorCode.ResourceNotFound)) this.state.set('not-found'); else { this.error.set(messageFrom(error, 'Não foi possível carregar a notificação.')); this.state.set('error'); } } }); } }
function hasCode(error: unknown, code: ApiErrorCode): boolean { return error instanceof HttpErrorResponse && isApiError(error.error) && error.error.code === code; } function messageFrom(error: unknown, fallback: string): string { return error instanceof HttpErrorResponse && isApiError(error.error) ? error.error.message : fallback; }

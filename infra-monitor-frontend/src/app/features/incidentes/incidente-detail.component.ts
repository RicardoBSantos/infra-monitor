import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { take } from 'rxjs';
import { ApiErrorCode, isApiError } from '../../core/models/api-error';
import { IncidentStatus } from '../../core/models/api-enums';
import { IncidenteResponse } from '../../core/models/incidente';
import { IncidenteApiService } from '../../core/services/incidente-api.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { AuthStateService } from '../../core/services/auth-state.service';

type State = 'loading' | 'success' | 'error' | 'not-found';
@Component({ selector: 'app-incidente-detail', imports: [DatePipe, RouterLink, ConfirmDialogComponent, StatusBadgeComponent], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './incidente-detail.component.html', styleUrl: './incidente-detail.component.scss' })
export class IncidenteDetailComponent {
  private readonly api = inject(IncidenteApiService); private readonly route = inject(ActivatedRoute); protected readonly authState = inject(AuthStateService);
  protected readonly item = signal<IncidenteResponse | null>(null); protected readonly state = signal<State>('loading'); protected readonly error = signal<string | null>(null); protected readonly closing = signal(false); protected readonly confirmClose = signal(false);
  constructor() { const id = Number(this.route.snapshot.paramMap.get('id')); if (!Number.isInteger(id) || id < 1) { this.state.set('not-found'); return; } this.load(id); }
  protected load(id = this.item()?.id, notice?: string): void { if (!id) return; this.state.set('loading'); this.error.set(notice ?? null); this.api.getById(id).pipe(take(1)).subscribe({ next: item => { this.item.set(item); this.state.set('success'); }, error: error => { if (hasCode(error, ApiErrorCode.ResourceNotFound)) this.state.set('not-found'); else { this.error.set(messageFrom(error, 'Não foi possível carregar o incidente.')); this.state.set('error'); } } }); }
  protected close(): void { const item = this.item(); if (!item || item.status !== IncidentStatus.Open || this.closing()) return; this.closing.set(true); this.error.set(null); this.api.close(item.id, { encerradoEm: new Date().toISOString(), observacao: null }).pipe(take(1)).subscribe({ next: updated => { this.item.set(updated); this.closing.set(false); this.confirmClose.set(false); }, error: error => { this.closing.set(false); this.confirmClose.set(false); this.load(item.id, closeMessage(error)); } }); }
}
function hasCode(error: unknown, code: ApiErrorCode): boolean { return error instanceof HttpErrorResponse && isApiError(error.error) && error.error.code === code; } function messageFrom(error: unknown, fallback: string): string { return error instanceof HttpErrorResponse && isApiError(error.error) ? error.error.message : fallback; } function closeMessage(error: unknown): string { if (hasCode(error, ApiErrorCode.BusinessConflict)) return 'O incidente foi alterado no servidor. O estado atual foi recarregado.'; if (hasCode(error, ApiErrorCode.ResourceNotFound)) return 'O incidente não está mais disponível.'; return messageFrom(error, 'Não foi possível fechar o incidente. O estado atual foi recarregado.'); }

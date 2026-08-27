import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { take } from 'rxjs';
import { isApiError } from '../../core/models/api-error';
import { TipoEquipamentoResponse } from '../../core/models/tipo-equipamento';
import { TipoEquipamentoApiService } from '../../core/services/tipo-equipamento-api.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { AuthStateService } from '../../core/services/auth-state.service';
type State = 'loading' | 'success' | 'empty' | 'error'; type Filter = 'all' | 'active' | 'inactive';
@Component({ selector: 'app-tipo-equipamento-list', imports: [ReactiveFormsModule, ConfirmDialogComponent], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './tipo-equipamento-list.component.html', styleUrl: '../unidades/admin-list.component.scss' })
export class TipoEquipamentoListComponent {
  private readonly api = inject(TipoEquipamentoApiService); private readonly fb = inject(FormBuilder); protected readonly authState = inject(AuthStateService);
  protected readonly items = signal<TipoEquipamentoResponse[]>([]); protected readonly state = signal<State>('loading'); protected readonly filter = signal<Filter>('all'); protected readonly error = signal<string | null>(null); protected readonly notice = signal<string | null>(null); protected readonly editing = signal<TipoEquipamentoResponse | null | undefined>(undefined); protected readonly saving = signal(false); protected readonly deleting = signal<TipoEquipamentoResponse | null>(null); protected readonly deleteBusy = signal(false); protected readonly actingId = signal<number | null>(null);
  protected readonly form = this.fb.nonNullable.group({ nome: ['', [Validators.required, Validators.maxLength(150)]], descricao: ['', Validators.maxLength(1000)] });
  constructor() { this.load(); }
  protected load(): void { this.state.set('loading'); this.error.set(null); this.api.list(this.filter() === 'all' ? undefined : this.filter() === 'active').pipe(take(1)).subscribe({ next: items => { this.items.set(items); this.state.set(items.length ? 'success' : 'empty'); }, error: e => { this.error.set(messageFrom(e, 'Não foi possível carregar os tipos.')); this.state.set('error'); } }); }
  protected setFilter(filter: Filter): void { if (this.filter() !== filter) { this.filter.set(filter); this.load(); } }
  protected openCreate(): void { this.notice.set(null); this.editing.set(null); this.form.reset({ nome: '', descricao: '' }); }
  protected openEdit(item: TipoEquipamentoResponse): void { this.notice.set(null); this.editing.set(item); this.form.reset({ nome: item.nome, descricao: item.descricao ?? '' }); }
  protected closeForm(): void { if (!this.saving()) this.editing.set(undefined); }
  protected submit(): void { if (this.saving()) return; if (this.form.invalid) { this.form.markAllAsTouched(); return; } this.saving.set(true); this.error.set(null); const value = this.form.getRawValue(); const body = { ...value, descricao: value.descricao.trim() || null }; const current = this.editing(); const request = current ? this.api.update(current.id, body) : this.api.create(body); request.pipe(take(1)).subscribe({ next: () => { this.saving.set(false); this.editing.set(undefined); this.notice.set(current ? 'Tipo atualizado com sucesso.' : 'Tipo criado com sucesso.'); this.load(); }, error: e => { this.saving.set(false); this.applyFormError(e); } }); }
  protected toggle(item: TipoEquipamentoResponse): void { if (this.actingId() !== null) return; this.actingId.set(item.id); this.error.set(null); (item.ativo ? this.api.deactivate(item.id) : this.api.activate(item.id)).pipe(take(1)).subscribe({ next: updated => { this.actingId.set(null); this.items.update(items => items.map(x => x.id === updated.id ? updated : x)); this.notice.set(`Tipo ${updated.ativo ? 'ativado' : 'desativado'} com sucesso.`); }, error: e => { this.actingId.set(null); this.error.set(messageFrom(e, 'Não foi possível alterar o tipo.')); } }); }
  protected confirmDelete(item: TipoEquipamentoResponse): void { this.deleting.set(item); }
  protected delete(): void { const item = this.deleting(); if (!item || this.deleteBusy()) return; this.deleteBusy.set(true); this.api.delete(item.id).pipe(take(1)).subscribe({ next: () => { this.deleteBusy.set(false); this.deleting.set(null); this.notice.set('Tipo excluído com sucesso.'); this.load(); }, error: e => { this.deleteBusy.set(false); this.deleting.set(null); this.error.set(messageFrom(e, 'Não foi possível excluir o tipo.')); } }); }
  private applyFormError(error: HttpErrorResponse): void { const apiError = isApiError(error.error) ? error.error : null; if (apiError?.fields) for (const [field, message] of Object.entries(apiError.fields)) { const control = this.form.get(field); if (control) control.setErrors({ backend: message }); } this.error.set(apiError?.message ?? messageFrom(error, 'Não foi possível salvar o tipo.')); }
}
function messageFrom(error: unknown, fallback: string): string { return error instanceof HttpErrorResponse && isApiError(error.error) ? error.error.message : fallback; }

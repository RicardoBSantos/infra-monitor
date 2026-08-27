import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { take } from 'rxjs';
import { ApiError, ApiErrorCode, isApiError } from '../../core/models/api-error';
import { UnidadeResponse } from '../../core/models/unidade';
import { GeoMunicipioService, Municipio, normalizeCodigoIbge } from '../../core/services/geo-municipio.service';
import { AuthStateService } from '../../core/services/auth-state.service';
import { UnidadeApiService } from '../../core/services/unidade-api.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';

type State = 'loading' | 'success' | 'empty' | 'error'; type Filter = 'all' | 'active' | 'inactive';
@Component({ selector: 'app-unidade-list', imports: [ReactiveFormsModule, ConfirmDialogComponent], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './unidade-list.component.html', styleUrl: './admin-list.component.scss' })
export class UnidadeListComponent {
  private readonly api = inject(UnidadeApiService); private readonly geoMunicipio = inject(GeoMunicipioService); private readonly fb = inject(FormBuilder); protected readonly authState = inject(AuthStateService);
  protected readonly items = signal<UnidadeResponse[]>([]); protected readonly state = signal<State>('loading'); protected readonly filter = signal<Filter>('all'); protected readonly error = signal<string | null>(null); protected readonly notice = signal<string | null>(null); protected readonly editing = signal<UnidadeResponse | null | undefined>(undefined); protected readonly saving = signal(false); protected readonly deleting = signal<UnidadeResponse | null>(null); protected readonly deleteBusy = signal(false); protected readonly actingId = signal<number | null>(null);
  protected readonly municipios = signal<Municipio[]>([]); protected readonly municipiosLoading = signal(true); protected readonly municipiosError = signal<string | null>(null);
  protected readonly form = this.fb.nonNullable.group({ nome: ['', [Validators.required, Validators.maxLength(150)]], sigla: ['', [Validators.required, Validators.maxLength(30)]], descricao: [''], codigoIbge: [''] });
  constructor() { this.load(); this.loadMunicipios(); }
  private loadMunicipios(): void { this.municipiosLoading.set(true); this.municipiosError.set(null); this.geoMunicipio.getMunicipios().pipe(take(1)).subscribe({ next: municipios => { this.municipios.set(municipios); this.municipiosLoading.set(false); }, error: () => { this.municipiosError.set('Não foi possível carregar os municípios.'); this.municipiosLoading.set(false); } }); }
  protected load(): void { this.state.set('loading'); this.error.set(null); this.api.list(this.filter() === 'all' ? undefined : this.filter() === 'active').pipe(take(1)).subscribe({ next: items => { this.items.set(items); this.state.set(items.length ? 'success' : 'empty'); }, error: e => { this.error.set(messageFrom(e, 'Não foi possível carregar as unidades.')); this.state.set('error'); } }); }
  protected setFilter(filter: Filter): void { if (this.filter() !== filter) { this.filter.set(filter); this.load(); } }
  protected openCreate(): void { this.notice.set(null); this.editing.set(null); this.form.reset({ nome: '', sigla: '', descricao: '', codigoIbge: '' }); }
  protected openEdit(item: UnidadeResponse): void { this.notice.set(null); this.editing.set(item); this.form.reset({ nome: item.nome, sigla: item.sigla, descricao: item.descricao ?? '', codigoIbge: item.codigoIbge ?? '' }); }
  protected codigoIbgeInvalido(): boolean { const codigo = this.form.controls.codigoIbge.value; return !!codigo && !this.municipios().some(municipio => municipio.codigoIbge === normalizeCodigoIbge(codigo)); }
  protected closeForm(): void { if (!this.saving()) this.editing.set(undefined); }
  protected submit(): void { if (this.saving()) return; if (this.form.invalid) { this.form.markAllAsTouched(); return; } this.saving.set(true); this.error.set(null); const value = this.form.getRawValue(); const body = { ...value, descricao: value.descricao.trim() || null, codigoIbge: normalizeCodigoIbge(value.codigoIbge) || null }; const current = this.editing(); const request = current ? this.api.update(current.id, body) : this.api.create(body); request.pipe(take(1)).subscribe({ next: () => { this.saving.set(false); this.editing.set(undefined); this.notice.set(current ? 'Unidade atualizada com sucesso.' : 'Unidade criada com sucesso.'); this.load(); }, error: e => { this.saving.set(false); this.applyFormError(e); } }); }
  protected toggle(item: UnidadeResponse): void { if (this.actingId() !== null) return; this.actingId.set(item.id); this.error.set(null); (item.ativo ? this.api.deactivate(item.id) : this.api.activate(item.id)).pipe(take(1)).subscribe({ next: updated => { this.actingId.set(null); this.items.update(items => items.map(x => x.id === updated.id ? updated : x)); this.notice.set(`Unidade ${updated.ativo ? 'ativada' : 'desativada'} com sucesso.`); }, error: e => { this.actingId.set(null); this.error.set(messageFrom(e, 'Não foi possível alterar a unidade.')); } }); }
  protected confirmDelete(item: UnidadeResponse): void { this.deleting.set(item); }
  protected delete(): void { const item = this.deleting(); if (!item || this.deleteBusy()) return; this.deleteBusy.set(true); this.api.delete(item.id).pipe(take(1)).subscribe({ next: () => { this.deleteBusy.set(false); this.deleting.set(null); this.notice.set('Unidade excluída com sucesso.'); this.load(); }, error: e => { this.deleteBusy.set(false); this.deleting.set(null); this.error.set(messageFrom(e, 'Não foi possível excluir a unidade.')); } }); }
  private applyFormError(error: HttpErrorResponse): void { const apiError = isApiError(error.error) ? error.error : null; if (apiError?.fields) for (const [field, message] of Object.entries(apiError.fields)) { const control = this.form.get(field); if (control) control.setErrors({ backend: message }); } this.error.set(apiError?.message ?? messageFrom(error, 'Não foi possível salvar a unidade.')); }
}
function messageFrom(error: unknown, fallback: string): string { return error instanceof HttpErrorResponse && isApiError(error.error) ? error.error.message : fallback; }

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { take } from 'rxjs';
import { plural } from '../../core/format/plural';
import { ApiErrorCode, isApiError } from '../../core/models/api-error';
import { MonitorType } from '../../core/models/api-enums';
import { EquipamentoResponse } from '../../core/models/equipamento';
import { MonitorCreateRequest, MonitorListQuery, MonitorResponse } from '../../core/models/monitor';
import { EquipamentoApiService } from '../../core/services/equipamento-api.service';
import { MonitorApiService } from '../../core/services/monitor-api.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { ModalComponent } from '../../shared/modal/modal.component';
import { PaginacaoComponent } from '../../shared/paginacao/paginacao.component';
import { AuthStateService } from '../../core/services/auth-state.service';

type State = 'loading' | 'success' | 'empty' | 'error';
type ActiveFilter = '' | 'true' | 'false';
type Sort = 'nome,asc' | 'nome,desc' | 'tipo,asc' | 'intervaloSegundos,asc' | 'timeoutMs,asc' | 'ativo,desc' | 'createdAt,desc';

@Component({
  selector: 'app-monitor-management',
  imports: [ReactiveFormsModule, ConfirmDialogComponent, ModalComponent, PaginacaoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './monitor-management.component.html',
  styleUrl: './monitor-management.component.scss',
})
export class MonitorManagementComponent implements OnInit {
  protected readonly plural = plural;
  protected readonly authState = inject(AuthStateService);
  readonly equipamentoContextId = input<number | undefined>();
  private readonly api = inject(MonitorApiService); private readonly equipamentosApi = inject(EquipamentoApiService); private readonly fb = inject(FormBuilder);
  protected readonly page = signal<MonitorResponse[]>([]); protected readonly state = signal<State>('loading'); protected readonly error = signal<string | null>(null); protected readonly notice = signal<string | null>(null);
  protected readonly equipamentos = signal<EquipamentoResponse[]>([]); protected readonly lookupError = signal<string | null>(null);
  protected readonly pageNumber = signal(0); protected readonly pageSize = signal(20); protected readonly totalElements = signal(0); protected readonly totalPages = signal(0);
  protected readonly equipamentoId = signal<number | undefined>(undefined); protected readonly tipo = signal<MonitorType | undefined>(undefined); protected readonly ativo = signal<ActiveFilter>(''); protected readonly sort = signal<Sort>('nome,asc');
  protected readonly editing = signal<MonitorResponse | null | undefined>(undefined); protected readonly saving = signal(false); protected readonly deleting = signal<MonitorResponse | null>(null); protected readonly deleteBusy = signal(false); protected readonly actingId = signal<number | null>(null);
  protected readonly form = this.fb.nonNullable.group({ equipamentoId: [0, [Validators.min(1)]], tipo: [MonitorType.Icmp, [Validators.required]], nome: ['', [Validators.required, Validators.maxLength(150)]], intervaloSegundos: [60, [Validators.required, Validators.min(10), Validators.max(86400)]], timeoutMs: [2000, [Validators.required, Validators.min(100), Validators.max(60000)]], falhasParaIncidente: [3, [Validators.min(1), Validators.max(100)]], sucessosParaRecovery: [2, [Validators.min(1), Validators.max(100)]] });

  ngOnInit(): void { this.equipamentoId.set(this.equipamentoContextId()); this.loadLookups(); this.load(); }
  protected load(): void { this.state.set('loading'); this.error.set(null); this.api.list(this.query()).pipe(take(1)).subscribe({ next: response => { this.page.set(response.content); this.pageNumber.set(response.page); this.pageSize.set(response.size); this.totalElements.set(response.totalElements); this.totalPages.set(response.totalPages); this.state.set(response.content.length ? 'success' : 'empty'); }, error: error => { this.error.set(messageFrom(error, 'Não foi possível carregar os monitores.')); this.state.set('error'); } }); }
  private loadLookups(): void { this.equipamentosApi.list({ ativo: true, page: 0, size: 100, sort: 'nome,asc' }).pipe(take(1)).subscribe({ next: response => this.equipamentos.set(response.content), error: error => this.lookupError.set(messageFrom(error, 'Não foi possível carregar os equipamentos disponíveis.')) }); }
  protected changeFilters(): void { this.pageNumber.set(0); this.load(); }
  protected setEquipamento(value: string): void { this.equipamentoId.set(numberOrUndefined(value)); this.changeFilters(); }
  protected setTipo(value: string): void { this.tipo.set(value === MonitorType.Icmp ? MonitorType.Icmp : undefined); this.changeFilters(); }
  protected setAtivo(value: string): void { this.ativo.set(value as ActiveFilter); this.changeFilters(); }
  protected setSort(value: string): void { this.sort.set(value as Sort); this.pageNumber.set(0); this.load(); }
  protected goToPage(page: number): void { if (page >= 0 && page < this.totalPages() && page !== this.pageNumber()) { this.pageNumber.set(page); this.load(); } }
  protected openCreate(): void { this.notice.set(null); this.editing.set(null); this.form.reset({ equipamentoId: this.equipamentoContextId() ?? 0, tipo: MonitorType.Icmp, nome: '', intervaloSegundos: 60, timeoutMs: 2000, falhasParaIncidente: 3, sucessosParaRecovery: 2 }); }
  protected openEdit(item: MonitorResponse): void { this.notice.set(null); this.saving.set(true); this.api.getById(item.id).pipe(take(1)).subscribe({ next: monitor => { this.saving.set(false); this.addCurrentEquipment(monitor); this.editing.set(monitor); this.form.reset({ equipamentoId: monitor.equipamento.id, tipo: monitor.tipo, nome: monitor.nome, intervaloSegundos: monitor.intervaloSegundos, timeoutMs: monitor.timeoutMs, falhasParaIncidente: monitor.falhasParaIncidente, sucessosParaRecovery: monitor.sucessosParaRecovery }); }, error: error => { this.saving.set(false); this.error.set(messageFrom(error, 'Não foi possível carregar o monitor para edição.')); } }); }
  private addCurrentEquipment(monitor: MonitorResponse): void { if (!this.equipamentos().some(item => item.id === monitor.equipamento.id)) this.equipamentos.update(items => [...items, { id: monitor.equipamento.id, nome: `${monitor.equipamento.nome} (inativo)`, ip: null, hostname: null, descricao: null, localizacao: null, numeroSerie: null, fabricante: null, modelo: null, ativo: false, emManutencao: false, unidade: { id: 0, nome: '' }, tipoEquipamento: { id: 0, nome: '' }, createdAt: '', updatedAt: '' }]); }
  protected closeForm(): void { if (!this.saving()) this.editing.set(undefined); }
  protected submit(): void { if (this.saving()) return; if (this.form.invalid) { this.form.markAllAsTouched(); return; } if (this.form.controls.timeoutMs.value >= this.form.controls.intervaloSegundos.value * 1000) { this.form.controls.timeoutMs.setErrors({ backend: 'O timeout deve ser menor que o intervalo em milissegundos.' }); this.form.controls.timeoutMs.markAsTouched(); return; } this.saving.set(true); const body = this.requestBody(); const current = this.editing(); (current ? this.api.update(current.id, body) : this.api.create(body)).pipe(take(1)).subscribe({ next: monitor => { this.saving.set(false); this.editing.set(undefined); this.notice.set(current ? 'Monitor atualizado com sucesso.' : 'Monitor criado com sucesso.'); this.load(); }, error: error => { this.saving.set(false); this.applyFormError(error); } }); }
  protected toggle(item: MonitorResponse): void { if (this.actingId() !== null) return; this.actingId.set(item.id); (item.ativo ? this.api.deactivate(item.id) : this.api.activate(item.id)).pipe(take(1)).subscribe({ next: updated => { this.actingId.set(null); this.page.update(items => items.map(value => value.id === updated.id ? updated : value)); this.notice.set(`Monitor ${updated.ativo ? 'ativado' : 'desativado'} com sucesso.`); }, error: error => { this.actingId.set(null); this.error.set(messageFrom(error, 'Não foi possível alterar o monitor.')); } }); }
  protected confirmDelete(item: MonitorResponse): void { this.deleting.set(item); }
  protected delete(): void { const item = this.deleting(); if (!item || this.deleteBusy()) return; this.deleteBusy.set(true); this.api.delete(item.id).pipe(take(1)).subscribe({ next: () => { this.deleteBusy.set(false); this.deleting.set(null); this.notice.set('Monitor excluído com sucesso.'); this.load(); }, error: error => { this.deleteBusy.set(false); this.deleting.set(null); this.error.set(messageFrom(error, 'Não foi possível excluir o monitor.')); } }); }
  private query(): MonitorListQuery { const active = this.ativo(); return { page: this.pageNumber(), size: this.pageSize(), sort: this.sort(), equipamentoId: this.equipamentoContextId() ?? this.equipamentoId(), tipo: this.tipo(), ativo: active === '' ? undefined : active === 'true' }; }
  private requestBody(): MonitorCreateRequest { const value = this.form.getRawValue(); return { equipamentoId: this.equipamentoContextId() ?? value.equipamentoId, tipo: value.tipo, nome: value.nome.trim(), intervaloSegundos: value.intervaloSegundos, timeoutMs: value.timeoutMs, falhasParaIncidente: value.falhasParaIncidente || null, sucessosParaRecovery: value.sucessosParaRecovery || null }; }
  private applyFormError(error: HttpErrorResponse): void { const apiError = isApiError(error.error) ? error.error : null; if (apiError?.fields) for (const [field, message] of Object.entries(apiError.fields)) { const control = this.form.get(field); if (control) { control.setErrors({ backend: message }); control.markAsTouched(); } } this.error.set(apiError?.code === ApiErrorCode.InvalidEnum ? 'O tipo de monitor informado não é aceito pela API.' : apiError?.message ?? messageFrom(error, 'Não foi possível salvar o monitor.')); }
}
function numberOrUndefined(value: string): number | undefined { const number = Number(value); return value && Number.isInteger(number) && number > 0 ? number : undefined; }
function messageFrom(error: unknown, fallback: string): string { return error instanceof HttpErrorResponse && isApiError(error.error) ? error.error.message : fallback; }

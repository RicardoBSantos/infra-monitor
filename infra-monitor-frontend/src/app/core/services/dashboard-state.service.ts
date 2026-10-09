import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { take } from 'rxjs';

import { ApiError, ApiErrorCode, isApiError } from '../models/api-error';
import { DashboardResumo, DashboardUnidade } from '../models/dashboard';
import { DashboardApiService } from './dashboard-api.service';

export type DashboardLoadState = 'loading' | 'success' | 'empty' | 'error';

/**
 * Estado compartilhado do Painel. Topbar e sidebar leem os mesmos contadores que os KPIs,
 * sem disparar requisições próprias e sem polling: só carrega sob demanda e no refresh manual.
 */
@Injectable({ providedIn: 'root' })
export class DashboardStateService {
  private readonly api = inject(DashboardApiService);

  private readonly resumoSignal = signal<DashboardResumo | null>(null);
  private readonly unidadesSignal = signal<DashboardUnidade[]>([]);
  private readonly resumoStateSignal = signal<DashboardLoadState>('loading');
  private readonly unidadesStateSignal = signal<DashboardLoadState>('loading');
  private readonly resumoErrorSignal = signal<ApiError | null>(null);
  private readonly unidadesErrorSignal = signal<ApiError | null>(null);
  private readonly ultimoFetchSignal = signal<string | null>(null);

  private resumoCarregado = false;
  private unidadesCarregadas = false;

  readonly resumo = this.resumoSignal.asReadonly();
  readonly unidades = this.unidadesSignal.asReadonly();
  readonly resumoState = this.resumoStateSignal.asReadonly();
  readonly unidadesState = this.unidadesStateSignal.asReadonly();
  readonly resumoError = this.resumoErrorSignal.asReadonly();
  readonly unidadesError = this.unidadesErrorSignal.asReadonly();

  /** Momento da varredura exibido na interface: o `geradoEm` da API, com o último fetch como reserva. */
  readonly ultimaVarredura = computed(() => this.resumoSignal()?.geradoEm ?? this.ultimoFetchSignal());

  readonly online = computed(() => this.resumoSignal()?.equipamentos.disponiveis ?? null);
  readonly degradados = computed(() => this.resumoSignal()?.equipamentos.degradados ?? null);
  readonly offline = computed(() => this.resumoSignal()?.equipamentos.indisponiveis ?? null);
  readonly incidentesAbertos = computed(() => this.resumoSignal()?.incidentes.abertos ?? null);

  /** Carrega o resumo uma única vez por sessão; usado por topbar e sidebar em qualquer página. */
  carregarResumoSeNecessario(): void {
    if (this.resumoCarregado) return;
    this.carregarResumo();
  }

  carregarUnidadesSeNecessario(): void {
    if (this.unidadesCarregadas) return;
    this.carregarUnidades();
  }

  /** Refetch manual: mesmo handler do botão Atualizar e da pill de refresh da topbar. */
  atualizar(): void {
    this.carregarResumo();
    if (this.unidadesCarregadas) this.carregarUnidades();
  }

  private carregarResumo(): void {
    this.resumoCarregado = true;
    this.resumoStateSignal.set('loading');
    this.resumoErrorSignal.set(null);
    this.api.getResumo().pipe(take(1)).subscribe({
      next: (resumo) => { this.resumoSignal.set(resumo); this.resumoStateSignal.set('success'); this.ultimoFetchSignal.set(new Date().toISOString()); },
      error: (error: HttpErrorResponse) => { this.resumoStateSignal.set('error'); this.resumoErrorSignal.set(erroDeApi(error)); },
    });
  }

  private carregarUnidades(): void {
    this.unidadesCarregadas = true;
    this.unidadesStateSignal.set('loading');
    this.unidadesErrorSignal.set(null);
    this.api.getUnidades().pipe(take(1)).subscribe({
      next: (unidades) => { this.unidadesSignal.set(unidades); this.unidadesStateSignal.set(unidades.length ? 'success' : 'empty'); },
      error: (error: HttpErrorResponse) => { this.unidadesStateSignal.set('error'); this.unidadesErrorSignal.set(erroDeApi(error)); },
    });
  }
}

export function erroDeApi(error: HttpErrorResponse): ApiError {
  if (isApiError(error.error)) return error.error;
  return {
    timestamp: new Date().toISOString(),
    status: error.status,
    error: error.statusText || 'Erro de conexão',
    code: error.status === 404 ? ApiErrorCode.ResourceNotFound : ApiErrorCode.InternalError,
    message: error.status === 0 ? 'Não foi possível conectar à API.' : 'Não foi possível carregar os dados operacionais.',
    path: '',
  };
}

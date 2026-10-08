import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { take } from 'rxjs';

import { formatarPercentual } from '../../../core/format/numero';
import { isApiError } from '../../../core/models/api-error';
import { DashboardEquipamento, DashboardUnidadeDetalhe } from '../../../core/models/dashboard';
import { UnidadeResponse } from '../../../core/models/unidade';
import { DashboardApiService } from '../../../core/services/dashboard-api.service';
import { RelatorioApiService } from '../../../core/services/relatorio-api.service';
import { UnidadeApiService } from '../../../core/services/unidade-api.service';

/** Mesma janela do painel: percentuais divergentes entre telas viram chamado de suporte. */
export const JANELA_DIAS = 30;

export type Estado = 'loading' | 'success' | 'error' | 'not-found';
export type Severidade = 'ok' | 'warn' | 'down';

export function severidadeDoEquipamento(equipamento: DashboardEquipamento): Severidade {
  if (equipamento.status === 'INDISPONIVEL') return 'down';
  if (equipamento.status === 'DISPONIVEL') return 'ok';
  return 'warn';
}

/**
 * Estado compartilhado entre o cabeçalho e as abas do detalhe da unidade.
 * Fornecido na rota pai, para que as abas filhas leiam os mesmos dados sem refetch.
 */
@Injectable()
export class UnidadeDetalheStore {
  private readonly dashboard = inject(DashboardApiService);
  private readonly relatorios = inject(RelatorioApiService);
  private readonly unidadesApi = inject(UnidadeApiService);

  readonly id = signal(0);
  readonly estado = signal<Estado>('loading');
  readonly erro = signal<string | null>(null);
  readonly unidade = signal<DashboardUnidadeDetalhe | null>(null);
  readonly cadastro = signal<UnidadeResponse | null>(null);

  readonly equipamentos = signal<DashboardEquipamento[]>([]);
  readonly equipamentosEstado = signal<Estado>('loading');

  readonly disponibilidadePorEquipamento = signal<Map<number, number | null>>(new Map());
  readonly disponibilidadeUnidade = signal<number | null>(null);
  readonly latenciaUnidade = signal<number | null>(null);

  readonly disponibilidadeTexto = computed(() => formatarPercentual(this.disponibilidadeUnidade()));
  readonly latenciaTexto = computed(() => {
    const media = this.latenciaUnidade();
    return media === null ? '—' : `${Math.round(media)}`;
  });

  readonly severidade = computed<Severidade>(() => {
    const unidade = this.unidade();
    if (!unidade) return 'ok';
    if (unidade.equipamentos.indisponiveis > 0) return 'down';
    if (unidade.equipamentos.degradados + unidade.equipamentos.emManutencao > 0) return 'warn';
    return 'ok';
  });

  /** Metadados do cabeçalho: segmentos ausentes somem, em vez de virar campo vazio. */
  readonly metadados = computed(() => {
    const cadastro = this.cadastro();
    if (!cadastro) return [];
    const partes: string[] = [];
    if (cadastro.sigla) partes.push(cadastro.sigla);
    if (cadastro.cidade && cadastro.uf) partes.push(`${cadastro.cidade}/${cadastro.uf}`);
    else if (cadastro.cidade) partes.push(cadastro.cidade);
    else if (cadastro.uf) partes.push(cadastro.uf);
    if (cadastro.endereco) partes.push(cadastro.endereco);
    if (cadastro.latitude !== null && cadastro.longitude !== null) {
      partes.push(`${cadastro.latitude}, ${cadastro.longitude}`);
    }
    return partes;
  });

  carregar(id: number): void {
    this.id.set(id);
    this.estado.set('loading');
    this.erro.set(null);
    this.dashboard.getUnidade(id).pipe(take(1)).subscribe({
      next: (unidade) => { this.unidade.set(unidade); this.estado.set('success'); },
      error: (erro: HttpErrorResponse) => {
        if (isApiError(erro.error) && erro.error.code === 'RESOURCE_NOT_FOUND') { this.estado.set('not-found'); return; }
        this.erro.set(isApiError(erro.error) ? erro.error.message : 'Não foi possível carregar a unidade.');
        this.estado.set('error');
      },
    });
    this.carregarCadastro(id);
    this.carregarEquipamentos(id);
    this.carregarAgregados(id);
  }

  recarregarEquipamentos(): void { this.carregarEquipamentos(this.id()); }

  /** Após ativar/desativar, o cabeçalho, os KPIs e a zona de risco têm de refletir o novo estado. */
  recarregar(): void { this.carregar(this.id()); }

  /** Cadastro traz cidade, UF, endereço e coordenadas — o dashboard não os expõe. */
  private carregarCadastro(id: number): void {
    this.unidadesApi.getById(id).pipe(take(1)).subscribe({
      next: (cadastro) => this.cadastro.set(cadastro),
      error: () => this.cadastro.set(null),
    });
  }

  private carregarEquipamentos(id: number): void {
    this.equipamentosEstado.set('loading');
    this.dashboard.getEquipamentosDaUnidade(id, { size: 200, sort: 'nome' }).pipe(take(1)).subscribe({
      next: (pagina) => { this.equipamentos.set(pagina.content); this.equipamentosEstado.set('success'); },
      error: () => { this.equipamentos.set([]); this.equipamentosEstado.set('error'); },
    });
  }

  /** Cada agregado falha sozinho: um KPI indisponível não derruba os outros nem a página. */
  private carregarAgregados(id: number): void {
    const janela = this.janela();
    this.relatorios.getDisponibilidadeUnidades({ ...janela, unidadeId: id, size: 1 }).pipe(take(1)).subscribe({
      next: (pagina) => this.disponibilidadeUnidade.set(pagina.content[0]?.disponibilidadePercentual ?? null),
      error: () => this.disponibilidadeUnidade.set(null),
    });
    this.relatorios.getLatenciaUnidades({ ...janela, unidadeId: id, size: 1 }).pipe(take(1)).subscribe({
      next: (pagina) => this.latenciaUnidade.set(pagina.content[0]?.avgLatenciaMs ?? null),
      error: () => this.latenciaUnidade.set(null),
    });
    this.relatorios.getDisponibilidadeEquipamentos({ ...janela, unidadeId: id, size: 200 }).pipe(take(1)).subscribe({
      next: (pagina) => this.disponibilidadePorEquipamento.set(new Map(pagina.content.map((linha) => [linha.equipamentoId, linha.disponibilidadePercentual]))),
      error: () => this.disponibilidadePorEquipamento.set(new Map()),
    });
  }

  private janela(): { inicio: string; fim: string } {
    const fim = new Date();
    const inicio = new Date(fim.getTime() - JANELA_DIAS * 24 * 60 * 60 * 1000);
    return { inicio: inicio.toISOString(), fim: fim.toISOString() };
  }
}

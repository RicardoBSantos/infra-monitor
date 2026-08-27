import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { take } from 'rxjs';

import { isApiError } from '../../core/models/api-error';
import { DashboardEquipamento, DashboardUnidadeDetalhe } from '../../core/models/dashboard';
import { DashboardApiService } from '../../core/services/dashboard-api.service';
import { GeoMunicipioService } from '../../core/services/geo-municipio.service';
import { RelatorioApiService } from '../../core/services/relatorio-api.service';
import { UnidadeApiService } from '../../core/services/unidade-api.service';
import { AppIconComponent } from '../../shared/app-icon/app-icon.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';

/** Mesma janela do painel: os agregados vêm prontos da API de relatórios. */
const JANELA_DIAS = 30;
const PERCENTUAL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Estado = 'loading' | 'success' | 'error' | 'not-found';
type Severidade = 'ok' | 'warn' | 'down';
interface Identidade { sigla: string | null; municipio: string | null; }

/** Visão operacional de leitura da unidade. O CRUD administrativo continua em /unidades. */
@Component({
  selector: 'app-unidade-detalhe',
  imports: [RouterLink, AppIconComponent, StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './unidade-detalhe.component.html',
  styleUrl: './unidade-detalhe.component.scss',
})
export class UnidadeDetalheComponent {
  private readonly dashboard = inject(DashboardApiService);
  private readonly relatorios = inject(RelatorioApiService);
  private readonly unidadesApi = inject(UnidadeApiService);
  private readonly geo = inject(GeoMunicipioService);

  protected readonly estado = signal<Estado>('loading');
  protected readonly erro = signal<string | null>(null);
  protected readonly unidade = signal<DashboardUnidadeDetalhe | null>(null);
  protected readonly identidade = signal<Identidade | null>(null);
  protected readonly equipamentos = signal<DashboardEquipamento[]>([]);
  protected readonly equipamentosEstado = signal<Estado>('loading');
  private readonly disponibilidade = signal<Map<number, number | null>>(new Map());
  private readonly disponibilidadeUnidade = signal<number | null>(null);
  private readonly latenciaUnidade = signal<number | null>(null);

  protected readonly id: number;

  protected readonly disponibilidadeTexto = computed(() => formatarPercentual(this.disponibilidadeUnidade()));
  protected readonly latenciaTexto = computed(() => {
    const media = this.latenciaUnidade();
    return media === null ? '—' : `${Math.round(media)} ms`;
  });
  protected readonly severidade = computed<Severidade>(() => {
    const unidade = this.unidade();
    if (!unidade) return 'ok';
    if (unidade.equipamentos.indisponiveis > 0) return 'down';
    if (unidade.equipamentos.degradados + unidade.equipamentos.emManutencao > 0) return 'warn';
    return 'ok';
  });

  constructor() {
    this.id = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
    if (!Number.isInteger(this.id) || this.id < 1) { this.estado.set('not-found'); return; }
    this.carregar();
  }

  protected carregar(): void {
    this.estado.set('loading');
    this.erro.set(null);
    this.dashboard.getUnidade(this.id).pipe(take(1)).subscribe({
      next: (unidade) => { this.unidade.set(unidade); this.estado.set('success'); this.carregarIdentidade(unidade); },
      error: (erro: HttpErrorResponse) => {
        if (isApiError(erro.error) && erro.error.code === 'RESOURCE_NOT_FOUND') { this.estado.set('not-found'); return; }
        this.erro.set(isApiError(erro.error) ? erro.error.message : 'Não foi possível carregar a unidade.');
        this.estado.set('error');
      },
    });
    this.carregarEquipamentos();
    this.carregarAgregados();
  }

  protected larguraFaixa(parte: number, total: number): string { return total > 0 ? `${(parte / total) * 100}%` : '0%'; }

  protected severidadeDoEquipamento(equipamento: DashboardEquipamento): Severidade {
    if (equipamento.status === 'INDISPONIVEL') return 'down';
    if (equipamento.status === 'DISPONIVEL') return 'ok';
    return 'warn';
  }

  protected latencia(equipamento: DashboardEquipamento): string {
    const latencia = equipamento.ultimaMedicao?.latenciaMs;
    return latencia === null || latencia === undefined ? '—' : `${latencia} ms`;
  }

  protected disponibilidadeDoEquipamento(equipamentoId: number): string {
    return formatarPercentual(this.disponibilidade().get(equipamentoId) ?? null);
  }

  protected readonly trackEquipamento = (_: number, equipamento: DashboardEquipamento) => equipamento.id;

  private carregarEquipamentos(): void {
    this.equipamentosEstado.set('loading');
    this.dashboard.getEquipamentosDaUnidade(this.id, { size: 100, sort: 'nome' }).pipe(take(1)).subscribe({
      next: (pagina) => { this.equipamentos.set(pagina.content); this.equipamentosEstado.set('success'); },
      error: () => { this.equipamentos.set([]); this.equipamentosEstado.set('error'); },
    });
  }

  /** Cada agregado falha sozinho: a página continua legível sem os relatórios. */
  private carregarAgregados(): void {
    const janela = this.janela();
    this.relatorios.getDisponibilidadeUnidades({ ...janela, unidadeId: this.id, size: 1 }).pipe(take(1)).subscribe({
      next: (pagina) => this.disponibilidadeUnidade.set(pagina.content[0]?.disponibilidadePercentual ?? null),
      error: () => this.disponibilidadeUnidade.set(null),
    });
    this.relatorios.getLatenciaUnidades({ ...janela, unidadeId: this.id, size: 1 }).pipe(take(1)).subscribe({
      next: (pagina) => this.latenciaUnidade.set(pagina.content[0]?.avgLatenciaMs ?? null),
      error: () => this.latenciaUnidade.set(null),
    });
    this.relatorios.getDisponibilidadeEquipamentos({ ...janela, unidadeId: this.id, size: 200 }).pipe(take(1)).subscribe({
      next: (pagina) => this.disponibilidade.set(new Map(pagina.content.map((linha) => [linha.equipamentoId, linha.disponibilidadePercentual]))),
      error: () => this.disponibilidade.set(new Map()),
    });
  }

  private carregarIdentidade(unidade: DashboardUnidadeDetalhe): void {
    this.unidadesApi.list().pipe(take(1)).subscribe({
      next: (unidades) => {
        const cadastro = unidades.find((item) => item.id === unidade.id);
        this.identidade.set({ sigla: cadastro?.sigla ?? null, municipio: null });
        this.geo.getMunicipios().pipe(take(1)).subscribe({
          next: (municipios) => {
            const nome = municipios.find((municipio) => municipio.codigoIbge === unidade.codigoIbge)?.nome ?? null;
            this.identidade.set({ sigla: cadastro?.sigla ?? null, municipio: nome });
          },
          error: () => undefined,
        });
      },
      error: () => undefined,
    });
  }

  private janela(): { inicio: string; fim: string } {
    const fim = new Date();
    const inicio = new Date(fim.getTime() - JANELA_DIAS * 24 * 60 * 60 * 1000);
    return { inicio: inicio.toISOString(), fim: fim.toISOString() };
  }
}

function formatarPercentual(valor: number | null): string {
  return valor === null || valor === undefined ? '—' : `${PERCENTUAL.format(valor)}%`;
}

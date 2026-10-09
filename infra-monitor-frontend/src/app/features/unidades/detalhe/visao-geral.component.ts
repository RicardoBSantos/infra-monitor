import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, of, take } from 'rxjs';

import { DashboardEquipamento } from '../../../core/models/dashboard';
import { IncidenteResponse } from '../../../core/models/incidente';
import { GeoMunicipioService, divergenciaIbge } from '../../../core/services/geo-municipio.service';
import { IncidenteApiService } from '../../../core/services/incidente-api.service';
import { StatusBadgeComponent } from '../../../shared/status-badge/status-badge.component';
import { Estado, Severidade, UnidadeDetalheStore, severidadeDoEquipamento } from './unidade-detalhe.store';

const LIMITE_LATENCIA = 6;
const LIMITE_INCIDENTES = 5;

interface LinhaLatencia {
  id: number; nome: string; tipo: string; severidade: Severidade;
  latenciaMs: number | null; offline: boolean; largura: string;
}
interface LinhaTipo { nome: string; total: number; largura: string; }

@Component({
  selector: 'app-unidade-visao-geral',
  imports: [RouterLink, StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './visao-geral.component.html',
  styleUrl: './visao-geral.component.scss',
})
export class VisaoGeralComponent {
  private readonly incidentesApi = inject(IncidenteApiService);
  private readonly geo = inject(GeoMunicipioService);
  protected readonly store = inject(UnidadeDetalheStore);

  protected readonly incidentes = signal<IncidenteResponse[]>([]);
  protected readonly incidentesEstado = signal<Estado>('loading');

  /** Falha ao carregar a cartografia só apaga o aviso; nunca derruba a visão geral. */
  private readonly municipios = toSignal(this.geo.getMunicipios().pipe(catchError(() => of(null))), { initialValue: null });
  protected readonly divergencia = computed(() => {
    const cadastro = this.store.cadastro();
    const municipios = this.municipios();
    return cadastro && municipios ? divergenciaIbge(cadastro, municipios) : null;
  });

  /** Offline ocupa a barra inteira: sem latência, a leitura correta é "pior caso". */
  protected readonly maioresLatencias = computed<LinhaLatencia[]>(() => {
    const equipamentos = this.store.equipamentos();
    const teto = Math.max(...equipamentos.map((e) => e.ultimaMedicao?.latenciaMs ?? 0), 1);
    return equipamentos
      .map((equipamento) => this.paraLinha(equipamento, teto))
      .sort((a, b) => Number(b.offline) - Number(a.offline) || (b.latenciaMs ?? 0) - (a.latenciaMs ?? 0))
      .slice(0, LIMITE_LATENCIA);
  });

  protected readonly porTipo = computed<LinhaTipo[]>(() => {
    const contagem = new Map<string, number>();
    for (const equipamento of this.store.equipamentos()) {
      const nome = equipamento.tipoEquipamento.nome;
      contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
    }
    const linhas = [...contagem.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const teto = Math.max(...linhas.map(([, total]) => total), 1);
    return linhas.map(([nome, total]) => ({ nome, total, largura: `${(total / teto) * 100}%` }));
  });

  constructor() { this.carregarIncidentes(); }

  protected carregarIncidentes(): void {
    this.incidentesEstado.set('loading');
    this.incidentesApi.list({ unidadeId: this.store.id(), size: LIMITE_INCIDENTES, sort: 'iniciadoEm,desc' })
      .pipe(take(1)).subscribe({
        next: (pagina) => { this.incidentes.set(pagina.content); this.incidentesEstado.set('success'); },
        error: () => { this.incidentes.set([]); this.incidentesEstado.set('error'); },
      });
  }

  private paraLinha(equipamento: DashboardEquipamento, teto: number): LinhaLatencia {
    const offline = equipamento.status === 'INDISPONIVEL';
    const latenciaMs = equipamento.ultimaMedicao?.latenciaMs ?? null;
    return {
      id: equipamento.id,
      nome: equipamento.nome,
      tipo: equipamento.tipoEquipamento.nome,
      severidade: severidadeDoEquipamento(equipamento),
      latenciaMs,
      offline,
      largura: offline ? '100%' : `${((latenciaMs ?? 0) / teto) * 100}%`,
    };
  }
}

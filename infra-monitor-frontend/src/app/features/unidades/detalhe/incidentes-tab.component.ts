import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { take } from 'rxjs';

import { IncidenteResponse } from '../../../core/models/incidente';
import { IncidenteApiService } from '../../../core/services/incidente-api.service';
import { rotuloMotivoEncerramento } from '../../incidentes/ocorrencia';
import { StatusBadgeComponent } from '../../../shared/status-badge/status-badge.component';
import { Estado, UnidadeDetalheStore } from './unidade-detalhe.store';

const LIMITE = 100;

@Component({
  selector: 'app-unidade-incidentes',
  imports: [DatePipe, RouterLink, StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './incidentes-tab.component.html',
  styleUrl: './incidentes-tab.component.scss',
})
export class IncidentesTabComponent {
  private readonly api = inject(IncidenteApiService);
  private readonly store = inject(UnidadeDetalheStore);

  protected readonly incidentes = signal<IncidenteResponse[]>([]);
  protected readonly estado = signal<Estado>('loading');

  protected readonly ordenados = computed(() =>
    [...this.incidentes()].sort((a, b) => b.iniciadoEm.localeCompare(a.iniciadoEm)));

  constructor() { this.carregar(); }

  protected carregar(): void {
    this.estado.set('loading');
    this.api.list({ unidadeId: this.store.id(), size: LIMITE, sort: 'iniciadoEm,desc' }).pipe(take(1)).subscribe({
      next: (pagina) => { this.incidentes.set(pagina.content); this.estado.set('success'); },
      error: () => { this.incidentes.set([]); this.estado.set('error'); },
    });
  }

  /**
   * Como o incidente terminou — resolvido de verdade ou apenas interrompido por
   * manutenção. `null` enquanto aberto: ainda não há como saber. `incidente.motivo` é o
   * motivo de ABERTURA; não confundir os dois.
   */
  protected rotuloEncerramento(incidente: IncidenteResponse): string | null {
    return incidente.encerradoEm ? rotuloMotivoEncerramento(incidente.motivoEncerramento) : null;
  }

  /** Derivada no cliente: fim - início, ou agora - início enquanto o incidente estiver aberto. */
  protected duracao(incidente: IncidenteResponse): string {
    const fim = incidente.encerradoEm ? new Date(incidente.encerradoEm).getTime() : Date.now();
    const segundos = Math.max(0, Math.round((fim - new Date(incidente.iniciadoEm).getTime()) / 1000));
    if (segundos < 60) return `${segundos} s`;
    const minutos = Math.floor(segundos / 60);
    if (minutos < 60) return `${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return minutos % 60 === 0 ? `${horas} h` : `${horas} h ${minutos % 60} min`;
    const dias = Math.floor(horas / 24);
    return horas % 24 === 0 ? `${dias} d` : `${dias} d ${horas % 24} h`;
  }
}

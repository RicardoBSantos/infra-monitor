import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { DashboardEquipamento } from '../../../core/models/dashboard';
import { StatusBadgeComponent } from '../../../shared/status-badge/status-badge.component';
import { Severidade, UnidadeDetalheStore, formatarPercentual, severidadeDoEquipamento } from './unidade-detalhe.store';

const STATUS_DISPONIVEIS = [
  { valor: 'DISPONIVEL', rotulo: 'Online' },
  { valor: 'DEGRADADO', rotulo: 'Degradado' },
  { valor: 'INDISPONIVEL', rotulo: 'Offline' },
  { valor: 'EM_MANUTENCAO', rotulo: 'Em manutenção' },
  { valor: 'SEM_MONITORAMENTO', rotulo: 'Sem monitoramento' },
  { valor: 'SEM_DADOS', rotulo: 'Sem dados' },
];

@Component({
  selector: 'app-unidade-equipamentos',
  imports: [RouterLink, StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './equipamentos-tab.component.html',
  styleUrl: './equipamentos-tab.component.scss',
})
export class EquipamentosTabComponent {
  protected readonly store = inject(UnidadeDetalheStore);
  protected readonly statusDisponiveis = STATUS_DISPONIVEIS;

  protected readonly busca = signal('');
  protected readonly tipo = signal('');
  protected readonly status = signal('');

  protected readonly tipos = computed(() => {
    const nomes = new Set(this.store.equipamentos().map((e) => e.tipoEquipamento.nome));
    return [...nomes].sort((a, b) => a.localeCompare(b));
  });

  /** Filtragem em memória sobre a lista já carregada: digitar não dispara refetch. */
  protected readonly filtrados = computed(() => {
    const termo = this.busca().trim().toLowerCase();
    const tipo = this.tipo();
    const status = this.status();
    return this.store.equipamentos().filter((equipamento) => {
      if (tipo && equipamento.tipoEquipamento.nome !== tipo) return false;
      if (status && equipamento.status !== status) return false;
      if (!termo) return true;
      return [equipamento.nome, equipamento.hostname, equipamento.ip]
        .some((campo) => campo?.toLowerCase().includes(termo));
    });
  });

  protected readonly temFiltro = computed(() => this.busca().trim() !== '' || this.tipo() !== '' || this.status() !== '');

  protected limparFiltros(): void { this.busca.set(''); this.tipo.set(''); this.status.set(''); }

  protected severidade(equipamento: DashboardEquipamento): Severidade { return severidadeDoEquipamento(equipamento); }

  protected latencia(equipamento: DashboardEquipamento): string {
    if (equipamento.status === 'INDISPONIVEL') return 'timeout';
    const latencia = equipamento.ultimaMedicao?.latenciaMs;
    return latencia === null || latencia === undefined ? '—' : `${latencia} ms`;
  }

  protected disponibilidade(equipamentoId: number): string {
    return formatarPercentual(this.store.disponibilidadePorEquipamento().get(equipamentoId) ?? null);
  }

  /** Tempo relativo formatado no cliente: o backend entrega o instante absoluto. */
  protected ultimaVerificacao(equipamento: DashboardEquipamento): string {
    const executadoEm = equipamento.ultimaMedicao?.executadoEm;
    if (!executadoEm) return '—';
    const segundos = Math.max(0, Math.round((Date.now() - new Date(executadoEm).getTime()) / 1000));
    if (segundos < 60) return `há ${segundos} s`;
    const minutos = Math.round(segundos / 60);
    if (minutos < 60) return `há ${minutos} min`;
    const horas = Math.round(minutos / 60);
    if (horas < 24) return `há ${horas} h`;
    return `há ${Math.round(horas / 24)} d`;
  }
}

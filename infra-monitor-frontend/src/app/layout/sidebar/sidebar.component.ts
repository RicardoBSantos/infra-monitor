import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { AppIconComponent, AppIconName } from '../../shared/app-icon/app-icon.component';
import { AuthStateService } from '../../core/services/auth-state.service';
import { DashboardStateService } from '../../core/services/dashboard-state.service';

const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

interface NavigationItem { label: string; path: string; icon: AppIconName; }

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, AppIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  protected readonly authState = inject(AuthStateService);
  private readonly painel = inject(DashboardStateService);
  protected readonly incidentesAbertos = computed(() => this.painel.incidentesAbertos() ?? 0);
  protected readonly ultimaVarredura = computed(() => {
    const instante = this.painel.ultimaVarredura();
    return instante ? HORA.format(new Date(instante)) : '--:--:--';
  });
  readonly open = input(false);
  readonly closeNavigation = output<void>();
  protected readonly operations: readonly NavigationItem[] = [
    { label: 'Mapa', path: '/mapa', icon: 'map' }, { label: 'Painel', path: '/dashboard', icon: 'panel' }, { label: 'Incidentes', path: '/incidentes', icon: 'incident' },
  ];
  protected readonly reports: readonly NavigationItem[] = [{ label: 'Relatórios', path: '/relatorios', icon: 'panel' }];
  protected readonly management: readonly NavigationItem[] = [
    { label: 'Unidades', path: '/unidades', icon: 'unit' }, { label: 'Equipamentos', path: '/equipamentos', icon: 'equipment' }, { label: 'Tipos de equipamento', path: '/tipos-equipamento', icon: 'types' }, { label: 'Monitoramento', path: '/monitores', icon: 'monitor' }, { label: 'Medições', path: '/medicoes', icon: 'measurements' }, { label: 'Telegram', path: '/notificacoes', icon: 'telegram' },
  ];
  protected readonly administration: readonly NavigationItem[] = [{ label: 'Usuários', path: '/usuarios', icon: 'equipment' }];
  protected close(): void { this.closeNavigation.emit(); }
}

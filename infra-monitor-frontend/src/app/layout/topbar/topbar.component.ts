import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, output, signal } from '@angular/core';
import { Router } from '@angular/router';

import { plural } from '../../core/format/plural';
import { AppIconComponent } from '../../shared/app-icon/app-icon.component';
import { BreadcrumbsComponent } from '../../shared/breadcrumbs/breadcrumbs.component';
import { AuthService } from '../../core/services/auth.service';
import { AuthStateService } from '../../core/services/auth-state.service';
import { DashboardStateService } from '../../core/services/dashboard-state.service';
import { ThemeService } from '../../core/services/theme.service';

const HORA = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const DATA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

@Component({
  selector: 'app-topbar',
  imports: [AppIconComponent, BreadcrumbsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.scss',
})
export class TopbarComponent {
  protected readonly plural = plural;
  readonly openNavigation = output<void>();
  protected readonly authState = inject(AuthStateService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);
  protected readonly painel = inject(DashboardStateService);
  protected readonly menuOpen = signal(false);

  private readonly agora = signal(new Date());
  protected readonly hora = computed(() => HORA.format(this.agora()));
  protected readonly data = computed(() => DATA.format(this.agora()));
  protected readonly iniciais = computed(() => iniciaisDe(this.authState.usuario()?.nome ?? ''));
  protected readonly ultimaVarredura = computed(() => {
    const instante = this.painel.ultimaVarredura();
    return instante ? HORA.format(new Date(instante)) : '--:--:--';
  });

  constructor() {
    this.painel.carregarResumoSeNecessario();
    const relogio = setInterval(() => this.agora.set(new Date()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(relogio));
  }

  protected atualizar(): void { this.painel.atualizar(); }
  protected changePassword(): void { this.menuOpen.set(false); this.router.navigate(['/trocar-senha']); }
  protected logout(): void { this.auth.logout(); this.router.navigate(['/login']); }
}

function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '--';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

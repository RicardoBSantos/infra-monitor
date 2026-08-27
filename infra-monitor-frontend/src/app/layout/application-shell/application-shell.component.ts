import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { SidebarComponent } from '../sidebar/sidebar.component';
import { TopbarComponent } from '../topbar/topbar.component';

@Component({
  selector: 'app-application-shell',
  imports: [RouterOutlet, SidebarComponent, TopbarComponent],
  template: `
    <div class="shell" [class.shell--navigation-open]="navigationOpen()">
      <app-sidebar [open]="navigationOpen()" (closeNavigation)="closeNavigation()" />
      @if (navigationOpen()) { <button class="backdrop" type="button" aria-label="Fechar menu de navegação" (click)="closeNavigation()"></button> }
      <div class="shell__content">
        <app-topbar (openNavigation)="openNavigation()" />
        <main class="shell__main" tabindex="-1"><router-outlet /></main>
      </div>
    </div>
  `,
  styleUrl: './application-shell.component.scss',
})
export class ApplicationShellComponent {
  protected readonly navigationOpen = signal(false);
  protected openNavigation(): void { this.navigationOpen.set(true); }
  protected closeNavigation(): void { this.navigationOpen.set(false); }
}

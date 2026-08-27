import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { SidebarComponent } from './sidebar.component';
import { AuthStateService } from '../../core/services/auth-state.service';

const session = (papel: 'ADMIN' | 'OPERADOR' | 'VISUALIZADOR') => ({ accessToken: 'token', tokenType: 'Bearer' as const, expiresIn: 60, usuario: { id: 1, nome: papel, email: `${papel}@example.test`, papel, trocaSenhaObrigatoria: false } });

describe('SidebarComponent', () => {
  it('renders only navigation supported by the current cycle', async () => {
    await TestBed.configureTestingModule({ imports: [SidebarComponent], providers: [provideRouter([{ path: 'dashboard', component: SidebarComponent }])] }).compileComponents();
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
    const labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.navigation__item')).map((element) => element.textContent?.trim());

    expect(labels).toContain('Painel');
    expect(labels).toContain('Medições');
    expect(labels).toContain('Relatórios');
    expect(labels).not.toContain('Usuários');
  });

  it('marks the current route as active', async () => {
    await TestBed.configureTestingModule({ imports: [SidebarComponent], providers: [provideRouter([{ path: 'dashboard', component: SidebarComponent }])] }).compileComponents();
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.detectChanges();
    await router.navigateByUrl('/dashboard');
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.navigation__item[href="/dashboard"]')?.classList).toContain('navigation__item--active');
  });

  for (const papel of ['ADMIN', 'OPERADOR', 'VISUALIZADOR'] as const) {
    it(`renders reports in the actual DOM for ${papel}`, async () => {
      await TestBed.configureTestingModule({ imports: [SidebarComponent], providers: [provideRouter([])] }).compileComponents();
      TestBed.inject(AuthStateService).setSession(session(papel));
      const fixture = TestBed.createComponent(SidebarComponent);
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).querySelector('.navigation__item[href="/relatorios"]')).not.toBeNull();
    });
  }

  for (const [papel, expected] of [['ADMIN', true], ['OPERADOR', false], ['VISUALIZADOR', false]] as const) {
    it(`renders Usuários in the actual DOM only for ${papel}`, async () => {
      await TestBed.configureTestingModule({ imports: [SidebarComponent], providers: [provideRouter([])] }).compileComponents();
      TestBed.inject(AuthStateService).setSession(session(papel));
      const fixture = TestBed.createComponent(SidebarComponent);
      fixture.detectChanges();

      const userLink = (fixture.nativeElement as HTMLElement).querySelector('.navigation__item[href="/usuarios"]');
      expect(userLink !== null).toBe(expected);
    });
  }
});

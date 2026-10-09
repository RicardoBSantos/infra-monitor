import { routes } from './app.routes';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { AuthStateService } from './core/services/auth-state.service';
import { passwordChangeGuard, roleGuard } from './core/guards/auth.guards';

describe('application routes', () => {
  it('lazy-loads every operational feature inside the protected application shell', async () => {
    const paths = ['dashboard', 'mapa', 'unidades', 'tipos-equipamento', 'equipamentos', 'monitores', 'medicoes', 'incidentes', 'relatorios', 'notificacoes', 'usuarios'];

    for (const path of paths) {
      const shell = routes.find(candidate => candidate.path === '');
      const route = shell?.children?.find(candidate => candidate.path === path);
      expect(route?.component).toBeUndefined();
      expect(route?.loadComponent).toBeTypeOf('function');
      await expect(route!.loadComponent!()).resolves.toBeDefined();
    }
  });

  for (const [papel, allowed] of [['ADMIN', true], ['OPERADOR', false], ['VISUALIZADOR', false]] as const) {
    it(`uses the real /usuarios route metadata with roleGuard for ${papel}`, () => {
      TestBed.configureTestingModule({ providers: [provideRouter([])] });
      const auth = TestBed.inject(AuthStateService);
      auth.setSession({ accessToken: 'token', tokenType: 'Bearer', expiresIn: 60, usuario: { id: 1, nome: papel, email: `${papel}@example.test`, papel, trocaSenhaObrigatoria: false } });
      const route = routes.find(candidate => candidate.path === '')!.children!.find(candidate => candidate.path === 'usuarios')!;
      const result = TestBed.runInInjectionContext(() => roleGuard(route as any, {} as any));
      expect(result === true).toBe(allowed);
      if (!allowed) expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/forbidden');
    });
  }

  for (const papel of ['ADMIN', 'OPERADOR', 'VISUALIZADOR'] as const) {
    it(`allows ${papel} through the real /relatorios roleGuard`, () => {
      TestBed.configureTestingModule({ providers: [provideRouter([])] });
      TestBed.inject(AuthStateService).setSession({ accessToken: 'token', tokenType: 'Bearer', expiresIn: 60, usuario: { id: 1, nome: papel, email: `${papel}@example.test`, papel, trocaSenhaObrigatoria: false } });
      const route = routes.find(candidate => candidate.path === '')!.children!.find(candidate => candidate.path === 'relatorios')!;
      const result = TestBed.runInInjectionContext(() => roleGuard(route as any, {} as any));
      expect(result).toBe(true);
    });
  }

  it('allows an authenticated user to open /trocar-senha voluntarily', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    TestBed.inject(AuthStateService).setSession({ accessToken: 'token', tokenType: 'Bearer', expiresIn: 60, usuario: { id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN', trocaSenhaObrigatoria: false } });
    const result = TestBed.runInInjectionContext(() => passwordChangeGuard({} as any, { url: '/trocar-senha' } as any));
    expect(result).toBe(true);
  });

  it('requires authentication to open /trocar-senha', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const result = TestBed.runInInjectionContext(() => passwordChangeGuard({} as any, { url: '/trocar-senha' } as any));
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/login?returnUrl=%2Ftrocar-senha');
  });
});

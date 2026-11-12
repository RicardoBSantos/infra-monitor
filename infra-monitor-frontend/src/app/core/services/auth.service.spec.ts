import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { loginGuard } from '../guards/auth.guards';
import { AuthService } from './auth.service';
import { AuthStateService } from './auth-state.service';

const sessao = { accessToken: 'token', tokenType: 'Bearer' as const, expiresIn: 60, usuario: { id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN' as const, trocaSenhaObrigatoria: false } };

@Component({ template: '' }) class RotaVazia {}

describe('AuthService', () => {
  let service: AuthService; let http: HttpTestingController; let state: AuthStateService;
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'login', canActivate: [loginGuard], component: RotaVazia }, { path: 'dashboard', component: RotaVazia }]), provideHttpClient(), provideHttpClientTesting()] }); service = TestBed.inject(AuthService); http = TestBed.inject(HttpTestingController); state = TestBed.inject(AuthStateService); });
  afterEach(() => http.verify());
  it('uses the auth contracts and updates/clears only in-memory state', () => {
    service.login('admin@example.test', 'secret').subscribe(); const login = http.expectOne('/api/v1/auth/login'); expect(login.request.method).toBe('POST'); expect(login.request.body).toEqual({ email: 'admin@example.test', senha: 'secret' }); login.flush({ accessToken: 'token', tokenType: 'Bearer', expiresIn: 60, usuario: { id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN', trocaSenhaObrigatoria: false } }); expect(state.authenticated()).toBe(true);
    service.me().subscribe(); const me = http.expectOne('/api/v1/auth/me'); expect(me.request.method).toBe('GET'); me.flush({ id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN', trocaSenhaObrigatoria: false });
    service.changeOwnPassword({ senhaAtual: 'old', novaSenha: 'new-password-123' }).subscribe(); const change = http.expectOne('/api/v1/usuarios/me/senha'); expect(change.request.method).toBe('PUT'); expect(change.request.body).toEqual({ senhaAtual: 'old', novaSenha: 'new-password-123' }); change.flush(null);
  });
  it('logout posts to /auth/logout without Bearer and clears the state when it succeeds', () => {
    state.setSession(sessao); let completed = false;
    service.logout().subscribe({ complete: () => completed = true });
    const logout = http.expectOne('/api/v1/auth/logout'); expect(logout.request.method).toBe('POST'); expect(logout.request.body).toEqual({}); expect(logout.request.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    logout.flush(null, { status: 204, statusText: 'No Content' });
    expect(completed).toBe(true); expect(state.authenticated()).toBe(false);
  });
  it('logout clears the state before completing, so "Sair" reaches /login past the real loginGuard', async () => {
    const router = TestBed.inject(Router); state.setSession(sessao); await router.navigateByUrl('/dashboard'); let autenticadoNoComplete: boolean | null = null;
    service.logout().subscribe({ complete: () => { autenticadoNoComplete = state.authenticated(); router.navigate(['/login']); } });
    http.expectOne('/api/v1/auth/logout').flush(null, { status: 204, statusText: 'No Content' }); await new Promise(resolve => setTimeout(resolve));
    expect(autenticadoNoComplete).toBe(false); expect(state.authenticated()).toBe(false); expect(router.url).toBe('/login');
  });
  it('logout cancelled before the response still clears the state, exactly once', () => {
    state.setSession(sessao); const clear = vi.spyOn(state, 'clear');
    const sub = service.logout().subscribe(); const logout = http.expectOne('/api/v1/auth/logout'); sub.unsubscribe();
    expect(logout.cancelled).toBe(true); expect(clear).toHaveBeenCalledTimes(1); expect(state.authenticated()).toBe(false);
  });
  it('logout clears the state exactly once when it completes', () => {
    state.setSession(sessao); const clear = vi.spyOn(state, 'clear');
    service.logout().subscribe(); http.expectOne('/api/v1/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    expect(clear).toHaveBeenCalledTimes(1); expect(state.authenticated()).toBe(false);
  });
  it('logout ignores a 500 and still clears the state and completes', () => {
    state.setSession(sessao); let completed = false; let failed = false;
    service.logout().subscribe({ complete: () => completed = true, error: () => failed = true });
    http.expectOne('/api/v1/auth/logout').flush('erro', { status: 500, statusText: 'Server Error' });
    expect(failed).toBe(false); expect(completed).toBe(true); expect(state.authenticated()).toBe(false);
  });
});

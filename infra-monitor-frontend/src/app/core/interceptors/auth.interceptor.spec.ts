import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { authInterceptor, isProtectedApi } from './auth.interceptor';
import { apiErrorInterceptor } from './api-error.interceptor';
import { AuthStateService } from '../services/auth-state.service';

@Component({ template: '' }) class TestRouteComponent {}

describe('authInterceptor', () => {
  let http: HttpClient; let backend: HttpTestingController; let state: AuthStateService;
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'login', component: TestRouteComponent }, { path: 'forbidden', component: TestRouteComponent }, { path: 'trocar-senha', component: TestRouteComponent }, { path: 'dashboard', component: TestRouteComponent }]), provideHttpClient(withInterceptors([authInterceptor, apiErrorInterceptor])), provideHttpClientTesting()] }); http = TestBed.inject(HttpClient); backend = TestBed.inject(HttpTestingController); state = TestBed.inject(AuthStateService); state.setSession({ accessToken: 'test-token', tokenType: 'Bearer', expiresIn: 60, usuario: { id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN', trocaSenhaObrigatoria: false } }); });
  afterEach(() => backend.verify());
  it('adds bearer only to protected requests on the configured API', () => {
    http.get('http://localhost:8080/api/v1/dashboard/resumo').subscribe(); const dashboard = backend.expectOne('http://localhost:8080/api/v1/dashboard/resumo'); expect(dashboard.request.headers.get('Authorization')).toBe('Bearer test-token'); dashboard.flush({});
    http.post('http://localhost:8080/api/v1/auth/login', {}).subscribe(); const login = backend.expectOne('http://localhost:8080/api/v1/auth/login'); expect(login.request.headers.has('Authorization')).toBe(false); login.flush({});
    http.get('/assets/maps/se-municipalities.geo.json').subscribe(); const geo = backend.expectOne('/assets/maps/se-municipalities.geo.json'); expect(geo.request.headers.has('Authorization')).toBe(false); geo.flush({});
    http.get('https://example.invalid/resource').subscribe(); const external = backend.expectOne('https://example.invalid/resource'); expect(external.request.headers.has('Authorization')).toBe(false); external.flush({});
  });

  it('preserves a valid session and redirects to forbidden after a 403', async () => {
    const router = TestBed.inject(Router);
    http.post('http://localhost:8080/api/v1/equipamentos', {}).subscribe({ error: () => undefined });
    const request = backend.expectOne('http://localhost:8080/api/v1/equipamentos');
    request.flush({ timestamp: '', status: 403, error: 'Forbidden', code: 'FORBIDDEN', message: 'Sem permissão', path: '/api/v1/equipamentos' }, { status: 403, statusText: 'Forbidden' });
    await new Promise(resolve => setTimeout(resolve));

    expect(state.authenticated()).toBe(true);
    expect(router.url).toBe('/forbidden');
    await router.navigateByUrl('/dashboard');
    expect(state.authenticated()).toBe(true);
  });

  it('redirects PASSWORD_CHANGE_REQUIRED to the password-change screen without clearing the session', async () => {
    const router = TestBed.inject(Router);
    http.get('http://localhost:8080/api/v1/dashboard/resumo').subscribe({ error: () => undefined });
    backend.expectOne('http://localhost:8080/api/v1/dashboard/resumo').flush({ timestamp: '', status: 403, error: 'Forbidden', code: 'PASSWORD_CHANGE_REQUIRED', message: 'Troca obrigatÃ³ria', path: '/api/v1/dashboard/resumo' }, { status: 403, statusText: 'Forbidden' });
    await new Promise(resolve => setTimeout(resolve));

    expect(state.authenticated()).toBe(true);
    expect(router.url).toBe('/trocar-senha');
  });

  it('keeps the global password-change flow when an export error is JSON inside Blob', async () => {
    const router = TestBed.inject(Router);
    http.get('http://localhost:8080/api/v1/relatorios/medicoes/export', { responseType: 'blob' }).subscribe({ error: () => undefined });
    backend.expectOne(request => request.url.endsWith('/relatorios/medicoes/export')).flush(new Blob([JSON.stringify({ timestamp: '', status: 403, error: 'Forbidden', code: 'PASSWORD_CHANGE_REQUIRED', message: 'Troca obrigatória', path: '/api/v1/relatorios/medicoes/export' })], { type: 'application/json' }), { status: 403, statusText: 'Forbidden' });
    await new Promise(resolve => setTimeout(resolve));
    expect(state.authenticated()).toBe(true); expect(router.url).toBe('/trocar-senha');
  });

  it('keeps the global 401 flow when an export error is JSON inside Blob', async () => {
    const router = TestBed.inject(Router);
    http.get('http://localhost:8080/api/v1/relatorios/incidentes/export', { responseType: 'blob' }).subscribe({ error: () => undefined });
    backend.expectOne(request => request.url.endsWith('/relatorios/incidentes/export')).flush(new Blob([JSON.stringify({ timestamp: '', status: 401, error: 'Unauthorized', code: 'UNAUTHORIZED', message: 'Sessão expirada', path: '/api/v1/relatorios/incidentes/export' })], { type: 'application/json' }), { status: 401, statusText: 'Unauthorized' });
    await new Promise(resolve => setTimeout(resolve));
    expect(state.authenticated()).toBe(false); expect(router.url).toContain('/login');
  });
});

describe('isProtectedApi com a apiUrl relativa do build de produção', () => {
  const api = '/api/v1';
  it('protege a API na mesma origem, relativa ou absoluta', () => {
    expect(isProtectedApi('/api/v1/dashboard/resumo', api)).toBe(true);
    expect(isProtectedApi(`${window.location.origin}/api/v1/equipamentos`, api)).toBe(true);
  });
  it('deixa sem token o login, o GeoJSON local, outra origem e prefixo parecido', () => {
    expect(isProtectedApi('/api/v1/auth/login', api)).toBe(false);
    expect(isProtectedApi('assets/maps/se-municipalities.geo.json', api)).toBe(false);
    expect(isProtectedApi('https://example.invalid/api/v1/dashboard/resumo', api)).toBe(false);
    expect(isProtectedApi('/api/v10/dashboard', api)).toBe(false);
  });
});

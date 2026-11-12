import { provideHttpClient, withInterceptors, HttpClient, HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { REPETIDA_APOS_REFRESH, authInterceptor, isProtectedApi } from './auth.interceptor';
import { apiErrorInterceptor } from './api-error.interceptor';
import { AuthStateService } from '../services/auth-state.service';

@Component({ template: '' }) class TestRouteComponent {}
const REFRESH = '/api/v1/auth/refresh';
const sessao = { accessToken: 'test-token', tokenType: 'Bearer' as const, expiresIn: 60, usuario: { id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN' as const, trocaSenhaObrigatoria: false } };
const erro401 = { timestamp: '', status: 401, error: 'Unauthorized', code: 'UNAUTHORIZED', message: 'Token expirado', path: '/api/v1' };
const unauthorized = { status: 401, statusText: 'Unauthorized' };
const tick = () => new Promise(resolve => setTimeout(resolve));

describe('authInterceptor', () => {
  let http: HttpClient; let backend: HttpTestingController; let state: AuthStateService;
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'login', component: TestRouteComponent }, { path: 'forbidden', component: TestRouteComponent }, { path: 'trocar-senha', component: TestRouteComponent }, { path: 'dashboard', component: TestRouteComponent }]), provideHttpClient(withInterceptors([authInterceptor, apiErrorInterceptor])), provideHttpClientTesting()] }); http = TestBed.inject(HttpClient); backend = TestBed.inject(HttpTestingController); state = TestBed.inject(AuthStateService); state.setSession({ accessToken: 'test-token', tokenType: 'Bearer', expiresIn: 60, usuario: { id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN', trocaSenhaObrigatoria: false } }); });
  afterEach(() => backend.verify());
  it('adds bearer only to protected requests on the configured API', () => {
    http.get('/api/v1/dashboard/resumo').subscribe(); const dashboard = backend.expectOne('/api/v1/dashboard/resumo'); expect(dashboard.request.headers.get('Authorization')).toBe('Bearer test-token'); dashboard.flush({});
    http.post('/api/v1/auth/login', {}).subscribe(); const login = backend.expectOne('/api/v1/auth/login'); expect(login.request.headers.has('Authorization')).toBe(false); login.flush({});
    http.get('/assets/maps/se-municipalities.geo.json').subscribe(); const geo = backend.expectOne('/assets/maps/se-municipalities.geo.json'); expect(geo.request.headers.has('Authorization')).toBe(false); geo.flush({});
    http.get('https://example.invalid/resource').subscribe(); const external = backend.expectOne('https://example.invalid/resource'); expect(external.request.headers.has('Authorization')).toBe(false); external.flush({});
  });

  it('preserves a valid session and redirects to forbidden after a 403', async () => {
    const router = TestBed.inject(Router);
    http.post('/api/v1/equipamentos', {}).subscribe({ error: () => undefined });
    const request = backend.expectOne('/api/v1/equipamentos');
    request.flush({ timestamp: '', status: 403, error: 'Forbidden', code: 'FORBIDDEN', message: 'Sem permissão', path: '/api/v1/equipamentos' }, { status: 403, statusText: 'Forbidden' });
    await new Promise(resolve => setTimeout(resolve));

    expect(state.authenticated()).toBe(true);
    expect(router.url).toBe('/forbidden');
    await router.navigateByUrl('/dashboard');
    expect(state.authenticated()).toBe(true);
  });

  it('redirects PASSWORD_CHANGE_REQUIRED to the password-change screen without clearing the session', async () => {
    const router = TestBed.inject(Router);
    http.get('/api/v1/dashboard/resumo').subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/dashboard/resumo').flush({ timestamp: '', status: 403, error: 'Forbidden', code: 'PASSWORD_CHANGE_REQUIRED', message: 'Troca obrigatÃ³ria', path: '/api/v1/dashboard/resumo' }, { status: 403, statusText: 'Forbidden' });
    await new Promise(resolve => setTimeout(resolve));

    expect(state.authenticated()).toBe(true);
    expect(router.url).toBe('/trocar-senha');
  });

  it('keeps the global password-change flow when an export error is JSON inside Blob', async () => {
    const router = TestBed.inject(Router);
    http.get('/api/v1/relatorios/medicoes/export', { responseType: 'blob' }).subscribe({ error: () => undefined });
    backend.expectOne(request => request.url.endsWith('/relatorios/medicoes/export')).flush(new Blob([JSON.stringify({ timestamp: '', status: 403, error: 'Forbidden', code: 'PASSWORD_CHANGE_REQUIRED', message: 'Troca obrigatória', path: '/api/v1/relatorios/medicoes/export' })], { type: 'application/json' }), { status: 403, statusText: 'Forbidden' });
    await new Promise(resolve => setTimeout(resolve));
    expect(state.authenticated()).toBe(true); expect(router.url).toBe('/trocar-senha');
  });

  it('keeps the global 401 flow when an export error is JSON inside Blob: refresh 204 then login', async () => {
    const router = TestBed.inject(Router);
    http.get('/api/v1/relatorios/incidentes/export', { responseType: 'blob' }).subscribe({ error: () => undefined });
    backend.expectOne(request => request.url.endsWith('/relatorios/incidentes/export')).flush(new Blob([JSON.stringify({ timestamp: '', status: 401, error: 'Unauthorized', code: 'UNAUTHORIZED', message: 'Sessão expirada', path: '/api/v1/relatorios/incidentes/export' })], { type: 'application/json' }), { status: 401, statusText: 'Unauthorized' });
    await tick();
    backend.expectOne(REFRESH).flush(null, { status: 204, statusText: 'No Content' });
    await tick();
    expect(state.authenticated()).toBe(false); expect(router.url).toContain('/login'); expect(router.url).toContain('sessionExpired=1');
  });

  it('401 -> refresh 200 -> repeats once with the new Bearer and delivers the response', async () => {
    const router = TestBed.inject(Router); let body: unknown;
    http.get('/api/v1/dashboard/resumo').subscribe(response => body = response);
    backend.expectOne('/api/v1/dashboard/resumo').flush(erro401, unauthorized);
    const refresh = backend.expectOne(REFRESH); expect(refresh.request.headers.has('Authorization')).toBe(false); refresh.flush({ ...sessao, accessToken: 'novo-token' });
    const repetida = backend.expectOne('/api/v1/dashboard/resumo'); expect(repetida.request.headers.get('Authorization')).toBe('Bearer novo-token'); expect(repetida.request.context.get(REPETIDA_APOS_REFRESH)).toBe(true);
    repetida.flush({ ok: true }); await tick();
    expect(body).toEqual({ ok: true }); expect(state.accessToken()).toBe('novo-token'); expect(router.url).not.toContain('/login');
  });

  it('three simultaneous 401s share one refresh and each is repeated once', () => {
    const bodies: unknown[] = []; const urls = ['/api/v1/dashboard/resumo', '/api/v1/equipamentos', '/api/v1/incidentes'];
    urls.forEach(url => http.get(url).subscribe(response => bodies.push(response)));
    urls.forEach(url => backend.expectOne(url).flush(erro401, unauthorized));
    backend.expectOne(REFRESH).flush({ ...sessao, accessToken: 'novo-token' });
    urls.forEach(url => { const repetida = backend.expectOne(url); expect(repetida.request.headers.get('Authorization')).toBe('Bearer novo-token'); repetida.flush({ url }); });
    expect(bodies).toHaveLength(3);
  });

  it('a repeated request that gets 401 goes to login without a second refresh', async () => {
    const router = TestBed.inject(Router); let failure: unknown;
    http.get('/api/v1/dashboard/resumo').subscribe({ error: error => failure = error });
    backend.expectOne('/api/v1/dashboard/resumo').flush(erro401, unauthorized);
    backend.expectOne(REFRESH).flush({ ...sessao, accessToken: 'novo-token' });
    backend.expectOne('/api/v1/dashboard/resumo').flush(erro401, unauthorized);
    backend.expectNone(REFRESH); await tick();
    expect(failure).toBeInstanceOf(HttpErrorResponse); expect(state.authenticated()).toBe(false); expect(router.url).toContain('/login');
  });

  it('a 401 on the refresh itself does not trigger another refresh', async () => {
    const router = TestBed.inject(Router);
    http.get('/api/v1/dashboard/resumo').subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/dashboard/resumo').flush(erro401, unauthorized);
    backend.expectOne(REFRESH).flush(erro401, unauthorized);
    backend.expectNone(REFRESH); await tick();
    expect(state.authenticated()).toBe(false); expect(router.url).toContain('/login');
  });

  it('em /tv, refresh falho leva ao login com origem=tv, returnUrl=/tv e a hora do encerramento', async () => {
    const router = TestBed.inject(Router);
    router.resetConfig([...router.config, { path: 'tv', component: TestRouteComponent }]);
    await router.navigateByUrl('/tv');
    http.get('/api/v1/configuracoes/modo-tv').subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/configuracoes/modo-tv').flush(erro401, unauthorized);
    backend.expectOne(REFRESH).flush(null, { status: 204, statusText: 'No Content' });
    await tick();
    const url = router.parseUrl(router.url);
    expect(router.url).toContain('/login');
    expect(router.url).toContain('origem=tv');
    expect(router.url).toContain('returnUrl=%2Ftv');
    expect(url.queryParams['sessionExpired']).toBe('1');
    expect(url.queryParams['encerradaEm']).toMatch(/^\d{2}:\d{2}$/);
  });

  it('fora de /tv, refresh falho mantém o login como hoje', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/dashboard');
    http.get('/api/v1/dashboard/resumo').subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/dashboard/resumo').flush(erro401, unauthorized);
    backend.expectOne(REFRESH).flush(null, { status: 204, statusText: 'No Content' });
    await tick();
    expect(router.url).toBe('/login?sessionExpired=1');
  });

  it('refresh and logout never receive Authorization', () => {
    http.post(REFRESH, {}).subscribe(); const refresh = backend.expectOne(REFRESH); expect(refresh.request.headers.has('Authorization')).toBe(false); refresh.flush(null, { status: 204, statusText: 'No Content' });
    http.post('/api/v1/auth/logout', {}).subscribe(); const logout = backend.expectOne('/api/v1/auth/logout'); expect(logout.request.headers.has('Authorization')).toBe(false); logout.flush(null, { status: 204, statusText: 'No Content' });
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
    expect(isProtectedApi('/api/v1/auth/refresh', api)).toBe(false);
    expect(isProtectedApi('/api/v1/auth/logout', api)).toBe(false);
    expect(isProtectedApi('/api/v1/auth/me', api)).toBe(true);
    expect(isProtectedApi('assets/maps/se-municipalities.geo.json', api)).toBe(false);
    expect(isProtectedApi('https://example.invalid/api/v1/dashboard/resumo', api)).toBe(false);
    expect(isProtectedApi('/api/v10/dashboard', api)).toBe(false);
  });
});

describe('isProtectedApi com uma apiUrl absoluta em outra origem', () => {
  const api = 'http://localhost:8080/api/v1';
  it('protege só a API daquela origem, não a mesma rota na origem do front', () => {
    expect(isProtectedApi('http://localhost:8080/api/v1/dashboard/resumo', api)).toBe(true);
    expect(isProtectedApi('http://localhost:8080/api/v1/auth/login', api)).toBe(false);
    expect(isProtectedApi('/api/v1/dashboard/resumo', api)).toBe(false);
    expect(isProtectedApi('http://localhost:8081/api/v1/dashboard/resumo', api)).toBe(false);
  });
});

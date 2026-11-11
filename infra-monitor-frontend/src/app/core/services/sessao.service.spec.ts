import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { authInterceptor } from '../interceptors/auth.interceptor';
import { LoginResponse } from '../models/auth';
import { AuthStateService } from './auth-state.service';
import { SessaoService } from './sessao.service';

const session: LoginResponse = { accessToken: 'renovado', tokenType: 'Bearer', expiresIn: 900, usuario: { id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN', trocaSenhaObrigatoria: false } };
const REFRESH = '/api/v1/auth/refresh';

describe('SessaoService', () => {
  let service: SessaoService; let backend: HttpTestingController; let state: AuthStateService;
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()] }); service = TestBed.inject(SessaoService); backend = TestBed.inject(HttpTestingController); state = TestBed.inject(AuthStateService); });
  afterEach(() => { vi.useRealTimers(); backend.verify(); });

  it('restaurar com 200 abre a sessão', async () => {
    const restaurada = service.restaurar(); backend.expectOne(REFRESH).flush(session); await restaurada;
    expect(state.authenticated()).toBe(true); expect(state.accessToken()).toBe('renovado');
  });
  it('restaurar com 204 resolve sem sessão', async () => {
    const restaurada = service.restaurar(); backend.expectOne(REFRESH).flush(null, { status: 204, statusText: 'No Content' });
    await expect(restaurada).resolves.toBeUndefined(); expect(state.authenticated()).toBe(false);
  });
  it('restaurar com erro de rede resolve sem sessão', async () => {
    const restaurada = service.restaurar(); backend.expectOne(REFRESH).error(new ProgressEvent('error'));
    await expect(restaurada).resolves.toBeUndefined(); expect(state.authenticated()).toBe(false);
  });
  it('restaurar com 502 do proxy resolve sem sessão', async () => {
    const restaurada = service.restaurar(); backend.expectOne(REFRESH).flush('Bad Gateway', { status: 502, statusText: 'Bad Gateway' });
    await expect(restaurada).resolves.toBeUndefined(); expect(state.authenticated()).toBe(false);
  });
  it('restaurar resolve sem sessão depois de 8 s sem resposta', async () => {
    vi.useFakeTimers();
    const restaurada = service.restaurar(); const request = backend.expectOne(REFRESH);
    vi.advanceTimersByTime(7999); expect(request.cancelled).toBe(false);
    vi.advanceTimersByTime(1); await expect(restaurada).resolves.toBeUndefined();
    expect(request.cancelled).toBe(true); expect(state.authenticated()).toBe(false);
  });
  it('o refresh é POST com X-Requested-With e nunca leva Authorization, mesmo com token em memória', () => {
    state.setSession({ ...session, accessToken: 'vencido' });
    service.renovar().subscribe(); const request = backend.expectOne(REFRESH);
    expect(request.request.method).toBe('POST'); expect(request.request.body).toEqual({});
    expect(request.request.headers.get('X-Requested-With')).toBe('XMLHttpRequest'); expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush(session);
  });
  it('renovar em paralelo faz um só POST e entrega o token a todos', () => {
    const tokens: (string | null)[] = [];
    for (let i = 0; i < 3; i++) service.renovar().subscribe(token => tokens.push(token));
    backend.expectOne(REFRESH).flush(session);
    expect(tokens).toEqual(['renovado', 'renovado', 'renovado']);
  });
  it('renovar depois de um voo encerrado faz um POST novo', () => {
    const tokens: (string | null)[] = [];
    service.renovar().subscribe(token => tokens.push(token)); backend.expectOne(REFRESH).flush(null, { status: 204, statusText: 'No Content' });
    service.renovar().subscribe(token => tokens.push(token)); backend.expectOne(REFRESH).flush(session);
    expect(tokens).toEqual([null, 'renovado']);
  });
});

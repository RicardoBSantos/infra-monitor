import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { AuthStateService } from './auth-state.service';

describe('AuthService', () => {
  let service: AuthService; let http: HttpTestingController; let state: AuthStateService;
  beforeEach(() => { TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] }); service = TestBed.inject(AuthService); http = TestBed.inject(HttpTestingController); state = TestBed.inject(AuthStateService); });
  afterEach(() => http.verify());
  it('uses the auth contracts and updates/clears only in-memory state', () => {
    service.login('admin@example.test', 'secret').subscribe(); const login = http.expectOne('http://localhost:8080/api/v1/auth/login'); expect(login.request.method).toBe('POST'); expect(login.request.body).toEqual({ email: 'admin@example.test', senha: 'secret' }); login.flush({ accessToken: 'token', tokenType: 'Bearer', expiresIn: 60, usuario: { id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN', trocaSenhaObrigatoria: false } }); expect(state.authenticated()).toBe(true);
    service.me().subscribe(); const me = http.expectOne('http://localhost:8080/api/v1/auth/me'); expect(me.request.method).toBe('GET'); me.flush({ id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN', trocaSenhaObrigatoria: false });
    service.changeOwnPassword({ senhaAtual: 'old', novaSenha: 'new-password-123' }).subscribe(); const change = http.expectOne('http://localhost:8080/api/v1/usuarios/me/senha'); expect(change.request.method).toBe('PUT'); expect(change.request.body).toEqual({ senhaAtual: 'old', novaSenha: 'new-password-123' }); change.flush(null);
    service.logout(); expect(state.authenticated()).toBe(false);
  });
});

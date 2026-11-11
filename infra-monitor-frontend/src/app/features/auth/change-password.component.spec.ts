import { Component } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthStateService } from '../../core/services/auth-state.service';
import { ChangePasswordComponent } from './change-password.component';

@Component({ template: '' }) class RotaVazia {}
const usuario = { id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN' as const, trocaSenhaObrigatoria: true };
const NOVA = 'nova-senha-segura-123';

describe('ChangePasswordComponent', () => {
  let backend: HttpTestingController; let state: AuthStateService; let router: Router;
  let componente: { form: ChangePasswordComponent['form']; submit(): void; error(): string | null };
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ChangePasswordComponent], providers: [provideRouter([{ path: 'dashboard', component: RotaVazia }]), provideHttpClient(), provideHttpClientTesting()] });
    backend = TestBed.inject(HttpTestingController); state = TestBed.inject(AuthStateService); router = TestBed.inject(Router);
    state.setSession({ accessToken: 'antigo', tokenType: 'Bearer', expiresIn: 900, usuario });
    componente = TestBed.createComponent(ChangePasswordComponent).componentInstance as unknown as typeof componente;
    componente.form.setValue({ senhaAtual: 'temporaria', novaSenha: NOVA, confirmacaoNovaSenha: NOVA });
  });
  afterEach(() => backend.verify());

  it('após a troca refaz o login com a senha nova e vai ao painel', async () => {
    componente.submit();
    backend.expectOne('/api/v1/usuarios/me/senha').flush(null);
    const login = backend.expectOne('/api/v1/auth/login'); expect(login.request.body).toEqual({ email: usuario.email, senha: NOVA });
    login.flush({ accessToken: 'novo', tokenType: 'Bearer', expiresIn: 900, usuario: { ...usuario, trocaSenhaObrigatoria: false } });
    await new Promise(resolve => setTimeout(resolve));
    expect(state.accessToken()).toBe('novo'); expect(router.url).toBe('/dashboard');
  });
  it('mantém a mensagem se o servidor ainda exigir a troca', () => {
    componente.submit();
    backend.expectOne('/api/v1/usuarios/me/senha').flush(null);
    backend.expectOne('/api/v1/auth/login').flush({ accessToken: 'novo', tokenType: 'Bearer', expiresIn: 900, usuario });
    expect(componente.error()).toBe('A troca ainda não foi confirmada pelo servidor.');
  });
});

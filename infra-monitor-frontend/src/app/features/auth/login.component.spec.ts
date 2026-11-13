import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { LoginComponent } from './login.component';

function montar(queryParams: Record<string, string>) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } }] });
  const fixture = TestBed.createComponent(LoginComponent); fixture.detectChanges();
  return fixture;
}
const alertas = (el: HTMLElement) => Array.from(el.querySelectorAll('[role="alert"]')).map(a => a.textContent?.replace(/\s+/g, ' ').trim());

describe('LoginComponent — sessão encerrada no modo TV', () => {
  it('mostra a faixa grande do modo TV com a hora do encerramento, sem o aviso genérico', () => {
    const fixture = montar({ sessionExpired: '1', origem: 'tv', returnUrl: '/tv', encerradaEm: '14:05' });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.login-tv')).not.toBeNull();
    expect(alertas(el)).toEqual(['Modo TV parado: a sessão encerrou às 14:05. Entre novamente para retomar.']);
  });

  it('sem hora válida, a faixa não inventa horário', () => {
    const fixture = montar({ sessionExpired: '1', origem: 'tv', encerradaEm: '<b>x</b>' });
    expect(alertas(fixture.nativeElement)).toEqual(['Modo TV parado: a sessão encerrou. Entre novamente para retomar.']);
  });

  it('fora do modo TV mantém o aviso de sessão expirada de hoje', () => {
    const fixture = montar({ sessionExpired: '1' });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.login-tv')).toBeNull();
    expect(alertas(el)).toEqual(['Sua sessão expirou. Entre novamente.']);
  });

  it('ao entrar, volta para /tv', () => {
    const fixture = montar({ sessionExpired: '1', origem: 'tv', returnUrl: '/tv', encerradaEm: '14:05' });
    const nav = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const el = fixture.nativeElement as HTMLElement;
    const email = el.querySelector<HTMLInputElement>('#login-email')!; email.value = 'tv@example.test'; email.dispatchEvent(new Event('input'));
    const senha = el.querySelector<HTMLInputElement>('#login-senha')!; senha.value = 'segredo'; senha.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    TestBed.inject(HttpTestingController).expectOne(r => r.url.endsWith('/auth/login')).flush({ accessToken: 't', tokenType: 'Bearer', expiresIn: 60, usuario: { id: 9, nome: 'TV', email: 'tv@example.test', papel: 'VISUALIZADOR', trocaSenhaObrigatoria: false } });
    expect(nav).toHaveBeenCalledWith('/tv');
  });
});

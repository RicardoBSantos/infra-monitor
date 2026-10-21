import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NotificacaoTelegramComponent } from './notificacao-telegram.component';

@Component({ template: '' })
class AbaVazia {}

describe('NotificacaoTelegramComponent', () => {
  let fixture: ComponentFixture<NotificacaoTelegramComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [NotificacaoTelegramComponent],
      providers: [provideRouter([
        { path: 'configuracao', component: AbaVazia },
        { path: 'historico', component: AbaVazia },
      ])],
    });
    fixture = TestBed.createComponent(NotificacaoTelegramComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function abas(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]'));
  }

  it('ArrowRight na primeira aba foca a segunda', async () => {
    const [primeira, segunda] = abas();
    primeira.focus();
    primeira.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(document.activeElement).toBe(segunda);
  });

  it('End foca a última aba', async () => {
    const lista = abas();
    lista[0].focus();
    lista[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(document.activeElement).toBe(lista[lista.length - 1]);
  });

  it('usa a casca .pagina com cabeçalho sem sobretítulo', () => {
    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelector('section.telegram.pagina')).toBeTruthy();
    expect(raiz.querySelector('.pagina__cabecalho h1')?.textContent).toContain('Notificação via Telegram');
    expect(raiz.querySelector('.telegram__secao')).toBeNull();
    expect(raiz.querySelector('header small')).toBeNull();
  });
});

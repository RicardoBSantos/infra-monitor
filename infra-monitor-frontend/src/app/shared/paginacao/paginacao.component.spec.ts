import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { PaginacaoComponent } from './paginacao.component';

@Component({
  imports: [PaginacaoComponent],
  template: '<app-paginacao [paginaAtual]="pagina()" [totalPaginas]="3" contagem="20 de 60 itens" (mudarPagina)="destino.set($event)" />',
})
class PaginacaoHostComponent {
  readonly pagina = signal(2);
  readonly destino = signal<number | null>(null);
}

function montar() {
  const fixture = TestBed.createComponent(PaginacaoHostComponent);
  fixture.detectChanges();
  const elemento = fixture.nativeElement as HTMLElement;
  const botoes = Array.from(elemento.querySelectorAll('button'));
  return { fixture, elemento, anterior: botoes[0], proxima: botoes[1] };
}

describe('PaginacaoComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PaginacaoHostComponent] }).compileComponents();
  });

  it('mostra a posição e a contagem em vez de pills numeradas', () => {
    const { elemento } = montar();

    expect(elemento.textContent).toContain('Página 2 de 3');
    expect(elemento.textContent).toContain('20 de 60 itens');
    expect(elemento.querySelectorAll('button').length).toBe(2);
  });

  it('desabilita Anterior na primeira página e Próxima na última', () => {
    const { fixture, anterior, proxima } = montar();

    expect(anterior.disabled).toBe(false);
    expect(proxima.disabled).toBe(false);

    fixture.componentInstance.pagina.set(1);
    fixture.detectChanges();
    expect(anterior.disabled).toBe(true);

    fixture.componentInstance.pagina.set(3);
    fixture.detectChanges();
    expect(proxima.disabled).toBe(true);
  });

  it('emite a página de destino ao navegar', () => {
    const { fixture, anterior, proxima } = montar();

    proxima.click();
    expect(fixture.componentInstance.destino()).toBe(3);

    anterior.click();
    expect(fixture.componentInstance.destino()).toBe(1);
  });
});

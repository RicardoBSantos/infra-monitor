import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ActionMenuComponent, ActionMenuItem } from './action-menu.component';

const ITENS: ActionMenuItem[] = [
  { id: 'ver', rotulo: 'Ver' },
  { id: 'editar', rotulo: 'Editar' },
  { id: 'desativar', rotulo: 'Desativar monitoramento', desabilitado: true },
  { id: 'excluir', rotulo: 'Excluir', divisorAntes: true, destrutivo: true },
];

@Component({
  imports: [ActionMenuComponent],
  template: '<app-action-menu [itens]="itens" rotuloContexto="SW-CORE" (selecionar)="escolhido.set($event)" />',
})
class HospedeiroComponent {
  readonly itens = ITENS;
  readonly escolhido = signal<string | null>(null);
}

describe('ActionMenuComponent', () => {
  let fixture: ComponentFixture<HospedeiroComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HospedeiroComponent] }).compileComponents();
    fixture = TestBed.createComponent(HospedeiroComponent);
    fixture.detectChanges();
  });

  function elemento(): HTMLElement { return fixture.nativeElement as HTMLElement; }
  function gatilho(): HTMLButtonElement { return elemento().querySelector('.menu-acoes__gatilho')!; }
  function itens(): HTMLButtonElement[] { return [...elemento().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]; }

  function abrir(): void {
    gatilho().click();
    fixture.detectChanges();
  }

  it('fica fechado até o clique e descreve o contexto no gatilho', () => {
    expect(elemento().querySelector('[role="menu"]')).toBeNull();
    expect(gatilho().getAttribute('aria-label')).toBe('Ações de SW-CORE');
    expect(gatilho().getAttribute('aria-expanded')).toBe('false');
    expect(gatilho().getAttribute('aria-haspopup')).toBe('menu');
  });

  it('abre por clique com role de menu e foco no primeiro item', async () => {
    abrir();
    await fixture.whenStable();

    expect(elemento().querySelector('[role="menu"]')).not.toBeNull();
    expect(gatilho().getAttribute('aria-expanded')).toBe('true');
    expect(itens().map((item) => item.textContent?.trim()))
      .toEqual(['Ver', 'Editar', 'Desativar monitoramento', 'Excluir']);
    expect(document.activeElement).toBe(itens()[0]);
  });

  it('abre por Enter e por seta para baixo no gatilho', () => {
    gatilho().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(elemento().querySelector('[role="menu"]')).not.toBeNull();

    gatilho().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    elemento().querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    gatilho().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(elemento().querySelector('[role="menu"]')).not.toBeNull();
  });

  it('navega por setas pulando itens desabilitados e volta ao início', async () => {
    abrir();
    await fixture.whenStable();
    const menu = elemento().querySelector('[role="menu"]')!;

    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(itens()[1]);

    // "Desativar" está desabilitado: a seta tem de saltar direto para "Excluir".
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(itens()[3]);

    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(itens()[0]);

    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    fixture.detectChanges();
    expect(document.activeElement).toBe(itens()[3]);
  });

  it('fecha por Esc devolvendo o foco ao gatilho', async () => {
    abrir();
    await fixture.whenStable();

    elemento().querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(elemento().querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(gatilho());
  });

  it('fecha ao clicar fora sem emitir seleção', () => {
    abrir();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();

    expect(elemento().querySelector('[role="menu"]')).toBeNull();
    expect(fixture.componentInstance.escolhido()).toBeNull();
  });

  it('emite o item escolhido e fecha o menu', () => {
    abrir();

    itens()[1].click();
    fixture.detectChanges();

    expect(fixture.componentInstance.escolhido()).toBe('editar');
    expect(elemento().querySelector('[role="menu"]')).toBeNull();
  });

  it('ignora clique em item desabilitado', () => {
    abrir();

    itens()[2].click();
    fixture.detectChanges();

    expect(fixture.componentInstance.escolhido()).toBeNull();
  });

  /**
   * `{ ...new DOMRect() }` devolve objeto vazio — as propriedades são getters de protótipo.
   * O menu lê `top`, `bottom` e `right`, então o retângulo precisa ser montado à mão.
   */
  function fingirRetangulo(parcial: Partial<DOMRect>): void {
    const base = { top: 0, right: 0, bottom: 0, left: 0, width: 28, height: 28, x: 0, y: 0 };
    vi.spyOn(gatilho(), 'getBoundingClientRect')
      .mockReturnValue({ ...base, ...parcial, toJSON: () => ({}) } as DOMRect);
  }

  function lista(): HTMLElement { return elemento().querySelector('.menu-acoes__lista')!; }

  it('abre para cima quando não há espaço abaixo do gatilho', () => {
    // Última linha visível: o gatilho encosta no rodapé da janela.
    fingirRetangulo({ top: window.innerHeight - 28, bottom: window.innerHeight - 4, right: 900 });

    abrir();

    expect(elemento().querySelector('.menu-acoes__lista--acima')).not.toBeNull();
    expect(Number.parseFloat(lista().style.top)).toBeLessThan(window.innerHeight - 28);
  });

  it('posiciona a lista fora do fluxo, ancorada na direita do gatilho', () => {
    fingirRetangulo({ top: 100, bottom: 128, right: 600 });

    abrir();

    // `fixed` é o que a tira do overflow do wrapper da tabela; absoluto voltaria a ser cortado.
    expect(lista().style.position === '' ? getComputedStyle(lista()).position : lista().style.position)
      .not.toBe('absolute');
    expect(lista().style.top).toBe('132px');
    expect(lista().style.left).toBe(`${600 - 168}px`);
  });

  it('recua o menu para dentro da janela quando o gatilho está colado na borda direita', () => {
    fingirRetangulo({ top: 100, bottom: 128, right: window.innerWidth });

    abrir();

    // 168 é o min-width da lista; 8 a margem mínima da janela.
    expect(lista().style.left).toBe(`${window.innerWidth - 168 - 8}px`);
  });

  it('não deixa o menu sair pela esquerda em viewport estreita', () => {
    fingirRetangulo({ top: 100, bottom: 128, right: 60 });

    abrir();

    expect(lista().style.left).toBe('8px');
  });

  it('fecha ao rolar um ancestral, porque a coordenada fixa não acompanha a rolagem', () => {
    abrir();

    document.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();

    expect(elemento().querySelector('[role="menu"]')).toBeNull();
  });
});

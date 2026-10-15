import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModalComponent } from './modal.component';

@Component({
  imports: [ModalComponent],
  template: `
    <button id="gatilho" type="button" (click)="aberto.set(true)">abrir</button>
    <app-modal [aberto]="aberto()" titulo="Novo registro" [subtitulo]="subtitulo()" [bloqueado]="bloqueado()" (fechar)="fechamentos = fechamentos + 1; aberto.set(false)">
      <form><input id="campo" [disabled]="semCampo()"></form>
    </app-modal>
    <app-modal [aberto]="false" titulo="Outro" (fechar)="outros = outros + 1" />
  `,
})
class Hospedeiro {
  readonly aberto = signal(false);
  readonly bloqueado = signal(false);
  readonly semCampo = signal(false);
  readonly subtitulo = signal<string | null>(null);
  fechamentos = 0;
  outros = 0;
}

describe('ModalComponent', () => {
  const montar = () => {
    TestBed.configureTestingModule({ imports: [Hospedeiro] });
    const fixture = TestBed.createComponent(Hospedeiro);
    fixture.detectChanges();
    return fixture;
  };
  const el = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement;
  const abrir = (fixture: ReturnType<typeof montar>) => {
    const gatilho = el(fixture).querySelector<HTMLButtonElement>('#gatilho')!;
    gatilho.focus();
    gatilho.click();
    fixture.detectChanges();
    return gatilho;
  };
  const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  it('não renderiza nada fechado', () => {
    const fixture = montar();
    expect(el(fixture).querySelector('[role="dialog"]')).toBeNull();
  });

  it('aberto expõe role, aria-modal, título ligado por aria-labelledby, × e largura padrão', () => {
    const fixture = montar();
    abrir(fixture);
    const painel = el(fixture).querySelector<HTMLElement>('section.modal')!;
    expect(painel.getAttribute('role')).toBe('dialog');
    expect(painel.getAttribute('aria-modal')).toBe('true');
    const titulo = painel.querySelector('h2')!;
    expect(titulo.textContent).toContain('Novo registro');
    expect(painel.getAttribute('aria-labelledby')).toBe(titulo.id);
    expect(painel.querySelector('button.modal__fechar[aria-label="Fechar"]')).not.toBeNull();
    expect(painel.style.width).toContain('520px');
    expect(el(fixture).querySelector('.modal__fundo')).not.toBeNull();
  });

  it('subtítulo só aparece quando informado', () => {
    const fixture = montar();
    abrir(fixture);
    expect(el(fixture).querySelector('.modal__topo p')).toBeNull();
    fixture.componentInstance.subtitulo.set('Explicação curta');
    fixture.detectChanges();
    expect(el(fixture).querySelector('.modal__topo p')!.textContent).toContain('Explicação curta');
  });

  it('ids de título são únicos por instância', () => {
    const a = TestBed.createComponent(ModalComponent);
    a.componentRef.setInput('titulo', 'A');
    a.componentRef.setInput('aberto', true);
    a.detectChanges();
    const b = TestBed.createComponent(ModalComponent);
    b.componentRef.setInput('titulo', 'B');
    b.componentRef.setInput('aberto', true);
    b.detectChanges();
    const idA = (a.nativeElement as HTMLElement).querySelector('h2')!.id;
    const idB = (b.nativeElement as HTMLElement).querySelector('h2')!.id;
    expect(idA).not.toBe('');
    expect(idA).not.toBe(idB);
  });

  it('× emite fechar', () => {
    const fixture = montar();
    abrir(fixture);
    el(fixture).querySelector<HTMLButtonElement>('.modal__fechar')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.fechamentos).toBe(1);
    expect(el(fixture).querySelector('[role="dialog"]')).toBeNull();
  });

  it('Escape no document fecha mesmo com o foco fora do painel, e o modal fechado ignora', () => {
    const fixture = montar();
    abrir(fixture);
    (document.activeElement as HTMLElement | null)?.blur();
    escape();
    fixture.detectChanges();
    expect(fixture.componentInstance.fechamentos).toBe(1);
    expect(fixture.componentInstance.outros).toBe(0);
    escape();
    expect(fixture.componentInstance.fechamentos).toBe(1);
  });

  it('clique que começa e termina no fundo fecha; clique no painel não', () => {
    const fixture = montar();
    abrir(fixture);
    const fundo = el(fixture).querySelector<HTMLElement>('.modal__fundo')!;
    const painel = el(fixture).querySelector<HTMLElement>('section.modal')!;
    painel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    painel.click();
    expect(fixture.componentInstance.fechamentos).toBe(0);
    fundo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fundo.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.fechamentos).toBe(1);
  });

  it('arrastar de dentro do campo até o fundo não fecha', () => {
    const fixture = montar();
    abrir(fixture);
    const fundo = el(fixture).querySelector<HTMLElement>('.modal__fundo')!;
    el(fixture).querySelector<HTMLElement>('#campo')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fundo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(fixture.componentInstance.fechamentos).toBe(0);
  });

  it('bloqueado: ×, Escape e fundo não fecham, e o × fica desabilitado', () => {
    const fixture = montar();
    abrir(fixture);
    fixture.componentInstance.bloqueado.set(true);
    fixture.detectChanges();
    const fechar = el(fixture).querySelector<HTMLButtonElement>('.modal__fechar')!;
    expect(fechar.disabled).toBe(true);
    fechar.click();
    escape();
    const fundo = el(fixture).querySelector<HTMLElement>('.modal__fundo')!;
    fundo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fundo.click();
    expect(fixture.componentInstance.fechamentos).toBe(0);
  });

  it('foco vai ao primeiro campo ao abrir e volta ao gatilho ao fechar', () => {
    const fixture = montar();
    const gatilho = abrir(fixture);
    expect(document.activeElement).toBe(el(fixture).querySelector('#campo'));
    escape();
    fixture.detectChanges();
    expect(document.activeElement).toBe(gatilho);
  });

  it('sem campo focável, o foco vai ao painel', () => {
    const fixture = montar();
    fixture.componentInstance.semCampo.set(true);
    fixture.detectChanges();
    abrir(fixture);
    expect(document.activeElement).toBe(el(fixture).querySelector('section.modal'));
  });
});

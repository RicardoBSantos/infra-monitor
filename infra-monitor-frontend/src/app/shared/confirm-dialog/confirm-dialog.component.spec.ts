import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmDialogComponent } from './confirm-dialog.component';

@Component({
  imports: [ConfirmDialogComponent],
  template: `
    <aside id="gaveta" tabindex="-1" (keydown)="aoTeclarGaveta($event)">
      <button id="gatilho" type="button" (click)="aberto.set(true)">abrir</button>
      <app-confirm-dialog [open]="aberto()" title="Excluir unidade?" message="Não dá para desfazer." [busy]="busy()" [erro]="erro()"
        (cancel)="cancelamentos = cancelamentos + 1; aberto.set(false)" (confirm)="confirmacoes = confirmacoes + 1" />
    </aside>
    <app-confirm-dialog [open]="false" title="Outro" message="m" (cancel)="outros = outros + 1" />
  `,
})
class Hospedeiro {
  readonly aberto = signal(false);
  readonly busy = signal(false);
  readonly erro = signal<string | null>(null);
  cancelamentos = 0; confirmacoes = 0; outros = 0; gavetaFechou = 0;
  // Igual ao unidade-form-drawer: Escape no painel da gaveta faz stopPropagation e tenta fechar.
  aoTeclarGaveta(e: KeyboardEvent): void { if (e.key === 'Escape') { e.stopPropagation(); this.gavetaFechou++; } }
}

describe('ConfirmDialogComponent', () => {
  const montar = () => {
    TestBed.configureTestingModule({ imports: [Hospedeiro] });
    const fixture = TestBed.createComponent(Hospedeiro);
    fixture.detectChanges();
    return fixture;
  };
  const el = (f: { nativeElement: HTMLElement }) => f.nativeElement;
  const abrir = (f: ReturnType<typeof montar>) => {
    const g = el(f).querySelector<HTMLButtonElement>('#gatilho')!;
    g.focus(); g.click(); f.detectChanges();
    return g;
  };
  const tecla = (alvo: EventTarget, key: string, shiftKey = false) => {
    const e = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    alvo.dispatchEvent(e);
    return e;
  };
  const painel = (f: ReturnType<typeof montar>) => el(f).querySelector<HTMLElement>('.confirm-dialog')!;
  const botoes = (f: ReturnType<typeof montar>) => Array.from(painel(f).querySelectorAll<HTMLButtonElement>('button'));

  it('aberto: alertdialog modal, título e mensagem ligados por id único', () => {
    const f = montar();
    abrir(f);
    const p = painel(f);
    expect(p.getAttribute('role')).toBe('alertdialog');
    expect(p.getAttribute('aria-modal')).toBe('true');
    const titulo = p.querySelector('h2')!; const msg = p.querySelector('p')!;
    expect(p.getAttribute('aria-labelledby')).toBe(titulo.id);
    expect(p.getAttribute('aria-describedby')).toBe(msg.id);
    expect(titulo.id).not.toBe('confirm-title');
  });

  it('foco vai para Cancelar ao abrir e volta ao gatilho ao fechar', () => {
    const f = montar();
    const g = abrir(f);
    expect(document.activeElement!.textContent!.trim()).toBe('Cancelar');
    tecla(document.activeElement!, 'Escape');
    f.detectChanges();
    expect(painel(f)).toBeNull();
    expect(document.activeElement).toBe(g);
  });

  it('Escape no document (foco fora do painel) cancela; o fechado não emite', () => {
    const f = montar();
    abrir(f);
    (document.activeElement as HTMLElement).blur();
    tecla(document, 'Escape');
    expect(f.componentInstance.cancelamentos).toBe(1);
    expect(f.componentInstance.outros).toBe(0);
  });

  it('Escape dentro do diálogo aninhado na gaveta não chega à gaveta', () => {
    const f = montar();
    abrir(f);
    tecla(document.activeElement!, 'Escape');
    expect(f.componentInstance.cancelamentos).toBe(1);
    expect(f.componentInstance.gavetaFechou).toBe(0);
  });

  it('Tab cicla entre Cancelar e Confirmar; Shift+Tab também', () => {
    const f = montar();
    abrir(f);
    const [cancelar, confirmar] = botoes(f);
    confirmar.focus();
    tecla(confirmar, 'Tab');
    expect(document.activeElement).toBe(cancelar);
    tecla(cancelar, 'Tab', true);
    expect(document.activeElement).toBe(confirmar);
  });

  it('busy: Escape, fundo e Cancelar não cancelam', () => {
    const f = montar();
    abrir(f);
    f.componentInstance.busy.set(true); f.detectChanges();
    tecla(document, 'Escape');
    const fundo = el(f).querySelector<HTMLElement>('.dialog-backdrop')!;
    fundo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fundo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    botoes(f)[0].click();
    expect(f.componentInstance.cancelamentos).toBe(0);
  });

  it('clique que começa e termina no fundo cancela; clique no painel não', () => {
    const f = montar();
    abrir(f);
    painel(f).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    painel(f).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(f.componentInstance.cancelamentos).toBe(0);
    const fundo = el(f).querySelector<HTMLElement>('.dialog-backdrop')!;
    fundo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fundo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(f.componentInstance.cancelamentos).toBe(1);
  });

  it('Confirmar emite confirm', () => {
    const f = montar();
    abrir(f);
    botoes(f)[1].click();
    expect(f.componentInstance.confirmacoes).toBe(1);
  });

  it('busy: com os botões desabilitados o foco fica no painel, não no body, e Tab/Escape ainda chegam ao handler', () => {
    const f = montar();
    abrir(f);
    f.componentInstance.busy.set(true); f.detectChanges();
    expect(document.activeElement).toBe(painel(f));
    const e = tecla(document.activeElement!, 'Tab');
    expect(e.defaultPrevented).toBe(true);
  });

  it('recusa: busy volta a false com o diálogo aberto e o foco perdido -> foco volta a Cancelar', () => {
    const f = montar();
    abrir(f);
    f.componentInstance.erro.set('Recusado.'); f.detectChanges(); // erro de uma tentativa anterior já na tela
    f.componentInstance.busy.set(true); f.detectChanges();
    // O navegador tira o foco do botão desabilitado; aqui o foco vai para fora do painel (a página atrás).
    const fora = document.createElement('button'); document.body.appendChild(fora); fora.focus();
    expect(painel(f).contains(document.activeElement)).toBe(false);
    f.componentInstance.busy.set(false); f.detectChanges();
    expect(painel(f)).not.toBeNull();
    expect(document.activeElement).toBe(botoes(f)[0]);
    expect(document.activeElement!.textContent!.trim()).toBe('Cancelar');
    fora.remove();
  });
});

@Component({
  imports: [ConfirmDialogComponent],
  template: `<app-confirm-dialog [open]="true" title="Iniciar manutenção de X?" message="m" confirmLabel="Iniciar manutenção" [confirmTone]="tom()" />`,
})
class HospedeiroTom { readonly tom = signal<'perigo' | 'primario'>('primario'); }

@Component({
  imports: [ConfirmDialogComponent],
  template: `<app-confirm-dialog [open]="true" title="Excluir?" message="m" />`,
})
class HospedeiroSemTom {}

describe('ConfirmDialogComponent — tom do botão de confirmar', () => {
  it('usa --primario quando pedido, sem --perigo', () => {
    TestBed.configureTestingModule({ imports: [HospedeiroTom] });
    const fixture = TestBed.createComponent(HospedeiroTom);
    fixture.detectChanges();
    const botao = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((b) => b.textContent?.includes('Iniciar manutenção'))!;
    expect(botao.classList).toContain('botao--primario');
    expect(botao.classList).not.toContain('botao--perigo');
    const painel = (fixture.nativeElement as HTMLElement).querySelector('.confirm-dialog')!;
    expect(painel.classList).toContain('confirm-dialog--primario');
  });

  it('continua --perigo por padrão para os chamadores existentes', () => {
    TestBed.configureTestingModule({ imports: [HospedeiroSemTom] });
    const fixture = TestBed.createComponent(HospedeiroSemTom);
    fixture.detectChanges();
    const botao = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((b) => b.textContent?.includes('Excluir'))!;
    expect(botao.classList).toContain('botao--perigo');
    const painel = (fixture.nativeElement as HTMLElement).querySelector('.confirm-dialog')!;
    expect(painel.classList).not.toContain('confirm-dialog--primario');
  });
});

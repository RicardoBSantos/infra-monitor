import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { prenderFoco } from '../a11y/prender-foco';

let proximoId = 0;

/**
 * Confirmação destrutiva. Mesma mecânica do app-modal: Escape no document, foco entra ao abrir
 * (em Cancelar — a ação segura) e volta ao gatilho ao fechar, trap de Tab.
 *
 * O Escape também é tratado no próprio painel com stopPropagation: o diálogo pode estar aninhado
 * numa gaveta que fecha com Escape no próprio painel (unidade-form-drawer) — sem isso a gaveta
 * receberia a tecla antes do document.
 */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'pedirCancelar()' },
  template: `@if (open()) {
    <div class="dialog-backdrop" (mousedown)="aoPressionarFundo($event)" (click)="aoClicarNoFundo($event)">
      <section #painel class="confirm-dialog" role="alertdialog" aria-modal="true" tabindex="-1"
        [attr.aria-labelledby]="idTitulo" [attr.aria-describedby]="idMensagem" (keydown)="aoTeclar($event)">
        <h2 [id]="idTitulo">{{ title() }}</h2>
        <p [id]="idMensagem">{{ message() }}</p>
        @if (erro()) { <p class="confirm-dialog__erro" role="alert">{{ erro() }}</p> }
        <div>
          <button #cancelar class="botao" type="button" (click)="pedirCancelar()" [disabled]="busy()">Cancelar</button>
          <button class="botao botao--perigo" type="button" (click)="confirm.emit()" [disabled]="busy()">{{ busy() ? busyLabel() : confirmLabel() }}</button>
        </div>
      </section>
    </div>
  }`,
  styleUrl: './confirm-dialog.component.scss',
})
export class ConfirmDialogComponent {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly message = input.required<string>();
  readonly confirmLabel = input('Excluir');
  readonly busyLabel = input('Processando…');
  readonly busy = input(false);
  readonly erro = input<string | null>(null);
  readonly confirm = output<void>();
  readonly cancel = output<void>();

  protected readonly idTitulo = `confirm-titulo-${++proximoId}`;
  protected readonly idMensagem = `confirm-mensagem-${proximoId}`;
  private readonly painel = viewChild<ElementRef<HTMLElement>>('painel');
  private readonly botaoCancelar = viewChild<ElementRef<HTMLButtonElement>>('cancelar');
  private cliqueComecouNoFundo = false;
  private gatilho: HTMLElement | null = null;
  private estavaAberto = false;

  constructor() {
    // Roda antes do template: ao abrir o foco ainda está no gatilho; ao fechar, o painel ainda existe.
    effect(() => {
      const aberto = this.open();
      if (aberto && !this.estavaAberto) {
        this.gatilho = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      } else if (!aberto && this.estavaAberto) {
        const gatilho = this.gatilho;
        this.gatilho = null;
        if (gatilho?.isConnected) gatilho.focus();
      }
      this.estavaAberto = aberto;
    });
    // O painel só existe depois que o @if renderiza.
    effect(() => {
      const painel = this.painel()?.nativeElement;
      if (!painel) return;
      const cancelar = this.botaoCancelar()?.nativeElement;
      (cancelar && !cancelar.disabled ? cancelar : painel).focus();
    });
  }

  protected pedirCancelar(): void {
    if (this.open() && !this.busy()) this.cancel.emit();
  }

  protected aoTeclar(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') {
      evento.stopPropagation();
      this.pedirCancelar();
      return;
    }
    const painel = this.painel()?.nativeElement;
    if (painel) prenderFoco(evento, painel);
  }

  /** Método, não atribuição no template — ver app-modal (handler que devolve false cancela o evento). */
  protected aoPressionarFundo(evento: MouseEvent): void {
    this.cliqueComecouNoFundo = evento.target === evento.currentTarget;
  }

  protected aoClicarNoFundo(evento: MouseEvent): void {
    const comecouNoFundo = this.cliqueComecouNoFundo;
    this.cliqueComecouNoFundo = false;
    if (comecouNoFundo && evento.target === evento.currentTarget) this.pedirCancelar();
  }
}

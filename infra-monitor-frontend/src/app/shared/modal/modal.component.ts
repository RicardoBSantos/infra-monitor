import { ChangeDetectionStrategy, Component, ElementRef, effect, input, output, viewChild } from '@angular/core';

/** Campo que recebe o foco ao abrir. O × fica de fora: abrir não é pedir para fechar. */
const FOCAVEIS = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not(.modal__fechar)';

let proximoId = 0;

/**
 * Modal centralizado de formulário: fundo escurecido, borda superior azul e ×.
 * Cuida só do contêiner — o formulário entra por projeção e é estilizado pelo pai.
 *
 * Escape escuta o document, não o painel: preso ao painel ele não dispara enquanto o
 * foco ainda está no botão que abriu (falha do modal local de Equipamentos).
 */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'pedirFechar()' },
  template: `@if (aberto()) {
    <div class="modal__fundo" (mousedown)="cliqueComecouNoFundo = $event.target === $event.currentTarget" (click)="aoClicarNoFundo($event)">
      <section #painel class="modal" role="dialog" aria-modal="true" [attr.aria-labelledby]="idTitulo" tabindex="-1" [style.width]="largura()">
        <header class="modal__topo">
          <div>
            <h2 [id]="idTitulo">{{ titulo() }}</h2>
            @if (subtitulo()) { <p>{{ subtitulo() }}</p> }
          </div>
          <button class="modal__fechar" type="button" aria-label="Fechar" [disabled]="bloqueado()" (click)="pedirFechar()">✕</button>
        </header>
        <ng-content />
      </section>
    </div>
  }`,
  styleUrl: './modal.component.scss',
})
export class ModalComponent {
  readonly aberto = input(false);
  readonly titulo = input.required<string>();
  readonly subtitulo = input<string | null>(null);
  readonly largura = input('520px');
  readonly bloqueado = input(false);
  readonly fechar = output<void>();

  protected readonly idTitulo = `modal-titulo-${++proximoId}`;
  protected cliqueComecouNoFundo = false;
  private readonly painel = viewChild<ElementRef<HTMLElement>>('painel');
  private gatilho: HTMLElement | null = null;
  private estavaAberto = false;

  constructor() {
    // Roda antes do template: ao abrir, o foco ainda está no gatilho; ao fechar, o painel ainda existe.
    effect(() => {
      const aberto = this.aberto();
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
      if (painel) (painel.querySelector<HTMLElement>(FOCAVEIS) ?? painel).focus();
    });
  }

  protected pedirFechar(): void {
    if (this.aberto() && !this.bloqueado()) this.fechar.emit();
  }

  /** Só fecha se o clique começou no fundo: soltar ali uma seleção de texto feita no campo não conta. */
  protected aoClicarNoFundo(evento: MouseEvent): void {
    const comecouNoFundo = this.cliqueComecouNoFundo;
    this.cliqueComecouNoFundo = false;
    if (comecouNoFundo && evento.target === evento.currentTarget) this.pedirFechar();
  }
}

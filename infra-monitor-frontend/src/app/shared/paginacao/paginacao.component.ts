import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/**
 * Paginação compartilhada, 1-based: "‹ Anterior · Página X de Y · Próxima ›".
 * Só emite `mudarPagina` para destinos válidos — o consumidor não precisa reclampar.
 */
@Component({
  selector: 'app-paginacao',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="paginacao" [attr.aria-label]="rotulo()">
      @if (contagem(); as texto) { <p class="contagem">{{ texto }}</p> }
      <div>
        <button class="botao botao--discreto" type="button" (click)="ir(paginaAtual() - 1)" [disabled]="primeira()">‹ Anterior</button>
        <span class="contagem" aria-current="page">Página {{ paginaAtual() }} de {{ totalPaginas() }}</span>
        <button class="botao botao--discreto" type="button" (click)="ir(paginaAtual() + 1)" [disabled]="ultima()">Próxima ›</button>
      </div>
    </nav>
  `,
  styleUrl: './paginacao.component.scss',
})
export class PaginacaoComponent {
  readonly paginaAtual = input.required<number>();
  readonly totalPaginas = input.required<number>();
  /** Texto livre à esquerda (ex.: "20 de 220 dispositivos"). Omitido se vazio. */
  readonly contagem = input<string>('');
  readonly rotulo = input<string>('Paginação');
  readonly mudarPagina = output<number>();

  protected readonly primeira = computed(() => this.paginaAtual() <= 1);
  protected readonly ultima = computed(() => this.paginaAtual() >= this.totalPaginas());

  protected ir(pagina: number): void {
    if (pagina >= 1 && pagina <= this.totalPaginas() && pagina !== this.paginaAtual()) this.mudarPagina.emit(pagina);
  }
}

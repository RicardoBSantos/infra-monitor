import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, input, output, signal, viewChild } from '@angular/core';

export interface ActionMenuItem {
  /** Identificador emitido em `selecionar`. */
  id: string;
  rotulo: string;
  /** Separa visualmente o item destrutivo do resto do menu. */
  divisorAntes?: boolean;
  destrutivo?: boolean;
  desabilitado?: boolean;
}

/** Altura estimada de um item; usada só no primeiro palpite, antes de o menu existir no DOM. */
const ALTURA_ITEM_PX = 36;
/** Respiro entre o menu e o gatilho. */
const FOLGA_PX = 4;
/** Respiro mínimo entre o menu e a borda da janela. */
const MARGEM_PX = 8;
/** Espelha o `min-width` do SCSS; serve ao palpite horizontal antes da medição real. */
const LARGURA_MINIMA_PX = 168;

interface PosicaoMenu {
  top: number;
  left: number;
  alturaMaxima: number;
}

/**
 * Menu de ações por linha ("…").
 *
 * Compartilhado desde o primeiro uso: a aba Equipamentos do detalhe da unidade tem a
 * mesma necessidade e ficou sem componente na época.
 *
 * A lista é `position: fixed` com coordenadas calculadas a partir do gatilho. Absoluto não
 * serve: a tabela vive dentro de um wrapper com `overflow-x: auto`, e o CSS promove o eixo Y
 * a `auto` junto — o ancestral recortava o menu e ainda criava barra de rolagem interna.
 * `fixed` escapa de qualquer contexto de overflow sem portal e sem o CDK. O preço é não
 * acompanhar rolagem, então rolar fecha o menu.
 *
 * Teclado e foco não são opcionais aqui — a lista tem uma ação destrutiva, e navegar até
 * ela só com mouse exclui quem usa teclado ou leitor de tela.
 */
@Component({
  selector: 'app-action-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './action-menu.component.html',
  styleUrl: './action-menu.component.scss',
})
export class ActionMenuComponent {
  readonly itens = input.required<ActionMenuItem[]>();
  /** Compõe o `aria-label` do gatilho: "Ações de SW-CORE". */
  readonly rotuloContexto = input<string>('');
  readonly desabilitado = input(false);
  readonly selecionar = output<string>();

  protected readonly aberto = signal(false);
  /** `true` quando não há espaço abaixo: o menu abre para cima. */
  protected readonly paraCima = signal(false);
  protected readonly focado = signal(-1);
  protected readonly posicao = signal<PosicaoMenu>({ top: 0, left: 0, alturaMaxima: 0 });

  private readonly gatilho = viewChild.required<ElementRef<HTMLButtonElement>>('gatilho');
  private readonly itemRefs = viewChild<ElementRef<HTMLElement>>('lista');

  protected readonly rotuloGatilho = computed(() => {
    const contexto = this.rotuloContexto();
    return contexto ? `Ações de ${contexto}` : 'Ações';
  });

  protected readonly habilitados = computed(() => this.itens().filter((item) => !item.desabilitado));

  private pararRolagem: (() => void) | null = null;

  constructor(private readonly host: ElementRef<HTMLElement>, destroyRef: DestroyRef) {
    destroyRef.onDestroy(() => this.pararDeObservarRolagem());
  }

  protected alternar(): void {
    if (this.desabilitado()) return;
    this.aberto() ? this.fechar() : this.abrir();
  }

  protected abrir(): void {
    this.posicionar(this.itens().length * ALTURA_ITEM_PX, LARGURA_MINIMA_PX);
    this.aberto.set(true);
    this.focado.set(this.primeiroHabilitado());
    this.observarRolagem();
    // O menu só existe no DOM depois de aberto: aí dá para medir de verdade e corrigir.
    queueMicrotask(() => {
      this.reposicionarComMedidaReal();
      this.focarItemAtual();
    });
  }

  /** `devolverFoco` é falso quando o próprio clique já moveu o foco para outro lugar. */
  protected fechar(devolverFoco = true): void {
    if (!this.aberto()) return;
    this.aberto.set(false);
    this.focado.set(-1);
    this.pararDeObservarRolagem();
    if (devolverFoco) this.gatilho().nativeElement.focus();
  }

  protected escolher(item: ActionMenuItem): void {
    if (item.desabilitado) return;
    this.fechar();
    this.selecionar.emit(item.id);
  }

  protected teclaNoGatilho(evento: KeyboardEvent): void {
    if (evento.key === 'Enter' || evento.key === ' ' || evento.key === 'ArrowDown') {
      evento.preventDefault();
      this.abrir();
    }
  }

  protected teclaNoMenu(evento: KeyboardEvent): void {
    switch (evento.key) {
      case 'Escape':
        evento.preventDefault();
        this.fechar();
        break;
      case 'ArrowDown':
        evento.preventDefault();
        this.mover(1);
        break;
      case 'ArrowUp':
        evento.preventDefault();
        this.mover(-1);
        break;
      case 'Home':
        evento.preventDefault();
        this.focado.set(this.primeiroHabilitado());
        this.focarItemAtual();
        break;
      case 'End':
        evento.preventDefault();
        this.focado.set(this.ultimoHabilitado());
        this.focarItemAtual();
        break;
      case 'Tab':
        // Sair do menu por Tab fecha, mas não sequestra o foco de volta ao gatilho.
        this.fechar(false);
        break;
      default:
        break;
    }
  }

  @HostListener('document:click', ['$event'])
  protected cliqueFora(evento: MouseEvent): void {
    if (!this.aberto()) return;
    if (!this.host.nativeElement.contains(evento.target as Node)) this.fechar(false);
  }

  @HostListener('window:resize')
  protected aoRedimensionar(): void {
    this.fechar(false);
  }

  /**
   * Coordenada fixa não acompanha rolagem, e recalcular a cada quadro só faria o menu
   * deslizar junto com a linha que o abriu. Fechar é o comportamento honesto.
   *
   * A rolagem que importa é a do wrapper da tabela, e evento de scroll de elemento não
   * borbulha — por isso o listener é manual em fase de captura, algo que `@HostListener`
   * não expressa. Fica ativo só enquanto o menu está aberto.
   */
  private observarRolagem(): void {
    this.pararDeObservarRolagem();
    const aoRolar = (evento: Event): void => {
      // Rolar dentro do próprio menu (lista longa em janela baixa) não pode fechá-lo.
      if (this.itemRefs()?.nativeElement.contains(evento.target as Node)) return;
      this.fechar(false);
    };
    document.addEventListener('scroll', aoRolar, true);
    this.pararRolagem = () => document.removeEventListener('scroll', aoRolar, true);
  }

  private pararDeObservarRolagem(): void {
    this.pararRolagem?.();
    this.pararRolagem = null;
  }

  private mover(passo: number): void {
    const itens = this.itens();
    if (!itens.length) return;
    let indice = this.focado();
    for (let tentativa = 0; tentativa < itens.length; tentativa++) {
      indice = (indice + passo + itens.length) % itens.length;
      if (!itens[indice].desabilitado) break;
    }
    this.focado.set(indice);
    this.focarItemAtual();
  }

  private primeiroHabilitado(): number {
    return this.itens().findIndex((item) => !item.desabilitado);
  }

  private ultimoHabilitado(): number {
    const itens = this.itens();
    for (let indice = itens.length - 1; indice >= 0; indice--) if (!itens[indice].desabilitado) return indice;
    return -1;
  }

  private focarItemAtual(): void {
    const lista = this.itemRefs()?.nativeElement;
    const indice = this.focado();
    if (!lista || indice < 0) return;
    lista.querySelectorAll<HTMLElement>('[role="menuitem"]')[indice]?.focus();
  }

  /** Segunda passada, com o menu já renderizado. Altura zero = ambiente sem layout (jsdom). */
  private reposicionarComMedidaReal(): void {
    const lista = this.itemRefs()?.nativeElement;
    if (!lista) return;
    const medida = lista.getBoundingClientRect();
    if (!medida.height) return;
    this.posicionar(medida.height, medida.width);
  }

  /**
   * Ancora o menu no gatilho e o mantém dentro da janela nos dois eixos: alinhado à direita
   * do gatilho, deslocado para dentro se estourar a borda, e virado para cima quando não há
   * espaço abaixo. `alturaMaxima` cobre o caso extremo de janela mais baixa que o menu.
   */
  private posicionar(altura: number, largura: number): void {
    const gatilho = this.gatilho().nativeElement.getBoundingClientRect();
    const alturaJanela = window.innerHeight;
    const larguraJanela = window.innerWidth;

    const espacoAbaixo = alturaJanela - gatilho.bottom - FOLGA_PX - MARGEM_PX;
    const espacoAcima = gatilho.top - FOLGA_PX - MARGEM_PX;
    // Só sobe se, além de não caber embaixo, houver mais espaço em cima.
    const paraCima = altura > espacoAbaixo && espacoAcima > espacoAbaixo;

    const alturaMaxima = Math.max(0, paraCima ? espacoAcima : espacoAbaixo);
    const alturaEfetiva = Math.min(altura, alturaMaxima);

    const top = paraCima ? gatilho.top - FOLGA_PX - alturaEfetiva : gatilho.bottom + FOLGA_PX;

    const limiteDireito = Math.max(MARGEM_PX, larguraJanela - largura - MARGEM_PX);
    const left = Math.min(Math.max(gatilho.right - largura, MARGEM_PX), limiteDireito);

    this.paraCima.set(paraCima);
    this.posicao.set({ top: Math.max(MARGEM_PX, top), left, alturaMaxima });
  }
}

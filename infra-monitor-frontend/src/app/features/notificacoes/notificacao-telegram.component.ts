import { ChangeDetectionStrategy, Component, ElementRef, viewChildren } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

interface Aba { caminho: string; rotulo: string; }

const ABAS: Aba[] = [
  { caminho: 'configuracao', rotulo: 'Configuração' },
  { caminho: 'historico', rotulo: 'Histórico' },
];

/**
 * Casca da área de Telegram: cabeçalho e navegação por abas.
 * O conteúdo de cada aba é uma rota filha, carregada sob demanda.
 */
@Component({
  selector: 'app-notificacao-telegram',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notificacao-telegram.component.html',
  styleUrl: './notificacao-telegram.component.scss',
})
export class NotificacaoTelegramComponent {
  private readonly gatilhosDeAba = viewChildren<ElementRef<HTMLAnchorElement>>('gatilhoAba');
  protected readonly abas = ABAS;

  protected navegarPorTeclado(evento: KeyboardEvent, indice: number): void {
    const passo = evento.key === 'ArrowRight' ? 1 : evento.key === 'ArrowLeft' ? -1 : 0;
    if (passo === 0) return;
    evento.preventDefault();
    const gatilhos = this.gatilhosDeAba();
    const destino = (indice + passo + gatilhos.length) % gatilhos.length;
    gatilhos[destino]?.nativeElement.focus();
    gatilhos[destino]?.nativeElement.click();
  }
}

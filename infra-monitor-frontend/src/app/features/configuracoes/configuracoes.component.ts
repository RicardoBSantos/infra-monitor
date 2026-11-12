import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

interface Secao { caminho: string; rotulo: string; resumo: string; }

/** Cada configuração nova do sistema entra como rota filha e um item aqui. */
const SECOES: Secao[] = [
  { caminho: 'modo-tv', rotulo: 'Modo TV', resumo: 'Painel de parede em ciclo' },
];

/**
 * Casca das configurações do sistema: cabeçalho, navegação lateral de seções e a rota
 * filha da seção aberta, carregada sob demanda.
 */
@Component({
  selector: 'app-configuracoes',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './configuracoes.component.html',
  styleUrl: './configuracoes.component.scss',
})
export class ConfiguracoesComponent {
  protected readonly secoes = SECOES;
}

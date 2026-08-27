import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, viewChildren } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AppIconComponent } from '../../shared/app-icon/app-icon.component';
import { BreadcrumbLabelService } from '../../shared/breadcrumbs/breadcrumb-label.service';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { JANELA_DIAS, UnidadeDetalheStore } from './detalhe/unidade-detalhe.store';

interface Aba { caminho: string; rotulo: string; }

const TITULO_BASE = 'Infra Monitor';

const ABAS: Aba[] = [
  { caminho: 'visao-geral', rotulo: 'Visão geral' },
  { caminho: 'equipamentos', rotulo: 'Equipamentos' },
  { caminho: 'incidentes', rotulo: 'Incidentes' },
  { caminho: 'historico', rotulo: 'Histórico' },
  { caminho: 'configuracoes', rotulo: 'Configurações' },
];

/**
 * Casca do detalhe da unidade: cabeçalho, KPIs e navegação por abas.
 * O conteúdo de cada aba é uma rota filha, carregada sob demanda.
 */
@Component({
  selector: 'app-unidade-detalhe',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, AppIconComponent, StatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './unidade-detalhe.component.html',
  styleUrl: './unidade-detalhe.component.scss',
})
export class UnidadeDetalheComponent {
  private readonly titulo = inject(Title);
  private readonly rotuloDaMigalha = inject(BreadcrumbLabelService);
  protected readonly store = inject(UnidadeDetalheStore);
  protected readonly abas = ABAS;
  protected readonly janelaDias = JANELA_DIAS;

  private readonly gatilhosDeAba = viewChildren<ElementRef<HTMLAnchorElement>>('gatilhoAba');

  constructor() {
    // Nome da unidade na migalha e no titulo: com rotulo fixo, duas unidades
    // abertas em abas diferentes ficam indistinguiveis.
    effect(() => {
      const nome = this.store.unidade()?.nome ?? null;
      this.rotuloDaMigalha.definir(nome);
      this.titulo.setTitle(nome ? nome + ' · ' + TITULO_BASE : TITULO_BASE);
    });
    inject(DestroyRef).onDestroy(() => {
      this.rotuloDaMigalha.definir(null);
      this.titulo.setTitle(TITULO_BASE);
    });

    const id = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));
    if (!Number.isInteger(id) || id < 1) { this.store.estado.set('not-found'); return; }
    this.store.carregar(id);
  }

  protected recarregar(): void { this.store.carregar(this.store.id()); }

  /** Setas navegam entre abas, conforme o padrão de tablist. */
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

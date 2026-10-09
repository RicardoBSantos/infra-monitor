import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { take } from 'rxjs';

import { plural } from '../../core/format/plural';
import { isApiError } from '../../core/models/api-error';
import { DashboardUnidade } from '../../core/models/dashboard';
import { UnidadeResponse } from '../../core/models/unidade';
import { AuthStateService } from '../../core/services/auth-state.service';
import { DashboardApiService } from '../../core/services/dashboard-api.service';
import { RelatorioApiService } from '../../core/services/relatorio-api.service';
import { UnidadeApiService } from '../../core/services/unidade-api.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { PaginacaoComponent } from '../../shared/paginacao/paginacao.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { JANELA_DIAS } from './detalhe/unidade-detalhe.store';
import { formatarPercentual } from '../../core/format/numero';
import { UnidadeFormDrawerComponent } from './unidade-form-drawer.component';

type Estado = 'loading' | 'success' | 'empty' | 'error';
type Acao = 'excluir' | 'desativar';

const POR_PAGINA = 20;

interface Linha {
  cadastro: UnidadeResponse;
  operacional: DashboardUnidade | null;
  disponibilidade: string;
  incidentes: number | null;
  equipamentos: number | null;
}

/**
 * Lista administrativa de unidades.
 *
 * Compõe três origens: o cadastro (`/unidades`), os agregados operacionais
 * (`/dashboard/unidades`) e a disponibilidade da mesma janela do painel e do
 * detalhe. Percentual divergente entre telas vira chamado de suporte.
 * A disponibilidade falha sozinha: a coluna exibe "—" e a tela segue de pé.
 */
@Component({
  selector: 'app-unidade-list',
  imports: [RouterLink, ConfirmDialogComponent, PaginacaoComponent, StatusBadgeComponent, UnidadeFormDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './unidade-list.component.html',
  styleUrl: './unidade-list.component.scss',
})
export class UnidadeListComponent {
  protected readonly plural = plural;
  private readonly api = inject(UnidadeApiService);
  private readonly dashboard = inject(DashboardApiService);
  private readonly relatorios = inject(RelatorioApiService);
  protected readonly authState = inject(AuthStateService);

  protected readonly janelaDias = JANELA_DIAS;

  protected readonly estado = signal<Estado>('loading');
  protected readonly erro = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly busca = signal('');
  protected readonly pagina = signal(1);

  private readonly cadastros = signal<UnidadeResponse[]>([]);
  private readonly operacionais = signal<Map<number, DashboardUnidade>>(new Map());
  private readonly disponibilidades = signal<Map<number, number | null>>(new Map());

  protected readonly drawerAberto = signal(false);
  protected readonly emEdicao = signal<UnidadeResponse | null>(null);

  protected readonly acao = signal<Acao | null>(null);
  protected readonly alvo = signal<UnidadeResponse | null>(null);
  protected readonly processando = signal(false);
  protected readonly erroAcao = signal<string | null>(null);
  protected readonly alternandoId = signal<number | null>(null);

  protected readonly linhas = computed<Linha[]>(() => {
    const operacionais = this.operacionais();
    const disponibilidades = this.disponibilidades();
    return this.cadastros().map((cadastro) => {
      const operacional = operacionais.get(cadastro.id) ?? null;
      return {
        cadastro,
        operacional,
        disponibilidade: formatarPercentual(disponibilidades.get(cadastro.id) ?? null),
        incidentes: operacional?.incidentesAbertos ?? null,
        equipamentos: operacional?.equipamentosTotal ?? null,
      };
    });
  });

  protected readonly filtradas = computed(() => {
    const termo = this.busca().trim().toLowerCase();
    if (!termo) return this.linhas();
    return this.linhas().filter(({ cadastro }) =>
      cadastro.nome.toLowerCase().includes(termo)
      || cadastro.sigla.toLowerCase().includes(termo)
      || (cadastro.cidade ?? '').toLowerCase().includes(termo));
  });

  protected readonly total = computed(() => this.linhas().length);
  protected readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.filtradas().length / POR_PAGINA)));
  protected readonly paginaAtual = computed(() => Math.min(this.pagina(), this.totalPaginas()));
  protected readonly visiveis = computed(() => {
    const inicio = (this.paginaAtual() - 1) * POR_PAGINA;
    return this.filtradas().slice(inicio, inicio + POR_PAGINA);
  });

  protected readonly tituloConfirmacao = computed(() => {
    const nome = this.alvo()?.nome ?? '';
    return this.acao() === 'excluir' ? `Excluir ${nome}?` : `Desativar ${nome}?`;
  });

  /**
   * Equipamentos da unidade em foco. `null` quando os agregados do painel não
   * chegaram: a quantidade é desconhecida, nunca zero. Anunciar "0 equipamentos"
   * a partir de uma chamada que falhou faria a exclusão parecer segura sem que
   * ninguém tenha confirmado isso.
   */
  private readonly equipamentosDoAlvo = computed<number | null>(() => {
    const alvo = this.alvo();
    return alvo ? this.operacionais().get(alvo.id)?.equipamentosTotal ?? null : null;
  });

  protected readonly mensagemConfirmacao = computed(() => {
    const alvo = this.alvo();
    if (!alvo) return '';
    const equipamentos = this.equipamentosDoAlvo();
    if (this.acao() === 'excluir') {
      // O backend recusa a exclusão enquanto houver equipamento vinculado
      // (409 BUSINESS_CONFLICT, espelhado pelo FK ON DELETE RESTRICT). Prometer
      // "exclusão definitiva" quando já se sabe que ela será recusada empurra o
      // usuário para um erro evitável.
      if (equipamentos === null) {
        return `Não foi possível confirmar quantos equipamentos estão vinculados a ${alvo.nome}. Se houver algum, a exclusão será recusada: mova ou desvincule os equipamentos antes de tentar.`;
      }
      if (equipamentos > 0) {
        return `${alvo.nome} tem ${plural(equipamentos, 'equipamento vinculado', 'equipamentos vinculados')} e a exclusão será recusada enquanto existirem. Mova ou desvincule os equipamentos primeiro.`;
      }
      return `${alvo.nome} não tem equipamentos vinculados. A exclusão é definitiva e não pode ser desfeita.`;
    }
    const dispositivos = equipamentos === null
      ? 'dos dispositivos desta unidade (quantidade não confirmada)'
      : `${equipamentos === 1 ? 'do único dispositivo' : `dos ${equipamentos} dispositivos`} desta unidade`;
    return `Desativar interrompe o monitoramento ICMP ${dispositivos} e suprime os alertas do Telegram. O histórico de medições e incidentes é preservado.`;
  });

  constructor() { this.carregar(); }

  protected carregar(): void {
    this.estado.set('loading');
    this.erro.set(null);
    this.api.list().pipe(take(1)).subscribe({
      next: (cadastros) => {
        this.cadastros.set(cadastros);
        this.estado.set(cadastros.length ? 'success' : 'empty');
      },
      error: (erro: HttpErrorResponse) => {
        this.erro.set(mensagemDe(erro, 'Não foi possível carregar as unidades.'));
        this.estado.set('error');
      },
    });
    this.carregarOperacionais();
    this.carregarDisponibilidade();
  }

  /** Agregados do painel: status operacional, equipamentos e incidentes abertos. */
  private carregarOperacionais(): void {
    this.dashboard.getUnidades().pipe(take(1)).subscribe({
      next: (unidades) => this.operacionais.set(new Map(unidades.map((unidade) => [unidade.id, unidade]))),
      error: () => this.operacionais.set(new Map()),
    });
  }

  /** Mesma janela do painel e do detalhe. Falha aqui não derruba a lista. */
  private carregarDisponibilidade(): void {
    const fim = new Date();
    const inicio = new Date(fim.getTime() - JANELA_DIAS * 24 * 60 * 60 * 1000);
    this.relatorios.getDisponibilidadeUnidades({ inicio: inicio.toISOString(), fim: fim.toISOString(), size: 500 })
      .pipe(take(1))
      .subscribe({
        next: (pagina) => this.disponibilidades.set(new Map(pagina.content.map((linha) => [linha.unidadeId, linha.disponibilidadePercentual]))),
        error: () => this.disponibilidades.set(new Map()),
      });
  }

  protected aoBuscar(termo: string): void { this.busca.set(termo); this.pagina.set(1); }
  protected limparBusca(): void { this.aoBuscar(''); }
  protected irPara(pagina: number): void { this.pagina.set(Math.min(Math.max(1, pagina), this.totalPaginas())); }

  protected abrirCriacao(): void { this.aviso.set(null); this.emEdicao.set(null); this.drawerAberto.set(true); }

  protected aoSalvar(unidade: UnidadeResponse): void {
    this.aviso.set(this.emEdicao() ? 'Unidade atualizada com sucesso.' : 'Unidade criada com sucesso.');
    this.cadastros.update((itens) => itens.some((item) => item.id === unidade.id)
      ? itens.map((item) => item.id === unidade.id ? unidade : item)
      : [...itens, unidade]);
    this.estado.set('success');
    this.carregarOperacionais();
  }

  /** Reativar não pede confirmação: a ação é reversível e não interrompe nada. */
  protected ativar(unidade: UnidadeResponse): void {
    if (this.alternandoId() !== null) return;
    this.alternandoId.set(unidade.id);
    this.erro.set(null);
    this.api.activate(unidade.id).pipe(take(1)).subscribe({
      next: (atualizada) => {
        this.alternandoId.set(null);
        this.substituir(atualizada);
        this.aviso.set('Unidade ativada com sucesso.');
        this.carregarOperacionais();
      },
      error: (erro: HttpErrorResponse) => {
        this.alternandoId.set(null);
        this.erro.set(mensagemDe(erro, 'Não foi possível ativar a unidade.'));
      },
    });
  }

  protected confirmar(acao: Acao, unidade: UnidadeResponse): void {
    this.erroAcao.set(null);
    this.acao.set(acao);
    this.alvo.set(unidade);
  }

  protected fecharConfirmacao(): void {
    if (this.processando()) return;
    this.acao.set(null);
    this.alvo.set(null);
    this.erroAcao.set(null);
  }

  /** Recusa do backend fica dentro do modal: fechar esconderia o motivo real. */
  protected executar(): void {
    const alvo = this.alvo();
    const acao = this.acao();
    if (!alvo || !acao || this.processando()) return;
    this.processando.set(true);
    this.erroAcao.set(null);

    if (acao === 'desativar') {
      this.api.deactivate(alvo.id).pipe(take(1)).subscribe({
        next: (atualizada) => {
          this.processando.set(false);
          this.substituir(atualizada);
          this.aviso.set('Unidade desativada com sucesso.');
          this.acao.set(null);
          this.alvo.set(null);
          this.carregarOperacionais();
        },
        error: (erro: HttpErrorResponse) => {
          this.processando.set(false);
          this.erroAcao.set(mensagemDe(erro, 'Não foi possível desativar a unidade.'));
        },
      });
      return;
    }

    this.api.delete(alvo.id).pipe(take(1)).subscribe({
      next: () => {
        this.processando.set(false);
        this.cadastros.update((itens) => itens.filter((item) => item.id !== alvo.id));
        if (!this.cadastros().length) this.estado.set('empty');
        this.aviso.set('Unidade excluída com sucesso.');
        this.acao.set(null);
        this.alvo.set(null);
        this.carregarOperacionais();
      },
      error: (erro: HttpErrorResponse) => {
        this.processando.set(false);
        this.erroAcao.set(mensagemDe(erro, 'Não foi possível excluir a unidade.'));
      },
    });
  }

  private substituir(unidade: UnidadeResponse): void {
    this.cadastros.update((itens) => itens.map((item) => item.id === unidade.id ? unidade : item));
  }
}

function mensagemDe(erro: unknown, alternativa: string): string {
  return erro instanceof HttpErrorResponse && isApiError(erro.error) ? erro.error.message : alternativa;
}

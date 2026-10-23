import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { take } from 'rxjs';
import { MaintenanceScope, MaintenanceWindowStatus } from '../../core/models/api-enums';
import { isApiError } from '../../core/models/api-error';
import { FiltroManutencao, ManutencaoResponse, ParametrosManutencao } from '../../core/models/manutencao';
import { AuthStateService } from '../../core/services/auth-state.service';
import { ManutencaoApiService } from '../../core/services/manutencao-api.service';
import { AppIconComponent } from '../../shared/app-icon/app-icon.component';
import { ActionMenuComponent, ActionMenuItem } from '../../shared/action-menu/action-menu.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { PaginacaoComponent } from '../../shared/paginacao/paginacao.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { AgendarManutencaoComponent } from './agendar-manutencao.component';
import { dataHora, hora } from './periodo';

type Estado = 'carregando' | 'sucesso' | 'vazio' | 'erro';
type Acao = 'cancelar' | 'encerrar';

/** Diferença tolerada entre o previsto e o real antes de mostrar a segunda linha (o job roda a cada 30 s). */
const TOLERANCIA_MS = 60_000;
const DEBOUNCE_BUSCA_MS = 300;

const TEXTOS: Record<Acao, { titulo: (id: number) => string; botao: string; mensagem: string; sucesso: (id: number) => string }> = {
  cancelar: {
    titulo: (id) => `Cancelar a janela #${id}?`,
    botao: 'Cancelar janela',
    mensagem: 'A janela não vai acontecer. Ela ainda não excluiu nenhum período do relatório de disponibilidade, então nada muda no SLA.',
    sucesso: (id) => `Janela #${id} cancelada.`,
  },
  encerrar: {
    titulo: (id) => `Encerrar agora a janela #${id}?`,
    botao: 'Encerrar janela',
    mensagem: 'Os equipamentos voltam a ser verificados na próxima varredura. O período desde o início da janela continua fora do relatório de disponibilidade: nele não houve medição, e encerrar não o devolve ao SLA. Equipamentos que também estão em manutenção manual continuam fora até ela ser encerrada.',
    sucesso: (id) => `Janela #${id} encerrada.`,
  },
};

/**
 * Janelas de manutenção agendada. Paginação, filtro e busca são do servidor
 * (`/manutencoes?situacao&busca&page&size`); a tela só formata.
 */
@Component({
  selector: 'app-manutencao-list',
  imports: [AppIconComponent, ActionMenuComponent, ConfirmDialogComponent, PaginacaoComponent, StatusBadgeComponent, AgendarManutencaoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manutencao-list.component.html',
  styleUrl: './manutencao-list.component.scss',
})
export class ManutencaoListComponent {
  private readonly api = inject(ManutencaoApiService);
  protected readonly authState = inject(AuthStateService);

  protected readonly itens = signal<ManutencaoResponse[]>([]);
  protected readonly estado = signal<Estado>('carregando');
  protected readonly erro = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly parametros = signal<ParametrosManutencao | null>(null);
  protected readonly erroParametros = signal(false);
  protected readonly filtro = signal<FiltroManutencao>('VIGENTES');
  protected readonly busca = signal('');
  /** 1-based, como o app-paginacao; a API recebe `pagina - 1`. */
  protected readonly pagina = signal(1);
  protected readonly totalPaginas = signal(1);
  protected readonly totalItens = signal(0);
  protected readonly agendando = signal(false);
  protected readonly confirmando = signal<{ acao: Acao; janela: ManutencaoResponse } | null>(null);
  protected readonly ocupado = signal(false);
  protected readonly erroDialogo = signal<string | null>(null);

  protected readonly podeGerenciar = computed(() => this.authState.canManageInventory());
  protected readonly agendadorDesligado = computed(() => this.parametros()?.agendadorLigado === false);
  protected readonly podeAgendar = computed(() => this.parametros()?.agendadorLigado === true);
  protected readonly textoDialogo = computed(() => {
    const c = this.confirmando();
    return c ? { titulo: TEXTOS[c.acao].titulo(c.janela.id), botao: TEXTOS[c.acao].botao, mensagem: TEXTOS[c.acao].mensagem } : null;
  });

  private temporizadorBusca: ReturnType<typeof setTimeout> | undefined;
  /** Descarta respostas fora de ordem (troca rápida de filtro ou página). */
  private pedido = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.temporizadorBusca));
    this.api.parametros().pipe(take(1)).subscribe({
      next: (p) => this.parametros.set(p),
      error: () => this.erroParametros.set(true),
    });
    this.carregar();
  }

  protected carregar(): void {
    const pedido = ++this.pedido;
    this.estado.set('carregando');
    this.erro.set(null);
    this.api.list(this.filtro(), this.busca(), this.pagina() - 1).pipe(take(1)).subscribe({
      next: (resposta) => {
        if (pedido !== this.pedido) return;
        // Página esvaziada por cancelar/encerrar/recarregar: volta para a última que existe.
        const ultima = Math.max(resposta.totalPages, 1);
        if (!resposta.content.length && this.pagina() > ultima) {
          this.pagina.set(ultima);
          this.carregar();
          return;
        }
        this.itens.set(resposta.content);
        this.totalPaginas.set(Math.max(resposta.totalPages, 1));
        this.totalItens.set(resposta.totalElements);
        this.estado.set(resposta.content.length ? 'sucesso' : 'vazio');
      },
      error: (erro: unknown) => {
        if (pedido !== this.pedido) return;
        this.erro.set(mensagemDe(erro, 'Não foi possível carregar as janelas de manutenção.'));
        this.estado.set('erro');
      },
    });
  }

  protected mudarFiltro(filtro: FiltroManutencao): void {
    if (filtro === this.filtro()) return;
    this.filtro.set(filtro);
    this.pagina.set(1);
    this.carregar();
  }

  protected digitarBusca(valor: string): void {
    clearTimeout(this.temporizadorBusca);
    this.temporizadorBusca = setTimeout(() => {
      if (valor.trim() === this.busca().trim()) return;
      this.busca.set(valor);
      this.pagina.set(1);
      this.carregar();
    }, DEBOUNCE_BUSCA_MS);
  }

  protected mudarPagina(pagina: number): void { this.pagina.set(pagina); this.carregar(); }

  protected abrirAgendamento(): void { this.aviso.set(null); this.agendando.set(true); }

  protected aoAgendar(janela: ManutencaoResponse): void {
    this.agendando.set(false);
    const outras = janela.sobreposicoes.map((id) => `#${id}`);
    const atencao = outras.length === 0 ? '' : outras.length === 1 ? ` Atenção: sobrepõe a janela ${outras[0]}.` : ` Atenção: sobrepõe as janelas ${outras.join(', ')}.`;
    this.aviso.set(`Janela #${janela.id} agendada.${atencao}`);
    this.carregar();
  }

  protected acoesDe(janela: ManutencaoResponse): ActionMenuItem[] {
    const desabilitado = !this.podeGerenciar();
    if (janela.situacao === MaintenanceWindowStatus.Scheduled) return [{ id: 'cancelar', rotulo: 'Cancelar', desabilitado }];
    if (janela.situacao === MaintenanceWindowStatus.Active) return [{ id: 'encerrar', rotulo: 'Encerrar agora', desabilitado }];
    return [];
  }

  protected executar(janela: ManutencaoResponse, acao: string): void {
    if (acao !== 'cancelar' && acao !== 'encerrar') return;
    this.aviso.set(null);
    this.erroDialogo.set(null);
    this.confirmando.set({ acao, janela });
  }

  protected fecharDialogo(): void { if (!this.ocupado()) this.confirmando.set(null); }

  protected confirmar(): void {
    const alvo = this.confirmando();
    if (!alvo || this.ocupado()) return;
    this.ocupado.set(true);
    this.erroDialogo.set(null);
    const chamada = alvo.acao === 'cancelar' ? this.api.cancel(alvo.janela.id) : this.api.end(alvo.janela.id);
    chamada.pipe(take(1)).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.confirmando.set(null);
        this.aviso.set(TEXTOS[alvo.acao].sucesso(alvo.janela.id));
        this.carregar();
      },
      error: (erro: unknown) => {
        this.ocupado.set(false);
        this.erroDialogo.set(mensagemDe(erro, alvo.acao === 'cancelar' ? 'Não foi possível cancelar a janela.' : 'Não foi possível encerrar a janela.'));
      },
    });
  }

  protected escopoDe(janela: ManutencaoResponse): string {
    if (janela.escopo === MaintenanceScope.Unit) return 'Unidade inteira';
    const n = janela.equipamentos.length;
    return n === 1 ? '1 equipamento' : `${n} equipamentos`;
  }

  protected nomesDe(janela: ManutencaoResponse): string { return janela.equipamentos.map((e) => e.nome).join(', '); }

  protected dataHora(iso: string): string { return dataHora(iso); }

  /** "ativada 10:47 · 47 min de atraso" quando o job ativou mais de 1 min depois do previsto. */
  protected linhaAtivacao(janela: ManutencaoResponse): string | null {
    if (!janela.ativadaEm) return null;
    const atraso = Date.parse(janela.ativadaEm) - Date.parse(janela.inicioPrevisto);
    return atraso > TOLERANCIA_MS ? `ativada ${hora(janela.ativadaEm)} · ${duracao(atraso)} de atraso` : null;
  }

  /** Fim real diferente do previsto em mais de 1 min: encerrada antes (Encerrar agora) ou depois (job atrasado). */
  protected linhaEncerramento(janela: ManutencaoResponse): string | null {
    if (!janela.encerradaEm) return null;
    const diferenca = Date.parse(janela.encerradaEm) - Date.parse(janela.fimPrevisto);
    if (Math.abs(diferenca) <= TOLERANCIA_MS) return null;
    return `encerrada ${hora(janela.encerradaEm)} · ${duracao(Math.abs(diferenca))} ${diferenca > 0 ? 'de atraso' : 'antes do previsto'}`;
  }

  /** ATIVA com o fim previsto já passado: com o agendador desligado ninguém a conclui (MA18). */
  protected fimPassou(janela: ManutencaoResponse): boolean {
    return janela.situacao === MaintenanceWindowStatus.Active && Date.parse(janela.fimPrevisto) < Date.now();
  }

  protected contagem(): string {
    const total = this.totalItens();
    return total === 1 ? '1 janela' : `${total} janelas`;
  }
}

function duracao(ms: number): string {
  const minutos = Math.round(ms / 60_000);
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60); const resto = minutos % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}
function mensagemDe(erro: unknown, alternativa: string): string {
  return erro instanceof HttpErrorResponse && isApiError(erro.error) ? erro.error.message : alternativa;
}

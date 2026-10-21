import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, take } from 'rxjs';

import { plural } from '../../core/format/plural';
import { EquipmentOperationalStatus } from '../../core/models/api-enums';
import { isApiError } from '../../core/models/api-error';
import { DashboardEquipamentoLista } from '../../core/models/dashboard';
import { TipoEquipamentoResponse } from '../../core/models/tipo-equipamento';
import { AuthStateService } from '../../core/services/auth-state.service';
import { DashboardApiService } from '../../core/services/dashboard-api.service';
import { TipoEquipamentoApiService } from '../../core/services/tipo-equipamento-api.service';
import { ActionMenuComponent, ActionMenuItem } from '../../shared/action-menu/action-menu.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { ModalComponent } from '../../shared/modal/modal.component';
import { PaginacaoComponent } from '../../shared/paginacao/paginacao.component';

type Estado = 'loading' | 'success' | 'empty' | 'error';
type Aba = 'todos' | 'ativos' | 'inativos';
type Acao = 'excluir' | 'desativar' | 'ativar';

const POR_PAGINA = 20;

/** Contagens operacionais de um tipo. Mapa nulo = agregação indisponível. */
interface Contagem {
  dispositivos: number;
  online: number;
  degradados: number;
  offline: number;
}

const ZERO: Contagem = { dispositivos: 0, online: 0, degradados: 0, offline: 0 };

/**
 * Tipos de equipamento — cadastro administrativo com leitura operacional.
 *
 * As contagens vêm de `GET /dashboard/equipamentos`, o mesmo read-model da tela de
 * Equipamentos, agregado aqui no cliente. Esse endpoint expõe `tipoNome`, não `tipoId`:
 * a junção é por nome. É seguro no schema atual — `uq_tipo_equipamento_nome` é único
 * sobre `lower(nome)` — mas um rename entre as duas requisições deixa o tipo renomeado
 * sem contagem até o próximo carregamento. Resolver de vez exige `tipoId` no read-model,
 * que é mudança de backend.
 *
 * DISPOSITIVOS é o total de equipamentos do tipo; ONLINE/DEGRADADOS/OFFLINE cobrem só
 * `DISPONIVEL`, `DEGRADADO` e `INDISPONIVEL`. Os demais status (sem dados, manutenção,
 * sem monitoramento, desabilitado) entram apenas no total — as três colunas podem não
 * somar DISPOSITIVOS, e isso é intencional.
 *
 * A agregação falha em separado da listagem: sem ela o tipo aparece com "—" e a tabela
 * continua operável.
 */
@Component({
  selector: 'app-tipo-equipamento-list',
  imports: [ReactiveFormsModule, ConfirmDialogComponent, ModalComponent, PaginacaoComponent, ActionMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tipo-equipamento-list.component.html',
  styleUrl: './tipo-equipamento-list.component.scss',
})
export class TipoEquipamentoListComponent {
  protected readonly plural = plural;
  private readonly api = inject(TipoEquipamentoApiService);
  private readonly dashboard = inject(DashboardApiService);
  private readonly fb = inject(FormBuilder);
  protected readonly authState = inject(AuthStateService);

  protected readonly estado = signal<Estado>('loading');
  protected readonly erro = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);

  private readonly tipos = signal<TipoEquipamentoResponse[]>([]);
  /** `null` enquanto a agregação não chegou, ou depois que ela falhou. */
  private readonly contagens = signal<Map<string, Contagem> | null>(null);
  protected readonly agregacaoIndisponivel = signal(false);

  protected readonly aba = signal<Aba>('todos');
  protected readonly busca = signal('');
  protected readonly pagina = signal(1);

  protected readonly formAberto = signal(false);
  protected readonly emEdicao = signal<TipoEquipamentoResponse | null>(null);
  protected readonly salvando = signal(false);

  protected readonly acao = signal<Acao | null>(null);
  protected readonly alvo = signal<TipoEquipamentoResponse | null>(null);
  protected readonly processando = signal(false);
  protected readonly erroAcao = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.maxLength(150)]],
    descricao: ['', [Validators.maxLength(1000)]],
  });

  protected readonly abas: readonly { id: Aba; rotulo: string }[] = [
    { id: 'todos', rotulo: 'Todos' },
    { id: 'ativos', rotulo: 'Ativos' },
    { id: 'inativos', rotulo: 'Inativos' },
  ];

  // ---- Derivações --------------------------------------------------------------

  protected readonly total = computed(() => this.tipos().length);

  protected readonly filtrados = computed(() => {
    const termo = this.busca().trim().toLowerCase();
    if (!termo) return this.tipos();
    return this.tipos().filter((tipo) =>
      [tipo.nome, tipo.descricao].some((campo) => (campo ?? '').toLowerCase().includes(termo)));
  });

  protected readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.filtrados().length / POR_PAGINA)));
  protected readonly paginaAtual = computed(() => Math.min(this.pagina(), this.totalPaginas()));
  protected readonly visiveis = computed(() =>
    this.filtrados().slice((this.paginaAtual() - 1) * POR_PAGINA, this.paginaAtual() * POR_PAGINA));

  protected readonly semResultadoPorBusca = computed(() =>
    this.estado() === 'success' && this.filtrados().length === 0);

  /** `null` quando a agregação não está disponível: as colunas mostram "—". */
  protected contagemDe(tipo: TipoEquipamentoResponse): Contagem | null {
    const mapa = this.contagens();
    if (!mapa) return null;
    return mapa.get(chave(tipo.nome)) ?? ZERO;
  }

  /** Quantos equipamentos usam o tipo, ou `null` se a agregação não está disponível. */
  private vinculados(tipo: TipoEquipamentoResponse): number | null {
    return this.contagemDe(tipo)?.dispositivos ?? null;
  }

  // ---- Confirmações ------------------------------------------------------------

  protected readonly tituloConfirmacao = computed(() => {
    const nome = this.alvo()?.nome ?? '';
    switch (this.acao()) {
      case 'excluir': return `Excluir o tipo ${nome}?`;
      case 'desativar': return `Desativar o tipo ${nome}?`;
      case 'ativar': return `Ativar o tipo ${nome}?`;
      default: return '';
    }
  });

  protected readonly rotuloConfirmacao = computed(() => {
    switch (this.acao()) {
      case 'excluir': return 'Excluir';
      case 'desativar': return 'Desativar';
      default: return 'Ativar';
    }
  });

  protected readonly mensagemConfirmacao = computed(() => {
    const alvo = this.alvo();
    if (!alvo) return '';
    switch (this.acao()) {
      case 'excluir': {
        // O backend recusa com 409 BUSINESS_CONFLICT enquanto houver equipamento do tipo,
        // e a FK `fk_equipamento_tipo_equipamento` é ON DELETE RESTRICT. Só chega aqui o
        // tipo com zero vínculos conhecidos ou com contagem desconhecida — o menu bloqueia
        // o resto. Nada de prometer exclusão que a API nega.
        const emUso = this.vinculados(alvo);
        return emUso === 0
          ? `Nenhum equipamento usa o tipo ${alvo.nome} hoje. A exclusão é permanente e não pode ser desfeita.`
          : `Não foi possível conferir quantos equipamentos usam o tipo ${alvo.nome}. `
            + `Se existir algum, a API recusa a exclusão e nada é alterado.`;
      }
      case 'desativar':
        // Verificado no EquipamentoService: desativar o tipo não desliga monitoramento nem
        // toca nos equipamentos existentes; só bloqueia vínculo novo e reativação.
        return `Novos equipamentos não poderão mais ser criados nem movidos para ${alvo.nome}, `
          + `e equipamentos desativados desse tipo não poderão ser reativados. `
          + `Os equipamentos que já usam o tipo continuam ativos e monitorados.`;
      case 'ativar':
        return `${alvo.nome} volta a ficar disponível para novos equipamentos.`;
      default:
        return '';
    }
  });

  constructor() {
    this.carregar();
    this.carregarContagens();
  }

  // ---- Carga -------------------------------------------------------------------

  protected carregar(): void {
    this.estado.set('loading');
    this.erro.set(null);
    const aba = this.aba();
    this.api.list(aba === 'todos' ? undefined : aba === 'ativos').pipe(take(1)).subscribe({
      next: (tipos) => {
        this.tipos.set(tipos);
        this.estado.set(tipos.length ? 'success' : 'empty');
      },
      error: (erro: unknown) => {
        this.erro.set(mensagemDe(erro, 'Não foi possível carregar os tipos de equipamento.'));
        this.estado.set('error');
      },
    });
  }

  /** Requisição própria: falha aqui não pode derrubar a lista administrativa. */
  protected carregarContagens(): void {
    this.dashboard.getEquipamentos().pipe(take(1)).subscribe({
      next: (inventario) => {
        this.contagens.set(agregarPorTipo(inventario));
        this.agregacaoIndisponivel.set(false);
      },
      error: () => {
        this.contagens.set(null);
        this.agregacaoIndisponivel.set(true);
      },
    });
  }

  // ---- Abas, busca e paginação -------------------------------------------------

  protected mudarAba(aba: Aba): void {
    if (this.aba() === aba) return;
    this.aba.set(aba);
    this.pagina.set(1);
    this.carregar();
  }

  protected buscar(valor: string): void { this.busca.set(valor); this.pagina.set(1); }
  protected limparBusca(): void { this.busca.set(''); this.pagina.set(1); }
  protected irParaPagina(pagina: number): void { if (pagina >= 1 && pagina <= this.totalPaginas()) this.pagina.set(pagina); }

  // ---- Menu de ações -----------------------------------------------------------

  /**
   * Sem "Ver": não existe tela de detalhe de tipo.
   *
   * "Excluir" fica desabilitado quando sabemos que há equipamentos vinculados — abrir um
   * diálogo só para receber 409 é prometer o que a API recusa. Com a agregação
   * indisponível o item continua ativo e o erro real aparece dentro do diálogo.
   */
  protected itensDoMenu(tipo: TipoEquipamentoResponse): ActionMenuItem[] {
    const podeGerenciar = this.authState.canManageInventory();
    const emUso = this.vinculados(tipo);
    return [
      { id: 'editar', rotulo: 'Editar', desabilitado: !podeGerenciar },
      {
        id: tipo.ativo ? 'desativar' : 'ativar',
        rotulo: tipo.ativo ? 'Desativar' : 'Ativar',
        desabilitado: !podeGerenciar,
      },
      {
        id: 'excluir',
        rotulo: emUso !== null && emUso > 0 ? `Excluir (${emUso} em uso)` : 'Excluir',
        divisorAntes: true,
        destrutivo: true,
        desabilitado: !podeGerenciar || (emUso !== null && emUso > 0),
      },
    ];
  }

  protected executarAcao(tipo: TipoEquipamentoResponse, acao: string): void {
    switch (acao) {
      case 'editar':
        this.abrirEdicao(tipo);
        break;
      case 'ativar':
      case 'desativar':
      case 'excluir':
        this.aviso.set(null);
        this.erroAcao.set(null);
        this.alvo.set(tipo);
        this.acao.set(acao as Acao);
        break;
      default:
        break;
    }
  }

  protected cancelarAcao(): void {
    if (this.processando()) return;
    this.acao.set(null);
    this.alvo.set(null);
    this.erroAcao.set(null);
  }

  protected confirmarAcao(): void {
    const alvo = this.alvo();
    const acao = this.acao();
    if (!alvo || !acao || this.processando()) return;
    this.processando.set(true);
    this.erroAcao.set(null);

    const requisicao: Observable<unknown> = acao === 'excluir' ? this.api.delete(alvo.id)
      : acao === 'desativar' ? this.api.deactivate(alvo.id)
        : this.api.activate(alvo.id);

    requisicao.pipe(take(1)).subscribe({
      next: () => {
        this.processando.set(false);
        this.acao.set(null);
        this.alvo.set(null);
        this.aviso.set(acao === 'excluir' ? `O tipo ${alvo.nome} foi excluído.`
          : acao === 'desativar' ? `O tipo ${alvo.nome} foi desativado.`
            : `O tipo ${alvo.nome} foi ativado.`);
        this.carregar();
      },
      error: (erro: unknown) => {
        this.processando.set(false);
        // Mensagem real da API (BUSINESS_CONFLICT) fica no próprio diálogo.
        this.erroAcao.set(mensagemDe(erro, 'A operação foi recusada.'));
      },
    });
  }

  // ---- Formulário --------------------------------------------------------------

  protected abrirCriacao(): void {
    this.aviso.set(null);
    this.erro.set(null);
    this.emEdicao.set(null);
    this.form.reset({ nome: '', descricao: '' });
    this.formAberto.set(true);
  }

  /** A listagem já traz nome e descrição inteiros; nada aqui chega sob demanda. */
  protected abrirEdicao(tipo: TipoEquipamentoResponse): void {
    this.aviso.set(null);
    this.erro.set(null);
    this.emEdicao.set(tipo);
    this.form.reset({ nome: tipo.nome, descricao: tipo.descricao ?? '' });
    this.formAberto.set(true);
  }

  protected fecharFormulario(): void {
    if (this.salvando()) return;
    this.formAberto.set(false);
    this.emEdicao.set(null);
  }

  protected salvar(): void {
    if (this.salvando()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    this.salvando.set(true);
    const valores = this.form.getRawValue();
    const corpo = { nome: valores.nome.trim(), descricao: valores.descricao.trim() || null };
    const edicao = this.emEdicao();
    const requisicao = edicao ? this.api.update(edicao.id, corpo) : this.api.create(corpo);

    requisicao.pipe(take(1)).subscribe({
      next: (tipo) => {
        this.salvando.set(false);
        this.formAberto.set(false);
        this.emEdicao.set(null);
        this.aviso.set(edicao ? `O tipo ${tipo.nome} foi atualizado.` : `O tipo ${tipo.nome} foi criado.`);
        this.carregar();
        // O nome é a chave da agregação: renomear invalida o mapa atual.
        if (edicao) this.carregarContagens();
      },
      error: (erro: unknown) => {
        this.salvando.set(false);
        this.aplicarErroDeFormulario(erro);
      },
    });
  }

  private aplicarErroDeFormulario(erro: unknown): void {
    const apiError = erro instanceof HttpErrorResponse && isApiError(erro.error) ? erro.error : null;
    if (apiError?.fields) {
      for (const [campo, mensagem] of Object.entries(apiError.fields)) {
        const controle = this.form.get(campo);
        if (controle) { controle.setErrors({ backend: mensagem }); controle.markAsTouched(); }
      }
    }
    this.erro.set(apiError?.message ?? mensagemDe(erro, 'Não foi possível salvar o tipo de equipamento.'));
  }
}

/** Junção por nome normalizado — o read-model não expõe o id do tipo. */
function chave(nome: string): string {
  return nome.trim().toLowerCase();
}

function agregarPorTipo(inventario: DashboardEquipamentoLista[]): Map<string, Contagem> {
  const mapa = new Map<string, Contagem>();
  for (const linha of inventario) {
    const id = chave(linha.tipoNome ?? '');
    const atual = mapa.get(id) ?? { ...ZERO };
    atual.dispositivos += 1;
    if (linha.status === EquipmentOperationalStatus.Available) atual.online += 1;
    else if (linha.status === EquipmentOperationalStatus.Degraded) atual.degradados += 1;
    else if (linha.status === EquipmentOperationalStatus.Unavailable) atual.offline += 1;
    mapa.set(id, atual);
  }
  return mapa;
}

function mensagemDe(erro: unknown, alternativa: string): string {
  return erro instanceof HttpErrorResponse && isApiError(erro.error) ? erro.error.message : alternativa;
}

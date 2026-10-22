import { formatDate } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, forkJoin, map, take } from 'rxjs';

import { plural } from '../../core/format/plural';
import { EquipmentOperationalStatus } from '../../core/models/api-enums';
import { isApiError } from '../../core/models/api-error';
import { DashboardEquipamentoLista } from '../../core/models/dashboard';
import { EquipamentoCreateRequest, EquipamentoResponse } from '../../core/models/equipamento';
import { TipoEquipamentoResponse } from '../../core/models/tipo-equipamento';
import { UnidadeResponse } from '../../core/models/unidade';
import { AuthStateService } from '../../core/services/auth-state.service';
import { DashboardApiService } from '../../core/services/dashboard-api.service';
import { EquipamentoApiService } from '../../core/services/equipamento-api.service';
import { TipoEquipamentoApiService } from '../../core/services/tipo-equipamento-api.service';
import { UnidadeApiService } from '../../core/services/unidade-api.service';
import { ActionMenuComponent, ActionMenuItem } from '../../shared/action-menu/action-menu.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { ModalComponent } from '../../shared/modal/modal.component';
import { PaginacaoComponent } from '../../shared/paginacao/paginacao.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';
import { EquipamentoDetalheDrawerComponent } from './equipamento-detalhe-drawer.component';
import { origemDaManutencao } from './origem-manutencao';
import { classificarIp, motivoRecusaIp, validadorIpv4Monitoravel } from './ip-helper';

type Estado = 'loading' | 'success' | 'empty' | 'error';
type Acao = 'excluir' | 'desativar' | 'ativar' | 'iniciarManutencao' | 'encerrarManutencao';
type Ordenacao = 'nome,asc' | 'nome,desc' | 'status' | 'latencia';

const POR_PAGINA = 20;

function fimDaJanela(iso: string | null): string {
  return iso ? formatDate(iso, 'dd/MM HH:mm', 'en-US') : '';
}

/**
 * Decide pelo BOTÃO (`manutencaoManual`), não pelo estado efetivo: com janela ativa e botão desligado,
 * "Encerrar" não faria nada (o CAS do manual devolve 0). Manutenção de equipamento inativo não tem
 * efeito, mas sair da manual tem de ser sempre possível.
 */
function acaoDeManutencao(linha: Pick<DashboardEquipamentoLista, 'ativo' | 'manutencaoManual'>): 'iniciarManutencao' | 'encerrarManutencao' | null {
  if (linha.manutencaoManual) return 'encerrarManutencao';
  return linha.ativo ? 'iniciarManutencao' : null;
}

const ROTULOS_STATUS: Record<EquipmentOperationalStatus, string> = {
  DISPONIVEL: 'Online',
  DEGRADADO: 'Degradado',
  INDISPONIVEL: 'Offline',
  EM_MANUTENCAO: 'Em manutenção',
  SEM_DADOS: 'Sem dados',
  SEM_MONITORAMENTO: 'Sem monitoramento',
  DESABILITADO: 'Desabilitado',
};

/** Do mais grave ao menos grave: a ordenação por status leva a atenção para o topo. */
const GRAVIDADE: EquipmentOperationalStatus[] = [
  EquipmentOperationalStatus.Unavailable,
  EquipmentOperationalStatus.Degraded,
  EquipmentOperationalStatus.NoData,
  EquipmentOperationalStatus.Maintenance,
  EquipmentOperationalStatus.NoMonitoring,
  EquipmentOperationalStatus.Disabled,
  EquipmentOperationalStatus.Available,
];

/**
 * Inventário de equipamentos de todas as unidades.
 *
 * A listagem vem inteira de `GET /dashboard/equipamentos` (sem paginação de servidor) e é
 * filtrada, ordenada e paginada em memória — mesmo contrato adotado em Unidades.
 *
 * A busca cobre exatamente o que a listagem carrega — nome, hostname, IP, unidade, tipo,
 * localização e número de série. `descricao` não entra no read-model e por isso também
 * não entra na busca: prometer no placeholder um filtro sem o dado carregado seria o
 * mesmo erro do modal de exclusão de unidade.
 *
 * A edição busca o cadastro completo em `GET /equipamentos/{id}` ao abrir, porque a
 * listagem não traz `descricao`.
 *
 * A rota `/equipamentos/:id` aponta para este mesmo componente e abre o drawer de
 * detalhe já montado. Não existe mais página cheia de equipamento: manter o path
 * preserva deep-link, compartilhamento de URL, o botão voltar do navegador e os
 * links vindos de Relatórios e da aba Equipamentos do detalhe de unidade.
 */
@Component({
  selector: 'app-equipamento-list',
  imports: [ReactiveFormsModule, ConfirmDialogComponent, ModalComponent, PaginacaoComponent, StatusBadgeComponent,
    ActionMenuComponent, EquipamentoDetalheDrawerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './equipamento-list.component.html',
  styleUrl: './equipamento-list.component.scss',
})
export class EquipamentoListComponent {
  protected readonly plural = plural;
  protected readonly origemDaManutencao = origemDaManutencao;
  private readonly api = inject(EquipamentoApiService);
  private readonly dashboard = inject(DashboardApiService);
  private readonly unidadesApi = inject(UnidadeApiService);
  private readonly tiposApi = inject(TipoEquipamentoApiService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly authState = inject(AuthStateService);

  /**
   * `:id` da rota. Reativo de propósito: navegar de `/equipamentos/1` para
   * `/equipamentos/2` reaproveita a instância do componente e só o parâmetro muda.
   *
   * TODO: DÍVIDA -- `equipamentos` e `equipamentos/:id` são configurações de rota IRMÃS,
   * então navegar da lista para o detalhe troca de configuração e o Router destrói e
   * recria este componente: a busca, os filtros e a página voltam ao padrão a cada
   * abertura do drawer. `/incidentes` já foi corrigido — lá as rotas de detalhe são
   * FILHAS, sem componente próprio, e o pai sobrevive à navegação (ver `app.routes.ts`).
   * Fazer o mesmo aqui. Não foi feito junto por ser fora do escopo daquela rodada.
   */
  protected readonly detalheId = toSignal(
    this.route.paramMap.pipe(map((parametros) => {
      const bruto = parametros.get('id');
      const id = Number(bruto);
      return bruto !== null && Number.isInteger(id) && id > 0 ? id : null;
    })),
    { initialValue: null },
  );

  protected readonly estado = signal<Estado>('loading');
  protected readonly erro = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);

  private readonly inventario = signal<DashboardEquipamentoLista[]>([]);
  protected readonly unidades = signal<UnidadeResponse[]>([]);
  protected readonly tipos = signal<TipoEquipamentoResponse[]>([]);

  protected readonly busca = signal('');
  protected readonly pagina = signal(1);
  protected readonly filtrosAbertos = signal(false);
  protected readonly filtroUnidade = signal<number | null>(null);
  protected readonly filtroTipo = signal<string | null>(null);
  protected readonly filtroStatus = signal<EquipmentOperationalStatus | null>(null);
  protected readonly ordenacao = signal<Ordenacao>('nome,asc');

  protected readonly formAberto = signal(false);
  private readonly gaveta = viewChild(EquipamentoDetalheDrawerComponent);
  private readonly gavetaHost = viewChild(EquipamentoDetalheDrawerComponent, { read: ElementRef });
  private gatilhoNaGaveta: HTMLElement | null = null;
  protected readonly emEdicao = signal<DashboardEquipamentoLista | null>(null);
  protected readonly carregandoEdicao = signal(false);
  protected readonly salvando = signal(false);

  protected readonly acao = signal<Acao | null>(null);
  protected readonly alvo = signal<DashboardEquipamentoLista | null>(null);
  protected readonly processando = signal(false);
  protected readonly erroAcao = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.maxLength(150)]],
    tipoEquipamentoId: [0, [Validators.min(1)]],
    unidadeId: [0, [Validators.min(1)]],
    hostname: ['', [Validators.maxLength(255)]],
    ip: ['', [Validators.required, Validators.maxLength(45), validadorIpv4Monitoravel]],
    fabricante: ['', [Validators.maxLength(100)]],
    modelo: ['', [Validators.maxLength(150)]],
    numeroSerie: ['', [Validators.maxLength(150)]],
    localizacao: ['', [Validators.maxLength(255)]],
    descricao: ['', [Validators.maxLength(1000)]],
  });

  /** Texto informativo do IP: classifica, nunca bloqueia o envio. */
  protected readonly dicaIp = signal<string | null>(null);

  // ---- Derivações da listagem -------------------------------------------------

  /** Opções vindas dos dados já carregados, não de uma chamada própria. */
  protected readonly unidadesDoInventario = computed(() => {
    const porId = new Map<number, string>();
    for (const linha of this.inventario()) porId.set(linha.unidadeId, linha.unidadeNome);
    return [...porId].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome));
  });

  protected readonly tiposDoInventario = computed(() =>
    [...new Set(this.inventario().map((linha) => linha.tipoNome))].sort((a, b) => a.localeCompare(b)));

  protected readonly statusDoInventario = computed(() => {
    const presentes = new Set(this.inventario().map((linha) => linha.status));
    return GRAVIDADE.filter((status) => presentes.has(status))
      .map((status) => ({ status, rotulo: ROTULOS_STATUS[status] }));
  });

  protected readonly filtrosAtivos = computed(() =>
    (this.filtroUnidade() === null ? 0 : 1)
    + (this.filtroTipo() === null ? 0 : 1)
    + (this.filtroStatus() === null ? 0 : 1)
    + (this.ordenacao() === 'nome,asc' ? 0 : 1));

  protected readonly filtradas = computed(() => {
    const termo = this.busca().trim().toLowerCase();
    const unidade = this.filtroUnidade();
    const tipo = this.filtroTipo();
    const status = this.filtroStatus();

    const resultado = this.inventario().filter((linha) => {
      if (unidade !== null && linha.unidadeId !== unidade) return false;
      if (tipo !== null && linha.tipoNome !== tipo) return false;
      if (status !== null && linha.status !== status) return false;
      if (!termo) return true;
      return [linha.nome, linha.hostname, linha.ip, linha.unidadeNome, linha.tipoNome,
        linha.localizacao, linha.numeroSerie]
        .some((campo) => (campo ?? '').toLowerCase().includes(termo));
    });

    return this.ordenar(resultado);
  });

  protected readonly total = computed(() => this.inventario().length);
  protected readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.filtradas().length / POR_PAGINA)));
  protected readonly paginaAtual = computed(() => Math.min(this.pagina(), this.totalPaginas()));
  protected readonly visiveis = computed(() =>
    this.filtradas().slice((this.paginaAtual() - 1) * POR_PAGINA, this.paginaAtual() * POR_PAGINA));

  protected readonly semResultadoPorFiltro = computed(() =>
    this.estado() === 'success' && this.filtradas().length === 0);

  // ---- Confirmações -----------------------------------------------------------

  protected readonly tituloConfirmacao = computed(() => {
    const nome = this.alvo()?.nome ?? '';
    switch (this.acao()) {
      case 'excluir': return `Excluir ${nome}?`;
      case 'desativar': return `Desativar o monitoramento de ${nome}?`;
      case 'ativar': return `Ativar o monitoramento de ${nome}?`;
      case 'iniciarManutencao': return `Iniciar manutenção de ${nome}?`;
      case 'encerrarManutencao': return `Encerrar manutenção de ${nome}?`;
      default: return '';
    }
  });

  protected readonly rotuloConfirmacao = computed(() => {
    switch (this.acao()) {
      case 'excluir': return 'Excluir';
      case 'desativar': return 'Desativar';
      case 'iniciarManutencao': return 'Iniciar manutenção';
      case 'encerrarManutencao': return 'Encerrar manutenção';
      default: return 'Ativar';
    }
  });

  protected readonly mensagemConfirmacao = computed(() => {
    const alvo = this.alvo();
    if (!alvo) return '';
    switch (this.acao()) {
      case 'excluir':
        // O backend recusa a exclusão enquanto houver monitor associado (409
        // BUSINESS_CONFLICT, espelhado pelo FK ON DELETE RESTRICT). Prometer uma
        // exclusão que a API costuma negar empurra o usuário para um erro evitável.
        return `Este equipamento só pode ser excluído se não houver monitores associados a ele. `
          + `Se houver, a API vai recusar a exclusão e nada será alterado.`;
      case 'desativar':
        return `${alvo.nome} deixa de ser verificado por ICMP e não gera mais alertas. `
          + `A janela de monitoramento em andamento é fechada, o que afeta o relatório de disponibilidade do período.`;
      case 'ativar':
        return `${alvo.nome} volta a ser verificado por ICMP na próxima varredura. `
          + `A ativação é recusada se a unidade ou o tipo de equipamento estiver inativo.`;
      case 'iniciarManutencao':
        return `${alvo.nome} deixa de ser verificado por ICMP e não gera incidentes nem alertas até a manutenção ser encerrada. `
          + `Incidentes e episódios de latência abertos são encerrados com motivo Manutenção; se a abertura já foi avisada no Telegram, `
          + `sai um aviso de encerramento, e avisos ainda não enviados são cancelados. `
          + `O período não conta no relatório de disponibilidade.`;
      case 'encerrarManutencao':
        return `${alvo.nome} volta a ser verificado por ICMP na próxima varredura. `
          + `Se continuar fora do ar, um incidente é aberto depois das falhas consecutivas configuradas no monitor.`
          + (alvo.janelaAtivaId !== null
            ? ` ${alvo.nome} continua em manutenção pela janela #${alvo.janelaAtivaId}${alvo.janelaAtivaFim ? ` até ${fimDaJanela(alvo.janelaAtivaFim)}` : ''}.`
            : '');
      default:
        return '';
    }
  });

  /** Só a exclusão é destrutiva; entrar e sair de manutenção são operações reversíveis. */
  protected readonly tomConfirmacao = computed<'perigo' | 'primario'>(() =>
    this.acao() === 'iniciarManutencao' || this.acao() === 'encerrarManutencao' ? 'primario' : 'perigo');

  constructor() {
    this.carregarOpcoesDoFormulario();
    this.carregar();
  }

  // ---- Carga ------------------------------------------------------------------

  protected carregar(): void {
    this.estado.set('loading');
    this.erro.set(null);
    this.dashboard.getEquipamentos().pipe(take(1)).subscribe({
      next: (linhas) => {
        this.inventario.set(linhas);
        this.estado.set(linhas.length ? 'success' : 'empty');
      },
      error: (erro: unknown) => {
        this.erro.set(mensagemDe(erro, 'Não foi possível carregar o inventário.'));
        this.estado.set('error');
      },
    });
  }

  /** Selects do formulário: os tipos e unidades cadastrados, não só os já usados. */
  private carregarOpcoesDoFormulario(): void {
    forkJoin({ unidades: this.unidadesApi.list(true), tipos: this.tiposApi.list(true) }).pipe(take(1)).subscribe({
      next: ({ unidades, tipos }) => { this.unidades.set(unidades); this.tipos.set(tipos); },
      error: () => this.aviso.set('Não foi possível carregar as opções de unidade e tipo do formulário.'),
    });
  }

  // ---- Busca, filtros, paginação ---------------------------------------------

  protected buscar(valor: string): void { this.busca.set(valor); this.pagina.set(1); }
  protected alternarFiltros(): void { this.filtrosAbertos.update((aberto) => !aberto); }
  protected mudarUnidade(valor: string): void { this.filtroUnidade.set(valor ? Number(valor) : null); this.pagina.set(1); }
  protected mudarTipo(valor: string): void { this.filtroTipo.set(valor || null); this.pagina.set(1); }
  protected mudarStatus(valor: string): void { this.filtroStatus.set((valor || null) as EquipmentOperationalStatus | null); this.pagina.set(1); }
  protected mudarOrdenacao(valor: string): void { this.ordenacao.set(valor as Ordenacao); this.pagina.set(1); }
  protected irParaPagina(pagina: number): void { if (pagina >= 1 && pagina <= this.totalPaginas()) this.pagina.set(pagina); }

  protected limparFiltros(): void {
    this.filtroUnidade.set(null);
    this.filtroTipo.set(null);
    this.filtroStatus.set(null);
    this.ordenacao.set('nome,asc');
    this.pagina.set(1);
  }

  private ordenar(linhas: DashboardEquipamentoLista[]): DashboardEquipamentoLista[] {
    const ordenadas = [...linhas];
    switch (this.ordenacao()) {
      case 'nome,desc':
        return ordenadas.sort((a, b) => b.nome.localeCompare(a.nome));
      case 'status':
        return ordenadas.sort((a, b) =>
          GRAVIDADE.indexOf(a.status) - GRAVIDADE.indexOf(b.status) || a.nome.localeCompare(b.nome));
      case 'latencia':
        // Sem latência vai para o fim: "desconhecido" não é "rápido".
        return ordenadas.sort((a, b) =>
          (b.latenciaMs ?? -1) - (a.latenciaMs ?? -1) || a.nome.localeCompare(b.nome));
      default:
        return ordenadas.sort((a, b) => a.nome.localeCompare(b.nome));
    }
  }

  // ---- Menu de ações ----------------------------------------------------------

  protected itensDoMenu(linha: DashboardEquipamentoLista): ActionMenuItem[] {
    const podeGerenciar = this.authState.canManageInventory();
    const manutencao = acaoDeManutencao(linha);
    return [
      { id: 'ver', rotulo: 'Ver' },
      { id: 'editar', rotulo: 'Editar', desabilitado: !podeGerenciar },
      {
        id: linha.ativo ? 'desativar' : 'ativar',
        rotulo: linha.ativo ? 'Desativar monitoramento' : 'Ativar monitoramento',
        desabilitado: !podeGerenciar,
      },
      ...(manutencao ? [{ id: manutencao, rotulo: manutencao === 'iniciarManutencao' ? 'Iniciar manutenção' : 'Encerrar manutenção', desabilitado: !podeGerenciar }] : []),
      { id: 'excluir', rotulo: 'Excluir', divisorAntes: true, destrutivo: true, desabilitado: !podeGerenciar },
    ];
  }

  protected executarAcao(linha: DashboardEquipamentoLista, acao: string): void {
    switch (acao) {
      case 'ver': this.abrirDetalhe(linha); break;
      case 'editar': this.abrirEdicao(linha); break;
      case 'ativar':
      case 'desativar':
      case 'iniciarManutencao':
      case 'encerrarManutencao':
      case 'excluir':
        this.aviso.set(null);
        this.erroAcao.set(null);
        this.alvo.set(linha);
        this.acao.set(acao as Acao);
        break;
      default: break;
    }
  }

  protected abrirDetalhe(linha: DashboardEquipamentoLista): void {
    this.router.navigate(['/equipamentos', linha.id]);
  }

  // ---- Drawer de detalhe -------------------------------------------------------

  /** Linha correspondente ao `:id` aberto; nula em deep-link enquanto o inventário carrega. */
  protected readonly detalheLinha = computed(() => {
    const id = this.detalheId();
    return id === null ? null : this.inventario().find((linha) => linha.id === id) ?? null;
  });

  /** Fechar o drawer é voltar para a lista limpa: o histórico do navegador acompanha. */
  protected fecharDetalhe(): void {
    this.router.navigate(['/equipamentos']);
  }

  protected editarDoDetalhe(): void {
    const linha = this.detalheLinha();
    if (!linha) return;
    this.guardarGatilhoDaGaveta();
    this.abrirEdicao(linha);
  }

  protected alternarDoDetalhe(): void {
    const linha = this.detalheLinha();
    if (!linha) return;
    this.guardarGatilhoDaGaveta();
    this.executarAcao(linha, linha.ativo ? 'desativar' : 'ativar');
  }

  protected alternarManutencaoDoDetalhe(): void {
    const linha = this.detalheLinha();
    if (!linha) return;
    const acao = acaoDeManutencao(linha);
    if (!acao) return;
    this.guardarGatilhoDaGaveta();
    this.executarAcao(linha, acao);
  }

  /** O read-model já traz `unidadeId`; nenhuma chamada extra para tornar a coluna navegável. */
  protected abrirUnidade(linha: DashboardEquipamentoLista): void {
    this.router.navigate(['/unidades', linha.unidadeId]);
  }

  protected cancelarAcao(): void {
    if (this.processando()) return;
    this.acao.set(null);
    this.alvo.set(null);
    this.erroAcao.set(null);
    this.devolverFocoAGaveta();
  }

  protected confirmarAcao(): void {
    const alvo = this.alvo();
    const acao = this.acao();
    if (!alvo || !acao || this.processando()) return;
    this.processando.set(true);
    this.erroAcao.set(null);

    let requisicao: Observable<unknown>;
    switch (acao) {
      case 'excluir': requisicao = this.api.delete(alvo.id); break;
      case 'desativar': requisicao = this.api.deactivate(alvo.id); break;
      case 'ativar': requisicao = this.api.activate(alvo.id); break;
      case 'iniciarManutencao': requisicao = this.api.startMaintenance(alvo.id); break;
      case 'encerrarManutencao': requisicao = this.api.endMaintenance(alvo.id); break;
    }

    requisicao.pipe(take(1)).subscribe({
      next: () => {
        this.processando.set(false);
        this.acao.set(null);
        this.alvo.set(null);
        this.devolverFocoAGaveta();
        this.aviso.set(avisoDeSucesso(acao, alvo));
        this.carregar();
      },
      error: (erro: unknown) => {
        this.processando.set(false);
        // A mensagem real da API (BUSINESS_CONFLICT) fica no próprio diálogo.
        this.erroAcao.set(mensagemDe(erro, 'A operação foi recusada.'));
      },
    });
  }

  // ---- Formulário -------------------------------------------------------------

  protected abrirCriacao(): void {
    this.aviso.set(null);
    this.emEdicao.set(null);
    this.carregandoEdicao.set(false);
    this.dicaIp.set(null);
    this.form.reset({ nome: '', tipoEquipamentoId: 0, unidadeId: 0, hostname: '', ip: '', fabricante: '', modelo: '', numeroSerie: '', localizacao: '', descricao: '' });
    this.form.enable();
    this.formAberto.set(true);
  }

  /**
   * Edição carrega o cadastro completo antes de liberar o formulário. A listagem não
   * traz localização, descrição nem número de série; salvar com o formulário meio vazio
   * apagaria esses campos, que é exatamente a regressão que ocorreu no drawer de Unidades.
   */
  protected abrirEdicao(linha: DashboardEquipamentoLista): void {
    this.aviso.set(null);
    this.erro.set(null);
    this.dicaIp.set(null);
    this.emEdicao.set(linha);
    this.formAberto.set(true);
    this.carregandoEdicao.set(true);
    this.form.disable();

    this.api.getById(linha.id).pipe(take(1)).subscribe({
      next: (equipamento) => {
        this.form.reset({
          nome: equipamento.nome,
          tipoEquipamentoId: equipamento.tipoEquipamento.id,
          unidadeId: equipamento.unidade.id,
          hostname: equipamento.hostname ?? '',
          ip: equipamento.ip ?? '',
          fabricante: equipamento.fabricante ?? '',
          modelo: equipamento.modelo ?? '',
          numeroSerie: equipamento.numeroSerie ?? '',
          localizacao: equipamento.localizacao ?? '',
          descricao: equipamento.descricao ?? '',
        });
        this.garantirReferenciasAtuais(equipamento);
        this.form.enable();
        this.carregandoEdicao.set(false);
        this.avaliarIp(equipamento.ip ?? '');
      },
      error: (erro: unknown) => {
        this.carregandoEdicao.set(false);
        this.formAberto.set(false);
        this.emEdicao.set(null);
        this.erro.set(mensagemDe(erro, 'Não foi possível carregar o equipamento para edição.'));
        this.devolverFocoAGaveta();
      },
    });
  }

  /** Unidade ou tipo inativos não vêm nos selects; sem isto a edição os trocaria em silêncio. */
  private garantirReferenciasAtuais(equipamento: EquipamentoResponse): void {
    if (!this.unidades().some((unidade) => unidade.id === equipamento.unidade.id)) {
      this.unidades.update((atuais) => [...atuais, {
        id: equipamento.unidade.id, nome: `${equipamento.unidade.nome} (inativa)`, sigla: '', descricao: null,
        codigoIbge: null, ativo: false, createdAt: '', updatedAt: '', endereco: null, cidade: null, uf: null,
        latitude: null, longitude: null, conectaAUnidadeId: null,
      }]);
    }
    if (!this.tipos().some((tipo) => tipo.id === equipamento.tipoEquipamento.id)) {
      this.tipos.update((atuais) => [...atuais, {
        id: equipamento.tipoEquipamento.id, nome: `${equipamento.tipoEquipamento.nome} (inativo)`,
        descricao: null, ativo: false, createdAt: '', updatedAt: '',
      } as TipoEquipamentoResponse]);
    }
  }

  protected fecharFormulario(): void {
    if (this.salvando()) return;
    this.formAberto.set(false);
    this.emEdicao.set(null);
    this.carregandoEdicao.set(false);
    // O modal abriu por cima da gaveta e a gaveta estava inert: sem isso o foco
    // ficaria no <body> ao cancelar, e o Tab recomecaria do topo da pagina.
    this.devolverFocoAGaveta();
  }

  /** Botão da gaveta que abriu o modal ou a confirmação por cima dela. */
  private guardarGatilhoDaGaveta(): void {
    this.gatilhoNaGaveta = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  /**
   * Devolve o foco à gaveta quando um modal (formulário ou confirmação) fecha por cima dela.
   *
   * O app-modal tenta devolver o foco ao gatilho ("Editar equipamento") ao fechar, mas faz isso
   * na mesma renderização que tira o `inert` da gaveta e chega antes: o gatilho ainda está sob o
   * `inert`, o focus() falha em silêncio e o foco cai no <body> (provado no spec com `inert`
   * simulado). O setTimeout roda depois dessa renderização, com a gaveta já focável: volta ao
   * gatilho guardado e, sem ele, ao painel. Se o foco já está dentro da gaveta, não mexe.
   */
  private devolverFocoAGaveta(): void {
    if (this.detalheId() === null) return;
    setTimeout(() => {
      const gatilho = this.gatilhoNaGaveta;
      this.gatilhoNaGaveta = null;
      const gaveta = this.gavetaHost()?.nativeElement;
      if (!gaveta || gaveta.contains(document.activeElement)) return;
      if (gatilho?.isConnected && gaveta.contains(gatilho)) gatilho.focus();
      else this.gaveta()?.focarPainel();
    });
  }

  protected avaliarIp(valor: string): void {
    // Valor recusado já tem o motivo sob o campo; a dica informativa só atrapalharia.
    this.dicaIp.set(motivoRecusaIp(valor) !== null ? null : classificarIp(valor));
  }

  protected salvar(): void {
    if (this.salvando() || this.carregandoEdicao()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    this.salvando.set(true);
    const corpo = this.corpoDaRequisicao();
    const edicao = this.emEdicao();
    const requisicao = edicao ? this.api.update(edicao.id, corpo) : this.api.create(corpo);

    requisicao.pipe(take(1)).subscribe({
      next: (equipamento) => {
        this.salvando.set(false);
        this.formAberto.set(false);
        this.emEdicao.set(null);
        this.aviso.set(edicao ? 'Equipamento atualizado.' : `Equipamento ${equipamento.nome} criado.`);
        this.carregar();
        this.devolverFocoAGaveta();
      },
      error: (erro: unknown) => {
        this.salvando.set(false);
        this.aplicarErroDeFormulario(erro);
      },
    });
  }

  private corpoDaRequisicao(): EquipamentoCreateRequest {
    const valores = this.form.getRawValue();
    return {
      unidadeId: valores.unidadeId,
      tipoEquipamentoId: valores.tipoEquipamentoId,
      nome: valores.nome.trim(),
      ip: nuloSeVazio(valores.ip),
      hostname: nuloSeVazio(valores.hostname),
      descricao: nuloSeVazio(valores.descricao),
      localizacao: nuloSeVazio(valores.localizacao),
      numeroSerie: nuloSeVazio(valores.numeroSerie),
      fabricante: nuloSeVazio(valores.fabricante),
      modelo: nuloSeVazio(valores.modelo),
    };
  }

  private aplicarErroDeFormulario(erro: unknown): void {
    const apiError = erro instanceof HttpErrorResponse && isApiError(erro.error) ? erro.error : null;
    if (apiError?.fields) {
      for (const [campo, mensagem] of Object.entries(apiError.fields)) {
        const controle = this.form.get(campo);
        if (controle) { controle.setErrors({ backend: mensagem }); controle.markAsTouched(); }
      }
    }
    this.erro.set(apiError?.message ?? mensagemDe(erro, 'Não foi possível salvar o equipamento.'));
  }

  protected rotuloStatus(status: EquipmentOperationalStatus): string { return ROTULOS_STATUS[status]; }
}

function avisoDeSucesso(acao: Acao, alvo: DashboardEquipamentoLista): string {
  const nome = alvo.nome;
  switch (acao) {
    case 'excluir': return `${nome} foi excluído.`;
    case 'desativar': return `Monitoramento de ${nome} desativado.`;
    case 'ativar': return `Monitoramento de ${nome} ativado.`;
    case 'iniciarManutencao': return `${nome} em manutenção.`;
    case 'encerrarManutencao':
      return alvo.janelaAtivaId !== null
        ? `Manutenção manual de ${nome} encerrada. Continua em manutenção pela janela #${alvo.janelaAtivaId}.`
        : `Manutenção de ${nome} encerrada.`;
  }
}

function nuloSeVazio(valor: string): string | null {
  const limpo = valor.trim();
  return limpo || null;
}

function mensagemDe(erro: unknown, alternativa: string): string {
  return erro instanceof HttpErrorResponse && isApiError(erro.error) ? erro.error.message : alternativa;
}

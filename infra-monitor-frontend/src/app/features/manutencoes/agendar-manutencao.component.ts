import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { take } from 'rxjs';
import { MaintenanceScope } from '../../core/models/api-enums';
import { isApiError } from '../../core/models/api-error';
import { DashboardEquipamentoLista } from '../../core/models/dashboard';
import { CriarManutencaoRequest, ManutencaoResponse, PresetAgendamento } from '../../core/models/manutencao';
import { UnidadeResponse } from '../../core/models/unidade';
import { DashboardApiService } from '../../core/services/dashboard-api.service';
import { ManutencaoApiService } from '../../core/services/manutencao-api.service';
import { UnidadeApiService } from '../../core/services/unidade-api.service';
import { ModalComponent } from '../../shared/modal/modal.component';
import { erroDoPeriodo, isoParaLocal, localParaIso } from './periodo';

/**
 * Modal "Agendar manutenção". Sempre montado pela lista: o retorno do foco ao gatilho é
 * do app-modal e só acontece na transição aberto → fechado, não na destruição.
 *
 * Equipamentos vêm do read-model `/dashboard/equipamentos` (uma chamada, sem paginação),
 * filtrados aqui por unidade e `ativo` — o backend recusa equipamento inativo ou de outra unidade.
 */
@Component({
  selector: 'app-agendar-manutencao',
  imports: [ReactiveFormsModule, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agendar-manutencao.component.html',
  styleUrl: './agendar-manutencao.component.scss',
})
export class AgendarManutencaoComponent {
  private readonly api = inject(ManutencaoApiService);
  private readonly unidadesApi = inject(UnidadeApiService);
  private readonly dashboardApi = inject(DashboardApiService);

  readonly aberto = input(false);
  readonly duracaoMaximaHoras = input.required<number>();
  readonly fechar = output<void>();
  readonly preset = input<PresetAgendamento | null>(null);
  readonly janela = input<ManutencaoResponse | null>(null);
  readonly agendada = output<ManutencaoResponse>();
  readonly salva = output<ManutencaoResponse>();

  protected readonly escopos = MaintenanceScope;
  protected readonly unidades = signal<UnidadeResponse[]>([]);
  private readonly equipamentos = signal<DashboardEquipamentoLista[]>([]);
  protected readonly erroCarga = signal<string | null>(null);
  protected readonly unidadeId = signal<number | null>(null);
  protected readonly escopo = signal<MaintenanceScope>(MaintenanceScope.Equipment);
  protected readonly selecionados = signal<ReadonlySet<number>>(new Set());
  protected readonly tentou = signal(false);
  protected readonly erroPeriodo = signal<string | null>(null);
  protected readonly erroApi = signal<string | null>(null);
  protected readonly salvando = signal(false);
  protected readonly emEdicao = computed(() => this.janela() !== null);
  /** Janela carregada do GET /{id} ao abrir em edição: valores e versão frescos. */
  private readonly carregada = signal<ManutencaoResponse | null>(null);
  protected readonly titulo = computed(() => { const j = this.janela(); return j ? `Editar janela #${j.id}` : 'Agendar manutenção'; });

  protected readonly form = inject(FormBuilder).nonNullable.group({
    unidadeId: ['', Validators.required],
    // Padrão "Equipamentos selecionados" (MA18): silenciar a unidade inteira é escolha explícita.
    escopo: [MaintenanceScope.Equipment as MaintenanceScope],
    inicio: [''],
    fim: [''],
    motivo: ['', [Validators.maxLength(300)]],
  });

  /** Linha da checklist. `nota` explica vinculado que hoje não seria aceito como novo (MA21). */
  protected readonly equipamentosDaUnidade = computed<{ id: number; nome: string; nota: string | null }[]>(() => {
    const unidade = this.unidadeId();
    if (unidade === null) return [];
    const ativos = this.equipamentos().filter((e) => e.unidadeId === unidade && e.ativo).map((e) => ({ id: e.id, nome: e.nome, nota: null as string | null }));
    const j = this.carregada();
    const vinculados = j && j.unidade.id === unidade
      ? j.equipamentos.filter((v) => !ativos.some((x) => x.id === v.id)).map((v) => {
          const atual = this.equipamentos().find((e) => e.id === v.id);
          const nota = !atual ? null : atual.unidadeId !== unidade ? 'agora em outra unidade' : !atual.ativo ? 'inativo' : null;
          return { id: v.id, nome: v.nome, nota };
        })
      : [];
    return [...ativos, ...vinculados].sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
  });
  protected readonly temVinculadoComNota = computed(() => this.equipamentosDaUnidade().some((e) => e.nota !== null));
  protected readonly todosMarcados = computed(() => {
    const lista = this.equipamentosDaUnidade();
    return this.escopo() === MaintenanceScope.Equipment && lista.length > 1 && lista.every((e) => this.selecionados().has(e.id));
  });
  protected readonly faltaEquipamento = computed(() => this.escopo() === MaintenanceScope.Equipment && this.selecionados().size === 0);

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.form.controls.unidadeId.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe((valor) => {
      this.unidadeId.set(valor ? Number(valor) : null);
      this.selecionados.set(new Set());
    });
    this.form.controls.escopo.valueChanges.pipe(takeUntilDestroyed(destroyRef)).subscribe((valor) => this.escopo.set(valor));
    // Só `aberto` é rastreado: preparar() mexe no form e em signals que não podem reabrir o efeito.
    effect(() => { if (this.aberto()) untracked(() => this.preparar()); });
  }

  protected alternar(id: number, marcado: boolean): void {
    this.selecionados.update((atual) => {
      const novo = new Set(atual);
      if (marcado) novo.add(id); else novo.delete(id);
      return novo;
    });
  }

  protected pedirFechar(): void { if (!this.salvando()) this.fechar.emit(); }

  protected enviar(): void {
    if (this.salvando()) return;
    this.tentou.set(true);
    this.erroApi.set(null);
    const v = this.form.getRawValue();
    const inicio = localParaIso(v.inicio);
    const fim = localParaIso(v.fim);
    this.erroPeriodo.set(erroDoPeriodo(inicio, fim, new Date(), this.duracaoMaximaHoras()));
    const motivo = v.motivo.trim();
    if (!v.unidadeId || !motivo || motivo.length > 300 || this.faltaEquipamento() || this.erroPeriodo() || !inicio || !fim) return;
    const request: CriarManutencaoRequest = {
      unidadeId: Number(v.unidadeId),
      escopo: v.escopo,
      equipamentoIds: v.escopo === MaintenanceScope.Equipment ? [...this.selecionados()].sort((a, b) => a - b) : [],
      inicioPrevisto: inicio,
      fimPrevisto: fim,
      motivo,
    };
    this.salvando.set(true);
    const existente = this.carregada();
    const chamada = existente ? this.api.update(existente.id, { ...request, versao: existente.versao }) : this.api.create(request);
    chamada.pipe(take(1)).subscribe({
      next: (janela) => { this.salvando.set(false); if (existente) this.salva.emit(janela); else this.agendada.emit(janela); },
      error: (erro: unknown) => {
        this.salvando.set(false);
        this.erroApi.set(erro instanceof HttpErrorResponse && isApiError(erro.error) ? erro.error.message : existente ? 'Não foi possível salvar a janela.' : 'Não foi possível agendar a manutenção.');
      },
    });
  }

  private preparar(): void {
    this.tentou.set(false); this.erroPeriodo.set(null); this.erroApi.set(null); this.erroCarga.set(null);
    this.carregada.set(null);
    const janela = this.janela();
    if (janela) {
      this.preencherDe(janela);
      this.carregada.set(janela);
      // Valores e versão frescos: a linha da lista pode estar velha.
      this.api.get(janela.id).pipe(take(1)).subscribe({
        next: (atual) => { this.carregada.set(atual); this.preencherDe(atual); },
        error: () => this.erroCarga.set('Não foi possível carregar a janela.'),
      });
    } else {
      // Sugestão: próxima hora cheia, duas horas de janela. O operador ajusta.
      const inicio = new Date(); inicio.setMinutes(0, 0, 0); inicio.setHours(inicio.getHours() + 1);
      const p = this.preset();
      this.preencher({ unidadeId: p?.unidadeId ?? null, travarUnidade: p?.travarUnidade ?? false, escopo: p?.escopo ?? MaintenanceScope.Equipment,
        equipamentoIds: p?.equipamentoIds ?? [], motivo: p?.motivo ?? '',
        inicio: p?.inicio ?? inicio.toISOString(), fim: p?.fim ?? new Date(inicio.getTime() + 2 * 3_600_000).toISOString() });
    }
    this.unidadesApi.list(true).pipe(take(1)).subscribe({
      next: (unidades) => this.unidades.set([...unidades].sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'))),
      error: () => this.erroCarga.set('Não foi possível carregar as unidades.'),
    });
    this.dashboardApi.getEquipamentos().pipe(take(1)).subscribe({
      next: (equipamentos) => this.equipamentos.set(equipamentos),
      error: () => this.erroCarga.set('Não foi possível carregar os equipamentos.'),
    });
  }

  private preencherDe(j: ManutencaoResponse): void {
    this.preencher({ unidadeId: j.unidade.id, travarUnidade: false, escopo: j.escopo, equipamentoIds: j.equipamentos.map((e) => e.id),
      motivo: j.motivo, inicio: j.inicioPrevisto, fim: j.fimPrevisto });
  }

  /** reset() emite valueChanges da unidade, que limpa a seleção: a seleção vem DEPOIS. */
  private preencher(v: { unidadeId: number | null; travarUnidade: boolean; escopo: MaintenanceScope; equipamentoIds: number[]; motivo: string; inicio: string; fim: string }): void {
    this.form.reset({ unidadeId: v.unidadeId === null ? '' : String(v.unidadeId), escopo: v.escopo, inicio: isoParaLocal(v.inicio), fim: isoParaLocal(v.fim), motivo: v.motivo });
    if (v.travarUnidade) this.form.controls.unidadeId.disable({ emitEvent: false }); else this.form.controls.unidadeId.enable({ emitEvent: false });
    this.selecionados.set(new Set(v.equipamentoIds));
  }
}

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { take } from 'rxjs';
import { MaintenanceScope } from '../../core/models/api-enums';
import { isApiError } from '../../core/models/api-error';
import { DashboardEquipamentoLista } from '../../core/models/dashboard';
import { CriarManutencaoRequest, ManutencaoResponse } from '../../core/models/manutencao';
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
  readonly agendada = output<ManutencaoResponse>();

  protected readonly escopos = MaintenanceScope;
  protected readonly unidades = signal<UnidadeResponse[]>([]);
  private readonly equipamentos = signal<DashboardEquipamentoLista[]>([]);
  protected readonly erroCarga = signal<string | null>(null);
  protected readonly unidadeId = signal<number | null>(null);
  protected readonly escopo = signal<MaintenanceScope>(MaintenanceScope.Unit);
  protected readonly selecionados = signal<ReadonlySet<number>>(new Set());
  protected readonly tentou = signal(false);
  protected readonly erroPeriodo = signal<string | null>(null);
  protected readonly erroApi = signal<string | null>(null);
  protected readonly salvando = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    unidadeId: ['', Validators.required],
    escopo: [MaintenanceScope.Unit as MaintenanceScope],
    inicio: [''],
    fim: [''],
    motivo: ['', [Validators.maxLength(300)]],
  });

  /** Ativos da unidade escolhida, em ordem alfabética. */
  protected readonly equipamentosDaUnidade = computed(() => {
    const unidade = this.unidadeId();
    if (unidade === null) return [];
    return this.equipamentos().filter((e) => e.unidadeId === unidade && e.ativo).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
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
    this.api.create(request).pipe(take(1)).subscribe({
      next: (janela) => { this.salvando.set(false); this.agendada.emit(janela); },
      error: (erro: unknown) => {
        this.salvando.set(false);
        this.erroApi.set(erro instanceof HttpErrorResponse && isApiError(erro.error) ? erro.error.message : 'Não foi possível agendar a manutenção.');
      },
    });
  }

  private preparar(): void {
    // Sugestão: próxima hora cheia, duas horas de janela. O operador ajusta.
    const inicio = new Date(); inicio.setMinutes(0, 0, 0); inicio.setHours(inicio.getHours() + 1);
    const fim = new Date(inicio.getTime() + 2 * 3_600_000);
    this.form.reset({ unidadeId: '', escopo: MaintenanceScope.Unit, inicio: isoParaLocal(inicio.toISOString()), fim: isoParaLocal(fim.toISOString()), motivo: '' });
    this.selecionados.set(new Set());
    this.tentou.set(false); this.erroPeriodo.set(null); this.erroApi.set(null); this.erroCarga.set(null);
    this.unidadesApi.list(true).pipe(take(1)).subscribe({
      next: (unidades) => this.unidades.set([...unidades].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))),
      error: () => this.erroCarga.set('Não foi possível carregar as unidades.'),
    });
    this.dashboardApi.getEquipamentos().pipe(take(1)).subscribe({
      next: (equipamentos) => this.equipamentos.set(equipamentos),
      error: () => this.erroCarga.set('Não foi possível carregar os equipamentos.'),
    });
  }
}

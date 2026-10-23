import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { take } from 'rxjs';
import { MaintenanceWindowStatus } from '../../core/models/api-enums';
import { isApiError } from '../../core/models/api-error';
import { ManutencaoResponse, PresetAgendamento } from '../../core/models/manutencao';
import { ManutencaoApiService } from '../../core/services/manutencao-api.service';
import { ModalComponent } from '../../shared/modal/modal.component';
import { dataHora, hora, isoParaLocal, localParaIso } from './periodo';

const SUBTITULO = 'Prorrogue ou antecipe o fim. Início, escopo e motivo de uma janela ativa não mudam.';

/**
 * "Alterar fim" de janela ATIVA: prorrogar ou antecipar (MA22). Se ela concluir entre abrir e
 * enviar, o servidor responde 409 e a tela oferece "Agendar continuação" (concluída não reabre).
 *
 * Trabalha sobre `atual`, a cópia vinda do GET /{id} (ao abrir e depois de um 409): versão,
 * "Fim atual" e teto saem dela, não da linha da lista, que pode estar velha. `desatualizada`
 * avisa o pai de que a linha que abriu o diálogo não confere mais com o servidor.
 */
@Component({
  selector: 'app-alterar-fim',
  imports: [ReactiveFormsModule, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alterar-fim.component.html',
  styleUrl: './alterar-fim.component.scss',
})
export class AlterarFimComponent {
  private readonly api = inject(ManutencaoApiService);
  readonly aberto = input(false);
  readonly janela = input<ManutencaoResponse | null>(null);
  readonly duracaoMaximaHoras = input.required<number>();
  readonly fechar = output<void>();
  readonly alterado = output<ManutencaoResponse>();
  readonly continuar = output<PresetAgendamento>();
  readonly desatualizada = output<void>();

  protected readonly fim = new FormControl('', { nonNullable: true });
  protected readonly erro = signal<string | null>(null);
  protected readonly salvando = signal(false);
  protected readonly concluida = signal<ManutencaoResponse | null>(null);
  /** A janela saiu de ATIVA sem concluir: não há o que reenviar. */
  protected readonly bloqueada = signal(false);
  protected readonly atual = signal<ManutencaoResponse | null>(null);
  protected readonly subtitulo = computed(() => (this.concluida() ? null : SUBTITULO));
  protected readonly limite = computed(() => {
    const j = this.atual();
    return j ? new Date(Date.parse(j.inicioPrevisto) + this.duracaoMaximaHoras() * 3_600_000).toISOString() : null;
  });
  protected readonly dataHora = dataHora;
  protected readonly hora = hora;
  private readonly botaoContinuar = viewChild<ElementRef<HTMLButtonElement>>('botaoContinuar');

  constructor() {
    effect(() => { if (this.aberto()) untracked(() => this.preparar()); });
    // O app-modal só foca ao abrir; ao trocar o conteúdo o campo some e o foco cairia no body.
    effect(() => { this.botaoContinuar()?.nativeElement.focus(); });
  }

  private preparar(): void {
    const j = this.janela();
    this.erro.set(null); this.concluida.set(null); this.bloqueada.set(false); this.salvando.set(false);
    this.atual.set(j);
    this.fim.reset(j ? isoParaLocal(j.fimPrevisto) : '');
    if (!j) return;
    // Valores e versão frescos: a linha da lista pode estar velha.
    this.api.get(j.id).pipe(take(1)).subscribe({
      next: (fresca) => {
        if (fresca.versao !== j.versao || fresca.situacao !== j.situacao) this.desatualizada.emit();
        // O operador pode já ter digitado: só troca o campo se ele ainda mostra o fim da linha.
        if (this.fim.pristine) this.fim.setValue(isoParaLocal(fresca.fimPrevisto));
        this.aplicar(fresca, null);
      },
      // Segue com a linha: se ela estiver velha, o 409 do envio busca de novo.
      error: () => undefined,
    });
  }

  /** Concluída → continuação; outra situação → sem reenvio; ATIVA → nova cópia de trabalho. */
  private aplicar(fresca: ManutencaoResponse, mensagemDoServidor: string | null): void {
    if (fresca.situacao === MaintenanceWindowStatus.Completed) { this.concluida.set(fresca); return; }
    if (fresca.situacao !== MaintenanceWindowStatus.Active) {
      this.bloqueada.set(true);
      this.erro.set(mensagemDoServidor ?? `A janela está ${fresca.situacao}: não há fim para alterar.`);
      return;
    }
    this.atual.set(fresca);
  }

  protected pedirFechar(): void { if (!this.salvando()) this.fechar.emit(); }

  protected enviar(): void {
    const j = this.atual();
    if (!j || this.salvando() || this.bloqueada()) return;
    const novo = localParaIso(this.fim.value);
    const erro = !novo ? 'Informe o novo fim.'
      : Date.parse(novo) <= Date.now() ? 'O novo fim já passou. Para terminar agora, use Encerrar agora.'
      // O campo tem precisão de minuto: comparar no mesmo grão, senão os segundos do fim atual escapam da checagem.
      : Math.floor(Date.parse(novo) / 60_000) === Math.floor(Date.parse(j.fimPrevisto) / 60_000) ? 'O novo fim é igual ao atual.'
      : Date.parse(novo) > Date.parse(this.limite()!) ? `A janela não pode passar de ${this.duracaoMaximaHoras()} horas desde o início.`
      : null;
    this.erro.set(erro);
    if (erro || !novo) return;
    this.salvando.set(true);
    this.api.alterarFim(j.id, { fimPrevisto: novo, versao: j.versao }).pipe(take(1)).subscribe({
      next: (r) => { this.salvando.set(false); this.alterado.emit(r); },
      error: (e: unknown) => {
        const mensagem = e instanceof HttpErrorResponse && isApiError(e.error) ? e.error.message : 'Não foi possível alterar o fim.';
        if (!(e instanceof HttpErrorResponse) || e.status !== 409) { this.salvando.set(false); this.erro.set(mensagem); return; }
        // 409: a linha que abriu o diálogo está velha. A versão atual decide o que oferecer.
        this.desatualizada.emit();
        this.api.get(j.id).pipe(take(1)).subscribe({
          next: (fresca) => {
            this.salvando.set(false);
            this.aplicar(fresca, mensagem);
            if (fresca.situacao === MaintenanceWindowStatus.Active) this.erro.set('Fim atual atualizado; confira e envie de novo.');
          },
          error: () => { this.salvando.set(false); this.erro.set(mensagem); },
        });
      },
    });
  }

  protected agendarContinuacao(): void {
    const j = this.concluida();
    if (!j) return;
    const pedido = localParaIso(this.fim.value);
    this.continuar.emit({ unidadeId: j.unidade.id, travarUnidade: true, escopo: j.escopo, equipamentoIds: j.equipamentos.map((e) => e.id),
      motivo: j.motivo, inicio: new Date().toISOString(), fim: pedido && Date.parse(pedido) > Date.now() ? pedido : undefined });
  }
}

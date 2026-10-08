import { plural } from '../../../core/format/plural';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { take } from 'rxjs';

import { isApiError } from '../../../core/models/api-error';
import { UnidadeApiService } from '../../../core/services/unidade-api.service';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { UnidadeDetalheStore } from './unidade-detalhe.store';

type Acao = 'desativar' | 'excluir';

interface Campo { rotulo: string; valor: string; }

@Component({
  selector: 'app-unidade-configuracoes',
  imports: [ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './configuracoes-tab.component.html',
  styleUrl: './configuracoes-tab.component.scss',
})
export class ConfiguracoesTabComponent {
  private readonly api = inject(UnidadeApiService);
  private readonly router = inject(Router);
  protected readonly store = inject(UnidadeDetalheStore);

  protected readonly acao = signal<Acao | null>(null);
  protected readonly processando = signal(false);
  protected readonly erroAcao = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);

  protected readonly ativa = computed(() => this.store.cadastro()?.ativo ?? this.store.unidade()?.ativo ?? true);
  protected readonly nome = computed(() => this.store.cadastro()?.nome ?? this.store.unidade()?.nome ?? 'esta unidade');
  protected readonly totalEquipamentos = computed(() => this.store.unidade()?.equipamentos.total ?? 0);

  /** Leitura do cadastro. Campos nulos exibem travessão, não string vazia. */
  protected readonly campos = computed<Campo[]>(() => {
    const cadastro = this.store.cadastro();
    if (!cadastro) return [];
    return [
      { rotulo: 'Nome', valor: cadastro.nome },
      { rotulo: 'Código interno', valor: cadastro.sigla },
      { rotulo: 'Endereço', valor: this.ouTravessao(cadastro.endereco) },
      { rotulo: 'Cidade', valor: this.ouTravessao(cadastro.cidade) },
      { rotulo: 'UF', valor: this.ouTravessao(cadastro.uf) },
      { rotulo: 'Latitude', valor: this.ouTravessao(cadastro.latitude) },
      { rotulo: 'Longitude', valor: this.ouTravessao(cadastro.longitude) },
      { rotulo: 'Descrição', valor: this.ouTravessao(cadastro.descricao) },
      { rotulo: 'Ativa', valor: cadastro.ativo ? 'sim' : 'não' },
    ];
  });

  protected readonly tituloConfirmacao = computed(() =>
    this.acao() === 'excluir' ? `Excluir ${this.nome()}?` : `Desativar ${this.nome()}?`);

  protected readonly mensagemConfirmacao = computed(() => {
    const total = this.totalEquipamentos();
    const dispositivos = plural(total, 'dispositivo', 'dispositivos');
    return this.acao() === 'excluir'
      ? `Esta unidade tem ${total === 1 ? '1 dispositivo vinculado' : `${dispositivos} vinculados`}. A exclusão não pode ser desfeita.`
      : `Desativar interrompe o monitoramento ICMP dos ${dispositivos} desta unidade e suprime os alertas do Telegram. O histórico é preservado.`;
  });

  protected readonly rotuloConfirmacao = computed(() => this.acao() === 'excluir' ? 'Excluir unidade' : 'Desativar unidade');

  protected abrir(acao: Acao): void {
    this.erroAcao.set(null);
    this.aviso.set(null);
    this.acao.set(acao);
  }

  protected fechar(): void {
    if (this.processando()) return;
    this.acao.set(null);
    this.erroAcao.set(null);
  }

  /** Reativar não pede confirmação: a ação não é destrutiva. */
  protected ativar(): void {
    this.processando.set(true);
    this.aviso.set(null);
    this.api.activate(this.store.id()).pipe(take(1)).subscribe({
      next: () => { this.processando.set(false); this.aviso.set('Unidade ativada. O monitoramento volta a valer.'); this.store.recarregar(); },
      error: (erro: HttpErrorResponse) => { this.processando.set(false); this.aviso.set(this.mensagem(erro, 'Não foi possível ativar a unidade.')); },
    });
  }

  protected confirmar(): void {
    if (this.acao() === 'excluir') { this.excluir(); return; }
    this.desativar();
  }

  private desativar(): void {
    this.processando.set(true);
    this.erroAcao.set(null);
    this.api.deactivate(this.store.id()).pipe(take(1)).subscribe({
      next: () => {
        this.processando.set(false);
        this.acao.set(null);
        this.aviso.set('Unidade desativada. O monitoramento ICMP foi interrompido.');
        this.store.recarregar();
      },
      error: (erro: HttpErrorResponse) => {
        this.processando.set(false);
        this.erroAcao.set(this.mensagem(erro, 'Não foi possível desativar a unidade.'));
      },
    });
  }

  private excluir(): void {
    this.processando.set(true);
    this.erroAcao.set(null);
    this.api.delete(this.store.id()).pipe(take(1)).subscribe({
      next: () => { this.processando.set(false); this.acao.set(null); void this.router.navigate(['/unidades']); },
      error: (erro: HttpErrorResponse) => {
        this.processando.set(false);
        // Backend recusa exclusão com equipamentos vinculados: mostrar a razão real.
        this.erroAcao.set(this.mensagem(erro, 'Não foi possível excluir a unidade.'));
      },
    });
  }

  private mensagem(erro: HttpErrorResponse, alternativa: string): string {
    return isApiError(erro.error) ? erro.error.message : alternativa;
  }

  private ouTravessao(valor: string | number | null): string {
    return valor === null || valor === undefined || valor === '' ? '—' : String(valor);
  }
}

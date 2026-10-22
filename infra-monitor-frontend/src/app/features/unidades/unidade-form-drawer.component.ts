import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Observable, of, switchMap, take } from 'rxjs';

import { isApiError } from '../../core/models/api-error';
import { UnidadeResponse } from '../../core/models/unidade';
import { GeoMunicipioService, Municipio, normalizeCodigoIbge, ufDoCodigoIbge } from '../../core/services/geo-municipio.service';
import { UnidadeApiService } from '../../core/services/unidade-api.service';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';

/** Siglas aceitas pelo enum Uf do backend. Fora dessa lista o PUT responde 400. */
export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

function faixa(minimo: number, maximo: number) {
  return (controle: AbstractControl): ValidationErrors | null => {
    const texto = String(controle.value ?? '').trim();
    if (!texto) return null;
    const valor = Number(texto);
    return Number.isFinite(valor) && valor >= minimo && valor <= maximo ? null : { faixa: `Informe um valor entre ${minimo} e ${maximo}.` };
  };
}

function ufValida(controle: AbstractControl): ValidationErrors | null {
  const valor = String(controle.value ?? '').trim().toUpperCase();
  return !valor || UFS.includes(valor) ? null : { uf: true };
}

/* Espelha ck_unidade_coordenadas_completas e o isCoordenadasCompletas do backend:
   meia coordenada não localiza nada e volta como 400. Pegamos antes de enviar. */
function coordenadasCompletas(grupo: AbstractControl): ValidationErrors | null {
  const latitude = String(grupo.get('latitude')?.value ?? '').trim();
  const longitude = String(grupo.get('longitude')?.value ?? '').trim();
  return !latitude === !longitude ? null : { coordenadas: true };
}

function texto(valor: string): string | null { return valor.trim() || null; }
function numero(valor: string): number | null { const limpo = valor.trim(); return limpo ? Number(limpo) : null; }

/**
 * Cadastro e edição de unidade em gaveta lateral, compartilhado pela lista
 * administrativa e pelo cabeçalho do detalhe.
 *
 * O backend aplica os campos de localização com aplicarSePresente: string vazia
 * LIMPA o campo salvo. Por isso o formulário é sempre populado com os valores
 * atuais da unidade ao abrir em edição, e o payload leva os nove campos.
 * Abrir vazio apagaria endereço, cidade, UF e coordenadas ao salvar o nome.
 */
@Component({
  selector: 'app-unidade-form-drawer',
  imports: [ReactiveFormsModule, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './unidade-form-drawer.component.html',
  styleUrl: './unidade-form-drawer.component.scss',
})
export class UnidadeFormDrawerComponent {
  private readonly api = inject(UnidadeApiService);
  private readonly geo = inject(GeoMunicipioService);
  private readonly fb = inject(FormBuilder);

  readonly aberto = input(false);
  /** Unidade em edição; null abre em modo de criação. */
  readonly unidade = input<UnidadeResponse | null>(null);
  readonly fechado = output<void>();
  readonly salvo = output<UnidadeResponse>();

  protected readonly salvando = signal(false);
  protected readonly erro = signal<string | null>(null);
  protected readonly descartando = signal(false);
  protected readonly municipios = signal<Municipio[]>([]);
  protected readonly municipiosErro = signal<string | null>(null);
  /** Destinos possíveis de conexão: toda unidade menos a que está sendo editada. */
  protected readonly unidadesDestino = signal<UnidadeResponse[]>([]);

  protected readonly editando = computed(() => this.unidade() !== null);
  protected readonly ufs = UFS;

  protected readonly form = this.fb.nonNullable.group({
    nome: ['', [Validators.required, Validators.maxLength(150)]],
    sigla: ['', [Validators.required, Validators.maxLength(30)]],
    descricao: [''],
    codigoIbge: [''],
    endereco: ['', Validators.maxLength(255)],
    cidade: ['', Validators.maxLength(100)],
    uf: ['', ufValida],
    latitude: ['', faixa(-90, 90)],
    longitude: ['', faixa(-180, 180)],
    // Vazio = unidade raiz. Não viaja no corpo da unidade: ver salvarConexao.
    conectaAUnidadeId: [''],
  }, { validators: coordenadasCompletas });

  private readonly primeiroCampo = viewChild<ElementRef<HTMLInputElement>>('primeiroCampo');
  private gatilho: HTMLElement | null = null;

  private readonly codigoIbgeSelecionado = signal('');

  /**
   * Sem município no cadastro, a UF é digitável; com município, ela é derivada do código IBGE.
   *
   * TODO: DÍVIDA -- `cidade` e `codigoIbge` continuam independentes. `cidade` é texto
   * livre digitado aqui; `codigoIbge` é referência ao município do GeoJSON e alimenta o
   * mapa. Nada impede cidade "Aracaju" com o município Itabaiana selecionado, e a coluna
   * CIDADE da lista mostra o texto livre enquanto o mapa usa o código. A UF já foi
   * unificada por `ufDoCodigoIbge`; o mesmo caminho serve para `cidade` (usar
   * `Municipio.nome`). O que falta decidir é o destino das unidades cujo texto livre já
   * diverge do município — é decisão de produto com migração de dados, não refactor.
   */
  protected readonly ufDerivada = computed(() => ufDoCodigoIbge(this.codigoIbgeSelecionado()));

  protected readonly municipioInvalido = computed(() => {
    const codigo = this.codigoIbgeSelecionado();
    return !!codigo && !this.municipios().some((municipio) => municipio.codigoIbge === normalizeCodigoIbge(codigo));
  });

  constructor() {
    effect(() => {
      if (!this.aberto()) return;
      const unidade = this.unidade();
      // Só abrir a gaveta ou trocar a unidade recarrega o formulário. preencher() lê
      // signals do próprio formulário (ufDerivada → codigoIbgeSelecionado); rastreados,
      // cada troca de município disparava o reset e descartava a escolha.
      untracked(() => {
        this.carregarMunicipios();
        this.carregarUnidades();
        this.gatilho = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.preencher(unidade);
      });
    });

    // O foco só pode ir para o campo depois que o @if do template o renderiza.
    effect(() => this.primeiroCampo()?.nativeElement.focus());
  }

  /* Só ao abrir: a gaveta vive montada na lista e no detalhe, e o GeoJSON de
     municípios não deve ser baixado por quem nunca abre o cadastro. */
  private municipiosPedidos = false;

  /* Mesma razão de carregarMunicipios: só ao abrir, e uma vez. A lista é curta (11 unidades). */
  private unidadesPedidas = false;

  private carregarUnidades(): void {
    if (this.unidadesPedidas) return;
    this.unidadesPedidas = true;
    this.api.list().pipe(take(1)).subscribe({
      next: (unidades) => this.unidadesDestino.set(unidades),
      // Falhar aqui não pode derrubar o cadastro: sem a lista, o select fica vazio e o
      // resto do formulário continua salvável.
      error: () => this.unidadesDestino.set([]),
    });
  }

  protected destinosDisponiveis(): UnidadeResponse[] {
    const atual = this.unidade();
    return this.unidadesDestino().filter((candidata) => candidata.id !== atual?.id);
  }

  private carregarMunicipios(): void {
    if (this.municipiosPedidos) return;
    this.municipiosPedidos = true;
    this.geo.getMunicipios().pipe(take(1)).subscribe({
      next: (municipios) => this.municipios.set(municipios),
      error: () => this.municipiosErro.set('Não foi possível carregar os municípios.'),
    });
  }

  protected aoTrocarMunicipio(): void {
    this.codigoIbgeSelecionado.set(this.form.controls.codigoIbge.value);
    this.sincronizarUf();
  }

  private sincronizarUf(): void {
    const derivada = this.ufDerivada();
    const controle = this.form.controls.uf;
    if (derivada) {
      controle.setValue(derivada);
      controle.disable({ emitEvent: false });
    } else {
      controle.enable({ emitEvent: false });
    }
  }

  private preencher(unidade: UnidadeResponse | null): void {
    this.erro.set(null);
    this.salvando.set(false);
    this.form.reset({
      nome: unidade?.nome ?? '',
      sigla: unidade?.sigla ?? '',
      descricao: unidade?.descricao ?? '',
      codigoIbge: unidade?.codigoIbge ?? '',
      endereco: unidade?.endereco ?? '',
      cidade: unidade?.cidade ?? '',
      uf: unidade?.uf ?? '',
      latitude: unidade?.latitude === null || unidade?.latitude === undefined ? '' : String(unidade.latitude),
      longitude: unidade?.longitude === null || unidade?.longitude === undefined ? '' : String(unidade.longitude),
      conectaAUnidadeId: unidade?.conectaAUnidadeId == null ? '' : String(unidade.conectaAUnidadeId),
    });
    this.codigoIbgeSelecionado.set(unidade?.codigoIbge ?? '');
    this.sincronizarUf();
    this.form.markAsPristine();
  }

  protected tentarFechar(): void {
    if (this.salvando()) return;
    if (this.form.dirty) { this.descartando.set(true); return; }
    this.fechar();
  }

  protected descartar(): void {
    this.descartando.set(false);
    this.fechar();
  }

  private fechar(): void {
    this.fechado.emit();
    this.gatilho?.focus();
    this.gatilho = null;
  }

  protected aoTeclar(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') { evento.stopPropagation(); this.tentarFechar(); }
  }

  protected submeter(): void {
    if (this.salvando()) return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    const valores = this.form.getRawValue();
    const corpo = {
      nome: valores.nome.trim(),
      sigla: valores.sigla.trim(),
      descricao: texto(valores.descricao),
      codigoIbge: normalizeCodigoIbge(valores.codigoIbge) || null,
      endereco: texto(valores.endereco),
      cidade: texto(valores.cidade),
      uf: texto(valores.uf.toUpperCase()),
      latitude: numero(valores.latitude),
      longitude: numero(valores.longitude),
    };

    const atual = this.unidade();
    this.salvando.set(true);
    this.erro.set(null);
    /*
     * Duas chamadas, nesta ordem, de propósito: a unidade precisa existir antes de receber
     * conexão -- no cadastro o id só nasce na resposta do POST. A segunda só sai quando o
     * destino mudou; salvar o nome de uma unidade já conectada não repete o PUT de conexão.
     */
    const requisicao = atual ? this.api.update(atual.id, corpo) : this.api.create(corpo);
    requisicao.pipe(
      switchMap((unidade) => this.salvarConexao(unidade, this.destinoEscolhido())),
      take(1),
    ).subscribe({
      next: (unidade) => {
        this.salvando.set(false);
        this.form.markAsPristine();
        this.salvo.emit(unidade);
        this.fechar();
      },
      error: (erro: HttpErrorResponse) => {
        this.salvando.set(false);
        this.aplicarErro(erro);
      },
    });
  }

  /** Destino escolhido no select, ou null para "Nenhuma (unidade raiz)". */
  private destinoEscolhido(): number | null {
    const valor = this.form.getRawValue().conectaAUnidadeId.trim();
    return valor ? Number(valor) : null;
  }

  /**
   * Alinha a conexão da unidade salva com o que o select pede.
   *
   * Sem mudança, devolve a própria unidade sem chamada nenhuma. Com mudança, PUT para conectar
   * e DELETE para desconectar -- e é este DELETE que justifica o endpoint separado: no corpo da
   * unidade, "Nenhuma" seria null, e null no PUT significa preservar, não limpar.
   */
  private salvarConexao(unidade: UnidadeResponse, destino: number | null): Observable<UnidadeResponse> {
    if ((unidade.conectaAUnidadeId ?? null) === destino) return of(unidade);
    return destino === null ? this.api.clearConexao(unidade.id) : this.api.setConexao(unidade.id, destino);
  }

  private aplicarErro(erro: HttpErrorResponse): void {
    const apiError = isApiError(erro.error) ? erro.error : null;
    if (apiError?.fields) {
      for (const [campo, mensagem] of Object.entries(apiError.fields)) {
        this.form.get(campo)?.setErrors({ backend: mensagem });
      }
    }
    this.erro.set(apiError?.message ?? 'Não foi possível salvar a unidade.');
  }
}

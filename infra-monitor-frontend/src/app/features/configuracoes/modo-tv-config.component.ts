import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { take } from 'rxjs';
import { ModoTvStatus } from '../../core/models/api-enums';
import { ApiErrorCode, isApiError } from '../../core/models/api-error';
import { AtualizarConfiguracaoModoTv, ConfiguracaoModoTv, TelaModoTv } from '../../core/models/configuracao-modo-tv';
import { ConfiguracaoModoTvApiService } from '../../core/services/configuracao-modo-tv-api.service';
import { AppIconComponent } from '../../shared/app-icon/app-icon.component';
import { StatusBadgeComponent } from '../../shared/status-badge/status-badge.component';

type Estado = 'loading' | 'success' | 'error';

interface LinhaTela { tela: TelaModoTv; incluida: boolean; duracao: number; }
interface Formulario { ativo: boolean; intervalo: number; linhas: LinhaTela[]; }

/** Ordem canônica: completa a lista com as telas que a configuração gravada não inclui. */
const TELAS: readonly TelaModoTv[] = ['MAPA', 'PAINEL', 'INCIDENTES', 'RELATORIOS'];
const NOMES: Record<TelaModoTv, string> = { MAPA: 'Mapa', PAINEL: 'Painel', INCIDENTES: 'Incidentes', RELATORIOS: 'Relatórios' };
const INTERVALOS = [30, 60, 120, 300];
const DURACOES = [10, 30, 60, 120, 300];
/** Duração sugerida para uma tela que entra no ciclo sem ter valor gravado. */
const DURACAO_PADRAO = 60;

const MSG_INDISPONIVEL = 'Configuração indisponível no servidor (migração V27 pendente)';

@Component({
  selector: 'app-modo-tv-config',
  imports: [StatusBadgeComponent, AppIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './modo-tv-config.component.html',
  styleUrl: './modo-tv-config.component.scss',
})
export class ModoTvConfigComponent {
  private readonly api = inject(ConfiguracaoModoTvApiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly estado = signal<Estado>('loading');
  protected readonly erroCarga = signal<string | null>(null);
  protected readonly gravada = signal<ConfiguracaoModoTv | null>(null);
  /** Formulário como foi carregado ou salvo — base do diff e do Descartar. */
  private readonly original = signal<Formulario | null>(null);

  protected readonly ativo = signal(true);
  protected readonly intervalo = signal(60);
  protected readonly linhas = signal<LinhaTela[]>([]);

  protected readonly salvando = signal(false);
  protected readonly erroSalvar = signal<string | null>(null);
  protected readonly salvo = signal(false);

  protected readonly nome = (tela: TelaModoTv) => NOMES[tela];
  protected readonly rotuloDuracao = formatarDuracao;
  /** Posição da tela no ciclo, contando só as incluídas. */
  protected readonly posicao = (tela: TelaModoTv) => this.incluidas().findIndex(l => l.tela === tela) + 1;

  /** O badge mostra o que a TV obedece agora: o valor gravado, não o rascunho. */
  protected readonly status = computed<ModoTvStatus>(() => this.gravada()?.ativo === false ? 'DESABILITADO' : 'ATIVO');

  protected readonly opcoesIntervalo = computed(() => comValorAtual(INTERVALOS, this.intervalo()));
  protected readonly opcoesDuracao = (atual: number) => comValorAtual(DURACOES, atual);

  protected readonly incluidas = computed(() => this.linhas().filter(l => l.incluida));
  protected readonly semTelas = computed(() => this.incluidas().length === 0);
  protected readonly ciclo = computed(() => formatarDuracao(this.incluidas().reduce((total, l) => total + l.duracao, 0)));

  /** Só os campos que mudaram; ausente = o servidor preserva. */
  protected readonly alteracoes = computed<AtualizarConfiguracaoModoTv>(() => {
    const original = this.original();
    if (!original) return {};
    const req: AtualizarConfiguracaoModoTv = {};
    if (this.ativo() !== original.ativo) req.ativo = this.ativo();
    if (this.intervalo() !== original.intervalo) req.intervaloAtualizacaoSegundos = this.intervalo();
    const telas = paraEnvio(this.linhas());
    if (JSON.stringify(telas) !== JSON.stringify(paraEnvio(original.linhas))) req.telas = telas;
    return req;
  });
  protected readonly alterado = computed(() => Object.keys(this.alteracoes()).length > 0);
  protected readonly podeSalvar = computed(() => this.alterado() && !this.semTelas() && !this.salvando());

  constructor() { this.carregar(); }

  protected carregar(): void {
    this.estado.set('loading'); this.erroCarga.set(null);
    this.api.obter().pipe(take(1)).subscribe({
      next: config => { this.aplicar(config); this.estado.set('success'); },
      error: error => { this.erroCarga.set(mensagemDe(error, 'Não foi possível carregar a configuração do modo TV.')); this.estado.set('error'); },
    });
  }

  protected alternarAtivo(valor: boolean): void { this.ativo.set(valor); this.mexeu(); }
  protected escolherIntervalo(valor: string): void { this.intervalo.set(Number(valor)); this.mexeu(); }
  protected incluir(tela: TelaModoTv, valor: boolean): void { this.editar(tela, l => ({ ...l, incluida: valor })); }
  protected escolherDuracao(tela: TelaModoTv, valor: string): void { this.editar(tela, l => ({ ...l, duracao: Number(valor) })); }

  protected mover(tela: TelaModoTv, direcao: -1 | 1): void {
    const linhas = [...this.linhas()];
    const de = linhas.findIndex(l => l.tela === tela);
    const para = de + direcao;
    if (de < 0 || para < 0 || para >= linhas.length) return;
    [linhas[de], linhas[para]] = [linhas[para], linhas[de]];
    this.linhas.set(linhas);
    this.mexeu();
    // A linha muda de lugar no DOM e o botão pode perder o foco; na ponta ele fica
    // desabilitado, então o foco vai para a seta oposta da mesma tela.
    afterNextRender(() => {
      const raiz = this.host.nativeElement;
      const alvo = raiz.querySelector<HTMLButtonElement>(`[data-mover="${tela}:${direcao}"]:not(:disabled)`)
        ?? raiz.querySelector<HTMLButtonElement>(`[data-mover="${tela}:${-direcao}"]`);
      alvo?.focus();
    }, { injector: this.injector });
  }

  protected descartar(): void {
    const original = this.original();
    if (!original) return;
    this.preencher(original);
    this.erroSalvar.set(null); this.salvo.set(false);
  }

  protected salvar(): void {
    if (!this.podeSalvar()) return;
    this.salvando.set(true); this.erroSalvar.set(null); this.salvo.set(false);
    this.api.salvar(this.alteracoes()).pipe(take(1)).subscribe({
      next: config => { this.aplicar(config); this.salvando.set(false); this.salvo.set(true); },
      error: error => { this.erroSalvar.set(mensagemDe(error, 'Não foi possível salvar a configuração do modo TV.')); this.salvando.set(false); },
    });
  }

  private aplicar(config: ConfiguracaoModoTv): void {
    const gravadas = [...config.telas].sort((a, b) => a.ordem - b.ordem);
    const linhas: LinhaTela[] = [
      ...gravadas.map(t => ({ tela: t.tela, incluida: true, duracao: t.duracaoSegundos })),
      ...TELAS.filter(t => !gravadas.some(g => g.tela === t)).map(tela => ({ tela, incluida: false, duracao: DURACAO_PADRAO })),
    ];
    const formulario: Formulario = { ativo: config.ativo, intervalo: config.intervaloAtualizacaoSegundos, linhas };
    this.gravada.set(config);
    this.original.set(formulario);
    this.preencher(formulario);
  }

  private preencher(f: Formulario): void {
    this.ativo.set(f.ativo); this.intervalo.set(f.intervalo); this.linhas.set(f.linhas.map(l => ({ ...l })));
  }

  private editar(tela: TelaModoTv, mudar: (l: LinhaTela) => LinhaTela): void {
    this.linhas.update(linhas => linhas.map(l => l.tela === tela ? mudar(l) : l));
    this.mexeu();
  }

  /** Qualquer edição apaga a confirmação de "salvo" anterior. */
  private mexeu(): void { this.salvo.set(false); }
}

function paraEnvio(linhas: LinhaTela[]): { tela: TelaModoTv; duracaoSegundos: number }[] {
  return linhas.filter(l => l.incluida).map(l => ({ tela: l.tela, duracaoSegundos: l.duracao }));
}

/** O backend aceita valores fora da lista (30..600 e 10..3600): o gravado continua visível e selecionado. */
function comValorAtual(opcoes: number[], atual: number): number[] {
  return opcoes.includes(atual) ? opcoes : [...opcoes, atual].sort((a, b) => a - b);
}

export function formatarDuracao(segundos: number): string {
  const min = Math.floor(segundos / 60);
  const seg = segundos % 60;
  if (min === 0) return `${seg} s`;
  return seg === 0 ? `${min} min` : `${min} min ${seg} s`;
}

function mensagemDe(error: unknown, alternativa: string): string {
  if (!(error instanceof HttpErrorResponse) || !isApiError(error.error)) return alternativa;
  return error.error.code === ApiErrorCode.ConfigurationUnavailable ? MSG_INDISPONIVEL : error.error.message;
}

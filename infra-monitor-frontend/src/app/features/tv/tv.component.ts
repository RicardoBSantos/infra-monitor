import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ConfiguracaoModoTv, TelaModoTv, TelaModoTvConfig } from '../../core/models/configuracao-modo-tv';
import { AuthStateService } from '../../core/services/auth-state.service';
import { ConfiguracaoModoTvApiService } from '../../core/services/configuracao-modo-tv-api.service';
import { DashboardComponent } from '../dashboard/dashboard.component';
import { IncidenteUnificadoListComponent } from '../incidentes/incidente-unificado-list.component';
import { MapaComponent } from '../mapa/mapa.component';
import { RelatoriosComponent } from '../relatorios/relatorios.component';
import { AppIconComponent } from '../../shared/app-icon/app-icon.component';
import { TelaTv } from './tela-tv';

const NOMES: Record<TelaModoTv, string> = { MAPA: 'Mapa', PAINEL: 'Painel', INCIDENTES: 'Incidentes', RELATORIOS: 'Relatórios' };
/** Sem configuração lida ainda (primeira leitura pendente ou falha), relê neste ritmo. */
const INTERVALO_SEM_CONFIG_MS = 60_000;
const PASSO_MS = 1000;

/** Momento do último pedido de dados de uma tela e o do último dado tido como bom antes dele. */
interface Recarga { em: Date; okAntes: Date; }

/**
 * Painel de parede em `/tv` (P1): as telas configuradas ficam montadas em paralelo e empilhadas;
 * só uma é visível. Um único `setTimeout` encadeado de 1 s conduz relógio, troca de tela e o tique
 * de atualização. Nada vai para serviço global, `localStorage` ou parâmetro.
 */
@Component({
  selector: 'app-tv',
  imports: [MapaComponent, DashboardComponent, IncidenteUnificadoListComponent, RelatoriosComponent, AppIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tv.component.html',
  styleUrl: './tv.component.scss',
})
export class TvComponent {
  private readonly api = inject(ConfiguracaoModoTvApiService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthStateService);

  /* Ref de template e não tipo de classe: a tela é lida pelo contrato `TelaTv`. */
  private readonly mapa = viewChild<TelaTv>('mapa');
  private readonly painel = viewChild<TelaTv>('painel');
  private readonly incidentes = viewChild<TelaTv>('incidentes');
  private readonly relatorios = viewChild<TelaTv>('relatorios');

  readonly config = signal<ConfiguracaoModoTv | null>(null);
  readonly indice = signal(0);
  readonly ultimaAtualizacao = signal<Date | null>(null);
  readonly desatualizadoDesde = signal<Date | null>(null);
  /** Cada leitura de configuração leva a sua; resposta de leitura anterior é descartada. */
  geracao = 0;

  protected readonly agora = signal(new Date());
  protected readonly falhaConfig = signal(false);
  private readonly inicioTela = signal(Date.now());

  protected readonly telas = computed<TelaModoTvConfig[]>(() => [...(this.config()?.telas ?? [])].sort((a, b) => a.ordem - b.ordem));
  protected readonly ativo = computed(() => this.config()?.ativo === true && this.telas().length > 0);
  protected readonly telaAtual = computed<TelaModoTv | null>(() => this.ativo() ? this.telas()[this.indice()]?.tela ?? null : null);
  protected readonly nomeTela = computed(() => { const t = this.telaAtual(); return t ? NOMES[t] : 'Modo TV'; });
  protected readonly posicao = computed(() => this.ativo() ? `${this.indice() + 1} de ${this.telas().length}` : '');
  protected readonly progresso = computed(() => {
    const t = this.telas()[this.indice()]; if (!this.ativo() || !t) return 0;
    const decorrido = this.agora().getTime() - this.inicioTela();
    return Math.min(100, Math.max(0, Math.round(decorrido / (t.duracaoSegundos * 10))));
  });
  protected readonly incluida = (tela: TelaModoTv) => this.ativo() && this.telas().some(t => t.tela === tela);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private parado = false;
  private ultimoTique = Date.now();
  private readonly recargas = new Map<TelaModoTv, Recarga>();

  constructor() {
    this.lerConfig();
    this.agendar();
    inject(DestroyRef).onDestroy(() => this.parar());
    effect(() => { if (!this.auth.authenticated()) untracked(() => this.parar()); });
  }

  protected hora(d: Date | null): string { return d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '--:--'; }
  protected sair(): void { this.router.navigateByUrl('/dashboard'); }

  private agendar(): void {
    if (this.parado) return;
    this.timer = setTimeout(() => { this.timer = null; this.passo(); this.agendar(); }, PASSO_MS);
  }

  private parar(): void {
    this.parado = true; this.geracao++;
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }

  /** Ordem do passo: troca de tela primeiro, depois o tique — a tela que entrou já foi recarregada se precisava. */
  private passo(): void {
    const agora = Date.now(); this.agora.set(new Date(agora));
    const cfg = this.config(); const intervalo = cfg ? cfg.intervaloAtualizacaoSegundos * 1000 : INTERVALO_SEM_CONFIG_MS;
    if (this.ativo()) {
      const atual = this.telas()[this.indice()];
      if (atual && agora - this.inicioTela() >= atual.duracaoSegundos * 1000) {
        const proximo = (this.indice() + 1) % this.telas().length;
        this.indice.set(proximo); this.inicioTela.set(agora);
        const nova = this.telas()[proximo].tela; const ultima = this.recargas.get(nova)?.em.getTime() ?? 0;
        if (cfg && agora - ultima >= intervalo) this.recarregar(nova, agora);
      }
    }
    if (agora - this.ultimoTique >= intervalo) {
      this.ultimoTique = agora;
      this.lerConfig();
      const visivel = this.telaAtual();
      if (visivel && this.recargas.get(visivel)?.em.getTime() !== agora) this.recarregar(visivel, agora);
    }
    this.sincronizarCarimbo();
  }

  private lerConfig(): void {
    const geracao = ++this.geracao;
    this.api.obter().subscribe({
      next: cfg => { if (geracao === this.geracao) this.aplicar(cfg); },
      error: () => { if (geracao === this.geracao && this.config() === null) this.falhaConfig.set(true); },
    });
  }

  /**
   * Config nova vale já para a lista montada; a ordem e as durações pesam na próxima troca.
   * Se a tela visível saiu (ou o modo voltou de desativado), vai para a de menor ordem — o `@if`
   * já a desmontou, e ficar no índice velho mostraria quadro em branco ou a tela errada.
   */
  private aplicar(cfg: ConfiguracaoModoTv): void {
    const antes = this.telaAtual(); const estavaAtivo = this.ativo(); const agora = Date.now();
    this.falhaConfig.set(false);
    this.config.set(cfg);
    if (!this.ativo()) { this.recargas.clear(); this.sincronizarCarimbo(); return; }
    // Tela que acabou de entrar na lista monta agora e carrega sozinha no init.
    for (const t of this.telas()) if (!this.recargas.has(t.tela)) this.recargas.set(t.tela, { em: new Date(agora), okAntes: new Date(agora) });
    for (const t of [...this.recargas.keys()]) if (!this.telas().some(c => c.tela === t)) this.recargas.delete(t);
    const novoIndice = estavaAtivo && antes ? this.telas().findIndex(t => t.tela === antes) : -1;
    if (novoIndice >= 0) this.indice.set(novoIndice);
    else { this.indice.set(0); this.inicioTela.set(agora); }
    this.sincronizarCarimbo();
  }

  private instancia(tela: TelaModoTv): TelaTv | undefined {
    switch (tela) { case 'MAPA': return this.mapa(); case 'PAINEL': return this.painel(); case 'INCIDENTES': return this.incidentes(); case 'RELATORIOS': return this.relatorios(); }
  }

  private recarregar(tela: TelaModoTv, agora: number): void {
    const instancia = this.instancia(tela); if (!instancia) return;
    const anterior = this.recargas.get(tela);
    // Se o último pedido falhou, o dado bom continua sendo o de antes dele.
    const okAntes = anterior ? (instancia.falhouUltimaAtualizacao() ? anterior.okAntes : anterior.em) : new Date(agora);
    this.recargas.set(tela, { em: new Date(agora), okAntes });
    instancia.recarregarDados();
  }

  /** "Dados de" = último pedido; com falha, "desatualizado desde" = último dado bom antes dele. */
  private sincronizarCarimbo(): void {
    const tela = this.telaAtual(); const recarga = tela ? this.recargas.get(tela) : undefined;
    if (!tela || !recarga) { this.ultimaAtualizacao.set(null); this.desatualizadoDesde.set(null); return; }
    const falhou = this.instancia(tela)?.falhouUltimaAtualizacao() ?? false;
    this.ultimaAtualizacao.set(falhou ? recarga.okAntes : recarga.em);
    this.desatualizadoDesde.set(falhou ? recarga.okAntes : null);
  }
}

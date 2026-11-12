import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { ConfiguracaoModoTv, TelaModoTv } from '../../core/models/configuracao-modo-tv';
import { AuthStateService } from '../../core/services/auth-state.service';
import { ConfiguracaoModoTvApiService } from '../../core/services/configuracao-modo-tv-api.service';
import { DashboardComponent } from '../dashboard/dashboard.component';
import { IncidenteUnificadoListComponent } from '../incidentes/incidente-unificado-list.component';
import { MapaComponent } from '../mapa/mapa.component';
import { RelatoriosComponent } from '../relatorios/relatorios.component';
import { TvComponent } from './tv.component';

/* As 4 telas reais buscam dados e montam MapLibre; aqui viram stubs com o contrato TelaTv. */
abstract class TelaStub { recarregarDados = vi.fn(); readonly falhouUltimaAtualizacao = signal(false); }
@Component({ selector: 'app-mapa', template: 'mapa' }) class MapaStub extends TelaStub { readonly ativa = input(true); }
@Component({ selector: 'app-dashboard', template: 'painel' }) class PainelStub extends TelaStub {}
@Component({ selector: 'app-incidente-unificado-list', template: 'incidentes' }) class IncidentesStub extends TelaStub {}
@Component({ selector: 'app-relatorios', template: 'relatorios' }) class RelatoriosStub extends TelaStub { readonly modoTv = input(false); }
const STUBS: Record<TelaModoTv, new () => TelaStub> = { MAPA: MapaStub, PAINEL: PainelStub, INCIDENTES: IncidentesStub, RELATORIOS: RelatoriosStub };

const QUATRO: ConfiguracaoModoTv = {
  ativo: true, intervaloAtualizacaoSegundos: 60, persistida: true, atualizadoEm: null,
  telas: [{ tela: 'MAPA', ordem: 1, duracaoSegundos: 60 }, { tela: 'PAINEL', ordem: 2, duracaoSegundos: 60 }, { tela: 'INCIDENTES', ordem: 3, duracaoSegundos: 60 }, { tela: 'RELATORIOS', ordem: 4, duracaoSegundos: 60 }],
};
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('TvComponent', () => {
  let fixture: ComponentFixture<TvComponent>; let respostas: Subject<ConfiguracaoModoTv>[]; let auth: AuthStateService;
  const inicio = new Date('2026-11-12T13:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(inicio);
    respostas = [];
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: ConfiguracaoModoTvApiService, useValue: { obter: () => { const s = new Subject<ConfiguracaoModoTv>(); respostas.push(s); return s; } } }] });
    TestBed.overrideComponent(TvComponent, { remove: { imports: [MapaComponent, DashboardComponent, IncidenteUnificadoListComponent, RelatoriosComponent] }, add: { imports: [MapaStub, PainelStub, IncidentesStub, RelatoriosStub] } });
    auth = TestBed.inject(AuthStateService);
    auth.setSession({ accessToken: 't', tokenType: 'Bearer', expiresIn: 60, usuario: { id: 9, nome: 'TV', email: 'tv@example.test', papel: 'VISUALIZADOR', trocaSenhaObrigatoria: false } });
    fixture = TestBed.createComponent(TvComponent); fixture.detectChanges();
  });
  afterEach(() => { fixture?.destroy(); vi.useRealTimers(); });

  const responder = (i: number, cfg: ConfiguracaoModoTv) => { respostas[i].next(cfg); respostas[i].complete(); fixture.detectChanges(); };
  const avancar = (segundos: number) => { for (let s = 0; s < segundos; s++) { vi.advanceTimersByTime(1000); fixture.detectChanges(); } };
  const tela = (t: TelaModoTv) => fixture.debugElement.query(By.directive(STUBS[t]))?.componentInstance as TelaStub | undefined;
  const ativa = () => (fixture.nativeElement as HTMLElement).querySelector('.tv__tela--ativa')?.getAttribute('data-tela');
  const texto = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('monta todas as telas configuradas e mostra a de menor ordem', () => {
    responder(0, QUATRO);
    expect(['MAPA', 'PAINEL', 'INCIDENTES', 'RELATORIOS'].every(t => tela(t as TelaModoTv))).toBe(true);
    expect(ativa()).toBe('MAPA');
    const secoes = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('section.tv__tela'));
    expect(secoes.every(s => s.hasAttribute('inert'))).toBe(true);
    expect(secoes.filter(s => s.getAttribute('aria-hidden') === 'true')).toHaveLength(3);
    expect(fixture.debugElement.query(By.directive(MapaStub)).componentInstance.ativa()).toBe(true);
    expect(fixture.debugElement.query(By.directive(RelatoriosStub)).componentInstance.modoTv()).toBe(true);
    expect(texto()).toContain('Mapa');
  });

  it('gira as 4 telas de 60 s e volta à primeira após 240 s', () => {
    responder(0, QUATRO);
    avancar(60); expect(ativa()).toBe('PAINEL');
    expect(fixture.debugElement.query(By.directive(MapaStub)).componentInstance.ativa()).toBe(false);
    avancar(60); expect(ativa()).toBe('INCIDENTES');
    avancar(60); expect(ativa()).toBe('RELATORIOS');
    avancar(60); expect(ativa()).toBe('MAPA');
  });

  it('recarrega só a tela visível a cada intervalo', () => {
    responder(0, { ...QUATRO, telas: [{ tela: 'PAINEL', ordem: 1, duracaoSegundos: 600 }, { tela: 'MAPA', ordem: 2, duracaoSegundos: 60 }] });
    avancar(59); expect(tela('PAINEL')!.recarregarDados).not.toHaveBeenCalled();
    avancar(1); expect(tela('PAINEL')!.recarregarDados).toHaveBeenCalledTimes(1);
    avancar(60); expect(tela('PAINEL')!.recarregarDados).toHaveBeenCalledTimes(2);
    expect(tela('MAPA')!.recarregarDados).not.toHaveBeenCalled();
  });

  it('recarrega a tela que entra quando o dado dela passou do intervalo, sem chamar duas vezes no mesmo passo', () => {
    responder(0, { ...QUATRO, intervaloAtualizacaoSegundos: 120, telas: [{ tela: 'MAPA', ordem: 1, duracaoSegundos: 150 }, { tela: 'PAINEL', ordem: 2, duracaoSegundos: 60 }] });
    avancar(150);
    expect(ativa()).toBe('PAINEL');
    expect(tela('PAINEL')!.recarregarDados).toHaveBeenCalledTimes(1);
    avancar(60); // volta ao mapa em 210 s: mapa recarregado em 120 s, só 90 s atrás
    expect(ativa()).toBe('MAPA');
    expect(tela('MAPA')!.recarregarDados).toHaveBeenCalledTimes(1);
  });

  it('relê a configuração a cada tique', () => {
    responder(0, QUATRO);
    expect(respostas).toHaveLength(1);
    avancar(60); expect(respostas).toHaveLength(2);
    avancar(60); expect(respostas).toHaveLength(3);
  });

  it('config nova sem a tela visível vai para a de menor ordem, sem quadro em branco', () => {
    responder(0, QUATRO);
    avancar(60); expect(ativa()).toBe('PAINEL');
    // o tique de 60 s pediu a config; o admin tirou o Painel e reordenou
    responder(1, { ...QUATRO, telas: [{ tela: 'RELATORIOS', ordem: 1, duracaoSegundos: 60 }, { tela: 'MAPA', ordem: 2, duracaoSegundos: 60 }] });
    expect(tela('PAINEL')).toBeUndefined();
    expect(ativa()).toBe('RELATORIOS');
    expect(texto()).toContain('Relatórios');
  });

  it('config nova que mantém a tela visível não a troca antes do tempo', () => {
    responder(0, QUATRO);
    avancar(60);
    responder(1, { ...QUATRO, telas: [{ tela: 'INCIDENTES', ordem: 1, duracaoSegundos: 60 }, { tela: 'PAINEL', ordem: 2, duracaoSegundos: 60 }] });
    expect(ativa()).toBe('PAINEL');
    avancar(60); expect(ativa()).toBe('INCIDENTES');
  });

  it('descarta resposta atrasada de geração anterior', () => {
    responder(0, QUATRO);
    avancar(60); avancar(60); // pedidos 1 e 2 em voo
    expect(respostas).toHaveLength(3);
    responder(2, QUATRO);
    responder(1, { ...QUATRO, ativo: false });
    expect(texto()).not.toContain('Modo TV desativado pelo administrador');
    expect(ativa()).toBe('INCIDENTES');
  });

  it('falha na última atualização vira "Desatualizado desde HH:MM" com a hora do último dado bom', () => {
    responder(0, { ...QUATRO, telas: [{ tela: 'PAINEL', ordem: 1, duracaoSegundos: 600 }] });
    expect(texto()).toContain(`Dados de ${hhmm(inicio)}`);
    avancar(60);
    const bom = new Date(inicio.getTime() + 60_000);
    expect(texto()).toContain(`Dados de ${hhmm(bom)}`);
    avancar(60); // novo pedido em 120 s, que falha
    tela('PAINEL')!.falhouUltimaAtualizacao.set(true);
    avancar(1);
    expect(texto()).toContain(`Desatualizado desde ${hhmm(bom)}`);
    expect((fixture.nativeElement as HTMLElement).querySelector('.tv__dados--alerta')).not.toBeNull();
    tela('PAINEL')!.falhouUltimaAtualizacao.set(false);
    avancar(1);
    expect(texto()).not.toContain('Desatualizado');
  });

  it('ativo=false mostra o aviso e continua relendo a configuração', () => {
    responder(0, { ...QUATRO, ativo: false });
    expect(texto()).toContain('Modo TV desativado pelo administrador');
    expect(tela('MAPA')).toBeUndefined();
    avancar(60); expect(respostas).toHaveLength(2);
    responder(1, QUATRO);
    expect(texto()).not.toContain('Modo TV desativado');
    expect(ativa()).toBe('MAPA');
  });

  it('mostra o relógio e a barra de progresso da tela atual', () => {
    responder(0, QUATRO);
    avancar(30);
    expect(texto()).toContain(hhmm(new Date(inicio.getTime() + 30_000)));
    const barra = (fixture.nativeElement as HTMLElement).querySelector('[role="progressbar"]')!;
    expect(barra.getAttribute('aria-valuenow')).toBe('50');
  });

  it('"Sair do modo TV" vai ao /dashboard', () => {
    const router = TestBed.inject(Router); const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    responder(0, QUATRO);
    const botao = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find(b => b.textContent?.includes('Sair do modo TV'))!;
    botao.click();
    expect(nav).toHaveBeenCalledWith('/dashboard');
  });

  it('destruir o componente não deixa timer pendente', () => {
    responder(0, QUATRO);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sessão encerrada para o laço', () => {
    responder(0, QUATRO);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    auth.clear(); fixture.detectChanges();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(120_000);
    expect(respostas).toHaveLength(1);
  });

  it('falha ao ler a configuração inicial tenta de novo sem quadro em branco', () => {
    respostas[0].error(new Error('502')); fixture.detectChanges();
    expect(texto()).toContain('Não foi possível ler a configuração');
    avancar(60); expect(respostas).toHaveLength(2);
    responder(1, QUATRO); expect(ativa()).toBe('MAPA');
  });
});

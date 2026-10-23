import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EquipmentOperationalStatus, MaintenanceScope, MaintenanceWindowStatus } from '../../core/models/api-enums';
import { DashboardEquipamentoLista } from '../../core/models/dashboard';
import { ManutencaoResponse } from '../../core/models/manutencao';
import { UnidadeResponse } from '../../core/models/unidade';
import { AgendarManutencaoComponent } from './agendar-manutencao.component';
import { isoParaLocal, localParaIso } from './periodo';

@Component({
  imports: [AgendarManutencaoComponent],
  template: `<button id="gatilho" type="button" (click)="aberto.set(true)">+ Agendar manutenção</button>
    <app-agendar-manutencao [aberto]="aberto()" [duracaoMaximaHoras]="72" (fechar)="aberto.set(false)" (agendada)="criada.set($event); aberto.set(false)" />`,
})
class HostComponent {
  readonly aberto = signal(false);
  readonly criada = signal<ManutencaoResponse | null>(null);
}

const URL = 'http://localhost:8080/api/v1/manutencoes';
const unidade = (id: number, nome: string): UnidadeResponse => ({ id, nome, sigla: nome.slice(0, 3).toUpperCase(), descricao: null, codigoIbge: null, ativo: true, createdAt: '', updatedAt: '', endereco: null, cidade: null, uf: null, latitude: null, longitude: null, conectaAUnidadeId: null });
const equipamento = (id: number, nome: string, unidadeId: number, ativo = true): DashboardEquipamentoLista => ({ id, nome, tipoNome: 'Switch', unidadeId, unidadeNome: '', hostname: null, ip: null, status: EquipmentOperationalStatus.Available, latenciaMs: null, ativo, localizacao: null, numeroSerie: null, emManutencao: false, manutencaoManual: false, janelaAtivaId: null, janelaAtivaFim: null });
const resposta = (parcial: Partial<ManutencaoResponse> = {}): ManutencaoResponse => ({ id: 50, unidade: { id: 1, nome: 'Sede' }, escopo: MaintenanceScope.Unit, equipamentos: [], inicioPrevisto: '', fimPrevisto: '', motivo: 'x', situacao: MaintenanceWindowStatus.Scheduled, criadoPor: { id: 1, nome: 'Ana' }, ativadaEm: null, encerradaEm: null, encerradaPor: null, canceladaEm: null, canceladaPor: null, sobreposicoes: [], ...parcial });

describe('AgendarManutencaoComponent', () => {
  let http: HttpTestingController;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  const el = (f: ComponentFixture<HostComponent>) => f.nativeElement as HTMLElement;
  const modal = (f: ComponentFixture<HostComponent>) => el(f).querySelector<HTMLElement>('app-modal section[role="dialog"]');
  const abrir = () => {
    const f = TestBed.createComponent(HostComponent); f.detectChanges();
    const gatilho = el(f).querySelector<HTMLButtonElement>('#gatilho')!;
    gatilho.focus(); gatilho.click(); f.detectChanges();
    const unidadesReq = http.expectOne((r) => r.url.endsWith('/unidades'));
    expect(unidadesReq.request.params.get('ativo')).toBe('true');
    unidadesReq.flush([unidade(1, 'Sede'), unidade(2, 'Itabaiana')]);
    http.expectOne((r) => r.url.endsWith('/dashboard/equipamentos')).flush([
      equipamento(7, 'SW-CORE', 1), equipamento(8, 'AP-01', 1), equipamento(9, 'AP-VELHO', 1, false), equipamento(10, 'RT-ITA', 2),
    ]);
    f.detectChanges();
    return { f, gatilho };
  };
  const campo = <T extends HTMLElement>(f: ComponentFixture<HostComponent>, nome: string) => modal(f)!.querySelector<T>(`[formcontrolname="${nome}"]`)!;
  const preencher = (f: ComponentFixture<HostComponent>, nome: string, valor: string) => {
    const c = campo<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(f, nome);
    c.value = valor; c.dispatchEvent(new Event(c instanceof HTMLSelectElement ? 'change' : 'input')); f.detectChanges();
  };
  const escopo = (f: ComponentFixture<HostComponent>, valor: MaintenanceScope) => {
    modal(f)!.querySelector<HTMLInputElement>(`input[type="radio"][value="${valor}"]`)!.click(); f.detectChanges();
  };
  const enviar = (f: ComponentFixture<HostComponent>) => {
    [...modal(f)!.querySelectorAll<HTMLButtonElement>('button[type="submit"]')][0].click(); f.detectChanges();
  };
  const daqui = (minutos: number) => isoParaLocal(new Date(Date.now() + minutos * 60_000).toISOString());
  const valido = (f: ComponentFixture<HostComponent>) => {
    preencher(f, 'unidadeId', '1');
    preencher(f, 'inicio', daqui(60));
    preencher(f, 'fim', daqui(180));
    preencher(f, 'motivo', '  Troca do switch core  ');
  };

  it('abre com foco na Unidade e Escape fecha devolvendo o foco ao gatilho', () => {
    const { f, gatilho } = abrir();
    expect(document.activeElement).toBe(campo(f, 'unidadeId'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); f.detectChanges();
    expect(modal(f)).toBeNull();
    expect(document.activeElement).toBe(gatilho);
  });

  it('escopo padrão é Equipamentos selecionados: unidade inteira só por escolha explícita', () => {
    const { f } = abrir();
    const marcado = modal(f)!.querySelector<HTMLInputElement>('input[type="radio"]:checked');
    expect(marcado?.value).toBe(MaintenanceScope.Equipment);
    valido(f);
    enviar(f);
    http.expectNone(URL);
    expect(modal(f)!.textContent).toContain('Selecione ao menos um equipamento.');
  });

  it('Equipamentos selecionados lista só os ativos da unidade e exige pelo menos um', () => {
    const { f } = abrir();
    valido(f);
    escopo(f, MaintenanceScope.Equipment);
    const nomes = [...modal(f)!.querySelectorAll('.checagem label')].map((l) => l.textContent?.trim());
    expect(nomes).toEqual(['AP-01', 'SW-CORE']);
    enviar(f);
    http.expectNone(URL);
    expect(modal(f)!.textContent).toContain('Selecione ao menos um equipamento.');

    preencher(f, 'unidadeId', '2'); escopo(f, MaintenanceScope.Equipment);
    expect([...modal(f)!.querySelectorAll('.checagem label')].map((l) => l.textContent?.trim())).toEqual(['RT-ITA']);
  });

  it('motivo é obrigatório e limitado a 300 caracteres', () => {
    const { f } = abrir();
    valido(f); preencher(f, 'motivo', '   ');
    enviar(f);
    http.expectNone(URL);
    expect(modal(f)!.textContent).toContain('Informe o motivo.');
    expect(campo<HTMLTextAreaElement>(f, 'motivo').maxLength).toBe(300);
  });

  it('período inválido não chega à API', () => {
    const { f } = abrir();
    valido(f);
    preencher(f, 'fim', daqui(60 + 73 * 60));
    enviar(f);
    http.expectNone(URL);
    expect(modal(f)!.textContent).toContain('A janela não pode passar de 72 horas.');

    preencher(f, 'inicio', daqui(-30)); preencher(f, 'fim', daqui(60));
    enviar(f);
    http.expectNone(URL);
    expect(modal(f)!.textContent).toContain('O início não pode estar no passado.');
  });

  it('envia o CriarManutencaoRequest com ISO UTC e emite a janela criada', () => {
    const { f } = abrir();
    valido(f);
    escopo(f, MaintenanceScope.Equipment);
    const caixas = [...modal(f)!.querySelectorAll<HTMLInputElement>('.checagem input[type="checkbox"]')];
    caixas[1].click(); f.detectChanges(); // SW-CORE (ordem alfabética: AP-01, SW-CORE)
    const inicio = campo<HTMLInputElement>(f, 'inicio').value; const fim = campo<HTMLInputElement>(f, 'fim').value;
    enviar(f);
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ unidadeId: 1, escopo: 'EQUIPAMENTOS', equipamentoIds: [7], inicioPrevisto: localParaIso(inicio), fimPrevisto: localParaIso(fim), motivo: 'Troca do switch core' });
    req.flush(resposta({ id: 50 }), { status: 201, statusText: 'Created' }); f.detectChanges();
    expect(f.componentInstance.criada()?.id).toBe(50);
    expect(modal(f)).toBeNull();
  });

  it('escopo Unidade inteira envia lista vazia de equipamentos', () => {
    const { f } = abrir();
    valido(f);
    escopo(f, MaintenanceScope.Equipment);
    modal(f)!.querySelector<HTMLInputElement>('.checagem input[type="checkbox"]')!.click(); f.detectChanges();
    escopo(f, MaintenanceScope.Unit);
    enviar(f);
    const req = http.expectOne(URL);
    expect(req.request.body.escopo).toBe('UNIDADE');
    expect(req.request.body.equipamentoIds).toEqual([]);
    req.flush(resposta());
  });

  it('recusa 409/400 da API aparece no rodapé do modal, que continua aberto', () => {
    const { f } = abrir();
    valido(f);
    escopo(f, MaintenanceScope.Unit);
    enviar(f);
    http.expectOne(URL).flush({ timestamp: '', status: 409, error: 'Conflict', code: 'BUSINESS_CONFLICT', message: 'Agendamento de manutencao desligado neste servidor.', path: '/api/v1/manutencoes' }, { status: 409, statusText: 'Conflict' });
    f.detectChanges();
    expect(modal(f)!.querySelector('.modal-form__rodape [role="alert"]')?.textContent?.trim()).toBe('Agendamento de manutencao desligado neste servidor.');
    expect(f.componentInstance.criada()).toBeNull();

    enviar(f);
    http.expectOne(URL).flush({ timestamp: '', status: 400, error: 'Bad Request', code: 'VALIDATION_ERROR', message: 'Dados inválidos.', path: '/api/v1/manutencoes' }, { status: 400, statusText: 'Bad Request' });
    f.detectChanges();
    expect(modal(f)!.querySelector('.modal-form__rodape [role="alert"]')?.textContent?.trim()).toBe('Dados inválidos.');
  });
});

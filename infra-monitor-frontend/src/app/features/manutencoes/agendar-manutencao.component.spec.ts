import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EquipmentOperationalStatus, MaintenanceScope, MaintenanceWindowStatus } from '../../core/models/api-enums';
import { DashboardEquipamentoLista } from '../../core/models/dashboard';
import { ManutencaoResponse, PresetAgendamento } from '../../core/models/manutencao';
import { UnidadeResponse } from '../../core/models/unidade';
import { AgendarManutencaoComponent } from './agendar-manutencao.component';
import { isoParaLocal, localParaIso } from './periodo';

@Component({
  imports: [AgendarManutencaoComponent],
  template: `<button id="gatilho" type="button" (click)="aberto.set(true)">+ Agendar manutenção</button>
    <app-agendar-manutencao [aberto]="aberto()" [duracaoMaximaHoras]="72" [preset]="preset()" [janela]="janela()" (fechar)="aberto.set(false)" (agendada)="criada.set($event); aberto.set(false)" (salva)="salva.set($event); aberto.set(false)" (desatualizada)="desatualizada.set(true)" />`,
})
class HostComponent {
  readonly aberto = signal(false);
  readonly desatualizada = signal(false);
  readonly criada = signal<ManutencaoResponse | null>(null);
  readonly preset = signal<PresetAgendamento | null>(null);
  readonly janela = signal<ManutencaoResponse | null>(null);
  readonly salva = signal<ManutencaoResponse | null>(null);
}

const URL = 'http://localhost:8080/api/v1/manutencoes';
const unidade = (id: number, nome: string): UnidadeResponse => ({ id, nome, sigla: nome.slice(0, 3).toUpperCase(), descricao: null, codigoIbge: null, ativo: true, createdAt: '', updatedAt: '', endereco: null, cidade: null, uf: null, latitude: null, longitude: null, conectaAUnidadeId: null });
const equipamento = (id: number, nome: string, unidadeId: number, ativo = true): DashboardEquipamentoLista => ({ id, nome, tipoNome: 'Switch', unidadeId, unidadeNome: '', hostname: null, ip: null, status: EquipmentOperationalStatus.Available, latenciaMs: null, ativo, localizacao: null, numeroSerie: null, emManutencao: false, manutencaoManual: false, janelaAtivaId: null, janelaAtivaFim: null });
const resposta = (parcial: Partial<ManutencaoResponse> = {}): ManutencaoResponse => ({ id: 50, unidade: { id: 1, nome: 'Sede' }, escopo: MaintenanceScope.Unit, equipamentos: [], inicioPrevisto: '', fimPrevisto: '', motivo: 'x', situacao: MaintenanceWindowStatus.Scheduled, criadoPor: { id: 1, nome: 'Ana' }, ativadaEm: null, encerradaEm: null, encerradaPor: null, canceladaEm: null, canceladaPor: null, sobreposicoes: [], versao: 0, ultimaAlteracao: null, ...parcial });

describe('AgendarManutencaoComponent', () => {
  let http: HttpTestingController;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  const el = (f: ComponentFixture<HostComponent>) => f.nativeElement as HTMLElement;
  const modal = (f: ComponentFixture<HostComponent>) => el(f).querySelector<HTMLElement>('app-modal section[role="dialog"]');
  const abrir = (config?: (h: HostComponent) => void) => {
    const f = TestBed.createComponent(HostComponent); config?.(f.componentInstance); f.detectChanges();
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
  const abrirEdicao = (j: ManutencaoResponse, atual: ManutencaoResponse = j) => {
    const r = abrir((h) => h.janela.set(j));
    http.expectOne(`${URL}/${j.id}`).flush(atual);
    r.f.detectChanges();
    return r;
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

  it('preset trava a unidade e marca o equipamento', () => {
    const { f } = abrir((h) => h.preset.set({ unidadeId: 1, travarUnidade: true, equipamentoIds: [8] }));
    expect(campo<HTMLSelectElement>(f, 'unidadeId').disabled).toBe(true);
    expect(campo<HTMLSelectElement>(f, 'unidadeId').value).toBe('1');
    const marcados = [...modal(f)!.querySelectorAll<HTMLInputElement>('.checagem input:checked')].map((i) => i.parentElement!.textContent!.trim());
    expect(marcados).toEqual(['AP-01']);
  });

  it('com todos os ativos marcados sugere Unidade inteira', () => {
    const { f } = abrir((h) => h.preset.set({ unidadeId: 1, travarUnidade: true, equipamentoIds: [7, 8] }));
    expect(modal(f)!.textContent).toContain('Todos marcados. Para incluir também os equipamentos criados durante a janela, use Unidade inteira.');
  });

  it('edição carrega GET /{id}, mostra vinculado inativo com nota e envia PUT com versao', () => {
    const j = resposta({ id: 50, escopo: MaintenanceScope.Equipment, unidade: { id: 1, nome: 'Sede' }, equipamentos: [{ id: 9, nome: 'AP-VELHO' }],
      inicioPrevisto: new Date(Date.now() + 3_600_000).toISOString(), fimPrevisto: new Date(Date.now() + 7_200_000).toISOString(), motivo: 'Original', versao: 3 });
    const { f } = abrirEdicao(j);
    expect(modal(f)!.querySelector('h2')!.textContent).toContain('Editar janela #50');
    expect(modal(f)!.textContent).toContain('AP-VELHO');
    expect(modal(f)!.textContent).toContain('inativo');
    preencher(f, 'motivo', 'Novo motivo');
    enviar(f);
    const put = http.expectOne(`${URL}/50`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual(expect.objectContaining({ versao: 3, motivo: 'Novo motivo', equipamentoIds: [9], unidadeId: 1 }));
    put.flush({ ...j, versao: 4 });
    f.detectChanges();
    expect(f.componentInstance.salva()?.versao).toBe(4);
  });

  it('continuação: equipamento da janela anterior que não está mais ativo na unidade é desmarcado e avisado', () => {
    // 9 ficou inativo e 10 está em outra unidade: nenhum aparece na checklist travada.
    const { f } = abrir((h) => h.preset.set({ unidadeId: 1, travarUnidade: true, escopo: MaintenanceScope.Equipment, equipamentoIds: [7, 9, 10] }));
    expect(modal(f)!.querySelector('.escopo__contagem')?.textContent?.trim()).toBe('1 de 2 selecionados');
    expect(modal(f)!.querySelector('[role="status"]')?.textContent?.trim())
      .toBe('2 equipamentos da janela anterior não estão mais ativos nesta unidade e foram desmarcados.');
    preencher(f, 'inicio', daqui(60)); preencher(f, 'fim', daqui(180)); preencher(f, 'motivo', 'Continuação');
    enviar(f);
    const req = http.expectOne(URL);
    expect(req.request.body.equipamentoIds).toEqual([7]);
    req.flush(resposta());
  });

  it('continuação com um equipamento descartado usa o singular', () => {
    const { f } = abrir((h) => h.preset.set({ unidadeId: 1, travarUnidade: true, escopo: MaintenanceScope.Equipment, equipamentoIds: [8, 9] }));
    expect(modal(f)!.querySelector('[role="status"]')?.textContent?.trim())
      .toBe('1 equipamento da janela anterior não está mais ativo nesta unidade e foi desmarcado.');
  });

  it('edição de janela que já ativou: avisa "use Alterar fim" e não deixa enviar', () => {
    const j = resposta({ id: 52, escopo: MaintenanceScope.Unit, inicioPrevisto: new Date(Date.now() + 3_600_000).toISOString(),
      fimPrevisto: new Date(Date.now() + 7_200_000).toISOString(), versao: 1 });
    const { f } = abrirEdicao(j, { ...j, situacao: MaintenanceWindowStatus.Active, versao: 2 });
    expect(modal(f)!.querySelector('.modal-form__rodape [role="alert"]')?.textContent?.trim()).toBe('A janela está ATIVA: use Alterar fim.');
    expect(modal(f)!.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(f.componentInstance.desatualizada()).toBe(true);
    enviar(f);
    http.expectNone(`${URL}/52`);
  });

  it('edição recusada com 409 avisa a lista que a linha está velha', () => {
    const j = resposta({ id: 53, escopo: MaintenanceScope.Unit, inicioPrevisto: new Date(Date.now() + 3_600_000).toISOString(),
      fimPrevisto: new Date(Date.now() + 7_200_000).toISOString(), versao: 1 });
    const { f } = abrirEdicao(j);
    expect(f.componentInstance.desatualizada()).toBe(false);
    preencher(f, 'motivo', 'Outro');
    enviar(f);
    http.expectOne(`${URL}/53`).flush({ timestamp: '', status: 409, error: 'Conflict', code: 'BUSINESS_CONFLICT', message: 'A janela foi alterada por outra pessoa. Recarregue e tente de novo.', path: '' }, { status: 409, statusText: 'Conflict' });
    f.detectChanges();
    expect(f.componentInstance.desatualizada()).toBe(true);
  });

  it('na edição, trocar a unidade limpa a seleção e esconde os vinculados da unidade antiga', () => {
    const j = resposta({ id: 51, escopo: MaintenanceScope.Equipment, equipamentos: [{ id: 7, nome: 'SW-CORE' }],
      inicioPrevisto: new Date(Date.now() + 3_600_000).toISOString(), fimPrevisto: new Date(Date.now() + 7_200_000).toISOString() });
    const { f } = abrirEdicao(j);
    preencher(f, 'unidadeId', '2');
    expect(modal(f)!.querySelectorAll('.checagem input:checked').length).toBe(0);
    expect(modal(f)!.textContent).not.toContain('SW-CORE');
    expect(modal(f)!.textContent).toContain('RT-ITA');
  });
});

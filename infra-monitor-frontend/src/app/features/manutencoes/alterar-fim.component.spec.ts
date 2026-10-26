import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MaintenanceScope, MaintenanceWindowStatus } from '../../core/models/api-enums';
import { ManutencaoResponse, PresetAgendamento } from '../../core/models/manutencao';
import { AlterarFimComponent } from './alterar-fim.component';
import { dataHora, isoParaLocal, localParaIso } from './periodo';

@Component({
  imports: [AlterarFimComponent],
  template: `<button id="gatilho" type="button" (click)="aberto.set(true)">Alterar fim</button>
    <app-alterar-fim [aberto]="aberto()" [janela]="janela()" [duracaoMaximaHoras]="72" (fechar)="aberto.set(false)"
      (alterado)="alterado.set($event); aberto.set(false)" (continuar)="continuar.set($event); aberto.set(false)" (desatualizada)="desatualizada.set(true)" />`,
})
class HostComponent {
  readonly aberto = signal(false);
  readonly desatualizada = signal(false);
  readonly janela = signal<ManutencaoResponse | null>(null);
  readonly alterado = signal<ManutencaoResponse | null>(null);
  readonly continuar = signal<PresetAgendamento | null>(null);
}

const URL = 'http://localhost:8080/api/v1/manutencoes';
const iso = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
const ativa = (parcial: Partial<ManutencaoResponse> = {}): ManutencaoResponse => ({
  id: 41, unidade: { id: 1, nome: 'Sede' }, escopo: MaintenanceScope.Equipment, equipamentos: [{ id: 7, nome: 'SW-CORE' }, { id: 8, nome: 'AP-01' }],
  inicioPrevisto: iso(-60), fimPrevisto: iso(60), motivo: 'Troca do switch core', situacao: MaintenanceWindowStatus.Active,
  criadoPor: { id: 1, nome: 'Ana' }, ativadaEm: iso(-60), encerradaEm: null, encerradaPor: null, canceladaEm: null, canceladaPor: null,
  sobreposicoes: [], versao: 2, ultimaAlteracao: null, ...parcial,
});
const erro409 = (message: string) => ({ timestamp: '', status: 409, error: 'Conflict', code: 'BUSINESS_CONFLICT', message, path: '/api/v1/manutencoes/41/fim' });

describe('AlterarFimComponent', () => {
  let http: HttpTestingController;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  const el = (f: ComponentFixture<HostComponent>) => f.nativeElement as HTMLElement;
  const modal = (f: ComponentFixture<HostComponent>) => el(f).querySelector<HTMLElement>('app-modal section[role="dialog"]');
  const texto = (f: ComponentFixture<HostComponent>) => modal(f)?.textContent?.replace(/\s+/g, ' ') ?? '';
  /** Abre e responde o GET /{id} que a tela faz ao abrir (a linha da lista pode estar velha). */
  const abrir = (j: ManutencaoResponse, atual: ManutencaoResponse = j) => {
    const f = TestBed.createComponent(HostComponent); f.componentInstance.janela.set(j); f.detectChanges();
    const gatilho = el(f).querySelector<HTMLButtonElement>('#gatilho')!;
    gatilho.focus(); gatilho.click(); f.detectChanges();
    http.expectOne(`${URL}/${j.id}`).flush(atual); f.detectChanges();
    return { f, gatilho };
  };
  const subtitulo = (f: ComponentFixture<HostComponent>) => modal(f)!.querySelector('header p')?.textContent?.trim() ?? null;
  const preencherFim = (f: ComponentFixture<HostComponent>, valor: string) => {
    const c = modal(f)!.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    c.value = valor; c.dispatchEvent(new Event('input')); f.detectChanges();
  };
  const enviar = (f: ComponentFixture<HostComponent>) => { modal(f)!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click(); f.detectChanges(); };
  const clicar = (f: ComponentFixture<HostComponent>, rotulo: string) => {
    [...modal(f)!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === rotulo)!.click(); f.detectChanges();
  };

  it('prorroga com PATCH /fim e versao', () => {
    const j = ativa();
    const { f } = abrir(j);
    expect(modal(f)!.querySelector<HTMLInputElement>('input[type="datetime-local"]')!.value).toBe(isoParaLocal(j.fimPrevisto));
    expect(texto(f)).toContain('72 h desde o início');
    preencherFim(f, isoParaLocal(iso(120)));
    enviar(f);
    const req = http.expectOne(`${URL}/41/fim`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ fimPrevisto: localParaIso(isoParaLocal(iso(120))), versao: 2 });
    req.flush({ ...j, fimPrevisto: iso(120), versao: 3 });
    f.detectChanges();
    expect(f.componentInstance.alterado()?.versao).toBe(3);
  });

  it('recusa no cliente fim no passado, igual ao atual ou acima do teto', () => {
    const j = ativa();
    const { f } = abrir(j);
    preencherFim(f, isoParaLocal(iso(-10))); enviar(f);
    expect(texto(f)).toContain('O novo fim já passou.');
    preencherFim(f, isoParaLocal(j.fimPrevisto)); enviar(f);
    expect(texto(f)).toContain('O novo fim é igual ao atual.');
    preencherFim(f, isoParaLocal(iso(-60 + 73 * 60))); enviar(f);
    expect(texto(f)).toContain('A janela não pode passar de 72 horas desde o início.');
    http.expectNone(`${URL}/41/fim`);
  });

  it('409 de janela concluída troca para Agendar continuação e emite preset', () => {
    const j = ativa();
    const { f } = abrir(j);
    preencherFim(f, isoParaLocal(iso(120))); enviar(f);
    http.expectOne(`${URL}/41/fim`).flush(erro409('Nao e possivel alterar o fim: a janela esta CONCLUIDA. Agende uma continuacao.'), { status: 409, statusText: 'Conflict' });
    http.expectOne(`${URL}/41`).flush({ ...j, situacao: MaintenanceWindowStatus.Completed, encerradaEm: iso(-1) });
    f.detectChanges();
    expect(texto(f)).toContain('A janela #41 concluiu às');
    expect(texto(f)).toContain('até a nova janela ativar, eles são pingados por alguns segundos');
    expect(document.activeElement?.textContent?.trim()).toBe('Agendar continuação');
    expect(subtitulo(f)).toBeNull();
    clicar(f, 'Agendar continuação');
    expect(f.componentInstance.continuar()).toEqual(expect.objectContaining({ unidadeId: 1, travarUnidade: true, escopo: j.escopo,
      equipamentoIds: j.equipamentos.map((e) => e.id), motivo: j.motivo }));
  });

  it('409 de versão velha troca pela versão atual: Fim atual novo e o segundo envio leva versao 3', () => {
    const j = ativa();
    const { f } = abrir(j);
    expect(subtitulo(f)).toContain('Prorrogue ou antecipe');
    preencherFim(f, isoParaLocal(iso(120))); enviar(f);
    http.expectOne(`${URL}/41/fim`).flush(erro409('A janela foi alterada por outra pessoa. Recarregue e tente de novo.'), { status: 409, statusText: 'Conflict' });
    const fimNovo = iso(90);
    http.expectOne(`${URL}/41`).flush({ ...j, fimPrevisto: fimNovo, versao: 3 });
    f.detectChanges();
    expect(texto(f)).toContain('Fim atual atualizado; confira e envie de novo.');
    expect(texto(f)).not.toContain('Feche e abra de novo');
    expect(texto(f)).toContain(`Fim atual: ${dataHora(fimNovo)}`);
    expect(f.componentInstance.desatualizada()).toBe(true);
    expect(f.componentInstance.continuar()).toBeNull();

    enviar(f);
    const segunda = http.expectOne(`${URL}/41/fim`);
    expect(segunda.request.body).toEqual({ fimPrevisto: localParaIso(isoParaLocal(iso(120))), versao: 3 });
    segunda.flush({ ...j, fimPrevisto: iso(120), versao: 4 }); f.detectChanges();
    expect(f.componentInstance.alterado()?.versao).toBe(4);
  });

  it('409 com a janela fora de ATIVA e não concluída mostra a mensagem do servidor e não deixa reenviar', () => {
    const j = ativa();
    const { f } = abrir(j);
    preencherFim(f, isoParaLocal(iso(120))); enviar(f);
    http.expectOne(`${URL}/41/fim`).flush(erro409('Nao e possivel alterar o fim: a janela esta EXPIRADA.'), { status: 409, statusText: 'Conflict' });
    http.expectOne(`${URL}/41`).flush({ ...j, situacao: MaintenanceWindowStatus.Expired, versao: 3 });
    f.detectChanges();
    expect(texto(f)).toContain('Nao e possivel alterar o fim: a janela esta EXPIRADA.');
    expect(modal(f)!.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(f.componentInstance.desatualizada()).toBe(true);
  });

  it('ao abrir usa a versão do GET: linha velha não manda versao velha', () => {
    const j = ativa();
    const { f } = abrir(j, { ...j, versao: 5, fimPrevisto: iso(80) });
    expect(texto(f)).toContain(`Fim atual: ${dataHora(iso(80))}`);
    expect(modal(f)!.querySelector<HTMLInputElement>('input[type="datetime-local"]')!.value).toBe(isoParaLocal(iso(80)));
    expect(f.componentInstance.desatualizada()).toBe(true);
    preencherFim(f, isoParaLocal(iso(120))); enviar(f);
    const req = http.expectOne(`${URL}/41/fim`);
    expect(req.request.body.versao).toBe(5);
    req.flush({ ...j, versao: 6 });
  });

  it('ao abrir uma janela que já concluiu vai direto para Agendar continuação', () => {
    const j = ativa();
    const { f } = abrir(j, { ...j, situacao: MaintenanceWindowStatus.Completed, encerradaEm: iso(-1), versao: 3 });
    expect(texto(f)).toContain('A janela #41 concluiu às');
    expect(subtitulo(f)).toBeNull();
    expect(f.componentInstance.desatualizada()).toBe(true);
  });

  it('Escape fecha e devolve o foco ao gatilho', () => {
    const { f, gatilho } = abrir(ativa());
    expect(document.activeElement).toBe(modal(f)!.querySelector('input[type="datetime-local"]'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); f.detectChanges();
    expect(modal(f)).toBeNull();
    expect(document.activeElement).toBe(gatilho);
  });
});

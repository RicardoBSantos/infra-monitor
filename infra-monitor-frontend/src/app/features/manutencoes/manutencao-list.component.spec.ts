import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MaintenanceScope, MaintenanceWindowStatus } from '../../core/models/api-enums';
import { PapelUsuario } from '../../core/models/auth';
import { ManutencaoResponse } from '../../core/models/manutencao';
import { AuthStateService } from '../../core/services/auth-state.service';
import { ManutencaoListComponent } from './manutencao-list.component';

const URL = 'http://localhost:8080/api/v1/manutencoes';
const local = (h: number, m: number) => new Date(2026, 9, 22, h, m).toISOString();
const janela = (parcial: Partial<ManutencaoResponse> = {}): ManutencaoResponse => ({
  id: 41, unidade: { id: 1, nome: 'Sede' }, escopo: MaintenanceScope.Unit, equipamentos: [],
  inicioPrevisto: local(10, 0), fimPrevisto: local(12, 0), motivo: 'Troca do switch core',
  situacao: MaintenanceWindowStatus.Scheduled, criadoPor: { id: 1, nome: 'Ana Operadora' },
  ativadaEm: null, encerradaEm: null, encerradaPor: null, canceladaEm: null, canceladaPor: null, sobreposicoes: [], ...parcial,
});
const pagina = (content: ManutencaoResponse[], totalPages = 1) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages, first: true, last: totalPages <= 1 });
const erroApi = (status: number, message: string) => ({ timestamp: '', status, error: 'Error', code: status === 409 ? 'BUSINESS_CONFLICT' : 'INTERNAL_ERROR', message, path: '/api/v1/manutencoes' });

const BANNER = 'O agendamento está desligado neste servidor: janelas não são ativadas. Peça para ligar MANUTENCAO_AGENDADA_ENABLED no backend. Enquanto isso, use Iniciar manutenção no equipamento. Janelas ativas não terminam sozinhas enquanto o agendamento estiver desligado: encerre-as aqui.';
const MSG_CANCELAR = 'A janela não vai acontecer. Ela ainda não excluiu nenhum período do relatório de disponibilidade, então nada muda no SLA.';
const MSG_ENCERRAR = 'Os equipamentos voltam a ser verificados na próxima varredura. O período desde o início da janela continua fora do relatório de disponibilidade: nele não houve medição, e encerrar não o devolve ao SLA. Equipamentos que também estão em manutenção manual continuam fora até ela ser encerrada.';
const NOTA_SLA = 'Cancelar ou encerrar uma janela não recupera SLA: o tempo em que os equipamentos ficaram em manutenção não foi medido.';

describe('ManutencaoListComponent', () => {
  let http: HttpTestingController;

  const sessao = (papel: PapelUsuario) => TestBed.inject(AuthStateService).setSession({ accessToken: 't', tokenType: 'Bearer', expiresIn: 60, usuario: { id: 1, nome: 'Ana', email: 'ana@example.test', papel, trocaSenhaObrigatoria: false } });
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ManutencaoListComponent], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    sessao('OPERADOR');
  });
  afterEach(() => { http.verify(); vi.useRealTimers(); });

  const lista = () => http.expectOne((r) => r.url === URL && r.method === 'GET');
  const parametros = (agendadorLigado = true) => http.expectOne(`${URL}/parametros`).flush({ agendadorLigado, duracaoMaximaHoras: 72 });
  const criar = () => { const f = TestBed.createComponent(ManutencaoListComponent); f.detectChanges(); return f; };
  /** Monta, responde parâmetros e a primeira página. */
  const carregada = (itens: ManutencaoResponse[], ligado = true, totalPages = 1) => {
    const f = criar(); parametros(ligado); lista().flush(pagina(itens, totalPages)); f.detectChanges(); return f;
  };
  const el = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
  const texto = (f: ComponentFixture<unknown>) => el(f).textContent?.replace(/\s+/g, ' ') ?? '';
  const celulas = (f: ComponentFixture<unknown>, linha = 0) => [...el(f).querySelectorAll('tbody tr')[linha].querySelectorAll('td')];
  const botaoAgendar = (f: ComponentFixture<unknown>) => [...el(f).querySelectorAll<HTMLButtonElement>('header button')].find((b) => b.textContent?.includes('+ Agendar manutenção'));
  const abrirMenu = (f: ComponentFixture<unknown>, linha = 0) => {
    el(f).querySelectorAll<HTMLButtonElement>('.menu-acoes__gatilho')[linha].click(); f.detectChanges();
    return [...el(f).querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  };
  const escolher = (f: ComponentFixture<unknown>, rotulo: string) => {
    const item = abrirMenu(f).find((b) => b.textContent?.trim() === rotulo);
    if (!item) throw new Error('ação ausente: ' + rotulo);
    item.click(); f.detectChanges();
  };
  const dialogo = (f: ComponentFixture<unknown>) => el(f).querySelector<HTMLElement>('app-confirm-dialog section');

  it('carrega parâmetros e a primeira página de vigentes; esqueleto, vazio e erro', () => {
    const f = criar();
    expect(el(f).querySelector('.esqueleto[role="status"]')).not.toBeNull();
    parametros();
    const req = lista();
    expect(req.request.params.get('situacao')).toBe('VIGENTES');
    expect(req.request.params.get('page')).toBe('0');
    expect(req.request.params.get('size')).toBe('20');
    expect(req.request.params.has('busca')).toBe(false);
    req.flush(pagina([])); f.detectChanges();
    expect(texto(f)).toContain('Nenhuma janela vigente.');

    const falha = criar(); parametros(); lista().flush(erroApi(500, 'Falha de leitura'), { status: 500, statusText: 'Erro' }); falha.detectChanges();
    expect(el(falha).querySelector('.feedback--error[role="alert"]')?.textContent).toContain('Falha de leitura');
  });

  it('cabeçalho de geração A com título, subtítulo e sem sobretítulo', () => {
    const f = carregada([janela()]);
    expect(el(f).querySelector('h1#manutencoes-title')?.textContent?.trim()).toBe('Janelas de manutenção');
    expect(el(f).querySelector('p.pagina__descricao')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Intervenções planejadas. Equipamentos em janela ativa não são verificados e o período não conta no relatório de disponibilidade.');
    expect(el(f).querySelector('.eyebrow')).toBeNull();
    expect(el(f).querySelector('table.tabela')).not.toBeNull();
  });

  it('linha: #id, unidade, escopo, datas dd/MM/yyyy HH:mm, motivo, criado por e badge', () => {
    const f = carregada([janela(), janela({ id: 42, escopo: MaintenanceScope.Equipment, equipamentos: [{ id: 7, nome: 'SW-CORE' }, { id: 8, nome: 'AP-01' }, { id: 9, nome: 'RT-01' }], situacao: MaintenanceWindowStatus.Active, ativadaEm: local(10, 0) })]);
    const c = celulas(f).map((td) => td.textContent?.replace(/\s+/g, ' ').trim());
    expect(c[0]).toBe('#41');
    expect(c[1]).toBe('Sede');
    expect(c[2]).toBe('Unidade inteira');
    expect(c[3]).toBe('22/10/2026 10:00');
    expect(c[4]).toBe('22/10/2026 12:00');
    expect(c[5]).toBe('Troca do switch core');
    expect(c[6]).toBe('Ana Operadora');
    expect(celulas(f)[7].querySelector('app-status-badge')?.textContent?.trim()).toBe('Agendada');
    const escopo = celulas(f, 1)[2];
    expect(escopo.textContent?.trim()).toBe('3 equipamentos');
    expect(escopo.querySelector('[title]')?.getAttribute('title')).toBe('SW-CORE, AP-01, RT-01');
    expect(celulas(f, 1)[7].textContent?.trim()).toBe('Ativa');
    // ativada no horário: sem segunda linha
    expect(celulas(f, 1)[3].querySelector('small')).toBeNull();
  });

  it('segunda linha de atraso só quando a ativação passou mais de 60 s do previsto', () => {
    const f = carregada([
      janela({ situacao: MaintenanceWindowStatus.Active, ativadaEm: local(10, 47) }),
      janela({ id: 43, situacao: MaintenanceWindowStatus.Active, ativadaEm: new Date(new Date(local(10, 0)).getTime() + 60_000).toISOString() }),
    ]);
    expect(celulas(f)[3].querySelector('small')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('ativada 10:47 · 47 min de atraso');
    expect(celulas(f, 1)[3].querySelector('small')).toBeNull();
  });

  it('ATIVA com o fim previsto já passado ganha a segunda linha "fim previsto já passou"', () => {
    const daqui = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
    const f = carregada([
      janela({ situacao: MaintenanceWindowStatus.Active, inicioPrevisto: daqui(-180), fimPrevisto: daqui(-30), ativadaEm: daqui(-180) }),
      janela({ id: 42, situacao: MaintenanceWindowStatus.Active, inicioPrevisto: daqui(-60), fimPrevisto: daqui(60), ativadaEm: daqui(-60) }),
      janela({ id: 43, inicioPrevisto: daqui(-180), fimPrevisto: daqui(-30) }),
      janela({ id: 44, situacao: MaintenanceWindowStatus.Expired, inicioPrevisto: daqui(-180), fimPrevisto: daqui(-30) }),
    ]);
    const aviso = celulas(f)[4].querySelector('small.desvio');
    expect(aviso?.textContent?.trim()).toBe('fim previsto já passou');
    expect(aviso?.classList.contains('desvio--neutro')).toBe(false);
    for (const linha of [1, 2, 3]) expect(celulas(f, linha)[4].querySelector('small')).toBeNull();
  });

  it('página esvaziada depois de uma ação volta para a última página existente', () => {
    const f = carregada([janela()], true, 3);
    [...el(f).querySelectorAll<HTMLButtonElement>('app-paginacao button')].find((b) => b.textContent?.includes('Próxima'))!.click(); f.detectChanges();
    lista().flush({ ...pagina([janela()], 3), page: 1 }); f.detectChanges();
    [...el(f).querySelectorAll<HTMLButtonElement>('app-paginacao button')].find((b) => b.textContent?.includes('Próxima'))!.click(); f.detectChanges();
    lista().flush({ ...pagina([janela()], 3), page: 2 }); f.detectChanges();
    expect(texto(f)).toContain('Página 3 de 3');

    escolher(f, 'Cancelar');
    [...dialogo(f)!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Cancelar janela')!.click(); f.detectChanges();
    http.expectOne(`${URL}/41/cancelar`).flush(janela({ situacao: MaintenanceWindowStatus.Cancelled })); f.detectChanges();
    const vazia = lista(); expect(vazia.request.params.get('page')).toBe('2');
    vazia.flush({ ...pagina([], 2), page: 2, totalElements: 40 }); f.detectChanges();
    const volta = lista(); expect(volta.request.params.get('page')).toBe('1');
    volta.flush({ ...pagina([janela({ id: 60 })], 2), page: 1, totalElements: 40 }); f.detectChanges();
    expect(texto(f)).toContain('Página 2 de 2');
    expect(celulas(f)[0].textContent?.trim()).toBe('#60');
    expect(el(f).querySelector('.notice')?.textContent?.trim()).toBe('Janela #41 cancelada.');
  });

  it('menu por situação: AGENDADA cancela, ATIVA encerra, as demais ficam sem menu', () => {
    const f = carregada([
      janela(),
      janela({ id: 42, situacao: MaintenanceWindowStatus.Active, ativadaEm: local(10, 0) }),
      janela({ id: 43, situacao: MaintenanceWindowStatus.Completed }),
      janela({ id: 44, situacao: MaintenanceWindowStatus.Cancelled }),
      janela({ id: 45, situacao: MaintenanceWindowStatus.Expired }),
    ]);
    expect(abrirMenu(f, 0).map((b) => b.textContent?.trim())).toEqual(['Cancelar']);
    abrirMenu(f, 0);
    expect(abrirMenu(f, 1).map((b) => b.textContent?.trim())).toEqual(['Encerrar agora']);
    abrirMenu(f, 1);
    expect(el(f).querySelectorAll('.menu-acoes__gatilho').length).toBe(2);
    for (const linha of [2, 3, 4]) expect(celulas(f, linha)[8].textContent?.trim()).toBe('—');
  });

  it('VISUALIZADOR vê a lista, sem botão de agendar e com ações desabilitadas', () => {
    sessao('VISUALIZADOR');
    const f = carregada([janela()]);
    expect(botaoAgendar(f)).toBeUndefined();
    const [cancelar] = abrirMenu(f);
    expect(cancelar.disabled).toBe(true);
  });

  it('agendador desligado: banner com o texto exato e botão de agendar desabilitado', () => {
    const ligado = carregada([janela()]);
    expect(el(ligado).querySelector('.banner-agendador')).toBeNull();
    expect(botaoAgendar(ligado)?.disabled).toBe(false);

    const f = carregada([janela()], false);
    const banner = el(f).querySelector('.banner-agendador');
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.textContent?.replace(/\s+/g, ' ').trim()).toBe(BANNER);
    expect(botaoAgendar(f)?.disabled).toBe(true);
  });

  it('filtro Vigentes/Histórico volta à página 0 e consulta HISTORICO', () => {
    const f = carregada([janela()], true, 3);
    const grupo = el(f).querySelector('[role="group"][aria-label="Situação"]')!;
    const [vigentes, historico] = [...grupo.querySelectorAll<HTMLButtonElement>('button')];
    expect(vigentes.getAttribute('aria-pressed')).toBe('true');
    expect(historico.getAttribute('aria-pressed')).toBe('false');

    [...el(f).querySelectorAll<HTMLButtonElement>('app-paginacao button')].find((b) => b.textContent?.includes('Próxima'))!.click(); f.detectChanges();
    const segunda = lista(); expect(segunda.request.params.get('page')).toBe('1'); segunda.flush({ ...pagina([janela()], 3), page: 1 }); f.detectChanges();
    expect(texto(f)).toContain('Página 2 de 3');

    historico.click(); f.detectChanges();
    const req = lista();
    expect(req.request.params.get('situacao')).toBe('HISTORICO');
    expect(req.request.params.get('page')).toBe('0');
    req.flush(pagina([])); f.detectChanges();
    expect(historico.getAttribute('aria-pressed')).toBe('true');
    expect(texto(f)).toContain('Nenhuma janela no histórico.');
  });

  it('busca com debounce de 300 ms volta à página 0', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = carregada([janela()], true, 3);
    const campo = el(f).querySelector<HTMLInputElement>('input[type="search"]')!;
    campo.value = 'se'; campo.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(200);
    campo.value = 'sede'; campo.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(299);
    http.expectNone((r) => r.url === URL);
    vi.advanceTimersByTime(1);
    const req = lista();
    expect(req.request.params.get('busca')).toBe('sede');
    expect(req.request.params.get('page')).toBe('0');
    req.flush(pagina([]));
  });

  it('cancelar: diálogo com título, botão e texto de SLA exatos; sucesso avisa e recarrega', () => {
    const f = carregada([janela()]);
    escolher(f, 'Cancelar');
    const d = dialogo(f)!;
    expect(d.querySelector('h2')?.textContent).toBe('Cancelar a janela #41?');
    expect(d.querySelector('p')?.textContent).toBe(MSG_CANCELAR);
    const confirmar = [...d.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Cancelar janela')!;
    expect(confirmar.classList.contains('botao--primario')).toBe(true);
    confirmar.click(); f.detectChanges();
    const req = http.expectOne(`${URL}/41/cancelar`); expect(req.request.method).toBe('PATCH');
    req.flush(janela({ situacao: MaintenanceWindowStatus.Cancelled })); f.detectChanges();
    lista().flush(pagina([])); f.detectChanges();
    expect(dialogo(f)).toBeNull();
    expect(el(f).querySelector('.notice[role="status"]')?.textContent?.trim()).toBe('Janela #41 cancelada.');
  });

  it('cancelar recusado pela API mostra o erro dentro do diálogo', () => {
    const f = carregada([janela()]);
    escolher(f, 'Cancelar');
    [...dialogo(f)!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Cancelar janela')!.click(); f.detectChanges();
    http.expectOne(`${URL}/41/cancelar`).flush(erroApi(409, 'A janela #41 já está ATIVA.'), { status: 409, statusText: 'Conflict' }); f.detectChanges();
    expect(dialogo(f)?.querySelector('[role="alert"]')?.textContent).toBe('A janela #41 já está ATIVA.');
  });

  it('encerrar agora: diálogo com título, botão e texto de SLA exatos; sucesso avisa e recarrega', () => {
    const f = carregada([janela({ situacao: MaintenanceWindowStatus.Active, ativadaEm: local(10, 0) })]);
    escolher(f, 'Encerrar agora');
    const d = dialogo(f)!;
    expect(d.querySelector('h2')?.textContent).toBe('Encerrar agora a janela #41?');
    expect(d.querySelector('p')?.textContent).toBe(MSG_ENCERRAR);
    const confirmar = [...d.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Encerrar janela')!;
    expect(confirmar.classList.contains('botao--primario')).toBe(true);
    confirmar.click(); f.detectChanges();
    http.expectOne(`${URL}/41/encerrar`).flush(janela({ situacao: MaintenanceWindowStatus.Completed })); f.detectChanges();
    lista().flush(pagina([])); f.detectChanges();
    expect(el(f).querySelector('.notice')?.textContent?.trim()).toBe('Janela #41 encerrada.');
  });

  it('nota fixa de SLA abaixo da tabela', () => {
    const f = carregada([janela()]);
    expect(el(f).querySelector('.nota-sla')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(NOTA_SLA);
  });

  it('modal de agendar: foco entra na Unidade, Escape fecha e devolve o foco ao botão', () => {
    const f = carregada([janela()]);
    const botao = botaoAgendar(f)!;
    botao.focus(); botao.click(); f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/unidades')).flush([]);
    http.expectOne((r) => r.url.endsWith('/dashboard/equipamentos')).flush([]);
    f.detectChanges();
    const modal = el(f).querySelector('app-modal section[role="dialog"]')!;
    expect(modal.querySelector('h2')?.textContent).toBe('Agendar manutenção');
    expect(document.activeElement).toBe(modal.querySelector('select[formcontrolname="unidadeId"]'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); f.detectChanges();
    expect(el(f).querySelector('app-modal section[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(botao);
  });

  it('agendar: abre o modal, sucesso fecha, avisa a sobreposição e recarrega', () => {
    const f = carregada([janela()]);
    botaoAgendar(f)!.click(); f.detectChanges();
    http.expectOne((r) => r.url.endsWith('/unidades')).flush([]);
    http.expectOne((r) => r.url.endsWith('/dashboard/equipamentos')).flush([]);
    f.detectChanges();
    expect(el(f).querySelector('app-modal section[role="dialog"]')).not.toBeNull();
    (f.componentInstance as unknown as { aoAgendar(j: ManutencaoResponse): void }).aoAgendar(janela({ id: 50, sobreposicoes: [41] }));
    f.detectChanges();
    lista().flush(pagina([janela()])); f.detectChanges();
    expect(el(f).querySelector('app-modal section[role="dialog"]')).toBeNull();
    expect(el(f).querySelector('.notice')?.textContent?.trim()).toBe('Janela #50 agendada. Atenção: sobrepõe a janela #41.');
  });
});


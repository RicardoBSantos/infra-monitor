import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';

import { MaintenanceWindowStatus, UnitOperationalStatus } from '../../core/models/api-enums';
import { PapelUsuario } from '../../core/models/auth';
import { AuthStateService } from '../../core/services/auth-state.service';
import { UnidadeDetalheComponent } from './unidade-detalhe.component';
import { Title } from '@angular/platform-browser';

import { BreadcrumbLabelService } from '../../shared/breadcrumbs/breadcrumb-label.service';
import { UnidadeDetalheStore } from './detalhe/unidade-detalhe.store';

const detalhe = {
  id: 7, nome: 'Centro Operacional', codigoIbge: '2800308', ativo: true, status: UnitOperationalStatus.Degraded,
  equipamentos: { total: 4, ativos: 4, disponiveis: 2, degradados: 1, indisponiveis: 1, semDados: 0, semMonitoramento: 0, emManutencao: 1 },
  monitores: { ativos: 4, indisponiveis: 1 }, incidentesAbertos: 1,
};
const cadastro = {
  id: 7, nome: 'Centro Operacional', sigla: 'CIS-01', descricao: null, codigoIbge: '2800308', ativo: true,
  createdAt: '', updatedAt: '', endereco: 'Av. Ivo do Prado, 1120', cidade: 'Aracaju', uf: 'SE',
  latitude: -10.929, longitude: -37.0715, conectaAUnidadeId: null,
};
const equipamento = {
  id: 31, nome: 'SW-CORE', ip: '10.0.0.1', hostname: 'sw-core.rede.local', localizacao: 'Rack 1', ativo: true, status: 'DISPONIVEL',
  tipoEquipamento: { id: 2, nome: 'Switch' }, emManutencao: false, monitoresAtivos: 1, incidentesAbertos: 0,
  ultimaMedicao: { status: 'SUCESSO', latenciaMs: 13, executadoEm: '2026-08-19T11:59:45Z' },
};
const pagina = <T,>(content: T[]) => ({ content, page: 0, size: content.length, totalElements: content.length, totalPages: 1, first: true, last: true });

describe('UnidadeDetalheComponent', () => {
  let httpTesting: HttpTestingController;

  async function configurar(id: string) {
    await TestBed.configureTestingModule({
      imports: [UnidadeDetalheComponent],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(), UnidadeDetalheStore,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', id]]) } } },
      ],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  }

  afterEach(() => { httpTesting.verify({ ignoreCancelled: true }); });

  function criar() { const fixture = TestBed.createComponent(UnidadeDetalheComponent); fixture.detectChanges(); return fixture; }
  function texto(fixture: ComponentFixture<UnidadeDetalheComponent>) { return (fixture.nativeElement as HTMLElement).textContent ?? ''; }

  const sessao = (papel: PapelUsuario) => TestBed.inject(AuthStateService).setSession({ accessToken: 't', tokenType: 'Bearer', expiresIn: 60, usuario: { id: 1, nome: 'Ana', email: 'ana@example.test', papel, trocaSenhaObrigatoria: false } });
  const janela = (extra: object) => ({ id: 41, situacao: MaintenanceWindowStatus.Active, motivo: 'Troca do switch', inicioPrevisto: '2026-10-23T10:00:00Z', fimPrevisto: '2026-10-23T15:00:00Z', versao: 1, ...extra });

  /** Chamadas do agendamento, disparadas no construtor junto com o carregamento da unidade. */
  function responderManutencao(parametros: object | 'erro' = { agendadorLigado: true, duracaoMaximaHoras: 72 }, janelas: object[] | 'erro' = []) {
    const params = httpTesting.expectOne((request) => request.url.endsWith('/manutencoes/parametros'));
    if (parametros === 'erro') params.error(new ProgressEvent('erro'), { status: 0, statusText: 'Unknown Error' }); else params.flush(parametros);
    const lista = httpTesting.expectOne((request) => request.url.endsWith('/manutencoes'));
    expect(lista.request.params.get('situacao')).toBe('VIGENTES');
    expect(lista.request.params.get('unidadeId')).toBe('7');
    expect(lista.request.params.get('page')).toBe('0');
    expect(lista.request.params.get('size')).toBe('5');
    if (janelas === 'erro') lista.error(new ProgressEvent('erro'), { status: 500, statusText: 'x' }); else lista.flush(pagina(janelas));
  }

  function responder(fixture: ComponentFixture<UnidadeDetalheComponent>, corpo: object = detalhe, manutencao: Parameters<typeof responderManutencao> = []) {
    responderManutencao(...manutencao);
    httpTesting.expectOne((request) => request.url.endsWith('/dashboard/unidades/7')).flush(corpo);
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/unidades/7')).flush(cadastro);
    httpTesting.expectOne((request) => request.url.includes('/dashboard/unidades/7/equipamentos')).flush(pagina([equipamento]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/disponibilidade/unidades')).flush(pagina([{ unidadeId: 7, disponibilidadePercentual: 99.42 }]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/latencia/unidades')).flush(pagina([{ unidadeId: 7, avgLatenciaMs: 23 }]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/disponibilidade/equipamentos')).flush(pagina([{ equipamentoId: 31, disponibilidadePercentual: 99.93 }]));
    fixture.detectChanges();
  }

  it('monta o cabeçalho com metadados de localização e os 7 KPIs', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture);

    expect(texto(fixture)).toContain('Centro Operacional');
    expect(texto(fixture)).toContain('Degradada');
    expect(texto(fixture)).toContain('CIS-01 · Aracaju/SE · Av. Ivo do Prado, 1120 · -10.929, -37.0715');
    expect(texto(fixture)).toContain('99,42%');
    expect(texto(fixture)).toContain('23');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.kpi').length).toBe(7);
  });

  it('concorda monitorados e ativos no singular', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture, { ...detalhe, equipamentos: { ...detalhe.equipamentos, total: 1, ativos: 1, semMonitoramento: 0 } });
    expect(texto(fixture)).toContain('1 monitorado');
    expect(texto(fixture)).not.toContain('1 monitorados');
    expect(texto(fixture)).toContain('de 1 ativo');
    expect(texto(fixture)).not.toContain('1 ativos');
  });

  it('omite os segmentos ausentes dos metadados em vez de exibir vazio', async () => {
    await configurar('7');
    const fixture = criar();
    responderManutencao();
    httpTesting.expectOne((request) => request.url.endsWith('/dashboard/unidades/7')).flush(detalhe);
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/unidades/7'))
      .flush({ ...cadastro, endereco: null, cidade: null, uf: null, latitude: null, longitude: null });
    httpTesting.expectOne((request) => request.url.includes('/dashboard/unidades/7/equipamentos')).flush(pagina([equipamento]));
    for (const trecho of ['/relatorios/disponibilidade/unidades', '/relatorios/latencia/unidades', '/relatorios/disponibilidade/equipamentos']) {
      httpTesting.expectOne((request) => request.url.includes(trecho)).flush(pagina([]));
    }
    fixture.detectChanges();

    const meta = (fixture.nativeElement as HTMLElement).querySelector('.unidade-detalhe__meta');
    expect(meta?.textContent?.trim()).toBe('CIS-01');
  });

  const botaoAgendar = (fixture: ComponentFixture<UnidadeDetalheComponent>) =>
    [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')]
      .find((elemento) => elemento.textContent?.includes('Agendar manutenção')) as HTMLButtonElement | undefined;

  it('habilita "Agendar manutenção" para OPERADOR e abre o modal com a unidade travada', async () => {
    await configurar('7');
    sessao('OPERADOR');
    const fixture = criar();
    responder(fixture);

    const botao = botaoAgendar(fixture)!;
    expect(botao.disabled).toBe(false);
    botao.click();
    fixture.detectChanges();
    // O modal carrega unidades e equipamentos ao abrir.
    httpTesting.match(() => true);
    fixture.detectChanges();
    const modal = (fixture.nativeElement as HTMLElement).querySelector('app-agendar-manutencao');
    expect(modal).not.toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('desabilita o botão com a dica quando o agendador está desligado', async () => {
    await configurar('7');
    sessao('OPERADOR');
    const fixture = criar();
    responder(fixture, detalhe, [{ agendadorLigado: false, duracaoMaximaHoras: 72 }]);
    expect(botaoAgendar(fixture)!.disabled).toBe(true);
    expect(botaoAgendar(fixture)!.title).toBe('Agendamento desligado neste servidor');
  });

  it('falha ao consultar o agendador não se passa por agendador desligado', async () => {
    await configurar('7');
    sessao('OPERADOR');
    const fixture = criar();
    responder(fixture, detalhe, ['erro']);
    expect(botaoAgendar(fixture)!.disabled).toBe(true);
    expect(botaoAgendar(fixture)!.title).toBe('Não foi possível consultar o agendador');
  });

  it('depois de agendar avisa "Janela #N agendada." com a sobreposição, em role="status"', async () => {
    await configurar('7');
    sessao('OPERADOR');
    const fixture = criar();
    responder(fixture);
    botaoAgendar(fixture)!.click();
    fixture.detectChanges();
    httpTesting.match(() => true);
    (fixture.componentInstance as unknown as { aoAgendar(j: object): void }).aoAgendar(janela({ id: 50, situacao: MaintenanceWindowStatus.Scheduled, sobreposicoes: [41, 44] }));
    fixture.detectChanges();
    httpTesting.expectOne((request) => request.url.endsWith('/manutencoes')).flush(pagina([]));
    fixture.detectChanges();
    const aviso = (fixture.nativeElement as HTMLElement).querySelector('.notice[role="status"]');
    expect(aviso?.textContent?.trim()).toBe('Janela #50 agendada. Atenção: sobrepõe as janelas #41, #44.');
  });

  it('desabilita o botão com "Unidade inativa" quando a unidade está inativa', async () => {
    await configurar('7');
    sessao('OPERADOR');
    const fixture = criar();
    responder(fixture);
    TestBed.inject(UnidadeDetalheStore).cadastro.set({ ...cadastro, ativo: false });
    fixture.detectChanges();
    expect(botaoAgendar(fixture)!.disabled).toBe(true);
    expect(botaoAgendar(fixture)!.title).toBe('Unidade inativa');
  });

  it('não mostra o botão para VISUALIZADOR', async () => {
    await configurar('7');
    sessao('VISUALIZADOR');
    const fixture = criar();
    responder(fixture);
    expect(botaoAgendar(fixture)).toBeUndefined();
  });

  it('mostra o banner com a janela ativa e a próxima, com link para /manutencoes', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture, detalhe, [undefined, [
      janela({}),
      janela({ id: 42, situacao: MaintenanceWindowStatus.Scheduled, motivo: 'Atualizar firmware', inicioPrevisto: '2026-10-24T10:00:00Z', fimPrevisto: '2026-10-24T12:00:00Z' }),
    ]]);

    const banner = (fixture.nativeElement as HTMLElement).querySelector('.banner-janela')!;
    expect(banner.textContent).toContain('Janela #41 ativa até');
    expect(banner.textContent).toContain('· Troca do switch');
    expect(banner.textContent).toContain('Próxima: #42 em');
    expect(banner.textContent).toContain('Atualizar firmware');
    expect(banner.querySelector('a')?.getAttribute('href')).toBe('/manutencoes');
  });

  it('sem janelas vigentes não mostra banner', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector('.banner-janela')).toBeNull();
  });

  it('falha na lista de janelas esconde o banner e o resto da tela segue', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture, detalhe, [undefined, 'erro']);
    expect((fixture.nativeElement as HTMLElement).querySelector('.banner-janela')).toBeNull();
    expect(texto(fixture)).toContain('Centro Operacional');
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).toBeNull();
  });

  it('expõe as cinco abas como tablist navegável', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture);

    const abas = (fixture.nativeElement as HTMLElement).querySelectorAll('[role="tab"]');
    expect(abas.length).toBe(5);
    expect([...abas].map((aba) => aba.textContent?.trim()))
      .toEqual(['Visão geral', 'Equipamentos', 'Incidentes', 'Histórico', 'Configurações']);
  });

  it('usa a casca .pagina na raiz', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector('section.unidade-detalhe.pagina')).not.toBeNull();
  });

  it('navega as abas com setas e End pelo helper compartilhado', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture);
    const abas = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]')];
    abas.forEach((aba) => aba.addEventListener('click', (e) => e.preventDefault()));
    abas[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(abas[1]);
    abas[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(abas[abas.length - 1]);
  });

  it('publica o nome da unidade na migalha e no título do documento', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture);

    expect(TestBed.inject(BreadcrumbLabelService).rotulo()).toBe('Centro Operacional');
    expect(TestBed.inject(Title).getTitle()).toBe('Centro Operacional · Infra Monitor');
  });

  it('devolve migalha e título ao padrão quando a tela é destruída', async () => {
    await configurar('7');
    const fixture = criar();
    responder(fixture);
    fixture.destroy();

    expect(TestBed.inject(BreadcrumbLabelService).rotulo()).toBeNull();
    expect(TestBed.inject(Title).getTitle()).toBe('Infra Monitor');
  });

  it('mostra unidade não encontrada quando a API responde 404', async () => {
    await configurar('99999');
    const fixture = criar();
    httpTesting.expectOne((request) => request.url.endsWith('/manutencoes/parametros')).flush({ agendadorLigado: true, duracaoMaximaHoras: 72 });
    httpTesting.expectOne((request) => request.url.endsWith('/manutencoes')).flush(pagina([]));
    httpTesting.expectOne((request) => request.url.endsWith('/dashboard/unidades/99999')).flush(
      { timestamp: '', status: 404, error: 'Not Found', code: 'RESOURCE_NOT_FOUND', message: 'Unidade nao encontrada', path: '' },
      { status: 404, statusText: 'Not Found' });
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/unidades/99999')).flush(cadastro);
    httpTesting.expectOne((request) => request.url.includes('/dashboard/unidades/99999/equipamentos')).flush(pagina([]));
    for (const trecho of ['/relatorios/disponibilidade/unidades', '/relatorios/latencia/unidades', '/relatorios/disponibilidade/equipamentos']) {
      httpTesting.expectOne((request) => request.url.includes(trecho)).flush(pagina([]));
    }
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Unidade não encontrada.');
  });

  it('não emite requisição alguma quando o id da rota é inválido', async () => {
    await configurar('abc');
    const fixture = criar();

    expect(texto(fixture)).toContain('Unidade não encontrada.');
    httpTesting.expectNone(() => true);
  });

  it('mantém cabeçalho e KPIs legíveis quando os relatórios falham', async () => {
    await configurar('7');
    const fixture = criar();
    responderManutencao();
    httpTesting.expectOne((request) => request.url.endsWith('/dashboard/unidades/7')).flush(detalhe);
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/unidades/7')).flush(cadastro);
    httpTesting.expectOne((request) => request.url.includes('/dashboard/unidades/7/equipamentos')).flush(pagina([equipamento]));
    for (const trecho of ['/relatorios/disponibilidade/unidades', '/relatorios/latencia/unidades', '/relatorios/disponibilidade/equipamentos']) {
      httpTesting.expectOne((request) => request.url.includes(trecho)).error(new ProgressEvent('erro'), { status: 500, statusText: 'Internal Server Error' });
    }
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Centro Operacional');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.kpi').length).toBe(7);
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.kpi__vazio').length).toBe(2);
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { UnitOperationalStatus } from '../../core/models/api-enums';
import { DashboardComponent } from './dashboard.component';

const resumo = {
  unidades: { total: 1 },
  equipamentos: { total: 4, ativos: 4, disponiveis: 2, degradados: 1, indisponiveis: 1, semDados: 1, semMonitoramento: 0, emManutencao: 1 },
  monitores: { total: 4, ativos: 4, disponiveis: 3, degradados: 1, indisponiveis: 1, semDados: 0 },
  incidentes: { abertos: 1 },
  limiarLatenciaDegradadaMs: 250,
  geradoEm: '2026-08-19T12:00:00Z',
};
const unidade = {
  id: 7, nome: 'Centro Operacional', codigoIbge: '2800308', ativo: true, status: UnitOperationalStatus.Degraded,
  equipamentosTotal: 4, equipamentosAtivos: 4, equipamentosDisponiveis: 2, equipamentosDegradados: 1, equipamentosIndisponiveis: 1,
  equipamentosSemDados: 1, equipamentosSemMonitoramento: 0, equipamentosEmManutencao: 1, incidentesAbertos: 1,
};
const equipamento = {
  id: 31, nome: 'SW-CORE', ip: '10.0.0.1', hostname: 'sw-core.rede.local', localizacao: 'Rack 1', ativo: true, status: 'DISPONIVEL',
  tipoEquipamento: { id: 2, nome: 'Switch' }, emManutencao: false, monitoresAtivos: 1, incidentesAbertos: 0,
  ultimaMedicao: { status: 'SUCESSO', latenciaMs: 13, executadoEm: '2026-08-19T11:59:45Z' },
};
const cadastro = {
  id: 31, nome: 'SW-CORE', ip: '10.0.0.1', hostname: 'sw-core.rede.local', descricao: null, localizacao: 'Rack 1',
  ativo: true, emManutencao: false, unidade: { id: 7, nome: 'Centro Operacional' }, tipoEquipamento: { id: 2, nome: 'Switch' },
  createdAt: '', updatedAt: '',
};
const incidenteAberto = {
  id: 90, status: 'ABERTO', iniciadoEm: '2026-08-19T11:48:00Z', encerradoEm: null, motivo: 'Falhas consecutivas', observacao: null,
  monitor: { id: 1, nome: 'ICMP', tipo: 'ICMP', equipamentoId: 31, equipamentoNome: 'SW-CORE', unidadeId: 7, unidadeNome: 'Centro Operacional' },
  createdAt: '2026-08-19T11:48:00Z', updatedAt: '2026-08-19T11:48:00Z',
};
const tipo = (id: number, nome: string, ativo = true) => ({ id, nome, descricao: null, ativo, createdAt: '', updatedAt: '' });
const tiposCatalogo = [tipo(2, 'Switch'), tipo(5, 'Câmera'), tipo(9, 'Legado', false)];
const pagina = <T,>(content: T[]) => ({ content, page: 0, size: content.length, totalElements: content.length, totalPages: 1, first: true, last: true });
const latenciaUnidade = (avg: number, count: number) => ({ unidadeId: 7, unidadeNome: 'Centro Operacional', inicio: '', fim: '', minLatenciaMs: 5, avgLatenciaMs: avg, maxLatenciaMs: 40, count });
const latencia = (avg: number, count: number) => ({ unidadeId: 7, unidadeNome: 'Centro Operacional', equipamentoId: 31, equipamentoNome: 'SW-CORE', monitorId: 1, monitorNome: 'ICMP', inicio: '', fim: '', minLatenciaMs: 5, avgLatenciaMs: avg, maxLatenciaMs: 40, count, p95LatenciaMs: 30 });

describe('DashboardComponent', () => {
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DashboardComponent], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { httpTesting.verify({ ignoreCancelled: true }); });

  function create() { const fixture = TestBed.createComponent(DashboardComponent); fixture.detectChanges(); return fixture; }
  function texto(fixture: ComponentFixture<DashboardComponent>) { return (fixture.nativeElement as HTMLElement).textContent ?? ''; }

  /** Respostas opcionais do catálogo de tipos e do índice de cadastro; `'erro'` responde 500. */
  interface Extras { tipos?: unknown[] | 'erro'; cadastro?: unknown; }

  function responderTipos(tipos: unknown[] | 'erro' = tiposCatalogo) {
    const requisicao = httpTesting.expectOne((request) => request.url.endsWith('/api/v1/tipos-equipamento'));
    if (tipos === 'erro') requisicao.flush(null, { status: 500, statusText: 'erro' });
    else requisicao.flush(tipos);
  }

  /** Responde às chamadas disparadas na abertura da página; nenhuma delas cria endpoint novo. */
  function responderCargaSemIncidentes(fixture: ComponentFixture<DashboardComponent>, resumoBody = resumo, unidadesBody = [unidade], extras: Extras = {}) {
    responderTipos(extras.tipos);
    httpTesting.expectOne('http://localhost:8080/api/v1/dashboard/resumo').flush(resumoBody);
    httpTesting.expectOne('http://localhost:8080/api/v1/dashboard/unidades').flush(unidadesBody);
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/unidades')).flush([{ id: 7, nome: 'Centro Operacional', sigla: 'CIS-01', descricao: null, codigoIbge: '2800308', ativo: true, createdAt: '', updatedAt: '' }]);
    httpTesting.expectOne((request) => request.url.endsWith('assets/maps/se-municipalities.geo.json')).flush({ type: 'FeatureCollection', features: [] });
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/equipamentos')).flush(extras.cadastro ?? pagina([cadastro]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/disponibilidade/unidades')).flush(pagina([{ unidadeId: 7, unidadeNome: 'Centro Operacional', inicio: '', fim: '', estadoAnalitico: 'CALCULADO', equipamentosTotal: 4, equipamentosMonitorados: 4, equipamentosSemMonitoramento: 0, equipamentosSemDados: 0, tempoMonitoradoSegundos: 100, tempoIndisponivelSegundos: 1, tempoDisponivelSegundos: 99, disponibilidadePercentual: 99.42, incidentes: 1 }]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/latencia/unidades')).flush(pagina([latenciaUnidade(23, 200)]));
    fixture.detectChanges();
  }

  /** Carga completa: quando o resumo aponta abertos, responde também às duas listas do banner (ABERTO e RECONHECIDO). */
  function responderCarga(fixture: ComponentFixture<DashboardComponent>, resumoBody = resumo, unidadesBody = [unidade], incidentesBody: unknown[] = [incidenteAberto], extras: Extras = {}) {
    responderCargaSemIncidentes(fixture, resumoBody, unidadesBody, extras);
    if (resumoBody.incidentes.abertos > 0) {
      httpTesting.expectOne((request) => request.url.endsWith('/api/v1/incidentes') && request.params.get('status') === 'ABERTO').flush(pagina(incidentesBody));
      httpTesting.expectOne((request) => request.url.endsWith('/api/v1/incidentes') && request.params.get('status') === 'RECONHECIDO').flush(pagina([]));
      fixture.detectChanges();
    }
  }

  /** Expande a primeira linha e responde ao carregamento sob demanda dos equipamentos. */
  function expandirPrimeira(fixture: ComponentFixture<DashboardComponent>) {
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.linha')?.click();
    fixture.detectChanges();
    httpTesting.expectOne((request) => request.url.includes('/dashboard/unidades/7/equipamentos')).flush(pagina([equipamento]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/disponibilidade/equipamentos')).flush(pagina([{ equipamentoId: 31, equipamentoNome: 'SW-CORE', unidadeId: 7, unidadeNome: 'Centro Operacional', monitorId: 1, monitorNome: 'ICMP', tipoMonitor: 'ICMP', inicio: '', fim: '', estadoAnalitico: 'CALCULADO', qualidadeJanela: 'PRECISA', tempoMonitoradoSegundos: 100, tempoIndisponivelSegundos: 0, tempoDisponivelSegundos: 100, disponibilidadePercentual: 99.93, incidentes: 0 }]));
    fixture.detectChanges();
  }

  it('mostra esqueleto de KPIs sem exibir zeros antes da resposta', () => {
    const fixture = create();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.kpi--carregando').length).toBe(9);
    responderCarga(fixture);
  });

  it('usa os contadores da API nos KPIs, incluindo equipamentos em manutenção', () => {
    const fixture = create();
    responderCarga(fixture);
    expect(texto(fixture)).toContain('EM MANUTENÇÃO');
    expect(texto(fixture)).toContain('DEGRADADOS');
    expect(texto(fixture)).toContain('acima de 250 ms');
    expect(texto(fixture)).toContain('ONLINE');
    expect(texto(fixture)).toContain('Centro Operacional');
  });

  it('KPI de manutenção usa o tom de manutenção (info), não o de degradado', () => {
    const fixture = create();
    responderCarga(fixture);
    const cartao = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.kpi')].find((kpi) => kpi.textContent?.includes('EM MANUTENÇÃO'))!;
    expect(cartao.classList).toContain('kpi--manutencao');
    expect(cartao.classList).not.toContain('kpi--warn');
  });

  it('manutenção tem segmento e contador próprios no tom info, separado do degradado', () => {
    const fixture = create();
    // Forma do Hotel Sesc Atalaia no dev: Disponível com 1 de 18 em manutenção e nenhum degradado.
    const atalaia = { ...unidade, status: UnitOperationalStatus.Available, equipamentosTotal: 18, equipamentosAtivos: 18, equipamentosDisponiveis: 17,
      equipamentosDegradados: 0, equipamentosIndisponiveis: 0, equipamentosSemDados: 0, equipamentosEmManutencao: 1, incidentesAbertos: 0 };
    responderCarga(fixture, { ...resumo, incidentes: { abertos: 0 } }, [atalaia]);
    const linha = (fixture.nativeElement as HTMLElement).querySelector('.unidade')!;
    expect((linha.querySelector('.faixa__warn') as HTMLElement).style.width).toBe('0%');
    expect((linha.querySelector('.faixa__info') as HTMLElement).style.width).toBe(`${(1 / 18) * 100}%`);
    expect(linha.querySelector('.contagens .warn')!.textContent!.trim()).toBe('0');
    expect(linha.querySelector('.contagens .info')!.textContent!.trim()).toBe('1');
  });

  it('preenche disponibilidade e latência global com o que os relatórios devolvem', () => {
    const fixture = create();
    responderCarga(fixture);
    // 99 s disponíveis de 100 s monitorados na única unidade do relatório.
    expect(texto(fixture)).toContain('99,00%');
    expect(texto(fixture)).toContain('janela de 30 dias');
    expect(texto(fixture)).toContain('ICMP · todas as unidades');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.kpi__vazio').length).toBe(0);
    expect((fixture.nativeElement as HTMLElement).querySelector('.kpi__unidade')?.textContent).toBe('ms');
  });

  it('isola a falha dos KPIs agregados sem derrubar o restante do painel', () => {
    const fixture = create();
    responderTipos();
    httpTesting.expectOne('http://localhost:8080/api/v1/dashboard/resumo').flush(resumo);
    httpTesting.expectOne('http://localhost:8080/api/v1/dashboard/unidades').flush([unidade]);
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/unidades')).flush([]);
    httpTesting.expectOne((request) => request.url.endsWith('assets/maps/se-municipalities.geo.json')).flush({ type: 'FeatureCollection', features: [] });
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/equipamentos')).flush(pagina([cadastro]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/disponibilidade/unidades')).error(new ProgressEvent('erro'), { status: 500, statusText: 'Internal Server Error' });
    httpTesting.expectOne((request) => request.url.includes('/relatorios/latencia/unidades')).error(new ProgressEvent('erro'), { status: 500, statusText: 'Internal Server Error' });
    // Sem o agregado por unidade o cliente ainda tenta o endpoint por monitor.
    httpTesting.expectOne((request) => request.url.includes('/relatorios/latencia') && !request.url.includes('/unidades')).error(new ProgressEvent('erro'), { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/incidentes') && request.params.get('status') === 'ABERTO').flush(pagina([incidenteAberto]));
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/incidentes') && request.params.get('status') === 'RECONHECIDO').flush(pagina([]));
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.kpi__vazio').length).toBe(2);
    // O resto do painel continua de pé: contadores do resumo e a linha da unidade.
    expect(texto(fixture)).toContain('EM MANUTENÇÃO');
    expect(texto(fixture)).toContain('Centro Operacional');
    expect(texto(fixture)).toContain('1 de 1 unidade');
  });

  it('usa o agregado por unidade do backend em vez de somar as linhas por monitor', () => {
    const fixture = create();
    responderCarga(fixture);
    // 23 ms vem pronto de /relatorios/latencia/unidades; nenhuma chamada por monitor é feita.
    expect(texto(fixture)).toContain('23 ms');
    httpTesting.verify({ ignoreCancelled: true });
  });

  it('mantém os filtros e as abas quando o índice de cadastro e o catálogo falham', () => {
    const fixture = create();
    responderTipos('erro');
    httpTesting.expectOne('http://localhost:8080/api/v1/dashboard/resumo').flush({ ...resumo, incidentes: { abertos: 0 } });
    httpTesting.expectOne('http://localhost:8080/api/v1/dashboard/unidades').flush([unidade]);
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/unidades')).flush([{ id: 7, nome: 'Centro Operacional', sigla: 'CIS-01', descricao: null, codigoIbge: '2800308', ativo: true, createdAt: '', updatedAt: '' }]);
    httpTesting.expectOne((request) => request.url.endsWith('assets/maps/se-municipalities.geo.json')).flush({ type: 'FeatureCollection', features: [] });
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/equipamentos')).error(new ProgressEvent('erro'), { status: 500, statusText: 'Internal Server Error' });
    httpTesting.expectOne((request) => request.url.includes('/relatorios/disponibilidade/unidades')).flush(pagina([]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/latencia/unidades')).flush(pagina([]));
    fixture.detectChanges();

    // Busca por identidade da unidade continua funcionando sem o índice.
    const busca = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.filtros__busca input')!;
    busca.value = 'CIS-01';
    busca.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(texto(fixture)).toContain('1 de 1 unidade');

    busca.value = '';
    busca.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    // As abas passam a sair dos equipamentos que o próprio painel carrega; sem índice não há contagem.
    expandirPrimeira(fixture);
    const abas = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.abas .aba')];
    expect(abas.map((aba) => aba.textContent?.trim())).toEqual(['Todos', 'Switch']);
    expect(abas.every((aba) => !aba.disabled)).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('.abas__parcial')).toBeNull();
  });

  it('busca por hostname direto do payload do painel, sem o índice de cadastro', () => {
    const fixture = create();
    responderCarga(fixture);
    expandirPrimeira(fixture);
    const busca = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.filtros__busca input')!;
    busca.value = 'sw-core.rede.local';
    busca.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(texto(fixture)).toContain('SW-CORE');
  });

  it('marca manutenção parcial ao lado do badge sem inventar status de unidade', () => {
    const fixture = create();
    responderCarga(fixture);
    const chip = (fixture.nativeElement as HTMLElement).querySelector('.chip-manutencao');
    expect(chip?.getAttribute('title')).toBe('1 equipamento em manutenção');
    expect(texto(fixture)).toContain('Degradada');
  });

  const atalaia = { ...unidade, id: 3, nome: 'Hotel Sesc Atalaia', status: UnitOperationalStatus.Available, equipamentosTotal: 18, equipamentosAtivos: 18,
    equipamentosDisponiveis: 17, equipamentosDegradados: 0, equipamentosIndisponiveis: 0, equipamentosSemDados: 0, equipamentosEmManutencao: 1, incidentesAbertos: 0 };

  it('barra, ícone e badge seguem unidade.status: disponível com manutenção parcial fica verde', () => {
    const fixture = create();
    responderCarga(fixture, { ...resumo, incidentes: { abertos: 0 } }, [atalaia]);
    const linha = (fixture.nativeElement as HTMLElement).querySelector('.unidade')!;
    expect(linha.classList).toContain('unidade--success');
    expect(linha.querySelector('.marca')!.classList).toContain('marca--success');
    expect(linha.querySelector('.marca app-icon')!.getAttribute('data-icone')).toBe('check');
    expect(linha.querySelector('app-status-badge')!.textContent).toContain('Disponível');
    expect(linha.querySelector('.chip-manutencao')!.textContent).toContain('1 em manutenção');
  });

  it.each([
    [UnitOperationalStatus.Degraded, 'warning'], [UnitOperationalStatus.Unavailable, 'danger'],
    [UnitOperationalStatus.NoData, 'muted'], [UnitOperationalStatus.NoEquipment, 'muted'], [UnitOperationalStatus.Maintenance, 'info'],
  ])('linha com status %s usa tom %s', (status, tom) => {
    const fixture = create();
    responderCarga(fixture, { ...resumo, incidentes: { abertos: 0 } }, [{ ...unidade, status, incidentesAbertos: 0 }]);
    const linha = (fixture.nativeElement as HTMLElement).querySelector('.unidade')!;
    expect(linha.classList).toContain(`unidade--${tom}`);
    expect(linha.querySelector('.marca')!.classList).toContain(`marca--${tom}`);
  });

  it('filtra pela pill de manutenção usando o status real da unidade', () => {
    const fixture = create();
    responderCarga(fixture, { ...resumo, incidentes: { abertos: 0 } }, [{ ...unidade, status: UnitOperationalStatus.Maintenance }]);
    const pills = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.pill')];
    pills[pills.length - 1].click();
    fixture.detectChanges();
    expect(texto(fixture)).toContain('1 de 1 unidade');
    expect(texto(fixture)).toContain('Em manutenção');
  });


  it('lê a disponibilidade da unidade direto do relatório, sem calcular no cliente', () => {
    const fixture = create();
    responderCarga(fixture);
    expect(texto(fixture)).toContain('99,42%');
  });

  it('descreve os incidentes abertos na segunda linha do banner de alerta', () => {
    const fixture = create();
    responderCarga(fixture);
    const detalhe = (fixture.nativeElement as HTMLElement).querySelector('.alerta__detalhe')?.textContent ?? '';
    expect(detalhe).toContain('SW-CORE no Centro Operacional offline há');
  });

  it('banner usa o KPI para o "+N" e descreve abertos e reconhecidos', () => {
    const fixture = create();
    const reconhecido = { ...incidenteAberto, id: 91, status: 'RECONHECIDO', iniciadoEm: '2026-08-19T11:50:00Z' };
    responderCargaSemIncidentes(fixture, { ...resumo, incidentes: { abertos: 7 } });
    httpTesting.expectOne((r) => r.url.endsWith('/api/v1/incidentes') && r.params.get('status') === 'ABERTO').flush(pagina([incidenteAberto]));
    httpTesting.expectOne((r) => r.url.endsWith('/api/v1/incidentes') && r.params.get('status') === 'RECONHECIDO').flush(pagina([reconhecido]));
    fixture.detectChanges();
    expect(texto(fixture)).toContain('+5 incidentes');
  });

  it('concorda o excedente do banner no singular (+1 incidente)', () => {
    const extra = (id: number) => ({ ...incidenteAberto, id });
    const um = create();
    responderCarga(um, { ...resumo, incidentes: { abertos: 4 } }, [unidade], [1, 2, 3, 4].map(extra));
    expect((um.nativeElement as HTMLElement).querySelector('.alerta__detalhe')?.textContent?.trim()).toMatch(/· [+]1 incidente$/);
  });

  it('não busca incidentes quando o resumo não aponta incidentes abertos', () => {
    const fixture = create();
    responderCarga(fixture, { ...resumo, incidentes: { abertos: 0 } });
    expect((fixture.nativeElement as HTMLElement).querySelector('.alerta__detalhe')).toBeNull();
  });

  it('mostra todos os tipos ativos do catálogo; sem equipamento na visão fica desabilitado com 0', () => {
    const fixture = create();
    responderCarga(fixture);
    const abas = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.abas .aba')];
    expect(abas.map((a) => a.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Todos 1', 'Câmera 0', 'Switch 1']);
    expect(abas[1].disabled).toBe(true);
    expect(abas[2].disabled).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('.abas__parcial')).toBeNull();
  });

  // O caso sem equipamento do tipo inativo está no teste acima: a lista exata de abas não traz 'Legado'.
  it('tipo inativo só aparece se houver equipamento dele', () => {
    const fixture = create();
    responderCarga(fixture, undefined, undefined, undefined, { cadastro: pagina([cadastro, { ...cadastro, id: 32, tipoEquipamento: { id: 9, nome: 'Legado' } }]) });
    expect(texto(fixture)).toContain('Legado');
  });

  it('índice parcial: abas sem contador, habilitadas, e aviso de parcial', () => {
    const fixture = create();
    responderCarga(fixture, undefined, undefined, undefined, { cadastro: { ...pagina([cadastro]), totalElements: 221, totalPages: 3, last: false } });
    const abas = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.abas .aba')];
    expect(abas.length).toBe(3);
    expect(abas.every((a) => !a.disabled)).toBe(true);
    expect(abas.some((a) => /\d/.test(a.textContent!))).toBe(false);
    expect(texto(fixture)).toContain('1 de 221');
  });

  it('contagem da aba acompanha a visão atual (busca)', () => {
    const fixture = create();
    responderCarga(fixture);
    const busca = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.filtros__busca input')!;
    busca.value = 'nada-casa'; busca.dispatchEvent(new Event('input')); fixture.detectChanges();
    const abas = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.abas .aba')];
    expect(abas.map((a) => a.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Todos 0', 'Câmera 0', 'Switch 0']);
    expect(abas[0].disabled).toBe(false);
  });

  it('aba selecionada continua clicável quando a visão zera a contagem', () => {
    const fixture = create();
    responderCarga(fixture);
    const switchAba = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.abas .aba')].find((a) => a.textContent!.includes('Switch'))!;
    switchAba().click(); fixture.detectChanges();
    const busca = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.filtros__busca input')!;
    busca.value = 'nada-casa'; busca.dispatchEvent(new Event('input')); fixture.detectChanges();
    expect(switchAba().disabled).toBe(false);
  });

  it('catálogo de tipos falhando cai para os tipos presentes no índice', () => {
    const fixture = create();
    responderCarga(fixture, undefined, undefined, undefined, { tipos: 'erro' });
    expect(texto(fixture)).toContain('Switch');
    expect(texto(fixture)).not.toContain('Câmera');
  });

  it('carrega os equipamentos da unidade somente ao expandir a linha', () => {
    const fixture = create();
    responderCarga(fixture);
    expandirPrimeira(fixture);
    expect(texto(fixture)).toContain('SW-CORE');
    expect(texto(fixture)).toContain('10.0.0.1');
    expect(texto(fixture)).toContain('99,93%');
  });

  it('filtra por tipo em memória, sem refazer requisições', () => {
    const fixture = create();
    responderCarga(fixture);
    expandirPrimeira(fixture);

    const abas = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.abas .aba');
    abas[abas.length - 1].click();
    fixture.detectChanges();

    httpTesting.verify({ ignoreCancelled: true });
    expect(texto(fixture)).toContain('SW-CORE');
  });

  it('busca por hostname pelo índice de cadastro em unidade ainda não expandida', () => {
    const fixture = create();
    responderCarga(fixture);
    const busca = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.filtros__busca input')!;
    busca.value = 'sw-core.rede.local';
    busca.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(texto(fixture)).toContain('1 de 1 unidade');

    busca.value = 'inexistente';
    busca.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(texto(fixture)).toContain('0 de 1 unidade');
  });

  it('reaproveita o cache ao recolher e expandir a mesma unidade', () => {
    const fixture = create();
    responderCarga(fixture);
    expandirPrimeira(fixture);

    const linha = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.linha')!;
    linha.click();
    fixture.detectChanges();
    linha.click();
    fixture.detectChanges();

    httpTesting.verify({ ignoreCancelled: true });
    expect(texto(fixture)).toContain('SW-CORE');
  });

  it('mostra o estado vazio quando a API não retorna unidades', () => {
    const fixture = create();
    responderCarga(fixture, resumo, []);
    expect(texto(fixture)).toContain('Nenhuma unidade para exibir.');
  });

  it('preserva a mensagem de erro da API no resumo', () => {
    const fixture = create();
    responderTipos();
    httpTesting.expectOne('http://localhost:8080/api/v1/dashboard/resumo').flush({ timestamp: '2026-08-19T12:00:00Z', status: 500, error: 'Internal Server Error', code: 'INTERNAL_ERROR', message: 'Falha no resumo', path: '/api/v1/dashboard/resumo' }, { status: 500, statusText: 'Internal Server Error' });
    httpTesting.expectOne('http://localhost:8080/api/v1/dashboard/unidades').flush([]);
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/unidades')).flush([]);
    httpTesting.expectOne((request) => request.url.endsWith('assets/maps/se-municipalities.geo.json')).flush({ type: 'FeatureCollection', features: [] });
    httpTesting.expectOne((request) => request.url.endsWith('/api/v1/equipamentos')).flush(pagina([]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/disponibilidade/unidades')).flush(pagina([]));
    httpTesting.expectOne((request) => request.url.includes('/relatorios/latencia/unidades')).flush(pagina([]));
    fixture.detectChanges();
    expect(texto(fixture)).toContain('Falha no resumo');
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DashboardResumo } from '../models/dashboard';
import { DashboardStateService } from './dashboard-state.service';

const resumo = (disponiveis: number) => ({
  unidades: { total: 1 },
  equipamentos: { total: 4, ativos: 4, disponiveis, degradados: 0, indisponiveis: 0, semDados: 0, semMonitoramento: 0, emManutencao: 0 },
  monitores: { total: 4, ativos: 4, disponiveis: 4, degradados: 0, indisponiveis: 0, semDados: 0 },
  incidentes: { abertos: 0 }, limiarLatenciaDegradadaMs: 250, geradoEm: '2026-08-19T12:00:00Z',
}) as unknown as DashboardResumo;

describe('DashboardStateService', () => {
  let service: DashboardStateService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(DashboardStateService);
    http = TestBed.inject(HttpTestingController);
    service.carregarResumoSeNecessario();
    http.expectOne('/api/v1/dashboard/resumo').flush(resumo(2));
  });
  afterEach(() => http.verify());

  it('atualizar() continua pondo resumoState em loading (uso manual)', () => {
    service.atualizar();
    expect(service.resumoState()).toBe('loading');
    http.expectOne('/api/v1/dashboard/resumo').flush(resumo(3));
    expect(service.resumoState()).toBe('success');
  });

  it('atualizarSilencioso() mantém success durante o voo e troca o resumo na resposta', () => {
    service.atualizarSilencioso();
    expect(service.resumoState()).toBe('success');
    expect(service.resumo()?.equipamentos.disponiveis).toBe(2);
    http.expectOne('/api/v1/dashboard/resumo').flush(resumo(3));
    expect(service.resumoState()).toBe('success');
    expect(service.resumo()?.equipamentos.disponiveis).toBe(3);
    expect(service.falhaSilenciosa()).toBe(false);
  });

  it('atualizarSilencioso() em erro mantém o resumo antigo e marca falhaSilenciosa; sucesso seguinte limpa', () => {
    service.atualizarSilencioso();
    http.expectOne('/api/v1/dashboard/resumo').flush(null, { status: 502, statusText: 'Bad Gateway' });
    expect(service.resumoState()).toBe('success');
    expect(service.resumo()?.equipamentos.disponiveis).toBe(2);
    expect(service.falhaSilenciosa()).toBe(true);
    service.atualizarSilencioso();
    http.expectOne('/api/v1/dashboard/resumo').flush(resumo(4));
    expect(service.falhaSilenciosa()).toBe(false);
  });

  it('atualizarSilencioso() rebusca unidades sem loading quando já carregadas e mantém em erro', () => {
    service.carregarUnidadesSeNecessario();
    http.expectOne('/api/v1/dashboard/unidades').flush([{ id: 1 }]);
    service.atualizarSilencioso();
    expect(service.unidadesState()).toBe('success');
    http.expectOne('/api/v1/dashboard/resumo').flush(resumo(2));
    http.expectOne('/api/v1/dashboard/unidades').flush(null, { status: 0, statusText: 'x' });
    expect(service.unidadesState()).toBe('success');
    expect(service.unidades().length).toBe(1);
    expect(service.falhaSilenciosa()).toBe(true);
  });
});

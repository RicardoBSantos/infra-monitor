import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EquipmentOperationalStatus } from '../../../core/models/api-enums';
import { DashboardEquipamento } from '../../../core/models/dashboard';
import { EquipamentosTabComponent } from './equipamentos-tab.component';
import { IncidentesTabComponent } from './incidentes-tab.component';
import { VisaoGeralComponent } from './visao-geral.component';
import { UnidadeDetalheStore } from './unidade-detalhe.store';

function equipamento(parcial: Partial<DashboardEquipamento> & { id: number; nome: string }): DashboardEquipamento {
  return {
    ip: '10.0.0.1', hostname: `${parcial.nome.toLowerCase()}.rede.local`, localizacao: null, ativo: true,
    status: 'DISPONIVEL', tipoEquipamento: { id: 1, nome: 'Switch' }, emManutencao: false,
    monitoresAtivos: 1, incidentesAbertos: 0,
    ultimaMedicao: { status: 'SUCESSO', latenciaMs: 10, executadoEm: new Date().toISOString() },
    ...parcial,
  } as DashboardEquipamento;
}

const pagina = <T,>(content: T[]) => ({ content, page: 0, size: content.length, totalElements: content.length, totalPages: 1, first: true, last: true });

const incidenteAberto = {
  id: 192, status: 'ABERTO', iniciadoEm: new Date(Date.now() - 12 * 60 * 1000).toISOString(), encerradoEm: null,
  motivo: 'Equipamento offline', observacao: null, createdAt: '', updatedAt: '',
  monitor: { id: 1, nome: 'ICMP', tipo: 'ICMP', equipamentoId: 31, equipamentoNome: 'SW-CORE', unidadeId: 7, unidadeNome: 'Centro' },
};

describe('Abas do detalhe da unidade', () => {
  let httpTesting: HttpTestingController;
  let store: UnidadeDetalheStore;

  async function configurar() {
    await TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), UnidadeDetalheStore],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
    store = TestBed.inject(UnidadeDetalheStore);
    store.id.set(7);
    store.equipamentosEstado.set('success');
  }

  afterEach(() => { httpTesting.verify({ ignoreCancelled: true }); });

  const texto = (fixture: ComponentFixture<unknown>) => (fixture.nativeElement as HTMLElement).textContent ?? '';

  describe('Visão geral', () => {
    function criar() {
      const fixture = TestBed.createComponent(VisaoGeralComponent);
      fixture.detectChanges();
      return fixture;
    }

    it('ordena por latência decrescente e marca o offline como timeout de barra cheia', async () => {
      await configurar();
      store.equipamentos.set([
        equipamento({ id: 1, nome: 'AP-ADMIN', ultimaMedicao: { status: 'SUCESSO', latenciaMs: 7, executadoEm: '' } }),
        equipamento({ id: 2, nome: 'LINK-WAN', ultimaMedicao: { status: 'SUCESSO', latenciaMs: 13, executadoEm: '' } }),
        equipamento({ id: 3, nome: 'SW-CORE', status: EquipmentOperationalStatus.Unavailable, ultimaMedicao: null }),
      ]);
      const fixture = criar();
      httpTesting.expectOne((request) => request.url.includes('/incidentes')).flush(pagina([]));
      fixture.detectChanges();

      const nomes = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.latencias__nome')].map((e) => e.textContent?.trim());
      expect(nomes).toEqual(['SW-CORE', 'LINK-WAN', 'AP-ADMIN']);
      expect(texto(fixture)).toContain('timeout');
      const barraOffline = (fixture.nativeElement as HTMLElement).querySelector('.barra--down i') as HTMLElement;
      expect(barraOffline.style.width).toBe('100%');
    });

    it('agrega equipamentos por tipo em ordem decrescente de contagem', async () => {
      await configurar();
      store.equipamentos.set([
        equipamento({ id: 1, nome: 'A', tipoEquipamento: { id: 1, nome: 'Access Point' } }),
        equipamento({ id: 2, nome: 'B', tipoEquipamento: { id: 1, nome: 'Access Point' } }),
        equipamento({ id: 3, nome: 'C', tipoEquipamento: { id: 2, nome: 'Switch' } }),
      ]);
      const fixture = criar();
      httpTesting.expectOne((request) => request.url.includes('/incidentes')).flush(pagina([]));
      fixture.detectChanges();

      const tipos = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.tipos__nome')].map((e) => e.textContent?.trim());
      expect(tipos).toEqual(['Access Point', 'Switch']);
    });

    it('mostra estado vazio próprio quando não há incidentes', async () => {
      await configurar();
      store.equipamentos.set([equipamento({ id: 1, nome: 'A' })]);
      const fixture = criar();
      httpTesting.expectOne((request) => request.url.includes('/incidentes')).flush(pagina([]));
      fixture.detectChanges();

      expect(texto(fixture)).toContain('Nenhum incidente registrado nesta unidade.');
    });
  });

  describe('Equipamentos', () => {
    async function criar() {
      await configurar();
      store.equipamentos.set([
        equipamento({ id: 1, nome: 'AP-ADMIN', tipoEquipamento: { id: 1, nome: 'Access Point' } }),
        equipamento({ id: 2, nome: 'SW-CORE', status: EquipmentOperationalStatus.Unavailable, ultimaMedicao: null, tipoEquipamento: { id: 2, nome: 'Switch' } }),
      ]);
      const fixture = TestBed.createComponent(EquipamentosTabComponent);
      fixture.detectChanges();
      return fixture;
    }

    it('usa selects estilizados, não o <select> nativo sem tratamento', async () => {
      const fixture = await criar();
      const selects = (fixture.nativeElement as HTMLElement).querySelectorAll('select');
      expect(selects.length).toBe(2);
      for (const select of [...selects]) {
        expect(select.closest('.campo-select')).not.toBeNull();
      }
    });

    it('filtra em memória por busca sem disparar nova requisição', async () => {
      const fixture = await criar();
      const busca = (fixture.nativeElement as HTMLElement).querySelector('.campo-busca') as HTMLInputElement;
      busca.value = 'sw-core';
      busca.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(texto(fixture)).toContain('1 de 2 dispositivos');
      expect(texto(fixture)).not.toContain('AP-ADMIN');
      httpTesting.expectNone(() => true);
    });

    it('distingue vazio por filtro de vazio por ausência de cadastro', async () => {
      const fixture = await criar();
      const busca = (fixture.nativeElement as HTMLElement).querySelector('.campo-busca') as HTMLInputElement;
      busca.value = 'inexistente';
      busca.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(texto(fixture)).toContain('Nenhum dispositivo corresponde aos filtros.');

      store.equipamentos.set([]);
      fixture.detectChanges();
      expect(texto(fixture)).toContain('Nenhum equipamento cadastrado nesta unidade.');
    });

    it('exibe hostname e marca o offline como timeout', async () => {
      const fixture = await criar();
      expect(texto(fixture)).toContain('ap-admin.rede.local');
      expect(texto(fixture)).toContain('timeout');
    });
  });

  describe('Incidentes', () => {
    async function criar() {
      await configurar();
      const fixture = TestBed.createComponent(IncidentesTabComponent);
      fixture.detectChanges();
      return fixture;
    }

    it('deriva a duração no cliente para incidente ainda aberto', async () => {
      const fixture = await criar();
      httpTesting.expectOne((request) => request.url.includes('/incidentes')).flush(pagina([incidenteAberto]));
      fixture.detectChanges();

      expect(texto(fixture)).toContain('#192');
      expect(texto(fixture)).toContain('SW-CORE');
      expect(texto(fixture)).toContain('12 min');
    });

    it('deriva a duração de fim menos início quando o incidente já fechou', async () => {
      const fixture = await criar();
      httpTesting.expectOne((request) => request.url.includes('/incidentes')).flush(pagina([{
        ...incidenteAberto, status: 'FECHADO',
        iniciadoEm: '2026-08-14T08:00:00Z', encerradoEm: '2026-08-14T10:30:00Z',
      }]));
      fixture.detectChanges();

      expect(texto(fixture)).toContain('2 h 30 min');
    });

    it('oferece nova tentativa isolada quando a carga falha', async () => {
      const fixture = await criar();
      httpTesting.expectOne((request) => request.url.includes('/incidentes'))
        .error(new ProgressEvent('erro'), { status: 500, statusText: 'Internal Server Error' });
      fixture.detectChanges();

      expect(texto(fixture)).toContain('Não foi possível carregar os incidentes.');
      expect(texto(fixture)).toContain('Tentar novamente');
    });
  });
});

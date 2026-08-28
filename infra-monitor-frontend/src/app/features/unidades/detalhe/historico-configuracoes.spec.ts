import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { UnitOperationalStatus } from '../../../core/models/api-enums';
import { ConfiguracoesTabComponent } from './configuracoes-tab.component';
import { HistoricoTabComponent } from './historico-tab.component';
import { UnidadeDetalheStore } from './unidade-detalhe.store';

const cadastro = {
  id: 7, nome: 'Centro Operacional', sigla: 'CIS-01', descricao: null, codigoIbge: '2800308', ativo: true,
  createdAt: '', updatedAt: '', endereco: null, cidade: 'Aracaju', uf: 'SE', latitude: null, longitude: null,
};
const detalhe = {
  id: 7, nome: 'Centro Operacional', codigoIbge: '2800308', ativo: true, status: UnitOperationalStatus.Degraded,
  equipamentos: { total: 24, ativos: 24, disponiveis: 23, degradados: 0, indisponiveis: 1, semDados: 0, semMonitoramento: 0, emManutencao: 0 },
  monitores: { ativos: 24, indisponiveis: 1 }, incidentesAbertos: 1,
};

const DIARIA = 'http://localhost:8080/api/v1/relatorios/disponibilidade/unidades/7/diaria';

describe('Abas Histórico e Configurações', () => {
  let httpTesting: HttpTestingController;
  let store: UnidadeDetalheStore;

  async function configurar() {
    await TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), UnidadeDetalheStore],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
    store = TestBed.inject(UnidadeDetalheStore);
    store.id.set(7);
    store.cadastro.set(cadastro);
    store.unidade.set(detalhe);
    store.estado.set('success');
  }

  afterEach(() => { httpTesting.verify({ ignoreCancelled: true }); });

  const texto = (fixture: ComponentFixture<unknown>) => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const raiz = (fixture: ComponentFixture<unknown>) => fixture.nativeElement as HTMLElement;

  describe('Histórico', () => {
    async function criar() {
      await configurar();
      const fixture = TestBed.createComponent(HistoricoTabComponent);
      fixture.detectChanges();
      return fixture;
    }

    it('desenha uma barra por dia medido e trunca o eixo declarando o piso', async () => {
      const fixture = await criar();
      httpTesting.expectOne(DIARIA).flush([
        { data: '2026-08-24', disponibilidadePercentual: 99.42, tempoMonitoradoSegundos: 86400 },
        { data: '2026-08-25', disponibilidadePercentual: 100, tempoMonitoradoSegundos: 86400 },
        { data: '2026-08-26', disponibilidadePercentual: 99.87, tempoMonitoradoSegundos: 86400 },
      ]);
      fixture.detectChanges();

      expect(raiz(fixture).querySelectorAll('.grafico__barra').length).toBe(3);
      expect(texto(fixture)).toContain('eixo truncado em 98,00%');
      // Piso 98: o dia de 100% ocupa a barra inteira, o de 99,42% fica bem abaixo.
      const alturas = [...raiz(fixture).querySelectorAll('.grafico__barra')].map((b) => (b as HTMLElement).style.height);
      expect(alturas[1]).toBe('100%');
      expect(parseFloat(alturas[0])).toBeLessThan(80);
    });

    it('não transforma dia sem monitoramento em barra zero', async () => {
      const fixture = await criar();
      httpTesting.expectOne(DIARIA).flush([
        { data: '2026-08-24', disponibilidadePercentual: 100, tempoMonitoradoSegundos: 86400 },
        { data: '2026-08-25', disponibilidadePercentual: null, tempoMonitoradoSegundos: null },
      ]);
      fixture.detectChanges();

      expect(raiz(fixture).querySelectorAll('.grafico__barra').length).toBe(1);
    });

    it('marca o dia parcial com hachura e explica no tooltip', async () => {
      const fixture = await criar();
      httpTesting.expectOne(DIARIA).flush([
        { data: '2026-08-26', disponibilidadePercentual: 100, tempoMonitoradoSegundos: 86400 },
        { data: '2026-08-27', disponibilidadePercentual: 100, tempoMonitoradoSegundos: 50053 },
      ]);
      fixture.detectChanges();

      const parciais = raiz(fixture).querySelectorAll('.grafico__barra--parcial');
      expect(parciais.length).toBe(1);
      const colunas = raiz(fixture).querySelectorAll('.grafico__coluna');
      expect(colunas[1].getAttribute('title')).toContain('dia parcial');
      expect(colunas[1].getAttribute('title')).toContain('27/08');
    });

    it('detecta dia parcial em unidade multi-monitor, onde o dia cheio passa de 86400 s', async () => {
      const fixture = await criar();
      // 16 monitores: dia cheio soma 1.382.400 s. Comparar com 86400 nunca marcaria parcial.
      httpTesting.expectOne(DIARIA).flush([
        { data: '2026-08-26', disponibilidadePercentual: 100, tempoMonitoradoSegundos: 1382400 },
        { data: '2026-08-27', disponibilidadePercentual: 100, tempoMonitoradoSegundos: 1382400 },
        { data: '2026-08-28', disponibilidadePercentual: 100, tempoMonitoradoSegundos: 475345 },
      ]);
      fixture.detectChanges();

      expect(raiz(fixture).querySelectorAll('.grafico__barra--parcial').length).toBe(1);
      const colunas = raiz(fixture).querySelectorAll('.grafico__coluna');
      expect(colunas[2].getAttribute('title')).toContain('dia parcial (34% do dia monitorado)');
      expect(colunas[1].getAttribute('title')).not.toContain('parcial');
    });

    it('não desloca a data por fuso ao formatar o rótulo do eixo', async () => {
      const fixture = await criar();
      httpTesting.expectOne(DIARIA).flush([
        { data: '2026-08-24', disponibilidadePercentual: 100, tempoMonitoradoSegundos: 86400 },
      ]);
      fixture.detectChanges();

      expect(raiz(fixture).querySelector('.grafico__coluna')?.getAttribute('title')).toContain('24/08');
      expect(texto(fixture)).toContain('24/08');
    });

    it('aplica a faixa de cor conforme os limiares', async () => {
      const fixture = await criar();
      httpTesting.expectOne(DIARIA).flush([
        { data: '2026-08-24', disponibilidadePercentual: 99.5, tempoMonitoradoSegundos: 86400 },
        { data: '2026-08-25', disponibilidadePercentual: 97, tempoMonitoradoSegundos: 86400 },
        { data: '2026-08-26', disponibilidadePercentual: 80, tempoMonitoradoSegundos: 86400 },
      ]);
      fixture.detectChanges();

      expect(raiz(fixture).querySelectorAll('.grafico__barra--ok').length).toBe(1);
      expect(raiz(fixture).querySelectorAll('.grafico__barra--warn').length).toBe(1);
      expect(raiz(fixture).querySelectorAll('.grafico__barra--down').length).toBe(1);
    });

    it('mostra estado vazio próprio quando não há dia monitorado', async () => {
      const fixture = await criar();
      httpTesting.expectOne(DIARIA).flush([]);
      fixture.detectChanges();

      expect(texto(fixture)).toContain('Nenhum dia monitorado nos últimos 30 dias.');
      expect(texto(fixture)).not.toContain('eixo truncado');
    });

    it('oferece nova tentativa isolada quando a carga falha', async () => {
      const fixture = await criar();
      httpTesting.expectOne(DIARIA).error(new ProgressEvent('erro'), { status: 500, statusText: 'Internal Server Error' });
      fixture.detectChanges();

      expect(texto(fixture)).toContain('Não foi possível carregar o histórico.');
    });
  });

  describe('Configurações', () => {
    async function criar() {
      await configurar();
      const fixture = TestBed.createComponent(ConfiguracoesTabComponent);
      fixture.detectChanges();
      return fixture;
    }

    function clicar(fixture: ComponentFixture<unknown>, rotulo: string) {
      const botao = [...raiz(fixture).querySelectorAll('button')]
        .find((elemento) => elemento.textContent?.trim().startsWith(rotulo)) as HTMLButtonElement;
      botao.click();
      fixture.detectChanges();
    }

    it('lista o cadastro em leitura e usa travessão para campo nulo', async () => {
      const fixture = await criar();
      const linhas = [...raiz(fixture).querySelectorAll('.cadastro__linha')]
        .map((linha) => linha.textContent?.replace(/\s+/g, ' ').trim());

      expect(linhas).toEqual([
        'NomeCentro Operacional', 'Código internoCIS-01', 'Endereço—', 'CidadeAracaju',
        'UFSE', 'Latitude—', 'Longitude—', 'Descrição—', 'Ativasim',
      ]);
      expect(raiz(fixture).querySelector('form')).toBeNull();
    });

    it('usa a contagem real de dispositivos na zona de risco', async () => {
      const fixture = await criar();
      expect(texto(fixture)).toContain('24 dispositivos');
    });

    it('exige confirmação nomeando a unidade antes de desativar', async () => {
      const fixture = await criar();
      clicar(fixture, 'Desativar unidade');

      expect(texto(fixture)).toContain('Desativar Centro Operacional?');
      expect(texto(fixture)).toContain('interrompe o monitoramento ICMP dos 24 dispositivos');
      expect(texto(fixture)).toContain('alertas do Telegram');
      expect(texto(fixture)).toContain('histórico é preservado');
    });

    it('informa a quantidade de equipamentos vinculados ao confirmar exclusão', async () => {
      const fixture = await criar();
      clicar(fixture, 'Excluir unidade');

      expect(texto(fixture)).toContain('Excluir Centro Operacional?');
      expect(texto(fixture)).toContain('24 dispositivos vinculados');
    });

    it('exibe a mensagem real da API quando a exclusão é recusada', async () => {
      const fixture = await criar();
      clicar(fixture, 'Excluir unidade');
      const confirmar = [...raiz(fixture).querySelectorAll('.confirm-dialog button')]
        .find((b) => b.textContent?.includes('Excluir unidade')) as HTMLButtonElement;
      confirmar.click();

      httpTesting.expectOne('http://localhost:8080/api/v1/unidades/7').flush(
        { timestamp: '', status: 409, error: 'Conflict', code: 'BUSINESS_CONFLICT', message: 'Nao e possivel excluir a unidade porque existem equipamentos associados', path: '' },
        { status: 409, statusText: 'Conflict' });
      fixture.detectChanges();

      expect(texto(fixture)).toContain('Nao e possivel excluir a unidade porque existem equipamentos associados');
      // O diálogo permanece aberto com o erro, em vez de fechar silenciosamente.
      expect(raiz(fixture).querySelector('.confirm-dialog')).not.toBeNull();
    });

    it('navega para a lista após excluir com sucesso', async () => {
      const fixture = await criar();
      const router = TestBed.inject(Router);
      const navegou = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      clicar(fixture, 'Excluir unidade');
      const confirmar = [...raiz(fixture).querySelectorAll('.confirm-dialog button')]
        .find((b) => b.textContent?.includes('Excluir unidade')) as HTMLButtonElement;
      confirmar.click();

      httpTesting.expectOne('http://localhost:8080/api/v1/unidades/7').flush(null);
      fixture.detectChanges();

      expect(navegou).toHaveBeenCalledWith(['/unidades']);
    });

    it('permanece na página e recarrega o estado após desativar', async () => {
      const fixture = await criar();
      clicar(fixture, 'Desativar unidade');
      const confirmar = [...raiz(fixture).querySelectorAll('.confirm-dialog button')]
        .find((b) => b.textContent?.includes('Desativar unidade')) as HTMLButtonElement;
      confirmar.click();

      httpTesting.expectOne('http://localhost:8080/api/v1/unidades/7/desativar').flush({ ...cadastro, ativo: false });
      fixture.detectChanges();

      expect(texto(fixture)).toContain('Unidade desativada.');
      // recarregar() refaz as chamadas do detalhe.
      httpTesting.expectOne((r) => r.url.endsWith('/dashboard/unidades/7')).flush(detalhe);
      httpTesting.expectOne((r) => r.url.endsWith('/api/v1/unidades/7')).flush({ ...cadastro, ativo: false });
      httpTesting.expectOne((r) => r.url.includes('/dashboard/unidades/7/equipamentos')).flush({ content: [], page: 0, size: 0, totalElements: 0, totalPages: 0, first: true, last: true });
      for (const trecho of ['/relatorios/disponibilidade/unidades', '/relatorios/latencia/unidades', '/relatorios/disponibilidade/equipamentos']) {
        httpTesting.expectOne((r) => r.url.includes(trecho)).flush({ content: [], page: 0, size: 0, totalElements: 0, totalPages: 0, first: true, last: true });
      }
      fixture.detectChanges();

      expect(texto(fixture)).toContain('Ativar unidade');
      expect(texto(fixture)).toContain('está inativa');
    });

    it('reativa sem pedir confirmação', async () => {
      await configurar();
      store.cadastro.set({ ...cadastro, ativo: false });
      const fixture = TestBed.createComponent(ConfiguracoesTabComponent);
      fixture.detectChanges();

      clicar(fixture, 'Ativar unidade');

      // Nenhum diálogo: a chamada sai direto.
      expect(raiz(fixture).querySelector('.confirm-dialog')).toBeNull();
      httpTesting.expectOne('http://localhost:8080/api/v1/unidades/7/ativar').flush(cadastro);
      fixture.detectChanges();

      httpTesting.expectOne((r) => r.url.endsWith('/dashboard/unidades/7')).flush(detalhe);
      httpTesting.expectOne((r) => r.url.endsWith('/api/v1/unidades/7')).flush(cadastro);
      httpTesting.expectOne((r) => r.url.includes('/dashboard/unidades/7/equipamentos')).flush({ content: [], page: 0, size: 0, totalElements: 0, totalPages: 0, first: true, last: true });
      for (const trecho of ['/relatorios/disponibilidade/unidades', '/relatorios/latencia/unidades', '/relatorios/disponibilidade/equipamentos']) {
        httpTesting.expectOne((r) => r.url.includes(trecho)).flush({ content: [], page: 0, size: 0, totalElements: 0, totalPages: 0, first: true, last: true });
      }
    });
  });
});

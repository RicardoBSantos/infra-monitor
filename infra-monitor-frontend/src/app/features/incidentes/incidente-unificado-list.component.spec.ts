import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { IncidentStatus } from '../../core/models/api-enums';
import { AuthStateService } from '../../core/services/auth-state.service';
import { IncidenteUnificadoListComponent } from './incidente-unificado-list.component';

import { DashboardIncidenteResponse, IncidentKind, IncidentSeverity } from '../../core/models/dashboard-incidente';

const linhaIncidente: DashboardIncidenteResponse = {
  tipo: IncidentKind.Incident, severidade: IncidentSeverity.High,  id: 1, status: IncidentStatus.Open,
  iniciadoEm: '2026-09-01T08:00:00Z', encerradoEm: null, motivo: 'Falhas consecutivas', limiarMs: null,
  reconhecidoEm: null, reconhecidoPorNome: null,
  monitorId: 1, monitorNome: 'ICMP CORE', equipamentoId: 31, equipamentoNome: 'SW-CORE', unidadeId: 7, unidadeNome: 'Centro',
  notificacaoCanal: 'TELEGRAM', notificacaoStatus: 'ENVIADA', notificacaoEnviadoEm: '2026-09-01T08:00:05Z',
};
// Mesmo id 1 do incidente: a colisão entre as duas sequências é o cenário, não um acidente.
const linhaLatencia: DashboardIncidenteResponse = {
  ...linhaIncidente, tipo: IncidentKind.Latency, id: 1, severidade: IncidentSeverity.Medium, motivo: null, limiarMs: 250,
  monitorNome: 'ICMP WAN', equipamentoNome: 'LINK-WAN',
};
const contadores = { abertos: 2, reconhecidos: 1, resolvidos: 4, todos: 7 };
const pagina = <T,>(content: T[]) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1, first: true, last: true });

describe('IncidenteUnificadoListComponent', () => {
  let fixture: ComponentFixture<IncidenteUnificadoListComponent>; let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    TestBed.inject(AuthStateService).setSession({
      accessToken: 'token', tokenType: 'Bearer', expiresIn: 60,
      usuario: { id: 1, nome: 'Operador', email: 'op@example.test', papel: 'OPERADOR', trocaSenhaObrigatoria: false },
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(IncidenteUnificadoListComponent);
    fixture.detectChanges();
    http.expectOne(requisicao => requisicao.url.endsWith('/unidades')).flush([{ id: 7, nome: 'Centro', sigla: 'CTR', ativo: true }]);
  });

  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });

  /** O `<app-date-range>` emite o período em ngOnInit; é ele que dispara a primeira carga. */
  function responderCargaInicial(linhas = [linhaIncidente, linhaLatencia]): void {
    http.expectOne(requisicao => requisicao.url.endsWith('/dashboard/incidentes')).flush(pagina(linhas));
    http.expectOne(requisicao => requisicao.url.endsWith('/dashboard/incidentes/contadores')).flush(contadores);
    fixture.detectChanges();
  }

  function botoes(rotulo: string): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .filter(candidato => candidato.textContent?.trim().startsWith(rotulo));
  }

  it('carrega a primeira página já com o período do date-range e a aba Abertos', () => {
    const requisicao = http.expectOne(candidato => candidato.url.endsWith('/dashboard/incidentes'));
    expect(requisicao.request.params.get('status')).toBe('ABERTO');
    expect(requisicao.request.params.get('inicio')).toBeTruthy();
    expect(requisicao.request.params.get('fim')).toBeTruthy();
    requisicao.flush(pagina([linhaIncidente]));
    http.expectOne(candidato => candidato.url.endsWith('/dashboard/incidentes/contadores')).flush(contadores);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('SW-CORE');
  });

  it('mostra as duas origens na mesma lista sem colapsar os ids que colidem', () => {
    responderCargaInicial();
    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('INC-1');
    expect(texto).toContain('LAT-1');
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(2);
  });

  /**
   * A severidade é barra colorida, como no mockup, e não um segundo badge disputando a
   * leitura com STATUS. A cor sozinha não pode carregar a informação: o rótulo operacional
   * continua acessível pelo aria-label.
   */
  it('marca a severidade de cada linha com a barra colorida e o rótulo acessível', () => {
    responderCargaInicial();

    const barras = Array.from(fixture.nativeElement.querySelectorAll('.severidade')) as HTMLElement[];
    expect(barras.length).toBe(2);
    expect(barras[0].classList.contains('severidade--alta')).toBe(true);
    expect(barras[0].getAttribute('aria-label')).toBe('Crítico');
    expect(barras[1].classList.contains('severidade--alta')).toBe(false);
    expect(barras[1].getAttribute('aria-label')).toBe('Alerta');
  });

  /**
   * EVENTO sai do discriminador, não do `motivo`: o motivo do incidente automático é uma
   * frase inteira ("Indisponibilidade detectada automaticamente apos 3 falhas...") e não
   * cabe numa célula. O texto exibido é o mesmo do título da gaveta, por construção.
   */
  it('rotula o evento pela origem da linha, com o mesmo vocabulário da gaveta', () => {
    responderCargaInicial();
    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Indisponibilidade consolidada');
    expect(texto).toContain('Latência acima do limiar');
    // MONITOR saiu da tabela: ele só aparece no "Contexto operacional" da gaveta.
    expect(texto).not.toContain('ICMP CORE');
  });

  /** Ocorrência encerrada conta até o fim registrado; em curso, até agora. */
  it('mostra a duração da ocorrência encerrada e marca a que ainda está em curso', () => {
    responderCargaInicial([
      { ...linhaIncidente, encerradoEm: '2026-09-01T09:30:00Z' },
      linhaLatencia,
    ]);

    const celulas = Array.from(fixture.nativeElement.querySelectorAll('tbody tr')) as HTMLElement[];
    expect(celulas[0].children[6].textContent?.trim()).toBe('1 h 30 min');
    expect(celulas[0].children[6].classList.contains('duracao--em-curso')).toBe(false);
    // A linha de latência não tem `encerradoEm`: a duração cresce e só a marcação é estável.
    expect(celulas[1].children[6].classList.contains('duracao--em-curso')).toBe(true);
  });

  /**
   * A coluna NOTIFICADO vem da própria linha — o backend já resolve a última notificação
   * da âncora certa. Nenhuma requisição por linha pode aparecer: `http.verify()` no
   * afterEach falharia se a tela pedisse /notificacoes para compor a coluna.
   */
  it('compõe NOTIFICADO com canal e status da linha, e recua para "—" sem notificação', () => {
    responderCargaInicial([
      linhaIncidente,
      { ...linhaLatencia, notificacaoCanal: null, notificacaoStatus: null, notificacaoEnviadoEm: null },
    ]);

    const linhas = Array.from(fixture.nativeElement.querySelectorAll('tbody tr')) as HTMLElement[];
    expect(linhas[0].children[7].textContent).toContain('TELEGRAM');
    expect(linhas[0].children[7].textContent).toContain('Enviada');
    expect(linhas[1].children[7].textContent?.trim()).toBe('—');
  });

  /** Status fora do enum é dado corrompido, não badge sem rótulo. */
  it('recua para "—" quando o status da notificação não pertence ao domínio', () => {
    responderCargaInicial([{ ...linhaIncidente, notificacaoStatus: 'DESCONHECIDO' }]);
    const linha = fixture.nativeElement.querySelector('tbody tr') as HTMLElement;
    expect(linha.children[7].textContent?.trim()).toBe('—');
  });

  it('troca o filtro de status ao mudar de aba, sem recarregar os contadores', () => {
    responderCargaInicial();

    botoes('Resolvidos')[0].click();
    fixture.detectChanges();

    const requisicao = http.expectOne(candidato => candidato.url.endsWith('/dashboard/incidentes'));
    expect(requisicao.request.params.get('status')).toBe('FECHADO');
    requisicao.flush(pagina([]));
    // Nenhuma chamada de contadores: eles ignoram o status de propósito.
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nenhuma ocorrência');
  });

  it('recarrega lista e contadores quando um filtro fora da aba muda', () => {
    responderCargaInicial();

    const seletor = fixture.nativeElement.querySelectorAll('select')[1] as HTMLSelectElement;
    seletor.value = 'MEDIA';
    seletor.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const lista = http.expectOne(candidato => candidato.url.endsWith('/dashboard/incidentes'));
    expect(lista.request.params.get('severidade')).toBe('MEDIA');
    lista.flush(pagina([linhaLatencia]));
    http.expectOne(candidato => candidato.url.endsWith('/dashboard/incidentes/contadores')).flush(contadores);
    fixture.detectChanges();
  });

  /** Reconhecer só existe para incidente: episódio de latência fecha sozinho. */
  it('oferece Reconhecer na linha de incidente e nunca na de latência', () => {
    responderCargaInicial();
    expect(botoes('Reconhecer').length).toBe(1);

    botoes('Reconhecer')[0].click();
    fixture.detectChanges();

    const requisicao = http.expectOne('http://localhost:8080/api/v1/incidentes/1/reconhecer');
    expect(requisicao.request.method).toBe('PATCH');
    requisicao.flush({});

    // Reconhecer muda a contagem das abas, então lista e contadores voltam juntos.
    http.expectOne(candidato => candidato.url.endsWith('/dashboard/incidentes')).flush(pagina([linhaIncidente]));
    http.expectOne(candidato => candidato.url.endsWith('/dashboard/incidentes/contadores')).flush(contadores);
    fixture.detectChanges();
  });

  it('não oferece Reconhecer para um incidente que já foi reconhecido', () => {
    responderCargaInicial([{ ...linhaIncidente, status: IncidentStatus.Acknowledged, reconhecidoPorNome: 'Ricardo' }]);
    expect(botoes('Reconhecer').length).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('Ricardo');
  });

  it('navega para destinos diferentes conforme a origem da linha', () => {
    responderCargaInicial();
    const router = TestBed.inject(Router);
    const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    botoes('Ver')[0].click();
    expect(navegar).toHaveBeenCalledWith(['/incidentes', 1]);

    botoes('Ver')[1].click();
    expect(navegar).toHaveBeenCalledWith(['/incidentes', 'latencia', 1]);
  });

  it('mantém a tabela quando os contadores falham', () => {
    http.expectOne(candidato => candidato.url.endsWith('/dashboard/incidentes')).flush(pagina([linhaIncidente]));
    http.expectOne(candidato => candidato.url.endsWith('/dashboard/incidentes/contadores'))
      .flush({ message: 'erro' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('SW-CORE');
  });
});

/**
 * As rotas de detalhe são filhas desta tela e não têm componente próprio: existem só para
 * carregar `:id` e `tipo`. Duas coisas dependem disso e são o que estes testes cobrem — a
 * gaveta abrir na origem certa apesar da colisão de ids, e a lista NÃO ser recriada ao
 * abrir o detalhe, que é o que preserva filtros, aba e página.
 */
describe('IncidenteUnificadoListComponent · rotas de detalhe', () => {
  let harness: RouterTestingHarness; let http: HttpTestingController;

  const rotas = [{
    path: 'incidentes',
    component: IncidenteUnificadoListComponent,
    children: [
      { path: 'latencia/:id', children: [], data: { tipo: IncidentKind.Latency } },
      { path: ':id', children: [], data: { tipo: IncidentKind.Incident } },
      { path: '', children: [] },
    ],
  }];

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(rotas)] });
    TestBed.inject(AuthStateService).setSession({
      accessToken: 'token', tokenType: 'Bearer', expiresIn: 60,
      usuario: { id: 1, nome: 'Operador', email: 'op@example.test', papel: 'OPERADOR', trocaSenhaObrigatoria: false },
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create('/incidentes');
    http.expectOne(requisicao => requisicao.url.endsWith('/unidades')).flush([{ id: 7, nome: 'Centro', sigla: 'CTR', ativo: true }]);
    http.expectOne(requisicao => requisicao.url.endsWith('/dashboard/incidentes')).flush(pagina([linhaIncidente, linhaLatencia]));
    http.expectOne(requisicao => requisicao.url.endsWith('/dashboard/incidentes/contadores')).flush(contadores);
    harness.detectChanges();
  });

  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });

  /** Os três blocos de composição da gaveta, que carregam depois da ocorrência. */
  function responderBlocosDaGaveta(monitorId: number): void {
    http.expectOne(requisicao => requisicao.url.endsWith('/relatorios/medicoes')).flush(pagina([]));
    http.expectOne(requisicao => requisicao.url.endsWith(`/monitores/${monitorId}`))
      .flush({ id: monitorId, nome: 'ICMP', tipo: 'ICMP', intervaloSegundos: 30, timeoutMs: 1000, falhasParaIncidente: 3, sucessosParaRecovery: 2, ativo: true, equipamento: { id: 31, nome: 'SW-CORE' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
    http.expectOne(requisicao => requisicao.url.endsWith('/notificacoes')).flush(pagina([]));
    harness.detectChanges();
  }

  it('abre a gaveta como INCIDENTE em /incidentes/:id', async () => {
    await harness.navigateByUrl('/incidentes/1');
    harness.detectChanges();

    http.expectOne('http://localhost:8080/api/v1/incidentes/1').flush({
      id: 1, status: IncidentStatus.Open, iniciadoEm: '2026-09-01T08:00:30Z', encerradoEm: null,
      motivo: 'Falhas consecutivas', observacao: null, reconhecidoEm: null, reconhecidoPorNome: null,
      monitor: { id: 1, nome: 'ICMP CORE', tipo: 'ICMP', equipamentoId: 31, equipamentoNome: 'SW-CORE', unidadeId: 7, unidadeNome: 'Centro' },
      createdAt: '2026-09-01T08:01:30Z', updatedAt: '2026-09-01T08:01:30Z',
    });
    responderBlocosDaGaveta(1);

    expect(harness.routeNativeElement?.textContent).toContain('INC-1');
  });

  it('abre a gaveta como LATENCIA em /incidentes/latencia/:id, para o mesmo id', async () => {
    await harness.navigateByUrl('/incidentes/latencia/1');
    harness.detectChanges();

    http.expectOne('http://localhost:8080/api/v1/episodios-latencia/1').flush({
      id: 1, monitorId: 2, monitorNome: 'ICMP WAN', equipamentoId: 44, equipamentoNome: 'LINK-WAN',
      unidadeId: 7, unidadeNome: 'Centro',
      iniciadoEm: '2026-09-01T09:00:00Z', encerradoEm: null, limiarMs: 250,
    });
    responderBlocosDaGaveta(2);

    expect(harness.routeNativeElement?.textContent).toContain('LAT-1');
  });

  /**
   * Regressão evitada: com as rotas de detalhe como irmãs, e não filhas, o Router trocaria
   * de configuração e recriaria a lista — a carga inicial rodaria de novo e período, aba e
   * página voltariam ao padrão a cada clique em "Ver".
   */
  it('não recarrega a lista ao abrir o detalhe: a instância do componente sobrevive', async () => {
    const antes = harness.routeDebugElement?.componentInstance;

    await harness.navigateByUrl('/incidentes/1');
    harness.detectChanges();
    http.expectOne('http://localhost:8080/api/v1/incidentes/1')
      .flush({ message: 'x' }, { status: 500, statusText: 'Server Error' });
    harness.detectChanges();

    // Nenhuma chamada nova de unidades, lista ou contadores: `http.verify()` no afterEach
    // falharia se a lista tivesse sido remontada.
    expect(harness.routeDebugElement?.componentInstance).toBe(antes);
  });
});

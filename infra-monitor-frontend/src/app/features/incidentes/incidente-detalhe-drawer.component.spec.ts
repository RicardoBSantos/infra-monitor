import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { IncidentClosureReason, IncidentStatus, MeasurementStatus, MonitorType } from '../../core/models/api-enums';
import { IncidentKind } from '../../core/models/dashboard-incidente';
import { AuthStateService } from '../../core/services/auth-state.service';
import { IncidenteDetalheDrawerComponent } from './incidente-detalhe-drawer.component';

const incidente = {
  id: 5, status: IncidentStatus.Open,
  iniciadoEm: '2026-09-01T08:00:30Z', encerradoEm: null,
  motivo: 'Falhas consecutivas', observacao: null,
  reconhecidoEm: null, reconhecidoPorNome: null,
  monitor: { id: 1, nome: 'ICMP CORE', tipo: MonitorType.Icmp, equipamentoId: 31, equipamentoNome: 'SW-CORE', unidadeId: 7, unidadeNome: 'Centro' },
  createdAt: '2026-09-01T08:01:30Z', updatedAt: '2026-09-01T08:01:30Z',
};

// Mesmo id 5 do incidente: a colisão entre as duas sequências é o cenário, não um acidente.
const episodio = {
  id: 5, monitorId: 2, monitorNome: 'ICMP WAN',
  equipamentoId: 44, equipamentoNome: 'LINK-WAN', unidadeId: 7, unidadeNome: 'Centro',
  iniciadoEm: '2026-09-01T09:00:00Z', encerradoEm: '2026-09-01T09:02:00Z', limiarMs: 250, ciclosParaEpisodio: 2,
};

const monitor = {
  id: 1, nome: 'ICMP CORE', tipo: MonitorType.Icmp, intervaloSegundos: 30, timeoutMs: 1000,
  falhasParaIncidente: 3, sucessosParaRecovery: 2, ativo: true,
  equipamento: { id: 31, nome: 'SW-CORE' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

const medicoes = [1, 2, 3].map((indice) => ({
  medicaoId: indice, unidadeId: 7, unidadeNome: 'Centro', equipamentoId: 31, equipamentoNome: 'SW-CORE',
  monitorId: 1, monitorNome: 'ICMP CORE', tipoMonitor: 'ICMP',
  status: MeasurementStatus.Failure, latenciaMs: null,
  executadoEm: `2026-09-01T08:0${indice - 1}:30Z`,
}));

const pagina = <T,>(content: T[]) => ({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1, first: true, last: true });

describe('IncidenteDetalheDrawerComponent', () => {
  let fixture: ComponentFixture<IncidenteDetalheDrawerComponent>; let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    TestBed.inject(AuthStateService).setSession({
      accessToken: 'token', tokenType: 'Bearer', expiresIn: 60,
      usuario: { id: 1, nome: 'Operador', email: 'op@example.test', papel: 'OPERADOR', trocaSenhaObrigatoria: false },
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(IncidenteDetalheDrawerComponent);
  });

  afterEach(() => { http.verify(); TestBed.resetTestingModule(); });

  function montar(tipo: IncidentKind, id: number): void {
    fixture.componentRef.setInput('tipo', tipo);
    fixture.componentRef.setInput('ocorrenciaId', id);
    fixture.detectChanges();
  }

  /** Os três blocos de composição: cada um carrega e falha por conta própria. */
  function responderBlocos(): void {
    http.expectOne(requisicao => requisicao.url.endsWith('/relatorios/medicoes')).flush(pagina(medicoes));
    http.expectOne(requisicao => requisicao.url.endsWith('/monitores/1')).flush(monitor);
    http.expectOne(requisicao => requisicao.url.endsWith('/notificacoes')).flush(pagina([]));
    fixture.detectChanges();
  }

  function botoes(rotulo: string): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .filter(candidato => candidato.textContent?.trim().startsWith(rotulo));
  }

  it('busca o incidente na origem de incidente e monta a timeline com o N do monitor', () => {
    montar(IncidentKind.Incident, 5);
    http.expectOne('http://localhost:8080/api/v1/incidentes/5').flush(incidente);
    responderBlocos();

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('INC-5');
    expect(texto).toContain('Falha ICMP — tentativa 1/3');
    expect(texto).toContain('SW-CORE');
  });

  it('busca o episódio na origem de latência para o mesmo id', () => {
    montar(IncidentKind.Latency, 5);
    http.expectOne('http://localhost:8080/api/v1/episodios-latencia/5').flush(episodio);
    http.expectOne(requisicao => requisicao.url.endsWith('/relatorios/medicoes')).flush(pagina([]));
    http.expectOne(requisicao => requisicao.url.endsWith('/monitores/2')).flush({ ...monitor, id: 2 });
    http.expectOne(requisicao => requisicao.url.endsWith('/notificacoes')).flush(pagina([]));
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('LAT-5');
    expect(texto).toContain('Latência acima do limiar');
  });

  /** Episódio fecha sozinho quando a latência normaliza: não há o que reconhecer ou resolver. */
  it('não oferece ação nenhuma na gaveta de latência', () => {
    montar(IncidentKind.Latency, 5);
    http.expectOne('http://localhost:8080/api/v1/episodios-latencia/5').flush(episodio);
    http.expectOne(requisicao => requisicao.url.endsWith('/relatorios/medicoes')).flush(pagina([]));
    http.expectOne(requisicao => requisicao.url.endsWith('/monitores/2')).flush({ ...monitor, id: 2 });
    http.expectOne(requisicao => requisicao.url.endsWith('/notificacoes')).flush(pagina([]));
    fixture.detectChanges();

    expect(botoes('Reconhecer').length).toBe(0);
    expect(botoes('Marcar como resolvido').length).toBe(0);
  });

  it('fecha o incidente pelo diálogo de confirmação e avisa a lista', () => {
    const mudou = vi.fn();
    fixture.componentInstance.mudou.subscribe(mudou);
    montar(IncidentKind.Incident, 5);
    http.expectOne('http://localhost:8080/api/v1/incidentes/5').flush(incidente);
    responderBlocos();

    botoes('Marcar como resolvido')[0].click();
    fixture.detectChanges();
    // A confirmação é do ConfirmDialog compartilhado, não de um modal próprio da gaveta.
    botoes('Marcar como resolvido')[1].click();
    fixture.detectChanges();

    const requisicao = http.expectOne('http://localhost:8080/api/v1/incidentes/5/fechar');
    expect(requisicao.request.method).toBe('PATCH');
    requisicao.flush({ ...incidente, status: IncidentStatus.Closed, encerradoEm: '2026-09-01T08:10:00Z' });
    fixture.detectChanges();

    expect(mudou).toHaveBeenCalled();
    expect(botoes('Marcar como resolvido').length).toBe(0);
  });

  /** Reconhecer não encerra nada: continua aberto e ainda pode ser resolvido. */
  it('mantém a ação de resolver depois de reconhecer', () => {
    montar(IncidentKind.Incident, 5);
    http.expectOne('http://localhost:8080/api/v1/incidentes/5').flush(incidente);
    responderBlocos();

    botoes('Reconhecer')[0].click();
    fixture.detectChanges();
    http.expectOne('http://localhost:8080/api/v1/incidentes/5/reconhecer')
      .flush({ ...incidente, status: IncidentStatus.Acknowledged, reconhecidoEm: '2026-09-01T08:05:00Z', reconhecidoPorNome: 'Ricardo' });
    fixture.detectChanges();

    expect(botoes('Reconhecer').length).toBe(0);
    expect(botoes('Marcar como resolvido').length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Ricardo');
  });

  it('mantém a gaveta de pé quando um bloco de composição cai', () => {
    montar(IncidentKind.Incident, 5);
    http.expectOne('http://localhost:8080/api/v1/incidentes/5').flush(incidente);
    http.expectOne(requisicao => requisicao.url.endsWith('/relatorios/medicoes'))
      .flush({ message: 'erro' }, { status: 500, statusText: 'Server Error' });
    http.expectOne(requisicao => requisicao.url.endsWith('/monitores/1')).flush(monitor);
    http.expectOne(requisicao => requisicao.url.endsWith('/notificacoes')).flush(pagina([]));
    fixture.detectChanges();

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('INC-5');
    expect(texto).toContain('os eventos de ping estão de fora');
  });

  /** Card de KPI pelo rótulo: a ordem muda entre incidente e episódio, o rótulo não. */
  function kpi(rotulo: string): HTMLElement {
    const cartoes = Array.from(fixture.nativeElement.querySelectorAll('.kpi')) as HTMLElement[];
    const alvo = cartoes.find(cartao => cartao.querySelector('.kpi__rotulo')?.textContent?.trim() === rotulo);
    if (!alvo) throw new Error(`KPI "${rotulo}" não está na gaveta`);
    return alvo;
  }

  const valorDo = (rotulo: string) => kpi(rotulo).querySelector('.kpi__valor')?.textContent?.trim();

  /**
   * Medições fora do ar não são "zero falhas em zero amostras": é contagem desconhecida.
   * Escrever 0 ali afirmaria uma janela limpa que ninguém mediu — e ainda pintaria de
   * tom de alerta num número inventado.
   */
  it('mostra "indisponível" em vez de zero nos KPIs de medição quando o bloco cai — incidente', () => {
    montar(IncidentKind.Incident, 5);
    http.expectOne('http://localhost:8080/api/v1/incidentes/5').flush(incidente);
    http.expectOne(requisicao => requisicao.url.endsWith('/relatorios/medicoes'))
      .flush({ message: 'erro' }, { status: 500, statusText: 'Server Error' });
    http.expectOne(requisicao => requisicao.url.endsWith('/monitores/1')).flush(monitor);
    http.expectOne(requisicao => requisicao.url.endsWith('/notificacoes')).flush(pagina([]));
    fixture.detectChanges();

    expect(valorDo('Falhas na janela')).toBe('indisponível');
    expect(valorDo('Latência média')).toBe('indisponível');
    expect(valorDo('Amostras')).toBe('indisponível');
    // O mesmo dado aparece no cartão da janela: lá também não pode virar zero.
    expect(fixture.nativeElement.textContent).toContain('Amostras na janela');
    expect(fixture.nativeElement.querySelectorAll('.kpi__falha').length).toBeGreaterThanOrEqual(4);
    // Contagem desconhecida não recebe cor: o vermelho de "Falhas" identifica a métrica,
    // mas não pode ficar sozinho em cima de um valor que não existe.
    expect(kpi('Falhas na janela').className).not.toContain('kpi--down');
  });

  it('mostra "indisponível" em vez de zero nos KPIs de medição quando o bloco cai — latência', () => {
    montar(IncidentKind.Latency, 5);
    http.expectOne('http://localhost:8080/api/v1/episodios-latencia/5').flush(episodio);
    http.expectOne(requisicao => requisicao.url.endsWith('/relatorios/medicoes'))
      .flush({ message: 'erro' }, { status: 500, statusText: 'Server Error' });
    http.expectOne(requisicao => requisicao.url.endsWith('/monitores/2')).flush({ ...monitor, id: 2 });
    http.expectOne(requisicao => requisicao.url.endsWith('/notificacoes')).flush(pagina([]));
    fixture.detectChanges();

    expect(valorDo('Pico')).toBe('indisponível');
    expect(valorDo('Latência média')).toBe('indisponível');
    expect(valorDo('Acima do limiar')).toBe('indisponível');
    expect(valorDo('Amostras')).toBe('indisponível');
    expect(kpi('Pico').className).not.toContain('kpi--down');
    expect(kpi('Acima do limiar').className).not.toContain('kpi--warn');
    // O limiar não vem de medição: continua âmbar mesmo com o bloco fora do ar.
    expect(kpi('Limiar').className).toContain('kpi--warn');
  });

  /**
   * Zero medido é fato, mas não é alerta: fica neutro, como a contagem ausente. O tom só
   * aparece quando o valor passa de zero.
   */
  it('pinta de vermelho as falhas na janela quando há ao menos uma', () => {
    montar(IncidentKind.Incident, 5);
    http.expectOne('http://localhost:8080/api/v1/incidentes/5').flush(incidente);
    responderBlocos();

    expect(valorDo('Falhas na janela')).toBe('3');
    expect(kpi('Falhas na janela').className).toContain('kpi--down');
  });

  it('não pinta "Acima do limiar" com zero medições acima do limiar', () => {
    montar(IncidentKind.Latency, 5);
    http.expectOne('http://localhost:8080/api/v1/episodios-latencia/5').flush(episodio);
    http.expectOne(requisicao => requisicao.url.endsWith('/relatorios/medicoes')).flush(pagina([
      { ...medicoes[0], status: MeasurementStatus.Success, latenciaMs: 100, executadoEm: '2026-09-01T09:00:30Z' },
    ]));
    http.expectOne(requisicao => requisicao.url.endsWith('/monitores/2')).flush({ ...monitor, id: 2 });
    http.expectOne(requisicao => requisicao.url.endsWith('/notificacoes')).flush(pagina([]));
    fixture.detectChanges();

    expect(valorDo('Acima do limiar')).toBe('0');
    expect(kpi('Acima do limiar').className).not.toContain('kpi--warn');
  });

  it('não pinta o pico de latência de 0 ms (RTT sub-ms gravado como zero)', () => {
    montar(IncidentKind.Latency, 5);
    http.expectOne('http://localhost:8080/api/v1/episodios-latencia/5').flush(episodio);
    http.expectOne(requisicao => requisicao.url.endsWith('/relatorios/medicoes')).flush(pagina([
      { ...medicoes[0], status: MeasurementStatus.Success, latenciaMs: 0, executadoEm: '2026-09-01T09:00:30Z' },
    ]));
    http.expectOne(requisicao => requisicao.url.endsWith('/monitores/2')).flush({ ...monitor, id: 2 });
    http.expectOne(requisicao => requisicao.url.endsWith('/notificacoes')).flush(pagina([]));
    fixture.detectChanges();

    expect(kpi('Pico').className).not.toContain('kpi--down');
  });

  it('não pinta a contagem zero de falhas', () => {
    montar(IncidentKind.Incident, 5);
    http.expectOne('http://localhost:8080/api/v1/incidentes/5').flush(incidente);
    http.expectOne(requisicao => requisicao.url.endsWith('/relatorios/medicoes')).flush(pagina([]));
    http.expectOne(requisicao => requisicao.url.endsWith('/monitores/1')).flush(monitor);
    http.expectOne(requisicao => requisicao.url.endsWith('/notificacoes')).flush(pagina([]));
    fixture.detectChanges();

    expect(valorDo('Falhas na janela')).toBe('0');
    expect(kpi('Falhas na janela').className).not.toContain('kpi--down');
  });

  it('escala a cor do Status e marca a duração de ocorrência em curso', () => {
    montar(IncidentKind.Incident, 5);
    http.expectOne('http://localhost:8080/api/v1/incidentes/5').flush(incidente);
    responderBlocos();

    expect(kpi('Status').className).toContain('kpi--down');
    expect(kpi('Duração').querySelector('.kpi__valor--em-curso')).not.toBeNull();

    botoes('Reconhecer')[0].click();
    fixture.detectChanges();
    http.expectOne('http://localhost:8080/api/v1/incidentes/5/reconhecer')
      .flush({ ...incidente, status: IncidentStatus.Acknowledged, reconhecidoEm: '2026-09-01T08:05:00Z', reconhecidoPorNome: 'Ricardo' });
    fixture.detectChanges();

    expect(kpi('Status').className).toContain('kpi--warn');
  });

  /** Latência é leitura de referência, não alarme: azul fixo, igual à gaveta de equipamento. */
  it('pinta a latência média de azul quando há medição', () => {
    montar(IncidentKind.Latency, 5);
    http.expectOne('http://localhost:8080/api/v1/episodios-latencia/5').flush(episodio);
    http.expectOne(requisicao => requisicao.url.endsWith('/relatorios/medicoes')).flush(pagina([
      { ...medicoes[0], status: MeasurementStatus.Success, latenciaMs: 300, executadoEm: '2026-09-01T09:00:30Z' },
      { ...medicoes[1], status: MeasurementStatus.Success, latenciaMs: 500, executadoEm: '2026-09-01T09:01:30Z' },
    ]));
    http.expectOne(requisicao => requisicao.url.endsWith('/monitores/2')).flush({ ...monitor, id: 2 });
    http.expectOne(requisicao => requisicao.url.endsWith('/notificacoes')).flush(pagina([]));
    fixture.detectChanges();

    expect(valorDo('Latência média')).toBe('400ms');
    expect(kpi('Latência média').className).toContain('kpi--info');
    expect(kpi('Pico').className).toContain('kpi--down');
    expect(valorDo('Acima do limiar')).toBe('2');
    expect(kpi('Acima do limiar').className).toContain('kpi--warn');
  });

  /**
   * A gaveta não pode afirmar um fechamento que não aconteceu. `encerradoEm` nulo é o
   * único sinal confiável de "em curso" — `tipo === Incident` sozinho não basta, porque
   * também é verdadeiro para um incidente aberto.
   */
  it('não afirma quem encerrou nem o motivo quando o incidente está aberto', () => {
    montar(IncidentKind.Incident, 5);
    http.expectOne('http://localhost:8080/api/v1/incidentes/5').flush(incidente);
    responderBlocos();

    const texto = fixture.nativeElement.textContent;
    expect(texto).not.toContain('Encerrado por');
    expect(texto).not.toContain('Motivo do encerramento');
  });

  it('mostra o motivo de manutenção quando o incidente foi fechado pela entrada em manutenção', () => {
    montar(IncidentKind.Incident, 5);
    http.expectOne('http://localhost:8080/api/v1/incidentes/5').flush({
      ...incidente, status: IncidentStatus.Closed, encerradoEm: '2026-09-01T08:10:00Z',
      fechadoPorNome: null, motivoEncerramento: IncidentClosureReason.Maintenance,
    });
    responderBlocos();

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Entrada em manutenção');
  });

  it('atribui ao motor de monitoramento só quando o motivo registrado é recuperação automática', () => {
    montar(IncidentKind.Incident, 5);
    http.expectOne('http://localhost:8080/api/v1/incidentes/5').flush({
      ...incidente, status: IncidentStatus.Closed, encerradoEm: '2026-09-01T08:10:00Z',
      fechadoPorNome: null, motivoEncerramento: IncidentClosureReason.AutomaticRecovery,
    });
    responderBlocos();

    const texto = fixture.nativeElement.textContent;
    expect(texto).toContain('Motor de monitoramento');
  });

  /**
   * Incidente legado: fechado antes da V17/V19, sem autor e sem motivo registrados.
   * `'Motor de monitoramento'` seria uma inferência apresentada como fato — o traço é
   * a leitura honesta de "não sabemos".
   */
  it('mostra travessão para incidente legado fechado sem autor e sem motivo', () => {
    montar(IncidentKind.Incident, 5);
    http.expectOne('http://localhost:8080/api/v1/incidentes/5').flush({
      ...incidente, status: IncidentStatus.Closed, encerradoEm: '2026-09-01T08:10:00Z',
      fechadoPorNome: null, motivoEncerramento: null,
    });
    responderBlocos();

    const linhaEncerradoPor = Array.from(fixture.nativeElement.querySelectorAll('dt') as NodeListOf<HTMLElement>)
      .find(dt => dt.textContent?.trim() === 'Encerrado por');
    expect(linhaEncerradoPor?.nextElementSibling?.textContent?.trim()).toBe('—');
  });

  it('trata id inexistente como ocorrência não encontrada, sem derrubar a tela', () => {
    montar(IncidentKind.Incident, 999);
    http.expectOne('http://localhost:8080/api/v1/incidentes/999')
      // Corpo completo de propósito: `isApiError` exige o `ErroResposta` inteiro, e um
      // payload parcial cairia no ramo de erro genérico em vez do de não encontrado.
      .flush({
        timestamp: '2026-09-01T08:00:00Z', status: 404, error: 'Not Found',
        code: 'RESOURCE_NOT_FOUND', message: 'Incidente não encontrado', path: '/api/v1/incidentes/999',
      }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Ocorrência não encontrada');
  });
});

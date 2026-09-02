import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EquipmentOperationalStatus } from '../../core/models/api-enums';
import { AuthStateService } from '../../core/services/auth-state.service';

import { EquipamentoResponse } from '../../core/models/equipamento';
import { MonitorResponse } from '../../core/models/monitor';
import { EquipamentoDetalheDrawerComponent } from './equipamento-detalhe-drawer.component';

const CADASTRO: EquipamentoResponse = {
  id: 1, nome: 'SW-CORE', ip: '10.79.10.1', hostname: 'sw-core-cis-01', descricao: 'Switch de núcleo',
  localizacao: 'Rack 1 / U4', numeroSerie: 'SN45796587', fabricante: 'Cisco', modelo: 'Catalyst 9200-24T',
  ativo: true, emManutencao: false, unidade: { id: 3, nome: 'Centro Integrado de Saúde' },
  tipoEquipamento: { id: 2, nome: 'Switch' }, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

function monitor(overrides: Partial<MonitorResponse> & { id: number }): MonitorResponse {
  return {
    nome: `ICMP ${overrides.id}`, tipo: 'ICMP', intervaloSegundos: 30, timeoutMs: 1200,
    falhasParaIncidente: 3, sucessosParaRecovery: 2, ativo: true,
    equipamento: { id: 1, nome: 'SW-CORE' }, createdAt: '', updatedAt: '',
    ...overrides,
  } as MonitorResponse;
}

function medicao(minuto: number, status: 'SUCESSO' | 'FALHA', latenciaMs: number | null) {
  return {
    medicaoId: minuto, unidadeId: 3, unidadeNome: 'Centro Integrado de Saúde', equipamentoId: 1,
    equipamentoNome: 'SW-CORE', monitorId: 10, monitorNome: 'ICMP 10', tipoMonitor: 'ICMP',
    status, latenciaMs, executadoEm: `2026-08-31T08:${String(minuto).padStart(2, '0')}:00Z`,
  };
}

const pagina = <T,>(content: T[]) => ({ content, page: 0, size: content.length, totalElements: content.length, totalPages: 1, first: true, last: true });

describe('EquipamentoDetalheDrawerComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EquipamentoDetalheDrawerComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthStateService).setSession({
      accessToken: 'test', tokenType: 'Bearer', expiresIn: 60,
      usuario: { id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN', trocaSenhaObrigatoria: false },
    });
  });

  afterEach(() => http.verify({ ignoreCancelled: true }));

  function montar(): ComponentFixture<EquipamentoDetalheDrawerComponent> {
    const fixture = TestBed.createComponent(EquipamentoDetalheDrawerComponent);
    fixture.componentRef.setInput('equipamentoId', 1);
    // A lista sempre passa a linha junto; é dela que vem o status operacional.
    fixture.componentRef.setInput('linha', { id: 1, nome: 'SW-CORE', tipoNome: 'Switch', unidadeId: 3, unidadeNome: 'Centro Integrado de Saúde', hostname: 'sw-core-cis-01', ip: '10.79.10.1', status: EquipmentOperationalStatus.Unavailable, latenciaMs: null, ativo: true, localizacao: 'Rack 1 / U4', numeroSerie: 'SN45796587' });
    fixture.detectChanges();
    return fixture;
  }

  function texto(fixture: ComponentFixture<EquipamentoDetalheDrawerComponent>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  /** Responde às seis chamadas de composição; cada uma pode ser trocada por um erro. */
  const MEDICOES_PADRAO = [
    medicao(18, 'SUCESSO', 4), medicao(19, 'SUCESSO', 6), medicao(20, 'FALHA', null), medicao(21, 'FALHA', null),
  ];

  function responder(
    fixture: ComponentFixture<EquipamentoDetalheDrawerComponent>,
    falhas: string[] = [],
    monitores = [monitor({ id: 10 })],
    medicoes = MEDICOES_PADRAO,
    disponibilidade: object[] = [{ equipamentoId: 1, disponibilidadePercentual: 97.17, incidentes: 1 }],
    latencia: object[] = [{ equipamentoId: 1, avgLatenciaMs: 4 }],
  ) {
    const responderOu = (url: string, corpo: object) => {
      const requisicao = http.expectOne((request) => request.url.includes(url));
      if (falhas.includes(url)) requisicao.flush({ message: 'falhou' }, { status: 500, statusText: 'Server Error' });
      else requisicao.flush(corpo);
    };

    http.match((request) => request.url.includes('/dashboard/resumo'))
      .forEach((request) => request.flush({ limiarLatenciaDegradadaMs: 250 }));
    responderOu('/api/v1/equipamentos/1', CADASTRO);
    responderOu('/relatorios/disponibilidade/equipamentos', pagina(disponibilidade));
    responderOu('/relatorios/latencia', pagina(latencia));
    responderOu('/relatorios/medicoes', pagina(medicoes));
    responderOu('/monitores', pagina(monitores));
    responderOu('/incidentes', pagina([{ id: 192, status: 'ABERTO', iniciadoEm: '2026-08-31T08:44:00Z', motivo: 'Equipamento offline', encerradoEm: null, observacao: null, monitor: { id: 10, nome: 'ICMP 10', tipo: 'ICMP', equipamentoId: 1, equipamentoNome: 'SW-CORE', unidadeId: 3, unidadeNome: 'Centro Integrado de Saúde' }, createdAt: '', updatedAt: '' }]));
    fixture.detectChanges();
  }

  it('deriva perda de pacotes, falhas consecutivas e último sucesso da mesma janela de medições', () => {
    const fixture = montar();
    responder(fixture);

    // 2 FALHA em 4 medições, ambas na cauda: 50% de perda e 2 falhas consecutivas de 3.
    expect(texto(fixture)).toContain('50,00%');
    expect(texto(fixture)).toContain('2 / 3');
    expect(texto(fixture)).toContain('2 timeouts');
    expect(fixture.componentInstance['ultimoSucesso']()).toBe('2026-08-31T08:19:00Z');

    // Uma única chamada de medições alimentou tudo acima.
    http.expectNone((request) => request.url.includes('/relatorios/medicoes'));
  });

  it('mostra fabricante e modelo no cartão de inventário', () => {
    const fixture = montar();
    responder(fixture);

    expect(texto(fixture)).toContain('Cisco');
    expect(texto(fixture)).toContain('Catalyst 9200-24T');
  });

  it('rotula o limite de latência como global, não como configuração do monitor', () => {
    const fixture = montar();
    responder(fixture);

    expect(texto(fixture)).toContain('Limite global de latência');
    expect(texto(fixture)).toContain('250 ms');
  });

  it('mostra o monitoramento como chip de leitura, sem controle que dispare a ação', () => {
    const fixture = montar();
    responder(fixture, [], [monitor({ id: 10, ativo: true })]);
    const elemento = fixture.nativeElement as HTMLElement;

    expect(elemento.querySelector('.chip-monitoramento')!.textContent!.trim()).toBe('Ativado');
    expect(elemento.querySelector('.chip-monitoramento--off')).toBeNull();
    // Ativar e desativar tem efeito no ICMP: só o botão do rodapé, que confirma antes.
    expect(elemento.querySelector('.gaveta__corpo input[type=checkbox]')).toBeNull();
    expect(elemento.querySelector('.gaveta__corpo button[role=switch]')).toBeNull();
  });

  it('reflete o monitor desativado no mesmo chip', () => {
    const fixture = montar();
    responder(fixture, [], [monitor({ id: 10, ativo: false })]);

    const chip = (fixture.nativeElement as HTMLElement).querySelector('.chip-monitoramento')!;
    expect(chip.textContent!.trim()).toBe('Desativado');
    expect(chip.classList).toContain('chip-monitoramento--off');
  });

  it('só o botão do rodapé pede a ação de monitoramento, e ele apenas emite', () => {
    const fixture = montar();
    responder(fixture);
    let pedidos = 0;
    fixture.componentInstance.alternarEquipamento.subscribe(() => (pedidos += 1));

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.gaveta__acoes .botao--perigo')!.click();
    fixture.detectChanges();

    expect(pedidos).toBe(1);
    // Quem confirma e chama a API é a lista, com o ConfirmDialog: o drawer não dispara nada.
    http.expectNone((request) => request.method === 'PATCH');
  });

  it('colore o estado atual pelo status operacional e o contador pela proximidade do limite', () => {
    const fixture = montar();
    // Três falhas na cauda, com falhasParaIncidente = 3: contador no limite.
    responder(fixture, [], [monitor({ id: 10, falhasParaIncidente: 3 })], [
      medicao(18, 'SUCESSO', 4), medicao(19, 'FALHA', null), medicao(20, 'FALHA', null), medicao(21, 'FALHA', null),
    ]);
    const elemento = fixture.nativeElement as HTMLElement;

    // Estado atual reusa o badge do header, não texto branco solto.
    expect(elemento.querySelectorAll('app-status-badge').length).toBeGreaterThanOrEqual(2);
    expect(elemento.querySelector('.valor--critico')!.textContent).toContain('3 / 3');
    // Última falha sempre em âmbar quando existe.
    expect(elemento.querySelector('.valor--alerta')).not.toBeNull();
  });

  it('usa âmbar um passo antes do limite e nada abaixo disso', () => {
    const fixture = montar();
    responder(fixture, [], [monitor({ id: 10, falhasParaIncidente: 3 })], [
      medicao(18, 'SUCESSO', 4), medicao(19, 'SUCESSO', 5), medicao(20, 'FALHA', null), medicao(21, 'FALHA', null),
    ]);

    expect(fixture.componentInstance['severidadeFalhas']()).toBe('valor--alerta');
  });

  it('aplica a severidade da primitiva .kpi apenas onde a cor depende do valor', () => {
    const fixture = montar();
    responder(fixture);
    const componente = fixture.componentInstance;

    // 97,17% de disponibilidade fica na faixa intermediária: essa continua condicional.
    expect(componente['severidadeDisponibilidade']()).toBe('kpi--warn');
    // As demais passaram a ter cor fixa por métrica: 50% de perda continua âmbar,
    // e a última medição é FALHA sem que a latência vire vermelha.
    expect(componente['corPerda']()).toBe('kpi--warn');
    expect(componente['corLatencia']()).toBe('kpi--info');
    expect(componente['corLatenciaMedia']()).toBe('kpi--info');
    expect(componente['corIncidentes']()).toBe('kpi--down');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.kpi--info').length).toBe(2);
  });

  it('mantém Incidentes em vermelho mesmo com zero incidentes', () => {
    const fixture = montar();
    responder(fixture, [], [monitor({ id: 10 })], MEDICOES_PADRAO, [
      { equipamentoId: 1, disponibilidadePercentual: 100, incidentes: 0 },
    ]);
    const elemento = fixture.nativeElement as HTMLElement;
    const cartaoIncidentes = [...elemento.querySelectorAll('.kpi')]
      .find((cartao) => cartao.textContent?.includes('Incidentes'))!;

    // A cor identifica a métrica, não o estado: zero incidente segue vermelho.
    expect(cartaoIncidentes.className).toContain('kpi--down');
    expect(cartaoIncidentes.textContent).toContain('0');
  });

  it('deixa Incidentes neutro quando a contagem não chegou', () => {
    const fixture = montar();
    // Disponibilidade falha: o cartão mostra "indisponível", sem contagem alguma.
    responder(fixture, ['/relatorios/disponibilidade/equipamentos']);
    const elemento = fixture.nativeElement as HTMLElement;
    const cartaoIncidentes = [...elemento.querySelectorAll('.kpi')]
      .find((cartao) => cartao.textContent?.includes('Incidentes'))!;

    // Ausência de informação não carrega alarme — diferente de zero incidentes.
    expect(fixture.componentInstance['corIncidentes']()).toBe('');
    expect(cartaoIncidentes.className).not.toContain('kpi--down');
  });

  it('não pinta latência nem perda quando não há dado na janela', () => {
    const fixture = montar();
    responder(fixture, [], [monitor({ id: 10 })], [], [
      { equipamentoId: 1, disponibilidadePercentual: 100, incidentes: 0 },
    ], []);
    const componente = fixture.componentInstance;

    expect(componente['corLatencia']()).toBe('');
    expect(componente['corPerda']()).toBe('');
    expect(componente['corLatenciaMedia']()).toBe('');
  });

  it('fecha no Escape e devolve o foco ao elemento que abriu a gaveta', () => {
    const gatilho = document.createElement('button');
    document.body.appendChild(gatilho);
    gatilho.focus();

    const fixture = montar();
    responder(fixture);
    let fechamentos = 0;
    fixture.componentInstance.fechar.subscribe(() => (fechamentos += 1));

    const painel = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.gaveta')!;
    expect(document.activeElement).toBe(painel);

    painel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(fechamentos).toBe(1);
    expect(document.activeElement).toBe(gatilho);
    gatilho.remove();
  });

  it('não declara captura de foco que não implementa', () => {
    const fixture = montar();
    responder(fixture);

    // aria-modal="true" sem focus trap engana o leitor de tela; o drawer de unidade
    // já resolveu isso com "false".
    expect((fixture.nativeElement as HTMLElement).querySelector('.gaveta')!.getAttribute('aria-modal')).toBe('false');
  });

  it('mostra o painel do monitor primário e conta os demais na seção recolhida', () => {
    const fixture = montar();
    responder(fixture, [], [monitor({ id: 10, nome: 'ICMP principal' }), monitor({ id: 11, nome: 'ICMP secundário' })]);

    // O painel é do primário; o segundo monitor não some, aparece no contador da seção.
    expect(texto(fixture)).toContain('Ver todos os monitores');
    expect(texto(fixture)).toContain('+1');
    expect((fixture.nativeElement as HTMLElement).querySelector('app-monitor-management')).toBeNull();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.monitores-todos button')!.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('app-monitor-management')).not.toBeNull();
    // O componente preservado faz suas próprias chamadas ao abrir.
    http.match((request) => request.url.includes('/equipamentos') || request.url.includes('/monitores'))
      .forEach((request) => request.flush(pagina([])));
  });

  it('isola a falha de cada chamada de composição: o drawer continua de pé', () => {
    const fixture = montar();
    responder(fixture, ['/relatorios/disponibilidade/equipamentos', '/relatorios/latencia', '/incidentes']);

    // Cartões que falharam avisam sozinhos...
    expect(texto(fixture)).toContain('Não foi possível carregar os incidentes.');
    expect(texto(fixture)).toContain('indisponível');
    // ...e o resto do painel segue exibindo o que carregou.
    expect(texto(fixture)).toContain('Cisco');
    expect(texto(fixture)).toContain('50,00%');
    expect(texto(fixture)).toContain('2 / 3');
  });
});

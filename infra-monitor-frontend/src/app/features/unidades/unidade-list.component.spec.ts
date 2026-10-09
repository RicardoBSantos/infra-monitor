import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ApiErrorCode } from '../../core/models/api-error';
import { UnidadeResponse } from '../../core/models/unidade';
import { AuthStateService } from '../../core/services/auth-state.service';
import { UnidadeListComponent } from './unidade-list.component';

const GEO = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: '2800308', name: 'Aracaju' }, geometry: { type: 'Polygon', coordinates: [] } }] };

const UNIDADES_URL = 'http://localhost:8080/api/v1/unidades';
const DASHBOARD_URL = 'http://localhost:8080/api/v1/dashboard/unidades';

function unidade(id: number, extra: Partial<UnidadeResponse> = {}): UnidadeResponse {
  return {
    id, nome: `Unidade ${id}`, sigla: `U-${id}`, descricao: null, codigoIbge: null, ativo: true,
    createdAt: '', updatedAt: '', endereco: `Rua ${id}`, cidade: 'Aracaju', uf: 'SE', latitude: null, longitude: null,
    ...extra,
  };
}

function operacional(id: number, extra: Record<string, unknown> = {}) {
  return {
    id, nome: `Unidade ${id}`, codigoIbge: null, ativo: true, status: 'DISPONIVEL',
    equipamentosTotal: 12, equipamentosAtivos: 12, equipamentosDisponiveis: 12, equipamentosDegradados: 0,
    equipamentosIndisponiveis: 0, equipamentosSemDados: 0, equipamentosSemMonitoramento: 0, equipamentosEmManutencao: 0,
    incidentesAbertos: 0, ...extra,
  };
}

function pagina(content: unknown[]) {
  return { content, page: 0, size: 500, totalElements: content.length, totalPages: 1, first: true, last: true, numberOfElements: content.length, empty: !content.length };
}

describe('UnidadeListComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UnidadeListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthStateService).setSession({
      accessToken: 'test', tokenType: 'Bearer', expiresIn: 60,
      usuario: { id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN', trocaSenhaObrigatoria: false },
    });
  });

  afterEach(() => http.verify());

  interface Respostas { cadastros?: UnidadeResponse[]; operacionais?: unknown[] | 'erro'; disponibilidade?: unknown[] | 'erro'; }

  function criar(respostas: Respostas = {}): ComponentFixture<UnidadeListComponent> {
    const fixture = TestBed.createComponent(UnidadeListComponent);
    fixture.detectChanges();
    http.expectOne(UNIDADES_URL).flush(respostas.cadastros ?? [unidade(1)]);
    const dashboard = http.expectOne(DASHBOARD_URL);
    if (respostas.operacionais === 'erro') {
      dashboard.flush({ mensagem: 'falhou' }, { status: 500, statusText: 'Server Error' });
    } else {
      dashboard.flush(respostas.operacionais ?? [operacional(1)]);
    }

    const disponibilidade = http.expectOne((requisicao) => requisicao.url.endsWith('/relatorios/disponibilidade/unidades'));
    if (respostas.disponibilidade === 'erro') {
      disponibilidade.flush({ mensagem: 'falhou' }, { status: 500, statusText: 'Server Error' });
    } else {
      disponibilidade.flush(pagina(respostas.disponibilidade ?? [{ unidadeId: 1, disponibilidadePercentual: 99.42 }]));
    }
    fixture.detectChanges();
    return fixture;
  }

  it('compõe cadastro, agregados operacionais e disponibilidade na mesma linha', () => {
    const fixture = criar({ operacionais: [operacional(1, { status: 'DEGRADADO', incidentesAbertos: 3, equipamentosTotal: 24 })] });

    const celulas = Array.from(fixture.nativeElement.querySelectorAll('tbody td')).map((celula) => (celula as HTMLElement).textContent!.trim());
    expect(celulas[0]).toContain('Unidade 1');
    expect(celulas[1]).toBe('U-1');
    expect(celulas[2]).toBe('Aracaju');
    expect(celulas[3]).toBe('Rua 1');
    expect(celulas[4]).toContain('Degradado');
    expect(celulas[5]).toBe('24');
    expect(celulas[6]).toBe('99,42%');
    expect(celulas[7]).toBe('3');
  });

  // Um relatório fora do ar não pode custar a lista administrativa inteira.
  it('mantém a lista de pé quando a disponibilidade falha', () => {
    const fixture = criar({ disponibilidade: 'erro' });

    expect(fixture.nativeElement.querySelector('tbody tr')).not.toBeNull();
    const celulas = Array.from(fixture.nativeElement.querySelectorAll('tbody td')).map((celula) => (celula as HTMLElement).textContent!.trim());
    expect(celulas[6]).toBe('—');
    expect(fixture.nativeElement.textContent).not.toContain('Não foi possível carregar as unidades');
  });

  it('esmaece a unidade inativa, esconde o status operacional e oferece Ativar', () => {
    const fixture = criar({ cadastros: [unidade(1, { ativo: false })], operacionais: [operacional(1, { ativo: false })] });

    const linha = fixture.nativeElement.querySelector('tbody tr') as HTMLElement;
    expect(linha.classList).toContain('unidades__linha--inativa');
    expect(linha.textContent).toContain('Inativa');
    expect((linha.querySelectorAll('td')[4] as HTMLElement).textContent!.trim()).toBe('—');
    expect(linha.querySelector('.unidades__acoes')!.textContent).toContain('Ativar');
  });

  it('filtra em memória por nome, código ou cidade, sem refazer as chamadas', () => {
    const fixture = criar({
      cadastros: [unidade(1), unidade(2, { nome: 'Sesc Itabaiana', sigla: 'ITA-09', cidade: 'Itabaiana' })],
      operacionais: [operacional(1), operacional(2)],
    });

    const busca = fixture.nativeElement.querySelector('#busca-unidades') as HTMLInputElement;
    busca.value = 'itabaiana';
    busca.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('1 de 2 unidades');
  });

  it('mostra o estado de vazio por filtro com ação de limpar', () => {
    const fixture = criar();

    const busca = fixture.nativeElement.querySelector('#busca-unidades') as HTMLInputElement;
    busca.value = 'inexistente';
    busca.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Nenhuma unidade corresponde à busca');
    (fixture.nativeElement.querySelector('.vazio .botao') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('pagina de 20 em 20 e só mostra os controles com mais de uma página', () => {
    const cadastros = Array.from({ length: 25 }, (_, indice) => unidade(indice + 1));
    const fixture = criar({ cadastros, operacionais: cadastros.map((item) => operacional(item.id)) });

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(20);
    const paginacao = fixture.nativeElement.querySelector('.paginacao') as HTMLElement;
    expect(paginacao).not.toBeNull();
    expect(paginacao.textContent).toContain('Página 1 de 2');

    paginacao.querySelector<HTMLButtonElement>('button:last-of-type')!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(5);
  });

  it('esconde a paginação com uma única página', () => {
    const fixture = criar();
    expect(fixture.nativeElement.querySelector('.paginacao')).toBeNull();
  });

  it('confirma a desativação informando o impacto no ICMP e no Telegram', () => {
    const fixture = criar({ operacionais: [operacional(1, { equipamentosTotal: 24 })] });

    (fixture.nativeElement.querySelectorAll('.unidades__acoes .botao')[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    const dialogo = fixture.nativeElement.querySelector('.confirm-dialog') as HTMLElement;
    expect(dialogo.textContent).toContain('Desativar Unidade 1?');
    expect(dialogo.textContent).toContain('24 dispositivo(s)');
    expect(dialogo.textContent).toContain('Telegram');

    (dialogo.querySelectorAll('button')[1] as HTMLButtonElement).click();
    const requisicao = http.expectOne(`${UNIDADES_URL}/1/desativar`);
    expect(requisicao.request.method).toBe('PATCH');
    requisicao.flush(unidade(1, { ativo: false }));
    http.expectOne(DASHBOARD_URL).flush([operacional(1, { ativo: false })]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('tbody tr')!.textContent).toContain('Inativa');
  });

  // BUSINESS_CONFLICT é o código real de ConflitoException; a mensagem tem de
  // aparecer dentro do modal, e o modal continua aberto para o usuário lê-la.
  it('mostra a recusa de exclusão dentro do modal sem fechá-lo', () => {
    const fixture = criar();

    (fixture.nativeElement.querySelectorAll('.unidades__acoes .botao')[2] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.confirm-dialog')!.textContent).toContain('12 equipamento(s) vinculado(s)');

    (fixture.nativeElement.querySelectorAll('.confirm-dialog button')[1] as HTMLButtonElement).click();
    http.expectOne(`${UNIDADES_URL}/1`).flush({
      timestamp: '2026-08-28T00:00:00Z', status: 409, error: 'Conflict', code: ApiErrorCode.BusinessConflict,
      message: 'Unidade possui equipamentos vinculados.', path: '/api/v1/unidades/1',
    }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();

    const dialogo = fixture.nativeElement.querySelector('.confirm-dialog') as HTMLElement;
    expect(dialogo).not.toBeNull();
    expect(dialogo.textContent).toContain('Unidade possui equipamentos vinculados.');
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);
  });

  // O backend recusa a exclusão com equipamentos vinculados: o modal não pode
  // oferecer a ação como se fosse suceder.
  it('avisa que a exclusão será recusada quando há equipamentos vinculados', () => {
    const fixture = criar({ operacionais: [operacional(1, { equipamentosTotal: 24 })] });

    (fixture.nativeElement.querySelectorAll('.unidades__acoes .botao')[2] as HTMLButtonElement).click();
    fixture.detectChanges();

    const dialogo = fixture.nativeElement.querySelector('.confirm-dialog') as HTMLElement;
    expect(dialogo.textContent).toContain('24 equipamento(s) vinculado(s)');
    expect(dialogo.textContent).toContain('será recusada');
    expect(dialogo.textContent).toContain('Mova ou desvincule');
    expect(dialogo.textContent).not.toContain('definitiva');
  });

  it('promete exclusão definitiva só com zero equipamentos confirmado', () => {
    const fixture = criar({ operacionais: [operacional(1, { equipamentosTotal: 0 })] });

    (fixture.nativeElement.querySelectorAll('.unidades__acoes .botao')[2] as HTMLButtonElement).click();
    fixture.detectChanges();

    const dialogo = fixture.nativeElement.querySelector('.confirm-dialog') as HTMLElement;
    expect(dialogo.textContent).toContain('não tem equipamentos vinculados');
    expect(dialogo.textContent).toContain('definitiva');
  });

  // Agregado do painel fora do ar: quantidade desconhecida nunca vira "0".
  it('distingue contagem desconhecida de zero equipamentos', () => {
    const fixture = criar({ operacionais: 'erro' });

    (fixture.nativeElement.querySelectorAll('.unidades__acoes .botao')[2] as HTMLButtonElement).click();
    fixture.detectChanges();

    const dialogo = fixture.nativeElement.querySelector('.confirm-dialog') as HTMLElement;
    expect(dialogo.textContent).toContain('Não foi possível confirmar quantos equipamentos');
    expect(dialogo.textContent).toContain('a exclusão será recusada');
    expect(dialogo.textContent).not.toContain('0 equipamento');
    expect(dialogo.textContent).not.toContain('definitiva');
  });

  it('não anuncia quantidade de dispositivos na desativação quando o painel falhou', () => {
    const fixture = criar({ operacionais: 'erro' });

    (fixture.nativeElement.querySelectorAll('.unidades__acoes .botao')[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    const dialogo = fixture.nativeElement.querySelector('.confirm-dialog') as HTMLElement;
    expect(dialogo.textContent).toContain('quantidade não confirmada');
    expect(dialogo.textContent).not.toContain('0 dispositivo(s)');
  });

  it('ativa sem confirmação', () => {
    const fixture = criar({ cadastros: [unidade(1, { ativo: false })], operacionais: [operacional(1, { ativo: false })] });

    (fixture.nativeElement.querySelectorAll('.unidades__acoes .botao')[1] as HTMLButtonElement).click();
    const requisicao = http.expectOne(`${UNIDADES_URL}/1/ativar`);
    expect(requisicao.request.method).toBe('PATCH');
    requisicao.flush(unidade(1));
    http.expectOne(DASHBOARD_URL).flush([operacional(1)]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('tbody tr')!.textContent).not.toContain('Inativa');
  });

  it('abre a gaveta de cadastro pelo botão primário', () => {
    const fixture = criar();

    (fixture.nativeElement.querySelector('.unidades__topo .botao--primario') as HTMLButtonElement).click();
    fixture.detectChanges();
    // O GeoJSON de municípios só é baixado quando a gaveta abre.
    http.expectOne('assets/maps/se-municipalities.geo.json').flush(GEO);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.gaveta')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#gaveta-titulo')!.textContent).toContain('Nova unidade');
  });
});

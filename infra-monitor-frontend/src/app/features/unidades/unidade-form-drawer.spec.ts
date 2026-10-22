import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UnidadeResponse } from '../../core/models/unidade';
import { UnidadeFormDrawerComponent } from './unidade-form-drawer.component';

const GEO = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { id: '2800308', name: 'Aracaju' }, geometry: { type: 'Polygon', coordinates: [] } },
    { type: 'Feature', properties: { id: '2800100', name: 'Amparo' }, geometry: { type: 'Polygon', coordinates: [] } },
  ],
};

const UNIDADE: UnidadeResponse = {
  id: 7,
  nome: 'Centro Integrado de Saúde',
  sigla: 'CIS-01',
  descricao: 'Sede operacional',
  codigoIbge: '2800308',
  ativo: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  endereco: 'Av. Ivo do Prado, 1120 — Centro',
  cidade: 'Aracaju',
  uf: 'SE',
  latitude: -10.9095,
  longitude: -37.0748,
  conectaAUnidadeId: null,
};

/** Destinos do select "Conecta a". A propria unidade editada e filtrada pelo componente. */
const DESTINOS: UnidadeResponse[] = [
  { ...UNIDADE, id: 1, nome: 'Sede Administrativa', sigla: 'SEDE' },
  { ...UNIDADE },
];

describe('UnidadeFormDrawerComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UnidadeFormDrawerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function abrir(unidade: UnidadeResponse | null): ComponentFixture<UnidadeFormDrawerComponent> {
    const fixture = TestBed.createComponent(UnidadeFormDrawerComponent);
    fixture.componentRef.setInput('unidade', unidade);
    fixture.componentRef.setInput('aberto', true);
    fixture.detectChanges();
    http.expectOne('assets/maps/se-municipalities.geo.json').flush(GEO);
    // A gaveta tambem carrega os destinos possiveis de conexao ao abrir.
    http.expectOne('http://localhost:8080/api/v1/unidades').flush(DESTINOS);
    fixture.detectChanges();
    return fixture;
  }

  function submeter(fixture: ComponentFixture<UnidadeFormDrawerComponent>): void {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
  }

  // O backend aplica os campos com aplicarSePresente: string vazia LIMPA o valor salvo.
  // Abrir a gaveta sem carregar o cadastro apagaria endereço, cidade, UF e coordenadas
  // ao salvar apenas o nome. Este teste trava esse comportamento.
  it('carrega os valores atuais e não perde nenhum campo ao salvar sem alterações', () => {
    const fixture = abrir(UNIDADE);

    submeter(fixture);

    const requisicao = http.expectOne('http://localhost:8080/api/v1/unidades/7');
    expect(requisicao.request.method).toBe('PUT');
    expect(requisicao.request.body).toEqual({
      nome: UNIDADE.nome,
      sigla: UNIDADE.sigla,
      descricao: UNIDADE.descricao,
      codigoIbge: UNIDADE.codigoIbge,
      endereco: UNIDADE.endereco,
      cidade: UNIDADE.cidade,
      uf: UNIDADE.uf,
      latitude: UNIDADE.latitude,
      longitude: UNIDADE.longitude,
    });
    requisicao.flush(UNIDADE);
  });

  it('preserva os demais campos quando só o nome muda', () => {
    const fixture = abrir(UNIDADE);

    const nome = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    nome.value = 'Centro Integrado';
    nome.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    submeter(fixture);

    const requisicao = http.expectOne('http://localhost:8080/api/v1/unidades/7');
    expect(requisicao.request.body.nome).toBe('Centro Integrado');
    expect(requisicao.request.body.endereco).toBe(UNIDADE.endereco);
    expect(requisicao.request.body.cidade).toBe(UNIDADE.cidade);
    expect(requisicao.request.body.uf).toBe('SE');
    expect(requisicao.request.body.latitude).toBe(UNIDADE.latitude);
    expect(requisicao.request.body.longitude).toBe(UNIDADE.longitude);
    requisicao.flush(UNIDADE);
  });

  it('deriva a UF do município escolhido e a exibe somente leitura', () => {
    const fixture = abrir({ ...UNIDADE, uf: null });

    const uf = fixture.nativeElement.querySelector('input[readonly]') as HTMLInputElement;
    expect(uf.value).toBe('SE');

    submeter(fixture);
    const requisicao = http.expectOne('http://localhost:8080/api/v1/unidades/7');
    expect(requisicao.request.body.uf).toBe('SE');
    requisicao.flush(UNIDADE);
  });

  it('deixa a UF editável quando não há município associado', () => {
    const fixture = abrir({ ...UNIDADE, codigoIbge: null, uf: 'BA' });

    expect(fixture.nativeElement.querySelector('input[readonly]')).toBeNull();
    const selects = fixture.nativeElement.querySelectorAll('select') as NodeListOf<HTMLSelectElement>;
    expect(selects[1].value).toBe('BA');
  });

  // Trocar o município não pode recarregar o formulário: o effect de abertura chegou a
  // rastrear o signal do município (via ufDerivada) e o reset descartava a escolha e o
  // que mais tivesse sido digitado, enviando codigoIbge null.
  it('mantém o município escolhido e as demais edições ao salvar', () => {
    const fixture = abrir({ ...UNIDADE, codigoIbge: null, uf: 'BA' });

    const nome = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    nome.value = 'Centro Integrado';
    nome.dispatchEvent(new Event('input'));
    const municipio = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    municipio.value = '2800100';
    municipio.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(municipio.value).toBe('2800100');
    expect((fixture.nativeElement.querySelector('input[readonly]') as HTMLInputElement).value).toBe('SE');

    submeter(fixture);
    const requisicao = http.expectOne('http://localhost:8080/api/v1/unidades/7');
    expect(requisicao.request.body.codigoIbge).toBe('2800100');
    expect(requisicao.request.body.uf).toBe('SE');
    expect(requisicao.request.body.nome).toBe('Centro Integrado');
    requisicao.flush(UNIDADE);
  });

  it('bloqueia meia coordenada antes de chamar a API', () => {
    const fixture = abrir({ ...UNIDADE, longitude: null });

    submeter(fixture);
    fixture.detectChanges();

    http.expectNone('http://localhost:8080/api/v1/unidades/7');
    expect(fixture.nativeElement.textContent).toContain('informadas juntas');
  });

  it('cria unidade enviando null nos campos em branco', () => {
    const fixture = abrir(null);

    const inputs = fixture.nativeElement.querySelectorAll('input') as NodeListOf<HTMLInputElement>;
    inputs[0].value = 'Nova';
    inputs[0].dispatchEvent(new Event('input'));
    inputs[1].value = 'NOV';
    inputs[1].dispatchEvent(new Event('input'));
    fixture.detectChanges();

    submeter(fixture);

    const requisicao = http.expectOne('http://localhost:8080/api/v1/unidades');
    expect(requisicao.request.method).toBe('POST');
    expect(requisicao.request.body).toEqual({
      nome: 'Nova', sigla: 'NOV', descricao: null, codigoIbge: null,
      endereco: null, cidade: null, uf: null, latitude: null, longitude: null,
    });
    requisicao.flush({ ...UNIDADE, id: 9, nome: 'Nova' });
  });

  it('pede confirmação de descarte quando há alteração não salva', () => {
    const fixture = abrir(UNIDADE);

    const nome = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    nome.value = 'Outro nome';
    nome.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    let fechou = false;
    fixture.componentInstance.fechado.subscribe(() => fechou = true);

    (fixture.nativeElement.querySelector('.gaveta__fundo') as HTMLElement).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Descartar alterações?');
    expect(fechou).toBe(false);
  });

  // A conexao NAO viaja no corpo da unidade: no PUT null significa "preserva", e "Nenhuma"
  // nunca desconectaria. Estes dois testes travam o contrato das duas chamadas.
  it('conecta a unidade ao hub escolhido depois de salvar o cadastro', () => {
    const fixture = abrir(UNIDADE);

    const select = fixture.nativeElement.querySelector('select[formControlName="conectaAUnidadeId"]') as HTMLSelectElement;
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    submeter(fixture);

    http.expectOne('http://localhost:8080/api/v1/unidades/7').flush({ ...UNIDADE, conectaAUnidadeId: null });
    const conexao = http.expectOne('http://localhost:8080/api/v1/unidades/7/conexao');
    expect(conexao.request.method).toBe('PUT');
    expect(conexao.request.body).toEqual({ conectaAUnidadeId: 1 });
    conexao.flush({ ...UNIDADE, conectaAUnidadeId: 1 });
  });

  it('desconecta com DELETE quando o select volta para "Nenhuma"', () => {
    const fixture = abrir({ ...UNIDADE, conectaAUnidadeId: 1 });

    const select = fixture.nativeElement.querySelector('select[formControlName="conectaAUnidadeId"]') as HTMLSelectElement;
    select.value = '';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    submeter(fixture);

    http.expectOne('http://localhost:8080/api/v1/unidades/7').flush({ ...UNIDADE, conectaAUnidadeId: 1 });
    const conexao = http.expectOne('http://localhost:8080/api/v1/unidades/7/conexao');
    expect(conexao.request.method).toBe('DELETE');
    conexao.flush({ ...UNIDADE, conectaAUnidadeId: null });
  });

  it('nao repete a chamada de conexao quando o destino nao mudou', () => {
    const fixture = abrir({ ...UNIDADE, conectaAUnidadeId: 1 });

    submeter(fixture);

    http.expectOne('http://localhost:8080/api/v1/unidades/7').flush({ ...UNIDADE, conectaAUnidadeId: 1 });
    http.expectNone('http://localhost:8080/api/v1/unidades/7/conexao');
  });
});

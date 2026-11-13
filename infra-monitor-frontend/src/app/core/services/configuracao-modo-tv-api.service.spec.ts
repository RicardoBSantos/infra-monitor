import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConfiguracaoModoTv } from '../models/configuracao-modo-tv';
import { ConfiguracaoModoTvApiService } from './configuracao-modo-tv-api.service';

const configuracao: ConfiguracaoModoTv = {
  ativo: true, intervaloAtualizacaoSegundos: 60, persistida: false, atualizadoEm: null,
  telas: [{ tela: 'MAPA', ordem: 1, duracaoSegundos: 30 }],
};

describe('ConfiguracaoModoTvApiService', () => {
  let api: ConfiguracaoModoTvApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ConfiguracaoModoTvApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('obter faz GET no endpoint do modo TV', () => {
    let recebida: ConfiguracaoModoTv | undefined;
    api.obter().subscribe((c) => (recebida = c));
    const req = http.expectOne((r) => r.url.endsWith('/api/v1/configuracoes/modo-tv'));
    expect(req.request.method).toBe('GET');
    req.flush(configuracao);
    expect(recebida).toEqual(configuracao);
  });

  it('salvar faz PUT com o corpo dado', () => {
    const corpo = { ativo: false, telas: [{ tela: 'PAINEL' as const, duracaoSegundos: 45 }] };
    let recebida: ConfiguracaoModoTv | undefined;
    api.salvar(corpo).subscribe((c) => (recebida = c));
    const req = http.expectOne((r) => r.url.endsWith('/api/v1/configuracoes/modo-tv'));
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(corpo);
    req.flush(configuracao);
    expect(recebida).toEqual(configuracao);
  });
});

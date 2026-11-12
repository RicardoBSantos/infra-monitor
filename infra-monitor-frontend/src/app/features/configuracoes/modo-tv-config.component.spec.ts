import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfiguracaoModoTv } from '../../core/models/configuracao-modo-tv';
import { ModoTvConfigComponent } from './modo-tv-config.component';

const ENDPOINT = '/configuracoes/modo-tv';

/** API devolve a ordem gravada — propositalmente diferente da ordem canônica. */
const config = (over: Partial<ConfiguracaoModoTv> = {}): ConfiguracaoModoTv => ({
  ativo: true,
  intervaloAtualizacaoSegundos: 60,
  telas: [
    { tela: 'PAINEL', ordem: 1, duracaoSegundos: 60 },
    { tela: 'MAPA', ordem: 2, duracaoSegundos: 30 },
    { tela: 'INCIDENTES', ordem: 3, duracaoSegundos: 60 },
    { tela: 'RELATORIOS', ordem: 4, duracaoSegundos: 120 },
  ],
  persistida: true,
  atualizadoEm: '2026-11-12T12:00:00Z',
  ...over,
});

const erroApi = (status: number, code: string, message: string, fields?: Record<string, string>) => ({
  timestamp: '2026-11-12T12:00:00Z', status, error: 'Erro', code, message, path: '/api/v1/configuracoes/modo-tv',
  ...(fields ? { fields } : {}),
});

describe('ModoTvConfigComponent', () => {
  let fixture: ComponentFixture<ModoTvConfigComponent>;
  let http: HttpTestingController;

  const raiz = () => fixture.nativeElement as HTMLElement;
  const texto = () => raiz().textContent ?? '';
  const nomesDasLinhas = () => Array.from(raiz().querySelectorAll('.tela__nome')).map(e => e.textContent?.trim());
  const botaoSalvar = () => raiz().querySelector('.botao--primario') as HTMLButtonElement;
  const botao = (rotulo: string) => raiz().querySelector(`[aria-label="${rotulo}"]`) as HTMLButtonElement;
  const caixa = (nome: string) => raiz().querySelector(`input[type="checkbox"][data-tela="${nome}"]`) as HTMLInputElement;
  const escolher = (select: HTMLSelectElement, valor: string) => { select.value = valor; select.dispatchEvent(new Event('change')); fixture.detectChanges(); };
  const marcar = (input: HTMLInputElement, marcado: boolean) => { input.checked = marcado; input.dispatchEvent(new Event('change')); fixture.detectChanges(); };
  const clicar = (el: HTMLElement) => { el.click(); fixture.detectChanges(); };
  const pedidoGet = () => http.expectOne(r => r.method === 'GET' && r.url.endsWith(ENDPOINT));
  const pedidoPut = () => http.expectOne(r => r.method === 'PUT' && r.url.endsWith(ENDPOINT));

  function carregar(dados: ConfiguracaoModoTv = config()): void {
    fixture.detectChanges();
    pedidoGet().flush(dados);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ModoTvConfigComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ModoTvConfigComponent);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('mostra o esqueleto e depois as 4 telas na ordem da API', () => {
    fixture.detectChanges();
    expect(raiz().querySelector('.esqueleto[role="status"]')).toBeTruthy();
    pedidoGet().flush(config());
    fixture.detectChanges();
    expect(raiz().querySelector('.esqueleto')).toBeNull();
    expect(nomesDasLinhas()).toEqual(['Painel', 'Mapa', 'Incidentes', 'Relatórios']);
  });

  it('acrescenta ao fim, desmarcadas, as telas que a API não traz', () => {
    carregar(config({ telas: [{ tela: 'INCIDENTES', ordem: 1, duracaoSegundos: 60 }] }));
    expect(nomesDasLinhas()).toEqual(['Incidentes', 'Mapa', 'Painel', 'Relatórios']);
    expect(caixa('INCIDENTES').checked).toBe(true);
    expect(caixa('MAPA').checked).toBe(false);
  });

  it('mostra o estado gravado com o StatusBadge', () => {
    carregar(config({ ativo: false }));
    expect(raiz().querySelector('app-status-badge')?.textContent?.trim()).toBe('Desabilitado');
  });

  it('mudar só o intervalo envia apenas esse campo', () => {
    carregar();
    escolher(raiz().querySelector('select[name="intervalo"]') as HTMLSelectElement, '120');
    clicar(botaoSalvar());
    const put = pedidoPut();
    expect(put.request.body).toEqual({ intervaloAtualizacaoSegundos: 120 });
    put.flush(config({ intervaloAtualizacaoSegundos: 120 }));
    fixture.detectChanges();
    expect(texto()).toContain('Configuração salva');
    expect(botaoSalvar().disabled).toBe(true);
  });

  it('reordenar envia a lista de telas na nova ordem', () => {
    carregar();
    clicar(botao('Mover Mapa para cima'));
    expect(nomesDasLinhas()).toEqual(['Mapa', 'Painel', 'Incidentes', 'Relatórios']);
    clicar(botaoSalvar());
    const put = pedidoPut();
    expect(put.request.body).toEqual({
      telas: [
        { tela: 'MAPA', duracaoSegundos: 30 },
        { tela: 'PAINEL', duracaoSegundos: 60 },
        { tela: 'INCIDENTES', duracaoSegundos: 60 },
        { tela: 'RELATORIOS', duracaoSegundos: 120 },
      ],
    });
    put.flush(config());
  });

  it('desliga as setas nas pontas da lista', () => {
    carregar();
    expect(botao('Mover Painel para cima').disabled).toBe(true);
    expect(botao('Mover Relatórios para baixo').disabled).toBe(true);
    expect(botao('Mover Painel para baixo').disabled).toBe(false);
  });

  it('desmarcar uma tela a tira do envio; desligar o modo envia só ativo', () => {
    carregar();
    marcar(caixa('MAPA'), false);
    marcar(raiz().querySelector('input[role="switch"]') as HTMLInputElement, false);
    clicar(botaoSalvar());
    const put = pedidoPut();
    expect(put.request.body).toEqual({
      ativo: false,
      telas: [
        { tela: 'PAINEL', duracaoSegundos: 60 },
        { tela: 'INCIDENTES', duracaoSegundos: 60 },
        { tela: 'RELATORIOS', duracaoSegundos: 120 },
      ],
    });
    put.flush(config());
  });

  it('desmarcar todas as telas desabilita Salvar com mensagem', () => {
    carregar();
    for (const t of ['MAPA', 'PAINEL', 'INCIDENTES', 'RELATORIOS']) marcar(caixa(t), false);
    expect(botaoSalvar().disabled).toBe(true);
    expect(texto()).toContain('Inclua ao menos uma tela no ciclo para salvar.');
  });

  it('Salvar fica desabilitado sem alterações', () => {
    carregar();
    expect(botaoSalvar().disabled).toBe(true);
  });

  it('resume o ciclo completo com as telas incluídas', () => {
    carregar();
    // 60 + 30 + 60 + 120 = 270 s
    expect(texto()).toContain('Ciclo completo: 4 min 30 s');
    marcar(caixa('RELATORIOS'), false);
    expect(texto()).toContain('Ciclo completo: 2 min 30 s');
    escolher(raiz().querySelector('select[aria-label="Duração de Mapa"]') as HTMLSelectElement, '10');
    expect(texto()).toContain('Ciclo completo: 2 min 10 s');
  });

  it('Descartar volta aos valores gravados', () => {
    carregar();
    clicar(botao('Mover Mapa para cima'));
    clicar(Array.from(raiz().querySelectorAll('button')).find(b => b.textContent?.trim() === 'Descartar')!);
    expect(nomesDasLinhas()).toEqual(['Painel', 'Mapa', 'Incidentes', 'Relatórios']);
    expect(botaoSalvar().disabled).toBe(true);
  });

  it('"Abrir modo TV" abre /tv em nova aba', () => {
    carregar();
    const link = Array.from(raiz().querySelectorAll('a')).find(a => a.textContent?.includes('Abrir modo TV'))!;
    expect(link.classList).toContain('botao');
    expect(link.classList).not.toContain('botao--primario');
    expect(link.getAttribute('href')).toBe('/tv');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener');
  });

  it('avisa quando a configuração ainda não foi gravada', () => {
    carregar(config({ persistida: false }));
    expect(texto()).toContain('Usando os valores padrão; nada foi salvo ainda.');
  });

  it('503 CONFIGURATION_UNAVAILABLE mostra o aviso de migração pendente e mantém o formulário', () => {
    carregar();
    escolher(raiz().querySelector('select[name="intervalo"]') as HTMLSelectElement, '30');
    clicar(botaoSalvar());
    pedidoPut().flush(erroApi(503, 'CONFIGURATION_UNAVAILABLE', 'Configuracao do modo TV indisponivel'), { status: 503, statusText: 'Service Unavailable' });
    fixture.detectChanges();
    expect(raiz().querySelector('[role="alert"]')?.textContent).toContain('Configuração indisponível no servidor (migração V27 pendente)');
    expect((raiz().querySelector('select[name="intervalo"]') as HTMLSelectElement).value).toBe('30');
    expect(botaoSalvar().disabled).toBe(false);
  });

  it('400 VALIDATION_ERROR mostra a mensagem da API', () => {
    carregar();
    escolher(raiz().querySelector('select[name="intervalo"]') as HTMLSelectElement, '300');
    clicar(botaoSalvar());
    pedidoPut().flush(erroApi(400, 'VALIDATION_ERROR', 'Dados invalidos', { telas: 'nao pode ser vazia' }), { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(raiz().querySelector('[role="alert"]')?.textContent).toContain('Dados invalidos');
  });

  it('falha ao carregar mostra erro com Tentar novamente', () => {
    fixture.detectChanges();
    pedidoGet().flush(null, { status: 500, statusText: 'Erro' });
    fixture.detectChanges();
    expect(raiz().querySelector('.aviso--erro[role="alert"]')).toBeTruthy();
    clicar(Array.from(raiz().querySelectorAll('button')).find(b => b.textContent?.includes('Tentar novamente'))!);
    pedidoGet().flush(config());
    fixture.detectChanges();
    expect(nomesDasLinhas()).toHaveLength(4);
  });

  it('mantém fora de padrão um valor gravado que não está na lista', () => {
    carregar(config({ intervaloAtualizacaoSegundos: 90 }));
    expect((raiz().querySelector('select[name="intervalo"]') as HTMLSelectElement).value).toBe('90');
  });
});

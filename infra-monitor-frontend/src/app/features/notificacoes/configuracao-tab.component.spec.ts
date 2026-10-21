import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfiguracaoTabComponent } from './configuracao-tab.component';

const bot = (over: Record<string, unknown> = {}) => ({
  status: 'VERIFICADO', username: 'infra_monitor_bot', botId: 7788,
  verificadoEm: '2026-09-01T12:00:00Z', desatualizado: false, ...over,
});
const config = (over: Record<string, unknown> = {}) => ({
  telegramEnabled: true, dispatcherEnabled: true, destinoConfigurado: true,
  testeCooldownSegundos: 60, bot: bot(), ...over,
});
const erroApi = (message: string) => ({
  timestamp: '2026-09-01T12:00:00Z', status: 500, error: 'Internal Server Error',
  code: 'INTERNAL_ERROR', message, path: '/api/v1/notificacoes/telegram/configuracao',
});

describe('ConfiguracaoTabComponent', () => {
  let fixture: ComponentFixture<ConfiguracaoTabComponent>;
  let http: HttpTestingController;

  const componente = () => fixture.componentInstance as any;
  const texto = () => fixture.nativeElement.textContent as string;
  const botaoTestar = () => fixture.nativeElement.querySelector('.botao--primario') as HTMLButtonElement;
  const pedidoConfig = () => http.expectOne(value => value.url.endsWith('/notificacoes/telegram/configuracao'));
  const pedidoTeste = () => http.expectOne(value => value.url.endsWith('/notificacoes/telegram/teste'));

  beforeEach(() => {
    // Apenas o timer do cooldown e falseado; o agendador do Angular fica intacto.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    TestBed.configureTestingModule({
      imports: [ConfiguracaoTabComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ConfiguracaoTabComponent);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); vi.useRealTimers(); });

  // ------------------------------------------------------------- carregamento
  it('mostra o esqueleto durante o carregamento e depois o conteúdo', () => {
    fixture.detectChanges();
    const pedido = pedidoConfig();
    expect(fixture.nativeElement.querySelector('.esqueleto[role="status"][aria-label="Carregando configuração do Telegram"]')).toBeTruthy();

    pedido.flush(config());
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[aria-label="Carregando configuração do Telegram"]')).toBeNull();
    expect(texto()).toContain('@infra_monitor_bot');
    expect(texto()).toContain('id 7788');
    expect(texto()).toContain('TESTAR INTEGRAÇÃO');
  });

  // -------------------------------------------------------------------- badge
  it('mostra o badge Verificado quando o cache confirmou a identidade do bot', () => {
    fixture.detectChanges();
    pedidoConfig().flush(config());
    fixture.detectChanges();

    expect(texto()).toContain('Verificado');
    expect(texto()).not.toContain('Não verificado');
    expect(texto()).toContain('Bot verificado junto à API do Telegram.');
  });

  it('mostra o badge Não verificado e omite a identidade quando o getMe falhou', () => {
    fixture.detectChanges();
    pedidoConfig().flush(config({ bot: bot({ status: 'NAO_VERIFICADO', username: null, botId: null }) }));
    fixture.detectChanges();

    expect(texto()).toContain('Não verificado');
    expect(texto()).not.toContain('@infra_monitor_bot');
    expect(texto()).toContain('Sem token configurado no servidor');
  });

  it('sinaliza identidade vencida quando a última revalidação falhou', () => {
    fixture.detectChanges();
    pedidoConfig().flush(config({ bot: bot({ desatualizado: true }) }));
    fixture.detectChanges();

    // Continua verificado e continua exibindo o username: perde-se a atualidade, não o dado.
    expect(texto()).toContain('Verificado');
    expect(texto()).toContain('@infra_monitor_bot');
    expect(texto()).toContain('a última revalidação falhou');
  });

  // ------------------------------------------------------- testar integração
  it('envia o teste e entra em cooldown, liberando o botão ao fim da janela', () => {
    fixture.detectChanges();
    pedidoConfig().flush(config());
    fixture.detectChanges();
    expect(componente().podeTestar()).toBe(true);

    botaoTestar().click();
    const pedido = pedidoTeste();
    expect(pedido.request.method).toBe('POST');
    pedido.flush({ enviado: true, motivo: null, cooldownRestanteSegundos: null });
    fixture.detectChanges();

    expect(texto()).toContain('Mensagem de teste enviada ao destino padrão.');
    expect(componente().cooldown()).toBe(60);
    expect(componente().podeTestar()).toBe(false);
    expect(botaoTestar().disabled).toBe(true);
    expect(botaoTestar().textContent).toContain('Aguarde 60 s');

    vi.advanceTimersByTime(30_000);
    fixture.detectChanges();
    expect(componente().cooldown()).toBe(30);
    expect(componente().podeTestar()).toBe(false);

    vi.advanceTimersByTime(30_000);
    fixture.detectChanges();
    expect(componente().cooldown()).toBe(0);
    expect(componente().podeTestar()).toBe(true);
    expect(botaoTestar().disabled).toBe(false);
    expect(botaoTestar().textContent).toContain('Testar integração');
  });

  it('não dispara segunda requisição enquanto o cooldown corre', () => {
    fixture.detectChanges();
    pedidoConfig().flush(config());
    fixture.detectChanges();

    botaoTestar().click();
    pedidoTeste().flush({ enviado: true, motivo: null, cooldownRestanteSegundos: null });
    fixture.detectChanges();

    // Cliques repetidos durante a janela de throttle não podem virar mensagem no grupo real.
    botaoTestar().click();
    componente().testar();
    http.expectNone(value => value.url.endsWith('/notificacoes/telegram/teste'));

    vi.advanceTimersByTime(60_000);
    fixture.detectChanges();
    botaoTestar().click();
    pedidoTeste().flush({ enviado: true, motivo: null, cooldownRestanteSegundos: null });
  });

  it('mostra o motivo quando o backend recusa o teste, sem iniciar cooldown', () => {
    fixture.detectChanges();
    pedidoConfig().flush(config());
    fixture.detectChanges();

    botaoTestar().click();
    pedidoTeste().flush({ enviado: false, motivo: 'Bot ou destino padrao nao configurado no servidor.', cooldownRestanteSegundos: null });
    fixture.detectChanges();

    expect(texto()).toContain('Bot ou destino padrao nao configurado no servidor.');
    expect(componente().estadoTeste()).toBe('falha');
    expect(componente().cooldown()).toBe(0);
    expect(componente().podeTestar()).toBe(true);
  });

  it('respeita o cooldown devolvido pelo throttle do backend', () => {
    fixture.detectChanges();
    pedidoConfig().flush(config());
    fixture.detectChanges();

    botaoTestar().click();
    pedidoTeste().flush({ enviado: false, motivo: 'Aguarde para enviar outro teste.', cooldownRestanteSegundos: 30 });
    fixture.detectChanges();

    expect(componente().cooldown()).toBe(30);
    expect(componente().podeTestar()).toBe(false);

    vi.advanceTimersByTime(30_000);
    fixture.detectChanges();
    expect(componente().podeTestar()).toBe(true);
  });

  it('mostra mensagem de erro quando a própria chamada de teste falha', () => {
    fixture.detectChanges();
    pedidoConfig().flush(config());
    fixture.detectChanges();

    botaoTestar().click();
    pedidoTeste().flush(erroApi('Servico indisponivel'), { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(componente().estadoTeste()).toBe('falha');
    expect(texto()).toContain('Servico indisponivel');
  });

  it('mantém o botão bloqueado quando o canal está desabilitado ou sem destino', () => {
    fixture.detectChanges();
    pedidoConfig().flush(config({ telegramEnabled: false, dispatcherEnabled: false }));
    fixture.detectChanges();

    expect(componente().podeTestar()).toBe(false);
    expect(botaoTestar().disabled).toBe(true);
    // Canal desligado não deve exibir o alerta de fila parada: não há o que acumular.
    expect(texto()).not.toContain('as notificações ficam acumuladas');
  });

  it('alerta quando o canal está habilitado mas o processador de fila está parado', () => {
    fixture.detectChanges();
    pedidoConfig().flush(config({ dispatcherEnabled: false }));
    fixture.detectChanges();

    expect(texto()).toContain('as notificações ficam acumuladas');
  });

  // ---------------------------------------------------- isolamento de erro
  it('falha ao carregar a configuração não quebra a aba e permite tentar de novo', () => {
    fixture.detectChanges();
    pedidoConfig().flush(erroApi('Falha ao ler a configuracao'), { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(componente().estado()).toBe('error');
    expect(texto()).toContain('Não foi possível carregar a configuração.');
    expect(texto()).toContain('Falha ao ler a configuracao');

    const tentarNovamente = fixture.nativeElement.querySelector('.aviso .botao') as HTMLButtonElement;
    tentarNovamente.click();
    pedidoConfig().flush(config());
    fixture.detectChanges();

    expect(componente().estado()).toBe('success');
    expect(texto()).toContain('@infra_monitor_bot');
  });
});

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { EquipmentOperationalStatus } from '../../core/models/api-enums';
import { DashboardEquipamentoLista } from '../../core/models/dashboard';
import { EquipamentoResponse } from '../../core/models/equipamento';
import { AuthStateService } from '../../core/services/auth-state.service';
import { EquipamentoListComponent } from './equipamento-list.component';

function linha(overrides: Partial<DashboardEquipamentoLista> & { id: number }): DashboardEquipamentoLista {
  return {
    nome: `EQ-${overrides.id}`,
    tipoNome: 'Switch',
    unidadeId: 1,
    unidadeNome: 'Matriz',
    hostname: `eq-${overrides.id}.local`,
    ip: `10.0.0.${overrides.id}`,
    status: EquipmentOperationalStatus.Available,
    latenciaMs: 13,
    ativo: true,
    localizacao: `Rack ${overrides.id}`,
    numeroSerie: `SN-000${overrides.id}`,
    emManutencao: false,
    manutencaoManual: false,
    janelaAtivaId: null,
    janelaAtivaFim: null,
    ...overrides,
  };
}

const CADASTRO_COMPLETO: EquipamentoResponse = {
  id: 1,
  nome: 'EQ-1',
  ip: '10.0.0.1',
  hostname: 'eq-1.local',
  descricao: 'Switch de núcleo',
  localizacao: 'Rack 03',
  numeroSerie: 'SN-0001',
  fabricante: 'Cisco',
  modelo: 'Catalyst 9200-24T',
  ativo: true,
  emManutencao: false,
  manutencaoManual: false,
  unidade: { id: 1, nome: 'Matriz' },
  tipoEquipamento: { id: 2, nome: 'Switch' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('EquipamentoListComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EquipamentoListComponent],
      providers: [provideRouter([
        { path: 'equipamentos', component: EquipamentoListComponent },
        { path: 'equipamentos/:id', component: EquipamentoListComponent },
      ]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function montar(inventario: DashboardEquipamentoLista[]): ComponentFixture<EquipamentoListComponent> {
    const fixture = TestBed.createComponent(EquipamentoListComponent);
    fixture.detectChanges();
    http.expectOne((requisicao) => requisicao.url.endsWith('/unidades')).flush([
      { id: 1, nome: 'Matriz', sigla: 'MAT', descricao: null, ativo: true, createdAt: '', updatedAt: '' },
    ]);
    http.expectOne((requisicao) => requisicao.url.endsWith('/tipos-equipamento')).flush([
      { id: 2, nome: 'Switch', descricao: null, ativo: true, createdAt: '', updatedAt: '' },
    ]);
    http.expectOne((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos')).flush(inventario);
    fixture.detectChanges();
    return fixture;
  }

  function texto(fixture: ComponentFixture<EquipamentoListComponent>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('carrega o inventário completo de uma vez e o pagina em memória', () => {
    const fixture = montar(Array.from({ length: 25 }, (_, indice) => linha({ id: indice + 1 })));

    expect(texto(fixture)).toContain('25 de 25 dispositivos');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr').length).toBe(20);

    const paginacao = (fixture.nativeElement as HTMLElement).querySelector('.paginacao') as HTMLElement;
    expect(paginacao.textContent).toContain('Página 1 de 2');
    paginacao.querySelector<HTMLButtonElement>('button:last-of-type')!.click();
    fixture.detectChanges();

    // Trocar de página não fala com o servidor: o inventário inteiro já está em memória.
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr').length).toBe(5);
  });

  it('busca em memória por todos os campos que o placeholder promete, sem refetch', () => {
    const inventario = [
      linha({ id: 1, nome: 'SW-CORE', localizacao: 'CPD Térreo', numeroSerie: 'ABC-999' }),
      linha({ id: 2, nome: 'AP-RECEPCAO', unidadeId: 2, unidadeNome: 'Filial', tipoNome: 'Access Point' }),
    ];

    for (const [termo, esperado] of [
      ['filial', 'AP-RECEPCAO'],
      ['access point', 'AP-RECEPCAO'],
      ['eq-1.local', 'SW-CORE'],
      ['10.0.0.1', 'SW-CORE'],
      ['cpd térreo', 'SW-CORE'],
      ['abc-999', 'SW-CORE'],
    ] as const) {
      const fixture = montar(inventario);
      const busca = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#busca-equipamentos')!;
      busca.value = termo;
      busca.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(texto(fixture)).toContain(esperado);
      expect(texto(fixture)).toContain('1 de 2 dispositivos');
      fixture.destroy();
    }
  });

  it('mantém o painel de filtros fechado e sinaliza quantos filtros estão ativos', () => {
    const fixture = montar([
      linha({ id: 1 }),
      linha({ id: 2, unidadeId: 2, unidadeNome: 'Filial' }),
    ]);
    const elemento = fixture.nativeElement as HTMLElement;

    expect(elemento.querySelector('#painel-filtros')).toBeNull();

    elemento.querySelector<HTMLButtonElement>('.equipamentos__filtros-gatilho')!.click();
    fixture.detectChanges();
    expect(elemento.querySelector('#painel-filtros')).not.toBeNull();
    expect(elemento.querySelector('.equipamentos__contador-filtros')).toBeNull();

    const unidade = elemento.querySelectorAll<HTMLSelectElement>('#painel-filtros select')[0];
    unidade.value = '2';
    unidade.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(elemento.querySelector('.equipamentos__contador-filtros')?.textContent?.trim()).toBe('1');
    expect(elemento.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('mostra "timeout" no lugar da latência quando o equipamento está offline', () => {
    const fixture = montar([linha({ id: 1, status: EquipmentOperationalStatus.Unavailable, latenciaMs: null })]);

    expect((fixture.nativeElement as HTMLElement).querySelector('.down')?.textContent).toContain('timeout');
  });

  it('rotula a coluna de monitoramento a partir do campo ativo, com o chip-ativo compartilhado', () => {
    const fixture = montar([linha({ id: 1, ativo: true }), linha({ id: 2, ativo: false })]);
    const elemento = fixture.nativeElement as HTMLElement;
    const chips = elemento.querySelectorAll('.chip-ativo');

    expect(chips[0].textContent?.trim()).toBe('Ativado');
    expect(chips[0].classList).not.toContain('chip-ativo--off');
    expect(chips[1].textContent?.trim()).toBe('Desativado');
    expect(chips[1].classList).toContain('chip-ativo--off');
    expect(elemento.querySelector('.chip-monitoramento')).toBeNull();
  });

  it('usa mono só no que se compara caractere a caractere: IP e hostname, não o nome', () => {
    const fixture = montar([linha({ id: 1 })]);
    const celulas = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('tbody tr:first-child td');

    expect(celulas[0].textContent?.trim()).toBe('EQ-1');
    expect(celulas[0].querySelector('.mono')).toBeNull();
    expect(celulas[0].classList).not.toContain('mono');
    expect(celulas[3].textContent?.trim()).toBe('eq-1.local');
    expect(celulas[3].classList).toContain('mono');
    expect(celulas[4].textContent?.trim()).toBe('10.0.0.1');
    expect(celulas[4].classList).toContain('mono');
  });

  // ---- Modal compartilhado ----------------------------------------------------

  function preencherCriacao(fixture: ComponentFixture<EquipamentoListComponent>): void {
    fixture.componentInstance['abrirCriacao']();
    fixture.componentInstance['form'].patchValue({ nome: 'SW-1', tipoEquipamentoId: 2, unidadeId: 1, ip: '10.0.0.9' });
    fixture.detectChanges();
  }

  function escape(): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  }

  it('abre a criação no app-modal e fecha com Escape sem foco prévio em nada', () => {
    const fixture = montar([]);
    const elemento = fixture.nativeElement as HTMLElement;
    preencherCriacao(fixture);

    expect(elemento.querySelector('app-modal section.modal form.modal-form')).not.toBeNull();
    expect(elemento.querySelector('app-modal section.modal')?.textContent).toContain('Novo equipamento');
    expect(elemento.querySelector('.dialog-backdrop, .equipamento-modal')).toBeNull();

    escape();
    fixture.detectChanges();

    expect(elemento.querySelector('app-modal section.modal')).toBeNull();
  });

  it('durante a gravação o Escape não fecha e o × fica desabilitado', () => {
    const fixture = montar([]);
    const elemento = fixture.nativeElement as HTMLElement;
    preencherCriacao(fixture);

    elemento.querySelector<HTMLFormElement>('app-modal form.modal-form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    const post = http.expectOne((requisicao) => requisicao.method === 'POST');

    escape();
    fixture.detectChanges();

    expect(elemento.querySelector('app-modal section.modal')).not.toBeNull();
    expect(elemento.querySelector<HTMLButtonElement>('app-modal .modal__fechar')!.disabled).toBe(true);

    post.flush({ ...CADASTRO_COMPLETO, nome: 'SW-1' });
    http.expectOne((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos')).flush([]);
    fixture.detectChanges();
    expect(elemento.querySelector('app-modal section.modal')).toBeNull();
  });

  it('carrega o cadastro completo na edição e reenvia todos os campos ao salvar sem alterações', () => {
    const fixture = montar([linha({ id: 1 })]);

    fixture.componentInstance['executarAcao'](linha({ id: 1 }), 'editar');
    fixture.detectChanges();

    http.expectOne((requisicao) => requisicao.url.endsWith('/equipamentos/1')).flush(CADASTRO_COMPLETO);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>('app-modal form.modal-form')!
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const put = http.expectOne((requisicao) => requisicao.method === 'PUT' && requisicao.url.endsWith('/equipamentos/1'));
    // Round-trip: abrir em edição e salvar sem tocar em nada não pode perder campo algum.
    expect(put.request.body).toEqual({
      unidadeId: 1,
      tipoEquipamentoId: 2,
      nome: 'EQ-1',
      ip: '10.0.0.1',
      hostname: 'eq-1.local',
      descricao: 'Switch de núcleo',
      localizacao: 'Rack 03',
      numeroSerie: 'SN-0001',
      fabricante: 'Cisco',
      modelo: 'Catalyst 9200-24T',
    });
    put.flush(CADASTRO_COMPLETO);
    http.expectOne((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos')).flush([linha({ id: 1 })]);
  });

  it('não promete exclusão e mostra no diálogo a recusa vinda da API', () => {
    const fixture = montar([linha({ id: 1, nome: 'SW-CORE' })]);

    fixture.componentInstance['executarAcao'](linha({ id: 1, nome: 'SW-CORE' }), 'excluir');
    fixture.detectChanges();

    expect(texto(fixture)).toContain('só pode ser excluído se não houver monitores associados');
    expect(texto(fixture)).not.toContain('não pode ser desfeita');

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.botao--perigo')!.click();
    http.expectOne((requisicao) => requisicao.method === 'DELETE').flush(
      { code: 'BUSINESS_CONFLICT', message: 'Nao e possivel excluir o equipamento porque existem monitores associados', status: 409, error: 'Conflict', path: '/api/v1/equipamentos/1', timestamp: '' },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Nao e possivel excluir o equipamento porque existem monitores associados');
  });

  it('avisa que desativar fecha a janela de monitoramento e afeta o relatório', () => {
    const fixture = montar([linha({ id: 1, nome: 'SW-CORE' })]);

    fixture.componentInstance['executarAcao'](linha({ id: 1, nome: 'SW-CORE' }), 'desativar');
    fixture.detectChanges();

    expect(texto(fixture)).toContain('janela de monitoramento em andamento é fechada');
    expect(texto(fixture)).toContain('relatório de disponibilidade');
  });

  it('mostra estado vazio por filtro distinto do inventário vazio', () => {
    const vazio = montar([]);
    expect(texto(vazio)).toContain('Nenhum equipamento cadastrado');

    const comBusca = montar([linha({ id: 1, nome: 'SW-CORE' })]);
    const busca = (comBusca.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#busca-equipamentos')!;
    busca.value = 'inexistente';
    busca.dispatchEvent(new Event('input'));
    comBusca.detectChanges();

    expect(texto(comBusca)).toContain('Nenhum equipamento corresponde aos critérios');
  });

  it('mantém a tela de pé quando o inventário falha, com retry isolado', () => {
    const fixture = TestBed.createComponent(EquipamentoListComponent);
    fixture.detectChanges();
    http.expectOne((requisicao) => requisicao.url.endsWith('/unidades')).flush([]);
    http.expectOne((requisicao) => requisicao.url.endsWith('/tipos-equipamento')).flush([]);
    http.expectOne((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos'))
      .flush('erro', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Não foi possível carregar o inventário');

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.vazio .botao')!.click();
    http.expectOne((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos')).flush([linha({ id: 1 })]);
    fixture.detectChanges();

    expect(texto(fixture)).toContain('EQ-1');
  });

  // ---- Rota /equipamentos/:id -------------------------------------------------

  /** Responde às três chamadas que a própria lista faz ao montar. */
  function responderLista(harness: RouterTestingHarness): void {
    harness.detectChanges();
    http.match((requisicao) => requisicao.url.endsWith('/unidades')).forEach((r) => r.flush([]));
    http.match((requisicao) => requisicao.url.endsWith('/tipos-equipamento')).forEach((r) => r.flush([]));
    http.match((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos')).forEach((r) => r.flush([linha({ id: 7 })]));
    harness.detectChanges();
  }

  /** Lista + as chamadas de composição do drawer, sem afirmar conteúdo. */
  function responderTudo(harness: RouterTestingHarness): void {
    responderLista(harness);
    http.match(() => true).forEach((requisicao) => requisicao.flush(
      requisicao.request.url.includes('/api/v1/equipamentos/') ? CADASTRO_COMPLETO
        : { content: [], page: 0, size: 0, totalElements: 0, totalPages: 0, first: true, last: true }));
    harness.detectChanges();
  }

  it('abre o drawer direto no deep-link /equipamentos/:id, sem clique', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/equipamentos/7');
    responderTudo(harness);

    // O componente montado é a lista; o :id só decide se o drawer abre junto.
    expect(harness.routeNativeElement!.querySelector('app-equipamento-detalhe-drawer')).not.toBeNull();
    expect(harness.routeNativeElement!.textContent).toContain('EQ-7');
  });

  it('fechar o drawer navega de volta para /equipamentos limpo', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/equipamentos/7');
    responderTudo(harness);

    harness.routeNativeElement!.querySelector<HTMLButtonElement>('.gaveta__fechar')!.click();
    await harness.fixture.whenStable();
    // A lista é remontada pela rota sem `:id` e refaz a própria carga.
    responderLista(harness);

    expect(TestBed.inject(Router).url).toBe('/equipamentos');
    expect(harness.routeNativeElement!.querySelector('app-equipamento-detalhe-drawer')).toBeNull();
  });

  it('o link cross-page para /equipamentos/:id continua valendo sem edição na origem', async () => {
    const harness = await RouterTestingHarness.create();
    // Mesmo href emitido por Relatórios e pela aba Equipamentos do detalhe de unidade.
    await harness.navigateByUrl('/equipamentos/7');
    responderTudo(harness);

    expect(TestBed.inject(Router).url).toBe('/equipamentos/7');
    expect(harness.routeNativeElement!.querySelector('app-equipamento-detalhe-drawer')).not.toBeNull();
  });

  it('fechar o modal aberto pela gaveta devolve o foco ao "Editar", dentro da gaveta', async () => {
    TestBed.inject(AuthStateService).setSession({
      accessToken: 'test', tokenType: 'Bearer', expiresIn: 60,
      usuario: { id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN', trocaSenhaObrigatoria: false },
    });
    // O jsdom não implementa `inert`; no navegador, focus() em elemento sob ancestral inerte
    // falha em silêncio. Simular isso é o que deixa o teste pegar a ordem errada.
    const focoOriginal = HTMLElement.prototype.focus;
    const espiao = vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, opcoes?: FocusOptions) {
      if (this.closest('[inert]')) return;
      focoOriginal.call(this, opcoes);
    });

    try {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/equipamentos/7');
      responderTudo(harness);
      const raiz = harness.routeNativeElement!;
      const gaveta = raiz.querySelector<HTMLElement>('app-equipamento-detalhe-drawer')!;

      const editar = Array.from(gaveta.querySelectorAll<HTMLButtonElement>('.gaveta__acoes button'))
        .find((botao) => botao.textContent?.includes('Editar'))!;
      editar.focus();
      editar.click();
      harness.detectChanges();
      http.expectOne((requisicao) => requisicao.url.endsWith('/equipamentos/7')).flush({ ...CADASTRO_COMPLETO, id: 7, nome: 'EQ-7' });
      harness.detectChanges();

      expect(gaveta.hasAttribute('inert')).toBe(true);
      expect(raiz.querySelector('app-modal section.modal')?.contains(document.activeElement)).toBe(true);

      escape();
      harness.detectChanges();
      await harness.fixture.whenStable();
      await new Promise((resolver) => setTimeout(resolver, 0));

      expect(raiz.querySelector('app-modal section.modal')).toBeNull();
      expect(gaveta.hasAttribute('inert')).toBe(false);
      expect(document.activeElement).not.toBe(document.body);
      expect(gaveta.contains(document.activeElement)).toBe(true);
      // O app-modal devolve ao gatilho; o painel da gaveta só entra se o gatilho não recebeu o foco.
      expect(document.activeElement).toBe(editar);
    } finally {
      espiao.mockRestore();
    }
  });

  describe('validação do IP no formulário', () => {
    const IPV6 = 'Apenas IPv4 é suportado: o monitoramento ICMP não sonda IPv6';

    function abrirCriacaoComIp(ip: string): ComponentFixture<EquipamentoListComponent> {
      const fixture = montar([]);
      fixture.componentInstance['abrirCriacao']();
      fixture.componentInstance['form'].patchValue({ nome: 'SW-1', tipoEquipamentoId: 2, unidadeId: 1, ip });
      fixture.detectChanges();
      return fixture;
    }

    function enviar(fixture: ComponentFixture<EquipamentoListComponent>): void {
      (fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>('app-modal form.modal-form')!
        .dispatchEvent(new Event('submit'));
      fixture.detectChanges();
    }

    it('recusa IPv6 sem chamar a API e mostra o motivo uma única vez, sob o campo', () => {
      const fixture = abrirCriacaoComIp('2001:db8::1');
      enviar(fixture);

      http.expectNone((requisicao) => requisicao.method === 'POST');
      const raiz = fixture.nativeElement as HTMLElement;
      const erro = raiz.querySelector('#equipamento-ip-erro');
      expect(erro?.textContent?.trim()).toBe(IPV6);
      expect(raiz.querySelector('input[formControlName="ip"]')?.getAttribute('aria-invalid')).toBe('true');
      const repetidos = Array.from(raiz.querySelectorAll('small.field-error')).filter((el) => el.textContent?.trim() === IPV6);
      expect(repetidos.length).toBe(1);
    });

    it('aceita na edição o IP já cadastrado e salva via PUT', () => {
      const fixture = montar([linha({ id: 1 })]);
      fixture.componentInstance['executarAcao'](linha({ id: 1 }), 'editar');
      fixture.detectChanges();
      http.expectOne((requisicao) => requisicao.url.endsWith('/equipamentos/1')).flush({ ...CADASTRO_COMPLETO, ip: '10.0.0.10' });
      fixture.detectChanges();

      expect(fixture.componentInstance['form'].get('ip')?.valid).toBe(true);
      enviar(fixture);
      const put = http.expectOne((requisicao) => requisicao.method === 'PUT' && requisicao.url.endsWith('/equipamentos/1'));
      expect(put.request.body.ip).toBe('10.0.0.10');
      put.flush(CADASTRO_COMPLETO);
      http.expectOne((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos')).flush([linha({ id: 1 })]);
    });

    it.each(['010.0.0.1', '0.0.0.0'])('não mostra dica informativa quando %s é recusado', (ip) => {
      const fixture = abrirCriacaoComIp(ip);
      fixture.componentInstance['avaliarIp'](ip);
      fixture.detectChanges();

      expect(fixture.componentInstance['dicaIp']()).toBeNull();
      expect((fixture.nativeElement as HTMLElement).querySelector('.equipamento-modal__dica')).toBeNull();
    });

    it('mantém a dica informativa para IP aceito', () => {
      const fixture = abrirCriacaoComIp('10.0.0.1');
      fixture.componentInstance['avaliarIp']('10.0.0.1');
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).querySelector('.equipamento-modal__dica')?.textContent?.trim())
        .toBe('IPv4 · faixa privada');
    });

    it('aceita IP com espaços nas pontas e envia aparado', () => {
      const fixture = abrirCriacaoComIp(' 10.0.0.1 ');
      expect(fixture.componentInstance['form'].get('ip')?.valid).toBe(true);
      enviar(fixture);

      const post = http.expectOne((requisicao) => requisicao.method === 'POST' && requisicao.url.endsWith('/equipamentos'));
      expect(post.request.body.ip).toBe('10.0.0.1');
      post.flush({ ...CADASTRO_COMPLETO, nome: 'SW-1' });
      http.expectOne((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos')).flush([]);
    });
  });

  describe('manutenção', () => {
    function itens(fixture: ComponentFixture<EquipamentoListComponent>, l: DashboardEquipamentoLista) {
      return fixture.componentInstance['itensDoMenu'](l) as { id: string; rotulo: string; desabilitado?: boolean }[];
    }
    function comPermissao(pode: boolean) {
      vi.spyOn(TestBed.inject(AuthStateService), 'canManageInventory').mockReturnValue(pode);
    }

    it('oferece Iniciar para ativo fora de manutenção, logo depois de ativar/desativar', () => {
      comPermissao(true);
      const fixture = montar([linha({ id: 1 })]);
      const ids = itens(fixture, linha({ id: 1 })).map((i) => i.id);
      expect(ids).toEqual(['ver', 'editar', 'desativar', 'iniciarManutencao', 'excluir']);
      expect(itens(fixture, linha({ id: 1 }))[3].rotulo).toBe('Iniciar manutenção');
    });

    it('oferece Encerrar mesmo com o equipamento inativo (status DESABILITADO mascara a manutenção)', () => {
      comPermissao(true);
      const l = linha({ id: 1, ativo: false, emManutencao: true, status: EquipmentOperationalStatus.Disabled });
      const fixture = montar([l]);
      const item = itens(fixture, l).find((i) => i.id === 'encerrarManutencao');
      expect(item?.rotulo).toBe('Encerrar manutenção');
      expect(itens(fixture, l).some((i) => i.id === 'iniciarManutencao')).toBe(false);
    });

    it('não oferece manutenção a equipamento inativo fora de manutenção', () => {
      comPermissao(true);
      const l = linha({ id: 1, ativo: false });
      const fixture = montar([l]);
      expect(itens(fixture, l).some((i) => i.id.includes('Manutencao'))).toBe(false);
    });

    it('desabilita o item sem permissão de gestão', () => {
      comPermissao(false);
      const fixture = montar([linha({ id: 1 })]);
      expect(itens(fixture, linha({ id: 1 })).find((i) => i.id === 'iniciarManutencao')?.desabilitado).toBe(true);
    });

    it('confirma o início com texto dos efeitos e botão primário, e chama a API certa', () => {
      comPermissao(true);
      const fixture = montar([linha({ id: 1, nome: 'SW-CORE' })]);
      fixture.componentInstance['executarAcao'](linha({ id: 1, nome: 'SW-CORE' }), 'iniciarManutencao');
      fixture.detectChanges();

      expect(texto(fixture)).toContain('Iniciar manutenção de SW-CORE?');
      expect(texto(fixture)).toContain('deixa de ser verificado por ICMP');
      expect(texto(fixture)).toContain('encerrados com motivo Manutenção');
      expect(texto(fixture)).toContain('aviso de encerramento');
      expect(texto(fixture)).toContain('não conta no relatório de disponibilidade');
      const confirmar = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('app-confirm-dialog .botao--primario')!;
      expect(confirmar.textContent).toContain('Iniciar manutenção');
      confirmar.click();

      http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/equipamentos/1/manutencao/iniciar')).flush({});
      http.expectOne((r) => r.url.endsWith('/dashboard/equipamentos')).flush([linha({ id: 1, nome: 'SW-CORE', emManutencao: true, status: EquipmentOperationalStatus.Maintenance })]);
      fixture.detectChanges();
      expect(texto(fixture)).toContain('SW-CORE em manutenção.');
    });

    it('confirma o encerramento e chama a API certa', () => {
      comPermissao(true);
      const l = linha({ id: 1, nome: 'SW-CORE', emManutencao: true, status: EquipmentOperationalStatus.Maintenance });
      const fixture = montar([l]);
      fixture.componentInstance['executarAcao'](l, 'encerrarManutencao');
      fixture.detectChanges();

      expect(texto(fixture)).toContain('Encerrar manutenção de SW-CORE?');
      expect(texto(fixture)).toContain('volta a ser verificado por ICMP na próxima varredura');
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('app-confirm-dialog .botao--primario')!.click();
      http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/equipamentos/1/manutencao/encerrar')).flush({});
      http.expectOne((r) => r.url.endsWith('/dashboard/equipamentos')).flush([linha({ id: 1, nome: 'SW-CORE' })]);
      fixture.detectChanges();
      expect(texto(fixture)).toContain('Manutenção de SW-CORE encerrada.');
    });

    it('mostra no diálogo a recusa da API', () => {
      comPermissao(true);
      const fixture = montar([linha({ id: 1 })]);
      fixture.componentInstance['executarAcao'](linha({ id: 1 }), 'iniciarManutencao');
      fixture.detectChanges();
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('app-confirm-dialog .botao--primario')!.click();
      http.expectOne((r) => r.url.endsWith('/manutencao/iniciar')).flush(
        { code: 'BUSINESS_CONFLICT', message: 'Recusado pela API', status: 409, error: 'Conflict', path: '', timestamp: '' },
        { status: 409, statusText: 'Conflict' });
      fixture.detectChanges();
      expect(texto(fixture)).toContain('Recusado pela API');
    });

    it('excluir continua com botão de perigo', () => {
      const fixture = montar([linha({ id: 1 })]);
      fixture.componentInstance['executarAcao'](linha({ id: 1 }), 'excluir');
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('app-confirm-dialog .botao--perigo')).not.toBeNull();
    });
  });
});

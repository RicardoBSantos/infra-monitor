import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EquipmentOperationalStatus } from '../../core/models/api-enums';
import { DashboardEquipamentoLista } from '../../core/models/dashboard';
import { TipoEquipamentoResponse } from '../../core/models/tipo-equipamento';
import { AuthStateService } from '../../core/services/auth-state.service';
import { TipoEquipamentoListComponent } from './tipo-equipamento-list.component';

function tipo(overrides: Partial<TipoEquipamentoResponse> & { id: number }): TipoEquipamentoResponse {
  return {
    nome: `Tipo ${overrides.id}`,
    descricao: null,
    ativo: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function equipamento(overrides: Partial<DashboardEquipamentoLista> & { id: number }): DashboardEquipamentoLista {
  return {
    nome: `EQ-${overrides.id}`,
    tipoNome: 'Switch',
    unidadeId: 1,
    unidadeNome: 'Matriz',
    hostname: null,
    ip: null,
    status: EquipmentOperationalStatus.Available,
    latenciaMs: 10,
    ativo: true,
    localizacao: null,
    numeroSerie: null,
    emManutencao: false,
    ...overrides,
  };
}

describe('TipoEquipamentoListComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TipoEquipamentoListComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    // O menu de ações depende do papel: sem sessão, tudo aparece desabilitado.
    TestBed.inject(AuthStateService).setSession({
      accessToken: 'token', tokenType: 'Bearer', expiresIn: 3600,
      usuario: { id: 1, nome: 'Admin', email: 'admin@local', papel: 'ADMIN', trocaSenhaObrigatoria: false },
    });
  });

  afterEach(() => http.verify());

  function montar(tipos: TipoEquipamentoResponse[], inventario: DashboardEquipamentoLista[] | 'erro' = []) {
    const fixture = TestBed.createComponent(TipoEquipamentoListComponent);
    fixture.detectChanges();
    http.expectOne((requisicao) => requisicao.url.endsWith('/tipos-equipamento')).flush(tipos);
    const agregacao = http.expectOne((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos'));
    if (inventario === 'erro') agregacao.flush('erro', { status: 500, statusText: 'Server Error' });
    else agregacao.flush(inventario);
    fixture.detectChanges();
    return fixture;
  }

  function texto(fixture: ComponentFixture<TipoEquipamentoListComponent>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function celulas(fixture: ComponentFixture<TipoEquipamentoListComponent>, linha = 0): string[] {
    const linhas = (fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr');
    return [...linhas[linha].querySelectorAll('td')].map((celula) => celula.textContent!.trim());
  }

  it('agrega as contagens operacionais por tipo a partir do inventário', () => {
    const fixture = montar([tipo({ id: 1, nome: 'Switch' }), tipo({ id: 2, nome: 'Nobreak' })], [
      equipamento({ id: 1 }),
      equipamento({ id: 2, status: EquipmentOperationalStatus.Degraded }),
      equipamento({ id: 3, status: EquipmentOperationalStatus.Unavailable }),
      // Fora das três colunas: entra só em DISPOSITIVOS, por definição da tela.
      equipamento({ id: 4, status: EquipmentOperationalStatus.NoData }),
      equipamento({ id: 5, tipoNome: 'Nobreak', status: EquipmentOperationalStatus.Unavailable }),
    ]);

    expect(celulas(fixture).slice(0, 6)).toEqual(['Switch', '—', '4', '1', '1', '1']);
    expect(celulas(fixture, 1).slice(0, 6)).toEqual(['Nobreak', '—', '1', '0', '0', '1']);
  });

  it('mostra zero para o tipo sem equipamento, e não "—"', () => {
    const fixture = montar([tipo({ id: 1, nome: 'Firewall' })], [equipamento({ id: 1, tipoNome: 'Switch' })]);

    expect(celulas(fixture).slice(2, 6)).toEqual(['0', '0', '0', '0']);
  });

  it('mantém a lista funcional quando a agregação falha, com contagens em "—" e retry isolado', () => {
    const fixture = montar([tipo({ id: 1, nome: 'Switch' })], 'erro');

    expect(texto(fixture)).toContain('Contagens operacionais indisponíveis');
    expect(celulas(fixture).slice(2, 6)).toEqual(['—', '—', '—', '—']);

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.aviso--erro .botao')!.click();
    http.expectOne((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos'))
      .flush([equipamento({ id: 1 })]);
    fixture.detectChanges();

    expect(celulas(fixture).slice(2, 6)).toEqual(['1', '1', '0', '0']);
  });

  it('busca em memória por nome e descrição, sem refetch', () => {
    const fixture = montar([
      tipo({ id: 1, nome: 'Switch', descricao: 'Comutador de rede' }),
      tipo({ id: 2, nome: 'Nobreak', descricao: 'Fonte ininterrupta' }),
    ]);
    const busca = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#busca-tipos')!;

    busca.value = 'comutador';
    busca.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(texto(fixture)).toContain('1 de 2 tipos');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr').length).toBe(1);
    expect(celulas(fixture)[0]).toBe('Switch');
  });

  it('pagina em memória a partir de 20 linhas', () => {
    const fixture = montar(Array.from({ length: 25 }, (_, indice) => tipo({ id: indice + 1 })));

    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr').length).toBe(20);

    const paginacao = (fixture.nativeElement as HTMLElement).querySelector('.paginacao') as HTMLElement;
    expect(paginacao.textContent).toContain('Página 1 de 2');
    paginacao.querySelector<HTMLButtonElement>('button:last-of-type')!.click();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr').length).toBe(5);
  });

  it('troca de aba consultando o backend com o filtro ativo', () => {
    const fixture = montar([tipo({ id: 1, nome: 'Switch' })]);

    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.tipos__abas button')[2].click();
    const requisicao = http.expectOne((req) => req.url.endsWith('/tipos-equipamento') && req.params.get('ativo') === 'false');
    requisicao.flush([tipo({ id: 9, nome: 'Impressora', ativo: false })]);
    fixture.detectChanges();

    expect(celulas(fixture)[0]).toBe('Impressora');
    expect(celulas(fixture)[6]).toBe('Inativo');
  });

  it('bloqueia a exclusão do tipo em uso em vez de prometer o que a API recusa', () => {
    const fixture = montar([tipo({ id: 1, nome: 'Switch' })], [equipamento({ id: 1, tipoNome: 'Switch' })]);
    const itens = fixture.componentInstance['itensDoMenu'](tipo({ id: 1, nome: 'Switch' }));
    const excluir = itens.find((item) => item.id === 'excluir')!;

    expect(excluir.desabilitado).toBe(true);
    expect(excluir.rotulo).toBe('Excluir (1 em uso)');
  });

  it('libera a exclusão do tipo sem equipamentos e avisa que é permanente', () => {
    const fixture = montar([tipo({ id: 1, nome: 'Firewall' })], [equipamento({ id: 1, tipoNome: 'Switch' })]);
    const excluir = fixture.componentInstance['itensDoMenu'](tipo({ id: 1, nome: 'Firewall' }))
      .find((item) => item.id === 'excluir')!;
    expect(excluir.desabilitado).toBe(false);

    fixture.componentInstance['executarAcao'](tipo({ id: 1, nome: 'Firewall' }), 'excluir');
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Nenhum equipamento usa o tipo Firewall hoje');
    expect(texto(fixture)).toContain('não pode ser desfeita');
  });

  it('sem agregação mantém a exclusão possível e mostra a recusa real da API no diálogo', () => {
    const fixture = montar([tipo({ id: 1, nome: 'Switch' })], 'erro');
    const excluir = fixture.componentInstance['itensDoMenu'](tipo({ id: 1, nome: 'Switch' }))
      .find((item) => item.id === 'excluir')!;
    expect(excluir.desabilitado).toBe(false);

    fixture.componentInstance['executarAcao'](tipo({ id: 1, nome: 'Switch' }), 'excluir');
    fixture.detectChanges();
    expect(texto(fixture)).toContain('Não foi possível conferir quantos equipamentos usam o tipo Switch');

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.botao--perigo')!.click();
    http.expectOne((requisicao) => requisicao.method === 'DELETE').flush(
      {
        code: 'BUSINESS_CONFLICT',
        message: 'Nao e possivel excluir o tipo de equipamento porque existem equipamentos associados',
        status: 409, error: 'Conflict', path: '/api/v1/tipos-equipamento/1', timestamp: '',
      },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Nao e possivel excluir o tipo de equipamento porque existem equipamentos associados');
  });

  it('descreve a desativação como bloqueio de vínculo novo, não como parada de monitoramento', () => {
    const fixture = montar([tipo({ id: 1, nome: 'Switch' })]);

    fixture.componentInstance['executarAcao'](tipo({ id: 1, nome: 'Switch' }), 'desativar');
    fixture.detectChanges();

    expect(texto(fixture)).toContain('não poderão ser reativados');
    expect(texto(fixture)).toContain('continuam ativos e monitorados');
  });

  it('não oferece "Ver": não existe tela de detalhe de tipo', () => {
    const fixture = montar([tipo({ id: 1 })]);
    const itens = fixture.componentInstance['itensDoMenu'](tipo({ id: 1 }));

    expect(itens.map((item) => item.id)).toEqual(['editar', 'desativar', 'excluir']);
  });

  it('carrega os valores atuais na edição e envia nome e descrição no PUT', () => {
    const fixture = montar([tipo({ id: 1, nome: 'Switch', descricao: 'Comutador de rede' })]);

    fixture.componentInstance['executarAcao'](tipo({ id: 1, nome: 'Switch', descricao: 'Comutador de rede' }), 'editar');
    fixture.detectChanges();

    const modal = (fixture.nativeElement as HTMLElement).querySelector('app-modal form.modal-form')!;
    expect(modal.querySelector<HTMLInputElement>('input')!.value).toBe('Switch');
    expect(modal.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('Comutador de rede');

    modal.dispatchEvent(new Event('submit'));
    const put = http.expectOne((requisicao) => requisicao.method === 'PUT' && requisicao.url.endsWith('/tipos-equipamento/1'));
    expect(put.request.body).toEqual({ nome: 'Switch', descricao: 'Comutador de rede' });
    put.flush(tipo({ id: 1, nome: 'Switch', descricao: 'Comutador de rede' }));

    http.expectOne((requisicao) => requisicao.method === 'GET' && requisicao.url.endsWith('/tipos-equipamento')).flush([]);
    // Renomear muda a chave da agregação: o mapa é recarregado depois da edição.
    http.expectOne((requisicao) => requisicao.url.endsWith('/dashboard/equipamentos')).flush([]);
  });

  it('separa o vazio por filtro do vazio por busca', () => {
    const semCadastro = montar([]);
    expect(texto(semCadastro)).toContain('Nenhum tipo neste filtro');
    semCadastro.destroy();

    const comBusca = montar([tipo({ id: 1, nome: 'Switch' })]);
    const busca = (comBusca.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#busca-tipos')!;
    busca.value = 'inexistente';
    busca.dispatchEvent(new Event('input'));
    comBusca.detectChanges();

    expect(texto(comBusca)).toContain('Nenhum tipo corresponde à busca');
  });

  it('fecha o modal com Escape no document logo após abrir e devolve o foco ao botão', async () => {
    const fixture = montar([tipo({ id: 1 })]);
    const raiz = fixture.nativeElement as HTMLElement;
    document.body.appendChild(raiz);
    const botao = raiz.querySelector<HTMLButtonElement>('.pagina__cabecalho button')!;
    botao.focus();
    botao.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(raiz.querySelector('app-modal form.modal-form')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(raiz.querySelector('app-modal form.modal-form')).toBeNull();
    expect(document.activeElement).toBe(botao);
    raiz.remove();
  });

  it('usa a casca .pagina, .field-error no erro do campo e .chip-ativo--off no tipo inativo', () => {
    const fixture = montar([tipo({ id: 1, ativo: false })]);
    const raiz = fixture.nativeElement as HTMLElement;

    expect(raiz.querySelector('section.tipos.pagina')).not.toBeNull();
    expect(raiz.querySelector('.pagina__cabecalho h1')).not.toBeNull();
    expect(raiz.querySelector('p.pagina__descricao')).not.toBeNull();
    expect(raiz.querySelector('.chip-ativo.chip-ativo--off')).not.toBeNull();
    expect(raiz.querySelector('.chip-status')).toBeNull();

    raiz.querySelector<HTMLButtonElement>('.pagina__cabecalho button')!.click();
    fixture.detectChanges();
    raiz.querySelector<HTMLFormElement>('app-modal form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(raiz.querySelector('app-modal .field-error')).not.toBeNull();
    expect(raiz.querySelector('.campo-erro')).toBeNull();
  });
});

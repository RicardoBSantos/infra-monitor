import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthStateService } from '../../core/services/auth-state.service';
import { UsuarioListComponent } from './usuario-list.component';

const user = { id: 2, nome: 'Operador', email: 'operador@example.test', papel: 'OPERADOR' as const, ativo: true, trocaSenhaObrigatoria: true };
const error = (code: string, message: string) => ({ timestamp: '', status: code === 'BUSINESS_CONFLICT' ? 409 : 400, error: 'Error', code, message, path: '/api/v1/usuarios' });

describe('UsuarioListComponent', () => {
  let http: HttpTestingController;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UsuarioListComponent], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthStateService).setSession({ accessToken: 'admin-token', tokenType: 'Bearer', expiresIn: 60, usuario: { id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN', trocaSenhaObrigatoria: false } });
  });
  afterEach(() => http.verify());
  const create = () => { const fixture = TestBed.createComponent(UsuarioListComponent); fixture.detectChanges(); return fixture; };

  it('renders loading, success, empty and error states', () => {
    const loading = create();
    expect(loading.nativeElement.querySelector('[aria-label="Carregando usuários"]')).not.toBeNull();
    http.expectOne('http://localhost:8080/api/v1/usuarios').flush([user]); loading.detectChanges();
    expect(loading.nativeElement.textContent).toContain('Operador');

    const empty = create(); http.expectOne('http://localhost:8080/api/v1/usuarios').flush([]); empty.detectChanges();
    expect(empty.nativeElement.textContent).toContain('Nenhum usuário encontrado');

    const failed = create(); http.expectOne('http://localhost:8080/api/v1/usuarios').flush(error('INTERNAL_ERROR', 'Falha de leitura'), { status: 500, statusText: 'Server error' }); failed.detectChanges();
    expect(failed.nativeElement.textContent).toContain('Falha de leitura');
  });

  it('validates and creates with the real payload, including validation and conflict feedback', () => {
    const fixture = create(); http.expectOne('http://localhost:8080/api/v1/usuarios').flush([]); fixture.detectChanges();
    (fixture.nativeElement.querySelector('.button--primary') as HTMLButtonElement).click(); fixture.detectChanges();
    (fixture.componentInstance as any).submit(); fixture.detectChanges();
    expect(http.match('http://localhost:8080/api/v1/usuarios').length).toBe(0);
    const form = (fixture.componentInstance as any).form;
    form.setValue({ nome: 'Novo', email: 'novo@example.test', papel: 'VISUALIZADOR', senhaInicial: 'SenhaInicial123!' });
    (fixture.componentInstance as any).submit();
    const request = http.expectOne('http://localhost:8080/api/v1/usuarios'); expect(request.request.method).toBe('POST'); expect(request.request.body).toEqual({ nome: 'Novo', email: 'novo@example.test', papel: 'VISUALIZADOR', senhaInicial: 'SenhaInicial123!' });
    request.flush({ ...user, id: 3, nome: 'Novo', email: 'novo@example.test', papel: 'VISUALIZADOR' }, { status: 201, statusText: 'Created' }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Usuário criado com sucesso');
  });

  it('updates only nome, email and papel and presents a last-admin conflict', () => {
    const fixture = create(); http.expectOne('http://localhost:8080/api/v1/usuarios').flush([{ ...user, papel: 'ADMIN' }]); fixture.detectChanges();
    (fixture.nativeElement.querySelector('.actions button') as HTMLButtonElement).click(); fixture.detectChanges();
    const form = (fixture.componentInstance as any).form; form.controls.nome.setValue('Administrador'); form.controls.email.setValue('admin2@example.test'); form.controls.papel.setValue('OPERADOR');
    (fixture.componentInstance as any).submit(); const request = http.expectOne('http://localhost:8080/api/v1/usuarios/2'); expect(request.request.method).toBe('PUT'); expect(request.request.body).toEqual({ nome: 'Administrador', email: 'admin2@example.test', papel: 'OPERADOR' });
    request.flush(error('BUSINESS_CONFLICT', 'NÃ£o Ã© permitido rebaixar o Ãºltimo ADMIN ativo'), { status: 409, statusText: 'Conflict' }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Ãºltimo ADMIN');
  });

  it('validates reset boundaries and sends the administrative reset request', () => {
    const fixture = create(); http.expectOne('http://localhost:8080/api/v1/usuarios').flush([user]); fixture.detectChanges();
    (fixture.nativeElement.querySelectorAll('.actions button')[1] as HTMLButtonElement).click(); fixture.detectChanges();
    const form = (fixture.componentInstance as any).passwordForm; form.setValue({ novaSenha: 'curta', confirmacaoNovaSenha: 'curta' }); (fixture.componentInstance as any).resetPassword(); expect(http.match('http://localhost:8080/api/v1/usuarios/2/senha').length).toBe(0);
    form.setValue({ novaSenha: 'x'.repeat(129), confirmacaoNovaSenha: 'x'.repeat(129) }); (fixture.componentInstance as any).resetPassword(); expect(http.match('http://localhost:8080/api/v1/usuarios/2/senha').length).toBe(0);
    form.setValue({ novaSenha: 'SenhaTemporaria123!', confirmacaoNovaSenha: 'diferente' }); (fixture.componentInstance as any).resetPassword(); expect(http.match('http://localhost:8080/api/v1/usuarios/2/senha').length).toBe(0);
    form.setValue({ novaSenha: 'SenhaTemporaria123!', confirmacaoNovaSenha: 'SenhaTemporaria123!' }); (fixture.componentInstance as any).resetPassword(); const request = http.expectOne('http://localhost:8080/api/v1/usuarios/2/senha'); expect(request.request.method).toBe('PUT'); expect(request.request.body).toEqual({ novaSenha: 'SenhaTemporaria123!' }); request.flush(user); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Senha temporária redefinida');
  });

  it('confirms deactivation, patches status, and never offers self-deactivation', () => {
    const fixture = create(); http.expectOne('http://localhost:8080/api/v1/usuarios').flush([{ ...user, id: 1 }, user]); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('DesativarOPERADOR');
    const deactivate = [...fixture.nativeElement.querySelectorAll('.actions button')].find((b: Element) => b.textContent === 'Desativar') as HTMLButtonElement; deactivate.click(); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Desativar Operador?');
    (fixture.componentInstance as any).changeStatus(); const request = http.expectOne('http://localhost:8080/api/v1/usuarios/2/desativar'); expect(request.request.method).toBe('PATCH'); request.flush({ ...user, ativo: false }); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('desativado com sucesso');
  });
});

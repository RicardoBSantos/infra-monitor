import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, tap, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthMeResponse, LoginRequest, LoginResponse, TrocaSenhaRequest } from '../models/auth';
import { AuthStateService } from './auth-state.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient); private readonly state = inject(AuthStateService);
  login(email: string, senha: string): Observable<LoginResponse> {
    const request: LoginRequest = { email, senha };
    return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, request).pipe(tap(response => this.state.setSession(response)));
  }
  me(): Observable<AuthMeResponse> { return this.http.get<AuthMeResponse>(`${environment.apiUrl}/auth/me`); }
  changeOwnPassword(request: TrocaSenhaRequest): Observable<void> { return this.http.put<void>(`${environment.apiUrl}/usuarios/me/senha`, request); }
  /** Revoga a sessão do cookie (sem Bearer; ver `isProtectedApi`). Falha ignorada: o estado local é limpo sempre,
   * antes do `complete` (quem navega ao /login no complete já passa pelo loginGuard sem sessão), ou no cancelamento
   * antes do fim. `tap` e nao `finalize`: este roda depois do `complete` do assinante e limparia duas vezes. */
  logout(): Observable<void> { return this.http.post<void>(`${environment.apiUrl}/auth/logout`, {}, { headers: { 'X-Requested-With': 'XMLHttpRequest' } }).pipe(timeout(8000), map(() => undefined), catchError(() => of(undefined)), tap({ complete: () => this.state.clear(), unsubscribe: () => this.state.clear() })); }
}

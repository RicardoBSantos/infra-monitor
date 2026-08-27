import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
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
  logout(): void { this.state.clear(); }
}

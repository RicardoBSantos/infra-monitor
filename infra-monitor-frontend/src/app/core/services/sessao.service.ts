import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, defer, finalize, firstValueFrom, map, of, shareReplay, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LoginResponse } from '../models/auth';
import { AuthStateService } from './auth-state.service';

/** Refresh pelo cookie httpOnly. Sem `Authorization` (`isProtectedApi` exclui a rota): o filtro JWT do
 * backend devolve 401 a um Bearer vencido antes do `permitAll`. Contrato: 200 + LoginResponse, 204 sem
 * sessão, 403 sem `X-Requested-With`; nunca 401. */
@Injectable({ providedIn: 'root' })
export class SessaoService {
  private readonly http = inject(HttpClient); private readonly state = inject(AuthStateService);
  private emVoo: Observable<string | null> | null = null;
  /** Inicializador do app: nunca rejeita — inicializador rejeitado é tela branca. */
  restaurar(): Promise<void> { return firstValueFrom(this.renovar()).then(() => undefined, () => undefined); }
  /** Voo único: chamadas durante um refresh em andamento recebem o mesmo resultado. Token novo ou `null`. */
  renovar(): Observable<string | null> {
    return this.emVoo ??= defer(() => { const geracao = this.state.geracao(); return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/refresh`, {}, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, observe: 'response' }).pipe(
      timeout(8000),
      // Resposta de uma geração anterior (logout no meio do voo) é descartada.
      map(response => { if (response.status !== 200 || !response.body || geracao !== this.state.geracao()) return null; this.state.setSession(response.body); return response.body.accessToken; })); }).pipe(
      catchError(() => of(null)),
      finalize(() => { this.emVoo = null; }),
      shareReplay({ bufferSize: 1, refCount: false }));
  }
}

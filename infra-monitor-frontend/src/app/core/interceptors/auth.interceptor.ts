import { HttpContext, HttpContextToken, HttpErrorResponse, HttpEvent, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { isApiError } from '../models/api-error';
import { AuthStateService } from '../services/auth-state.service';
import { SessaoService } from '../services/sessao.service';

/** Marca a repetição feita após um refresh: um 401 nela vai ao login, sem segundo refresh (anti-laço). */
export const REPETIDA_APOS_REFRESH = new HttpContextToken<boolean>(() => false);
let redirecting401 = false;
/** Rotas autenticadas pelo cookie (refresh, logout) e o login nunca levam Bearer nem disparam refresh. */
const ROTAS_SEM_BEARER = ['/auth/login', '/auth/refresh', '/auth/logout'];
/** `apiUrl` pode ser absoluta (outra origem) ou relativa à origem (`/api/v1`, dev com proxy e produção). */
export function isProtectedApi(url: string, apiUrl: string = environment.apiUrl): boolean {
  const api = new URL(apiUrl, window.location.origin);
  const request = new URL(url, window.location.origin);
  return request.origin === api.origin && request.pathname.startsWith(api.pathname + '/') && !ROTAS_SEM_BEARER.some(rota => request.pathname === api.pathname + rota);
}
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthStateService); const router = inject(Router); const sessao = inject(SessaoService);
  const protectedRequest = isProtectedApi(request.url);
  const encerrar = (error: HttpErrorResponse): Observable<never> => {
    auth.clear();
    if (!redirecting401) { redirecting401 = true; router.navigate(['/login'], { queryParams: { sessionExpired: '1' } }).finally(() => { redirecting401 = false; }); }
    return throwError(() => error);
  };
  const enviar = (req: HttpRequest<unknown>, token: string | null): Observable<HttpEvent<unknown>> => next(protectedRequest && token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req).pipe(catchError((error: unknown) => {
    if (error instanceof HttpErrorResponse && error.status === 401 && protectedRequest) {
      if (req.context.get(REPETIDA_APOS_REFRESH)) return encerrar(error);
      return sessao.renovar().pipe(switchMap(novo => novo ? enviar(req.clone({ context: repetida(req.context) }), novo) : encerrar(error)));
    }
    if (error instanceof HttpErrorResponse && error.status === 403 && protectedRequest) {
      router.navigate([isApiError(error.error) && error.error.code === 'PASSWORD_CHANGE_REQUIRED' ? '/trocar-senha' : '/forbidden']);
    }
    return throwError(() => error);
  }));
  return enviar(request, auth.accessToken());
};
/** Cópia do contexto com a marca: `HttpContext.set` muda o objeto do chamador, que pode ser reutilizado. */
function repetida(context: HttpContext): HttpContext {
  const copia = new HttpContext(); for (const token of context.keys()) copia.set(token, context.get(token));
  return copia.set(REPETIDA_APOS_REFRESH, true);
}

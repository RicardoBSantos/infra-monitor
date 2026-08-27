import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { isApiError } from '../models/api-error';
import { AuthStateService } from '../services/auth-state.service';

let redirecting401 = false;
function isProtectedApi(url: string): boolean {
  const api = new URL(environment.apiUrl, window.location.origin);
  const request = new URL(url, window.location.origin);
  return request.origin === api.origin && request.pathname.startsWith(api.pathname + '/') && request.pathname !== `${api.pathname}/auth/login`;
}
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthStateService); const router = inject(Router);
  const protectedRequest = isProtectedApi(request.url);
  const token = auth.accessToken();
  const authorized = protectedRequest && token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;
  return next(authorized).pipe(catchError((error: unknown) => {
    if (error instanceof HttpErrorResponse && error.status === 401 && protectedRequest) {
      auth.clear();
      if (!redirecting401) { redirecting401 = true; router.navigate(['/login'], { queryParams: { sessionExpired: '1' } }).finally(() => { redirecting401 = false; }); }
    } else if (error instanceof HttpErrorResponse && error.status === 403 && protectedRequest) {
      router.navigate([isApiError(error.error) && error.error.code === 'PASSWORD_CHANGE_REQUIRED' ? '/trocar-senha' : '/forbidden']);
    }
    return throwError(() => error);
  }));
};

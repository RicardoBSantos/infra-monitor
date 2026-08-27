import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, from, mergeMap, of, throwError } from 'rxjs';

import { isApiError } from '../models/api-error';

/**
 * Keeps API error responses available to the component or form that initiated
 * the request. The backend payload is already the public error contract, so it
 * is deliberately not replaced by a generic client-side message.
 */
export const apiErrorInterceptor: HttpInterceptorFn = (_request, next) =>
  next(_request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && isApiError(error.error)) {
        return throwError(() => error);
      }

      if (error instanceof HttpErrorResponse && error.error instanceof Blob) {
        return from(error.error.text()).pipe(
          mergeMap(text => {
            let payload: unknown;
            try { payload = JSON.parse(text); } catch { return throwError(() => error); }
            return throwError(() => isApiError(payload) ? new HttpErrorResponse({
              error: payload, headers: error.headers, status: error.status, statusText: error.statusText, url: error.url ?? undefined,
            }) : error);
          }),
          catchError(parsed => parsed instanceof HttpErrorResponse ? throwError(() => parsed) : of(parsed).pipe(mergeMap(() => throwError(() => error)))),
        );
      }

      return throwError(() => error);
    }),
  );

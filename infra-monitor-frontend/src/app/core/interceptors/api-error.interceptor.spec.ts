import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ApiError, ApiErrorCode, isApiError } from '../models/api-error';
import { apiErrorInterceptor } from './api-error.interceptor';

describe('apiErrorInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('preserves validation fields from an API error', () => {
    const payload: ApiError = {
      timestamp: '2026-08-19T12:00:00Z',
      status: 400,
      error: 'Bad Request',
      code: ApiErrorCode.ValidationError,
      message: 'Requisicao invalida',
      path: '/api/v1/equipamentos',
      fields: { nome: 'must not be blank' },
    };
    let received: HttpErrorResponse | undefined;

    http.get('/api/v1/equipamentos').subscribe({ error: (error: HttpErrorResponse) => (received = error) });
    httpTesting.expectOne('/api/v1/equipamentos').flush(payload, { status: 400, statusText: 'Bad Request' });

    const receivedPayload = received?.error;

    expect(receivedPayload).toEqual(payload);
    expect(isApiError(receivedPayload)).toBe(true);
    if (isApiError(receivedPayload)) {
      expect(receivedPayload.fields).toEqual(payload.fields);
    }
  });

  it('preserves a 409 business conflict for the caller to handle', () => {
    const payload: ApiError = {
      timestamp: '2026-08-19T12:00:00Z',
      status: 409,
      error: 'Conflict',
      code: ApiErrorCode.BusinessConflict,
      message: 'Recurso em conflito',
      path: '/api/v1/unidades/1',
    };
    let received: HttpErrorResponse | undefined;

    http.get('/api/v1/unidades/1').subscribe({ error: (error: HttpErrorResponse) => (received = error) });
    httpTesting.expectOne('/api/v1/unidades/1').flush(payload, { status: 409, statusText: 'Conflict' });

    expect(received?.status).toBe(409);
    expect(received?.error).toEqual(payload);
  });

  it('parses the JSON error contract when a Blob endpoint fails', async () => {
    const payload: ApiError = { timestamp: '2026-08-25T00:00:00Z', status: 403, error: 'Forbidden', code: ApiErrorCode.PasswordChangeRequired, message: 'Troca obrigatória', path: '/api/v1/relatorios/medicoes/export' };
    let received: HttpErrorResponse | undefined;
    http.get('/api/v1/relatorios/medicoes/export', { responseType: 'blob' }).subscribe({ error: (error: HttpErrorResponse) => (received = error) });
    httpTesting.expectOne('/api/v1/relatorios/medicoes/export').flush(new Blob([JSON.stringify(payload)], { type: 'application/json' }), { status: 403, statusText: 'Forbidden' });
    await new Promise(resolve => setTimeout(resolve));
    expect(received?.error).toEqual(payload); expect(isApiError(received?.error)).toBe(true);
  });
});

import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';

import { ApiError, ApiErrorCode, isApiError } from '../../core/models/api-error';

const INVALID_FILENAME = /[\u0000-\u001f\u007f/\\:*?"<>|]/g;

export function fallbackCsvFilename(report: string, inicio: string, fim: string): string {
  return `${report}_${datePart(inicio)}_${datePart(fim)}.csv`;
}

export function csvFilename(headers: HttpHeaders, fallback: string): string {
  const disposition = headers.get('Content-Disposition');
  if (!disposition) return sanitizeCsvFilename(fallback, fallback);

  const extended = disposition.match(/(?:^|;)\s*filename\*\s*=\s*([^;]+)/i)?.[1]?.trim();
  const regular = disposition.match(/(?:^|;)\s*filename\s*=\s*("(?:\\.|[^"])*"|[^;]+)/i)?.[1]?.trim();
  const preferred = decodeExtendedFilename(extended) ?? decodeRegularFilename(regular);
  return sanitizeCsvFilename(preferred, fallback);
}

export function sanitizeCsvFilename(value: string | null | undefined, fallback: string): string {
  const cleaned = value?.normalize('NFC').replace(INVALID_FILENAME, '_').replace(/\.\.+/g, '_').trim().replace(/^[. ]+|[. ]+$/g, '');
  if (!cleaned) return sanitizeCsvFilename(fallback, 'relatorio.csv');
  return cleaned.toLocaleLowerCase().endsWith('.csv') ? cleaned : `${cleaned}.csv`;
}

export function downloadCsvBlob(blob: Blob, filename: string, documentRef: Document = document, urlRef: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL): void {
  const objectUrl = urlRef.createObjectURL(blob);
  const anchor = documentRef.createElement('a');
  try {
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    documentRef.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    urlRef.revokeObjectURL(objectUrl);
  }
}

export async function apiErrorFromBlob(error: unknown): Promise<ApiError> {
  if (error instanceof HttpErrorResponse && isApiError(error.error)) return error.error;
  if (error instanceof HttpErrorResponse && error.error instanceof Blob) {
    try {
      const parsed: unknown = JSON.parse(await error.error.text());
      if (isApiError(parsed)) return parsed;
    } catch {
      // A malformed or non-JSON error body intentionally falls through to a safe message.
    }
  }
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  return {
    timestamp: new Date().toISOString(), status, error: 'Erro de exportação',
    code: codeForStatus(status), message: 'Não foi possível exportar o relatório.', path: '',
  };
}

function decodeExtendedFilename(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const unquoted = stripQuotes(value);
  const match = unquoted.match(/^UTF-8''(.+)$/i);
  if (!match) return undefined;
  try { return decodeURIComponent(match[1]); } catch { return undefined; }
}

function decodeRegularFilename(value: string | undefined): string | undefined {
  return value ? stripQuotes(value).replace(/\\(["\\])/g, '$1') : undefined;
}

function stripQuotes(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function datePart(value: string): string {
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? 'data-invalida';
}

function codeForStatus(status: number): ApiErrorCode {
  if (status === 400) return ApiErrorCode.InvalidRequest;
  if (status === 401) return ApiErrorCode.Unauthorized;
  if (status === 403) return ApiErrorCode.Forbidden;
  if (status === 404) return ApiErrorCode.ResourceNotFound;
  if (status === 422) return ApiErrorCode.ExportLimitExceeded;
  return ApiErrorCode.InternalError;
}

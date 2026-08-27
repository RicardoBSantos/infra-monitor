export enum ApiErrorCode {
  AuthenticationFailed = 'AUTHENTICATION_FAILED',
  AccountDisabled = 'ACCOUNT_DISABLED',
  Unauthorized = 'UNAUTHORIZED',
  Forbidden = 'FORBIDDEN',
  PasswordChangeRequired = 'PASSWORD_CHANGE_REQUIRED',
  ValidationError = 'VALIDATION_ERROR',
  InvalidEnum = 'INVALID_ENUM',
  MalformedRequest = 'MALFORMED_REQUEST',
  InvalidParameter = 'INVALID_PARAMETER',
  InvalidRequest = 'INVALID_REQUEST',
  ResourceNotFound = 'RESOURCE_NOT_FOUND',
  ExportLimitExceeded = 'EXPORT_LIMIT_EXCEEDED',
  BusinessConflict = 'BUSINESS_CONFLICT',
  DataIntegrityViolation = 'DATA_INTEGRITY_VIOLATION',
  InternalError = 'INTERNAL_ERROR',
}

export interface ApiError {
  timestamp: string;
  status: number;
  error: string;
  code: ApiErrorCode;
  message: string;
  path: string;
  fields?: Record<string, string>;
}

export function isApiError(payload: unknown): payload is ApiError {
  if (!isRecord(payload)) {
    return false;
  }

  return typeof payload['timestamp'] === 'string'
    && typeof payload['status'] === 'number'
    && typeof payload['error'] === 'string'
    && isApiErrorCode(payload['code'])
    && typeof payload['message'] === 'string'
    && typeof payload['path'] === 'string'
    && (payload['fields'] === undefined || isStringRecord(payload['fields']));
}

function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && Object.values(ApiErrorCode).some((code) => code === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((field) => typeof field === 'string');
}

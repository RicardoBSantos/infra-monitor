import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ApiErrorCode } from '../../core/models/api-error';
import { apiErrorFromBlob, csvFilename, downloadCsvBlob, fallbackCsvFilename, sanitizeCsvFilename } from './report-csv-download';

describe('report CSV download', () => {
  const fallback = 'medicoes_2026-08-01_2026-08-25.csv';

  it('reads filename and sanitizes unsafe path and control characters', () => {
    const headers = new HttpHeaders({ 'Content-Disposition': 'attachment; filename="../pasta\\medicoes:\u0001?.csv"' });
    const value = csvFilename(headers, fallback);
    expect(value).toBe('__pasta_medicoes___.csv'); expect(value).not.toMatch(/[\\/:*?"<>|\u0000-\u001f]/);
  });

  it('prefers a valid UTF-8 filename* over filename', () => {
    const headers = new HttpHeaders({ 'Content-Disposition': "attachment; filename=ascii.csv; filename*=UTF-8''medi%C3%A7%C3%B5es_2026.csv" });
    expect(csvFilename(headers, fallback)).toBe('medições_2026.csv');
  });

  it('falls back to filename when filename* is invalid and to a deterministic name when the header is absent or malformed', () => {
    expect(csvFilename(new HttpHeaders({ 'Content-Disposition': "attachment; filename=regular.csv; filename*=UTF-8''%ZZ" }), fallback)).toBe('regular.csv');
    expect(csvFilename(new HttpHeaders(), fallback)).toBe(fallback);
    expect(csvFilename(new HttpHeaders({ 'Content-Disposition': 'attachment' }), fallback)).toBe(fallback);
    expect(fallbackCsvFilename('medicoes', '2026-08-01T00:00:00Z', '2026-08-25T23:59:59Z')).toBe(fallback);
    expect(sanitizeCsvFilename('  ', fallback)).toBe(fallback);
  });

  it('clicks one download anchor and always revokes the object URL', () => {
    const url = { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const blob = new Blob(['\ufeffheader\r\nvalor'], { type: 'text/csv;charset=UTF-8' });
    downloadCsvBlob(blob, fallback, document, url);
    expect(url.createObjectURL).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce(); expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:test'); expect(document.querySelector('a[download]')).toBeNull();
    click.mockRestore();
  });

  it('safely parses a JSON API error carried by Blob', async () => {
    const payload = { timestamp: '2026-08-25T00:00:00Z', status: 422, error: 'Unprocessable Entity', code: 'EXPORT_LIMIT_EXCEEDED', message: 'Limite', path: '/export' };
    const parsed = await apiErrorFromBlob(new HttpErrorResponse({ status: 422, error: new Blob([JSON.stringify(payload)], { type: 'application/json' }) }));
    expect(parsed).toEqual(payload);
  });

  it.each([[400, ApiErrorCode.InvalidRequest], [401, ApiErrorCode.Unauthorized], [403, ApiErrorCode.Forbidden], [404, ApiErrorCode.ResourceNotFound], [422, ApiErrorCode.ExportLimitExceeded], [500, ApiErrorCode.InternalError]])('maps malformed Blob status %i to a safe error', async (status, code) => {
    const parsed = await apiErrorFromBlob(new HttpErrorResponse({ status, error: new Blob(['not-json']) }));
    expect(parsed.status).toBe(status); expect(parsed.code).toBe(code); expect(parsed.message).not.toContain('not-json');
  });
});

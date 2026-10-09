import { HttpHeaders } from '@angular/common/http';
import {
  downloadPdfBlob, fallbackPdfFilename, isPdfContentType, pdfFilename, sanitizePdfFilename,
} from './report-pdf-download';

describe('report PDF download', () => {
  const fallback = 'visao-geral_2026-08-01_2026-08-25.pdf';

  it('prefers a valid UTF-8 filename* and sanitizes traversal, controls and separators', () => {
    const preferred = new HttpHeaders({
      'Content-Disposition': "attachment; filename=regular.pdf; filename*=UTF-8''vis%C3%A3o-geral_2026.pdf",
    });
    expect(pdfFilename(preferred, fallback)).toBe('visão-geral_2026.pdf');
    expect(pdfFilename(new HttpHeaders({
      'Content-Disposition': 'attachment; filename="../pasta\\relatorio:\u0001?.exe"',
    }), fallback)).toBe('__pasta_relatorio___.pdf');
  });

  it('falls back from an invalid filename* and uses a deterministic fallback without a header', () => {
    expect(pdfFilename(new HttpHeaders({
      'Content-Disposition': "attachment; filename=regular.pdf; filename*=UTF-8''%ZZ",
    }), fallback)).toBe('regular.pdf');
    expect(pdfFilename(new HttpHeaders(), fallback)).toBe(fallback);
    expect(pdfFilename(new HttpHeaders({ 'Content-Disposition': 'attachment' }), fallback)).toBe(fallback);
    expect(fallbackPdfFilename('2026-08-01T00:00:00Z', '2026-08-25T23:59:59Z')).toBe(fallback);
  });

  it('forces the PDF extension and rejects invalid or reserved names', () => {
    expect(sanitizePdfFilename('relatorio.exe', fallback)).toBe('relatorio.pdf');
    expect(sanitizePdfFilename('relatorio.PDF', fallback)).toBe('relatorio.PDF');
    expect(sanitizePdfFilename('CON.pdf', fallback)).toBe(fallback);
    expect(sanitizePdfFilename('  ', fallback)).toBe(fallback);
  });

  it('accepts only application/pdf regardless of case or parameters', () => {
    expect(isPdfContentType(new HttpHeaders({ 'Content-Type': 'application/pdf' }))).toBe(true);
    expect(isPdfContentType(new HttpHeaders({ 'Content-Type': 'Application/PDF; charset=binary' }))).toBe(true);
    expect(isPdfContentType(new HttpHeaders({ 'Content-Type': 'application/json' }))).toBe(false);
    expect(isPdfContentType(new HttpHeaders())).toBe(false);
  });

  it('passes the original Blob to createObjectURL and always removes and revokes after click', () => {
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    const url = { createObjectURL: vi.fn(() => 'blob:pdf'), revokeObjectURL: vi.fn() };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadPdfBlob(blob, fallback, document, url);
    expect(url.createObjectURL).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledOnce();
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:pdf');
    expect(document.querySelector('a[download]')).toBeNull();
    click.mockRestore();
  });

  it('revokes the object URL even when the browser download click throws', () => {
    const url = { createObjectURL: vi.fn(() => 'blob:pdf-error'), revokeObjectURL: vi.fn() };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('click failed'); });
    expect(() => downloadPdfBlob(new Blob(['%PDF']), fallback, document, url)).toThrowError('click failed');
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:pdf-error');
    expect(document.querySelector('a[download]')).toBeNull();
    click.mockRestore();
  });
});

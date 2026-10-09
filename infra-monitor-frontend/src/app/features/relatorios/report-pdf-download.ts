import { HttpHeaders } from '@angular/common/http';

const INVALID_FILENAME = /[\u0000-\u001f\u007f/\\:*?"<>|]/g;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function fallbackPdfFilename(inicio: string, fim: string): string {
  return `visao-geral_${datePart(inicio)}_${datePart(fim)}.pdf`;
}

export function pdfFilename(headers: HttpHeaders, fallback: string): string {
  const disposition = headers.get('Content-Disposition');
  if (!disposition) return sanitizePdfFilename(fallback, fallback);

  const extended = disposition.match(/(?:^|;)\s*filename\*\s*=\s*([^;]+)/i)?.[1]?.trim();
  const regular = disposition.match(/(?:^|;)\s*filename\s*=\s*("(?:\\.|[^"])*"|[^;]+)/i)?.[1]?.trim();
  const preferred = decodeExtendedFilename(extended) ?? decodeRegularFilename(regular);
  return sanitizePdfFilename(preferred, fallback);
}

export function sanitizePdfFilename(value: string | null | undefined, fallback: string): string {
  const cleaned = value?.normalize('NFC')
    .replace(INVALID_FILENAME, '_')
    .replace(/\.\.+/g, '_')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');
  if (!cleaned || WINDOWS_RESERVED_NAME.test(cleaned)) {
    if (value === fallback) return 'visao-geral_data-invalida_data-invalida.pdf';
    return sanitizePdfFilename(fallback, fallback);
  }
  if (cleaned.toLocaleLowerCase().endsWith('.pdf')) return cleaned;
  return `${cleaned.replace(/\.[^.]+$/, '') || 'visao-geral'}.pdf`;
}

export function isPdfContentType(headers: HttpHeaders): boolean {
  return headers.get('Content-Type')?.split(';', 1)[0].trim().toLocaleLowerCase() === 'application/pdf';
}

export function downloadPdfBlob(
  blob: Blob,
  filename: string,
  documentRef: Document = document,
  urlRef: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL,
): void {
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

function decodeExtendedFilename(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = stripQuotes(value).match(/^UTF-8''(.+)$/i);
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
  return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? 'data-invalida';
}

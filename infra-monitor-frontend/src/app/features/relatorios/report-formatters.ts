/** Presentation-only duration formatter; analytical values remain untouched. */
export function formatDurationSeconds(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '—';
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  const days = Math.floor(total / 86400); const hours = Math.floor((total % 86400) / 3600); const minutes = Math.floor((total % 3600) / 60); const rest = total % 60;
  if (days) return `${days}d${hours ? ` ${hours}h` : ''}`;
  if (hours) return `${hours}h${minutes ? ` ${minutes}m` : ''}`;
  return `${minutes}m${rest ? ` ${rest}s` : ''}`;
}

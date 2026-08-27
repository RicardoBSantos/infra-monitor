import { formatDurationSeconds } from './report-formatters';

describe('formatDurationSeconds', () => {
  it.each([[0, '0s'], [59, '59s'], [60, '1m'], [3600, '1h'], [3661, '1h 1m'], [97200, '1d 3h'], [null, '—']] as const)('formats %s as %s', (value, expected) => expect(formatDurationSeconds(value)).toBe(expected));
});

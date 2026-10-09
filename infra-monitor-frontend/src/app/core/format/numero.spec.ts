import { formatarDecimal, formatarPercentual } from './numero';
describe('formatarDecimal', () => {
  it('usa vírgula e duas casas', () => expect(formatarDecimal(12.5)).toBe('12,50'));
  it('agrupa milhar com ponto', () => expect(formatarDecimal(1234.5)).toBe('1.234,50'));
  it('respeita casas', () => expect(formatarDecimal(3, 0)).toBe('3'));
  it('nulo e não finito viram travessão', () => {
    expect(formatarDecimal(null)).toBe('—'); expect(formatarDecimal(Number.NaN)).toBe('—');
  });
});
describe('formatarPercentual', () => {
  it('formata com sinal colado', () => expect(formatarPercentual(99.5)).toBe('99,50%'));
  it('nulo vira travessão', () => expect(formatarPercentual(undefined)).toBe('—'));
});

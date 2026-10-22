import { erroDoPeriodo, isoParaLocal, localParaIso } from './periodo';

describe('periodo', () => {
  const agora = new Date(2026, 9, 22, 10, 0);
  const em = (minutos: number) => new Date(agora.getTime() + minutos * 60_000).toISOString();

  it('fim igual ao início é erro', () => {
    expect(erroDoPeriodo(em(10), em(10), agora, 72)).toBe('O fim deve ser depois do início.');
  });

  it('início 6 min no passado é erro; 4 min ainda passa (tolerância de 5 min do backend)', () => {
    expect(erroDoPeriodo(em(-6), em(60), agora, 72)).toBe('O início não pode estar no passado.');
    expect(erroDoPeriodo(em(-4), em(60), agora, 72)).toBeNull();
  });

  it('72 h exatas passam; 72 h + 1 min citam o máximo', () => {
    expect(erroDoPeriodo(em(0), em(72 * 60), agora, 72)).toBeNull();
    expect(erroDoPeriodo(em(0), em(72 * 60 + 1), agora, 72)).toBe('A janela não pode passar de 72 horas.');
  });

  it('início ou fim ausente pede os dois', () => {
    expect(erroDoPeriodo(null, em(60), agora, 72)).toBe('Informe início e fim.');
    expect(erroDoPeriodo(em(0), null, agora, 72)).toBe('Informe início e fim.');
  });

  it('datetime-local é horário local do navegador, convertido para ISO UTC', () => {
    expect(localParaIso('2026-10-22T10:00')).toBe(new Date(2026, 9, 22, 10, 0).toISOString());
    expect(localParaIso('')).toBeNull();
    expect(localParaIso('nao-e-data')).toBeNull();
  });

  it('isoParaLocal é o inverso, no horário local', () => {
    expect(isoParaLocal(new Date(2026, 9, 22, 9, 5).toISOString())).toBe('2026-10-22T09:05');
  });
});

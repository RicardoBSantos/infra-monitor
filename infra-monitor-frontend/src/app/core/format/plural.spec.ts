import { plural } from './plural';
describe('plural', () => {
  it('singular só para 1', () => expect(plural(1, 'unidade', 'unidades')).toBe('1 unidade'));
  it('zero é plural em pt-BR', () => expect(plural(0, 'unidade', 'unidades')).toBe('0 unidades'));
  it('muitos', () => expect(plural(3, 'unidade afetada', 'unidades afetadas')).toBe('3 unidades afetadas'));
});

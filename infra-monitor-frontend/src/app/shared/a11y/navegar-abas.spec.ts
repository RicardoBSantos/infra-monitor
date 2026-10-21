import { navegarAbas } from './navegar-abas';

function montar(n: number): HTMLElement[] {
  document.body.innerHTML = '';
  return Array.from({ length: n }, (_, i) => {
    const b = document.createElement('button');
    b.textContent = `aba ${i}`;
    b.addEventListener('click', () => b.setAttribute('data-clicada', 'sim'));
    document.body.appendChild(b);
    return b;
  });
}
const tecla = (key: string) => new KeyboardEvent('keydown', { key, cancelable: true });

describe('navegarAbas', () => {
  it('ArrowRight foca e ativa a próxima', () => {
    const abas = montar(3); const ev = tecla('ArrowRight');
    navegarAbas(ev, 0, abas);
    expect(document.activeElement).toBe(abas[1]);
    expect(abas[1].getAttribute('data-clicada')).toBe('sim');
    expect(ev.defaultPrevented).toBe(true);
  });
  it('ArrowLeft na primeira vai para a última (circular)', () => {
    const abas = montar(3); navegarAbas(tecla('ArrowLeft'), 0, abas);
    expect(document.activeElement).toBe(abas[2]);
  });
  it('ArrowRight na última volta à primeira', () => {
    const abas = montar(3); navegarAbas(tecla('ArrowRight'), 2, abas);
    expect(document.activeElement).toBe(abas[0]);
  });
  it('Home e End vão às pontas', () => {
    const abas = montar(4);
    navegarAbas(tecla('End'), 1, abas); expect(document.activeElement).toBe(abas[3]);
    navegarAbas(tecla('Home'), 3, abas); expect(document.activeElement).toBe(abas[0]);
  });
  it('outra tecla não faz nada nem cancela', () => {
    const abas = montar(2); abas[0].focus(); const ev = tecla('Enter');
    navegarAbas(ev, 0, abas);
    expect(document.activeElement).toBe(abas[0]);
    expect(ev.defaultPrevented).toBe(false);
  });
  it('lista vazia não lança', () => {
    expect(() => navegarAbas(tecla('ArrowRight'), 0, [])).not.toThrow();
  });
});

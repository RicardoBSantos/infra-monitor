import { prenderFoco } from './prender-foco';

describe('prenderFoco', () => {
  let painel: HTMLElement;
  const tab = (shiftKey = false) => new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });

  beforeEach(() => {
    painel = document.createElement('section');
    painel.tabIndex = -1;
    painel.innerHTML = '<button id="a">a</button><input id="b"><button id="c" disabled>c</button><button id="d">d</button>';
    document.body.appendChild(painel);
  });
  afterEach(() => painel.remove());
  const $ = (id: string) => painel.querySelector<HTMLElement>('#' + id)!;

  it('Tab no último focável volta ao primeiro', () => {
    $('d').focus();
    const e = tab();
    prenderFoco(e, painel);
    expect(document.activeElement).toBe($('a'));
    expect(e.defaultPrevented).toBe(true);
  });

  it('Shift+Tab no primeiro vai ao último (ignora desabilitado)', () => {
    $('a').focus();
    const e = tab(true);
    prenderFoco(e, painel);
    expect(document.activeElement).toBe($('d'));
  });

  it('Tab no meio não interfere', () => {
    $('a').focus();
    const e = tab();
    prenderFoco(e, painel);
    expect(e.defaultPrevented).toBe(false);
  });

  it('foco no próprio painel: Tab vai ao primeiro, Shift+Tab ao último', () => {
    painel.focus();
    prenderFoco(tab(), painel);
    expect(document.activeElement).toBe($('a'));
    painel.focus();
    prenderFoco(tab(true), painel);
    expect(document.activeElement).toBe($('d'));
  });

  it('recalcula a cada tecla: focável que aparece depois entra no ciclo', () => {
    const novo = document.createElement('button'); novo.id = 'e'; painel.appendChild(novo);
    $('d').focus();
    const e = tab();
    prenderFoco(e, painel);
    expect(e.defaultPrevented).toBe(false); // d não é mais o último
  });

  it('sem focável: mantém o foco no painel', () => {
    painel.innerHTML = '<p>só texto</p>';
    painel.focus();
    const e = tab();
    prenderFoco(e, painel);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(painel);
  });

  it('outra tecla é ignorada', () => {
    $('d').focus();
    const e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    prenderFoco(e, painel);
    expect(e.defaultPrevented).toBe(false);
  });
});

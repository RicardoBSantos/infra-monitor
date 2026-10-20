/** Elementos que entram no ciclo de Tab de um diálogo modal. */
export const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap de foco de diálogo modal: Tab no último volta ao primeiro, Shift+Tab no primeiro vai ao último.
 * Os focáveis são lidos a cada tecla — conteúdo projetado pode habilitar ou criar campos com o
 * diálogo aberto. É o que torna verdadeiro o `aria-modal="true"`; gaveta não usa (fica `false`).
 */
export function prenderFoco(evento: KeyboardEvent, painel: HTMLElement): void {
  if (evento.key !== 'Tab') return;
  const focaveis = Array.from(painel.querySelectorAll<HTMLElement>(FOCAVEIS)).filter((el) => !el.closest('[hidden], [inert]'));
  if (focaveis.length === 0) {
    evento.preventDefault();
    painel.focus();
    return;
  }
  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];
  const ativo = document.activeElement;
  if (evento.shiftKey && (ativo === primeiro || ativo === painel)) {
    evento.preventDefault();
    ultimo.focus();
  } else if (!evento.shiftKey && (ativo === ultimo || ativo === painel)) {
    evento.preventDefault();
    primeiro.focus();
  }
}

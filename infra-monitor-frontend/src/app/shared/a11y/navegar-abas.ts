/**
 * Teclado de tablist (padrão WAI-ARIA, ativação automática): ←/→ circulares, Home/End nas pontas.
 * Foca e clica o destino — o clique é o que troca a aba, seja routerLink ou (click) local.
 * Extraído de unidade-detalhe e notificacao-telegram (eram cópias) e usado também em Relatórios.
 */
export function navegarAbas(evento: KeyboardEvent, indice: number, abas: readonly HTMLElement[]): void {
  const total = abas.length;
  if (total === 0) return;
  let destino: number;
  switch (evento.key) {
    case 'ArrowRight': destino = (indice + 1) % total; break;
    case 'ArrowLeft': destino = (indice - 1 + total) % total; break;
    case 'Home': destino = 0; break;
    case 'End': destino = total - 1; break;
    default: return;
  }
  evento.preventDefault();
  abas[destino].focus();
  abas[destino].click();
}

/** Formatação numérica de exibição: sempre pt-BR. `toFixed` só para coordenada de SVG. */
const formatadores = new Map<number, Intl.NumberFormat>();
function formatador(casas: number): Intl.NumberFormat {
  let f = formatadores.get(casas);
  if (!f) { f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }); formatadores.set(casas, f); }
  return f;
}
export function formatarDecimal(valor: number | null | undefined, casas = 2): string {
  return valor === null || valor === undefined || !Number.isFinite(valor) ? '—' : formatador(casas).format(valor);
}
export function formatarPercentual(valor: number | null | undefined): string {
  const texto = formatarDecimal(valor);
  return texto === '—' ? texto : `${texto}%`;
}

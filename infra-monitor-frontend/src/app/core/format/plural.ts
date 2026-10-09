/** Concordância de número em pt-BR: singular só para 1; zero é plural. */
export function plural(n: number, singular: string, pluralForma: string): string {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}

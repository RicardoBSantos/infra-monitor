/** `datetime-local` (horário local do navegador, sem fuso) → ISO UTC. Vazio/inválido → null. */
export function localParaIso(valor: string): string | null {
  if (!valor) return null;
  const data = new Date(valor); // ECMAScript: sem 'Z' é interpretado como horário LOCAL
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

/** ISO → valor de `datetime-local` no horário local, para preencher o campo. */
export function isoParaLocal(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Erro de período ou null. Espelha o backend (tolerância de 5 min no passado; máximo em horas). */
export function erroDoPeriodo(inicio: string | null, fim: string | null, agora: Date, maxHoras: number): string | null {
  if (!inicio || !fim) return 'Informe início e fim.';
  const i = Date.parse(inicio);
  const f = Date.parse(fim);
  if (f <= i) return 'O fim deve ser depois do início.';
  if (i < agora.getTime() - 5 * 60_000) return 'O início não pode estar no passado.';
  if (f - i > maxHoras * 3_600_000) return `A janela não pode passar de ${maxHoras} horas.`;
  return null;
}

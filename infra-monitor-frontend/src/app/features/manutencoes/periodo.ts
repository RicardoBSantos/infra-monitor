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

const p2 = (n: number) => String(n).padStart(2, '0');
/** "HH:MM" no horário local. */
export function hora(iso: string): string { const d = new Date(iso); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; }
/** "DD/MM/AAAA HH:MM" no horário local. */
export function dataHora(iso: string): string { const d = new Date(iso); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${hora(iso)}`; }

/** "Janela #50 agendada. Atenção: sobrepõe a janela #41." — mesmo texto na lista, em Equipamentos e no detalhe da unidade. */
export function avisoDeAgendamento(janela: { id: number; sobreposicoes: number[] }): string {
  const outras = janela.sobreposicoes.map((id) => `#${id}`);
  const atencao = outras.length === 0 ? '' : outras.length === 1 ? ` Atenção: sobrepõe a janela ${outras[0]}.` : ` Atenção: sobrepõe as janelas ${outras.join(', ')}.`;
  return `Janela #${janela.id} agendada.${atencao}`;
}

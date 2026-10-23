import { DashboardEquipamentoLista } from '../../core/models/dashboard';

type LinhaComOrigem = Pick<DashboardEquipamentoLista, 'emManutencao' | 'manutencaoManual' | 'janelaAtivaId'>;

/**
 * Legenda curta da origem: "Manual", "Janela #41", "Manual + janela #41"; nula fora de manutenção.
 * Em manutenção sem nenhuma das duas origens (flag divergente, MA18): "Origem desconhecida".
 */
export function origemDaManutencao(linha: LinhaComOrigem): string | null {
  if (!linha.emManutencao) return null;
  const janela = linha.janelaAtivaId !== null ? `janela #${linha.janelaAtivaId}` : null;
  if (linha.manutencaoManual && janela) return `Manual + ${janela}`;
  if (linha.manutencaoManual) return 'Manual';
  return linha.janelaAtivaId !== null ? `Janela #${linha.janelaAtivaId}` : 'Origem desconhecida';
}

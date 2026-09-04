/**
 * Episódio de latência: a janela em que o monitor respondeu acima do limiar. `encerradoEm`
 * nulo significa episódio em curso — o mesmo "Aberto" do incidente, no vocabulário da
 * tela unificada.
 *
 * Não tem estado equivalente a RECONHECIDO: o episódio fecha sozinho, sem intervenção
 * humana, então não há o que reconhecer.
 */
export interface EpisodioLatenciaResponse {
  id: number;
  monitorId: number; monitorNome: string;
  equipamentoId: number; equipamentoNome: string;
  unidadeId: number; unidadeNome: string;
  iniciadoEm: string;
  encerradoEm: string | null;
  limiarMs: number;
  /**
   * N de medições consecutivas acima do limiar que abriu o episódio — e o mesmo N dentro
   * do limiar que o fecha. Vem da configuração global (`monitoring.latencia-ciclos`), não
   * da linha: é o denominador da numeração na linha do tempo.
   */
  ciclosParaEpisodio: number;
}

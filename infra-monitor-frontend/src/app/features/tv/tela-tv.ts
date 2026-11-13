import { Signal } from '@angular/core';

/** Contrato que cada tela exibida no modo TV implementa para a atualização silenciosa. */
export interface TelaTv {
  /** Rebusca sem voltar a `loading`; falha mantém o dado anterior. */
  recarregarDados(): void;
  /** true se a última rodada silenciosa teve alguma falha. */
  readonly falhouUltimaAtualizacao: Signal<boolean>;
  /**
   * Quando chegou a última resposta com sucesso do dado principal da tela (carga inicial ou rodada
   * silenciosa). Pedido em voo não conta: a moldura da TV usa isto para "Dados de" e "Desatualizado desde".
   */
  readonly ultimaAtualizacaoOk: Signal<Date | null>;
}

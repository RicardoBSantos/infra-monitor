import { Signal } from '@angular/core';

/** Contrato que cada tela exibida no modo TV implementa para a atualização silenciosa. */
export interface TelaTv {
  /** Rebusca sem voltar a `loading`; falha mantém o dado anterior. */
  recarregarDados(): void;
  /** true se a última rodada silenciosa teve alguma falha. */
  readonly falhouUltimaAtualizacao: Signal<boolean>;
}

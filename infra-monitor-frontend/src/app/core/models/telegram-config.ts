import { BotVerificationStatus } from './api-enums';

export type StatusIdentidadeBot = BotVerificationStatus;

/**
 * Identidade pública do bot, resolvida no backend por getMe e servida de cache.
 * `desatualizado` distingue "nunca verificamos" de "já verificamos e a última
 * revalidação falhou" — no segundo caso os dados ainda são exibidos, marcados.
 */
export interface TelegramIdentidade {
  status: StatusIdentidadeBot;
  username: string | null;
  botId: number | null;
  verificadoEm: string | null;
  desatualizado: boolean;
}

/**
 * Configuração do canal em modo leitura. Não existe campo de token: o backend
 * não o expõe nem redigido. O destino aparece só como booleano.
 */
export interface TelegramConfiguracao {
  telegramEnabled: boolean;
  dispatcherEnabled: boolean;
  destinoConfigurado: boolean;
  testeCooldownSegundos: number;
  bot: TelegramIdentidade;
}

/** Falha de teste é desfecho normal da ação, não erro de API: vem em 200. */
export interface TelegramTesteResultado {
  enviado: boolean;
  motivo: string | null;
  cooldownRestanteSegundos: number | null;
}

import { plural } from '../../../core/format/plural';
import { IncidentClosureReason, MeasurementStatus, NotificationEventType } from '../../../core/models/api-enums';
import { IncidentKind } from '../../../core/models/dashboard-incidente';
import { NotificacaoResponse } from '../../../core/models/notificacao';
import { HistoricoMedicaoResponse } from '../../../core/models/relatorio';

/**
 * Derivação da linha do tempo da ocorrência.
 *
 * Tudo aqui sai de dado real — medição, incidente/episódio, notificação. Não existe nota
 * de operador nem evento de supressão: o domínio não tem essas entidades, e inventá-las
 * na tela seria afirmar um histórico que o banco não guarda.
 *
 * Módulo puro de propósito: entra dado, sai lista ordenada. Sem `inject`, sem Angular,
 * testável sem TestBed.
 */

export type TipoEventoTimeline =
  | 'falha' | 'degradacao' | 'abertura' | 'reconhecimento' | 'notificacao'
  | 'recuperacao' | 'fechamento' | 'pico';

export type SeveridadeEvento = 'neutro' | 'ok' | 'alerta' | 'critico';

export interface EventoTimeline {
  chave: string;
  instante: string;
  tipo: TipoEventoTimeline;
  severidade: SeveridadeEvento;
  rotulo: string;
  detalhe: string | null;
}

/** Recorte da ocorrência que a timeline precisa, comum a incidente e episódio. */
export interface OcorrenciaTimeline {
  tipo: IncidentKind;
  iniciadoEm: string;
  encerradoEm: string | null;
  motivo: string | null;
  limiarMs: number | null;
  /** N do episódio de latência; nulo no incidente, que tira o seu N dos limiares do monitor. */
  ciclosParaEpisodio: number | null;
  reconhecidoEm: string | null;
  reconhecidoPorNome: string | null;
  /** Só o incidente tem. Ausente é fechamento antes da V19, ou episódio de latência. */
  motivoEncerramento: IncidentClosureReason | null;
  /** Só o incidente tem; nulo é motor, episódio ou legado sem autor. */
  fechadoPorNome: string | null;
}

/** Vem de `GET /monitores/{id}`; nulo quando a carga do monitor falhou. */
export interface LimiaresMonitor {
  falhasParaIncidente: number | null;
  sucessosParaRecovery: number | null;
}

export interface EntradaTimeline {
  ocorrencia: OcorrenciaTimeline;
  medicoes: HistoricoMedicaoResponse[];
  limiares: LimiaresMonitor;
  notificacoes: NotificacaoResponse[];
}

/** Desempate quando dois eventos caem no mesmo instante: o mecanismo antes da consequência. */
const ORDEM: Record<TipoEventoTimeline, number> = {
  falha: 0, degradacao: 1, pico: 2, recuperacao: 3, abertura: 4, reconhecimento: 5,
  fechamento: 6, notificacao: 7,
};

export function derivarTimeline(entrada: EntradaTimeline): EventoTimeline[] {
  const { ocorrencia, limiares, notificacoes } = entrada;
  // A folga carregada pelo drawer é contexto do gráfico, não evento: medição fora da janela
  // pertence a outra ocorrência.
  const medicoes = entrada.medicoes.filter((m) => dentroDaJanela(m.executadoEm, ocorrencia)).sort(porMedicao);
  const eventos: EventoTimeline[] = ocorrencia.tipo === IncidentKind.Incident
    ? eventosDeIncidente(ocorrencia, medicoes, limiares)
    : eventosDeLatencia(ocorrencia, medicoes);

  if (ocorrencia.reconhecidoEm) {
    eventos.push({
      chave: `reconhecimento-${ocorrencia.reconhecidoEm}`,
      instante: ocorrencia.reconhecidoEm,
      tipo: 'reconhecimento',
      severidade: 'alerta',
      rotulo: 'Reconhecido',
      detalhe: ocorrencia.reconhecidoPorNome ? `por ${ocorrencia.reconhecidoPorNome}` : null,
    });
  }

  // `enviadoEm` nulo é notificação que ainda não saiu: a criação é o instante real dela.
  for (const notificacao of notificacoes) {
    eventos.push({
      chave: `notificacao-${notificacao.id}`,
      instante: notificacao.enviadoEm ?? notificacao.createdAt,
      tipo: 'notificacao',
      severidade: 'neutro',
      rotulo: rotuloDaNotificacao(notificacao.tipoEvento),
      detalhe: detalheDaNotificacao(notificacao),
    });
  }

  return eventos.sort((a, b) => porInstante(a.instante, b.instante) || ORDEM[a.tipo] - ORDEM[b.tipo]);
}

/**
 * O incidente é aberto pelo `IncidentProcessor` quando a enésima falha consecutiva chega,
 * mas `iniciadoEm` guarda a PRIMEIRA falha da sequência — é uma marca retroativa. A
 * timeline mostra a abertura no instante em que ela de fato aconteceu, o da enésima
 * falha, e diz no detalhe qual foi o início registrado. Sem medição que cubra a janela
 * resta `iniciadoEm`, e o detalhe some junto.
 */
function eventosDeIncidente(ocorrencia: OcorrenciaTimeline, medicoes: HistoricoMedicaoResponse[],
                            limiares: LimiaresMonitor): EventoTimeline[] {
  const eventos: EventoTimeline[] = [];
  const total = limiares.falhasParaIncidente;
  let consecutivas = 0;
  let instanteConsolidacao: string | null = null;

  for (const medicao of medicoes) {
    if (medicao.status !== MeasurementStatus.Failure) { consecutivas = 0; continue; }
    consecutivas += 1;
    if (total !== null && consecutivas === total && instanteConsolidacao === null
        && !anteriorA(medicao.executadoEm, ocorrencia.iniciadoEm)) {
      instanteConsolidacao = medicao.executadoEm;
    }
    eventos.push({
      chave: `falha-${medicao.medicaoId}`,
      instante: medicao.executadoEm,
      tipo: 'falha',
      severidade: 'critico',
      // Passado o limiar a numeração perde o referencial: a sequência já consolidou o
      // incidente, e a falha seguinte não é "tentativa 4 de 3".
      rotulo: total !== null && consecutivas <= total
        ? `Falha ICMP — tentativa ${consecutivas}/${total}`
        : 'Falha ICMP',
      detalhe: null,
    });
  }

  eventos.push({
    chave: 'abertura',
    instante: instanteConsolidacao ?? ocorrencia.iniciadoEm,
    tipo: 'abertura',
    severidade: 'critico',
    rotulo: 'Incidente aberto',
    detalhe: detalheDaAbertura(ocorrencia.motivo, ocorrencia.iniciadoEm, instanteConsolidacao),
  });

  if (ocorrencia.encerradoEm) eventos.push(...eventosDeFechamento(ocorrencia, ocorrencia.encerradoEm, medicoes, limiares));
  return eventos;
}

/**
 * O fechamento só afirma o que o dado prova. Manual e manutenção não têm sequência de
 * recuperação — a guarda é pelo motivo, não por a medição não casar com `encerradoEm`. Legado
 * (antes da V19, motivo nulo) se decide pelo autor e pela sequência medida; sem nenhum dos dois,
 * o fechamento sai sem causa.
 */
function eventosDeFechamento(ocorrencia: OcorrenciaTimeline, encerradoEm: string,
                             medicoes: HistoricoMedicaoResponse[], limiares: LimiaresMonitor): EventoTimeline[] {
  const fechamento = (rotulo: string, detalhe: string | null): EventoTimeline => ({
    chave: 'fechamento', instante: encerradoEm, tipo: 'fechamento', severidade: 'ok', rotulo, detalhe,
  });
  const motivo = ocorrencia.motivoEncerramento;
  if (motivo === IncidentClosureReason.Maintenance) {
    return [fechamento('Encerrado por manutenção',
      'O equipamento entrou em manutenção e saiu da observação. Nenhuma recuperação foi medida.')];
  }
  if (motivo === IncidentClosureReason.ManualClosure || (motivo === null && ocorrencia.fechadoPorNome)) {
    const autor = ocorrencia.fechadoPorNome ? `por ${ocorrencia.fechadoPorNome}` : 'por um operador';
    return [fechamento('Encerrado manualmente', `${autor}. Nenhuma recuperação foi medida.`)];
  }
  const recuperacao = eventosDeRecuperacao(encerradoEm, medicoes, limiares.sucessosParaRecovery);
  if (motivo === null && recuperacao.length === 0) return [fechamento('Incidente fechado', null)];
  return [...recuperacao, fechamento('Incidente fechado', limiares.sucessosParaRecovery !== null
    ? `${plural(limiares.sucessosParaRecovery, 'resposta consecutiva', 'respostas consecutivas')} ${limiares.sucessosParaRecovery === 1 ? 'restabeleceu' : 'restabeleceram'} o monitor` : null)];
}

/**
 * Detalhe da abertura, comum aos dois tipos: o que originou a ocorrência mais a hora do
 * início retroativo, dita só quando ela difere do instante em que a linha foi criada.
 */
function detalheDaAbertura(base: string | null, iniciadoEm: string,
                           instanteConsolidacao: string | null): string | null {
  const partes: string[] = [];
  if (base) partes.push(base);
  if (instanteConsolidacao !== null && instanteConsolidacao !== iniciadoEm) {
    partes.push(`início registrado em ${horaCurta(iniciadoEm)}`);
  }
  return partes.length ? partes.join(' · ') : null;
}

/**
 * A sequência que fechou a ocorrência: ela termina na medição do fechamento e caminha
 * para trás enquanto o critério de normalização se sustentar.
 */
function sequenciaDeFechamento(encerradoEm: string, medicoes: HistoricoMedicaoResponse[],
                               total: number | null,
                               criterio: (medicao: HistoricoMedicaoResponse) => boolean): HistoricoMedicaoResponse[] {
  if (total === null) return [];
  const fim = medicoes.findIndex((medicao) => medicao.executadoEm === encerradoEm);
  if (fim < 0) return [];
  const sequencia: HistoricoMedicaoResponse[] = [];
  for (let indice = fim; indice >= 0 && sequencia.length < total; indice -= 1) {
    if (!criterio(medicoes[indice])) break;
    sequencia.unshift(medicoes[indice]);
  }
  return sequencia;
}

/** A sequência de sucessos que fechou o incidente. */
function eventosDeRecuperacao(encerradoEm: string, medicoes: HistoricoMedicaoResponse[],
                              total: number | null): EventoTimeline[] {
  const sequencia = sequenciaDeFechamento(encerradoEm, medicoes, total,
    (medicao) => medicao.status === MeasurementStatus.Success);
  return sequencia.map((medicao, indice) => ({
    chave: `recuperacao-${medicao.medicaoId}`,
    instante: medicao.executadoEm,
    tipo: 'recuperacao' as const,
    severidade: 'ok' as const,
    rotulo: `Resposta ICMP — recuperação ${indice + 1}/${total}`,
    detalhe: medicao.latenciaMs !== null ? `${medicao.latenciaMs} ms` : null,
  }));
}

/**
 * O episódio é estruturalmente igual ao incidente: o `LatencyEpisodeProcessor` exige N
 * medições consecutivas acima do limiar (`monitoring.latencia-ciclos`) para abrir, e
 * grava em `iniciadoEm` a PRIMEIRA delas — marca retroativa. A abertura de verdade
 * acontece na enésima, e é lá que a timeline a posiciona, dizendo no detalhe qual foi o
 * início registrado. O fechamento espera as mesmas N medições dentro do limiar.
 *
 * Só as medições dessas duas sequências viram evento numerado. As demais acima do limiar
 * ficam de fora de propósito: em uma janela longa seriam dezenas de linhas idênticas, e o
 * gráfico já mostra a série inteira. Da janela toda a timeline marca ainda o pico e as
 * falhas — os instantes que alguém procura.
 */
function eventosDeLatencia(ocorrencia: OcorrenciaTimeline, medicoes: HistoricoMedicaoResponse[]): EventoTimeline[] {
  const eventos: EventoTimeline[] = [];
  const total = ocorrencia.ciclosParaEpisodio;
  const limiar = ocorrencia.limiarMs;
  const naJanela = medicoes.filter((medicao) => dentroDaJanela(medicao.executadoEm, ocorrencia));

  // A janela começa em `iniciadoEm`, então as N primeiras medições dela são a sequência
  // que consolidou o episódio. Se o histórico não as cobre inteiras — janela recortada,
  // medição faltando — não há o que numerar e a abertura cai no início registrado.
  const consolidacao = total !== null ? naJanela.slice(0, total) : [];
  const consolidou = total !== null && consolidacao.length === total
    && consolidacao.every((medicao) => acimaDoLimiar(medicao, limiar));
  const instanteConsolidacao = consolidou ? consolidacao[consolidacao.length - 1].executadoEm : null;

  if (consolidou) {
    eventos.push(...consolidacao.map((medicao, indice) => ({
      chave: `degradacao-${medicao.medicaoId}`,
      instante: medicao.executadoEm,
      tipo: 'degradacao' as const,
      severidade: 'alerta' as const,
      rotulo: `Acima do limiar — medição ${indice + 1}/${total}`,
      detalhe: medicao.latenciaMs !== null ? `${medicao.latenciaMs} ms` : null,
    })));
  }

  eventos.push({
    chave: 'abertura',
    instante: instanteConsolidacao ?? ocorrencia.iniciadoEm,
    tipo: 'abertura',
    severidade: 'alerta',
    rotulo: 'Latência acima do limiar',
    detalhe: detalheDaAbertura(limiar !== null ? `limiar de ${limiar} ms` : null,
      ocorrencia.iniciadoEm, instanteConsolidacao),
  });

  for (const medicao of naJanela) {
    if (medicao.status !== MeasurementStatus.Failure) continue;
    eventos.push({
      chave: `falha-${medicao.medicaoId}`,
      instante: medicao.executadoEm,
      tipo: 'falha',
      severidade: 'critico',
      rotulo: 'Falha ICMP',
      detalhe: 'sem resposta durante o episódio',
    });
  }

  const pico = naJanela.reduce<HistoricoMedicaoResponse | null>((maior, medicao) => (
    medicao.latenciaMs !== null && (maior === null || medicao.latenciaMs > (maior.latenciaMs ?? 0)) ? medicao : maior
  ), null);
  if (pico !== null && pico.latenciaMs !== null) {
    eventos.push({
      chave: `pico-${pico.medicaoId}`,
      instante: pico.executadoEm,
      tipo: 'pico',
      severidade: 'alerta',
      rotulo: 'Pico de latência',
      detalhe: `${pico.latenciaMs} ms`,
    });
  }

  if (ocorrencia.encerradoEm) {
    const normalizacao = sequenciaDeFechamento(ocorrencia.encerradoEm, medicoes, total,
      (medicao) => dentroDoLimiar(medicao, limiar));
    eventos.push(...normalizacao.map((medicao, indice) => ({
      chave: `normalizacao-${medicao.medicaoId}`,
      instante: medicao.executadoEm,
      tipo: 'recuperacao' as const,
      severidade: 'ok' as const,
      rotulo: `Dentro do limiar — normalização ${indice + 1}/${total}`,
      detalhe: medicao.latenciaMs !== null ? `${medicao.latenciaMs} ms` : null,
    })));
    eventos.push({
      chave: 'fechamento',
      instante: ocorrencia.encerradoEm,
      tipo: 'fechamento',
      severidade: 'ok',
      rotulo: 'Latência normalizada',
      detalhe: total !== null
        ? `${plural(total, 'medição consecutiva', 'medições consecutivas')} dentro do limiar ${total === 1 ? 'encerrou' : 'encerraram'} o episódio`
        : 'episódio encerrado automaticamente',
    });
  }
  return eventos;
}

/** Só medição bem-sucedida tem latência: uma falha interrompe a sequência dos dois lados. */
function acimaDoLimiar(medicao: HistoricoMedicaoResponse, limiar: number | null): boolean {
  return limiar !== null && medicao.status !== MeasurementStatus.Failure
    && medicao.latenciaMs !== null && medicao.latenciaMs > limiar;
}

function dentroDoLimiar(medicao: HistoricoMedicaoResponse, limiar: number | null): boolean {
  return limiar !== null && medicao.status !== MeasurementStatus.Failure
    && medicao.latenciaMs !== null && medicao.latenciaMs <= limiar;
}

export function rotuloDaNotificacao(tipo: NotificationEventType): string {
  switch (tipo) {
    case NotificationEventType.IncidentOpened: return 'Notificação: incidente aberto';
    case NotificationEventType.IncidentClosed: return 'Notificação: incidente fechado';
    case NotificationEventType.HighLatency: return 'Notificação: latência alta';
    case NotificationEventType.LatencyNormalized: return 'Notificação: latência normalizada';
    case NotificationEventType.IncidentClosedByMaintenance: return 'Notificação: incidente encerrado por manutenção';
    case NotificationEventType.LatencyClosedByMaintenance: return 'Notificação: latência encerrada por manutenção';
    default: return `Notificação: ${tipo}`;
  }
}

function detalheDaNotificacao(notificacao: NotificacaoResponse): string {
  const base = `${notificacao.canal} · ${notificacao.status.toLowerCase()}`;
  return notificacao.tentativas > 1 ? `${base} · ${notificacao.tentativas} tentativas` : base;
}

/** Fim nulo é ocorrência em curso: a janela vai até agora. */
function dentroDaJanela(instante: string, ocorrencia: OcorrenciaTimeline): boolean {
  const momento = new Date(instante).getTime();
  const fim = ocorrencia.encerradoEm ? new Date(ocorrencia.encerradoEm).getTime() : Date.now();
  return momento >= new Date(ocorrencia.iniciadoEm).getTime() && momento <= fim;
}

function anteriorA(instante: string, referencia: string): boolean {
  return new Date(instante).getTime() < new Date(referencia).getTime();
}

function porMedicao(a: HistoricoMedicaoResponse, b: HistoricoMedicaoResponse): number {
  return porInstante(a.executadoEm, b.executadoEm);
}

function porInstante(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime();
}

function horaCurta(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime())
    ? iso
    : data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

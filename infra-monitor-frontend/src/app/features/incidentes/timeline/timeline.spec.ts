import { IncidentClosureReason, MeasurementStatus, NotificationChannel, NotificationEventType, NotificationStatus } from '../../../core/models/api-enums';
import { IncidentKind } from '../../../core/models/dashboard-incidente';
import { NotificacaoResponse } from '../../../core/models/notificacao';
import { HistoricoMedicaoResponse } from '../../../core/models/relatorio';
import { EntradaTimeline, derivarTimeline } from './timeline';

function medicao(executadoEm: string, status: MeasurementStatus, latenciaMs: number | null, medicaoId: number): HistoricoMedicaoResponse {
  return {
    medicaoId, unidadeId: 7, unidadeNome: 'Centro', equipamentoId: 31, equipamentoNome: 'SW-CORE',
    monitorId: 1, monitorNome: 'ICMP CORE', tipoMonitor: 'ICMP', status, latenciaMs, executadoEm,
  };
}

const notificacao: NotificacaoResponse = {
  id: 90, canal: NotificationChannel.Telegram, tipoEvento: NotificationEventType.IncidentOpened,
  status: NotificationStatus.Sent, tentativas: 1, mensagem: 'Incidente aberto', erro: null,
  enviadoEm: '2026-09-01T08:01:35Z', incidente: null, episodioLatencia: null,
  monitorNome: null, equipamentoNome: null, unidadeNome: null,
  createdAt: '2026-09-01T08:01:31Z', updatedAt: '2026-09-01T08:01:35Z',
};

/** Três falhas abrem o incidente, dois sucessos o fecham: os limiares do monitor de teste. */
const medicoesDoIncidente = [
  medicao('2026-09-01T08:00:00Z', MeasurementStatus.Success, 20, 1),
  medicao('2026-09-01T08:00:30Z', MeasurementStatus.Failure, null, 2),
  medicao('2026-09-01T08:01:00Z', MeasurementStatus.Failure, null, 3),
  medicao('2026-09-01T08:01:30Z', MeasurementStatus.Failure, null, 4),
  medicao('2026-09-01T08:02:00Z', MeasurementStatus.Success, 25, 5),
  medicao('2026-09-01T08:02:30Z', MeasurementStatus.Success, 22, 6),
];

const entradaDeIncidente: EntradaTimeline = {
  ocorrencia: {
    tipo: IncidentKind.Incident,
    iniciadoEm: '2026-09-01T08:00:30Z',
    encerradoEm: '2026-09-01T08:02:30Z',
    motivo: 'Falhas consecutivas',
    limiarMs: null, ciclosParaEpisodio: null,
    reconhecidoEm: '2026-09-01T08:01:50Z',
    reconhecidoPorNome: 'Ricardo',
    motivoEncerramento: IncidentClosureReason.AutomaticRecovery,
  },
  medicoes: medicoesDoIncidente,
  limiares: { falhasParaIncidente: 3, sucessosParaRecovery: 2 },
  notificacoes: [notificacao],
};

describe('derivarTimeline', () => {
  it('numera cada falha da sequência que consolidou o incidente', () => {
    const rotulos = derivarTimeline(entradaDeIncidente).filter(e => e.tipo === 'falha').map(e => e.rotulo);
    expect(rotulos).toEqual([
      'Falha ICMP — tentativa 1/3',
      'Falha ICMP — tentativa 2/3',
      'Falha ICMP — tentativa 3/3',
    ]);
  });

  /**
   * `iniciadoEm` é a primeira falha, uma marca retroativa. A abertura de verdade acontece
   * quando a enésima falha chega — é esse o instante que a timeline mostra.
   */
  it('posiciona a abertura na enésima falha e registra o início retroativo no detalhe', () => {
    const abertura = derivarTimeline(entradaDeIncidente).find(e => e.tipo === 'abertura');
    expect(abertura?.instante).toBe('2026-09-01T08:01:30Z');
    expect(abertura?.detalhe).toContain('Falhas consecutivas');
    expect(abertura?.detalhe).toContain('início registrado em');
  });

  it('sem o monitor carregado, mantém as falhas e cai para o início registrado', () => {
    const eventos = derivarTimeline({
      ...entradaDeIncidente,
      limiares: { falhasParaIncidente: null, sucessosParaRecovery: null },
    });
    expect(eventos.filter(e => e.tipo === 'falha').map(e => e.rotulo)).toEqual(['Falha ICMP', 'Falha ICMP', 'Falha ICMP']);
    expect(eventos.find(e => e.tipo === 'abertura')?.instante).toBe('2026-09-01T08:00:30Z');
    // Sem `sucessosParaRecovery` não há sequência de recuperação para numerar.
    expect(eventos.some(e => e.tipo === 'recuperacao')).toBe(false);
  });

  it('numera a sequência de sucessos que fechou o incidente', () => {
    const rotulos = derivarTimeline(entradaDeIncidente).filter(e => e.tipo === 'recuperacao').map(e => e.rotulo);
    expect(rotulos).toEqual(['Resposta ICMP — recuperação 1/2', 'Resposta ICMP — recuperação 2/2']);
  });

  it('inclui reconhecimento, notificação e fechamento reais, e nada além disso', () => {
    const eventos = derivarTimeline(entradaDeIncidente);
    expect(eventos.find(e => e.tipo === 'reconhecimento')?.detalhe).toBe('por Ricardo');
    expect(eventos.find(e => e.tipo === 'notificacao')?.rotulo).toBe('Notificação: incidente aberto');
    expect(eventos.some(e => e.tipo === 'fechamento')).toBe(true);
    // Nenhum evento inventado: os tipos são exatamente os que o domínio registra.
    expect(new Set(eventos.map(e => e.tipo))).toEqual(
      new Set(['falha', 'abertura', 'reconhecimento', 'notificacao', 'recuperacao', 'fechamento']));
  });

  it('devolve os eventos em ordem cronológica', () => {
    const instantes = derivarTimeline(entradaDeIncidente).map(e => new Date(e.instante).getTime());
    expect(instantes).toEqual([...instantes].sort((a, b) => a - b));
  });

  /**
   * Episódio é estruturalmente igual ao incidente: N medições consecutivas acima do
   * limiar abrem, N dentro do limiar fecham, e `iniciadoEm` aponta para a primeira das N.
   */
  const medicoesDoEpisodio = [
    medicao('2026-09-01T09:00:00Z', MeasurementStatus.Success, 280, 11),
    medicao('2026-09-01T09:00:30Z', MeasurementStatus.Success, 410, 12),
    medicao('2026-09-01T09:01:00Z', MeasurementStatus.Failure, null, 13),
    medicao('2026-09-01T09:01:30Z', MeasurementStatus.Success, 120, 14),
    medicao('2026-09-01T09:02:00Z', MeasurementStatus.Success, 90, 15),
  ];

  const entradaDeEpisodio: EntradaTimeline = {
    ocorrencia: {
      tipo: IncidentKind.Latency,
      iniciadoEm: '2026-09-01T09:00:00Z',
      encerradoEm: '2026-09-01T09:02:00Z',
      motivo: null, limiarMs: 250, ciclosParaEpisodio: 2,
      reconhecidoEm: null, reconhecidoPorNome: null,
      motivoEncerramento: null,
    },
    medicoes: medicoesDoEpisodio,
    limiares: { falhasParaIncidente: 3, sucessosParaRecovery: 2 },
    notificacoes: [],
  };

  it('numera as N medições que consolidaram o episódio de latência', () => {
    const rotulos = derivarTimeline(entradaDeEpisodio).filter(e => e.tipo === 'degradacao').map(e => e.rotulo);
    expect(rotulos).toEqual(['Acima do limiar — medição 1/2', 'Acima do limiar — medição 2/2']);
  });

  it('posiciona a abertura do episódio na enésima medição e registra o início retroativo', () => {
    const abertura = derivarTimeline(entradaDeEpisodio).find(e => e.tipo === 'abertura');
    expect(abertura?.instante).toBe('2026-09-01T09:00:30Z');
    expect(abertura?.detalhe).toContain('limiar de 250 ms');
    expect(abertura?.detalhe).toContain('início registrado em');
  });

  it('numera a sequência que normalizou a latência e marca pico e falha da janela', () => {
    const eventos = derivarTimeline(entradaDeEpisodio);
    expect(eventos.filter(e => e.tipo === 'recuperacao').map(e => e.rotulo)).toEqual([
      'Dentro do limiar — normalização 1/2',
      'Dentro do limiar — normalização 2/2',
    ]);
    expect(eventos.find(e => e.tipo === 'pico')?.detalhe).toBe('410 ms');
    expect(eventos.find(e => e.tipo === 'falha')?.rotulo).toBe('Falha ICMP');
    expect(eventos.at(-1)?.rotulo).toBe('Latência normalizada');
    expect(eventos.at(-1)?.detalhe).toBe('2 medições consecutivas dentro do limiar encerraram o episódio');
  });

  /** Sem o N não há o que numerar: a abertura cai no início registrado, como no incidente. */
  it('sem o N do episódio, cai para o início registrado e não numera nada', () => {
    const eventos = derivarTimeline({
      ...entradaDeEpisodio,
      ocorrencia: { ...entradaDeEpisodio.ocorrencia, ciclosParaEpisodio: null },
    });
    expect(eventos.some(e => e.tipo === 'degradacao')).toBe(false);
    expect(eventos.some(e => e.tipo === 'recuperacao')).toBe(false);
    expect(eventos.find(e => e.tipo === 'abertura')?.instante).toBe('2026-09-01T09:00:00Z');
    expect(eventos.find(e => e.tipo === 'abertura')?.detalhe).toBe('limiar de 250 ms');
  });

  it('devolve os eventos do episódio em ordem cronológica', () => {
    const instantes = derivarTimeline(entradaDeEpisodio).map(e => new Date(e.instante).getTime());
    expect(instantes).toEqual([...instantes].sort((a, b) => a - b));
  });

  it('ocorrência em curso não produz fechamento', () => {
    const eventos = derivarTimeline({
      ...entradaDeIncidente,
      ocorrencia: { ...entradaDeIncidente.ocorrencia, encerradoEm: null },
    });
    expect(eventos.some(e => e.tipo === 'fechamento')).toBe(false);
    expect(eventos.some(e => e.tipo === 'recuperacao')).toBe(false);
  });

  it('não afirma recuperação quando o incidente foi encerrado por manutenção', () => {
    const eventos = derivarTimeline({
      ...entradaDeIncidente,
      ocorrencia: { ...entradaDeIncidente.ocorrencia, motivoEncerramento: IncidentClosureReason.Maintenance },
    });
    const fim = eventos.at(-1)!;
    expect(fim.rotulo).toBe('Encerrado por manutenção');
    // Hoje a timeline imprime "N respostas consecutivas restabeleceram o monitor"
    // com rotulo fixo. Para um fechamento por manutencao isso e falso: nao houve
    // sequencia de recuperacao nenhuma.
    expect(fim.detalhe).not.toContain('restabeleceram');
  });

  it('mantém o texto de recuperação quando o motor fechou', () => {
    const eventos = derivarTimeline({
      ...entradaDeIncidente,
      ocorrencia: { ...entradaDeIncidente.ocorrencia, motivoEncerramento: IncidentClosureReason.AutomaticRecovery },
    });
    expect(eventos.at(-1)!.detalhe).toContain('restabeleceram o monitor');
  });
});

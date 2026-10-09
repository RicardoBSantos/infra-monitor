import { IncidentClosureReason, LatencyClosureReason, MeasurementStatus, NotificationChannel, NotificationEventType, NotificationStatus } from '../../../core/models/api-enums';
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
    fechadoPorNome: null,
    motivoEncerramentoEpisodio: null,
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
      fechadoPorNome: null,
      motivoEncerramentoEpisodio: null,
    },
    medicoes: medicoesDoEpisodio,
    limiares: { falhasParaIncidente: 3, sucessosParaRecovery: 2 },
    notificacoes: [],
  };

  const AUTO_SEM_SEQUENCIA = 'Recuperação automática registrada pelo motor; a sequência completa de respostas não está no histórico carregado';
  const NORMALIZACAO_SEM_SEQUENCIA = 'Normalização registrada pelo motor; a sequência completa de medições não está no histórico carregado';

  describe('só afirma o que lista', () => {
    const fechamentoDe = (entrada: EntradaTimeline) => derivarTimeline(entrada).find(e => e.tipo === 'fechamento');
    const recuperacoesDe = (entrada: EntradaTimeline) => derivarTimeline(entrada).filter(e => e.tipo === 'recuperacao').map(e => e.rotulo);

    it('recuperação automática sem nenhuma resposta no histórico não cita N', () => {
      const entrada = { ...entradaDeIncidente, medicoes: medicoesDoIncidente.slice(0, 4) };
      expect(fechamentoDe(entrada)?.detalhe).toBe(AUTO_SEM_SEQUENCIA);
      expect(recuperacoesDe(entrada)).toEqual([]);
    });

    it('recuperação automática com sequência parcial lista sem numerar e não cita N', () => {
      // Só a última resposta (a do encerramento) está no histórico: a 08:02:00 sumiu.
      const entrada = { ...entradaDeIncidente, medicoes: [...medicoesDoIncidente.slice(0, 4), medicoesDoIncidente[5]] };
      expect(recuperacoesDe(entrada)).toEqual(['Resposta ICMP']);
      expect(fechamentoDe(entrada)?.detalhe).toBe(AUTO_SEM_SEQUENCIA);
    });

    it('N maior que a sequência medida (limiar editado depois) não cita N', () => {
      const entrada = { ...entradaDeIncidente, limiares: { falhasParaIncidente: 3, sucessosParaRecovery: 3 } };
      expect(recuperacoesDe(entrada)).toEqual(['Resposta ICMP', 'Resposta ICMP']);
      expect(fechamentoDe(entrada)?.detalhe).toBe(AUTO_SEM_SEQUENCIA);
    });

    it('sequência completa continua numerada e cita N', () => {
      expect(recuperacoesDe(entradaDeIncidente)).toEqual(['Resposta ICMP — recuperação 1/2', 'Resposta ICMP — recuperação 2/2']);
      expect(fechamentoDe(entradaDeIncidente)?.detalhe).toBe('2 respostas consecutivas restabeleceram o monitor');
    });

    it('legado sem autor com sequência parcial lista sem numerar e não afirma causa', () => {
      const entrada = {
        ...entradaDeIncidente,
        ocorrencia: { ...entradaDeIncidente.ocorrencia, motivoEncerramento: null },
        medicoes: [...medicoesDoIncidente.slice(0, 4), medicoesDoIncidente[5]],
      };
      expect(recuperacoesDe(entrada)).toEqual(['Resposta ICMP']);
      expect(fechamentoDe(entrada)?.rotulo).toBe('Incidente fechado');
      expect(fechamentoDe(entrada)?.detalhe).toBeNull();
    });

    const episodioCom = (motivo: LatencyClosureReason | null, medicoes = entradaDeEpisodio.medicoes) => ({
      ...entradaDeEpisodio, medicoes,
      ocorrencia: { ...entradaDeEpisodio.ocorrencia, motivoEncerramentoEpisodio: motivo },
    });
    // Remove a penúltima (dentro do limiar) e deixa só a do encerramento.
    const semPenultima = entradaDeEpisodio.medicoes.slice(0, -2).concat(entradaDeEpisodio.medicoes.slice(-1));

    it('episódio encerrado por incidente não diz que normalizou', () => {
      const eventos = derivarTimeline(episodioCom(LatencyClosureReason.Incident));
      const fechamento = eventos.find(e => e.tipo === 'fechamento');
      expect(fechamento?.rotulo).toBe('Encerrado pela abertura de incidente');
      expect(fechamento?.detalhe).toBe('O monitor deixou de responder e um incidente foi aberto. A latência não normalizou.');
      expect(fechamento?.severidade).toBe('critico');
      expect(eventos.some(e => e.tipo === 'recuperacao')).toBe(false);
    });

    it('episódio encerrado por manutenção não diz que normalizou', () => {
      const eventos = derivarTimeline(episodioCom(LatencyClosureReason.Maintenance));
      const fechamento = eventos.find(e => e.tipo === 'fechamento');
      expect(fechamento?.rotulo).toBe('Encerrado por manutenção');
      expect(fechamento?.detalhe).toBe('O equipamento entrou em manutenção e saiu da observação. Nenhuma normalização foi medida.');
      expect(eventos.some(e => e.tipo === 'recuperacao')).toBe(false);
    });

    it('normalização com sequência completa cita N', () => {
      const fechamento = derivarTimeline(episodioCom(LatencyClosureReason.Normalization)).find(e => e.tipo === 'fechamento');
      expect(fechamento?.rotulo).toBe('Latência normalizada');
      expect(fechamento?.detalhe).toBe('2 medições consecutivas dentro do limiar encerraram o episódio');
    });

    it('normalização sem a sequência no histórico não cita N nem numera', () => {
      const eventos = derivarTimeline(episodioCom(LatencyClosureReason.Normalization, semPenultima));
      expect(eventos.find(e => e.tipo === 'fechamento')?.detalhe).toBe(NORMALIZACAO_SEM_SEQUENCIA);
      expect(eventos.filter(e => e.tipo === 'recuperacao').every(e => e.rotulo === 'Dentro do limiar')).toBe(true);
    });

    it('episódio legado sem sequência não vira "Latência normalizada"', () => {
      const fechamento = derivarTimeline(episodioCom(null, semPenultima)).find(e => e.tipo === 'fechamento');
      expect(fechamento?.rotulo).toBe('Episódio encerrado');
      expect(fechamento?.detalhe).toBeNull();
    });

    it('episódio legado com sequência completa é lido como normalização', () => {
      const fechamento = derivarTimeline(episodioCom(null)).find(e => e.tipo === 'fechamento');
      expect(fechamento?.rotulo).toBe('Latência normalizada');
    });
  });

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

  it('episódio de uma só medição concorda no singular', () => {
    const eventos = derivarTimeline({ ...entradaDeEpisodio, ocorrencia: { ...entradaDeEpisodio.ocorrencia, ciclosParaEpisodio: 1 } });
    expect(eventos.at(-1)?.detalhe).toBe('1 medição consecutiva dentro do limiar encerrou o episódio');
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

describe('fechamento por motivo', () => {
  it('concorda verbo e número no singular (1 resposta)', () => {
    const incidente = derivarTimeline({ ...entradaDeIncidente, limiares: { falhasParaIncidente: 3, sucessosParaRecovery: 1 }, ocorrencia: { ...entradaDeIncidente.ocorrencia, motivoEncerramento: IncidentClosureReason.AutomaticRecovery, encerradoEm: '2026-09-01T08:02:30Z' } });
    expect(incidente.find((e) => e.tipo === 'fechamento')?.detalhe).toBe('1 resposta consecutiva restabeleceu o monitor');
  });

  const fechamento = (entrada: EntradaTimeline) => derivarTimeline(entrada).find((e) => e.tipo === 'fechamento')!;
  const comMotivo = (motivo: IncidentClosureReason | null, fechadoPorNome: string | null, encerradoEm = '2026-09-01T08:02:30Z'): EntradaTimeline => ({
    ...entradaDeIncidente,
    ocorrencia: { ...entradaDeIncidente.ocorrencia, motivoEncerramento: motivo, fechadoPorNome, encerradoEm },
  });

  it('recuperação automática afirma as respostas consecutivas e lista a recuperação', () => {
    const entrada = comMotivo(IncidentClosureReason.AutomaticRecovery, null);
    expect(fechamento(entrada).rotulo).toBe('Incidente fechado');
    expect(fechamento(entrada).detalhe).toBe('2 respostas consecutivas restabeleceram o monitor');
    expect(derivarTimeline(entrada).filter((e) => e.tipo === 'recuperacao')).toHaveLength(2);
  });

  it('fechamento manual diz quem fechou e não afirma recuperação', () => {
    // encerradoEm coincide com uma medição de sucesso de propósito: a guarda é explícita, não acidental.
    const entrada = comMotivo(IncidentClosureReason.ManualClosure, 'Ricardo');
    expect(fechamento(entrada).rotulo).toBe('Encerrado manualmente');
    expect(fechamento(entrada).detalhe).toBe('por Ricardo. Nenhuma recuperação foi medida.');
    expect(derivarTimeline(entrada).filter((e) => e.tipo === 'recuperacao')).toHaveLength(0);
  });

  it('manutenção mantém o texto de manutenção', () => {
    const entrada = comMotivo(IncidentClosureReason.Maintenance, null);
    expect(fechamento(entrada).rotulo).toBe('Encerrado por manutenção');
    expect(derivarTimeline(entrada).filter((e) => e.tipo === 'recuperacao')).toHaveLength(0);
  });

  it('legado com autor é lido como manual', () => {
    expect(fechamento(comMotivo(null, 'Ana')).rotulo).toBe('Encerrado manualmente');
  });

  it('legado sem autor e sem sequência não afirma causa', () => {
    const entrada = comMotivo(null, null, '2026-09-01T08:02:10Z');
    expect(fechamento(entrada).rotulo).toBe('Incidente fechado');
    expect(fechamento(entrada).detalhe).toBeNull();
  });

  it('legado sem autor com sequência medida é lido como recuperação', () => {
    expect(fechamento(comMotivo(null, null)).detalhe).toBe('2 respostas consecutivas restabeleceram o monitor');
  });
});

describe('recorte das medições', () => {
  it('não mostra medições posteriores ao encerramento nem anteriores ao início', () => {
    const entrada: EntradaTimeline = {
      ...entradaDeIncidente,
      medicoes: [
        medicao('2026-09-01T07:59:30Z', MeasurementStatus.Failure, null, 90),
        ...medicoesDoIncidente,
        medicao('2026-09-01T08:03:00Z', MeasurementStatus.Failure, null, 91),
        medicao('2026-09-01T08:03:30Z', MeasurementStatus.Failure, null, 92),
      ],
    };
    const chaves = derivarTimeline(entrada).map((e) => e.chave);
    expect(chaves).not.toContain('falha-90');
    expect(chaves).not.toContain('falha-91');
    expect(chaves).not.toContain('falha-92');
  });
});

import { NotificationEventType } from './api-enums';
import { OPCOES_EVENTO_NOTIFICACAO, ROTULOS_EVENTO_NOTIFICACAO, rotuloEventoNotificacao } from './rotulos-notificacao';

describe('rotulos-notificacao', () => {
  const valores = Object.values(NotificationEventType);

  it('dá rótulo não vazio a todo valor do enum', () => {
    for (const valor of valores) expect(ROTULOS_EVENTO_NOTIFICACAO[valor]).toBeTruthy();
  });

  it('as opções são exatamente os valores do enum, na ordem', () => {
    expect(OPCOES_EVENTO_NOTIFICACAO.map((o) => o.valor)).toEqual(valores);
    expect(OPCOES_EVENTO_NOTIFICACAO.length).toBe(11);
  });

  it('usa os rótulos exatos dos cinco eventos de manutenção', () => {
    expect(rotuloEventoNotificacao(NotificationEventType.MaintenanceStarted)).toBe('Manutenção iniciada');
    expect(rotuloEventoNotificacao(NotificationEventType.MaintenanceEnded)).toBe('Manutenção encerrada');
    expect(rotuloEventoNotificacao(NotificationEventType.MaintenanceEndChanged)).toBe('Fim da manutenção alterado');
    expect(rotuloEventoNotificacao(NotificationEventType.ManualMaintenanceStarted)).toBe('Manutenção manual iniciada');
    expect(rotuloEventoNotificacao(NotificationEventType.ManualMaintenanceEnded)).toBe('Manutenção manual encerrada');
  });

  it('valor desconhecido do backend cai no próprio código, sem quebrar', () => {
    expect(rotuloEventoNotificacao('NOVO_EVENTO' as NotificationEventType)).toBe('NOVO_EVENTO');
  });
});

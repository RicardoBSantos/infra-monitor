import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { IncidentStatus, MaintenanceWindowStatus, MonitorOperationalStatus, NotificationStatus, UnitOperationalStatus } from '../../core/models/api-enums';
import { StatusBadgeComponent, tomDoStatus } from './status-badge.component';

@Component({ imports: [StatusBadgeComponent], template: '<app-status-badge [status]="status" />' })
class StatusBadgeHostComponent { status: MonitorOperationalStatus | IncidentStatus = MonitorOperationalStatus.Available; }

describe('StatusBadgeComponent', () => {
  it('expõe o mesmo tom que o badge usa', () => {
    expect(tomDoStatus(UnitOperationalStatus.Available)).toBe('success');
    expect(tomDoStatus(UnitOperationalStatus.Degraded)).toBe('warning');
    expect(tomDoStatus(UnitOperationalStatus.Unavailable)).toBe('danger');
    expect(tomDoStatus(UnitOperationalStatus.NoData)).toBe('muted');
    expect(tomDoStatus(UnitOperationalStatus.NoEquipment)).toBe('muted');
    expect(tomDoStatus(UnitOperationalStatus.Maintenance)).toBe('info');
  });

  it('presents the backend status without calculating it', async () => {
    await TestBed.configureTestingModule({ imports: [StatusBadgeHostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(StatusBadgeHostComponent);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Disponível');
    expect((fixture.nativeElement as HTMLElement).querySelector('.badge')?.classList).toContain('badge--success');
  });

  it('vira vermelho quando o backend reporta indisponível', async () => {
    await TestBed.configureTestingModule({ imports: [StatusBadgeHostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(StatusBadgeHostComponent);
    fixture.componentInstance.status = MonitorOperationalStatus.Unavailable;
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Indisponível');
    expect((fixture.nativeElement as HTMLElement).querySelector('.badge')?.classList).toContain('badge--danger');
  });

  // O domínio continua FECHADO; só o rótulo de exibição é "Resolvido", alinhado à aba
  // "Resolvidos" e ao botão "Marcar como resolvido".
  it('exibe FECHADO como "Resolvido"', async () => {
    await TestBed.configureTestingModule({ imports: [StatusBadgeHostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(StatusBadgeHostComponent);
    fixture.componentInstance.status = IncidentStatus.Closed;
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Resolvido');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Fechado');
    expect((fixture.nativeElement as HTMLElement).querySelector('.badge')?.classList).toContain('badge--success');
  });

  it('rotula e dá tom às situações da janela de manutenção', () => {
    const casos: [MaintenanceWindowStatus, string, string][] = [
      [MaintenanceWindowStatus.Scheduled, 'Agendada', 'muted'],
      [MaintenanceWindowStatus.Active, 'Ativa', 'info'],
      [MaintenanceWindowStatus.Completed, 'Concluída', 'muted'],
      [MaintenanceWindowStatus.Expired, 'Expirada', 'warning'],
      [MaintenanceWindowStatus.Cancelled, 'Cancelada', 'muted'],
    ];
    for (const [status, rotulo, tom] of casos) {
      const fixture = TestBed.createComponent(StatusBadgeComponent);
      fixture.componentRef.setInput('status', status);
      fixture.detectChanges();
      const badge = fixture.nativeElement.querySelector('.badge');
      expect(badge.textContent.trim()).toBe(rotulo);
      expect(badge.className).toContain('badge--' + tom);
      expect(tomDoStatus(status)).toBe(tom as 'muted');
    }
  });

  it('rotula CANCELADA sem dizer que falhou', () => {
    const fixture = TestBed.createComponent(StatusBadgeComponent);
    fixture.componentRef.setInput('status', NotificationStatus.Cancelled);
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.badge');
    expect(badge.textContent.trim()).toBe('Cancelada');
    // 'Falha' seria mentira: nao tentamos e nao deu, o evento deixou de valer.
    expect(badge.className).not.toContain('badge--danger');
  });
});

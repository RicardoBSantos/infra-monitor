import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { MonitorOperationalStatus } from '../../core/models/api-enums';
import { StatusBadgeComponent } from './status-badge.component';

@Component({ imports: [StatusBadgeComponent], template: '<app-status-badge [status]="status" />' })
class StatusBadgeHostComponent { status = MonitorOperationalStatus.Available; }

describe('StatusBadgeComponent', () => {
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
});

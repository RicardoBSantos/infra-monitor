import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { DateRange, DateRangeComponent } from './date-range.component';

describe('DateRangeComponent.renovar', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-12T10:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); TestBed.resetTestingModule(); });

  function montar() {
    const fixture = TestBed.createComponent(DateRangeComponent);
    const emitidos: DateRange[] = [];
    fixture.componentInstance.mudar.subscribe((intervalo) => emitidos.push(intervalo));
    fixture.detectChanges();
    return { fixture, emitidos };
  }

  it('com atalho relativo desliza a janela até agora', () => {
    const { fixture, emitidos } = montar();
    expect(emitidos.length).toBe(1);
    expect(emitidos[0].fim).toBe('2026-11-12T10:00:00.000Z');

    vi.setSystemTime(new Date('2026-11-12T10:10:00Z'));
    fixture.componentInstance.renovar();

    expect(emitidos.length).toBe(2);
    expect(emitidos[1].fim).toBe('2026-11-12T10:10:00.000Z');
    // 7 dias de janela, com o início andando junto com o fim.
    expect(new Date(emitidos[1].fim).getTime() - new Date(emitidos[1].inicio).getTime()).toBe(7 * 24 * 3600 * 1000);
    expect(new Date(emitidos[1].fim).getTime() - new Date(emitidos[0].fim).getTime()).toBe(10 * 60 * 1000);
  });

  it('com período personalizado não emite', () => {
    const { fixture, emitidos } = montar();
    (fixture.componentInstance as unknown as { preset: { set(valor: string): void } }).preset.set('custom');
    fixture.componentInstance.renovar();
    expect(emitidos.length).toBe(1);
  });
});

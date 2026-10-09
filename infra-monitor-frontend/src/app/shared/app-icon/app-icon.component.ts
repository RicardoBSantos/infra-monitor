import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type AppIconName = 'menu' | 'map' | 'panel' | 'incident' | 'unit' | 'equipment' | 'types' | 'monitor' | 'measurements' | 'telegram' | 'search' | 'chevron-right' | 'circle' | 'sun' | 'moon' | 'refresh' | 'power' | 'chevron-down' | 'external' | 'filter' | 'close';

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path [attr.d]="path()" /></svg>`,
  styleUrl: './app-icon.component.scss',
})
export class AppIconComponent {
  readonly name = input.required<AppIconName>();
  protected readonly path = () => ICON_PATHS[this.name()];
}

const ICON_PATHS: Record<AppIconName, string> = {
  menu: 'M4 7h16M4 12h16M4 17h16', map: 'M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Zm0-15v15m6-12v15', panel: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z', incident: 'M12 3 2.5 20h19L12 3Zm0 6v4m0 3h.01', unit: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6', equipment: 'M4 5h16v5H4zm2 5v9m12-9v9M8 19h8', types: 'M4 5h7v7H4zm9 0h7v7h-7zM4 14h7v5H4zm9 0h7v5h-7z', monitor: 'M3 12h4l2-6 4 12 2-6h6', measurements: 'M4 19V9m5 10V5m5 14v-7m5 7V3', telegram: 'm21 4-3.1 16.1a1 1 0 0 1-1.6.6l-5.2-3.8-2.5 2.4a1 1 0 0 1-1.7-.7l.4-4.2L17 6.1 8.8 13.5', search: 'm20 20-4.5-4.5m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z', 'chevron-right': 'm9 18 6-6-6-6', circle: 'M12 12h.01', sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4', moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z', refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4', power: 'M12 3v9m5.5-6.5a8 8 0 1 1-11 0', 'chevron-down': 'm6 9 6 6 6-6', external: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5', filter: 'M4 5h16l-6 7v6l-4 2v-8L4 5Z', close: 'm7 7 10 10M17 7 7 17',
};

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MonitorManagementComponent } from './monitor-management.component';

@Component({ selector: 'app-monitor-list', imports: [MonitorManagementComponent], changeDetection: ChangeDetectionStrategy.OnPush, template: '<app-monitor-management />' })
export class MonitorListComponent {}

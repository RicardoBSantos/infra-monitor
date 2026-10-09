import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ApplicationShellComponent } from './application-shell.component';

describe('ApplicationShellComponent', () => {
  it('opens and closes the responsive navigation', async () => {
    await TestBed.configureTestingModule({ imports: [ApplicationShellComponent], providers: [provideRouter([]), provideHttpClient()] }).compileComponents();
    const fixture = TestBed.createComponent(ApplicationShellComponent);
    fixture.detectChanges();

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.menu-button')?.click();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.sidebar')?.classList).toContain('sidebar--open');

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.backdrop')?.click();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.sidebar')?.classList).not.toContain('sidebar--open');
  });
});

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
@Component({ selector: 'app-forbidden', imports: [RouterLink], changeDetection: ChangeDetectionStrategy.OnPush, template: '<main class="status-page"><section><span class="eyebrow">ACESSO NEGADO</span><h1>Você não tem permissão para esta ação.</h1><p>Sua sessão continua ativa. Volte para uma área que esteja disponível para seu papel.</p><a routerLink="/dashboard">Voltar ao painel</a></section></main>', styleUrl: './status-page.component.scss' })
export class ForbiddenComponent {}

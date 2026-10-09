import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { take } from 'rxjs';
import { plural } from '../../core/format/plural';
import { ApiErrorCode, isApiError } from '../../core/models/api-error';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';

type LoginState = 'idle' | 'loading' | 'error';
@Component({ selector: 'app-login', imports: [ReactiveFormsModule], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './login.component.html', styleUrl: './login.component.scss' })
export class LoginComponent {
  protected readonly plural = plural;
  private readonly auth = inject(AuthService); private readonly router = inject(Router); private readonly route = inject(ActivatedRoute); private readonly fb = inject(FormBuilder); protected readonly theme = inject(ThemeService);
  protected readonly state = signal<LoginState>('idle'); protected readonly error = signal<string | null>(this.route.snapshot.queryParamMap.has('sessionExpired') ? 'Sua sessão expirou. Entre novamente.' : null);
  protected readonly form = this.fb.nonNullable.group({ email: ['', [Validators.required, Validators.email]], senha: ['', Validators.required] });
  /** Placeholders estaticos da vitrine de marca. Nao vem de API. */
  protected readonly resumo = { unidades: 11, dispositivos: 187, online: 181, degradados: 4, offline: 2 };
  /** Apenas UI: nao participa do payload de login nem do fluxo de sessao. */
  protected readonly manterConectado = signal(true);
  protected alternarManterConectado(): void { this.manterConectado.update(valor => !valor); }
  protected submit(): void {
    if (this.state() === 'loading') return;
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.state.set('loading'); this.error.set(null); const { email, senha } = this.form.getRawValue();
    this.auth.login(email.trim(), senha).pipe(take(1)).subscribe({ next: response => {
      this.state.set('idle'); const destination = response.usuario.trocaSenhaObrigatoria ? '/trocar-senha' : this.safeReturnUrl(); this.router.navigateByUrl(destination);
    }, error: error => { this.state.set('error'); this.error.set(loginMessage(error)); } });
  }
  private safeReturnUrl(): string { const value = this.route.snapshot.queryParamMap.get('returnUrl'); return value && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard'; }
}
function loginMessage(error: unknown): string { if (error instanceof HttpErrorResponse && isApiError(error.error)) { if (error.error.code === ApiErrorCode.AuthenticationFailed) return 'Credenciais inválidas.'; if (error.error.code === ApiErrorCode.AccountDisabled) return 'Esta conta está inativa.'; return error.error.message; } return 'Não foi possível entrar agora. Tente novamente.'; }

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { take } from 'rxjs';
import { isApiError } from '../../core/models/api-error';
import { AuthService } from '../../core/services/auth.service';
import { AuthStateService } from '../../core/services/auth-state.service';

function matchingPasswords(control: AbstractControl): ValidationErrors | null { return control.get('novaSenha')?.value === control.get('confirmacaoNovaSenha')?.value ? null : { passwordMismatch: true }; }
@Component({ selector: 'app-change-password', imports: [ReactiveFormsModule], changeDetection: ChangeDetectionStrategy.OnPush, templateUrl: './change-password.component.html', styleUrl: './auth-form.component.scss' })
export class ChangePasswordComponent {
  private readonly auth = inject(AuthService); private readonly state = inject(AuthStateService); private readonly router = inject(Router); private readonly fb = inject(FormBuilder);
  protected readonly loading = signal(false); protected readonly error = signal<string | null>(null);
  protected readonly form = this.fb.nonNullable.group({ senhaAtual: ['', Validators.required], novaSenha: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(128)]], confirmacaoNovaSenha: ['', Validators.required] }, { validators: matchingPasswords });
  protected submit(): void { if (this.loading()) return; if (this.form.invalid) { this.form.markAllAsTouched(); return; } const email = this.state.usuario()?.email; if (!email) { this.router.navigate(['/login']); return; } this.loading.set(true); this.error.set(null); const { senhaAtual, novaSenha } = this.form.getRawValue(); this.auth.changeOwnPassword({ senhaAtual, novaSenha }).pipe(take(1)).subscribe({ next: () => this.reentrar(email, novaSenha), error: error => { this.loading.set(false); this.error.set(passwordError(error)); } }); }
  protected logout(): void { this.auth.logout().subscribe({ complete: () => this.router.navigate(['/login']) }); }
  /** A troca revoga as sessões do usuário (inclusive o cookie desta aba): refaz o login com a senha nova. */
  private reentrar(email: string, novaSenha: string): void { this.auth.login(email, novaSenha).pipe(take(1)).subscribe({ next: ({ usuario }) => { this.loading.set(false); if (usuario.trocaSenhaObrigatoria) { this.error.set('A troca ainda não foi confirmada pelo servidor.'); return; } this.router.navigate(['/dashboard']); }, error: () => { this.loading.set(false); this.error.set('Senha alterada, mas não foi possível renovar sua sessão. Saia e entre com a nova senha.'); } }); }
}
function passwordError(error: unknown): string { return error instanceof HttpErrorResponse && isApiError(error.error) ? error.error.message : 'Não foi possível alterar a senha. Confira a senha atual.'; }

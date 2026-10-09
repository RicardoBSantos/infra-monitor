import { Injectable, computed, signal } from '@angular/core';
import { AuthUser, LoginResponse, PapelUsuario } from '../models/auth';

@Injectable({ providedIn: 'root' })
export class AuthStateService {
  private readonly accessTokenSignal = signal<string | null>(null);
  private readonly expiresAtSignal = signal<number | null>(null);
  private readonly usuarioSignal = signal<AuthUser | null>(null);
  readonly accessToken = this.accessTokenSignal.asReadonly();
  readonly expiresAt = this.expiresAtSignal.asReadonly();
  readonly usuario = this.usuarioSignal.asReadonly();
  readonly authenticated = computed(() => this.accessTokenSignal() !== null && this.usuarioSignal() !== null && !this.isExpired());
  readonly papel = computed<PapelUsuario | null>(() => this.usuarioSignal()?.papel ?? null);
  readonly trocaSenhaObrigatoria = computed(() => this.usuarioSignal()?.trocaSenhaObrigatoria ?? false);

  setSession(response: LoginResponse): void {
    this.accessTokenSignal.set(response.accessToken);
    this.expiresAtSignal.set(Date.now() + response.expiresIn * 1000);
    this.usuarioSignal.set(response.usuario);
  }
  updateUser(usuario: AuthUser): void { this.usuarioSignal.set(usuario); }
  clear(): void { this.accessTokenSignal.set(null); this.expiresAtSignal.set(null); this.usuarioSignal.set(null); }
  hasAnyRole(roles: readonly PapelUsuario[]): boolean { return this.papel() !== null && roles.includes(this.papel()!); }
  canWriteInventory(): boolean { return this.hasAnyRole(['ADMIN', 'OPERADOR']); }
  isAdmin(): boolean { return this.hasAnyRole(['ADMIN']); }
  canManageInventory(): boolean { return this.canWriteInventory(); }
  canManageMonitors(): boolean { return this.canWriteInventory(); }
  canCloseIncident(): boolean { return this.hasAnyRole(['ADMIN', 'OPERADOR']); }
  canManageUsers(): boolean { return this.isAdmin(); }
  private isExpired(): boolean { const expiresAt = this.expiresAtSignal(); return expiresAt !== null && expiresAt <= Date.now(); }
}

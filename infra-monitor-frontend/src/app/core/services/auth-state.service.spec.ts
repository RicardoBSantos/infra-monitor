import { TestBed } from '@angular/core/testing';
import { AuthStateService } from './auth-state.service';
import { LoginResponse } from '../models/auth';

const session: LoginResponse = { accessToken: 'token', tokenType: 'Bearer', expiresIn: 60, usuario: { id: 1, nome: 'Admin', email: 'admin@example.test', papel: 'ADMIN', trocaSenhaObrigatoria: true } };

describe('AuthStateService', () => {
  let service: AuthStateService;
  beforeEach(() => { TestBed.configureTestingModule({}); service = TestBed.inject(AuthStateService); });
  it('starts unauthenticated and clear restores the initial state', () => {
    expect(service.authenticated()).toBe(false); expect(service.accessToken()).toBeNull(); expect(service.expiresAt()).toBeNull(); expect(service.usuario()).toBeNull();
    service.setSession(session); service.clear();
    expect(service.authenticated()).toBe(false); expect(service.usuario()).toBeNull(); expect(service.papel()).toBeNull(); expect(service.trocaSenhaObrigatoria()).toBe(false);
  });
  it('stores session, role and explicit RBAC capabilities in memory', () => {
    service.setSession(session);
    expect(service.accessToken()).toBe('token'); expect(service.expiresAt()).toBeGreaterThan(Date.now()); expect(service.usuario()).toEqual(session.usuario); expect(service.authenticated()).toBe(true);
    expect(service.papel()).toBe('ADMIN'); expect(service.trocaSenhaObrigatoria()).toBe(true); expect(service.hasAnyRole(['OPERADOR', 'ADMIN'])).toBe(true); expect(service.canManageInventory()).toBe(true); expect(service.canManageMonitors()).toBe(true); expect(service.canCloseIncident()).toBe(true);
  });
  it('treats an expired token as unauthenticated', () => { service.setSession({ ...session, expiresIn: -1 }); expect(service.authenticated()).toBe(false); });
});

import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, UrlTree } from '@angular/router';
import { PapelUsuario } from '../models/auth';
import { AuthStateService } from '../services/auth-state.service';

function loginTree(router: Router, url: string): UrlTree { return router.createUrlTree(['/login'], { queryParams: { returnUrl: url } }); }
export const authGuard: CanActivateFn = (_route, state) => { const auth = inject(AuthStateService); const router = inject(Router); return auth.authenticated() ? true : loginTree(router, state.url); };
export const loginGuard: CanActivateFn = () => { const auth = inject(AuthStateService); const router = inject(Router); return auth.authenticated() ? router.createUrlTree([auth.trocaSenhaObrigatoria() ? '/trocar-senha' : '/dashboard']) : true; };
export const passwordChangeGuard: CanActivateFn = (_route, state) => { const auth = inject(AuthStateService); const router = inject(Router); return auth.authenticated() ? true : loginTree(router, state.url); };
export const businessGuard: CanActivateFn = (_route, state) => { const auth = inject(AuthStateService); const router = inject(Router); if (!auth.authenticated()) return loginTree(router, state.url); return auth.trocaSenhaObrigatoria() ? router.createUrlTree(['/trocar-senha']) : true; };
export const roleGuard: CanActivateFn = (route) => { const auth = inject(AuthStateService); const router = inject(Router); const roles = route.data['roles'] as readonly PapelUsuario[] | undefined; return !roles || auth.hasAnyRole(roles) ? true : router.createUrlTree(['/forbidden']); };

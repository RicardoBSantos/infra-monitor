import { Routes } from '@angular/router';
import { authGuard, businessGuard, loginGuard, passwordChangeGuard, roleGuard } from './core/guards/auth.guards';
import { ApplicationShellComponent } from './layout/application-shell/application-shell.component';

const businessRoutes: Routes = [
  { path: 'dashboard', loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent), data: { breadcrumb: 'Painel', title: 'Painel', section: 'Operações' } },
  { path: 'mapa', loadComponent: () => import('./features/mapa/mapa.component').then(m => m.MapaComponent), data: { breadcrumb: 'Mapa', title: 'Mapa', section: 'Operações' } },
  { path: 'unidades', loadComponent: () => import('./features/unidades/unidade-list.component').then(m => m.UnidadeListComponent), data: { breadcrumb: 'Unidades', title: 'Unidades', section: 'Gerenciamento' } },
  { path: 'unidades/:id', loadComponent: () => import('./features/unidades/unidade-detalhe.component').then(m => m.UnidadeDetalheComponent), data: { breadcrumb: 'Detalhe da unidade', title: 'Unidade', section: 'Operações' } },
  { path: 'equipamentos', loadComponent: () => import('./features/equipamentos/equipamento-list.component').then(m => m.EquipamentoListComponent), data: { breadcrumb: 'Equipamentos', title: 'Equipamentos', section: 'Gerenciamento' } },
  { path: 'equipamentos/:id', loadComponent: () => import('./features/equipamentos/equipamento-detail.component').then(m => m.EquipamentoDetailComponent), data: { breadcrumb: 'Detalhe do equipamento', title: 'Equipamento', section: 'Gerenciamento' } },
  { path: 'tipos-equipamento', loadComponent: () => import('./features/tipos-equipamento/tipo-equipamento-list.component').then(m => m.TipoEquipamentoListComponent), data: { breadcrumb: 'Tipos de equipamento', title: 'Tipos de equipamento', section: 'Gerenciamento' } },
  { path: 'monitores', loadComponent: () => import('./features/monitores/monitor-list.component').then(m => m.MonitorListComponent), data: { breadcrumb: 'Monitoramento', title: 'Monitoramento', section: 'Gerenciamento' } },
  { path: 'medicoes', loadComponent: () => import('./features/medicoes/medicao-list.component').then(m => m.MedicaoListComponent), data: { breadcrumb: 'Medições', title: 'Medições', section: 'Gerenciamento' } },
  { path: 'incidentes', loadComponent: () => import('./features/incidentes/incidente-list.component').then(m => m.IncidenteListComponent), data: { breadcrumb: 'Incidentes', title: 'Incidentes', section: 'Operações' } },
  { path: 'incidentes/:id', loadComponent: () => import('./features/incidentes/incidente-detail.component').then(m => m.IncidenteDetailComponent), data: { breadcrumb: 'Detalhe do incidente', title: 'Incidente', section: 'Operações' } },
  { path: 'notificacoes', loadComponent: () => import('./features/notificacoes/notificacao-list.component').then(m => m.NotificacaoListComponent), data: { breadcrumb: 'Telegram', title: 'Notificações', section: 'Gerenciamento' } },
  { path: 'notificacoes/:id', loadComponent: () => import('./features/notificacoes/notificacao-detail.component').then(m => m.NotificacaoDetailComponent), data: { breadcrumb: 'Detalhe da notificação', title: 'Notificação', section: 'Gerenciamento' } },
  { path: 'relatorios', canActivate: [roleGuard], loadComponent: () => import('./features/relatorios/relatorios.component').then(m => m.RelatoriosComponent), data: { roles: ['ADMIN', 'OPERADOR', 'VISUALIZADOR'], breadcrumb: 'Relatórios', title: 'Relatórios', section: 'Operações' } },
  { path: 'usuarios', canActivate: [roleGuard], loadComponent: () => import('./features/usuarios/usuario-list.component').then(m => m.UsuarioListComponent), data: { roles: ['ADMIN'], breadcrumb: 'Usuários', title: 'Usuários', section: 'Administração' } },
];

export const routes: Routes = [
  { path: 'login', canActivate: [loginGuard], loadComponent: () => import('./features/auth/login.component').then(m => m.LoginComponent) },
  { path: 'trocar-senha', canActivate: [passwordChangeGuard], loadComponent: () => import('./features/auth/change-password.component').then(m => m.ChangePasswordComponent) },
  { path: 'forbidden', canActivate: [authGuard], loadComponent: () => import('./features/auth/forbidden.component').then(m => m.ForbiddenComponent) },
  { path: '', component: ApplicationShellComponent, canActivate: [businessGuard], children: businessRoutes },
  { path: '**', redirectTo: 'dashboard' },
];

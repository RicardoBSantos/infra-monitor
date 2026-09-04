import { Routes } from '@angular/router';
import { authGuard, businessGuard, loginGuard, passwordChangeGuard, roleGuard } from './core/guards/auth.guards';
import { IncidentKind } from './core/models/dashboard-incidente';
import { ApplicationShellComponent } from './layout/application-shell/application-shell.component';
import { UnidadeDetalheStore } from './features/unidades/detalhe/unidade-detalhe.store';

const businessRoutes: Routes = [
  { path: 'dashboard', loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent), data: { breadcrumb: 'Painel', title: 'Painel', section: 'Operações' } },
  { path: 'mapa', loadComponent: () => import('./features/mapa/mapa.component').then(m => m.MapaComponent), data: { breadcrumb: 'Mapa', title: 'Mapa', section: 'Operações' } },
  { path: 'unidades', loadComponent: () => import('./features/unidades/unidade-list.component').then(m => m.UnidadeListComponent), data: { breadcrumb: 'Unidades', title: 'Unidades', section: 'Gerenciamento' } },
  {
    path: 'unidades/:id',
    loadComponent: () => import('./features/unidades/unidade-detalhe.component').then(m => m.UnidadeDetalheComponent),
    // Estado compartilhado pelas abas: uma instância por unidade aberta.
    providers: [UnidadeDetalheStore],
    data: { breadcrumb: 'Detalhe da unidade', title: 'Unidade', section: 'Operações' },
    children: [
      { path: '', redirectTo: 'visao-geral', pathMatch: 'full' },
      { path: 'visao-geral', loadComponent: () => import('./features/unidades/detalhe/visao-geral.component').then(m => m.VisaoGeralComponent), data: { title: 'Unidade · Visão geral' } },
      { path: 'equipamentos', loadComponent: () => import('./features/unidades/detalhe/equipamentos-tab.component').then(m => m.EquipamentosTabComponent), data: { title: 'Unidade · Equipamentos' } },
      { path: 'incidentes', loadComponent: () => import('./features/unidades/detalhe/incidentes-tab.component').then(m => m.IncidentesTabComponent), data: { title: 'Unidade · Incidentes' } },
      { path: 'historico', loadComponent: () => import('./features/unidades/detalhe/historico-tab.component').then(m => m.HistoricoTabComponent), data: { title: 'Unidade · Histórico' } },
      { path: 'configuracoes', loadComponent: () => import('./features/unidades/detalhe/configuracoes-tab.component').then(m => m.ConfiguracoesTabComponent), data: { title: 'Unidade · Configurações' } },
    ],
  },
  { path: 'equipamentos', loadComponent: () => import('./features/equipamentos/equipamento-list.component').then(m => m.EquipamentoListComponent), data: { breadcrumb: 'Equipamentos', title: 'Equipamentos', section: 'Gerenciamento' } },
  // Mesmo componente da lista: o `:id` abre o drawer de detalhe já montado. Não há
  // página cheia de equipamento — o path continua existindo para preservar deep-link,
  // botão voltar e os links de Relatórios e da aba Equipamentos da unidade.
  { path: 'equipamentos/:id', loadComponent: () => import('./features/equipamentos/equipamento-list.component').then(m => m.EquipamentoListComponent), data: { breadcrumb: 'Detalhe do equipamento', title: 'Equipamento', section: 'Gerenciamento' } },
  { path: 'tipos-equipamento', loadComponent: () => import('./features/tipos-equipamento/tipo-equipamento-list.component').then(m => m.TipoEquipamentoListComponent), data: { breadcrumb: 'Tipos de equipamento', title: 'Tipos de equipamento', section: 'Gerenciamento' } },
  { path: 'monitores', loadComponent: () => import('./features/monitores/monitor-list.component').then(m => m.MonitorListComponent), data: { breadcrumb: 'Monitoramento', title: 'Monitoramento', section: 'Gerenciamento' } },
  { path: 'medicoes', loadComponent: () => import('./features/medicoes/medicao-list.component').then(m => m.MedicaoListComponent), data: { breadcrumb: 'Medições', title: 'Medições', section: 'Gerenciamento' } },
  /*
   * Lista e detalhe são o MESMO componente, e uma única entrada de rota: a gaveta de
   * detalhe é montada pela lista. Os filhos são rotas sem componente — existem só para
   * carregar o `:id` e o `tipo`, que a lista lê de `route.snapshot.firstChild`.
   *
   * A configuração única é o ponto: com três entradas irmãs, navegar de `/incidentes`
   * para `/incidentes/12` trocaria de configuração e o Router destruiria e recriaria a
   * lista — período, aba, filtro de unidade e página perdidos a cada clique em "Ver".
   * Como filhos, o pai sobrevive à navegação e o estado dos filtros fica de pé.
   *
   * O tipo vem da rota que casou, não de um parâmetro: incidente e episódio têm
   * sequências de id independentes que colidem, e o id sozinho não diz de qual origem a
   * ocorrência veio. 'latencia/:id' vem antes de ':id' — não há ambiguidade real, porque
   * ':id' consome um segmento só, mas a ordem explícita evita que uma futura rota
   * curinga inverta o resultado.
   */
  {
    path: 'incidentes',
    loadComponent: () => import('./features/incidentes/incidente-unificado-list.component').then(m => m.IncidenteUnificadoListComponent),
    data: { breadcrumb: 'Incidentes', title: 'Incidentes', section: 'Operações' },
    children: [
      { path: 'latencia/:id', children: [], data: { tipo: IncidentKind.Latency, breadcrumb: 'Detalhe do episódio', title: 'Episódio de latência' } },
      { path: ':id', children: [], data: { tipo: IncidentKind.Incident, breadcrumb: 'Detalhe do incidente', title: 'Incidente' } },
      // `breadcrumb: null` é obrigatório, não decorativo: com a estratégia padrão
      // `emptyOnly`, uma rota filha de path vazio HERDA o `data` do pai — sem isto ela
      // reentrega `breadcrumb: 'Incidentes'` e a trilha da lista sai com o segmento
      // repetido ("Operações › Incidentes › Incidentes").
      { path: '', children: [], data: { breadcrumb: null } },
    ],
  },
  {
    path: 'notificacoes',
    loadComponent: () => import('./features/notificacoes/notificacao-telegram.component').then(m => m.NotificacaoTelegramComponent),
    data: { breadcrumb: 'Notificação via Telegram', title: 'Notificação via Telegram', section: 'Administração' },
    children: [
      { path: '', redirectTo: 'historico', pathMatch: 'full' },
      { path: 'configuracao', loadComponent: () => import('./features/notificacoes/configuracao-tab.component').then(m => m.ConfiguracaoTabComponent), data: { title: 'Telegram · Configuração' } },
      { path: 'historico', loadComponent: () => import('./features/notificacoes/notificacao-list.component').then(m => m.NotificacaoListComponent), data: { title: 'Telegram · Histórico' } },
    ],
  },
  { path: 'notificacoes/detalhe/:id', loadComponent: () => import('./features/notificacoes/notificacao-detail.component').then(m => m.NotificacaoDetailComponent), data: { breadcrumb: 'Detalhe da notificação', title: 'Notificação', section: 'Administração' } },
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

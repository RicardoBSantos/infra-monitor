A03 — Frontend: Login + Sessão — Infra Monitor

1. Objetivo

Implementar no frontend Angular do Infra Monitor a autenticação real contra o backend já homologado na A02/A02.1.

Esta fase deve entregar:

tela de login real;

AuthService;

AuthState em memória;

armazenamento do access token somente em memória;

interceptor Bearer;

integração com POST /api/v1/auth/login;

integração com GET /api/v1/auth/me;

guards de autenticação;

guards/regras iniciais por papel;

tratamento de 401 e 403;

logout local;

menu de usuário;

tratamento de trocaSenhaObrigatoria;

tela/fluxo de troca da própria senha;

experiência coerente após refresh/F5;

integração visual com Claude Design;

testes;

build.

Não implementar ainda a administração completa de usuários no Angular. Isso fica para a A04.

2. Estado atual

Backend já homologado:

POST /api/v1/auth/login
GET  /api/v1/auth/me

JWT bearer stateless
Access token: 15 minutos
Refresh token: NÃO
Cookies: NÃO
CORS credentials: false

Papéis:

ADMIN
OPERADOR
VISUALIZADOR

O frontend atual ainda não envia token e recebe 401 nas APIs protegidas.

3. Decisões arquiteturais já fechadas

Preservar:

token em memória
sem localStorage
sem sessionStorage
sem cookie
sem refresh token
logout local
F5 exige novo login

Não reabrir essas decisões nesta fase.

4. Rotas

Implementar rota pública:

/login

As demais rotas de negócio devem exigir autenticação.

Exemplos:

/dashboard
/mapa
/unidades
/tipos-equipamento
/equipamentos
/monitores
/medicoes
/incidentes
/notificacoes

5. Rota inicial

Ao acessar:

/

sem autenticação:

→ /login

Com autenticação válida:

→ /dashboard

Evitar loops de redirect.

6. LoginComponent

Criar tela de login fiel ao Claude Design.

Campos:

email
senha

Estados:

idle
loading
error
success

Não criar login fake.

7. Formulário

Usar Reactive Forms.

Validações mínimas:

email obrigatório
formato de email
senha obrigatória

Não replicar política de 12–128 no login, já que o usuário pode possuir senha existente válida.

8. AuthService

Responsabilidades:

login(email, senha)
getCurrentUser()
changeOwnPassword(...)
logout()

Não misturar autorização de rota nem UI diretamente no service.

9. AuthState

Criar estado de autenticação em memória.

Deve guardar conceitualmente:

accessToken
expiresAt
usuario
authenticated

Pode usar:

signals
BehaviorSubject

conforme padrão atual do projeto.

Não usar NgRx.

10. Persistência

Não persistir token em:

localStorage
sessionStorage
IndexedDB
cookie

Ao recarregar a página:

AuthState é perdido
→ usuário deve autenticar novamente

Isso é comportamento esperado do V1.

11. Login flow

Fluxo:

usuário envia email/senha
↓
POST /auth/login
↓
recebe accessToken + usuario
↓
AuthState atualizado
↓
navega para /dashboard

Se trocaSenhaObrigatoria=true:

→ fluxo de troca de senha antes de uso normal

12. Login response

Consumir contrato real da A02.

Conceitualmente:

accessToken
expiresIn
usuario

Não decodificar JWT para montar identidade se a response já retorna usuário.

13. /auth/me

Utilizar:

GET /api/v1/auth/me

para validar/consultar identidade atual quando necessário durante a sessão.

Não usar isso como mecanismo de persistência após F5, porque o token já terá sido perdido.

14. Interceptor Bearer

Criar interceptor HTTP.

Para requests da API autenticada:

Authorization: Bearer <accessToken>

Não adicionar bearer em:

/auth/login

ou requests de assets como GeoJSON.

15. apiUrl

Usar a apiUrl centralizada já existente.

Não hardcode:

localhost:8080

no interceptor.

16. 401

Tratamento global:

401
→ limpar AuthState
→ redirecionar para /login

Evitar múltiplos redirects concorrentes.

Pode preservar mensagem de sessão expirada.

17. 403

403 significa:

autenticado
sem permissão

Não fazer logout.

Exibir estado/tela de acesso negado ou feedback coerente.

Não tratar 403 como 401.

18. AUTHENTICATION_FAILED

No login:

401 AUTHENTICATION_FAILED

deve mostrar mensagem genérica:

Credenciais inválidas

Não indicar se e-mail existe.

19. ACCOUNT_DISABLED

No login:

ACCOUNT_DISABLED

mostrar mensagem adequada de conta inativa.

Não revelar detalhes além do necessário.

20. Token expirado

Quando o access token expirar:

próxima request → 401
→ AuthState limpa
→ /login

Sem refresh automático.

21. Timer opcional de expiração

Pode existir timer local simples baseado em expiresIn.

Objetivo:

expirar sessão localmente próximo ao prazo

Mas não é obrigatório se o interceptor tratar corretamente 401.

Não criar mecanismo complexo de refresh.

22. AuthGuard

Criar guard de autenticação para todas as rotas protegidas.

Sem sessão:

→ /login

Com sessão:

→ rota

23. RoleGuard

Criar estratégia simples para roles.

Pode usar route data conceitual:

data: {
roles: ['ADMIN']
}

ou helper equivalente.

Backend continua sendo autoridade.

24. Permissões visuais iniciais

Nesta fase, aplicar apenas o necessário para navegação e ações já existentes.

ADMIN

Pode ver tudo.

OPERADOR

Não deve ver Administração de Usuários futura.

VISUALIZADOR

Deve ver telas de leitura, mas ações mutáveis precisam ser ocultadas/desabilitadas conforme RBAC.

A cobertura completa da autorização visual será consolidada na A04.

25. Sidebar

A sidebar deve refletir autenticação.

Usuário sem sessão:

não vê Application Shell

Após login:

shell normal

Não renderizar shell atrás da tela de login.

26. Topbar / user menu

Adicionar menu real de usuário com:

nome
papel
trocar senha
logout

Não inventar avatar remoto ou dados não disponíveis.

27. Logout

Logout V1 é local.

Fluxo:

limpar AuthState
cancelar timer, se houver
→ /login

Não chamar endpoint /auth/logout, pois ele não existe.

28. Troca de senha obrigatória

Se:

usuario.trocaSenhaObrigatoria = true

usuário deve ser conduzido para fluxo de troca da própria senha.

Endpoint:

PUT /api/v1/usuarios/me/senha

29. Tela de troca de senha

Campos:

senhaAtual
novaSenha
confirmacaoNovaSenha

Validar:

nova senha 12–128
confirmação igual

Backend continua autoridade.

30. Após troca de senha

Após sucesso:

trocaSenhaObrigatoria=false

Atualizar AuthState.

Pode consultar /auth/me após sucesso para obter estado atualizado.

Depois:

→ /dashboard

31. Bloqueio quando troca obrigatória

Enquanto:

trocaSenhaObrigatoria=true

não permitir uso normal das rotas operacionais.

Exceções:

troca de senha
logout

Implementar guard ou regra central simples.

32. Senha atual incorreta

Tratar:

400 INVALID_REQUEST

ou contrato real.

Exibir mensagem sem apagar sessão.

33. Tela de acesso negado

Criar estado/rota equivalente:

/forbidden

ou componente compartilhado.

Deve:

explicar falta de permissão;

permitir voltar;

manter sessão.

34. Página 404

Preservar comportamento atual.

Não confundir:

404
403
401

35. Application Shell

Garantir que:

/login

fique fora do shell.

Rotas autenticadas continuam dentro do shell.

36. F5 / refresh

Com token em memória:

F5
→ token perdido
→ /login

Esse comportamento deve ser intencional e testado.

Não tentar restaurar sessão via storage.

37. Navegação direta

Acessar diretamente:

/equipamentos

sem sessão:

→ /login

Após login, pode redirecionar para:

/dashboard

ou preservar returnUrl, se isso for implementado de forma simples e segura.

38. returnUrl

Opcionalmente preservar rota desejada:

/equipamentos
→ /login?returnUrl=/equipamentos

Após login:

→ /equipamentos

Validar para aceitar apenas rotas internas.

Não permitir open redirect.

39. Expiração e request concorrente

Se múltiplas requests retornarem 401:

limpar sessão uma vez;

navegar uma vez;

evitar cascata de dialogs/toasts.

40. Interceptor e assets

Não adicionar Authorization em:

/assets/**
GeoJSON
fontes
arquivos estáticos

41. Models

Criar models explícitos:

LoginRequest
LoginResponse
AuthUser
AuthMeResponse
Role/PapelUsuario
TrocaSenhaRequest

Reutilizar enum/string union coerente.

Não usar any.

42. Papel

Usar exatamente:

ADMIN
OPERADOR
VISUALIZADOR

Não inventar aliases internos divergentes.

43. Helper de autorização

Pode existir helper:

hasRole()
hasAnyRole()
canWriteInventory()

somente se reduzir repetição.

Não criar permission engine genérico.

44. Ações de escrita para VISUALIZADOR

Nesta fase, revisar pelo menos:

Unidades
Tipos
Equipamentos
Monitores
Fechar Incidente

VISUALIZADOR não deve conseguir acionar mutações pela UI.

Backend já retorna 403, mas UX deve refletir papel.

45. OPERADOR

OPERADOR pode:

CRUD inventário
CRUD monitores
fechar incidente

Não criar administração de usuários nesta fase.

46. ADMIN

Pode executar todas as ações existentes.

47. Login design

Usar Claude Design como referência visual.

Preservar:

tema
tipografia
spacing
inputs
botão
feedback
responsividade

Não redesenhar.

48. Responsividade login

Validar:

320
375
390
mobile
tablet
desktop

49. Acessibilidade

Login:

labels
autocomplete=email
autocomplete=current-password
focus
erro acessível
submit por Enter

Troca senha:

autocomplete=current-password
autocomplete=new-password

50. Segurança frontend

Garantir ausência de:

localStorage.setItem(token)
sessionStorage
console.log(accessToken)
JWT em error logs

51. XSS

Não renderizar claims/token em HTML.

Não usar [innerHTML] para mensagens de segurança.

52. Testes — AuthService

Cobrir:

login request
login success
login inválido
/auth/me
troca senha
logout

53. Testes — AuthState

Cobrir:

set session
clear session
authenticated
role
trocaSenhaObrigatoria

54. Testes — interceptor

Cobrir:

adiciona Bearer
não adiciona no login
não adiciona em asset
401 limpa sessão
403 não limpa sessão

55. Testes — guards

Cobrir:

sem auth → login
com auth → permite
role permitido
role proibido
trocaSenhaObrigatoria

56. Testes — LoginComponent

Cobrir:

form inválido
loading
success
AUTHENTICATION_FAILED
ACCOUNT_DISABLED
redirect

57. Testes — troca de senha

Cobrir:

validação
senha atual errada
sucesso
AuthState atualizado
redirect

58. Testes — UI por papel

Cobrir ao menos:

VISUALIZADOR não vê ação de criar Equipamento
VISUALIZADOR não vê Fechar Incidente
OPERADOR vê ação permitida
ADMIN vê ações

59. Integração manual

Com backend A02 rodando:

acessar /dashboard sem sessão;

confirmar redirect /login;

login ADMIN;

confirmar Dashboard;

confirmar user menu;

logout;

login OPERADOR;

validar ações;

login VISUALIZADOR;

validar ações de leitura;

testar credencial inválida;

testar conta inativa;

testar trocaSenhaObrigatoria;

trocar senha;

testar F5 e novo login;

aguardar/forçar expiração e confirmar 401 → login.

60. API protegida

Após login, Dashboard/Unidades/etc devem voltar a funcionar normalmente.

Confirmar requests com:

Authorization: Bearer

61. Mapa

Confirmar que GeoJSON continua carregando sem bearer.

Dashboard API do mapa deve receber bearer.

62. Telegram

Nenhuma alteração.

63. Build

Executar:

npm run build

Sem warnings novos relevantes.

64. Testes

Executar:

npm test -- --watch=false

Todos devem passar.

65. Não implementar

Não implementar:

refresh token;

remember me;

localStorage/sessionStorage;

administração Angular de Usuários;

recuperação por e-mail;

MFA;

SSO;

auditoria;

deploy.

66. Critérios de aceite

A03 está concluída quando:

/login funciona;

token fica só em memória;

interceptor envia bearer;

/auth/me integrado;

401 limpa sessão;

403 mantém sessão;

guards protegem rotas;

logout local funciona;

F5 exige login;

menu de usuário funciona;

troca obrigatória funciona;

papel afeta ações básicas;

GeoJSON não recebe bearer;

sem token em storage/log;

testes passam;

build passa.

67. Relatório final

A03 — Resultado

Status: CONCLUÍDO / CONCLUÍDO COM RESSALVAS / BLOQUEADO

Login

rota:
request:
response:
redirect:

AuthState

tecnologia:
token em memória:
storage persistente:

Interceptor

Bearer:
exclusões:
401:
403:

Guards

Descrever:

auth
role
trocaSenhaObrigatoria

User menu

Descrever.

Logout

Confirmar que é local.

Troca de senha

Descrever fluxo e endpoint.

Papéis

Descrever comportamento visual:

ADMIN
OPERADOR
VISUALIZADOR

F5

Confirmar:

sessão perdida:
redirect login:

Segurança frontend

Confirmar:

token em localStorage: NÃO
token em sessionStorage: NÃO
token em logs: NÃO
Authorization em assets: NÃO

Validação manual

Listar os 16 passos.

Testes

comando:
quantidade:
resultado:

Build

comando:
resultado:
warnings:

Git diff

Listar arquivos relevantes.

Pendências

Somente problemas reais da A03.

Informações para A04

Listar gaps de RBAC/administração de usuários ainda não implementados.

Não implementar A04.
A05 — Homologação Final de Segurança — Infra Monitor

Objetivo

Executar a homologação final da macrofase de autenticação, usuários e controle de acesso do Infra Monitor. A fase deve validar autenticação, JWT, RBAC, administração de usuários, 401/403, usuário inativo, trocaSenhaObrigatoria, último ADMIN, CORS, segurança de tokens/senhas, regressão do MVP autenticado e a pendência visual residual da A04.1.

Não implementar novas funcionalidades.

Pré-condições

Backend já implementado:

A02/A02.1;

JWT HS256 stateless;

BCrypt;

/auth/login;

/auth/me;

/usuarios/**;

ADMIN / OPERADOR / VISUALIZADOR;

bloqueio de inativos;

proteção do último ADMIN;

PASSWORD_CHANGE_REQUIRED.

Frontend já implementado:

A03/A03.1;

Login;

AuthState em memória;

interceptor;

guards;

401/403;

troca obrigatória;

A04/A04.1 com /usuarios e RBAC visual.

Pendência a fechar:

responsividade manual de /usuarios e telas de auth.

Ambiente

Usar frontend, backend atual e PostgreSQL isolado. Não usar produção.

Registrar sem secrets:

Frontend URL:
Backend URL:
PostgreSQL:
JWT TTL:

Antes de seguir, confirmar:

GET /actuator/health -> 200
POST /api/v1/auth/login -> rota existente
GET /api/v1/auth/me sem token -> 401

Se auth retornar 404, o backend ativo está incorreto.

Pré-check responsivo

Validar /usuarios em:

320
375
390
tablet
desktop

Checar tabela, cabeçalho, ações, formulários/dialogs de criar, editar, resetar senha e desativar.

Validar também Login, Troca de senha e user menu em mobile/tablet/desktop.

Não mascarar overflow com CSS genérico. Corrigir apenas bugs reais e adicionar regressão.

Autenticação

Login válido

ADMIN válido:

POST /auth/login -> 200
frontend -> /dashboard

Login inválido

401 AUTHENTICATION_FAILED

Frontend deve mostrar Credenciais inválidas, sem revelar se e-mail existe.

Conta inativa

401 ACCOUNT_DISABLED

/auth/me

Com JWT válido:

200

Sem token:

401

JWT

Validar:

token válido -> 200
token malformado -> 401
assinatura inválida -> 401
token expirado -> 401

Para expiração, usar TTL reduzido em ambiente isolado se necessário.

No frontend:

401 -> AuthState.clear() -> /login

Sem refresh token.

F5

Após login:

F5 -> token perdido -> /login

Confirmar que não existe persistência em storage.

Usuário inativo após login

login OPERADOR;

guardar token em memória;

ADMIN desativa OPERADOR;

usar token antigo.

Esperado:

401 UNAUTHORIZED imediato

trocaSenhaObrigatoria

Criar/resetar usuário para:

trocaSenhaObrigatoria=true

Validar:

login -> /trocar-senha
/dashboard manual -> bloqueado

Request direta de negócio com token temporário deve retornar:

403 PASSWORD_CHANGE_REQUIRED

Devem continuar permitidos somente endpoints previstos, como:

GET /auth/me
PUT /usuarios/me/senha

Após trocar senha:

trocaSenhaObrigatoria=false
/dashboard liberado

RBAC Backend

ADMIN

Validar:

CRUD Unidades;

CRUD Tipos;

CRUD Equipamentos;

CRUD Monitores;

READ Dashboard/Mapa/Medições/Notificações;

READ + CLOSE Incidentes;

administração lógica de Usuários.

OPERADOR

Validar:

CRUD Unidades/Tipos/Equipamentos/Monitores;

READ Dashboard/Mapa/Medições/Notificações;

READ + CLOSE Incidentes;

/usuarios -> 403.

VISUALIZADOR

Validar READ em:

Dashboard;

Mapa;

Unidades;

Tipos;

Equipamentos;

Monitores;

Medições;

Incidentes;

Notificações.

Mutação controlada, por exemplo:

POST /api/v1/equipamentos -> 403 FORBIDDEN

RBAC Frontend

ADMIN

Confirmar:

Usuários visível;

ações de inventário visíveis;

Fechar incidente visível.

OPERADOR

Confirmar:

Usuários ausente;

ações CRUD de inventário visíveis;

Fechar incidente visível.

VISUALIZADOR

Confirmar no DOM:

Usuários ausente;

sem Novo;

sem Editar;

sem Excluir;

sem Ativar/Desativar;

sem Fechar incidente.

Não aceitar apenas CSS ocultando.

Administração de Usuários

Com ADMIN validar:

listar
criar
editar
resetar senha
desativar
ativar

Auto-desativação

Na UI, a ação não deve ser oferecida para o próprio ADMIN.

Request forjada deve ser bloqueada pelo backend.

Último ADMIN

Com apenas um ADMIN ativo:

desativar -> 409 BUSINESS_CONFLICT
rebaixar -> 409 BUSINESS_CONFLICT

Frontend deve apresentar o conflito sem perder a sessão.

401 / 403

401

limpa AuthState
redireciona /login

403

mantém AuthState
redireciona /forbidden

Depois de 403:

/dashboard

deve funcionar sem novo login.

CORS

Preflight de origem permitida com:

Authorization
Content-Type

deve funcionar.

Confirmar:

credentials=false
wildcard=false

Origem não autorizada deve ser rejeitada.

Segurança de dados

No banco:

senha plaintext: NÃO
BCrypt: SIM

No frontend:

localStorage: sem token
sessionStorage: sem token
cookies: sem auth
IndexedDB: sem token

Em logs frontend/backend:

JWT completo: NÃO
Authorization: NÃO
JWT_SECRET: NÃO
BOOTSTRAP_ADMIN_PASSWORD: NÃO
senha: NÃO
senhaHash frontend: NÃO

Regressão do MVP autenticado

Com ADMIN autenticado, validar:

/dashboard
/mapa
/unidades
/tipos-equipamento
/equipamentos
/monitores
/medicoes
/incidentes
/notificacoes
/usuarios

Confirmar também que autenticação HTTP não quebra:

Monitoring Engine;

Incident Engine;

Telegram dispatcher.

Não é necessário gerar incidente real se nenhum desses componentes mudou; testes/regressão podem bastar.

Testes automatizados

Backend:

.\mvnw.cmd test

Frontend:

npm test -- --watch=false

Confirmar cobertura para:

login;

JWT;

401;

403;

inativo;

PASSWORD_CHANGE_REQUIRED;

último ADMIN;

AuthState;

interceptor;

guards;

/usuarios;

sidebar;

RBAC visual.

Builds finais

Backend:

.\mvnw.cmd clean package

Frontend:

npm run build

Registrar bundle e warnings.

Bugs

Para cada bug real:

A05-BUG-###
Prioridade
Descrição
Reprodução
Esperado
Atual
Causa raiz
Correção
Teste
Status

Prioridade:

P0 — exposição/segurança crítica
P1 — bypass auth/RBAC
P2 — comportamento incorreto
P3 — UX/visual

P0/P1 bloqueiam homologação.

Critérios de aceite

A05 está aprovada quando:

login válido/inválido funciona corretamente;

usuário inativo bloqueado;

JWT inválido/expirado bloqueado;

F5 exige login;

troca obrigatória bloqueia frontend e backend;

ADMIN/OPERADOR/VISUALIZADOR respeitam matriz;

request forjada retorna 403;

403 preserva sessão;

401 limpa sessão;

último ADMIN protegido;

auto-desativação protegida;

/usuarios funciona;

CORS correto;

nenhum token/senha em storage/log;

responsividade residual validada;

MVP autenticado não regrediu;

testes e builds passam.

Relatório final

A05 — Resultado

Status: APROVADO / APROVADO COM RESSALVAS / REPROVADO

Ambiente

Frontend:
Backend:
PostgreSQL:
JWT TTL:

Responsividade residual

/usuarios 320:
375:
390:
tablet:
desktop:
login:
troca senha:
user menu:

Autenticação

login válido:
login inválido:
conta inativa:
/auth/me:

JWT

válido:
malformado:
assinatura inválida:
expirado:
F5:

trocaSenhaObrigatoria

frontend bloqueia:
backend bloqueia:
PASSWORD_CHANGE_REQUIRED:
troca:
liberação:

RBAC Backend

Apresentar:

Área | ADMIN | OPERADOR | VISUALIZADOR

RBAC Frontend

ADMIN:
OPERADOR:
VISUALIZADOR:

Usuários

listar:
criar:
editar:
reset senha:
desativar:
ativar:
auto-desativação:
último ADMIN:

401/403

401 limpa sessão:
403 preserva sessão:
dashboard após 403:

CORS

Authorization:
credentials=false:
origem não autorizada:

Segurança

senha plaintext banco: NÃO
token localStorage: NÃO
token sessionStorage: NÃO
cookie auth: NÃO
JWT frontend logs: NÃO
JWT backend logs: NÃO
senha logs: NÃO
senhaHash frontend: NÃO

Regressão MVP autenticado

Dashboard:
Mapa:
Unidades:
Tipos:
Equipamentos:
Monitores:
Medições:
Incidentes:
Notificações:
Usuários:
Monitoring Engine:
Incident Engine:
Telegram:

Bugs encontrados

Listar todos os A05-BUG.

Testes backend

comando:
quantidade:
resultado:

Testes frontend

comando:
quantidade:
resultado:

Build backend

comando:
resultado:

Build frontend

comando:
resultado:
bundle:
warnings:

Git diff

Listar arquivos alterados durante A05.

Pendências

Somente problemas reais.

Veredito de Segurança

Escolher exatamente:

SEGURANÇA V1 HOMOLOGADA
SEGURANÇA V1 HOMOLOGADA COM RESSALVAS
SEGURANÇA V1 NÃO HOMOLOGADA

Veredito do sistema

Escolher exatamente:

MVP AUTENTICADO APTO PARA PRÓXIMA MACROFASE
MVP AUTENTICADO NÃO APTO PARA PRÓXIMA MACROFASE

Não iniciar automaticamente relatórios, auditoria ou deploy.
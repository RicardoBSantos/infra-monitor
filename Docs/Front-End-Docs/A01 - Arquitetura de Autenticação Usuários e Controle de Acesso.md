A01 — Arquitetura de Autenticação, Usuários e Controle de Acesso — Infra Monitor

1. Objetivo

Definir a arquitetura oficial de autenticação, usuários e autorização do Infra Monitor antes de escrever a implementação de segurança.

Esta fase é deliberadamente de análise e desenho técnico.

Ela deve produzir decisões fechadas para as próximas fases de backend e frontend, cobrindo:

modelo de Usuário;

credenciais;

autenticação;

autorização;

papéis/perfis;

proteção das APIs;

sessão/token;

login;

logout;

recuperação de senha;

troca de senha;

usuário ativo/inativo;

integração com Angular;

segurança de secrets;

auditoria mínima de segurança;

estratégia de migração sem quebrar o MVP já homologado.

Não implementar ainda a solução completa de autenticação.

2. Estado atual

O MVP v1 já foi homologado.

Fluxo funcional validado:

Unidade
↓
Tipo de Equipamento
↓
Equipamento
↓
Monitor ICMP
↓
Medição
↓
Incidente
↓
Notificação
↓
Telegram
↓
Dashboard
↓
Mapa

Atualmente:

Backend REST: sem autenticação
Frontend Angular: sem login funcional
Rotas: públicas
API: acessível sem credenciais

O Claude Design já possui elementos visuais de login/usuário, mas eles ainda não representam contrato funcional.

3. Princípio de segurança

A autenticação deve proteger o sistema sem alterar regras de negócio existentes.

A segurança deve envolver:

Frontend
↓
Autenticação
↓
API protegida
↓
Autorização
↓
Domínio existente

Não mover regras de negócio para o frontend.

4. Modelo de Usuário

Definir entidade de Usuário separada das entidades operacionais.

Estrutura conceitual inicial:

Usuario
├── id
├── nome
├── email ou username
├── senhaHash
├── ativo
├── perfil/papeis
├── ultimoLoginEm
├── createdAt
└── updatedAt

Os campos exatos devem ser decididos nesta fase.

Não armazenar senha em texto puro.

5. Identificador de login

Decidir explicitamente entre:

Opção A — E-mail

email

como login.

Opção B — Username

username

como login.

Opção C — ambos

Não implementar ambos por conveniência sem necessidade.

A recomendação inicial é utilizar e-mail como identificador único, caso o ambiente corporativo possua e-mails individuais confiáveis.

A decisão deve considerar o contexto real do Infra Monitor.

6. Senhas

Obrigatório:

senha
→ hash forte
→ armazenamento apenas do hash

Preferir algoritmo padrão e suportado pelo Spring Security, por exemplo:

BCrypt

ou estratégia equivalente atual.

Nunca:

senha em texto puro
hash reversível
MD5
SHA-1 isolado

7. Perfil/Papel

Definir modelo inicial mínimo.

Sugestão para MVP de segurança:

ADMIN
OPERADOR
VISUALIZADOR

ADMIN

Pode:

administrar Unidades;

Tipos;

Equipamentos;

Monitores;

Usuários;

configurações permitidas;

visualizar tudo;

fechar Incidentes.

OPERADOR

Pode:

visualizar operação;

cadastrar/editar inventário e Monitores, se definido;

fechar Incidentes;

visualizar notificações;

sem administrar Usuários.

VISUALIZADOR

Pode:

Dashboard;

Mapa;

consultas;

sem alteração administrativa.

Essas permissões são proposta inicial. A01 deve validar/refinar.

8. Evitar granularidade prematura

Não criar dezenas de permissões como:

EQUIPMENT_CREATE
EQUIPMENT_READ
EQUIPMENT_UPDATE
...

sem necessidade atual.

Preferir RBAC simples por papel na primeira versão.

A arquitetura pode permitir futura evolução sem implementar permission matrix agora.

9. Usuário ativo/inativo

ativo deve controlar acesso.

Usuário inativo:

não pode autenticar

Se for desativado enquanto possui sessão/token vigente, definir comportamento.

A01 deve decidir se tokens atuais:

permanecem até expiração curta;

ou exigem validação de usuário a cada request;

ou outro mecanismo.

Evitar complexidade excessiva.

10. Estratégia de autenticação

Comparar e decidir entre:

JWT stateless

login
→ access token
→ Authorization: Bearer

Sessão HTTP tradicional

login
→ cookie de sessão

Access + Refresh token

Mais completo, porém mais complexo.

A recomendação inicial para Angular + Spring Boot é avaliar:

access token curto
+
refresh token seguro

mas apenas se a complexidade for justificada.

A01 deve produzir decisão explícita e rationale.

11. Cookies x localStorage

Se JWT for escolhido, decidir onde tokens residem.

Evitar armazenar refresh token em:

localStorage

Preferir, quando viável:

HttpOnly
Secure
SameSite
cookie

para refresh token.

O access token pode ser mantido em memória ou outra estratégia segura.

A decisão precisa considerar:

CORS atual;

frontend/backend possivelmente em origens distintas;

credentials;

deploy futuro.

12. Impacto no CORS

Hoje o contrato usa:

credentials = false

Se autenticação utilizar cookie HttpOnly cross-origin, CORS precisará mudar para:

credentials = true

e origens explícitas.

Isso é uma mudança arquitetural importante.

A01 deve decidir isso antes da implementação.

Não aplicar essa mudança ainda.

13. Estratégia recomendada a avaliar

Uma opção simples para primeira versão:

POST /auth/login
↓
access token JWT curto
↓
Angular mantém token em memória
↓
Authorization: Bearer <token>

Com re-login após expiração.

Outra opção mais completa:

access token curto
+
refresh token HttpOnly

A01 deve escolher a abordagem considerando segurança x complexidade operacional.

14. Endpoints de autenticação

Definir contrato conceitual.

Possíveis endpoints:

POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/refresh
GET  /api/v1/auth/me

Somente incluir refresh se a estratégia escolhida exigir.

15. Login

Payload conceitual:

{
"email": "operador@empresa.com",
"senha": "..."
}

Resposta deve evitar dados sensíveis.

Conceitualmente:

{
"accessToken": "...",
"expiresIn": 900,
"usuario": {
"id": 1,
"nome": "Operador",
"email": "operador@empresa.com",
"papel": "OPERADOR"
}
}

Adaptar à estratégia escolhida.

16. Endpoint /auth/me

É recomendável existir:

GET /api/v1/auth/me

para retornar identidade autenticada.

Não confiar apenas nos dados decodificados no Angular se o backend puder fornecer estado atual.

17. Logout

Definir comportamento conforme estratégia.

JWT puramente stateless:

Angular descarta token

Refresh token persistido:

backend revoga/invalida refresh

A01 deve decidir.

18. Recuperação de senha

O Claude Design possui fluxo visual de recuperação.

Não implementar imediatamente sem definir canal.

Possibilidades:

e-mail corporativo
reset administrativo
link temporário

Se não houver infraestrutura de e-mail ainda, a primeira versão pode utilizar:

ADMIN redefine senha de usuário

com obrigatoriedade de troca posterior, se desejado.

A01 deve separar:

V1

e:

evolução futura

19. Troca de senha

Definir endpoint futuro, por exemplo:

PUT /api/v1/usuarios/me/senha

Payload:

senhaAtual
novaSenha

Não expor hash.

20. Administração de Usuários

Definir endpoints REST conceituais:

GET    /api/v1/usuarios
POST   /api/v1/usuarios
GET    /api/v1/usuarios/{id}
PUT    /api/v1/usuarios/{id}
PATCH  /api/v1/usuarios/{id}/ativar
PATCH  /api/v1/usuarios/{id}/desativar

Delete físico deve ser avaliado.

Recomendação inicial:

não deletar Usuário

preferir desativação, especialmente por futura auditoria.

21. Primeiro usuário ADMIN

Definir como o primeiro administrador será criado.

Opções:

Migration com credencial fixa

NÃO recomendado.

Bootstrap por environment

Possível.

Comando/setup inicial

Possível.

Seed apenas em desenvolvimento

Aceitável para dev/test.

A01 deve definir estratégia segura para produção.

Nunca commit de senha real.

22. Spring Security

Backend deverá futuramente utilizar:

Spring Security

com configuração central.

Não adicionar @PreAuthorize aleatoriamente sem matriz definida.

A01 deve definir:

rotas públicas;

rotas autenticadas;

rotas administrativas.

23. Rotas públicas

Provavelmente:

POST /api/v1/auth/login
POST /api/v1/auth/refresh, se existir
GET /actuator/health

Avaliar documentação/OpenAPI se existir.

Todo restante deve exigir autenticação, salvo decisão explícita.

24. Matriz inicial de autorização

A01 deve produzir tabela final semelhante a:

Área

ADMIN

OPERADOR

VISUALIZADOR

Dashboard

R

R

R

Mapa

R

R

R

Unidades

CRUD

conforme decisão

R

Tipos

CRUD

conforme decisão

R

Equipamentos

CRUD

conforme decisão

R

Monitores

CRUD

conforme decisão

R

Medições

R

R

R

Incidentes

R/Fechar

R/Fechar

R

Notificações

R

R

R

Usuários

CRUD

-

-

A tabela final deve ser validada nesta fase.

25. Backend como autoridade

O Angular pode esconder/desabilitar ações conforme papel.

Mas a autorização real deve ocorrer no backend.

Nunca:

botão escondido
=
segurança

26. Angular

Planejar criação futura de:

AuthService
AuthState
HTTP auth interceptor
route guards
login page
logout
user menu
permission helpers

Não implementar ainda nesta fase.

27. Guard de rota

Planejar:

authGuard
roleGuard

ou abordagem equivalente moderna do Angular.

Evitar guard complexo por tela se uma estratégia declarativa de route data resolver.

28. Interceptor Angular

Planejar inclusão:

Authorization: Bearer <token>

se JWT for escolhido.

Também planejar tratamento de:

401
403

401

Sessão/autenticação inválida.

403

Usuário autenticado sem permissão.

Não tratar ambos como a mesma coisa.

29. Tela de Login

O Claude Design já possui referência visual.

A implementação futura deve reutilizar:

identidade visual;

campos;

feedback;

layout.

Não implementar fake login.

30. User menu

A topbar atual não possui usuário fake.

Planejar futuro menu:

nome
papel
alterar senha
logout

Somente depois da autenticação real.

31. Auditoria

Autenticação introduz necessidade futura de rastrear:

quem alterou
quem fechou incidente
quem criou equipamento

Não implementar auditoria completa na A01.

Mas a arquitetura deve permitir obter:

authenticated user id

nos serviços futuros.

32. Banco de dados

Planejar migrations para:

usuarios
roles/perfis, se tabela separada
refresh_tokens, se estratégia exigir
password_reset_tokens, se futuramente necessário

Evitar criar tabela para o que pode ser enum simples no MVP.

33. Papel como enum ou entidade

Decidir.

Para apenas:

ADMIN
OPERADOR
VISUALIZADOR

um enum persistido como string pode ser suficiente.

Tabela de roles só se houver necessidade real.

34. Constraints

Planejar:

email UNIQUE
ativo NOT NULL
senha_hash NOT NULL
papel NOT NULL

conforme modelo final.

35. Política de senha

Definir mínimo razoável.

Evitar regras arbitrariamente complexas.

Possível primeira versão:

mínimo 10 ou 12 caracteres

sem exigir combinações artificiais de símbolos/maiúsculas se não houver política corporativa.

A01 deve registrar política final.

36. Rate limiting / brute force

Avaliar necessidade.

Não implementar infraestrutura complexa agora.

No mínimo, documentar risco de brute force em /auth/login.

Pode ficar como hardening futuro se ambiente for interno e controlado.

37. Logs de autenticação

Planejar logs sanitizados:

login success
login failure
user id/email sanitizado
logout
account disabled

Nunca logar senha ou token.

38. Tokens em logs

Proibido:

Authorization header
JWT inteiro
refresh token
senha

em logs.

39. Erros de autenticação

Definir contrato.

Exemplos:

AUTHENTICATION_FAILED
ACCOUNT_DISABLED
UNAUTHORIZED
FORBIDDEN

Avaliar se entram nos códigos públicos existentes.

Evitar revelar:

"e-mail existe, senha errada"

Preferir mensagem genérica no login:

Credenciais inválidas

40. Compatibilidade com ApiError

Autenticação deve reutilizar o envelope de erro existente quando aplicável.

Não criar formato completamente diferente sem justificativa.

41. Testes futuros

A01 deve definir matriz de testes para implementação posterior:

Backend

login válido
login inválido
usuário inativo
token válido
token expirado
token inválido
401
403
ADMIN
OPERADOR
VISUALIZADOR

Frontend

login
logout
guard
401
403
refresh, se existir
persistência/reload
papéis
ações visíveis

42. Estratégia de rollout

O MVP está homologado sem autenticação.

A implementação futura deve evitar um estado intermediário confuso.

Planejar ordem:

A01 — Arquitetura
A02 — Backend Auth + Usuários
A03 — Frontend Login + Sessão
A04 — RBAC/Proteção completa
A05 — Homologação de Segurança

Pode ajustar nomes, mas separar backend/frontend é recomendado.

43. Não implementar nesta fase

Não implementar agora:

Spring Security completo;

migrations de Usuário;

JWT;

login Angular;

guards;

usuário real;

recuperação de senha;

RBAC em endpoints;

auditoria;

e-mail.

A01 é definição arquitetural.

44. Entrega obrigatória da A01

Produzir documento final com:

Decisões

identificador de login;

modelo de Usuário;

papel;

política de senha;

estratégia de token/sessão;

refresh token: sim/não;

armazenamento no Angular;

cookies/credentials;

logout;

usuário inativo;

primeiro ADMIN.

Endpoints

Contrato proposto de:

/auth/*
/usuarios/*

RBAC

Tabela final de permissões.

Segurança

hash;

expiração;

CORS;

CSRF;

401/403;

logs;

secrets.

Frontend

AuthService;

interceptor;

guards;

login;

logout;

menu.

Banco

Modelo/tabelas propostas.

Roadmap

Dividir implementação nas próximas fases.

Riscos

Listar riscos e decisões que ainda dependem de informação externa.

Não implementar código além de documentação/análise mínima necessária.
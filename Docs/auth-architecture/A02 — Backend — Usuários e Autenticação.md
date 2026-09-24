A02 — Backend: Usuários + Autenticação — Infra Monitor

1. Objetivo

Implementar no backend do Infra Monitor a primeira versão funcional de autenticação e administração de usuários, conforme as decisões fechadas na A01.

Esta fase deve entregar:

entidade/tabela usuarios;

migration Flyway;

enum de papel;

BCrypt;

bootstrap seguro do primeiro ADMIN;

login por e-mail;

JWT bearer stateless;

POST /api/v1/auth/login;

GET /api/v1/auth/me;

administração de usuários;

ativação/desativação;

reset administrativo de senha;

troca da própria senha;

proteção inicial da API com Spring Security;

401/403 padronizados;

testes;

documentação.

O Angular ainda não deve ser alterado nesta fase.

2. Pré-condições

A A01 definiu:

Identificador: e-mail corporativo único
Papéis: ADMIN, OPERADOR, VISUALIZADOR
Autenticação: JWT bearer stateless
Access token: 15 minutos
Refresh token: NÃO no V1
Frontend storage: memória
Cookies: NÃO
CORS credentials: false
CSRF: desabilitado para bearer sem cookie
Logout: local
Usuário inativo: não autentica
Primeiro ADMIN: bootstrap por ambiente
Reset V1: ADMIN redefine senha
Senha: BCrypt custo 12
Política: 12–128 caracteres
JWT: HS256

Essa fase deve implementar essas decisões sem redesenhar a arquitetura.

3. Dependência Spring Security

Adicionar Spring Security de forma compatível com a versão atual do Spring Boot.

Não adicionar bibliotecas de segurança desnecessárias.

Para JWT, usar biblioteca adequada e amplamente suportada pelo stack atual.

Evitar introduzir dependência excessivamente complexa.

4. Migration usuarios

Criar nova migration Flyway incremental.

Não editar migrations antigas.

Tabela conceitual:

usuarios
├── id
├── nome
├── email
├── senha_hash
├── papel
├── ativo
├── troca_senha_obrigatoria
├── ultimo_login_em
├── created_at
└── updated_at

Campos exatos devem seguir convenções reais do projeto.

5. E-mail case-insensitive

O e-mail deve ser único sem diferenciar maiúsculas/minúsculas.

Exemplo:

Admin@Empresa.com
admin@empresa.com

devem representar o mesmo login.

Preferir estratégia compatível com PostgreSQL e com o padrão do projeto.

Pode ser:

índice único sobre lower(email);

normalização para lowercase antes de persistir;

ou combinação coerente.

Documentar a estratégia.

6. Papel

Criar enum persistido como string:

ADMIN
OPERADOR
VISUALIZADOR

Não criar tabelas de roles/permissions nesta fase.

7. Entidade Usuario

Criar entidade separada das entidades operacionais.

Campos:

id
nome
email
senhaHash
papel
ativo
trocaSenhaObrigatoria
ultimoLoginEm
createdAt
updatedAt

Não expor senhaHash em DTO público.

8. Senha

Usar BCrypt com custo 12.

Nunca armazenar texto puro.

Nunca logar senha.

9. Política de senha

Validar:

mínimo 12 caracteres
máximo 128 caracteres

Não exigir regras artificiais adicionais sem necessidade.

Aplicar a mesma política em:

criação;

reset administrativo;

troca da própria senha.

10. DTOs

Criar contratos explícitos, por exemplo:

UsuarioResponse
UsuarioCreateRequest
UsuarioUpdateRequest
UsuarioResetSenhaRequest
UsuarioTrocaSenhaRequest

LoginRequest
LoginResponse
AuthMeResponse

Adaptar nomes ao padrão real.

11. Login

Endpoint:

POST /api/v1/auth/login

Request conceitual:

{
"email": "usuario@empresa.com",
"senha": "senha..."
}

12. Login — validações

Fluxo:

normalizar e-mail
↓
buscar usuário
↓
validar ativo
↓
validar senha BCrypt
↓
emitir JWT
↓
atualizar ultimoLoginEm

Em credencial inválida, retornar resposta genérica.

Não revelar se o e-mail existe.

13. Login — erros

Usar códigos estáveis:

AUTHENTICATION_FAILED
ACCOUNT_DISABLED

Se a política final preferir não revelar estado de conta no login, ACCOUNT_DISABLED pode ser usado somente quando apropriado e seguro.

Preservar envelope ApiError.

14. JWT

Usar HS256.

Secret deve vir exclusivamente de configuração externa.

Exemplo conceitual:

JWT_SECRET
JWT_ISSUER
JWT_ACCESS_TOKEN_MINUTES

Não commit secret real.

15. Tamanho do secret

Validar secret com pelo menos:

32 bytes

ou requisito equivalente da biblioteca usada.

Se inválido, falhar startup de forma clara quando segurança estiver ativa.

Não logar secret.

16. Claims

JWT deve conter apenas o necessário.

Conceitualmente:

iss
sub = user id
role
iat
exp

Pode incluir e-mail somente se houver necessidade concreta.

Evitar dados desnecessários.

17. Expiração

Default:

15 minutos

Tornar configurável externamente.

Não criar refresh token nesta fase.

18. /auth/me

Endpoint:

GET /api/v1/auth/me

Retorna usuário autenticado atual.

Conceitualmente:

{
"id": 1,
"nome": "Administrador",
"email": "admin@empresa.com",
"papel": "ADMIN",
"ativo": true,
"trocaSenhaObrigatoria": false
}

Nunca retornar hash.

19. Filtro JWT

Criar filtro bearer stateless.

Fluxo:

Authorization: Bearer <token>
↓
validar assinatura
↓
validar expiração
↓
extrair subject
↓
carregar usuário
↓
validar ativo
↓
criar Authentication

20. Usuário desativado após token emitido

Mesmo que JWT ainda esteja válido, a cada request autenticada o backend deve consultar estado atual do usuário e recusar usuário inativo.

Isso implementa a decisão da A01.

21. Segurança stateless

Configurar:

SessionCreationPolicy.STATELESS

Não criar sessão HTTP.

22. CSRF

Como não há cookie de autenticação, desabilitar CSRF para API bearer.

Documentar.

23. CORS

Preservar configuração CORS central existente.

Adicionar:

Authorization

à lista de headers permitidos.

Preservar:

credentials = false

e origens explícitas.

Não usar wildcard.

24. Rotas públicas

Permitir sem autenticação:

POST /api/v1/auth/login
GET /actuator/health

Se houver endpoint de documentação técnica, avaliar explicitamente.

Todo restante da /api/** deve exigir autenticação.

25. 401

Requests sem token, token inválido ou expirado devem retornar:

401
code = UNAUTHORIZED

usando envelope de erro padronizado.

26. 403

Usuário autenticado sem permissão:

403
code = FORBIDDEN

Não confundir 401 e 403.

27. Administração de Usuários

Endpoints ADMIN:

GET    /api/v1/usuarios
POST   /api/v1/usuarios
GET    /api/v1/usuarios/{id}
PUT    /api/v1/usuarios/{id}
PATCH  /api/v1/usuarios/{id}/ativar
PATCH  /api/v1/usuarios/{id}/desativar
PUT    /api/v1/usuarios/{id}/senha

28. Própria senha

Endpoint autenticado:

PUT /api/v1/usuarios/me/senha

Request conceitual:

{
"senhaAtual": "...",
"novaSenha": "..."
}

Validar senha atual.

29. Reset administrativo

ADMIN pode redefinir senha:

PUT /api/v1/usuarios/{id}/senha

Request:

{
"novaSenha": "..."
}

Após reset administrativo:

trocaSenhaObrigatoria = true

30. Troca obrigatória

Ao criar novo usuário ou após reset administrativo, definir conforme decisão:

trocaSenhaObrigatoria = true

A A02 deve preparar backend para essa informação.

A aplicação completa de bloqueio de rotas até troca pode ser finalizada em A04, mas o backend já deve expor o estado.

31. Criar usuário

ADMIN cria usuário com:

nome
email
senhaInicial
papel

Default:

ativo = true
trocaSenhaObrigatoria = true

se coerente com A01.

32. Editar usuário

PUT deve permitir editar dados administrativos permitidos, como:

nome
email
papel

Não alterar senha pelo PUT genérico.

Senha usa endpoint específico.

33. Ativar/desativar

Usar endpoints específicos.

Ao desativar:

novo login proibido
tokens existentes deixam de funcionar nos requests seguintes

34. Auto-desativação

Evitar que o ADMIN autenticado desative a si mesmo se isso puder deixar o sistema sem administração ativa.

Definir regra segura.

No mínimo, impedir:

usuário atual → desativar a si próprio

se não houver segundo ADMIN.

Pode optar por impedir sempre auto-desativação.

Documentar.

35. Último ADMIN

Evitar desativar/rebaixar o último ADMIN ativo.

Essa é uma regra de segurança importante.

Implementar verificação transacional.

Não permitir sistema ficar sem ADMIN ativo.

36. Delete

Não implementar DELETE de Usuário.

Usar desativação.

37. Primeiro ADMIN

Implementar bootstrap idempotente por configuração de ambiente.

Exemplo conceitual:

BOOTSTRAP_ADMIN_ENABLED
BOOTSTRAP_ADMIN_NAME
BOOTSTRAP_ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD

Nomes reais podem variar.

38. Bootstrap seguro

Com bootstrap habilitado:

se não existe ADMIN inicial, criar;

normalizar e-mail;

hashear senha;

não logar senha;

ser idempotente;

não sobrescrever senha de ADMIN existente silenciosamente.

39. Bootstrap em produção

O bootstrap deve depender de secret/config externa.

Não colocar senha default no código.

Se variável obrigatória estiver ausente com bootstrap habilitado, falhar de forma clara.

40. Bootstrap em dev/test

Pode haver valores controlados em testes, nunca em código de produção real.

.env.example deve usar placeholders.

41. Autorização inicial

Nesta fase, implementar proteção suficiente para:

ADMIN

Acesso total às APIs atuais.

OPERADOR

Conforme A01:

READ Dashboard/Mapa/Medições/Notificações;

CRUD Unidades/Tipos/Equipamentos/Monitores;

READ + CLOSE Incidentes;

sem Usuários.

VISUALIZADOR

Somente leitura nas áreas operacionais/admin, sem mutações.

42. Método HTTP como regra

Pode centralizar autorização por rota + método no SecurityFilterChain.

Exemplo conceitual:

GET /api/v1/unidades/** -> todos autenticados
POST/PUT/PATCH/DELETE /api/v1/unidades/** -> ADMIN, OPERADOR

Usuários:

/api/v1/usuarios/** -> ADMIN

com exceção:

PUT /api/v1/usuarios/me/senha -> autenticado

43. Incidentes

Permitir:

GET /incidentes/** -> todos autenticados
PATCH /incidentes/{id}/fechar -> ADMIN, OPERADOR

VISUALIZADOR não fecha.

44. Medições

Somente leitura para frontend autenticado.

O POST /medicoes existente pode ser interno/técnico.

Avaliar cuidadosamente para não expor criação manual a VISUALIZADOR.

Se endpoint público permanecer, restringir adequadamente.

45. Dashboard

READ para:

ADMIN
OPERADOR
VISUALIZADOR

46. Notificações

READ para todos autenticados.

Sem mutações.

47. Segurança do Monitoring Engine

Jobs internos não devem depender de autenticação HTTP.

Não alterar engine.

48. Segurança Telegram

Não alterar T01.

49. ApiError

Integrar erros de segurança ao envelope existente.

Exemplo:

{
"timestamp": "...",
"status": 401,
"error": "Unauthorized",
"code": "UNAUTHORIZED",
"message": "Autenticacao obrigatoria",
"path": "/api/v1/..."
}

Não expor stacktrace.

50. Testes — autenticação

Cobrir:

login válido
login inválido
email case-insensitive
usuário inativo
senha errada
JWT válido
JWT expirado
JWT inválido
JWT com assinatura inválida

51. Testes — /auth/me

Cobrir:

com token válido
sem token
usuário desativado após emissão

52. Testes — usuários

Cobrir:

ADMIN cria
ADMIN lista
ADMIN edita
ADMIN ativa/desativa
ADMIN reseta senha
usuário troca própria senha
VISUALIZADOR não administra
OPERADOR não administra

53. Testes — RBAC

Cobrir matriz real.

Exemplos:

VISUALIZADOR GET /equipamentos -> 200
VISUALIZADOR POST /equipamentos -> 403
OPERADOR POST /equipamentos -> permitido
OPERADOR PATCH fechar incidente -> permitido
VISUALIZADOR PATCH fechar incidente -> 403
ADMIN /usuarios -> permitido
OPERADOR /usuarios -> 403

54. Testes — último ADMIN

Cobrir:

não desativar último ADMIN
não rebaixar último ADMIN

55. Testes — bootstrap

Cobrir:

cria primeiro ADMIN
idempotente
não duplica
senha não é texto puro
config inválida falha corretamente

56. Testes — CORS Authorization

Validar preflight e requests com header:

Authorization

para origens permitidas.

57. Validação manual

Com PostgreSQL de teste:

iniciar backend com bootstrap ADMIN;

fazer login;

obter JWT;

chamar /auth/me;

chamar Dashboard com token;

chamar Dashboard sem token → 401;

criar OPERADOR;

login OPERADOR;

POST Equipamento → permitido;

/usuarios → 403;

criar VISUALIZADOR;

login VISUALIZADOR;

GET Equipamentos → permitido;

POST Equipamento → 403;

desativar usuário;

confirmar token anterior deixa de funcionar.

58. Compatibilidade com frontend atual

A partir da A02, a API ficará protegida.

O frontend atual sem A03 passará a receber 401 nas rotas protegidas.

Isso é esperado.

Documentar claramente no relatório.

Não criar bypass temporário amplo apenas para o frontend antigo.

Se for necessário para homologação local, usar profile explicitamente separado e não produção.

59. Documentação

Atualizar:

Docs/auth-architecture.md
docs/frontend-api-contract.md
README
.env.example

ou caminhos reais.

Documentar variáveis:

JWT_SECRET
JWT_ISSUER
JWT_ACCESS_TOKEN_MINUTES
BOOTSTRAP_ADMIN_*

sem valores reais.

60. Não implementar

Não implementar nesta fase:

Angular login;

AuthService frontend;

refresh token;

cookie;

recuperação por e-mail;

MFA;

SSO;

auditoria completa;

deploy.

61. Critérios de aceite

A02 está concluída quando:

migration usuarios existe;

BCrypt custo 12;

e-mail case-insensitive;

papéis enum string;

bootstrap ADMIN seguro;

login funciona;

JWT 15 min;

/auth/me funciona;

API protegida;

401 padronizado;

403 padronizado;

ADMIN/OPERADOR/VISUALIZADOR respeitam RBAC;

usuário inativo não autentica;

token de usuário desativado deixa de funcionar;

usuários CRUD lógico funciona;

reset de senha funciona;

troca da própria senha funciona;

último ADMIN protegido;

CORS permite Authorization;

secrets não estão no código;

testes passam;

build passa.

62. Relatório final

A02 — Resultado

Status: CONCLUÍDO / CONCLUÍDO COM RESSALVAS / BLOQUEADO

Migration

Informar arquivo/tabela.

Usuario

Descrever entidade e campos.

E-mail

Descrever normalização/unicidade.

Senha

Informar:

algoritmo:
cost:
política:

JWT

Informar:

algoritmo:
issuer:
expiração:
claims:
configuração externa:

Sem secret.

Bootstrap ADMIN

Descrever variáveis e comportamento.

Auth API

Informar resultados:

POST /auth/login:
GET /auth/me:

Usuários API

Listar endpoints implementados.

RBAC

Mostrar matriz implementada.

401/403

Mostrar exemplos sanitizados.

Usuário inativo

Descrever comportamento.

Último ADMIN

Descrever proteções.

CORS

Confirmar Authorization permitido e credentials false.

Testes

Informar:

comando:
quantidade:
resultado:

Build

Informar:

comando:
resultado:

Validação manual

Listar os 16 passos da especificação com resultado.

Segurança

Confirmar:

senha plaintext no banco: NÃO
JWT secret no código: NÃO
JWT em logs: NÃO
Authorization em logs: NÃO

Compatibilidade frontend

Confirmar que frontend sem A03 agora recebe 401, conforme esperado.

Git diff

Listar arquivos relevantes.

Pendências

Somente problemas reais da A02.

Observações para A03

Tudo que o Angular precisará saber para implementar login e sessão.

Não implementar A03.
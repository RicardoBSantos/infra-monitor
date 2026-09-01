# A01 — Arquitetura de Autenticação, Usuários e Controle de Acesso

**Status:** Decisão arquitetural aprovada para implementação nas fases A02–A05.  
**Escopo:** contratos e desenho; este documento não introduz dependências, migrations, segurança executável ou mudanças no MVP homologado.

## 1. Diagnóstico do estado atual

- Backend: Spring Boot 4.1 / Java 21 / PostgreSQL / Flyway. O `pom.xml` **não** declara `spring-boot-starter-security`, biblioteca JWT nem dependência de autenticação. Não há código legado de `SecurityFilterChain`, JWT, login, `UserDetails`, `PasswordEncoder` ou autorização.
- API: todas as rotas de negócio sob `/api/v1/**` são públicas hoje; `GET /actuator/health` é o único endpoint de Actuator exposto.
- CORS: `CorsConfiguration` aplica-se a `/api/**`, recebe origens explícitas de `CORS_ALLOWED_ORIGINS`, permite métodos HTTP usuais e somente `Accept`, `Content-Type` e `X-Requested-With`. Não habilita credentials nem o header `Authorization`.
- Erros: o envelope público existente é `ErroResposta` — `timestamp`, `status`, `error`, `code`, `message`, `path`, e `fields` opcional. No Angular ele é modelado como `ApiError`; a implementação de auth o preservará.
- Frontend: Angular 21 possui `ApplicationShell`, sidebar, topbar sem usuário e rotas totalmente públicas. Há somente `apiErrorInterceptor`, sem interceptor de autenticação, guards ou serviço de login.
- Claude Design: possui protótipo visual de login, recuperação, “lembrar” e menu/usuários com credenciais e links fictícios. Não é código integrado nem contrato funcional.
- Banco: migrations V1–V11 cobrem inventário, monitoramento, incidentes e notificações. Não existe tabela de usuários, papéis, tokens ou auditoria.

O trabalho foi iniciado com `git status`: o worktree já continha alterações de usuário em arquivos de backend, frontend e documentação. Esta A01 não as modifica.

## 2. Decisões fechadas

| Tema | Decisão |
|---|---|
| Identificador de login | **E-mail corporativo**, único e comparado sem distinção de maiúsculas/minúsculas. Não haverá username alternativo. |
| Papéis | Um papel por usuário: `ADMIN`, `OPERADOR` ou `VISUALIZADOR`, persistido como string de enum. Não haverá tabelas `roles`/`permissions` no MVP. |
| Autenticação | JWT bearer stateless, access token curto, enviado em `Authorization: Bearer`. |
| Refresh token | **NÃO** no V1 de segurança. Re-login é preferível à complexidade de persistência, rotação e revogação nesta etapa. |
| Armazenamento Angular | Somente em memória, no `AuthState`. Nenhum token em `localStorage`, `sessionStorage` ou cookie. |
| Cookies / credentials | Não usados. `withCredentials` permanece `false`; CORS permanece sem credentials. |
| CSRF | Não necessário para a API bearer sem autenticação por cookie; será explicitamente desabilitado na futura cadeia stateless. |
| Expiração | Access token: **15 minutos**. Após expirar, o Angular limpa a sessão e direciona para login preservando a URL de retorno segura. |
| Logout | Operação local: descartar access token e identidade em memória e navegar a `/login`. Não há endpoint nem alegação de revogação de JWT. |
| Usuário inativo | Não autentica. Ao desativar, tokens emitidos podem durar no máximo até a expiração de 15 min; `/auth/me` e cada request protegido consultam o estado ativo atual e retornam `401 ACCOUNT_DISABLED` se estiver inativo. |
| Primeiro ADMIN | Bootstrap único e idempotente por configuração de ambiente/secret, executado no startup somente quando não houver usuário. Desenvolvimento/teste usa seed isolado; produção não usa senha fixa nem migration de credencial. |
| Reset V1 | ADMIN define uma senha temporária para outro usuário e marca `trocaSenhaObrigatoria=true`. Não há recuperação por e-mail no V1. |

### Por que e-mail e JWT em memória

O ambiente já usa e-mails corporativos no design e não apresenta requisito para apelidos de login; e-mail reduz um identificador a administrar e é reconhecível pelo operador. O valor é normalizado para minúsculas no serviço e protegido no banco por unicidade case-insensitive.

Para a SPA Angular em origem possivelmente distinta da API Spring, bearer em memória preserva CORS sem cookies, sem CSRF e sem refresh cross-origin. O risco de roubo persistente por XSS é menor do que com Web Storage: o token desaparece ao recarregar a página. A troca é UX deliberada: F5, fechar aba ou reabrir navegador exigem novo login; não existe “lembrar-me” no V1. Esta escolha também remove o loop de refresh e a tabela de tokens desta primeira entrega.

Cookies `HttpOnly` seriam uma alternativa útil caso se escolha refresh posteriormente, mas exigiriam `credentials=true`, origens sem wildcard, `SameSite` e `Secure` adequados, política de CSRF e tratamento cuidadoso de domínios. Isso não será parcialmente introduzido agora.

## 3. Modelo de usuário

Entidade conceitual `Usuario`:

```text
id: Long
nome: String
email: String                       // e-mail corporativo normalizado
senhaHash: String                   // nunca exposto pela API
papel: PapelUsuario                 // ADMIN | OPERADOR | VISUALIZADOR
ativo: boolean
trocaSenhaObrigatoria: boolean
ultimoLoginEm: Instant?             // atualizado apenas após login bem-sucedido
createdAt: Instant
updatedAt: Instant
```

`email` é o login e não há `username`. `trocaSenhaObrigatoria` atende criação/reset administrativo seguro: enquanto estiver verdadeiro, o usuário só pode obter identidade e trocar a própria senha; A02/A04 definirá a resposta `PASSWORD_CHANGE_REQUIRED` e a restrição central correspondente. Dados de perfil devolvidos nunca incluem `senhaHash`, flags internas ou timestamps sem necessidade de tela.

### Senhas

- Hash: `BCryptPasswordEncoder`, custo 12 (configurável por propriedade futura, sem segredo no código). BCrypt traz salt próprio; não aplicar SHA/MD5 adicional.
- Política mínima: 12 a 128 caracteres Unicode; não vazia; não pode ser igual ao e-mail nem conter o e-mail completo sem distinção de caixa. Não serão exigidas combinações artificiais de símbolo, maiúscula ou número sem política corporativa que as justifique.
- A validação deve ocorrer antes do hash; mensagens de validação não podem incluir a senha informada.
- Criação e reset definem senha temporária conforme a mesma política e `trocaSenhaObrigatoria=true`; a troca da própria senha requer senha atual (exceto no primeiro acesso/reset, que usa a senha temporária recém-validada) e invalida o token em memória por logout local.

## 4. RBAC final

Legenda: `R` = READ; `C` = CREATE; `U` = UPDATE, incluindo ativar/desativar; `D` = DELETE conforme endpoint já existente; `CI` = `CLOSE_INCIDENT`; `—` = sem acesso. O backend é a autoridade; esconder botões ou rotas no Angular é apenas experiência de uso.

| Área | ADMIN | OPERADOR | VISUALIZADOR |
|---|---|---|---|
| Dashboard | R | R | R |
| Mapa | R | R | R |
| Unidades | CRUD | CRUD | R |
| Tipos de equipamento | CRUD | CRUD | R |
| Equipamentos | CRUD | CRUD | R |
| Monitores | CRUD | CRUD | R |
| Medições | R | R | R |
| Incidentes | R, CI | R, CI | R |
| Notificações | R | R | R |
| Usuários | CRUD lógico, ativar/desativar, reset | — | — |

Assim, ADMIN consulta tudo, administra usuários e tem CRUD integral de Unidades, Tipos, Equipamentos e Monitores, além de fechar incidentes. OPERADOR não pode administrar usuários, mas pode manter o inventário e monitores e fechar incidentes. VISUALIZADOR só lê as áreas operacionais listadas. Não há DELETE físico de usuário; a retirada de acesso é desativação.

O enum simples satisfaz os três papéis estáveis. Uma futura necessidade de permissões por unidade, papéis múltiplos, delegação ou regras por ação justificará evolução versionada para roles/permissions, sem fingir que a complexidade já existe.

## 5. Contratos Auth API

Base: `/api/v1`. JSON camelCase; datas UTC ISO-8601.

### `POST /api/v1/auth/login` (público)

Request:

```json
{"email":"operador@empresa.com","senha":"segredo"}
```

Resposta `200`:

```json
{
  "accessToken":"<JWT>",
  "tokenType":"Bearer",
  "expiresIn":900,
  "usuario":{
    "id":1,
    "nome":"Operador",
    "email":"operador@empresa.com",
    "papel":"OPERADOR",
    "trocaSenhaObrigatoria":false
  }
}
```

Login com e-mail inexistente ou senha errada retorna `401 AUTHENTICATION_FAILED` com a mesma mensagem pública: `Credenciais inválidas.` O endpoint não revela se a conta existe. Conta desativada retorna `401 ACCOUNT_DISABLED` após a verificação da credencial; isso permite orientação legítima sem enumerar e-mails por tentativas sem senha válida. Não há `refresh`.

### `GET /api/v1/auth/me` (autenticado)

Resposta `200`:

```json
{"id":1,"nome":"Operador","email":"operador@empresa.com","papel":"OPERADOR","trocaSenhaObrigatoria":false}
```

É a fonte de estado atual para bootstrap do frontend e confirma que a conta continua ativa. Não recebe nem devolve token. Não haverá `POST /auth/logout`: JWT stateless não pode ser invalidado honestamente sem lista de revogação; logout é local.

### JWT e assinatura

Claims mínimos:

```text
iss = infra-monitor
sub = id do usuário em string
uid = id numérico do usuário
role = ADMIN | OPERADOR | VISUALIZADOR
iat, exp
```

Não incluir e-mail, nome, senha, dados pessoais adicionais, permissões expandidas ou segredos. O papel no claim evita consulta apenas para decidir autoridade, mas o usuário ativo é verificado a cada request e a autorização permanece central. Assinatura V1: **HMAC-SHA-256** com segredo de no mínimo 32 bytes aleatórios, fornecido exclusivamente como secret de ambiente/cofre (`AUTH_JWT_SECRET`); `AUTH_JWT_ISSUER` e a validade também serão configuráveis. O segredo não tem default, não entra em `.env.example` com valor real, não é logado e deve permitir rotação planejada (janela curta de tokens / nova chave coordenada). RSA/ECDSA só passa a ser indicado quando validadores externos ou múltiplos serviços precisarem verificar tokens sem receber a chave de assinatura.

## 6. Contratos Usuários API (ADMIN)

| Endpoint | Contrato e resposta |
|---|---|
| `GET /api/v1/usuarios` | Lista paginada de perfis públicos; filtros futuros `ativo`, `papel`, `q`; retorna `PaginaResposta<UsuarioResumo>`. |
| `POST /api/v1/usuarios` | Cria usuário com `nome`, `email`, `papel`, `senhaTemporaria`; retorna `201 UsuarioResponse`, com `trocaSenhaObrigatoria=true`. |
| `GET /api/v1/usuarios/{id}` | Retorna `UsuarioResponse`. |
| `PUT /api/v1/usuarios/{id}` | Atualiza `nome`, `email`, `papel` e `ativo`; não aceita senha. Retorna `UsuarioResponse`. |
| `PATCH /api/v1/usuarios/{id}/ativar` | Ativa e retorna `UsuarioResponse`. |
| `PATCH /api/v1/usuarios/{id}/desativar` | Desativa e retorna `UsuarioResponse`; não permite desativar o último ADMIN ativo nem o próprio usuário sem outro ADMIN ativo. |
| `PUT /api/v1/usuarios/{id}/senha` | Reset administrativo V1 com `{ "novaSenhaTemporaria": "..." }`; retorna `204`, marca troca obrigatória e não devolve segredo. |
| `PUT /api/v1/usuarios/me/senha` | Troca própria com `{ "senhaAtual":"...", "novaSenha":"..." }`; retorna `204`. |

`UsuarioResponse` e `UsuarioResumo` podem expor somente `id`, `nome`, `email`, `papel`, `ativo`, `trocaSenhaObrigatoria`, `ultimoLoginEm`, `createdAt` e `updatedAt` conforme a tela. Nunca expõem hash. Não existe `DELETE /usuarios/{id}` físico, inclusive por futura auditoria e integridade histórica.

## 7. Erros, status e rotas públicas

Os códigos novos estáveis, no envelope `ErroResposta`/`ApiError`, são:

| HTTP | Código | Uso público |
|---|---|---|
| 401 | `AUTHENTICATION_FAILED` | Credenciais de login inválidas, sem distinguir e-mail/senha. |
| 401 | `ACCOUNT_DISABLED` | Credencial correta para conta desativada ou conta desativada em request autenticado. |
| 401 | `UNAUTHORIZED` | Bearer ausente, malformado, inválido ou expirado. |
| 403 | `FORBIDDEN` | Usuário autenticado sem papel para a ação. |
| 403 | `PASSWORD_CHANGE_REQUIRED` | Ação fora da troca de senha enquanto a senha temporária exige alteração. |

`401` sempre significa ausência ou falha de autenticação e leva o Angular a limpar a sessão e ir ao login (uma única vez). `403` significa identidade válida, mas sem direito: o Angular mantém a sessão, apresenta mensagem de acesso negado e evita redirecionar para login.

Rotas públicas futuras são exclusivamente `POST /api/v1/auth/login` e `GET /actuator/health`. `/api/v1/status` deixará de ser público e todo restante de `/api/v1/**`, inclusive `/auth/me`, exigirá autenticação. Se documentação/OpenAPI for adicionada, somente publicação estática sem dados sensíveis poderá ser pública por decisão explícita.

## 8. Banco proposto para A02

### `usuarios`

| Coluna | PostgreSQL | Nulo | Regra |
|---|---|---:|---|
| `id` | `BIGINT GENERATED BY DEFAULT AS IDENTITY` | não | PK |
| `nome` | `VARCHAR(150)` | não | `btrim(nome) <> ''` |
| `email` | `VARCHAR(254)` | não | normalizado no serviço; não vazio |
| `senha_hash` | `VARCHAR(100)` | não | hash BCrypt |
| `papel` | `VARCHAR(20)` | não | check nos três valores de enum |
| `ativo` | `BOOLEAN` | não | default `TRUE` |
| `troca_senha_obrigatoria` | `BOOLEAN` | não | default `TRUE` |
| `ultimo_login_em` | `TIMESTAMPTZ` | sim | UTC |
| `created_at` | `TIMESTAMPTZ` | não | default `CURRENT_TIMESTAMP` |
| `updated_at` | `TIMESTAMPTZ` | não | default `CURRENT_TIMESTAMP` |

Índices/constraints: PK `pk_usuario`; unique index `uq_usuario_email` em `LOWER(email)` (não parcial, pois e-mail de conta desativada não pode ser reutilizado); índice `ix_usuario_papel_ativo (papel, ativo)` apenas se a listagem administrativa/filtro comprovar utilidade. Não há `deleted_at`, `roles`, `permissions`, `refresh_tokens` nem `password_reset_tokens` no V1. Atualização de `updated_at` seguirá o padrão de aplicação já adotado; migrations versionadas novas, sem editar V1–V11.

## 9. Backend futuro — Spring Security

Em A02, adicionar dependências somente então e criar módulo `auth` (entidade, repositório, DTOs, serviço de login e JWT) e configuração central. A `SecurityFilterChain` será stateless (`SessionCreationPolicy.STATELESS`):

1. CORS integrado à cadeia de segurança, mantendo a configuração central atual, e CSRF desabilitado para bearer sem cookie.
2. Permitir apenas `POST /api/v1/auth/login` e `GET /actuator/health`; exigir autenticação no restante.
3. Um filtro bearer próprio valida estrutura, assinatura, issuer e validade; consulta usuário por `uid`, exige `ativo`, e cria `Authentication` com `ROLE_<papel>`.
4. `AuthenticationEntryPoint` (401) e `AccessDeniedHandler` (403) escrevem `ErroResposta`, para não quebrar o contrato atual.
5. A matriz será preferencialmente aplicada por regras de método + path centralizadas no `SecurityFilterChain` (método HTTP e rota). `@PreAuthorize` será usado só onde uma regra de domínio específica não puder ser expressa pela rota, sem duplicar regras.

Serviços de domínio continuam independentes de detalhes JWT. Auditoria futura recebe `currentUserId` por uma abstração (`CurrentUserProvider`) que lê o `Authentication` já criado; nenhuma tabela de auditoria é parte de A01.

### CORS e headers futuros

Como bearer é enviado por header, A02 deverá acrescentar `Authorization` aos headers permitidos e confirmar o tratamento de preflight na cadeia Spring Security. `CORS_ALLOWED_ORIGINS` continuará lista explícita. Não será habilitado `allowCredentials`; cookies continuarão ausentes. Todo tráfego produtivo deve usar HTTPS, pois bearer é confidencial em trânsito.

## 10. Frontend futuro — Angular

- `AuthService`: chama login e `/auth/me`, executa logout local e centraliza transições; nunca armazena senha depois da resposta.
- `AuthState`: signal/store em memória com `accessToken`, instante de expiração e `UsuarioAutenticado`; é a única fonte de sessão para UI.
- `authInterceptor`: inclui `Authorization: Bearer <token>` apenas para a API e nunca para `POST /auth/login`; detecta expiração local. Não existe refresh e, portanto, nenhum retry/loop.
- `authGuard`: bloqueia toda rota da aplicação, exceto `/login`, e preserva `returnUrl` interno validado.
- `roleGuard`/helper: lê `data.roles` para navegação e acesso visual. Exemplo: `{ data: { roles: ['ADMIN'] } }`. Backend continua sendo a autoridade.
- interceptor de erros: evolui o atual para tratar 401 e 403 de forma distinta; delega erros de formulário (inclusive login) ao componente e garante uma única navegação de logout para 401 concorrentes.
- `LoginComponent`: rota pública isolada, fora de `ApplicationShell`; campos `email` (tipo email, autocomplete `username`) e `senha` (autocomplete `current-password`), validação, loading, submit bloqueado durante request e erro público. A opção “lembrar” não será exibida no V1. “Recuperar senha” mostra informação de suporte/reset administrativo, sem fingir envio de e-mail.
- Shell/topbar: somente após `/auth/me` válido, mostra menu com nome, rótulo do papel, `Trocar senha` e `Sair`; sidebar e ações usam helper para ocultar/desabilitar o que o papel não faz.

Com token só em memória: **F5**, fechar aba e reabrir navegador removem a sessão e vão a `/login`; navegação SPA normal mantém a sessão até logout, 401 ou 15 minutos. Não se deve tentar restaurar sessão de storage.

## 11. Primeiro ADMIN, recuperação e troca de senha

### Produção

Um `ApplicationRunner` de bootstrap, habilitado por propriedade explícita, somente cria o primeiro ADMIN quando a tabela estiver vazia. Receberá nome, e-mail e senha temporária por variáveis/secret manager obrigatórios; falha sem imprimir valores caso estejam ausentes. O runner é idempotente, desabilitado por padrão após uso e não altera usuário existente. Operação deve trocar a senha no primeiro login e remover/rotacionar o secret de bootstrap.

### Desenvolvimento e teste

Seed de perfil dev/test separado, com credenciais descartáveis documentadas somente no ambiente local. Nunca migration com senha fixa, hash de credencial conhecida ou seed produtivo.

### V1 e futuro

| V1 | Futuro |
|---|---|
| ADMIN cria/redefine senha temporária; usuário troca a própria senha via `PUT /usuarios/me/senha`. | Recuperação por e-mail corporativo com token de uso único, hash do token, expiração curta, consumo atômico, rate limiting e tabela `password_reset_tokens`. |
| Sem e-mail, link mágico, refresh ou token de reset persistido. | Avaliar notificação, política corporativa, MFA/SSO e revogação de sessão. |

## 12. Logs e observabilidade

Podem ser registrados de forma sanitizada: sucesso de login (ID), falha de login (e-mail mascarado ou hash operacional), desativação de conta (ator e alvo quando houver auditoria) e logout local apenas como evento de frontend/telemetria confiável, não como revogação. Nunca registrar senha, `senhaHash`, JWT completo, refresh token, header `Authorization`, cookie ou corpo bruto de login. A02 também deve evitar que logs de exceção e tracing capturem esses headers/corpos.

Brute force em `/auth/login` permanece risco conhecido: A02 deve instrumentar falhas; A05 deve decidir rate limiting por IP + identificador, lockout proporcional e proteção de proxy/WAF conforme o ambiente real.

## 13. Checklist de testes futuros

### Backend (A02/A04)

- login válido, inválido e de usuário inativo; mesma resposta para e-mail inexistente/senha errada;
- hash BCrypt e política de senha; criação/reset/troca sem retorno ou log de segredo;
- JWT válido, expirado, malformado, assinatura/issuer inválidos e usuário desativado após emissão;
- `/auth/me`, 401 e envelope `ErroResposta`; 403 e envelope `ErroResposta`;
- cada célula da matriz ADMIN/OPERADOR/VISUALIZADOR, incluindo `CLOSE_INCIDENT`, CRUD de inventário e usuários somente ADMIN;
- rotas públicas exatas, todo o restante protegido, CORS preflight com `Authorization`, sem credentials/CSRF cookie;
- bootstrap idempotente, sem senha fixa, e proteção contra desativar último ADMIN ativo.

### Frontend (A03/A04)

- login, loading, erro genérico e retorno seguro à rota original;
- logout, expiração, F5, fechar/reabrir aba e ausência intencional de persistência;
- inclusão do bearer só para API, sem token no login e sem loop/retry de refresh;
- 401 limpa sessão e vai ao login; 403 conserva sessão e informa acesso negado;
- guard de autenticação, `data.roles`, menu/sidebar, ações CRUD/fechar incidente e telas por papel;
- topbar com nome/papel e troca de senha; nenhuma senha/token em armazenamento ou console.

## 14. Roadmap

| Fase | Escopo |
|---|---|
| **A02 — Backend: Usuários + Auth** | Dependências Spring Security/JWT, migration `usuarios`, enum/entidade/repositório, BCrypt, bootstrap seguro, login/me/troca/reset administrativo, filtro JWT, 401/403 no envelope e testes unitários/integrados. Ainda sem frontend real. |
| **A03 — Frontend: Login + Sessão** | Modelos, `AuthService`/`AuthState`, login visual baseado no Claude Design, interceptor bearer, logout local, `/auth/me`, guards, menu autenticado e testes. |
| **A04 — RBAC e proteção completa** | Aplicar integralmente a matriz a todas as rotas atuais, metadata/UX de papel, validar ações de tela, obrigatoriedade de troca de senha e cobertura de autorização end-to-end. |
| **A05 — Homologação de Segurança** | Teste de regressão do fluxo homologado, testes negativos 401/403/tokens/CORS, revisão de secrets e logs, HTTPS/proxy, rate limiting/monitoramento de brute force e checklist operacional de bootstrap. |

## 15. Riscos e pendências externas

1. Confirmar no deployment A05 que frontend e API usam HTTPS; bearer em HTTP não é aceitável em produção.
2. Definir onde o secret `AUTH_JWT_SECRET` e a senha de bootstrap residirão (secret manager da plataforma/CI, não repositório). A arquitetura não pressupõe um fornecedor.
3. Confirmar se há política corporativa obrigatória de senha, SSO/IdP, MFA ou recuperação por e-mail. Até essa confirmação prevalece a política simples e reset administrativo V1.
4. A validação de conta ativa a cada request adiciona uma consulta leve ao banco; é a decisão de segurança simples para permitir desativação em até uma request. Se a carga justificar, A05 poderá avaliar cache curto com invalidação, sem alterar o contrato.
5. Sem refresh token, a sessão de 15 minutos prioriza segurança e simplicidade sobre conveniência. Se a operação exigir jornadas maiores, reavaliar access + refresh HttpOnly como evolução formal, com CORS/CSRF e revogação desenhados antes de implementar.

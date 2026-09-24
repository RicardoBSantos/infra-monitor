A04 — Administração de Usuários + RBAC Completo — Infra Monitor

1. Objetivo

Implementar no frontend Angular do Infra Monitor a administração de Usuários e consolidar o RBAC completo da aplicação, com base no backend A02/A02.1 e na autenticação frontend A03/A03.1.

Entregas:

rota /usuarios;

listagem, criação e edição;

ativação/desativação;

reset administrativo de senha;

papéis/status;

sidebar e rotas condicionais por papel;

RBAC visual explícito em todas as features;

tratamento consistente de 401/403;

testes, build e homologação manual.

Não alterar a arquitetura de autenticação definida na A01.

2. Matriz RBAC

ADMIN

Dashboard/Mapa/Medições/Notificações: READ

Unidades/Tipos/Equipamentos/Monitores: CRUD

Incidentes: READ + CLOSE

Usuários: administração completa lógica

OPERADOR

Dashboard/Mapa/Medições/Notificações: READ

Unidades/Tipos/Equipamentos/Monitores: CRUD

Incidentes: READ + CLOSE

Usuários: sem acesso

VISUALIZADOR

Dashboard/Mapa/Unidades/Tipos/Equipamentos/Monitores/Medições/Incidentes/Notificações: READ

Usuários: sem acesso

Nenhuma mutação

Backend continua sendo a autoridade final.

3. Backend disponível

Usar somente os contratos reais já implementados:

GET    /api/v1/usuarios
POST   /api/v1/usuarios
GET    /api/v1/usuarios/{id}
PUT    /api/v1/usuarios/{id}
PATCH  /api/v1/usuarios/{id}/ativar
PATCH  /api/v1/usuarios/{id}/desativar
PUT    /api/v1/usuarios/{id}/senha
PUT    /api/v1/usuarios/me/senha

Antes de implementar, confirmar DTOs, paginação e filtros reais.

4. Rota /usuarios

Somente ADMIN.

OPERADOR/VISUALIZADOR devem receber /forbidden, sem logout.

A feature deve continuar lazy-loaded.

5. Sidebar

Adicionar item Usuários apenas para ADMIN.

Não renderizar item desabilitado para outros papéis.

6. Models

Criar models explícitos, por exemplo:

UsuarioResponse
UsuarioCreateRequest
UsuarioUpdateRequest
UsuarioResetSenhaRequest
UsuarioListQuery

Reutilizar PapelUsuario.

Não usar any.

7. UsuarioApiService

Criar service dedicado com responsabilidades equivalentes:

list()
getById(id)
create(request)
update(id, request)
ativar(id)
desativar(id)
resetSenha(id, request)

Não misturar com AuthService.

8. Listagem

Exibir apenas campos reais do DTO, por exemplo:

Nome
E-mail
Papel
Status
Troca de senha pendente
Último login
Criado em
Atualizado em
Ações

Se ultimoLoginEm = null, apresentar Nunca acessou.

9. Paginação e filtros

Confirmar contrato real antes de codificar.

Se for PageResponse<T>, usar paginação server-side. Não aplicar filtros locais sobre página paginada.

Só implementar filtros suportados pelo backend.

10. Novo usuário

Formulário ADMIN:

nome
email
papel
senhaInicial

Validações:

nome obrigatório;

e-mail obrigatório e válido;

papel obrigatório;

senha 12–128.

Backend controla ativo e trocaSenhaObrigatoria conforme contrato.

11. Edição

Permitir editar:

nome
email
papel

Não editar senha no formulário genérico.

12. Reset administrativo de senha

Usar:

PUT /api/v1/usuarios/{id}/senha

Form:

novaSenha;

confirmarNovaSenha;

12–128;

confirmação idêntica.

Após sucesso, respeitar trocaSenhaObrigatoria=true retornado/consultado.

Nunca reexibir senha.

13. Ativar/desativar

Usar endpoints PATCH reais.

Confirmar com dialog do Design System.

Não usar window.confirm().

14. Auto-desativação

Se usuário listado for o próprio usuário autenticado, não oferecer ação incoerente de desativação.

Backend continua protegendo.

15. Último ADMIN

Não replicar toda a regra no frontend.

Em 409 BUSINESS_CONFLICT, mostrar erro de negócio retornado pela API.

O mesmo vale para rebaixamento do último ADMIN.

16. E-mail duplicado

Tratar 409 BUSINESS_CONFLICT pelo ApiError.code.

Não comparar mensagem crua para lógica.

17. Status

Exibir:

Ativo
Inativo

e, se disponível:

Troca de senha pendente

18. RBAC visual completo

Não usar CSS genérico como autorização.

Consolidar helpers explícitos, por exemplo:

isAdmin()
canManageInventory()
canManageMonitors()
canCloseIncident()
canManageUsers()

Evitar condições repetidas em dezenas de templates.

19. Unidades

ADMIN/OPERADOR:

Novo

Editar

Ativar/Desativar

Excluir, se endpoint permitir

VISUALIZADOR:

leitura apenas

20. Tipos

Mesma regra de Unidades.

21. Equipamentos

ADMIN/OPERADOR:

Novo

Editar

Ativar/Desativar

Excluir

VISUALIZADOR:

leitura/detalhe

22. Monitores

ADMIN/OPERADOR:

Novo

Editar

Ativar/Desativar

Excluir

VISUALIZADOR:

leitura

23. Incidentes

ADMIN/OPERADOR:

READ + Fechar

VISUALIZADOR:

READ

24. Dashboard/Mapa/Medições/Notificações

Todos autenticados:

READ

Sem mutações fictícias.

25. 401/403

Preservar:

401 → limpar AuthState → /login
403 → manter sessão → /forbidden

26. Testes UsuarioApiService

Cobrir método, URL, body e params para:

list;

getById;

create;

update;

ativar;

desativar;

resetSenha.

27. Testes /usuarios

Cobrir:

loading;

success;

empty;

error;

create;

update;

activate/deactivate;

reset password;

validation;

duplicate e-mail;

409 último ADMIN;

próprio usuário.

28. Testes de rota/sidebar

Cobrir:

ADMIN acessa /usuarios;

OPERADOR → forbidden;

VISUALIZADOR → forbidden;

sidebar mostra Usuários somente a ADMIN.

29. Testes RBAC por feature

Adicionar regressão para:

Unidades;

Tipos;

Equipamentos;

Monitores;

Incidentes.

Validar DOM, não apenas CSS.

30. Homologação manual ADMIN

Validar:

login ADMIN;

item Usuários aparece;

/usuarios abre;

listar;

criar OPERADOR;

criar VISUALIZADOR;

editar usuário;

mudar papel quando permitido;

resetar senha;

desativar;

ativar;

auto-desativação tratada;

último ADMIN tratado.

31. Homologação OPERADOR

Validar:

Usuários não aparece;

/usuarios → forbidden;

CRUD inventário/monitores funciona;

Fechar incidente disponível.

32. Homologação VISUALIZADOR

Validar:

Usuários não aparece;

/usuarios → forbidden;

leitura funciona;

ações de escrita ausentes;

Fechar incidente ausente.

33. Request forjada

Com VISUALIZADOR, request administrativa manual deve retornar 403 e a sessão deve permanecer válida.

34. Responsividade

Validar /usuarios em:

320;

375;

390;

tablet;

desktop.

35. Acessibilidade

Garantir:

labels;

foco;

teclado;

dialogs acessíveis;

mensagens de erro;

status textual.

36. Segurança

Preservar:

senha não persistida;

senha não logada;

token apenas em memória;

token não logado;

nenhum senhaHash exposto.

37. Não implementar

Não implementar:

refresh token;

MFA;

SSO;

recuperação por e-mail;

permissões customizadas;

roles dinâmicas;

delete físico de Usuário;

auditoria completa;

deploy.

38. Build e testes

Executar:

npm test -- --watch=false
npm run build

Preservar lazy loading e ganhos da H02.

39. Critérios de aceite

A04 está concluída quando:

/usuarios existe;

somente ADMIN acessa;

sidebar condicional funciona;

CRUD lógico de Usuário funciona;

reset administrativo funciona;

último ADMIN é tratado;

auto-desativação tem UX coerente;

RBAC visual está explícito;

VISUALIZADOR não recebe mutações;

OPERADOR mantém ações permitidas;

401/403 não regrediram;

autenticação não regrediu;

lazy loading preservado;

testes e build aprovados.

40. Relatório final

A04 — Resultado

Status: CONCLUÍDO / CONCLUÍDO COM RESSALVAS / BLOQUEADO

Usuários

rota:
service:
models:
listagem:
paginação:
filtros:

CRUD lógico

create:
update:
ativar:
desativar:
reset senha:
delete físico:

Route guard

ADMIN:
OPERADOR:
VISUALIZADOR:

Sidebar

ADMIN vê Usuários:
OPERADOR vê Usuários:
VISUALIZADOR vê Usuários:

RBAC final

Apresentar tabela:

Área | ADMIN | OPERADOR | VISUALIZADOR

Helpers

Descrever estratégia de autorização frontend.

VISUALIZADOR

Confirmar ausência de mutações em:

Unidades
Tipos
Equipamentos
Monitores
Incidentes

OPERADOR

Confirmar ações permitidas.

ADMIN

Confirmar administração completa lógica.

401/403

401 limpa sessão:
403 preserva sessão:

Homologação manual

Relatar cenários ADMIN/OPERADOR/VISUALIZADOR.

Testes

comando:
quantidade:
resultado:

Build

comando:
resultado:
bundle:
warnings:

Segurança

senha persistida frontend: NÃO
senha logada: NÃO
token em storage: NÃO
token logado: NÃO

Git diff

Listar arquivos relevantes.

Pendências

Somente problemas reais.

Veredito

Escolher:

A04 HOMOLOGADA
A04 HOMOLOGADA COM RESSALVAS
A04 NÃO HOMOLOGADA

Pronto para A05

SIM/NÃO

Não implementar A05.
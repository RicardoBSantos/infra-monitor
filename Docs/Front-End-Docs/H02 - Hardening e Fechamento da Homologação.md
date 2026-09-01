Objetivo

Encerrar as duas ressalvas da H01 sem adicionar funcionalidades:

corrigir H01-BUG-001, corte horizontal dos cards do Dashboard em mobile;

investigar o warning do bundle Angular (507,58 kB para budget de 500 kB) e aplicar apenas otimizações seguras.

Ao final, decidir se o sistema pode ser marcado como MVP v1 — HOMOLOGADO.

Escopo

Frontend Angular. Não implementar autenticação, usuários, relatórios, auditoria ou novas features.

Dashboard mobile

Reproduzir o problema em 375 px antes da alteração. Auditar grid, min-width, colunas, gaps, paddings, filhos, box-sizing, textos, containers e overflow.

Corrigir a causa raiz. Não mascarar com overflow-x: hidden.

Validar:

320 px

360 px

375 px

390 px

412 px

tablet

desktop

Cards devem reorganizar-se naturalmente, inclusive para uma coluna quando necessário. Adicionar regressão adequada ao stack existente.

Bundle Angular

Executar npm run build e registrar tamanho inicial.

Investigar:

eager loading desnecessário;

lazy loading das rotas;

imports globais;

dependências grandes;

código/assets incorporados indevidamente;

imports duplicados;

bibliotecas no bootstrap sem necessidade.

Não instalar ferramenta pesada só para análise. Não remover funcionalidade. Não aumentar o budget como primeira solução.

Aplicar apenas otimização simples, segura e mensurável. Se não houver ganho seguro, documentar. Ajustar o budget somente se houver justificativa técnica explícita.

Lazy loading

Auditar app.routes.ts. Features que não precisam compor o bootstrap devem permanecer ou passar a lazy loading quando isso for compatível e de baixo risco. Evitar refactor amplo.

Regressão funcional

Validar:

/dashboard

/mapa

/unidades

/tipos-equipamento

/equipamentos

/monitores

/medicoes

/incidentes

/notificacoes

Não é necessário repetir o ciclo destrutivo completo de Telegram/Incidente da H01 se domínio/backend não forem alterados.

Testes

Executar npm test -- --watch=false ou script equivalente real.

Build

Executar npm run build e registrar bundle antes/depois, budget e warnings.

Critérios de aceite

sem corte de cards entre 320–412 px;

sem scroll horizontal indevido causado pelo Dashboard;

tablet/desktop sem regressão;

regressão adequada para H01-BUG-001;

bundle analisado objetivamente;

otimizações seguras aplicadas quando encontradas;

nenhuma funcionalidade removida;

testes e build aprovados.

O warning de bundle pode permanecer apenas se tecnicamente justificado.

Relatório final

H02 — Resultado

Status: APROVADO / APROVADO COM RESSALVAS / REPROVADO

H01-BUG-001

reprodução:

causa raiz:

correção:

viewports validados:

teste de regressão:

Bundle

tamanho antes:

budget:

causa/análise:

alterações:

tamanho depois:

warning permanece: SIM/NÃO

justificativa:

Rotas/Lazy loading

Auditoria e alterações.

Regressão

Rotas verificadas.

Testes

comando:

quantidade:

resultado:

Build

comando:

resultado:

warnings:

Git diff

Arquivos relevantes.

Pendências

Somente problemas reais restantes.

Veredito

Escolher exatamente:

MVP v1 — HOMOLOGADO

MVP v1 — HOMOLOGADO COM RESSALVAS

MVP v1 — NÃO HOMOLOGADO

Não iniciar a próxima macrofase automaticamente.
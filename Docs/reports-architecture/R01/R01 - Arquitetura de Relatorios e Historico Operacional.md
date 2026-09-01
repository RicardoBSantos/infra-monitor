R01 — Arquitetura de Relatórios e Histórico Operacional — Infra Monitor

Objetivo

Definir a arquitetura oficial do módulo de Relatórios antes da implementação.

Fechar:

tipos de relatório;

filtros;

fórmulas;

fontes de dados;

agregações;

paginação e sort;

contratos REST;

exportação;

RBAC;

frontend;

performance;

roadmap.

Não implementar código de produção nesta fase.

Contexto

O sistema já possui Unidades, Tipos, Equipamentos, Monitores ICMP, Medições, Incidentes, Notificações, Dashboard, Mapa, Autenticação, Usuários e RBAC.

O histórico operacional existente no PostgreSQL deve ser reutilizado. Não duplicar dados em tabelas de relatório sem necessidade comprovada.

Relatórios V1 propostos

Disponibilidade por Equipamento

Para cada equipamento:

tempo monitorado;

tempo disponível;

tempo indisponível;

disponibilidade percentual;

quantidade de incidentes.

Disponibilidade por Unidade

Para cada Unidade:

equipamentos monitorados;

disponibilidade agregada;

incidentes;

tempo indisponível.

Histórico de Incidentes

Unidade;

Equipamento;

Monitor;

início;

fim;

duração;

status.

Histórico de Medições

Monitor;

Equipamento;

status;

latência;

executadoEm.

Latência ICMP

Por Monitor/Equipamento:

mínima;

média;

máxima;

quantidade de sucessos.
Avaliar p95 apenas se simples e justificável.

Notificações

evento;

canal;

status;

tentativas;

enviadoEm;

erro.

Fora do escopo V1

SLA contratual;

SLO;

ML/predição;

PDF complexo;

relatório customizável;

agendamento por e-mail;

billing;

retenção/particionamento implementados agora.

Período

Todos os relatórios usam inicio e fim em UTC.

Regra:

inicio <= fim

Período inválido:

400 INVALID_REQUEST

Definir limite por tipo de consulta. Proposta inicial:

agregados: até 365 dias;

medições detalhadas: até 31 dias.

Fórmula de disponibilidade

A R01 deve definir fórmula oficial no backend.

Não usar simplesmente:

SUCESSO / total de medições

Preferir abordagem temporal baseada em intervalos monitorados e Incidentes.

Considerar:

Monitor desabilitado;

Equipamento desativado;

SEM_DADOS;

sem Monitor;

Incidente aberto;

incidentes que cruzam início/fim do período.

Incidente aberto no fim do período deve ser truncado para fim para cálculo.

Incidente que cruza o período deve considerar somente a interseção.

Equipamento sem Monitor:

disponibilidade = null
estado analítico = SEM_MONITORAMENTO

Sem dados suficientes:

disponibilidade = null

Não usar 0% ou 100% inventado.

Agregação por Unidade

A R01 deve decidir entre média simples e média ponderada.

Recomendação: média ponderada pelo tempo efetivamente monitorado.

Frontend não calcula isso.

Latência

Somente medições SUCESSO.

Métricas:

min
avg
max
count

Avaliar p95 apenas se suportado de forma simples pelo PostgreSQL.

Fontes

Usar tabelas existentes:

unidades
tipos_equipamento
equipamentos
monitores
medicoes
incidentes
notificacoes

Evitar carregar grandes volumes em memória Java para agregar.

Preferir projections/SQL/JPQL/native queries eficientes.

Índices a auditar

medicoes(monitor_id, executado_em);

medicoes(status, executado_em);

incidentes(monitor_id, iniciado_em);

relacionamentos Equipamento/Unidade;

datas/status em Notificações.

Não criar migrations nesta fase; apenas recomendar.

API proposta

Namespace:

/api/v1/relatorios

Endpoints candidatos:

GET /relatorios/disponibilidade/equipamentos
GET /relatorios/disponibilidade/unidades
GET /relatorios/incidentes
GET /relatorios/medicoes
GET /relatorios/latencia
GET /relatorios/notificacoes

A R01 deve fechar a lista final.

Filtros comuns

Conforme cada relatório:

inicio
fim
unidadeId
equipamentoId
tipoEquipamentoId
monitorId
status
page
size
sort

Somente filtros com sentido para o endpoint.

Paginação

Detalhados:

Incidentes;

Medições;

Notificações.

Devem ser server-side.

Decidir se agregados por Unidade/Equipamento também serão paginados.

Sort

Cada endpoint deve documentar whitelist de campos.

Sort inválido:

400 INVALID_REQUEST

DTO conceitual de disponibilidade

{
"equipamentoId": 10,
"equipamentoNome": "SW-CORE-01",
"unidadeId": 1,
"unidadeNome": "Sede",
"inicio": "2026-08-01T00:00:00Z",
"fim": "2026-08-31T23:59:59Z",
"tempoMonitoradoSegundos": 2678400,
"tempoIndisponivelSegundos": 120,
"disponibilidadePercentual": 99.99,
"incidentes": 1
}

A R01 deve fechar os DTOs reais.

Precisão

Definir regra consistente de arredondamento, por exemplo 2 casas para exibição.

Backend retorna valor numérico coerente; Angular apenas formata.

Exportação

V1 deve priorizar CSV.

Definir padrão de endpoint, por exemplo:

GET /api/v1/relatorios/{tipo}/export.csv

ou equivalente.

Export deve respeitar:

JWT;

RBAC;

mesmos filtros;

limites de período.

Timestamps exportados: ISO-8601 UTC.

RBAC proposto

Avaliar:

ADMIN: READ + EXPORT
OPERADOR: READ + EXPORT
VISUALIZADOR: READ

Decidir se VISUALIZADOR também pode exportar.

Frontend

Planejar rota:

/relatorios

Sugestão de navegação:

Relatórios
├── Disponibilidade
├── Incidentes
├── Medições
├── Latência
└── Notificações

Evitar uma tela monolítica.

Filtros podem reutilizar:

Unidade → Equipamento → Monitor
período
status

Gráficos

Podem existir visualizações simples, mas devem consumir dados agregados do backend.

Não enviar grandes volumes de medições ao Angular para montar agregações.

Não instalar biblioteca de gráficos nesta fase.

Performance

Definir estratégia para consultas históricas e índices.

Considerar crescimento contínuo de Medições.

Documentar como evolução futura:

retenção;

particionamento;

materialized views, se necessário.

Não implementar agora.

Testes backend planejados

Cobrir:

período válido/inválido;

incidente dentro do período;

incidente cruzando início;

incidente cruzando fim;

incidente aberto;

sem incidente;

sem Monitor;

sem dados;

agregação de Unidade;

latência;

paginação;

sort;

RBAC;

CSV.

Testes frontend planejados

Cobrir:

filtros;

loading;

empty;

error;

success;

paginação;

export;

RBAC;

timezone;

gráficos, se houver.

Roadmap sugerido

R01 — Arquitetura e contratos
R02 — Backend de Relatórios
R03 — Frontend de Relatórios
R04 — Exportação CSV e visualizações
R05 — Homologação de Relatórios

Entrega obrigatória

Criar documento de decisão, preferencialmente:

Docs/reports-architecture.md

Ele deve fechar:

relatórios V1;

fórmula de disponibilidade;

agregação por Unidade;

contratos REST;

filtros;

paginação;

sort;

DTOs;

exportação;

RBAC;

estratégia de banco/performance;

arquitetura frontend;

roadmap R02–R05.

Relatório final

R01 — Resultado

Status: CONCLUÍDO / CONCLUÍDO COM RESSALVAS / BLOQUEADO

Relatórios V1

Listar.

Disponibilidade

Fórmula oficial.

Sem dados / sem monitoramento

Comportamento.

Unidade

Agregação oficial.

Latência

Métricas.

API

Endpoints.

Filtros

Tabela endpoint × filtros.

Paginação

Por endpoint.

Sort

Campos permitidos.

DTOs

Resumo.

Exportação

formato:
endpoint:
RBAC:
timezone:

Banco e performance

Índices/projeções/estratégias.

Frontend

Rotas, filtros e visualizações.

RBAC

Tabela:

Relatório | ADMIN | OPERADOR | VISUALIZADOR

Testes planejados

Backend e frontend.

Roadmap

R02
R03
R04
R05

Riscos / decisões futuras

Somente itens reais.

Arquivos alterados

Somente documentação/análise.

Não implementar R02.
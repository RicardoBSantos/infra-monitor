R02 --- Backend de Relatórios --- Infra Monitor

1. Objetivo

Implementar no backend Spring Boot a arquitetura de relatórios definida
e aprovada na R01.

A R02 inclui:

migration e ciclo de vida de janela_monitoramento;

compatibilidade histórica com janelas inferidas;

disponibilidade temporal por Monitor/Equipamento;

disponibilidade agregada por Unidade;

histórico analítico de Incidentes;

histórico analítico de Medições;

agregação de Latência ICMP, incluindo p95;

histórico analítico de Notificações;

validação de período e coerência hierárquica;

paginação e sort server-side;

RBAC dos relatórios;

testes automatizados;

análise de índices e planos de consulta.

A R02 não implementa frontend, CSV ou gráficos.

2. Contrato arquitetural obrigatório

Seguir integralmente Docs/reports-architecture.md.

Decisões fechadas pela R01:

disponibilidade não é SUCESSO / total de medições;

disponibilidade é temporal, baseada em janelas elegíveis e
Incidentes;

o relatório por Equipamento retorna uma linha por Monitor ICMP;

múltiplos Monitores não são consolidados artificialmente;

Unidade usa agregação ponderada pelo tempo monitorado;

intervalos de Incidentes sobrepostos são unidos;

ausência de Monitor é SEM_MONITORAMENTO;

Monitor sem janela observável calculável é SEM_DADOS;

histórico legado pode usar qualidadeJanela=INFERIDA;

percentuais são BigDecimal, escala 2, HALF_UP;

durações são segundos inteiros;

p95 ICMP é calculado no PostgreSQL;

todos os endpoints exigem JWT;

ADMIN, OPERADOR e VISUALIZADOR podem consultar relatórios.

3. Migration --- janela_monitoramento

Criar a próxima migration Flyway disponível, sem modificar migrations já
aplicadas.

Estrutura conceitual:

janela_monitoramento
id
monitor_id
inicio_em
fim_em nullable
origem

origem deve distinguir PRECISA e INFERIDA.

Regras:

monitor_id obrigatório;

inicio_em obrigatório;

FK para Monitor;

fim_em >= inicio_em quando preenchido;

fim_em = null significa janela vigente;

no máximo uma janela aberta por Monitor;

índices adequados para Monitor + período.

Usar índice/constraint parcial PostgreSQL para impedir duas janelas
abertas por Monitor.

4. Histórico legado

Não usar updatedAt como histórico de ativação.

Para Monitor legado com dados observáveis:

inicio = max(monitor.createdAt, primeiraMedicao.executadoEm)
fim = ultimaMedicao.executadoEm + intervaloSegundos
origem = INFERIDA

A estratégia pode ser migration/backfill ou mecanismo idempotente
equivalente, mas deve ser determinística, segura, testável e não criar
janela histórica aberta falsa.

Monitor legado sem Medição não recebe disponibilidade inventada e deve
resultar em SEM_DADOS quando aplicável.

5. Ciclo de vida temporal

Monitor

criação ativa: abrir janela PRECISA;

criação inativa: não abrir janela;

ativação: abrir nova janela PRECISA;

desativação: encerrar janela aberta no instante real;

reativação: abrir nova janela;

nunca alterar janela histórica fechada.

Equipamento

desativação: encerrar janelas abertas dos seus Monitores;

reativação: abrir janelas apenas para Monitores administrativamente
ativos;

Monitor inativo não deve ser implicitamente ativado.

Todas essas operações devem ser transacionais.

6. Clock

As operações temporais precisam ser testáveis.

O projeto já possui mais de um bean Clock. Não reintroduzir
ambiguidade de injeção. Se houver injeção, usar @Qualifier explícito e
documentar qual Clock pertence ao ciclo temporal dos relatórios.

7. Janela efetivamente monitorada

Para cada Monitor ICMP:

inicioEfetivo =
max(inicioRelatorio, inicioJanela, primeiraMedicao.executadoEm dentro da janela)

fimEfetivo =
min(fimRelatorio, fimJanela quando existir)

Somente intervalos com inicioEfetivo < fimEfetivo contribuem.

Uma janela sem Medição não contribui.

Normalizar intervalos antes da soma para impedir dupla contagem.

8. Disponibilidade por Monitor/Equipamento

Endpoint:

GET /api/v1/relatorios/disponibilidade/equipamentos

Apesar do nome, retorna uma linha por Monitor ICMP.

Filtros:

inicio
fim
unidadeId
equipamentoId
monitorId
tipoEquipamentoId
page
size
sort

Limite: 365 dias.

DTO DisponibilidadeEquipamentoResponse:

equipamentoId
equipamentoNome
unidadeId
unidadeNome
monitorId
monitorNome
tipoMonitor
inicio
fim
estadoAnalitico
qualidadeJanela
tempoMonitoradoSegundos
tempoIndisponivelSegundos
tempoDisponivelSegundos
disponibilidadePercentual
incidentes

9. Estados analíticos

Implementar:

CALCULADO
SEM_MONITORAMENTO
SEM_DADOS

Equipamento sem Monitor ICMP:

estadoAnalitico = SEM_MONITORAMENTO
disponibilidadePercentual = null
tempos = null
incidentes = 0

Monitor existente sem janela observável calculável:

estadoAnalitico = SEM_DADOS
disponibilidadePercentual = null
tempos = null

Qualidade da janela:

PRECISA
INFERIDA

qualidadeJanela pode ser null quando não aplicável.

10. Indisponibilidade

Para cada Incidente:

[iniciadoEm, encerradoEm ?? fimRelatorio)

Interseccionar com as janelas monitoradas e [inicio, fim).

Depois realizar a união dos intervalos.

Nunca contar duas vezes intervalos sobrepostos.

Fórmula:

tempoIndisponivel =
duração(união(incidentes ∩ janelasMonitoradas ∩ período))

tempoDisponivel =
tempoMonitorado - tempoIndisponivel

disponibilidadePercentual =
round(tempoDisponivel / tempoMonitorado * 100, 2, HALF_UP)

incidentes conta Incidentes distintos que intersectam a janela
monitorada.

11. Disponibilidade por Unidade

Endpoint:

GET /api/v1/relatorios/disponibilidade/unidades

Filtros:

inicio
fim
unidadeId
page
size
sort

Limite: 365 dias.

Fórmula:

tempoMonitoradoUnidade =
Σ tempoMonitorado dos Monitores CALCULADO

tempoIndisponivelUnidade =
Σ tempoIndisponivel dos Monitores CALCULADO

tempoDisponivelUnidade =
tempoMonitoradoUnidade - tempoIndisponivelUnidade

disponibilidadePercentual =
round(tempoDisponivelUnidade / tempoMonitoradoUnidade * 100, 2, HALF_UP)

Não usar média simples dos percentuais.

Retornar também:

equipamentosTotal
equipamentosMonitorados
equipamentosSemMonitoramento
equipamentosSemDados
incidentes

Equipamento com múltiplos Monitores conta uma vez nas contagens de
Equipamentos, embora cada Monitor calculável contribua seu tempo ao
denominador.

12. Histórico de Incidentes

Endpoint:

GET /api/v1/relatorios/incidentes

Filtros:

inicio
fim
unidadeId
equipamentoId
monitorId
status
page
size
sort

Limite: 365 dias.

Semântica temporal:

iniciado_em < fim
AND
coalesce(encerrado_em, fim) >= inicio

DTO HistoricoIncidenteResponse:

incidenteId
unidadeId
unidadeNome
equipamentoId
equipamentoNome
monitorId
monitorNome
tipoMonitor
status
iniciadoEm
encerradoEm
duracaoSegundosNoPeriodo
motivo
observacao

duracaoSegundosNoPeriodo considera somente a interseção com o período
solicitado.

13. Histórico de Medições

Endpoint:

GET /api/v1/relatorios/medicoes

Filtros:

inicio
fim
unidadeId
equipamentoId
monitorId
status
page
size
sort

Limite: 31 dias.

Semântica:

executadoEm >= inicio
executadoEm <= fim

DTO HistoricoMedicaoResponse.

Default size=50, máximo 100.

14. Latência ICMP

Endpoint:

GET /api/v1/relatorios/latencia

Filtros:

inicio
fim
unidadeId
equipamentoId
monitorId
page
size
sort

Limite: 90 dias.

Considerar somente:

status = SUCESSO
latenciaMs IS NOT NULL

Agrupar por Monitor.

Calcular no PostgreSQL:

min
avg
max
count
percentile_cont(0.95)

avgLatenciaMs: BigDecimal, escala 2, HALF_UP.

p95LatenciaMs: inteiro em ms, arredondado HALF_UP.

Com count=0, min/avg/max/p95 são null.

15. Histórico de Notificações

Endpoint:

GET /api/v1/relatorios/notificacoes

Filtros:

inicio
fim
incidenteId
status
canal
tipoEvento
page
size
sort

Limite: 365 dias.

O período usa createdAt.

DTO HistoricoNotificacaoResponse.

Reutilizar Specifications/repositórios existentes quando adequado.

16. Paginação

Todos os seis endpoints são paginados.

Reutilizar o envelope atual:

{
"content": [],
"page": 0,
"size": 20,
"totalElements": 0,
"totalPages": 0,
"first": true,
"last": true
}

page zero-based.

Default: 20.

Medições: 50.

Máximo: 100.

17. Sort whitelist

Disponibilidade Equipamentos

equipamentoNome
unidadeNome
monitorNome
disponibilidadePercentual
tempoIndisponivelSegundos
tempoMonitoradoSegundos
incidentes

Disponibilidade Unidades

unidadeNome
equipamentosTotal
equipamentosMonitorados
equipamentosSemMonitoramento
tempoIndisponivelSegundos
disponibilidadePercentual
incidentes

Incidentes

iniciadoEm
encerradoEm
duracaoSegundosNoPeriodo
status
unidadeNome
equipamentoNome
monitorNome

Medições

executadoEm
status
latenciaMs
unidadeNome
equipamentoNome
monitorNome

Latência

unidadeNome
equipamentoNome
monitorNome
minLatenciaMs
avgLatenciaMs
maxLatenciaMs
count

Notificações

createdAt
enviadoEm
status
canal
tipoEvento
tentativas

Sort inválido retorna 400 INVALID_REQUEST.

18. Validação hierárquica

Combinações inconsistentes retornam 400 INVALID_REQUEST.

Exemplos:

equipamentoId não pertence à unidadeId
monitorId não pertence ao equipamentoId
monitorId não pertence à unidadeId

ID de filtro inexistente retorna 404 RESOURCE_NOT_FOUND.

Não retornar lista vazia silenciosa para filtro semanticamente inválido.

19. Validação de período

inicio e fim são obrigatórios.

Retornar 400 INVALID_REQUEST para:

ausência;

inicio > fim;

período acima do limite do relatório.

inicio = fim é permitido.

Agregados temporais com denominador zero retornam percentual null.

20. Precisão

Percentuais:

BigDecimal
escala 2
HALF_UP
0.00..100.00

null significa não calculável.

Durações são valores inteiros em segundos.

21. Estratégia de consulta

Disponibilidade por Equipamento/Unidade:

native SQL PostgreSQL;

CTEs;

greatest/least;

normalização de intervalos com range aggregation ou
gaps-and-islands;

agregação no banco.

Não carregar grandes coleções de Medições ou Incidentes em Java para
agregá-las.

Incidentes: projection/native SQL paginada.

Medições: Specification/projection paginada.

Latência: native aggregate PostgreSQL.

Notificações: Specification/projection paginada.

22. Índices e performance

Auditar os índices existentes antes de criar novos.

Quando possível, executar:

EXPLAIN (ANALYZE, BUFFERS)

com massa representativa.

Avaliar:

janela_monitoramento(monitor_id, inicio_em, fim_em)

medicao(monitor_id, status, executado_em)
WHERE status='SUCESSO' AND latencia_ms IS NOT NULL

incidente(monitor_id, iniciado_em, encerrado_em)

notificacao(created_at DESC)

Só criar índice novo com justificativa técnica documentada.

23. RBAC

Todos os endpoints /api/v1/relatorios/** exigem JWT.

GET permitido para:

ADMIN
OPERADOR
VISUALIZADOR

Sem token: 401.

Não enfraquecer regras das APIs existentes.

24. CORS e segurança

Preservar CORS atual:

Authorization permitido
credentials=false
sem wildcard

Não logar JWT, Authorization, senha, JWT secret, bootstrap password ou
Telegram token.

Não adicionar secrets ao repositório.

25. Fora da R02

Não implementar:

CSV
frontend Angular
rota /relatorios no Angular
sidebar
gráficos
biblioteca de gráficos
PDF

CSV pertence à R04 e frontend à R03.

26. Testes obrigatórios --- janela

Cobrir:

criação de Monitor ativo abre janela;

criação inativa não abre;

desativação encerra;

reativação abre nova;

duas janelas abertas são impossíveis;

desativação de Equipamento encerra janelas;

reativação abre somente para Monitores ativos;

transação não deixa estado parcial;

backfill inferido;

legado sem Medição;

Clock testável.

27. Testes obrigatórios --- disponibilidade

Cobrir:

100% disponível;

Incidente dentro do período;

cruza início;

cruza fim;

cobre período inteiro;

Incidente aberto;

Incidentes sobrepostos;

período anterior à primeira Medição;

Monitor criado depois do início;

desativação;

reativação;

múltiplas janelas;

múltiplos Monitores;

SEM_MONITORAMENTO;

SEM_DADOS;

PRECISA;

INFERIDA;

arredondamento;

inicio=fim.

28. Testes --- Unidade

Cobrir:

agregação ponderada;

múltiplos Equipamentos;

múltiplos Monitores;

Equipamento sem Monitor;

Equipamento sem dados;

denominador zero;

contagens sem duplicar Equipamento.

29. Testes --- Latência

Cobrir min, avg, max, count e p95, além de:

FALHA excluída;

latência null excluída;

zero sucessos;

filtros;

período;

paginação;

sort.

30. Testes --- API e segurança

Cobrir:

período ausente;

período invertido;

limite excedido;

IDs inexistentes;

combinação hierárquica inconsistente;

paginação;

size máximo;

sort permitido;

sort inválido;

enum inválido;

401;

ADMIN;

OPERADOR;

VISUALIZADOR.

31. Regressão

A R02 não pode quebrar:

Dashboard
Monitoring Engine
Incident Engine
Telegram
Auth
Usuários
RBAC
APIs atuais

Executar a suíte backend completa.

32. Testes e build

Executar:

.\mvnw.cmd test

Depois:

.\mvnw.cmd clean package

Ambos devem passar.

33. Documentação

Atualizar/criar documentação do contrato backend de Relatórios contendo:

endpoints;

filtros;

limites;

DTOs;

paginação;

sort;

fórmula;

estados analíticos;

qualidade de janela;

comportamento legado;

RBAC.

Não alterar silenciosamente decisões da R01.

34. Critérios de aceite

A R02 está concluída quando:

migration de janela aplicada;

ciclo temporal transacional funciona;

legado é tratado sem inventar histórico;

disponibilidade temporal está implementada;

sobreposição não duplica indisponibilidade;

múltiplos Monitores permanecem linhas separadas;

Unidade usa agregação ponderada;

SEM_MONITORAMENTO e SEM_DADOS funcionam;

PRECISA/INFERIDA funcionam;

históricos de Incidentes, Medições e Notificações funcionam;

Latência + p95 funcionam;

filtros/períodos são validados;

paginação e sort são server-side;

RBAC funciona;

agregações pesadas ficam no banco;

índices novos, se houver, são justificados;

testes passam;

build passa;

frontend não foi alterado;

CSV não foi implementado.

35. Relatório final obrigatório

R02 --- Resultado

Status: CONCLUÍDO / CONCLUÍDO COM RESSALVAS / BLOQUEADO

Migration

arquivo:
tabela:
constraints:
índices:
backfill:

Ciclo de vida

criação Monitor:
ativação Monitor:
desativação Monitor:
desativação Equipamento:
reativação Equipamento:
transacional:

Legado

janela inferida:
origem:
sem Medição:
updatedAt usado como histórico: NÃO

Disponibilidade Equipamento

fórmula:
uma linha por Monitor:
SEM_MONITORAMENTO:
SEM_DADOS:
PRECISA:
INFERIDA:
sobreposição:
incidente aberto:

Disponibilidade Unidade

fórmula:
ponderação:
contagens:

Endpoints

Listar os seis endpoints implementados.

Filtros

Tabela endpoint × filtros.

Limites

Tabela endpoint × limite.

Paginação

envelope:
default:
medicoes default:
máximo:

Sort

Whitelist por endpoint.

Latência

min:
avg:
max:
count:
p95:

Validações

inicio > fim:
período excedido:
ID inexistente:
hierarquia inconsistente:
sort inválido:

RBAC

sem JWT:
ADMIN:
OPERADOR:
VISUALIZADOR:

Banco e performance

queries:
EXPLAIN executado:
índices existentes reutilizados:
índices novos:
justificativa:

Regressão

Dashboard:
Monitoring Engine:
Incident Engine:
Telegram:
Auth:
Usuários:

Testes

comando:
quantidade:
resultado:

Build

comando:
resultado:

Git diff

Listar arquivos R02 criados/modificados.

Pendências

Somente pendências reais.

Veredito

R02 HOMOLOGADA
R02 HOMOLOGADA COM RESSALVAS
R02 NÃO HOMOLOGADA

Pronto para R03

SIM
NÃO

Não iniciar R03 automaticamente.
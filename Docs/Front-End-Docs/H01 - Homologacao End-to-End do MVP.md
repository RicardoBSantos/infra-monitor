H01 — Homologação End-to-End do MVP — Infra Monitor

1. Objetivo

Executar uma homologação completa do MVP do Infra Monitor, validando o fluxo real de ponta a ponta entre frontend Angular, backend Spring Boot, PostgreSQL, Monitoring Engine, Incident Engine, Notificações, Telegram, Dashboard e Mapa.

Esta fase não deve criar novas funcionalidades.

O objetivo é:

validar o sistema completo;

reproduzir fluxos reais;

identificar bugs comprovados;

corrigir apenas bugs encontrados;

documentar resultados;

garantir build/testes aprovados;

confirmar que o MVP está apto para próxima etapa.

2. Escopo funcional homologado

O ciclo principal a validar é:

Unidade
↓
Tipo de Equipamento
↓
Equipamento
↓
Monitor ICMP
↓
Monitoring Engine
↓
Medição
↓
Incident Engine
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

Também devem ser homologadas as áreas administrativas:

Unidades
Tipos de equipamento
Equipamentos
Monitores
Medições
Incidentes
Notificações
Dashboard
Mapa

3. Pré-condições

Já foram concluídas:

F01 a F10 do frontend;

T01 — Telegram End-to-End;

correção de CORS;

correção de Specifications;

correção do Monitoring Engine;

B10 — codigoIbge;

F10 — mapa georreferenciado.

Antes de testar:

revisar git status de frontend e backend;

revisar configurações de ambiente;

subir PostgreSQL de teste;

iniciar backend;

iniciar frontend;

confirmar health;

confirmar CORS;

confirmar que Telegram está configurado para o ambiente de homologação;

confirmar MONITORING_ENGINE_ENABLED=true;

limpar ou isolar dados de teste quando necessário.

4. Ambiente de homologação

Registrar:

Frontend URL:
Backend URL:
PostgreSQL:
Monitoring Engine:
Telegram Enabled:

Não incluir secrets.

Preferir ambiente isolado de teste/homologação.

Não usar produção.

5. Health inicial

Validar:

GET /actuator/health

Resultado esperado:

200
status = UP

Registrar falhas.

6. CORS

Validar frontend em:

http://localhost:4200

e/ou:

http://127.0.0.1:4200

conforme ambiente real.

As chamadas devem ocorrer sem 403 de CORS.

7. Console do navegador

Antes de iniciar o fluxo, abrir DevTools.

Durante toda homologação, registrar:

erros JS;

requests 4xx inesperados;

requests 5xx;

CORS;

erros de parsing;

warnings relevantes.

O objetivo final é:

nenhum erro inesperado no console

CENÁRIO A — CADASTRO ADMINISTRATIVO

8. Criar Unidade

Pelo frontend:

acessar /unidades;

criar Unidade;

selecionar município;

salvar.

Validar:

POST /api/v1/unidades
→ 201

Confirmar:

nome;

codigoIbge;

ativo;

persistência;

exibição na lista.

9. Criar Tipo de Equipamento

Pelo frontend:

acessar /tipos-equipamento;

criar Tipo, por exemplo Servidor;

salvar.

Validar:

POST /api/v1/tipos-equipamento
→ 201

Confirmar persistência e listagem.

10. Criar Equipamento

Pelo frontend:

acessar /equipamentos;

criar Equipamento;

escolher Unidade;

escolher Tipo;

informar IP controlado;

salvar.

Validar:

POST /api/v1/equipamentos
→ 201

Confirmar:

relação com Unidade;

relação com Tipo;

IP;

hostname;

localização;

ativo.

CENÁRIO B — MONITORAMENTO COM SUCESSO

11. Criar Monitor ICMP

Pelo frontend:

acessar /monitores ou detalhe do Equipamento;

criar Monitor;

usar:

tipo = ICMP
intervaloSegundos = valor curto controlado
timeoutMs = valor coerente
falhasParaIncidente = 2 ou 3
sucessosParaRecovery = 2

Não usar valores extremos.

Validar:

POST /api/v1/monitores
→ 201

12. Confirmar engine ativo

Backend deve estar com:

MONITORING_ENGINE_ENABLED=true

Confirmar scheduler ativo por logs.

13. Confirmar Medição SUCESSO

Usar IP alcançável.

Aguardar ciclo.

Validar:

GET /api/v1/medicoes?monitorId=<id>

Esperado:

SUCESSO
latenciaMs != null
executadoEm preenchido

Confirmar no frontend em /medicoes.

14. Dashboard após sucesso

Validar:

GET /dashboard/resumo
GET /dashboard/unidades

Confirmar status operacional real.

Não calcular no frontend.

CENÁRIO C — FALHA E INCIDENTE

15. Provocar falha controlada

Alterar temporariamente o alvo ou usar Monitor/Equipamento controlado com IP não alcançável.

Não usar IP aleatório de produção.

Aguardar quantidade necessária de falhas.

16. Confirmar Medição FALHA

Validar:

StatusMedicao = FALHA
latenciaMs = null

e scheduler continua ativo.

17. Confirmar abertura de Incidente

Após threshold:

Incidente ABERTO

Validar por API:

GET /api/v1/incidentes?monitorId=<id>&status=ABERTO

Confirmar no frontend.

18. Confirmar Dashboard indisponível

Validar Dashboard API.

O frontend deve refletir o status retornado.

Não usar Medição FALHA como inferência local.

19. Confirmar Telegram abertura

Validar:

INCIDENTE_ABERTO

Recebido no grupo real de homologação.

Confirmar Notificação:

ENVIADA
tentativas >= 1
enviadoEm preenchido
erro = null

CENÁRIO D — RECOVERY

20. Restaurar alvo

Restaurar IP/alvo alcançável.

Aguardar sucessos suficientes conforme:

sucessosParaRecovery

21. Confirmar Medições SUCESSO

Validar novas Medições.

22. Confirmar fechamento automático

Incidente deve passar para:

FECHADO

Confirmar:

encerradoEm != null

23. Confirmar Telegram fechamento

Validar:

INCIDENTE_FECHADO

recebido no grupo.

Confirmar Notificação persistida como ENVIADA.

24. Dashboard após recovery

Validar que status retorna ao estado operacional correto.

Angular deve apenas refletir backend.

CENÁRIO E — FECHAMENTO MANUAL

25. Testar fechamento manual

Criar Incidente controlado.

Na tela de detalhe:

/incidentes/:id

acionar fechar.

Validar:

PATCH /api/v1/incidentes/{id}/fechar

Confirmar:

FECHADO;

encerradoEm;

Notificação de fechamento;

Telegram, se regra atual gerar envio.

Não testar em incidente de produção.

CENÁRIO F — MAPA

26. Unidade georreferenciada

Abrir:

/mapa

Confirmar:

Unidade vinculada ao município correto;

status real;

painel;

navegação;

legenda.

27. Unidade sem georreferenciamento

Criar/usar Unidade com:

codigoIbge = null

Confirmar:

não desaparece;

aparece em lista de sem localização;

mapa não inventa município.

28. Múltiplas Unidades

Se viável:

duas Unidades no mesmo município;

confirmar ambas;

nenhuma sobrescrita.

CENÁRIO G — FILTROS E PAGINAÇÃO

29. Equipamentos

Validar:

unidadeId
tipoEquipamentoId
ativo
page
size
sort

Tudo server-side.

30. Monitores

Validar:

equipamentoId
tipo
ativo
page
size
sort

31. Medições

Validar:

monitorId
status
inicio
fim
page
size
sort

32. Incidentes

Validar:

monitorId
equipamentoId
unidadeId
status
inicio
fim

33. Notificações

Validar:

incidenteId
status
canal
tipoEvento
inicio
fim

CENÁRIO H — CRUDS E ERROS

34. Validação de formulário

Provocar erro:

VALIDATION_ERROR

Confirmar que fields é exibido no controle correto.

35. 409

Provocar conflito controlado:

nome duplicado;

delete com FK;

outra regra real.

Confirmar mensagem de negócio.

36. 404

Acessar recurso inexistente.

Confirmar estado apropriado.

37. Sort inválido

Validar que backend continua retornando:

400 INVALID_REQUEST

Frontend não deve enviar sort inválido normalmente.

CENÁRIO I — RESTART

38. Reinicialização do backend

Com dados persistidos:

parar backend;

iniciar novamente;

confirmar health;

confirmar dados;

confirmar Monitoring Engine retoma;

confirmar notificações ENVIADA não são reenviadas.

39. Restart com Monitor ativo

Após restart:

scheduler encontra Monitor;

novas Medições são produzidas;

não cria Incidente duplicado indevidamente.

CENÁRIO J — SEGURANÇA

40. Secrets

Pesquisar:

BOT_TOKEN
TELEGRAM_BOT_TOKEN
password hardcoded
secret

Confirmar ausência no frontend e código versionado.

41. Telegram

Confirmar que Angular não chama:

api.telegram.org

CENÁRIO K — RESPONSIVIDADE

42. Mobile

Validar:

sidebar;

Dashboard;

Inventário;

Monitores;

Medições;

Incidentes;

Notificações;

Mapa.

43. Tablet

Mesma validação.

44. Desktop

Mesma validação.

45. Correção de bugs

Durante a homologação, corrigir apenas bugs comprovados.

Para cada bug:

ID
tela/endpoint
passos para reproduzir
resultado esperado
resultado atual
causa raiz
correção
teste de regressão

Não criar feature nova.

46. Prioridade de bugs

Classificar:

P0 — bloqueia sistema
P1 — fluxo principal quebrado
P2 — comportamento incorreto com workaround
P3 — visual/usabilidade

Corrigir P0/P1 obrigatoriamente.

Corrigir P2/P3 se baixo risco e dentro do escopo.

47. Logs

Durante cenários críticos, revisar logs backend.

Não aceitar stacktrace inesperado silenciosamente.

48. Banco

Confirmar persistência real de:

Unidade
TipoEquipamento
Equipamento
Monitor
Medição
Incidente
Notificação

49. Testes automatizados

Após correções:

backend: suíte completa;

frontend: suíte completa.

Adicionar testes de regressão para bugs corrigidos.

50. Build final

Backend:

mvn clean package

Frontend:

npm run build

Usar wrappers/scripts reais.

51. Critérios de aceite

H01 está concluída quando:

CRUD Unidade funciona;

CRUD Tipo funciona;

CRUD Equipamento funciona;

Monitor ICMP pode ser criado;

Monitoring Engine executa;

Medição SUCESSO funciona;

Medição FALHA funciona;

Incidente abre após threshold;

Incidente fecha após recovery;

fechamento manual funciona;

Telegram abertura funciona;

Telegram fechamento funciona;

Dashboard reflete estado;

Mapa associa Unidade;

filtros funcionam;

paginação é server-side;

erros 400/404/409 funcionam;

restart não quebra fluxo;

nenhuma notificação ENVIADA é reenviada;

frontend sem erros inesperados;

backend sem erros inesperados;

testes passam;

builds passam.

52. Relatório final

H01 — Resultado

Status: APROVADO / APROVADO COM RESSALVAS / REPROVADO

Ambiente

Informar URLs/configs sem secrets.

Cenários

Para cada cenário A–K:

APROVADO
FALHOU
N/A

Bugs encontrados

Tabela/lista com:

ID
Prioridade
Descrição
Causa
Correção
Teste
Status

Fluxo principal

Confirmar:

Cadastro → Monitor → Medição → Incidente → Telegram → Recovery

Dashboard

Resultado.

Mapa

Resultado.

Restart

Resultado.

Segurança

Resultado.

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

Console frontend

Erros inesperados:

SIM/NÃO

Logs backend

Erros inesperados:

SIM/NÃO

Pendências

Somente bugs ou gaps reais restantes.

Recomendação

Informar se MVP está:

APTO PARA PRÓXIMA FASE
NÃO APTO

Não iniciar autenticação, relatórios ou deploy automaticamente
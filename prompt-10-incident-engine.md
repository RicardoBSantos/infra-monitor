# Prompt 10 — Incident Engine: abertura e fechamento automático de Incidentes

## 1. Contexto

Com base no contexto permanente definido em:

`codexcontex.md`

e considerando o estado atual do repositório após a implementação dos módulos:

```text
Unidade
TipoEquipamento
Equipamento
Monitor
Medição
Incidente
Monitoring Engine ICMP
```

implemente agora a primeira versão do:

# INCIDENT ENGINE

O Monitoring Engine já deve ser capaz de:

```text
Monitor ativo
    ↓
execução ICMP
    ↓
Medição SUCESSO / FALHA
```

Agora o sistema deverá interpretar sequências de Medições e transformar essas sequências em:

```text
Incidente ABERTO
```

ou:

```text
Incidente FECHADO
```

A arquitetura conceitual será:

```text
Monitoring Engine
      ↓
Medição persistida
      ↓
Incident Processor
      ↓
analisa sequência recente
      ↓
abre ou fecha Incidente
```

IMPORTANTE:

Nesta etapa NÃO implemente:

```text
Telegram
Notificação
Email
Webhook
escalonamento
ACK
silenciamento
manutenção programada
```

O foco é exclusivamente:

```text
MEDIÇÃO
   ↓
INTERPRETAÇÃO
   ↓
INCIDENTE
```

---

# 2. Princípio fundamental

Uma única Medição com:

```text
FALHA
```

NÃO significa automaticamente um Incidente.

O sistema deverá utilizar quantidade configurável de falhas consecutivas.

Da mesma forma, um único sucesso não precisa necessariamente fechar um Incidente.

Utilize sucessos consecutivos configuráveis para recovery.

---

# 3. Configuração no Monitor

Adicione ao domínio Monitor duas configurações:

```text
falhasParaIncidente
sucessosParaRecovery
```

Esses campos representam:

```text
falhasParaIncidente
=
quantidade de Medições FALHA consecutivas necessárias
para abrir um Incidente
```

e:

```text
sucessosParaRecovery
=
quantidade de Medições SUCESSO consecutivas necessárias
para fechar um Incidente aberto
```

---

# 4. Valores default

Utilize defaults razoáveis.

Sugestão inicial:

```text
falhasParaIncidente = 3
sucessosParaRecovery = 2
```

Isso significa:

```text
FALHA
FALHA
FALHA
    ↓
ABRIR INCIDENTE
```

e:

```text
SUCESSO
SUCESSO
    ↓
FECHAR INCIDENTE
```

Os valores devem ser configuráveis por Monitor.

---

# 5. Limites

Defina limites razoáveis.

Exemplo:

```text
falhasParaIncidente:
mínimo = 1
máximo = 100
```

```text
sucessosParaRecovery:
mínimo = 1
máximo = 100
```

Não permita zero ou negativo.

Use Bean Validation e constraints de banco quando apropriado.

---

# 6. Alteração no schema de Monitor

Utilize Flyway.

Antes de criar migration:

1. liste migrations existentes;
2. identifique última versão;
3. confirme tabela Monitor;
4. crie nova migration;
5. nunca altere migration histórica.

Exemplo conceitual:

```text
Vx__add_incident_thresholds_to_monitor.sql
```

Não presuma versão.

---

# 7. Compatibilidade com registros existentes

Como já podem existir Monitores, a migration deve definir defaults adequados para registros existentes.

Exemplo conceitual:

```text
falhas_para_incidente DEFAULT 3 NOT NULL
sucessos_para_recovery DEFAULT 2 NOT NULL
```

Depois avalie se manter DEFAULT no schema é desejável.

Preserve consistência com o padrão atual.

---

# 8. Entidade Monitor

Adicione:

```text
falhasParaIncidente
sucessosParaRecovery
```

à Entity Monitor.

Atualize DTOs de criação, atualização e resposta.

---

# 9. CreateMonitorRequest

Permita configurar opcionalmente:

```json
{
  "equipamentoId": 10,
  "tipo": "ICMP",
  "nome": "ICMP principal",
  "intervaloSegundos": 60,
  "timeoutMs": 2000,
  "falhasParaIncidente": 3,
  "sucessosParaRecovery": 2
}
```

Se os campos forem omitidos, utilize defaults.

---

# 10. UpdateMonitorRequest

Permita atualizar:

```text
falhasParaIncidente
sucessosParaRecovery
```

junto com os demais campos configuráveis.

Alterações passam a valer para Medições futuras.

Não reprocesse automaticamente todo histórico após mudança de threshold.

---

# 11. MonitorResponse

Inclua:

```text
falhasParaIncidente
sucessosParaRecovery
```

na resposta.

---

# 12. Incident Processor

Crie componente específico responsável por interpretar Medições.

Exemplo conceitual:

```text
IncidentProcessor
```

Responsabilidade:

```text
receber Medição recém-persistida
        ↓
identificar Monitor
        ↓
consultar estado recente
        ↓
verificar Incidente aberto
        ↓
decidir abrir / fechar / não fazer nada
```

Não coloque essa lógica dentro do scheduler ICMP.

---

# 13. Ponto de integração

Após o Monitoring Engine persistir com sucesso uma Medição:

```text
Medição persistida
      ↓
IncidentProcessor.process(...)
```

Nesta primeira versão uma chamada direta síncrona é aceitável.

NÃO introduza:

```text
Kafka
RabbitMQ
Spring Cloud Stream
event bus complexo
```

---

# 14. Não processar antes da persistência

O Incident Processor deve trabalhar com uma Medição que já foi persistida.

O histórico consultado deve incluir a Medição atual.

Isso evita diferenças entre estado avaliado e estado persistido.

---

# 15. Regra de abertura

Se NÃO existir Incidente ABERTO para o Monitor:

consulte as últimas:

```text
falhasParaIncidente
```

Medições.

Se todas forem:

```text
FALHA
```

abra um Incidente.

Exemplo:

```text
threshold = 3

últimas medições:

12:00 FALHA
12:01 FALHA
12:02 FALHA
```

Resultado:

```text
ABRIR INCIDENTE
```

---

# 16. Número insuficiente de Medições

Exemplo:

```text
falhasParaIncidente = 3
```

Histórico:

```text
FALHA
FALHA
```

Não abra Incidente ainda.

---

# 17. Falhas devem ser consecutivas

Exemplo:

```text
FALHA
SUCESSO
FALHA
FALHA
```

com threshold 3:

não abrir Incidente.

O sucesso interrompe a sequência.

---

# 18. Momento de início do Incidente

Quando o threshold for atingido, o Incidente deve representar o início real da sequência de falhas, e não simplesmente a hora da terceira falha.

Exemplo:

```text
12:00 FALHA
12:01 FALHA
12:02 FALHA
```

threshold:

```text
3
```

Incidente:

```text
iniciadoEm = 12:00
```

Prefira utilizar o `executadoEm` da primeira Medição da sequência que disparou o incidente.

---

# 19. Motivo automático

Ao abrir automaticamente, use mensagem curta e previsível.

Exemplo:

```text
Indisponibilidade detectada automaticamente após 3 falhas consecutivas.
```

Não inclua grandes dumps ou histórico completo.

---

# 20. Incidente já aberto

Se já existir Incidente ABERTO para o Monitor:

```text
não abrir outro
```

Mesmo que novas Medições FALHA continuem chegando.

A regra existente de um Incidente aberto por Monitor deve continuar protegendo concorrência.

---

# 21. Regra de recovery

Se existir Incidente ABERTO:

consulte as últimas:

```text
sucessosParaRecovery
```

Medições.

Se todas forem:

```text
SUCESSO
```

feche o Incidente.

---

# 22. Sucessos devem ser consecutivos

Exemplo:

```text
sucessosParaRecovery = 2
```

Histórico:

```text
SUCESSO
FALHA
SUCESSO
```

não fechar.

---

# 23. Momento de encerramento

Quando recovery for atingido, use preferencialmente:

```text
executadoEm
```

da última Medição SUCESSO da sequência.

Exemplo:

```text
12:10 SUCESSO
12:11 SUCESSO
```

Resultado:

```text
encerradoEm = 12:11
```

---

# 24. Observação/motivo de fechamento

Ao fechar automaticamente, adicione informação curta, se o domínio atual permitir.

Exemplo:

```text
Recuperação detectada automaticamente após 2 sucessos consecutivos.
```

Não destrua observação administrativa existente sem necessidade.

Siga semântica atual da entidade Incidente.

---

# 25. Incidente fechado não deve ser reaberto

Se uma nova sequência de falhas ocorrer depois:

crie um novo Incidente.

Exemplo:

```text
Incidente 1
ABERTO
↓
FECHADO

nova indisponibilidade
↓
Incidente 2
ABERTO
```

Não reutilize o incidente antigo.

---

# 26. Medições anteriores ao Incidente

Ao avaliar recovery de um Incidente aberto, considere apenas a sequência atual mais recente.

Não feche com sucesso histórico ocorrido antes da abertura.

Na prática, como estamos olhando as últimas Medições, preserve coerência temporal.

Se necessário, filtre:

```text
executadoEm >= incidente.iniciadoEm
```

---

# 27. Ordem das Medições

Nunca dependa apenas da ordem de inserção no banco.

Utilize:

```text
executadoEm DESC
```

e, quando necessário:

```text
id DESC
```

como desempate determinístico.

---

# 28. Medições atrasadas / fora de ordem

Uma Medição pode ser persistida com `executadoEm` anterior à última Medição existente.

Nesta primeira versão:

não tente reproceder toda a linha do tempo automaticamente.

Documente a limitação.

O Monitoring Engine normal deve gerar Medições em ordem.

Se detectar Medição atrasada através do endpoint administrativo, evite alterar Incidente histórico incorretamente.

Uma estratégia aceitável é processar automaticamente apenas Medições geradas pelo Monitoring Engine em tempo real.

---

# 29. Endpoint manual de Medição

Caso `POST /api/v1/medicoes` continue público/administrativo, decida claramente se ele deve disparar Incident Processor.

Preferência:

```text
toda Medição persistida pelo fluxo de domínio
```

pode passar pelo processor, desde que a ordem temporal seja válida.

Caso isso introduza risco com dados históricos inseridos manualmente, separe:

```text
registrar medição operacional
```

de:

```text
importar histórico
```

Não crie importação agora.

Documente a escolha.

---

# 30. Consulta eficiente

Não carregue dezenas ou centenas de Medições para contar sequência.

Se:

```text
falhasParaIncidente = 3
```

consulte apenas as últimas 3.

Se:

```text
sucessosParaRecovery = 2
```

consulte apenas as últimas 2.

Use:

```text
PageRequest
LIMIT
```

ou query eficiente equivalente.

---

# 31. Repository de Medição

Adicione consulta adequada para:

```text
últimas N Medições de um Monitor
```

ordenadas por:

```text
executadoEm DESC
id DESC
```

Reutilize repository existente.

Não duplique acesso.

---

# 32. Incidente aberto

Use consulta eficiente já existente para:

```text
Incidente ABERTO por Monitor
```

Não liste todos os Incidentes para descobrir um aberto.

---

# 33. Transação

A decisão de abrir/fechar Incidente deve possuir consistência transacional adequada.

Porém não misture com execução ICMP.

Fluxo:

```text
ICMP
fora de transação longa

↓

persistir Medição

↓

processar Incidente
```

O processamento pode abrir sua própria transação curta.

---

# 34. Concorrência

O Monitoring Engine já impede, em memória, duas execuções simultâneas do mesmo Monitor.

Mesmo assim, a regra do banco:

```text
um Incidente ABERTO por Monitor
```

deve permanecer como garantia final.

Trate conflito concorrente de forma segura.

Não transforme race condition em erro fatal do Monitoring Engine.

---

# 35. Idempotência

Processar duas vezes a mesma Medição não deve criar dois Incidentes.

O processor deve ser naturalmente idempotente em relação ao estado atual.

Exemplo:

threshold já atingido e Incidente já ABERTO:

```text
não cria outro
```

Recovery já realizado:

```text
não fecha novamente alterando horário
```

---

# 36. Falha no Incident Processor

Uma falha interna do Incident Processor NÃO deve apagar ou invalidar a Medição já registrada.

A Medição é dado primário.

Logue o erro.

Decida se a exception deve propagar para o worker ou ser tratada.

Preferência:

```text
Medição permanece persistida
Incident Processor falha
erro é logado
próxima Medição poderá tentar reconciliar estado
```

Não derrube Monitoring Engine inteiro.

---

# 37. Não criar fila de retry nesta etapa

Não implemente:

```text
retry queue
dead-letter queue
Kafka
RabbitMQ
```

Se ocorrer falha técnica, logue.

Retries poderão ser avaliados futuramente.

---

# 38. Configuração por Monitor

Threshold deve vir do Monitor.

Não crie globalmente:

```yaml
monitoring.incident.failures=3
```

como única configuração.

Cada Monitor deve poder ter valores diferentes.

Defaults podem existir no domínio.

---

# 39. Monitor inativo

Se uma Medição foi produzida legitimamente e o Monitor foi desativado durante o processamento:

a Medição continua válida.

O processor pode concluir a interpretação daquela Medição.

Não bloqueie apenas pelo estado atual do Monitor.

O scheduler já impedirá novas execuções.

---

# 40. Equipamento inativo

Mesma regra.

Se uma Medição já existe, processe o fato histórico.

Não feche/abra artificialmente apenas porque Equipamento foi desativado.

---

# 41. Desativação administrativa não é recovery

Muito importante:

```text
desativar Monitor
```

NÃO significa:

```text
fechar Incidente automaticamente
```

Incidente aberto deve permanecer aberto até recovery real ou fechamento manual.

Não misture estado administrativo com estado operacional.

---

# 42. Fechamento manual

O endpoint manual:

```text
PATCH /api/v1/incidentes/{id}/fechar
```

continua funcionando.

Se um Incidente for fechado manualmente enquanto novas FALHAS continuam:

a próxima sequência de falhas poderá abrir novo Incidente quando atingir novamente o threshold.

Isso é aceitável nesta primeira versão.

Documente.

---

# 43. Threshold alterado durante incidente aberto

Se:

```text
sucessosParaRecovery
```

for alterado durante Incidente aberto:

utilize o valor atual do Monitor para futuras avaliações.

Não congele configuração no Incidente nesta etapa.

Historização de configuração pode ser adicionada futuramente.

---

# 44. Mudança de threshold e histórico

Ao alterar:

```text
falhasParaIncidente
```

não reavalie imediatamente histórico antigo.

A nova regra passa a valer quando uma nova Medição for processada.

Isso evita efeitos retroativos inesperados.

---

# 45. API de Monitor

Atualize contratos existentes para incluir thresholds.

Endpoints existentes de Monitor devem continuar funcionando.

Não quebre compatibilidade sem necessidade.

Se DTOs exigirem novos campos, use defaults quando omitidos no POST.

---

# 46. Validação do Update

No update:

```text
falhasParaIncidente
sucessosParaRecovery
```

devem ser válidos.

Valores inválidos:

```text
400 Bad Request
```

---

# 47. Constraints no banco

Adicione CHECK quando coerente.

Exemplo conceitual:

```text
falhas_para_incidente >= 1
sucessos_para_recovery >= 1
```

Pode incluir limite máximo se isso for padrão do projeto.

---

# 48. Nenhuma mudança em Medição

Não adicione campos como:

```text
processadoIncidente
incidentProcessed
incidentId
sequenceNumber
```

à Medição nesta etapa.

Prefira processamento baseado no estado existente.

---

# 49. Nenhuma FK Medição -> Incidente

Não crie:

```text
medicao.incidente_id
```

Um Incidente representa um intervalo e diversas Medições podem estar logicamente associadas.

Não force relacionamento artificial.

---

# 50. Nenhum contador persistido

Não adicione ao Monitor:

```text
falhasConsecutivasAtuais
sucessosConsecutivosAtuais
```

nesta primeira versão.

Derive das últimas Medições.

Isso reduz estado duplicado e risco de inconsistência.

Se performance futura exigir, poderá ser otimizado depois.

---

# 51. Performance

A abordagem deve ser eficiente:

```text
1 query para incidente aberto
+
1 query limitada para últimas N medições
```

aproximadamente.

Evite:

```text
carregar todo histórico
```

---

# 52. Fluxo de FALHA sem Incidente

Exemplo:

```text
threshold = 3

M1 FALHA
```

Resultado:

```text
nenhum Incidente
```

Depois:

```text
M2 FALHA
```

Resultado:

```text
nenhum Incidente
```

Depois:

```text
M3 FALHA
```

Resultado:

```text
Incidente ABERTO
iniciadoEm = M1.executadoEm
```

---

# 53. Fluxo interrompido

```text
FALHA
FALHA
SUCESSO
FALHA
FALHA
FALHA
```

threshold = 3.

Incidente deve abrir apenas na última Medição, com:

```text
iniciadoEm = primeira FALHA da sequência final
```

---

# 54. Fluxo de recovery

Incidente ABERTO.

Configuração:

```text
sucessosParaRecovery = 2
```

Sequência:

```text
FALHA
SUCESSO
SUCESSO
```

Fechar na segunda Medição SUCESSO.

---

# 55. Recovery interrompido

```text
SUCESSO
FALHA
SUCESSO
```

não fechar com threshold 2.

---

# 56. Falhas durante Incidente aberto

Se Incidente já está ABERTO:

novas FALHAS:

```text
mantêm Incidente aberto
```

Não atualize `iniciadoEm`.

Não crie novos Incidentes.

---

# 57. Sucesso isolado durante Incidente

Se recovery threshold = 2:

```text
SUCESSO
```

isolado:

não fechar.

---

# 58. Testes unitários do Processor

Cubra no mínimo:

```text
1 falha com threshold 3 -> não abre

2 falhas com threshold 3 -> não abre

3 falhas consecutivas -> abre

início do Incidente = primeira falha da sequência

falha/sucesso/falhas -> sequência reinicia

Incidente já aberto + falha -> não cria outro

Incidente aberto + 1 sucesso threshold 2 -> não fecha

Incidente aberto + 2 sucessos -> fecha

encerradoEm = último sucesso

recovery interrompido -> não fecha

Incidente fechado + nova sequência -> abre novo

processor chamado duas vezes -> idempotente
```

---

# 59. Testes com thresholds diferentes

Cubra:

```text
falhasParaIncidente = 1
```

Uma FALHA deve abrir imediatamente.

E:

```text
sucessosParaRecovery = 1
```

Um SUCESSO deve fechar imediatamente um Incidente aberto.

---

# 60. Teste de validação de Monitor

Cubra:

```text
falhasParaIncidente = 0 -> 400

sucessosParaRecovery = 0 -> 400

valores acima do máximo -> 400
```

---

# 61. Teste de integração Monitoring Engine -> Incident Engine

Crie pelo menos um teste de integração do fluxo lógico sem rede real:

```text
simular execução FALHA
↓
persistir Medição
↓
processar
↓
atingir threshold
↓
Incidente ABERTO
```

e:

```text
simular SUCESSOS
↓
recovery
↓
Incidente FECHADO
```

Não execute ping externo.

---

# 62. Testes de concorrência

Se viável, teste proteção contra dois processamentos simultâneos tentando abrir Incidente para o mesmo Monitor.

A constraint do PostgreSQL deve ser a proteção final.

Não crie teste de carga complexo.

---

# 63. Não alterar execução ICMP

O Prompt 09 já implementou executor ICMP.

Não reescreva:

```text
IcmpMonitorExecutor
scheduler
pool
runningMonitors
```

sem necessidade.

Faça apenas integração mínima após persistência da Medição.

---

# 64. Estrutura de packages

Mantenha engine de incidentes separado.

Exemplo conceitual:

```text
br.com.inframonitor.monitoring.incident
    IncidentProcessor
```

ou package equivalente.

Não coloque essa lógica em:

```text
IncidenteController
```

nem:

```text
IcmpMonitorExecutor
```

---

# 65. Service de Incidente

Reutilize regras existentes de criação/fechamento sempre que apropriado.

Porém, caso o service público esteja muito orientado a DTO HTTP, crie métodos internos de domínio.

Não faça o Incident Processor montar requests artificiais apenas para chamar controller.

---

# 66. Não chamar Controller

Fluxo interno nunca deve ser:

```text
IncidentProcessor
  ↓
IncidenteController
```

Use service/domain layer.

---

# 67. Não chamar API HTTP interna

Não faça requisição HTTP para:

```text
POST /api/v1/incidentes
```

dentro do próprio backend.

Use chamada Java interna.

---

# 68. Logging

Logs úteis:

```text
DEBUG:
threshold ainda não atingido
recovery ainda não atingido

INFO:
incidente aberto automaticamente
incidente fechado automaticamente

WARN:
conflito concorrente já resolvido por outro processamento

ERROR:
falha inesperada no Incident Processor
```

Não gere INFO para cada Medição normal.

---

# 69. Auditoria

Não crie tabela de auditoria separada nesta etapa.

`Incidente` e `Medição` já preservam histórico suficiente para a primeira versão.

---

# 70. Notificação futura

Mantenha ponto claro onde futuramente:

```text
Incidente aberto
    ↓
Notificação
```

e:

```text
Incidente fechado
    ↓
Notificação recovery
```

poderão ser adicionados.

Mas NÃO implemente Notificação agora.

---

# 71. Sem eventos complexos

Não introduza event sourcing.

Não introduza domínio de eventos complexo.

Uma chamada futura após criação/fechamento será suficiente inicialmente.

---

# 72. Migration

A expectativa é uma nova migration para campos do Monitor.

Não deve ser necessário alterar schema de Medição ou Incidente, salvo inconsistência real encontrada.

Se precisar, documente claramente.

---

# 73. Inspeção inicial

Antes de modificar:

```bash
pwd
git status
```

Analise principalmente:

```text
Monitor entity
Monitor DTOs
MonitorService
Medicao
MedicaoRepository
MedicaoService
Incidente
IncidenteRepository
IncidenteService
Monitoring Engine do Prompt 09
migrations
testes
```

---

# 74. Sequência sugerida

```text
1. analisar estado atual
2. adicionar thresholds ao Monitor
3. migration
4. atualizar DTOs/validation
5. implementar consulta últimas N Medições
6. implementar IncidentProcessor
7. reutilizar IncidenteService
8. integrar após persistência de Medição
9. proteger erros do processor
10. criar testes unitários
11. criar teste de integração
12. executar test
13. executar verify
14. revisar git diff
```

---

# 75. Build e testes

Se houver Maven Wrapper:

```bash
./mvnw test
./mvnw verify
```

Caso contrário:

```bash
mvn test
mvn verify
```

Corrija falhas relacionadas à implementação.

---

# 76. Git

Não execute:

```text
git commit
git push
git reset --hard
git clean -fd
git checkout .
```

Ao final:

```bash
git status
git diff
```

---

# 77. Revisão final

Revise explicitamente:

```text
thresholds no Monitor
defaults
constraints
DTOs
últimas N Medições
ordenação temporal
apenas Incidente aberto único
iniciadoEm correto
encerradoEm correto
idempotência
concorrência
nenhuma chamada HTTP interna
nenhum Telegram
nenhuma fila/mensageria
```

---

# 78. Critérios de aceite

A etapa estará concluída quando:

* Monitor possuir `falhasParaIncidente`;
* Monitor possuir `sucessosParaRecovery`;
* existirem defaults adequados;
* migration funcionar com Monitores existentes;
* valores inválidos forem rejeitados;
* uma falha isolada não abrir Incidente quando threshold > 1;
* threshold de falhas consecutivas abrir Incidente;
* `iniciadoEm` corresponder à primeira falha da sequência;
* Incidente aberto não for duplicado;
* threshold de sucessos consecutivos fechar Incidente;
* `encerradoEm` corresponder à última Medição de recovery;
* sucesso isolado não fechar quando threshold > 1;
* sequência interrompida reiniciar corretamente;
* novo incidente puder surgir após incidente anterior fechado;
* processamento for idempotente;
* falha no Incident Processor não apagar Medição;
* nenhum Telegram/Notificação for implementado;
* testes passarem;
* build passar.

---

# 79. Resposta final

Ao concluir, apresente:

```text
RESUMO

...


CONTEXTO UTILIZADO

- codexcontex.md
- Monitoring Engine ICMP
- Monitor
- Medição
- Incidente
- migrations existentes


ALTERAÇÕES NO MONITOR

Campos adicionados:
...

Defaults:
...

Validações:
...


MIGRATION

Arquivo:
...

Alterações:
...

Compatibilidade com registros existentes:
...


ARQUITETURA DO INCIDENT ENGINE

IncidentProcessor:
...

Integração:
...


REGRA DE ABERTURA

...


REGRA DE RECOVERY

...


CONSULTA DE MEDIÇÕES

...


INÍCIO DO INCIDENTE

...


ENCERRAMENTO DO INCIDENTE

...


CONCORRÊNCIA E IDEMPOTÊNCIA

...


TRATAMENTO DE FALHAS

...


ARQUIVOS CRIADOS

...


ARQUIVOS ALTERADOS

...


ALTERAÇÕES NO MONITORING ENGINE

...


ALTERAÇÕES EM MEDIÇÃO

...


ALTERAÇÕES EM INCIDENTE

...


TESTES CRIADOS

...


RESULTADO DOS TESTES

Comando:
...

Resultado:
...


RESULTADO DO BUILD

Comando:
...

Resultado:
...


GIT STATUS

...


GIT DIFF

...


DECISÕES TÉCNICAS

...


LIMITAÇÕES ATUAIS

...


DIVERGÊNCIAS DA ESPECIFICAÇÃO

Nenhuma.

ou:

...


PENDÊNCIAS

...


PRÓXIMO PASSO RECOMENDADO

Notificação persistente associada a Incidente.

Não implemente Telegram nesta etapa.
```

---

# 80. Princípio principal

Preserve esta separação:

```text
Monitor
    ↓
configuração

Monitoring Engine
    ↓
execução

Medição
    ↓
resultado individual

Incident Engine
    ↓
interpretação da sequência

Incidente
    ↓
estado consolidado
```

A lógica de Incidente deve ser determinística, testável e baseada em sequência de Medições.

Não transforme o Monitoring Engine em uma classe monolítica.

Agora analise o estado real do repositório e implemente integralmente o Incident Engine.

# Manutenção agendada — F1 (agendar e confiar) — design

Data: 2026-10-22 · Branch: `feat/manutencao-agendada` (a partir de `origin/main` 2176cd1) · Aprovado em chat.

Desenho de fundo, alternativas e porquês: `Docs/manutencao-agendada-architecture/` (decisões MA01–MA17).
Este documento fixa **o que a F1 entrega e como se prova**.

## Decisões de produto já tomadas

| # | Decisão |
|---|---|
| P-01 | Regra efetiva aprovada: `manutencao_manual` separado, `em_manutencao` = estado efetivo, `CHECK (NOT manutencao_manual OR em_manutencao)` |
| P-04 | Duração máxima 72 h, **configurável sem recompilar**: `manutencao.agendada.duracao-maxima: ${MANUTENCAO_AGENDADA_DURACAO_MAXIMA:72h}` (`java.time.Duration`; vale com reinício do serviço) |
| P-06 | Job desligado por padrão (`MANUTENCAO_AGENDADA_ENABLED`); criação recusada com 409 e mensagem acionável enquanto desligado |
| P-09 | OPERADOR e ADMIN agendam; `/api/v1/manutencoes/**` entra nas listas POST e PATCH de `SecurityConfiguration` (GET já coberto por `/api/v1/**`) |
| P-02 | Telegram fica para a F3, incluindo o botão manual |

## Critério de sucesso

1. Operador agenda janela (unidade inteira ou equipamentos), vê AGENDADA, o job ativa no horário (ATIVA, equipamentos em manutenção com todos os efeitos de hoje), e ela conclui no fim ou por "Encerrar agora".
2. Botão manual e janela convivem: janela que termina não tira equipamento em manutenção manual; encerrar o manual durante janela não tira o equipamento da janela. A tela diz a origem (manual, janela #N, ambas).
3. Sistema parado: início perdido com fim no futuro → ativa atrasada; janela inteira perdida → EXPIRADA sem efeito; fim perdido → conclui no instante real. Atraso gravado e visível.
4. Toda transição guardada no banco; cada corrida do desenho §7 provada com duas threads, barreira, 30 repetições, distribuição impressa, zero ilegítimo, e prova de reversão registrada.
5. Suítes completas (front + back com Docker, contagem completa), e2e Playwright por clique com capturas, exercício no banco da carga com equipamento real conferido por SQL.

## 1. Banco — `V21__create_manutencao_agendada.sql`

Exatamente o SQL de `manutencao-agendada-desenho.md` §2.1 e §2.2 (coluna `manutencao_manual` + backfill +
`ck_equipamento_manutencao_manual_efetiva`; tabelas `manutencao_agendada` e `manutencao_agendada_equipamento`
com todas as constraints e índices), comentado no idioma das migrations V17/V19. Migration nova; nenhuma antiga muda.

## 2. Backend

### 2.1 Estado de manutenção do equipamento (pacote `equipamento.service`)

- **`EfeitosManutencao`** (novo): `aplicarEntrada(equipamentoId, Usuario autor, Instant agora)` e
  `aplicarSaida(equipamentoId)` — os passos 2–5 de `entrarEmManutencao` e o `abrirEquipamento` de
  `sairDeManutencao`, movidos sem mudança de comportamento.
- **`EstadoManutencaoEquipamento`** (novo), dono único de escrita de `em_manutencao`/`manutencao_manual`:
  - `reavaliar(equipamentoId, Supplier<Usuario> autorDaEntrada)`: `SELECT ... FOR UPDATE` da linha;
    `desejado = manutencao_manual OR coberto(id)` (predicado de §2.3 do desenho, SQL nativo);
    se diverge, `UPDATE` nativo com CAS no valor lido e aplica entrada/saída.
  - `iniciarManual(id, usuarioId)`: CAS `manutencao_manual false → true` setando `em_manutencao = true`;
    se `em_manutencao` era falso, `aplicarEntrada`. Idempotente.
  - `encerrarManual(id)`: CAS `manutencao_manual true → false` e `reavaliar`.
  - Autor da entrada pelo reconciliador: `criado_por_id` da janela ATIVA que cobre o equipamento (menor id).
- `EquipamentoService.entrarEmManutencao`/`sairDeManutencao` delegam; endpoints e contrato HTTP inalterados.
  `EquipamentoResponse` ganha `manutencaoManual`.
- `EquipamentoService.criar` e `atualizar` (quando `unidadeId` muda) chamam `reavaliar` no fim.
- `Equipamento`: `emManutencao` e `manutencaoManual` com `@Column(updatable = false)`; sem setters públicos
  (testes usam construtor/SQL). Motivo: `atualizar`/`ativar`/`desativar` fazem dirty-check da linha inteira e
  regravariam o flag com valor velho se o job o virasse no meio. Os CAS de `EquipamentoRepository` viram SQL nativo.
- `excluir` de equipamento e de unidade: 409 explícito quando houver janela ligada
  (`Nao e possivel excluir o equipamento porque ele consta em janelas de manutencao` / idem unidade).

### 2.2 Módulo `manutencao` (novo: `entity`, `repository`, `service`, `dto`, `controller`, `config`)

- `ManutencaoAgendada` (entidade, status como enum `SituacaoManutencao`, escopo `EscopoManutencao`).
- `ManutencaoAgendadaService`:
  - `criar(req, usuarioId)`: valida unidade ativa; escopo EQUIPAMENTOS ⇒ ≥1 id, todos da unidade e ativos; UNIDADE ⇒ lista vazia;
    `fim > inicio`; `inicio >= agora − 5 min`; `fim − inicio <= duracaoMaxima`; motivo não vazio (≤300).
    Recusa 409 se o reconciliador estiver desligado. Se `inicio <= agora`, ativa já (mesmo CAS do job) e reavalia.
    Resposta traz `sobreposicoes` (ids de janelas AGENDADA/ATIVA que cobrem algum equipamento em comum no período).
  - `cancelar(id, usuarioId)`: CAS `AGENDADA → CANCELADA`; 0 linhas ⇒ 409 com a situação atual.
  - `encerrar(id, usuarioId)`: CAS `ATIVA → CONCLUIDA` (`encerrada_por_id` = usuário) e `reavaliar` dos cobertos em ordem de id; 0 linhas ⇒ 409.
  - `listar(situacao=VIGENTES|HISTORICO, busca, pageable)`: VIGENTES = AGENDADA+ATIVA, ATIVA primeiro e depois `inicio_previsto` asc; HISTORICO = demais, `inicio_previsto` desc. Busca `ILIKE` em nome da unidade e motivo.
- `ReconciliadorManutencao` (`@ConditionalOnProperty manutencao.agendada.enabled=true`):
  `@Scheduled(fixedDelayString = "${manutencao.agendada.intervalo-ms:30000}")` chama `reconciliar(Instant.now(clock))`.
  `reconciliar(agora)`, cada passo em transação própria: ativar (CAS), expirar, concluir (CAS), divergência
  (`em_manutencao <> desejado`, ordem por id, um `reavaliar` por transação). Loga WARN quando o atraso passa de 2 intervalos.
- `ReconciliacaoInicial` (bean sempre presente): `AtomicBoolean`; pronto de cara se o reconciliador estiver desligado,
  senão após a primeira passada. `MonitoringScheduler.scheduleMonitors` não faz nada enquanto não estiver pronto (MA12).
- `ManutencaoAgendadaProperties`: `enabled`, `intervalo-ms`, `duracao-maxima`.
- Mensagem do 409 com job desligado (exata):
  `Agendamento de manutencao desligado neste servidor: nenhuma janela seria ativada. Para ligar, defina MANUTENCAO_AGENDADA_ENABLED=true nas variaveis de ambiente do servico do backend e reinicie-o. Enquanto isso, use "Iniciar manutencao" no equipamento.`

### 2.3 API (`/api/v1/manutencoes`)

| Método | Rota | Corpo / resposta |
|---|---|---|
| GET | `/` | `situacao`, `busca`, `page`, `size` (20) → `PaginaResposta<ManutencaoResponse>` |
| GET | `/parametros` | `{ agendadorLigado, duracaoMaximaHoras }` |
| POST | `/` | `{ unidadeId, escopo, equipamentoIds, inicioPrevisto, fimPrevisto, motivo }` → 201 `ManutencaoResponse` |
| PATCH | `/{id}/cancelar` | → `ManutencaoResponse` |
| PATCH | `/{id}/encerrar` | → `ManutencaoResponse` |

`ManutencaoResponse`: `id, unidade{id,nome}, escopo, equipamentos[{id,nome}], inicioPrevisto, fimPrevisto, motivo,
situacao, criadoPor{id,nome}, ativadaEm, encerradaEm, encerradaPor{id,nome}?, canceladaEm, canceladaPor{id,nome}?, sobreposicoes[]`.
Erros no formato `ErroResposta` (400 validação, 404, 409 `BUSINESS_CONFLICT`).

### 2.4 Read-model

`DashboardReadRepository.equipamentos` e `DashboardEquipamentoListaResponse` ganham `manutencaoManual`,
`janelaAtivaId` e `janelaAtivaFim` (janela ATIVA cobrindo o equipamento com maior `fim_previsto`; nulos se nenhuma).

### 2.5 Configuração

`application.yml`: bloco `manutencao.agendada` (`enabled: ${MANUTENCAO_AGENDADA_ENABLED:false}`,
`intervalo-ms: ${MANUTENCAO_AGENDADA_INTERVALO_MS:30000}`, `duracao-maxima: ${MANUTENCAO_AGENDADA_DURACAO_MAXIMA:72h}`).
`ConfiguracaoPadraoDesligadaTest` passa a exigir `manutencao.agendada.enabled = false`. README do backend lista as três variáveis.

## 3. Frontend

### 3.1 Tela `/manutencoes` (Gerenciamento, depois de "Monitoramento", label "Manutenções")

- Geração A (`.pagina`: padding 22px, max-width 1500; `h1` 20/700 "Janelas de manutenção"; sem sobretítulo).
  Subtítulo: "Intervenções planejadas. Equipamentos em janela ativa não são verificados e o período não conta no
  relatório de disponibilidade."
- Banner quando `agendadorLigado = false`: "O agendamento está desligado neste servidor: janelas não são ativadas.
  Peça para ligar MANUTENCAO_AGENDADA_ENABLED no backend. Enquanto isso, use Iniciar manutenção no equipamento."
  Botão "+ Agendar manutenção" desabilitado nesse caso.
- Filtro segmentado Vigentes / Histórico; busca (unidade, motivo).
- `.tabela`: `#`, Unidade, Escopo, Início, Fim, Motivo, Criado por, Situação (`StatusBadgeComponent`), Ações (`app-action-menu`).
  Início/Fim mostram o previsto; se real difere em mais de 1 min, segunda linha "ativada 10:47 (47 min de atraso)" / "encerrada …".
- `app-paginacao` com total do servidor.
- Badges novos em `StatusBadgeComponent` (não locais): `AGENDADA` "Agendada" (muted), `ATIVA` "Ativa" (info),
  `CONCLUIDA` "Concluída" (muted), `EXPIRADA` "Expirada" (warning); `CANCELADA` reaproveita a entrada existente.
- Agendar: `app-modal` (Escape, foco entra no primeiro campo e volta ao gatilho — mecânica do componente compartilhado),
  campos Unidade (select), Escopo (rádio Unidade inteira / Equipamentos selecionados → lista de checagem dos
  equipamentos ativos da unidade), Início, Fim (`datetime-local`, fuso do navegador como o resto do app), Motivo (textarea).
  Validação local espelha a do backend (inclui duração máxima de `/parametros`); erro do backend no rodapé.
  Sucesso: aviso "Janela #N agendada." + "Atenção: sobrepõe a janela #M." quando houver.

### 3.2 Texto do cancelamento e do encerramento (o que acontece com o SLA)

`ConfirmDialogComponent` com `confirmTone="primario"`.

- **Cancelar (AGENDADA)** — título `Cancelar a janela #41?`, botão `Cancelar janela`, mensagem:
  "A janela não vai acontecer. Ela ainda não excluiu nenhum período do relatório de disponibilidade, então nada muda no SLA."
- **Encerrar agora (ATIVA)** — título `Encerrar agora a janela #41?`, botão `Encerrar janela`, mensagem:
  "Os equipamentos voltam a ser verificados na próxima varredura. O período desde o início da janela continua fora do
  relatório de disponibilidade: nele não houve medição, e encerrar não o devolve ao SLA. Equipamentos que também estão
  em manutenção manual continuam fora até ela ser encerrada."
- Rodapé da tela (nota fixa abaixo da tabela): "Cancelar ou encerrar uma janela não recupera SLA: o tempo em que os
  equipamentos ficaram em manutenção não foi medido."

### 3.3 Equipamentos (ajuste do PR #17)

- `DashboardEquipamentoLista` ganha `manutencaoManual`, `janelaAtivaId`, `janelaAtivaFim`.
- `acaoDeManutencao` decide por `manutencaoManual` (não `emManutencao`): manual ⇒ "Encerrar manutenção";
  `ativo && !manual` ⇒ "Iniciar manutenção" (mesmo se já em janela); `!ativo && !manual` ⇒ nada. Idem botão do drawer.
- Coluna de status: abaixo do badge `EM_MANUTENCAO`, legenda curta da origem: "Manual", "Janela #41", "Manual + janela #41".
- Drawer, "Estado atual": linha "Origem da manutenção" com a mesma informação e "até 14/08 12:00" para a janela, link para `/manutencoes`.
- Textos: encerrar manual com janela ativa — confirmação acrescenta "{nome} continua em manutenção pela janela #41 até {fim}.";
  aviso de sucesso "Manutenção manual de {nome} encerrada. Continua em manutenção pela janela #41."

## 4. Testes

### 4.1 Backend (Postgres real, `@RequerDocker`)

- Migration: constraints recusam escrita incoerente (manual sem efetivo; status sem carimbos; período invertido).
- Serviço: validações de criação (cada regra), cancelar/encerrar por situação, listagem e ordem, sobreposição, 409 desligado, exclusão recusada.
- Reconciliador, casos de borda com sistema parado (janelas com horários já passados e `reconciliar(agora)`):
  início perdido com fim futuro; janela inteira perdida (EXPIRADA, nenhum incidente/janela de SLA/notificação tocado);
  fim perdido (CONCLUIDA com `encerrada_em = agora > fim_previsto`, janela de SLA reaberta em `agora`); escopo UNIDADE
  pegando equipamento criado durante a janela; equipamento movido para fora sai; EQUIPAMENTOS segue o id.
- Convivência: as 5 linhas da tabela §4.1 do desenho.
- Lost update: `atualizar` com entidade velha não regrava `em_manutencao` (determinístico, padrão `emOutraThread`).
- Gate de subida: `MonitoringScheduler` não chama o coordenador antes da primeira passada.
- Corridas (`@RepeatedTest(30)`, duas threads, `CyclicBarrier`, atraso aleatório calibrado, desfecho impresso
  `[corrida-...] desfecho=...`, zero ilegítimo):
  1. job ativa × operador cancela; 2. encerrar agora × conclusão automática; 3. encerrar manual × janela ativando
  no mesmo equipamento; 4. duas janelas sobrepostas terminando juntas; 5. janela ativando × motor abrindo incidente;
  6. duas janelas de unidade com conjuntos sobrepostos ativando juntas (sem deadlock, efeitos uma vez);
  7. `atualizar` do equipamento × job virando o flag.
- Prova de reversão para cada corrida e para o lost update: guarda removida localmente, teste vermelho, saída bruta
  registrada em `Docs/validacao-producao/manutencao-agendada-f1.md`, guarda restaurada.

### 4.2 Frontend

Specs: página (estados, filtro, paginação, banner desligado, ações por situação, textos de SLA), modal
(validação, envio, erro, Escape, foco entra e volta), badges novos, `acaoDeManutencao` por origem, legenda de origem, drawer.

### 4.3 E2E e carga

- `e2e/manutencao-agendada.cjs` por clique: login → Manutenções → Agendar (equipamento, início ≈ agora + 90 s) →
  linha AGENDADA → espera o job (backend com `MANUTENCAO_AGENDADA_INTERVALO_MS=5000`) → ATIVA → Equipamentos mostra
  "Janela #N" → Encerrar agora → diálogo com o texto de SLA → CONCLUÍDA. Capturas em `e2e/manutencao-agendada-evidence/`.
  Também: Escape fecha o modal e o foco volta ao botão.
- Banco da carga (127.0.0.1:5436, jar separado em 8081, sem derrubar o dev): mesmo fluxo com um equipamento real;
  SQL confere `manutencao_agendada` (carimbos), `equipamento` (flags), `janela_monitoramento` (fechada/reaberta),
  incidentes e notificações.

## 5. Documentação

- `Docs/manutencao-agendada-architecture/`: decisões MA15–MA17 (P-04 configurável, mensagem do 409, texto de SLA),
  correção de MA07 (`@EnableScheduling` é incondicional), pendências resolvidas marcadas, contexto da F1.
- `Docs/validacao-producao/monitoramento-parado-investigacao.md`: seção "Sinal parcial: atraso de janela de manutenção".
- `Docs/validacao-producao/manutencao-agendada-f1.md`: evidências (distribuições, reversões, e2e, carga).

## Fora da F1

Telegram (F3), edição/prorrogação e atalhos a partir de Equipamentos/Unidade (F2), relatório (F4), `unidade.ativo` (P-08).

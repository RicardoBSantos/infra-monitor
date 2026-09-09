# F11 — Alinhamento do Painel ao Mockup — Infra Monitor

Data: 26/08/2026
Branch: `feat/inventario-migration`
Referência visual: `screenshots/Painel/Captura de tela 2026-08-26 121734.png`

---

## 1. Objetivo

Alinhar a página **Painel** (`/dashboard`) e o shell da aplicação (topbar + sidebar) ao mockup de
referência, reutilizando os tokens visuais já aplicados na tela de login.

Regra de escopo adotada: **consumir apenas endpoints existentes**. Nenhum dado foi inventado —
onde a API não fornece o número, a interface mostra `—` e o gap está registrado na seção 6
(Pendências).

Exceção autorizada durante a execução: a regra de **equipamento em manutenção** não existia no
domínio e foi implementada no backend (migration + enum + DTO + endpoints), com aprovação explícita.

---

## 2. Tokens visuais

Aplicados em `src/styles/_tokens.scss`, **somente no tema escuro** (o tema claro não foi tocado):

| Token | Valor |
|---|---|
| `--im-bg` | `#090C14` |
| `--im-surface-raised` | `#10151F` |
| `--im-border` | `rgba(255,255,255,.08)` |
| `--im-text` | `#E8EDF5` |
| `--im-text-secondary` | `#7A8699` |
| `--im-success` | `#3FB950` |
| `--im-warning` | `#D29922` |
| `--im-danger` | `#E5534B` |
| `--im-primary` | `#3B6EFF` |

Tokens novos:

- `--im-radius-lg: 8px` — raio dos cartões, botões e linhas do Painel. O `--im-radius: 4px` global
  foi mantido para não alterar as demais telas.
- `--im-mono: ui-monospace, 'JetBrains Mono', 'IBM Plex Mono', SFMono-Regular, Menlo, monospace`
  — usado em todo número, IP, código e horário.

---

## 3. Alterações no backend

### 3.1 Manutenção de equipamento

| Arquivo | Mudança |
|---|---|
| `db/migration/V14__add_em_manutencao_to_equipamento.sql` | coluna `em_manutencao BOOLEAN NOT NULL DEFAULT FALSE` + índice parcial |
| `equipamento/entity/Equipamento.java` | campo `emManutencao` + acessores |
| `equipamento/dto/EquipamentoResponse.java` | expõe `emManutencao` |
| `equipamento/service/EquipamentoService.java` | `entrarEmManutencao(id)` / `sairDeManutencao(id)` |
| `equipamento/controller/EquipamentoController.java` | `PATCH /api/v1/equipamentos/{id}/manutencao/iniciar` e `.../encerrar` |

Autorização: já coberta pelo matcher `PATCH /api/v1/equipamentos/**` → `ADMIN`, `OPERADOR`.
Nenhuma alteração em `SecurityConfiguration`.

### 3.2 Degradação por latência (regra nova, 26/08/2026)

**Regra:** equipamento cuja **última medição** teve tempo de resposta ICMP **acima de 250 ms** fica
`DEGRADADO`. A unidade que contém esse equipamento fica `DEGRADADA`.

Decisões tomadas junto com a regra:

| Ponto | Decisão |
|---|---|
| Onde fica o limiar | Propriedade global `monitoring.latencia-degradada-ms` (env `MONITORING_LATENCIA_DEGRADADA_MS`), default **250**. Sem migration, sem redeploy de banco para ajustar. |
| Qual leitura | **Última medição.** Não é média nem N consecutivas. |
| Efeito na unidade | `DEGRADADA` passa a cobrir **dois** casos: indisponibilidade parcial (comportamento antigo) **ou** presença de equipamento com latência acima do limiar. Sem status novo de unidade. |

Precedência final, do mais forte ao mais fraco:

- **Monitor:** `DESABILITADO` → `INDISPONIVEL` (incidente aberto) → `SEM_DADOS` → `DEGRADADO` (latência) → `DISPONIVEL`
- **Equipamento:** `DESABILITADO` → `EM_MANUTENCAO` → `SEM_MONITORAMENTO` → `INDISPONIVEL` → `SEM_DADOS` → `DEGRADADO` → `DISPONIVEL`
- **Unidade:** `SEM_EQUIPAMENTOS` → `SEM_DADOS` → `INDISPONIVEL` (todos offline) → `DEGRADADA` (offline parcial **ou** degradado) → `SEM_DADOS` → `DISPONIVEL`

Consequências deliberadas:

- Incidente aberto **vence** latência: equipamento offline não é rotulado como "lento".
- Manutenção planejada **suprime** a degradação, igual ao que já fazia com indisponibilidade.
- Medição de `FALHA` não tem latência (`ck_medicao_falha_sem_latencia`), então nunca dispara degradação sozinha.

Arquivos: `OperationalStatusResolver`, `StatusOperacionalMonitor`, `StatusOperacionalEquipamento`,
`DashboardReadRepository` (limiar entra na query nativa como parâmetro posicional `?1`),
`DashboardService` (`@Value("${monitoring.latencia-degradada-ms:250}")`), `application.yml`.

O limiar em vigor é devolvido em `GET /api/v1/dashboard/resumo` como `limiarLatenciaDegradadaMs`,
para que a interface rotule o KPI com o valor real em vez de repetir "250" no código.

### 3.3 Status operacional

- `StatusOperacionalEquipamento` ganhou `EM_MANUTENCAO`.
- `OperationalStatusResolver.equipamento(ativo, emManutencao, statusMonitores)`:
  a precedência é `DESABILITADO` → `EM_MANUTENCAO` → estados derivados dos monitores.
  A sobrecarga antiga (`ativo`, `statusMonitores`) foi mantida delegando com `emManutencao = false`.
- `OperationalStatusResolver.unidade(...)`: `EM_MANUTENCAO` sai do conjunto "monitorado", igual a
  `SEM_MONITORAMENTO`. **Manutenção planejada não derruba o status da unidade.**

### 3.4 Dashboard API

- `DashboardReadRepository`: o CTE `monitor_estado` classifica `DEGRADADO` comparando
  `ultima_medicao.latencia_ms` com o limiar; o CTE `equipamento_estado` classifica `EM_MANUTENCAO`
  logo após `DESABILITADO` e `DEGRADADO` depois de `SEM_DADOS`.
- Contadores novos em `DashboardCounts` e `UnidadeCounts` (degradados de equipamento e de monitor).
- DTOs com os contadores novos:
  - `DashboardResumoResponse.Equipamentos.degradados` e `.emManutencao`
  - `DashboardResumoResponse.Monitores.degradados`
  - `DashboardResumoResponse.limiarLatenciaDegradadaMs`
  - `DashboardUnidadeResponse.equipamentosDegradados` e `.equipamentosEmManutencao`
  - `DashboardUnidadeDetalheResponse.Equipamentos.degradados` e `.emManutencao`
  - `DashboardEquipamentoResponse.emManutencao`

Suíte backend: **179 testes verdes** (`./mvnw test`).

---

## 4. Alterações no frontend

### 4.1 Estado compartilhado

Novo `core/services/dashboard-state.service.ts`:

- concentra `resumo` e `unidades` em signals, consumidos por topbar, sidebar e Painel;
- carga sob demanda (`carregarResumoSeNecessario`) — uma requisição, não uma por componente;
- `atualizar()` é o único handler de refetch, compartilhado pelo botão do Painel e pela pill da topbar;
- `ultimaVarredura` = `resumo.geradoEm`, com o instante do último fetch bem-sucedido como reserva;
- **sem polling e sem auto-refresh.**

### 4.2 Topbar (`layout/topbar/`)

Altura reduzida para 56px. Ordem: breadcrumb → busca (220px, `⌘K`) → chips de status →
pill de refresh → relógio → tema → avatar → logout.

- Breadcrumb agora mostra `Operações / Painel`: `BreadcrumbsComponent` prefixa o `section` da rota
  como segmento não clicável.
- Chips: **online, degradados e offline**. O chip de degradados foi reintroduzido em 26/08 junto com a
  regra de latência — antes tinha sido retirado por falta de dado de origem.
- Relógio: `setInterval` de 1 s em signal local, `Intl.DateTimeFormat('pt-BR')`, limpo no `DestroyRef`.
- Pill de refresh: dispara `DashboardStateService.atualizar()` e mostra o horário da varredura em mono.
- Avatar quadrado de 30px com iniciais derivadas do nome, ao lado de nome + papel em duas linhas.

### 4.3 Sidebar (`layout/sidebar/`)

- Badge vermelho com a contagem de incidentes abertos (mesma fonte do KPI) no item **Incidentes**.
- Navegação preservada integralmente — o mockup estava incompleto nessa parte.
- Rodapé: dot verde pulsante + "Monitoramento ICMP ativo" + `varredura HH:MM:SS` em mono.
  Respeita `prefers-reduced-motion`.

### 4.4 Painel (`features/dashboard/`)

- Eyebrow "OPERAÇÕES" removido (já está no breadcrumb).
- Meta em mono: `{n} unidades · {n} dispositivos monitorados · última varredura HH:MM:SS`.
- Ações: **Expandir todas** (estado local, alterna para "Recolher todas") e
  **Relatório de disponibilidade** → rota `/relatorios` já existente.
- KPIs: grid denso, `gap: 12px`, `padding: 14px`, borda superior de 2px na cor semântica,
  rótulo 10px em caixa alta, número mono de 30px colorido pela semântica.
  São nove cartões: UNIDADES, EQUIPAMENTOS, ONLINE, **DEGRADADOS**, EM MANUTENÇÃO, OFFLINE,
  DISPONIBILIDADE, LATÊNCIA MÉDIA e INCIDENTES ABERTOS. O sublabel de DEGRADADOS usa o
  `limiarLatenciaDegradadaMs` devolvido pela API ("acima de 250 ms"), não uma constante no frontend.
- Banner de alerta agregado quando há offline ou incidentes abertos.
- Filtros: busca client-side (nome, sigla, município), chips de tipo vindos de
  `/api/v1/tipos-equipamento` (aplicados na consulta de equipamentos) e chips de status montados a
  partir dos status realmente presentes nos dados.
- Tabela de unidades: identidade (`sigla · município`), badge de status, faixa de composição
  (verde = online, âmbar = degradados + em manutenção, vermelho = offline), contagens,
  disponibilidade e incidentes. A borda esquerda da linha fica vermelha com offline e âmbar quando
  há apenas degradação ou manutenção. A linha expande e carrega os equipamentos **sob demanda**.
- Tabela de equipamentos: nome, tipo, IP, status, latência da última medição, disponibilidade e
  "há X s" desde a última verificação.

### 4.5 Origem de cada dado exibido

| Elemento | Endpoint |
|---|---|
| KPIs, chips da topbar, badge da sidebar | `GET /api/v1/dashboard/resumo` |
| Linhas de unidade, faixa de composição, incidentes | `GET /api/v1/dashboard/unidades` |
| Tabela expandida | `GET /api/v1/dashboard/unidades/{id}/equipamentos` |
| Sigla da unidade | `GET /api/v1/unidades` |
| Município | `assets/maps/se-municipalities.geo.json` via `GeoMunicipioService` (por `codigoIbge`) |
| Chips de tipo | `GET /api/v1/tipos-equipamento` |
| Disponibilidade por unidade | `GET /api/v1/relatorios/disponibilidade/unidades` (janela de 30 dias) |
| Disponibilidade por equipamento | `GET /api/v1/relatorios/disponibilidade/equipamentos` (ao expandir) |

O percentual de disponibilidade é **lido pronto** do campo `disponibilidadePercentual`.
Nenhum cálculo de disponibilidade, latência ou status é feito no cliente.

Suíte frontend: **151 testes verdes** (`ng test`). `dashboard.component.spec.ts` foi reescrito para
a nova interface; o fixture de `mapa.component.spec.ts` recebeu o campo novo.

---

## 5. Ambiente de demonstração (local, não versionado)

Banco de dev: container `inframonitor-postgres`, porta host **5434**.

Backend subido com `DB_PORT=5434` e `JWT_SECRET` de desenvolvimento. Flyway aplicou a V14 nesse banco.

Dados populados **apenas por INSERT/UPDATE local** (script em scratchpad, não versionado):
9 unidades, 218 equipamentos, 220 monitores ICMP, janelas de monitoramento abertas há 30 dias,
~317 mil medições cobrindo a janela, 73 incidentes fechados e 3 abertos, 4 equipamentos em manutenção.

Credencial de dev: `admin@inframonitor.local` / `infrestrutura26` — hash regravado direto no banco local,
com `troca_senha_obrigatoria = false`. **Vale só para esse container; não replicar em outro ambiente.**

---

## 6. Pendências

### P1 — Disponibilidade e latência média agregadas na API

**Situação atual:** os KPIs **DISPONIBILIDADE** e **LATÊNCIA MÉDIA** do Painel exibem `—`, e a coluna
de latência média por unidade não existe na tabela.

**Motivo:** `/api/v1/relatorios/disponibilidade/*` e `/api/v1/relatorios/latencia` retornam linhas
paginadas por unidade/equipamento/monitor. Não há campo agregado. Calcular a média entre páginas no
frontend seria cálculo de indicador operacional no cliente — proibido pela arquitetura.

**O que fazer:**

1. Expor no `GET /api/v1/dashboard/resumo` os agregados da janela padrão:
   - `disponibilidade.percentual` (e a janela usada, para rotular "janela de 30 dias" na UI);
   - `latencia.mediaMs`.
2. Expor por unidade em `GET /api/v1/dashboard/unidades`:
   - `disponibilidadePercentual`;
   - `latenciaMediaMs`.
3. Definir a janela: fixa (30 dias) ou parametrizável via query string.
4. Decidir o tratamento de equipamentos `EM_MANUTENCAO` e `SEM_MONITORAMENTO` no agregado —
   a expectativa é que fiquem fora, coerente com o resolver de status.

**Impacto no frontend quando existir:** trocar os dois `—` pelos campos novos, remover a chamada extra
a `/relatorios/disponibilidade/unidades` no carregamento do Painel e reintroduzir a coluna
LATÊNCIA MÉDIA na tabela de unidades.

### P2 — IP próprio da unidade

**Situação atual:** a unidade não possui endereço IP. O status da unidade é derivado exclusivamente
do estado dos equipamentos que ela contém. Se todos os equipamentos estiverem sem monitoramento, a
unidade fica `SEM_DADOS` mesmo que o enlace esteja de pé — e uma queda de link aparece como N
equipamentos offline, sem um sinal único de "a unidade caiu".

**O que fazer:**

1. Migration: adicionar `ip_address` (opcional) em `unidade`, mais o eventual `hostname`.
2. Cadastro/edição de unidade (backend e frontend): campo de IP com a mesma validação já usada em
   equipamento.
3. Definir o modelo de monitoramento do enlace. Duas opções a decidir antes de implementar:
   - **(a)** monitor ICMP vinculado diretamente à unidade — exige `monitor.unidade_id` e mexe na
     regra "monitor pertence a equipamento";
   - **(b)** equipamento implícito do tipo "Enlace/Gateway" criado junto com a unidade — não altera o
     modelo de domínio, mas cria um equipamento que o operador não cadastrou.
4. Definir a precedência de status: enlace offline deve sobrepor o status agregado dos equipamentos
   (unidade `INDISPONIVEL` mesmo que ainda existam equipamentos respondendo?).
5. Frontend: exibir o estado do enlace na linha da unidade e no mapa.

**Observação:** essa mudança altera a regra de negócio nº 1 do projeto ("todo equipamento pertence a
uma unidade") apenas na opção (a), que passaria a admitir monitor sem equipamento. Precisa de decisão
arquitetural registrada antes da implementação.

---

## 7. Itens do mockup não implementados (sem dado de origem)

| Item do mockup | Situação |
|---|---|
| Sublabel "3+ falhas consecutivas" | O limiar é por monitor (`falhas_para_incidente`), não global |
| Sublabel "SLA 99,50%" | Não existe SLA cadastrado no domínio |
| "3 reconhecidos" em incidentes | Não existe reconhecimento de incidente (status é apenas ABERTO/FECHADO) |
| Linha de detalhe do banner ("SW-CORE offline há 12 min · Telegram") | Exigiria varrer os equipamentos de todas as unidades; ficou só o agregado |
| Params ICMP no rodapé da sidebar (intervalo · timeout · limite de falhas) | São por monitor; não há endpoint de configuração global |

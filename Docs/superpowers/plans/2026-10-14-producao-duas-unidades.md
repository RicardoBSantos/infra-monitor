# Teste em condição de produção — SED + ITA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recriar o banco da carga, cadastrar SED e ITA pela API, rodar motor ICMP real com Telegram no grupo real, observar ≥ 4 h, validar as telas e deixar a queda controlada preparada.

**Architecture:** Operação sobre código existente, sem mudança de produto. Banco `inframonitor-carga` (5436) recriado por `docker run`; backend = jar atual na 8081; frontend = `ng serve --configuration production` com proxy (scratchpad) para 8081; cadastro por `tools/carga-real/carga.mjs`; métricas por SQL, `jcmd` e log.

**Tech Stack:** Docker / Postgres 16, Java 21 jar Spring Boot 4.1, Node (carga.mjs, Playwright), Angular dev-server.

**Spec:** design aprovado no chat de 2026-10-14 (classificação *bounded*); decisões: queda = trocar IP do equipamento; estado final = backend rodando com Telegram ligado; aviso na simulação não bloqueia; commit local sem push.

## Global Constraints

- Banco de dev `inframonitor-postgres` (5434) intocado: só `SELECT` de contagem antes e depois. Nunca `docker compose` para o banco de carga.
- Carga: container `inframonitor-carga`, db/usuário `inframonitor_carga`, volume `inframonitor-carga-data`, `127.0.0.1:5436`, V1–V20.
- Segredos (senha do banco, `JWT_SECRET`, senha do admin) aleatórios em `~/.inframonitor-carga/env.sh`, fora do repo. Token do Telegram lido do `infra-monitor-backend/.env` só por export no processo. Nada de segredo em commit, log colado ou relatório.
- `TELEGRAM_CHAT_ID=-5375858646`. Telegram/dispatcher só no passo 4, e só se o passo 3 tiver 0 FALHA e 0 incidente.
- Nenhum incidente forçado. Passo 7 não é executado.
- Playwright navega só por clique após login; credencial por variável de ambiente; nada de `catch` silencioso em seletor; log de rede em `finally`.
- Algo inesperado → parar e reportar, não corrigir.
- Encerramento de processos por PID (`Get-CimInstance Win32_Process`), nunca confiar em TaskStop.
- Commits locais no branch `docs/preparacao-carga-real`, sem push.

## Review Focus

- Simulação com coordenada de ITA fora do polígono IBGE → aviso, segue (decisão do usuário).
- Uma única FALHA nos 15 min → trava; Telegram não liga.
- Itabaiana atravessa enlace: picos > 50 ms e perdas isoladas precisam aparecer no relatório, não sumir em média.
- Pool/heap crescendo hora a hora = vazamento; comparar sempre com a hora 0.
- Intervalo de 30 s: medir gap entre `executado_em` consecutivos por monitor (mín/mediana/máx).

---

### Task 1: Recriar o banco da carga

- [ ] Contagem do dev (SELECT): unidades, equipamentos, monitores, medicoes, versão Flyway → guardar.
- [ ] Parar qualquer java na 8081 (por PID). `docker rm -f inframonitor-carga`; `docker volume rm inframonitor-carga-data`.
- [ ] Gerar segredos (`openssl rand -base64`), gravar `~/.inframonitor-carga/env.sh` (DB_*, JWT_SECRET, BOOTSTRAP_ADMIN_*, SERVER_PORT=8081).
- [ ] `docker run` idêntico ao de `Docs/validacao-producao/carga-real-preparacao.md` §1, aguardar healthy.
- [ ] `./mvnw -DskipTests package` (jar = HEAD). Subir jar na 8081 com motor/Telegram/dispatcher `false`; conferir log `now at version v20`, `/actuator/health` UP, login do admin.
- [ ] Prova: `flyway_schema_history` 1..20 success; tabelas de domínio vazias; contagem do dev idêntica.

### Task 2: Cadastro pela API + documentação da rede

**Files:** Create `tools/carga-real/levantamento/producao-sed-ita.json`, `Docs/validacao-producao/rede-sesc-enderecamento.md`.

- [ ] JSON com tipos Servidor/Roteador, unidades SED/ITA, equipamentos e monitores conforme pedido, `conexoes: [{unidadeSigla:"ITA", conectaSigla:"SED"}]`.
- [ ] Dry-run com `CARGA_API_URL=http://localhost:8081/api/v1` → relatório colado. Esperado `criados=9` (2 tipos, 2 unidades, 2 equip, 2 monitores, 1 conexão), 0 falhas. Falha/divergente → parar.
- [ ] `--aplicar` → `criados=9`. `--aplicar` de novo → `criados=0`, tudo pulado. Conferir por SQL.
- [ ] Doc da rede: tabela de 3º octeto (unidades), 4º octeto (VLANs), máscaras, VLAN 53 /23 atrás do pfSense e inalcançável, Tobias não construída, IPs fictícios do dev colidem com faixas reais.
- [ ] Commit.

### Task 3: Janela de silêncio (15 min)

- [ ] Reiniciar jar com `MONITORING_ENGINE_ENABLED=true`, Telegram/dispatcher `false`; log em scratchpad.
- [ ] `/api/v1/status`: `icmp.ativa=NATIVO_WINDOWS`, `cargaNativa=OK`, `motorLigado=true`. Divergente → parar.
- [ ] 15 min (Monitor/background). Script SQL `relatorio.sql`: por equipamento → total, SUCESSO, FALHA, lat mín/mediana/máx, gaps; incidentes; episódios; notificações. `grep -E 'ERROR|WARN'` no log.
- [ ] TRAVA: FALHA > 0 ou incidente > 0 → parar e reportar.

### Task 4: Telegram no grupo real

- [ ] Reiniciar jar com mesmas vars + `TELEGRAM_ENABLED=true`, `NOTIFICATION_DISPATCHER_ENABLED=true`, `TELEGRAM_BOT_TOKEN` do `.env`, `TELEGRAM_CHAT_ID=-5375858646`.
- [ ] `GET /notificacoes/telegram/configuracao`: enabled/dispatcher/destino true, identidade do bot.
- [ ] Playwright por clique: login → Notificações → Configuração → botão de teste; capturar resposta de `POST /notificacoes/telegram/teste` (sem token) e screenshot.

### Task 5: Observação ≥ 4 h

- [ ] Amostrador em background por hora: `relatorio.sql` acumulado e da última hora, picos > 50 ms (contagem e horários), espaçamento entre FALHAs, `jcmd <pid> GC.heap_info`, `pg_stat_activity` do `inframonitor_carga`, ERROR/WARN novos.
- [ ] Relatório ao fim de cada hora (H1..H4).

### Task 6: Telas (em paralelo com a Task 5, hora 1)

**Files:** Create `infra-monitor-frontend/e2e/carga-real-telas.cjs`, script `e2e:carga-real` no `package.json`.

- [ ] `ng serve --configuration production --port 4200 --proxy-config <scratchpad>/proxy.json` (`/api` → 8081).
- [ ] Script: login; Mapa (2 marcadores, linha ITA→SED com pulso, cor do estado, clique em cada marcador abre painel); Painel; Unidades; drawer de cada equipamento com gráfico de latência; Relatórios/disponibilidade. Screenshots + JSON de checagens + log de rede em `finally`.
- [ ] Ler cada screenshot pessoalmente; divergência → reportar.
- [ ] Commit (script + package.json; evidências não versionadas além do JSON).

### Task 7: Queda controlada (preparada, não executada)

- [ ] Doc `Docs/validacao-producao/producao-sed-ita.md` §7: procedimento com PUT do equipamento ITA trocando IP para `192.0.2.1` (TEST-NET-1), esperado 3 falhas → incidente → alerta; volta ao `10.70.10.1` → 2 sucessos → recuperação → alerta. Corpo completo do PUT (PUT aplica corpo inteiro).
- [ ] Relatório final de toda a rodada no mesmo doc; commit local.

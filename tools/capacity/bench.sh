#!/usr/bin/env bash
# Capacity proof (D02.11-A.1) on a disposable runner: 250 monitors x 60 s x 31 days of synthetic
# measurements (~11.2 M rows, 30 days kept + 1 day eligible for retention), then API timings,
# steady-state insert rate and one real retention run. Results go to $OUT (summary.md + raw files).
# Requires: PG* env pointing at a THROWAWAY PostgreSQL 16, the backend jar, curl, jq, pgbench.
set -euo pipefail
JAR=${JAR:?backend jar}
OUT=${OUT:-capacity-out}
DIAS=${DIAS:-31}
MONITORES=250
API=http://127.0.0.1:8080/api/v1
mkdir -p "$OUT"
S="$OUT/summary.md"
log() { echo "$*" | tee -a "$S"; }
sql() { psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }
now_ms() { date +%s%3N; }

start_app() { # $1 = log file; extra env via caller
  java -Xms256m -Xmx1g -jar "$JAR" --server.address=127.0.0.1 --server.port=8080 \
    --spring.datasource.url="jdbc:postgresql://${PGHOST}:${PGPORT}/${PGDATABASE}" \
    --spring.datasource.username="$PGUSER" --spring.datasource.password="$PGPASSWORD" >"$1" 2>&1 &
  APP_PID=$!
  for _ in $(seq 1 120); do curl -fsS http://127.0.0.1:8080/actuator/health >/dev/null 2>&1 && return 0; sleep 1; done
  tail -50 "$1"; echo "backend did not start"; exit 1
}
stop_app() { kill "$APP_PID" 2>/dev/null || true; wait "$APP_PID" 2>/dev/null || true; }

log "# Prova de capacidade — $(date -u +%FT%TZ)"
log ""
log "Runner: $(nproc) vCPU, $(free -g | awk '/Mem:/{print $2}') GiB RAM; $(psql -X -At -c 'select version()' | cut -d, -f1)"
log "Meta: $MONITORES monitores × 60 s × 30 dias = 10,8 M medições (+1 dia elegível à retenção)."
log ""

# 1) Schema via Flyway (the real application) + admin bootstrap; monitoring engine stays off.
export MONITORING_ENGINE_ENABLED=false TELEGRAM_ENABLED=false NOTIFICATION_DISPATCHER_ENABLED=false MANUTENCAO_AGENDADA_ENABLED=false
export BOOTSTRAP_ADMIN_ENABLED=true BOOTSTRAP_ADMIN_NAME=Bench BOOTSTRAP_ADMIN_EMAIL=bench@example.invalid
export BOOTSTRAP_ADMIN_PASSWORD; BOOTSTRAP_ADMIN_PASSWORD=$(openssl rand -hex 16)
export JWT_SECRET; JWT_SECRET=$(openssl rand -hex 32)
start_app "$OUT/app-1.log"
sql -f tools/capacity/seed.sql -v dias="$DIAS" >/dev/null
stop_app

# 2) Bulk load, one day per transaction, in chronological order (as the engine would write).
log "## Carga"
log ""
log "| Dia | Linhas | Tempo (s) | Linhas/s | WAL (MiB) |"
log "|---|---|---|---|---|"
total_ms=0; wal_total=0
for d in $(seq "$DIAS" -1 1); do
  lsn0=$(sql -c "select pg_current_wal_lsn()")
  t0=$(now_ms)
  n=$(sql -c "
    with ins as (
      insert into medicao (monitor_id, status, latencia_ms, executado_em, created_at)
      select id, s, case when s = 'SUCESSO' then 1 + ((id * 7 + extract(epoch from ts)::bigint / 60) % 40)::int end, ts, ts
      from (select m.id, ts, case when random() < 0.01 then 'FALHA' else 'SUCESSO' end s
            from generate_series(date_trunc('minute', now()) - make_interval(days => $d),
                                 date_trunc('minute', now()) - make_interval(days => $d - 1) - interval '1 minute',
                                 interval '1 minute') ts
            cross join monitor m
            order by ts, m.id) x
      returning id)
    select count(*) from ins")
  t1=$(now_ms)
  wal=$(sql -c "select round(pg_wal_lsn_diff(pg_current_wal_lsn(), '$lsn0') / 1048576.0, 1)")
  ms=$((t1 - t0)); total_ms=$((total_ms + ms)); wal_total=$(echo "$wal_total + $wal" | bc)
  if [ "$d" -eq "$DIAS" ] || [ "$d" -eq 1 ] || [ $((d % 10)) -eq 0 ]; then
    log "| -$d | $n | $(echo "scale=1; $ms/1000" | bc) | $(( n * 1000 / (ms > 0 ? ms : 1) )) | $wal |"
  fi
done
t0=$(now_ms); sql -c "vacuum (analyze) medicao" >/dev/null; t1=$(now_ms)
rows=$(sql -c "select count(*) from medicao")
log ""
log "Total: $rows linhas em $(echo "scale=1; $total_ms/1000" | bc) s; WAL da carga ≈ ${wal_total} MiB; VACUUM ANALYZE: $(( (t1-t0)/1000 )) s."
log ""
log "## Tamanhos"
log ""
log "| Objeto | Tamanho |"
log "|---|---|"
sql -F ' | ' -c "select relname, pg_size_pretty(pg_total_relation_size(c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','i') and (relname like 'medicao%' or relname like 'ix_medicao%' or relname like 'pk_medicao%') order by pg_total_relation_size(c.oid) desc" | sed 's/^/| /; s/$/ |/' | tee -a "$S"
log "| banco inteiro | $(sql -c "select pg_size_pretty(pg_database_size(current_database()))") |"
log ""

# 3) Steady state: the real load is 250 inserts per 60 s cycle (~4.2/s). Measure headroom.
cat >"$OUT/insert.sql" <<'SQL'
\set m random(1, 250)
INSERT INTO medicao (monitor_id, status, latencia_ms, executado_em) VALUES (:m, 'SUCESSO', 3, now());
SQL
docker cp "$OUT/insert.sql" "${PG_CONTAINER:?postgres container id}:/tmp/insert.sql"
docker exec "$PG_CONTAINER" pgbench -U "$PGUSER" -d "$PGDATABASE" -n -c 4 -j 2 -T 30 -f /tmp/insert.sql >"$OUT/pgbench.txt" 2>&1 || true
log "## Inserção contínua"
log ""
log "pgbench (4 conexões, 30 s, 1 INSERT por transação, com o trigger da janela): $(grep -E '^tps' "$OUT/pgbench.txt" | head -1); latência média $(grep -E 'latency average' "$OUT/pgbench.txt" | awk '{print $4, $5}'). Necessário: ~4,2 inserções/s."
log ""

# 4) API timings on the full volume (engine off, same queries the screens use).
start_app "$OUT/app-2.log"
TOKEN=$(curl -fsS -H 'Content-Type: application/json' -d "{\"email\":\"$BOOTSTRAP_ADMIN_EMAIL\",\"senha\":\"$BOOTSTRAP_ADMIN_PASSWORD\"}" "$API/auth/login" | jq -r .accessToken)
FIM=$(date -u +%FT%H:%M:00Z); INI30=$(date -u -d '30 days ago' +%FT%H:%M:00Z); INI1=$(date -u -d '1 day ago' +%FT%H:%M:00Z); INI1H=$(date -u -d '1 hour ago' +%FT%H:%M:00Z)
UN=$(sql -c "select min(id) from unidade"); EQ=$(sql -c "select min(id) from equipamento"); MO=$(sql -c "select min(id) from monitor")
log "## API com volume total (5 chamadas cada, após 1 aquecimento)"
log ""
log "| Endpoint | HTTP | p50 (ms) | máx (ms) | Bytes |"
log "|---|---|---|---|---|"
bench() { # $1 label, $2 path
  curl -s -o /dev/null -H "Authorization: Bearer $TOKEN" "$API$2" || true
  local times=() code bytes
  for _ in 1 2 3 4 5; do
    read -r code t bytes < <(curl -s -o /dev/null -w '%{http_code} %{time_total} %{size_download}\n' -H "Authorization: Bearer $TOKEN" "$API$2")
    times+=("$(echo "$t*1000/1" | bc)")
  done
  IFS=$'\n' sorted=($(sort -n <<<"${times[*]}")); unset IFS
  log "| $1 | $code | ${sorted[2]} | ${sorted[4]} | $bytes |"
}
bench 'dashboard/resumo' '/dashboard/resumo'
bench 'dashboard/unidades' '/dashboard/unidades'
bench 'dashboard/equipamentos' '/dashboard/equipamentos'
bench "dashboard/unidades/{id}/equipamentos" "/dashboard/unidades/$UN/equipamentos"
bench 'status' '/status'
bench 'equipamentos (página 20)' '/equipamentos?page=0&size=20'
bench "monitores do equipamento" "/monitores?equipamentoId=$EQ"
bench 'medicoes do monitor (página 50)' "/medicoes?monitorId=$MO&page=0&size=50"
bench 'disponibilidade equipamentos 30 d' "/relatorios/disponibilidade/equipamentos?inicio=$INI30&fim=$FIM"
bench 'disponibilidade unidades 30 d' "/relatorios/disponibilidade/unidades?inicio=$INI30&fim=$FIM"
bench 'disponibilidade diária unidade' "/relatorios/disponibilidade/unidades/$UN/diaria"
bench 'indicadores visão geral 30 d' "/relatorios/visao-geral/indicadores?inicio=$INI30&fim=$FIM"
bench 'latência 30 d' "/relatorios/latencia?inicio=$INI30&fim=$FIM"
bench 'latência por unidade 30 d' "/relatorios/latencia/unidades?inicio=$INI30&fim=$FIM"
bench 'medições 1 d (página 50)' "/relatorios/medicoes?inicio=$INI1&fim=$FIM&page=0&size=50"
bench 'incidentes 30 d' "/relatorios/incidentes?inicio=$INI30&fim=$FIM"
bench 'CSV medições 1 h (15 mil linhas)' "/relatorios/medicoes/export?inicio=$INI1H&fim=$FIM"
bench 'CSV disponibilidade 30 d' "/relatorios/disponibilidade/equipamentos/export?inicio=$INI30&fim=$FIM"
bench 'PDF visão geral 30 d' "/relatorios/visao-geral/export/pdf?inicio=$INI30&fim=$FIM"
log ""
log "Processo Java após as chamadas: RSS $(ps -o rss= -p "$APP_PID" | awk '{printf "%.0f MiB", $1/1024}')."
stop_app

# 5) One real retention cycle (isolated DB only): 30 days kept, the 31st day is eligible.
eligible=$(sql -c "select count(*) from medicao where executado_em < now() - interval '30 days'")
export RETENTION_ENABLED=true RETENTION_DRY_RUN=false RETENTION_DELETION_APPROVED=true RETENTION_INITIAL_DELAY=5s RETENTION_INTERVAL=20s
start_app "$OUT/app-3.log"
sleep 100
stop_app
unset RETENTION_ENABLED RETENTION_DRY_RUN RETENTION_DELETION_APPROVED RETENTION_INITIAL_DELAY RETENTION_INTERVAL
log ""
log "## Retenção (motor real da aplicação, banco descartável)"
log ""
log "Elegíveis (> 30 dias): $eligible linhas. Execuções observadas em ~100 s com intervalo de 20 s:"
log ""
grep -o 'Retention end status=[^ ]* mode=[^ ]* eligibleObservedLowerBound=[0-9]* deletedConfirmed=[0-9]* batches=[0-9]* durationMs=[0-9]*' "$OUT/app-3.log" | sed 's/^/- /' | tee -a "$S" || log "- nenhuma linha 'Retention end' encontrada"
log ""
log "Restantes elegíveis: $(sql -c "select count(*) from medicao where executado_em < now() - interval '30 days'")."
log ""
log "## Recursos"
log ""
log "Disco do PostgreSQL: $(sql -c "select pg_size_pretty(pg_database_size(current_database()))"); WAL atual: $(sql -c "select pg_size_pretty(sum(size)) from pg_ls_waldir()")."
log "Container PostgreSQL agora: $(docker stats --no-stream --format '{{.CPUPerc}} CPU, {{.MemUsage}}' "$PG_CONTAINER")."

# D02.10-C passo 3 - backup local, Flyway V1-V25 e bootstrap do admin em execucao unica (porta 18080, loopback)
param([Parameter(Mandatory)][string]$Version)
$ErrorActionPreference = 'Stop'
$root = 'C:\InfraMonitor'
$ev = Join-Path $root 'evidencias\D02.10-C'
New-Item -ItemType Directory -Force $ev, (Join-Path $root 'backups') | Out-Null
$pgbin = 'C:\Program Files\PostgreSQL\16\bin'
$java = Join-Path ([Environment]::GetEnvironmentVariable('JAVA_HOME','Machine')) 'bin\java.exe'
$jar = Join-Path $root "releases\$Version\backend\app.jar"
if (-not (Test-Path $jar)) { throw "JAR ausente: $jar" }

function Invoke-Dump([string]$Label) {
  $env:PGPASSWORD = [IO.File]::ReadAllText("$root\config\admin\postgres-superuser.txt")
  try {
    $file = Join-Path $root ("backups\inframonitor-{0}-{1}.dump" -f $Label, (Get-Date -Format 'yyyyMMdd-HHmmss'))
    & "$pgbin\pg_dump.exe" -h 127.0.0.1 -p 5432 -U postgres -d inframonitor -Fc -f $file
    if ($LASTEXITCODE -ne 0) { throw "pg_dump falhou" }
    & "$pgbin\pg_restore.exe" -l $file | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "pg_restore -l falhou" }
    "dump $Label ok: $file bytes=$((Get-Item $file).Length) sha256=$((Get-FileHash $file -Algorithm SHA256).Hash.ToLower())"
  } finally { Remove-Item Env:PGPASSWORD }
}

Invoke-Dump 'pre-flyway'

$imports = 'configtree:C:/InfraMonitor/config/secrets/,configtree:C:/InfraMonitor/config/admin/flyway/,configtree:C:/InfraMonitor/config/admin/bootstrap/'
# Diretorio temporario curto: o JDK 21 no Windows cria o pipe de wakeup do NIO como socket AF_UNIX no tmpdir
$tmp = Join-Path $root 'tmp'
New-Item -ItemType Directory -Force $tmp | Out-Null
$args = @(
  "-Djava.io.tmpdir=$tmp", "-Djdk.net.unixdomain.tmpdir=$tmp",
  '-jar', "`"$jar`"",
  '--spring.profiles.active=prod', '--server.address=127.0.0.1', '--server.port=18080',
  "`"--spring.config.import=$imports`"",
  '--spring.datasource.url=jdbc:postgresql://127.0.0.1:5432/${DB_NAME}',
  '--spring.datasource.username=${DB_USERNAME}', '--spring.datasource.password=${DB_PASSWORD}',
  '--app.auth.jwt.secret=${JWT_SECRET}',
  '--spring.flyway.enabled=true', '--spring.flyway.user=${MIGRATOR_USERNAME}', '--spring.flyway.password=${MIGRATOR_PASSWORD}',
  '--app.bootstrap-admin.enabled=${BOOTSTRAP_ADMIN_ENABLED}', '--app.bootstrap-admin.name=${BOOTSTRAP_ADMIN_NAME}',
  '--app.bootstrap-admin.email=${BOOTSTRAP_ADMIN_EMAIL}', '--app.bootstrap-admin.password=${BOOTSTRAP_ADMIN_PASSWORD}'
)
$log = Join-Path $ev 'flyway-bootstrap-run.log'
$err = Join-Path $ev 'flyway-bootstrap-run.err.log'
$p = Start-Process -FilePath $java -ArgumentList $args -WorkingDirectory (Split-Path $jar) -RedirectStandardOutput $log -RedirectStandardError $err -PassThru -WindowStyle Hidden
$healthy = $false
try {
  for ($i = 0; $i -lt 60 -and -not $p.HasExited; $i++) {
    Start-Sleep -Seconds 3
    try { $h = Invoke-RestMethod -Uri 'http://127.0.0.1:18080/actuator/health' -TimeoutSec 3; if ($h.status -eq 'UP') { $healthy = $true; break } } catch {}
  }
} finally {
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force; $p.WaitForExit(30000) | Out-Null }
}
"healthy=$healthy exited_early=$($p.ExitCode -ne $null -and -not $healthy)"
Select-String -Path $log -Pattern 'Flyway|Migrating|Successfully applied|Schema .* is up to date|Started |ERROR|APPLICATION FAILED' | ForEach-Object { $_.Line.Substring(0, [math]::Min(220, $_.Line.Length)) }
if (-not $healthy) { throw 'Execucao unica nao ficou saudavel; revisar logs' }

$env:PGPASSWORD = [IO.File]::ReadAllText("$root\config\admin\postgres-superuser.txt")
try {
  & "$pgbin\psql.exe" -h 127.0.0.1 -U postgres -d inframonitor -At -X `
    -c "select 'flyway_max_version=' || max(version::int) || ' success_all=' || bool_and(success) || ' count=' || count(*) from flyway_schema_history where version is not null;" `
    -c "select 'admins=' || count(*) from usuarios where papel = 'ADMIN';" `
    -c "select 'tables_owned_by_owner=' || count(*) from pg_tables where schemaname='public' and tableowner='inframonitor_owner';" `
    -c "select 'tables_app_dml=' || count(*) from pg_tables t where schemaname='public' and has_table_privilege('inframonitor_app', format('public.%I', t.tablename), 'INSERT,UPDATE,DELETE,SELECT');"
} finally { Remove-Item Env:PGPASSWORD }

Invoke-Dump 'pos-flyway'

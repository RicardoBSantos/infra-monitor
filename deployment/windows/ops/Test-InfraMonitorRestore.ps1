# Restore test: restores a backup set into a NEW, separate database (inframonitor_restore_<timestamp>)
# on the local cluster, compares it with the source and drops it at the end (unless -Keep).
# The production database is only read (row counts); it is never written, renamed or replaced.
# Default mode only validates the backup set and reports the plan; -Apply performs the restore.
[CmdletBinding()]
param(
    [switch]$Apply,
    [switch]$Keep,
    [string]$BackupSet,
    [string]$Root='C:\InfraMonitor',
    [string]$SourceDatabase='inframonitor',
    [string]$User='postgres',
    [string]$PasswordFile='C:\InfraMonitor\config\admin\postgres-superuser.txt',
    [string]$PgBin='C:\Program Files\PostgreSQL\16\bin'
)
$ErrorActionPreference='Stop'
if (-not $BackupSet) { $BackupSet=(Get-ChildItem -LiteralPath (Join-Path $Root 'backups\daily') -Directory | Where-Object Name -match '^\d{8}-\d{6}$' | Sort-Object Name | Select-Object -Last 1).FullName }
if (-not $BackupSet -or -not (Test-Path -LiteralPath $BackupSet)) { throw 'No backup set found; run Backup-InfraMonitorDatabase.ps1 -Apply first.' }
$dump=Join-Path $BackupSet "$SourceDatabase.dump"
foreach ($line in Get-Content -LiteralPath (Join-Path $BackupSet 'SHA256SUMS')) {
    $hash,$name=$line -split '\s+',2
    if ((Get-FileHash -LiteralPath (Join-Path $BackupSet $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw "Backup set corrupted: $name" }
}
$target="inframonitor_restore_{0:yyyyMMddHHmmss}" -f (Get-Date)
"Backup set: $BackupSet (SHA-256 OK)"
"Target database: $target (new, dropped at the end unless -Keep)"
$need=3*(Get-Item -LiteralPath $dump).Length + 1GB
"Free space: {0:N1} GiB (minimum {1:N1} GiB)" -f ((Get-PSDrive ($Root.Substring(0,1))).Free/1GB),($need/1GB)
if (-not $Apply) { 'Plan only. Re-run with -Apply to restore into the separate database.'; return }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as administrator.' }
if ((Get-PSDrive ($Root.Substring(0,1))).Free -lt $need) { throw 'Not enough free space for the restore test.' }
if ($target -eq $SourceDatabase -or $target -notmatch '^inframonitor_restore_\d{14}$') { throw 'Refusing unsafe target name.' }
$env:PGPASSWORD=[IO.File]::ReadAllText($PasswordFile).Trim()
$psql=Join-Path $PgBin 'psql.exe'
$countSql="select coalesce(json_object_agg(t,n order by t),'{}') from (select c.relname t, (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I',c.relname),false,true,'')))[1]::text::bigint n from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r') x"
$sw=[Diagnostics.Stopwatch]::StartNew()
try {
    & $psql -h 127.0.0.1 -U $User -w -d postgres -X -q -v ON_ERROR_STOP=1 -c "create database `"$target`" template template0 encoding 'UTF8'"
    if ($LASTEXITCODE -ne 0) { throw 'create database failed' }
    # --no-owner/--no-acl: the copy belongs to the admin role, so the application roles never gain
    # access to it and the source grants are not altered.
    & (Join-Path $PgBin 'pg_restore.exe') -h 127.0.0.1 -U $User -w -d $target --no-owner --no-acl --exit-on-error $dump
    if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed' }
    $restoreSeconds=$sw.Elapsed.TotalSeconds
    $src=(& $psql -h 127.0.0.1 -U $User -w -d $SourceDatabase -At -X -c $countSql) | ConvertFrom-Json -AsHashtable
    $dst=(& $psql -h 127.0.0.1 -U $User -w -d $target -At -X -c $countSql) | ConvertFrom-Json -AsHashtable
    $flyway=& $psql -h 127.0.0.1 -U $User -w -d $target -At -X -c "select max(version::int)||' success='||bool_and(success) from flyway_schema_history where version is not null"
    $manifest=Get-Content -Raw -LiteralPath (Join-Path $BackupSet 'manifest.json') | ConvertFrom-Json -AsHashtable
    "Restore took {0:N1} s. Flyway in copy: {1}" -f $restoreSeconds,$flyway
    $diff=0
    foreach ($t in ($dst.Keys | Sort-Object)) {
        $expected=if ($manifest.source.tables.ContainsKey($t)) { $manifest.source.tables[$t] } else { '?' }
        "{0,-36} copy={1,10}  production-now={2,10}  at-backup~={3}" -f $t,$dst[$t],$src[$t],$expected
        if (-not $src.ContainsKey($t)) { $diff++ }
    }
    if ($diff) { throw "$diff table(s) in the copy do not exist in the source." }
    'RESTORE TEST OK (counts may differ from production-now if data changed after the backup).'
} finally {
    if (-not $Keep) { & $psql -h 127.0.0.1 -U $User -w -d postgres -X -q -c "drop database if exists `"$target`"" | Out-Null; "Dropped $target." }
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

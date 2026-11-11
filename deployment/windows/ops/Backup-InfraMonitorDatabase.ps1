# Logical backup of the Infra Monitor database (pg_dump custom format + roles/globals), with SHA-256,
# a pg_restore listing check, local retention and an OPTIONAL copy to an approved external destination.
# Default mode only reports the plan. -Apply creates the backup. Nothing is sent anywhere unless
# -Destination is given explicitly. The password is read from a file readable only by
# Administrators/SYSTEM into this process only; it never appears on the command line or in the log.
[CmdletBinding()]
param(
    [switch]$Apply,
    [string]$Root='C:\InfraMonitor',
    [string]$Database='inframonitor',
    [string]$User='postgres',
    [string]$PasswordFile='C:\InfraMonitor\config\admin\postgres-superuser.txt',
    [string]$PgBin='C:\Program Files\PostgreSQL\16\bin',
    [ValidateRange(1,365)][int]$LocalRetentionDays=7,
    [string]$Destination,
    [ValidateRange(1,3650)][int]$DestinationRetentionDays=30,
    [switch]$RegisterTask,
    [string]$TaskTime='02:15'
)
$ErrorActionPreference='Stop'
$local=Join-Path $Root 'backups\daily'
$log=Join-Path $Root 'logs\backup'
$pattern='^\d{8}-\d{6}$'

function Write-Log([string]$m) { $line="{0:s} {1}" -f (Get-Date),$m; Write-Host $line; if ($Apply) { Add-Content -LiteralPath (Join-Path $log 'backup.log') -Value $line -Encoding utf8 } }
function Invoke-Pg([string]$exe,[string[]]$arguments) {
    & (Join-Path $PgBin $exe) @arguments
    if ($LASTEXITCODE -ne 0) { throw "$exe failed ($LASTEXITCODE)" }
}
function Remove-Expired([string]$dir,[int]$days) {
    if (-not (Test-Path -LiteralPath $dir)) { return }
    $limit=(Get-Date).AddDays(-$days)
    # Only folders created by this script (yyyyMMdd-HHmmss) are candidates; at least one is always kept.
    $sets=@(Get-ChildItem -LiteralPath $dir -Directory | Where-Object Name -match $pattern | Sort-Object Name)
    foreach ($s in ($sets | Select-Object -SkipLast 1 | Where-Object { $_.CreationTime -lt $limit })) { Remove-Item -LiteralPath $s.FullName -Recurse -Force; Write-Log "retention: removed $($s.FullName)" }
}

$dbSize=[long]0
# The password is read from an Administrators/SYSTEM-only file into this process environment only.
if (Test-Path -LiteralPath $PasswordFile) {
    $env:PGPASSWORD=[IO.File]::ReadAllText($PasswordFile).Trim()
    $dbSize=[long](& (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -U $User -d $Database -w -At -X -c "select pg_database_size(current_database())")
}
$free=(Get-PSDrive ($Root.Substring(0,1))).Free
"Database: $Database ({0:N1} MiB)  Local: $local (keep $LocalRetentionDays days)  Destination: {1}" -f ($dbSize/1MB),$(if ($Destination) { "$Destination (keep $DestinationRetentionDays days)" } else { 'none (local only)' })
"Free space: {0:N1} GiB" -f ($free/1GB)
if (-not $Apply) { 'Plan only. Re-run with -Apply to create the backup.'; if (-not (Test-Path -LiteralPath $PasswordFile)) { "Password file not readable here: $PasswordFile (run as administrator)." }; Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue; return }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as administrator.' }
if (-not (Test-Path -LiteralPath $PasswordFile)) { throw "Password file missing: $PasswordFile" }
if ($free -lt (3*$dbSize + 1GB)) { throw 'Not enough free space for a safe backup (needs 3x the database size + 1 GiB).' }
New-Item -ItemType Directory -Force -Path $local,$log | Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$set=Join-Path $local $stamp
New-Item -ItemType Directory -Path $set | Out-Null
try {
    Write-Log "backup start $set"
    $dump=Join-Path $set "$Database.dump"
    Invoke-Pg 'pg_dump.exe' @('-h','127.0.0.1','-U',$User,'-w','-d',$Database,'-Fc','-Z','6','-f',$dump)
    # Roles/grants are needed to restore onto a fresh cluster; the file holds password hashes, so it
    # inherits the backup folder ACL (Administrators/SYSTEM).
    Invoke-Pg 'pg_dumpall.exe' @('-h','127.0.0.1','-U',$User,'-w','--globals-only','--no-role-passwords','-f',(Join-Path $set 'globals.sql'))
    $toc=& (Join-Path $PgBin 'pg_restore.exe') --list $dump
    if ($LASTEXITCODE -ne 0 -or -not ($toc -match 'TABLE DATA public medicao')) { throw 'pg_restore --list did not validate the dump.' }
    $meta=& (Join-Path $PgBin 'psql.exe') -h 127.0.0.1 -U $User -d $Database -w -At -X -c "select json_build_object('flyway',(select max(version::int) from flyway_schema_history where success),'tables',(select json_object_agg(relname,n_live_tup) from pg_stat_user_tables))"
    $manifest=[ordered]@{ database=$Database; created=(Get-Date).ToString('o'); host=$env:COMPUTERNAME; pg_dump=(& (Join-Path $PgBin 'pg_dump.exe') --version); source=($meta | ConvertFrom-Json) }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $set 'manifest.json') -Encoding utf8
    Get-ChildItem -LiteralPath $set -File | Where-Object Name -ne 'SHA256SUMS' | ForEach-Object { "{0}  {1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(),$_.Name } | Set-Content -LiteralPath (Join-Path $set 'SHA256SUMS') -Encoding ascii
    Write-Log ("backup ok {0} ({1:N1} MiB)" -f $set,((Get-ChildItem -LiteralPath $set -File | Measure-Object Length -Sum).Sum/1MB))

    if ($Destination) {
        $target=Join-Path $Destination $stamp
        Copy-Item -LiteralPath $set -Destination $target -Recurse
        foreach ($line in Get-Content -LiteralPath (Join-Path $set 'SHA256SUMS')) {
            $hash,$name=$line -split '\s+',2
            if ((Get-FileHash -LiteralPath (Join-Path $target $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw "Hash mismatch at destination: $name" }
        }
        Write-Log "copy verified $target"
        Remove-Expired $Destination $DestinationRetentionDays
    }
    Remove-Expired $local $LocalRetentionDays
} catch {
    Write-Log "backup FAILED: $($_.Exception.Message)"
    throw
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }

if ($RegisterTask) {
    $pwsh=(Get-Command pwsh).Source
    $arguments="-NoProfile -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -Apply -LocalRetentionDays $LocalRetentionDays"
    if ($Destination) { $arguments+=" -Destination `"$Destination`" -DestinationRetentionDays $DestinationRetentionDays" }
    Register-ScheduledTask -TaskName 'InfraMonitor-Backup' -TaskPath '\InfraMonitor\' -Action (New-ScheduledTaskAction -Execute $pwsh -Argument $arguments) -Trigger (New-ScheduledTaskTrigger -Daily -At $TaskTime) -Principal (New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest) -Description 'Infra Monitor daily database backup' -Force | Out-Null
    Write-Log "scheduled task \InfraMonitor\InfraMonitor-Backup registered (daily at $TaskTime)"
}

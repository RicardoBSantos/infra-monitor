# D-06: retention for the IIS logs of ONE site (default InfraMonitor). Default mode only reports:
# it lists what is older than -RetentionDays and the space it would free. -Apply deletes those files.
# Scope is strictly <site log directory>\W3SVC<site id>\u_ex*.log: other sites, HTTPERR and any other
# file are never touched. -RegisterTask creates a daily scheduled task that runs this script with -Apply.
[CmdletBinding()]
param(
    [string]$SiteName='InfraMonitor',
    [ValidateRange(7,3650)][int]$RetentionDays=90,
    [switch]$Apply,
    [switch]$RegisterTask,
    [string]$TaskTime='03:30'
)
$ErrorActionPreference='Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as administrator (appcmd needs it, even to report).' }
$appcmd="$env:windir\system32\inetsrv\appcmd.exe"
[xml]$site=& $appcmd list site $SiteName /config /xml
$node=$site.appcmd.SITE
if (-not $node) { throw "IIS site $SiteName not found." }
$dir=$node.site.logFile.directory
if (-not $dir) {
    [xml]$def=& $appcmd list config /section:system.applicationHost/sites /xml
    $dir=$def.appcmd.CONFIG.'system.applicationHost-sites'.siteDefaults.logFile.directory
}
$dir=Join-Path ([Environment]::ExpandEnvironmentVariables($dir)) ("W3SVC{0}" -f $node.'SITE.ID')
if (-not (Test-Path -LiteralPath $dir)) { "No log directory yet: $dir"; return }

$limit=(Get-Date).Date.AddDays(-$RetentionDays)
$all=@(Get-ChildItem -LiteralPath $dir -File -Filter 'u_ex*.log')
# The current day's file is still open by IIS and always newer than the limit.
$old=@($all | Where-Object { $_.LastWriteTime -lt $limit })
$freed=($old | Measure-Object Length -Sum).Sum
"Site: $SiteName  Directory: $dir"
"Files: {0} ({1:N2} MiB). Older than {2} days ({3:d}): {4} ({5:N2} MiB)." -f $all.Count,(($all|Measure-Object Length -Sum).Sum/1MB),$RetentionDays,$limit,$old.Count,($freed/1MB)
if ($all.Count) {
    $days=[Math]::Max(1,((Get-Date)-($all|Sort-Object LastWriteTime|Select-Object -First 1).LastWriteTime).TotalDays)
    "Observed growth: {0:N2} MiB/day; at {1} days of retention about {2:N0} MiB." -f ((($all|Measure-Object Length -Sum).Sum/1MB)/$days),$RetentionDays,((($all|Measure-Object Length -Sum).Sum/1MB)/$days*$RetentionDays)
}

if ($Apply) {
    foreach ($f in $old) { Remove-Item -LiteralPath $f.FullName -Force; "Deleted $($f.Name)" }
    "Freed {0:N2} MiB." -f ($freed/1MB)
} elseif ($old.Count) {
    'Report only. Re-run with -Apply to delete the files listed above:'
    $old | ForEach-Object { "  $($_.Name)  $($_.LastWriteTime.ToString('yyyy-MM-dd'))  $([int]($_.Length/1KB)) KiB" }
}

if ($RegisterTask) {
    $script=$MyInvocation.MyCommand.Path
    $pwsh=(Get-Command pwsh).Source
    $action=New-ScheduledTaskAction -Execute $pwsh -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"{0}`" -SiteName `"{1}`" -RetentionDays {2} -Apply" -f $script,$SiteName,$RetentionDays)
    $trigger=New-ScheduledTaskTrigger -Daily -At $TaskTime
    $principal=New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
    Register-ScheduledTask -TaskName "InfraMonitor-IisLogRetention" -TaskPath '\InfraMonitor\' -Action $action -Trigger $trigger -Principal $principal -Description "Deletes $SiteName IIS logs older than $RetentionDays days" -Force | Out-Null
    "Scheduled task \InfraMonitor\InfraMonitor-IisLogRetention registered (daily at $TaskTime)."
}

# D-05: switches InfraMonitorBackend between Manual and Automatic (Delayed Start).
# Inspect is the default. Automatic also makes the backend depend on the PostgreSQL service,
# so the SCM starts PostgreSQL first. Neither mode starts, stops or restarts any service.
# The WinSW XML is updated too, so a later "install/refresh" keeps the same startup settings.
[CmdletBinding()]
param(
    [ValidateSet('Inspect','Automatic','Manual')][string]$Mode='Inspect',
    [string]$ServiceName='InfraMonitorBackend',
    [string]$PostgreSQLService='postgresql-x64-16',
    [string]$ServiceXml='C:\InfraMonitor\config\service\InfraMonitorBackend.xml'
)
$ErrorActionPreference='Stop'

function Show-State {
    $s=Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
    if (-not $s) { throw "Service $ServiceName not found." }
    $delayed=(Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName").DelayedAutostart
    $deps=(Get-Service $ServiceName).ServicesDependedOn | ForEach-Object Name
    [xml]$x=Get-Content -Raw -LiteralPath $ServiceXml
    [pscustomobject]@{
        Service=$ServiceName; StartMode=$s.StartMode; DelayedAutostart=[int]$delayed; State=$s.State; Account=$s.StartName
        DependsOn=($deps -join ','); XmlStartMode=$x.service.startmode; XmlDelayed=$x.service.delayedAutoStart; XmlDepend=(@($x.service.depend) -join ',')
        PostgreSQL=(Get-CimInstance Win32_Service -Filter "Name='$PostgreSQLService'" | ForEach-Object { "$($_.StartMode)/$($_.State)" })
    } | Format-List
    & sc.exe qfailure $ServiceName
}

function Set-XmlStartup([bool]$automatic) {
    $backup="$ServiceXml.{0:yyyyMMddHHmmss}.bak" -f (Get-Date)
    Copy-Item -LiteralPath $ServiceXml -Destination $backup
    [xml]$x=Get-Content -Raw -LiteralPath $ServiceXml
    $svc=$x.service
    foreach ($n in @($svc.SelectNodes('delayedAutoStart')) + @($svc.SelectNodes('depend'))) { [void]$svc.RemoveChild($n) }
    $svc.startmode=if ($automatic) { 'Automatic' } else { 'Manual' }
    if ($automatic) {
        $start=$svc.SelectSingleNode('startmode')
        $d=$x.CreateElement('delayedAutoStart'); $d.InnerText='true'; [void]$svc.InsertAfter($d,$start)
        $p=$x.CreateElement('depend'); $p.InnerText=$PostgreSQLService; [void]$svc.InsertAfter($p,$d)
    }
    $x.Save($ServiceXml)
    "XML backup: $backup"
}

if ($Mode -eq 'Inspect') { Show-State; return }
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as administrator.' }
if (-not (Get-Service $PostgreSQLService -ErrorAction SilentlyContinue)) { throw "PostgreSQL service $PostgreSQLService not found; nothing was changed." }

if ($Mode -eq 'Automatic') {
    if ((Get-CimInstance Win32_Service -Filter "Name='$PostgreSQLService'").StartMode -ne 'Auto') { throw "$PostgreSQLService must be Automatic before the backend depends on it." }
    Set-XmlStartup $true
    & sc.exe config $ServiceName start= delayed-auto depend= $PostgreSQLService | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'sc.exe config failed.' }
} else {
    Set-XmlStartup $false
    # "depend= /" clears the dependency list.
    & sc.exe config $ServiceName start= demand depend= / | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'sc.exe config failed.' }
}
Show-State
'Startup configuration changed. No service was started, stopped or restarted.'

# Runs ONLY on a disposable GitHub-hosted Windows runner.
param([Parameter(Mandatory)][string]$FixturePackage)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../ReleaseTools.psm1') -Force
$count=0
function Assert-Throws([scriptblock]$Code) {
    $failed=$false
    try { & $Code | Out-Null } catch { $failed=$true }
    if (-not $failed) { throw 'Expected a blocked operation' }
}
$manifest=Test-PackageIntegrity $FixturePackage
if ($manifest.commit -cne ('a'*40)) { throw 'Fixture mismatch' }; $count++
Test-FreeSpacePolicy -FreeBytes 30GB -AdditionalBytes 2GB -PeakBytes 3GB | Out-Null; $count++
Assert-Throws { Test-FreeSpacePolicy -FreeBytes 25GB -AdditionalBytes 2GB -PeakBytes 3GB }; $count++
Assert-Throws { Test-HealthResult 503 'DOWN' }; $count++
Test-HealthResult 200 'UP' | Out-Null; $count++
$current=@{backend='old';frontend='old'}
Assert-Throws { Test-RollbackCompatibility @{} $current $manifest 'Both' 25 }; $count++
$proof=@{approved=$true;schemaVersion=25;current=$current;target=@{backend=$manifest.version;frontend=$manifest.version}}
Test-RollbackCompatibility $proof $current $manifest 'Both' 25; $count++
Assert-Throws { Test-RollbackCompatibility $proof $current $manifest 'Both' 24 }; $count++
$root=Join-Path $env:RUNNER_TEMP ('no-write-'+[guid]::NewGuid())
Invoke-ReleaseOperation -Root $root -PackagePath $FixturePackage | Out-Null
if (Test-Path -LiteralPath $root) { throw 'Default mode wrote to disk' }; $count++
Assert-Throws { Assert-AbsolutePath '../relative' }; $count++
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..') -Recurse -File | Where-Object Extension -in @('.ps1','.psm1')) {
    $tokens=$null; $errors=$null
    [Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors) | Out-Null
    if ($errors.Count) { throw 'PowerShell syntax error' }
}; $count++
foreach ($file in @('winsw.xml.template','web.config.template')) {
    [xml](Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot ".." $file)) | Out-Null
}; $count++
Assert-Throws { Invoke-ReleaseOperation -Operation Stage -Root $FixturePackage -PackagePath $FixturePackage }; $count++
$junctionRoot=Join-Path $env:RUNNER_TEMP ('junction-test-'+[guid]::NewGuid())
$v1='r-'+('1'*40); $v2='r-'+('2'*40)
foreach ($path in @('current',"releases/$v1/backend","releases/$v2/backend")) { New-Item -ItemType Directory -Path (Join-Path $junctionRoot $path) -Force | Out-Null }
& (Get-Module ReleaseTools) { param($r,$v) Invoke-JunctionTransition $r $v 'backend' $false } $junctionRoot $v1
& (Get-Module ReleaseTools) { param($r,$v) Invoke-JunctionTransition $r $v 'backend' $false } $junctionRoot $v2
& (Get-Module ReleaseTools) { param($r,$v) Invoke-JunctionTransition $r $v 'backend' $true } $junctionRoot $v1
$link=Get-Item -LiteralPath (Join-Path $junctionRoot 'current/backend')
if ([IO.Path]::GetFullPath([string]@($link.Target)[0]) -ine [IO.Path]::GetFullPath((Join-Path $junctionRoot "releases/$v1/backend"))) { throw 'Rollback junction mismatch' }; $count++
[xml]$model=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../winsw.xml.template')
if (-not $model.service.arguments.Contains('--spring.datasource.password=$'+'{DB_PASSWORD}')) { throw 'Required credential placeholder missing' }; $count++
if ($model.service.serviceaccount.allowservicelogon -ne 'false') { throw 'Virtual account must not request explicit service logon' }
if (@($model.service.env | Where-Object name -eq 'CORS_ALLOWED_ORIGINS').value -ne '@@CORS_ALLOWED_ORIGINS@@') { throw 'CORS origin placeholder missing' }
if (-not $model.service.arguments.StartsWith('-Djava.io.tmpdir=@@ROOT@@\tmp\backend -Djdk.net.unixdomain.tmpdir=@@ROOT@@\tmp\backend -jar ')) { throw 'Short JVM tmpdir must precede -jar' }; $count++
[xml]$iis=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../web.config.template')
if (-not @($iis.configuration.'system.webServer'.staticContent.mimeMap | Where-Object fileExtension -eq '.mjs').Count) { throw 'MapLibre module MIME missing' }; $count++
# Prerequisites must forward WinSW and PostgreSQL inputs; with a valid JDK and WinSW it must reach the PostgreSQL check.
$prereq=Join-Path $env:RUNNER_TEMP ('prereq-'+[guid]::NewGuid())
foreach ($path in @('jdk/bin','winsw','pghome/bin')) { New-Item -ItemType Directory -Path (Join-Path $prereq $path) -Force | Out-Null }
Set-Content -LiteralPath (Join-Path $prereq 'jdk/release') -Value 'JAVA_VERSION="21.0.13"'
New-Item -ItemType File -Path (Join-Path $prereq 'jdk/bin/java.exe') | Out-Null
$wrapper=Join-Path $prereq 'winsw/InfraMonitorBackend.exe'
Set-Content -LiteralPath $wrapper -Value 'fixture'
$prereqArgs=@{
    Operation='Prerequisites'; Root=$prereq; JavaHome=(Join-Path $prereq 'jdk'); ServiceSid='S-1-5-80-0'
    WinSWExecutable=$wrapper; WinSWSha256=(Get-FileHash -LiteralPath $wrapper -Algorithm SHA256).Hash.ToLowerInvariant()
    PostgreSQLHome=(Join-Path $prereq 'pghome')
}
foreach ($invoke in @({ Invoke-ReleaseOperation @prereqArgs }, { & (Join-Path $PSScriptRoot '../Invoke-WindowsRelease.ps1') @prereqArgs })) {
    $message=$null
    try { & $invoke | Out-Null } catch { $message=$_.Exception.Message }
    if ($message -notmatch 'postgres\.exe') { throw "Prerequisites did not reach the PostgreSQL check: $message" }
}; $count++
Write-Output "Windows packaging assertions passed: $count"

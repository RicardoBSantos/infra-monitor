#Requires -Version 7.2
# D02.10-C passo 2 - promove a primeira release do backend (equivalente ao Switch, sem IIS; frontend fica para a D02.10-D)
param([Parameter(Mandatory)][string]$Version)
$ErrorActionPreference = 'Stop'
Import-Module 'C:\src\packages\windows-homologation-8f593ef\ReleaseTools.psm1' -Force
$root = 'C:\InfraMonitor'
if ($Version -notmatch '^r-[0-9a-f]{40}$') { throw 'Versao invalida' }
$stage = Join-Path $root "staging\$Version"
$target = Join-Path $root "releases\$Version"
$link = Join-Path $root 'current\backend'
$stateFile = Join-Path $root 'config\deployment-state.json'
if (Test-Path $target) { throw 'Release ja promovida' }
if (Test-Path $link) { throw 'current\backend ja existe' }
if (Test-Path $stateFile) { throw 'deployment-state.json ja existe' }

Test-PackageIntegrity $stage | Out-Null
Move-Item -LiteralPath (Join-Path $stage "releases\$Version") -Destination $target
Copy-Item -LiteralPath (Join-Path $stage 'package-manifest.json') -Destination (Join-Path $target 'release-manifest.json')
$release = Test-ReleaseIntegrity $target
New-Item -ItemType Junction -Path $link -Target (Join-Path $target 'backend') | Out-Null
@{ backend = $Version; frontend = $null } | ConvertTo-Json | Set-Content -LiteralPath $stateFile
@{event='ACTIVATE-BACKEND-INITIAL';version=$Version;approval='D02.10-C-2026-11-09-operador';utc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $root 'logs\deployment.ndjson')
"release=$($release.version) schema=$($release.schemaVersion)"
"junction=$((Get-Item $link).Target)"
"jar_sha256=$((Get-FileHash (Join-Path $link 'app.jar') -Algorithm SHA256).Hash.ToLower())"

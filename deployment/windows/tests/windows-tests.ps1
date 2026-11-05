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
Write-Output "Windows packaging assertions passed: $count"

# Prova de reversao das verificacoes do puller: para cada guarda, copia o puller e o modulo para uma pasta temporaria,
# REMOVE (ou neutraliza) aquela verificacao e roda os cenarios dela. O teste passa so se os cenarios FALHAREM com a
# verificacao removida. Uma mutacao que sobrevive significa um teste que nao protege nada.
param(
    [Parameter(Mandatory)][string]$FixturePackage,
    [Parameter(Mandatory)][string]$PostgreSQLHome,
    [Parameter(Mandatory)][string]$PasswordFile,
    [string]$User='postgres',[int]$Port=5432,[string]$DatabaseHost='127.0.0.1',
    [string]$SourceDir=(Join-Path $PSScriptRoot '..'),
    [string]$WorkRoot=[IO.Path]::GetTempPath()
)
$ErrorActionPreference='Stop'
$pwshExe=(Get-Process -Id $PID).Path
$puller='Invoke-ReleasePuller.ps1'; $module='ReleaseTools.psm1'
# drop = apaga a linha marcada com #guard:<nome>; old/new = troca literal (uma unica ocorrencia) no arquivo indicado.
$mutations=@(
    @{ name='tag-anotada'; scenarios='tag-leve' }
    @{ name='tag-sha'; scenarios='tag-sha-divergente' }
    @{ name='no-main'; scenarios='fora-do-main' }
    @{ name='run-sha'; scenarios='run-de-outro-commit'; old='$_.head_sha -ceq $Commit -and #guard:run-sha'; new='$true -and' }
    @{ name='run-push'; scenarios='run-de-pr-com-nome-do-main,run-workflow-dispatch'; old='$_.event -ceq ''push'' -and #guard:run-push'; new='$true -and' }
    @{ name='artefato-nome'; scenarios='artefato-nome-errado'; old='Where-Object { $_.name -ceq $name }) #guard:artefato-nome'; new='Select-Object -First 1)' }
    @{ name='expirado'; scenarios='artefato-expirado' }
    @{ name='artefato-run'; scenarios='artefato-de-outra-execucao' }
    @{ name='digest-presente'; scenarios='artefato-sem-digest' }
    @{ name='digest'; scenarios='digest-divergente' }
    @{ name='zip-caminho'; scenarios='zip-com-caminho-inseguro' }
    @{ name='integridade'; scenarios='sha256sums-adulterado'; line='    $manifest=Get-Content -Raw -LiteralPath (Join-Path $Path ''package-manifest.json'') | ConvertFrom-Json -AsHashtable' }
    @{ name='identidade'; scenarios='pacote-de-outro-commit' }
    @{ name='ferramental'; scenarios='ferramental-divergente' }
    @{ name='componente'; scenarios='componente-de-pr' }
    @{ name='espaco'; scenarios='disco-insuficiente' }
    @{ name='superusuario'; scenarios='superusuario'; old=' -RefuseSuperuser #guard:superusuario'; new='' }
    @{ name='banco'; scenarios='banco-antigo,banco-a-frente' }
    @{ name='janela'; scenarios='janela-pausa,janela-mutex,janela-ndjson' }
    @{ name='fora-do-root'; scenarios='puller-dentro-do-root' }
    @{ name='token-acl'; scenarios='token-com-heranca' }
    @{ name='poda-preserva'; scenarios='poda'; old=' -or $dir.Name -cin $Keep) { continue } #guard:poda-preserva'; new=') { continue }' }
    # No modulo: a verificacao reaproveitada tem de ser a que protege, nao uma copia no puller.
    @{ name='modulo:Test-PackageTooling'; scenarios='ferramental-divergente'; file=$module; old='-cne $ExpectedSha256[$name]) { throw "Tooling identity mismatch: $name" }'; new='-cne $ExpectedSha256[$name]) { }' }
    @{ name='modulo:Test-DeploymentOperationActive'; scenarios='janela-mutex'; file=$module; old='    return $found'; new='    return $false' }
    @{ name='modulo:RefuseSuperuser'; scenarios='superusuario'; file=$module; old='if ($RefuseSuperuser -and $Matches[3] -eq ''on'')'; new='if ($false)' }
    @{ name='modulo:Test-DatabaseSchemaFit'; scenarios='banco-antigo'; file=$module; old='if ($DatabaseSchemaVersion -lt $minimum) { throw'; new='if ($false) { throw' }
)
$survivors=[Collections.Generic.List[string]]::new(); $killed=0
$work=Join-Path $WorkRoot ('puller-mutation-'+[guid]::NewGuid().ToString('N').Substring(0,8))
try {
    foreach ($m in $mutations) {
        $dir=Join-Path $work ($m.name -replace '[^A-Za-z0-9-]','_')
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Copy-Item -LiteralPath (Join-Path $SourceDir $puller),(Join-Path $SourceDir $module) -Destination $dir
        $file=Join-Path $dir $(if ($m.file) { $m.file } else { $puller })
        $text=[IO.File]::ReadAllText($file)
        if ($m.ContainsKey('old')) {
            $count=([regex]::Matches($text,[regex]::Escape($m.old))).Count
            if ($count -ne 1) { throw "Mutacao $($m.name): trecho encontrado $count vezes (esperado 1)" }
            $mutated=$text.Replace($m.old,$m.new)
        } else {
            $lines=$text -split "`r?`n"
            $hits=@(for ($i=0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "#guard:$([regex]::Escape($m.name))\s*$") { $i } })
            if ($hits.Count -ne 1) { throw "Mutacao $($m.name): marcador encontrado $($hits.Count) vezes (esperado 1)" }
            $lines[$hits[0]]=if ($m.line) { $m.line } else { '' }
            $mutated=$lines -join "`n"
        }
        [IO.File]::WriteAllText($file,$mutated)
        $errors=$null; [Management.Automation.Language.Parser]::ParseFile($file,[ref]$null,[ref]$errors) | Out-Null
        if ($errors.Count) { throw "Mutacao $($m.name) gerou PowerShell invalido" }
        $out=& $pwshExe -NoProfile -File (Join-Path $PSScriptRoot 'puller-tests.ps1') -FixturePackage $FixturePackage -PostgreSQLHome $PostgreSQLHome -PasswordFile $PasswordFile `
            -User $User -Port $Port -DatabaseHost $DatabaseHost -PullerScript (Join-Path $dir $puller) -Only $m.scenarios -WorkRoot $WorkRoot 2>&1 | Out-String
        $failedLines=@($out -split "`r?`n" | Where-Object { $_ -like 'FALHA *' })
        if ($LASTEXITCODE -ne 0 -and $failedLines.Count) { $killed++; Write-Output "morta    $($m.name)  <- $($failedLines[0].Substring(0,[Math]::Min(150,$failedLines[0].Length)))" }
        else { $survivors.Add($m.name); Write-Output "VIVA     $($m.name): os cenarios '$($m.scenarios)' passaram sem a verificacao" }
    }
} finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
if ($survivors.Count) { throw "Mutacoes sobreviventes: $($survivors -join ', ')" }
Write-Output "Puller mutation tests: $killed/$($mutations.Count) verificacoes provadas por reversao"
exit 0   # o ultimo filho mutado sai com 1 de proposito; o passo pwsh do Actions herdaria esse $LASTEXITCODE

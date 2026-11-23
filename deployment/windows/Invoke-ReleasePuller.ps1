#Requires -Version 7.2
<#
Puller de release iniciado pelo servidor (Docs/producao/puller-de-release.md).

Faz APENAS: descobrir a release aprovada, baixar o artefato, verificar procedencia e integridade, guardar o pacote
verificado em <PullerRoot>\packages\r-<sha>, rodar checagens SO DE LEITURA, escrever relatorio e PARAR.

NUNCA: chama Switch/Rollback, para ou inicia servico/site, escreve no banco, aplica migration, altera juncoes, mexe em
config, ou apaga qualquer coisa sob -Root. So escreve sob -PullerRoot. Toda verificacao vem do ReleaseTools.psm1 que esta
AO LADO deste script (a copia instalada do puller), nunca de dentro do pacote baixado.

Falha fechada: qualquer duvida de procedencia, integridade ou identidade do ferramental termina em RECUSADO.
Saida: 0 = PRONTO / NADA_NOVO / JA_NO_AR; 3 = ADIADO (janela de implantacao detectada); 1 = RECUSADO.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$PullerRoot,
    [Parameter(Mandatory)][string]$PostgreSQLHome,
    [string]$Repository='RicardoBSantos/infra-monitor',
    [string]$Branch='main',
    [string]$PackagingWorkflow='ci-windows-packaging.yml',
    [string]$ApprovalTagPrefix='aprovada/',
    [string]$TokenFile,
    [string[]]$TokenAllowedSids=@('S-1-5-18','S-1-5-32-544'),
    [string]$ApiBaseUrl='https://api.github.com',
    [string]$Proxy,
    [string]$DatabaseName='inframonitor',
    [string]$DatabaseHost='127.0.0.1',
    [ValidateRange(1,65535)][int]$DatabasePort=5432,
    [UInt64]$OperationalPeakBytes=3GB,
    [UInt64]$MaxPackageBytes=2GB,
    [ValidateRange(0,10080)][int]$QuietMinutes=120,
    [ValidateRange(10,100000)][int]$KeepReports=200,
    [switch]$EventLog
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force

$script:Secrets=[Collections.Generic.List[string]]::new()
$script:Token=$null
$script:Report=[ordered]@{
    format=1; utc=[DateTime]::UtcNow.ToString('o'); status=$null; code=$null; message=$null
    puller=[ordered]@{ script=$null; module=$null }
    approval=$null; run=$null; artifact=$null; package=$null; database=$null; deployed=$null; root=$null; flags=$null
    pruned=@(); nextStep=$null
}

function Protect-Text([string]$Text) {
    # Nada de segredo no relatorio, no log ou na saida: token, senha, URL assinada de blob.
    if ($null -eq $Text) { return $null }
    foreach ($secret in $script:Secrets) { if ($secret) { $Text=$Text.Replace($secret,'[omitido]') } }
    $Text=$Text -replace '\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})','[omitido]'
    $Text=$Text -replace '(?i)https?://[^\s''"]+\?[^\s''"]*','[url omitida]'
    $Text=$Text -replace '(?i)(password|senha|pwd|token)(\s*[=:]\s*)[^\s;,]+','$1$2[omitido]'
    return $Text
}
function Stop-Puller([string]$Code,[string]$Message,[string]$Status='RECUSADO') {
    $e=[Exception]::new($Message); $e.Data['code']=$Code; $e.Data['status']=$Status; throw $e
}
function ConvertTo-UtcDate($Value) {
    # ConvertFrom-Json/Invoke-RestMethod ja devolvem DateTime para datas ISO; string e convertida sem cultura local.
    if ($Value -is [DateTime]) { if ($Value.Kind -eq [DateTimeKind]::Unspecified) { return [DateTime]::SpecifyKind($Value,[DateTimeKind]::Utc) }; return $Value.ToUniversalTime() }
    if ($Value -is [DateTimeOffset]) { return $Value.UtcDateTime }
    $parsed=[DateTimeOffset]::MinValue
    if ([DateTimeOffset]::TryParse([string]$Value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal,[ref]$parsed)) { return $parsed.UtcDateTime }
    return $null
}
function Get-Field($Object,[string]$Name) {
    # Campo opcional de resposta JSON sem estourar o StrictMode; ausente = $null (e o chamador recusa).
    if ($null -eq $Object) { return $null }
    $property=$Object.PSObject.Properties[$Name]
    if ($property) { return $property.Value }
    return $null
}
function Get-Sha256([string]$Path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }

# ------------------------------------------------------------------------------------------------- GitHub (somente GET)
function Invoke-GitHub {
    param([Parameter(Mandatory)][string]$Path,[string]$OutFile,[switch]$Raw)
    $headers=@{ 'Accept'=$(if ($Raw) { 'application/vnd.github.raw' } else { 'application/vnd.github+json' })
                'X-GitHub-Api-Version'='2022-11-28'; 'User-Agent'='infra-monitor-release-puller' }
    if ($script:Token) { $headers['Authorization']='Bearer '+$script:Token }
    $request=@{ Uri=$script:Api+$Path; Headers=$headers; TimeoutSec=120; Method='Get' }
    if ($Proxy) { $request['Proxy']=$Proxy }
    try {
        if ($OutFile) {
            # Redirecionamento para o blob: o PowerShell 7 descarta o Authorization ao trocar de host.
            Invoke-WebRequest @request -OutFile $OutFile | Out-Null
            return
        }
        return Invoke-RestMethod @request
    } catch {
        $status=$null
        try { $status=[int]$_.Exception.Response.StatusCode } catch { }
        $route=($Path -split '\?')[0]
        if ($status -in 401,403) { Stop-Puller 'CREDENCIAL' "GitHub recusou $route com HTTP $status (token ausente, sem escopo ou expirado)" }
        if ($status -eq 410) { Stop-Puller 'ARTEFATO_EXPIRADO' "GitHub respondeu 410 em $route (artefato expirado ou apagado)" }
        if ($status) { Stop-Puller 'GITHUB' "GitHub respondeu HTTP $status em $route" }
        Stop-Puller 'REDE' ("Sem resposta do GitHub em $route ("+$_.Exception.GetType().Name+'). Conferir rota/proxy para api.github.com')
    }
}

# ------------------------------------------------------------------------------------------------- Janela de implantacao
function Get-WindowReason([string]$RootPath,[string]$Own) {
    if (Test-Path -LiteralPath (Join-Path $Own 'PAUSA')) { return 'arquivo PAUSA presente em PullerRoot (pausa manual)' }
    if (Test-DeploymentOperationActive -Root $RootPath) { return 'operacao de release em andamento (mutex do ReleaseTools aberto)' }
    $logs=Join-Path $RootPath 'logs'
    $evidence=Join-Path $logs 'deployment.ndjson'
    $limit=[DateTime]::UtcNow.AddMinutes(-$QuietMinutes)
    if (Test-Path -LiteralPath $evidence) {
        $last=$null
        foreach ($line in @(Get-Content -LiteralPath $evidence -Tail 50)) {
            try { $parsed=$line | ConvertFrom-Json -AsHashtable; if ($parsed -and $parsed['event']) { $last=$parsed } } catch { }
        }
        if ($last) {
            if ($last['event'] -ceq 'START') { return 'ultimo evento do deployment.ndjson e START sem SUCCESS/FAILED (operacao em curso ou interrompida)' }
            $when=ConvertTo-UtcDate $last['utc']
            if ($null -eq $when -or $when -gt $limit) {
                return "evento $($last['event']) no deployment.ndjson ha menos de $QuietMinutes min"
            }
        }
    }
    if (Test-Path -LiteralPath $logs) {
        $recent=@(Get-ChildItem -LiteralPath $logs -File -Filter 'implantacao-*.txt' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTimeUtc -gt $limit })
        if ($recent.Count) { return "transcript de implantacao escrito ha menos de $QuietMinutes min" }
    }
    return $null
}

# ------------------------------------------------------------------------------------------------- Aprovacao (D1: tag anotada)
function Resolve-Approval {
    $prefix=$ApprovalTagPrefix
    $refs=@(Invoke-GitHub "/repos/$Repository/git/matching-refs/tags/$prefix" | ForEach-Object { $_ } | Where-Object { $null -ne $_ })
    $pattern='^refs/tags/'+[regex]::Escape($prefix)+'r-([0-9a-f]{40})$'
    $candidates=@()
    foreach ($ref in $refs) {
        if ($ref -isnot [pscustomobject] -or -not (Get-Field $ref 'ref') -or -not (Get-Field $ref 'object')) { Stop-Puller 'GITHUB' 'resposta inesperada da listagem de tags' }
        if ([string]$ref.ref -cnotmatch $pattern) { Stop-Puller 'TAG_NOME' "tag fora do formato $($prefix)r-<sha de 40>: $(Protect-Text ([string]$ref.ref))" }
        $sha=$Matches[1]
        if ($ref.object.type -cne 'tag') { Stop-Puller 'TAG_LEVE' "tag $($ref.ref) e leve: aprovacao exige tag ANOTADA (autor, data, mensagem)" } #guard:tag-anotada
        $tag=Invoke-GitHub "/repos/$Repository/git/tags/$($ref.object.sha)"
        if ($tag.object.type -cne 'commit' -or $tag.object.sha -cne $sha) { Stop-Puller 'TAG_NOME' "tag $($ref.ref) aponta para $($tag.object.type) $($tag.object.sha), nao para o commit do nome" } #guard:tag-sha
        $date=ConvertTo-UtcDate $tag.tagger.date
        if ($null -eq $date) { Stop-Puller 'TAG_NOME' "tag $($ref.ref) sem data de autor legivel" }
        $verified=$false; try { $verified=[bool]$tag.verification.verified } catch { }
        $first=(([string]$tag.message) -split "`r?`n")[0]
        $candidates+=[pscustomobject]@{ commit=$sha; tag=([string]$ref.ref).Substring(10); tagger=[string]$tag.tagger.name; date=$date.ToString('o')
                                        approvalId=(Protect-Text ($first -replace '[^\w .:/@-]','').Trim()); signatureVerified=$verified; sortKey=$date }
    }
    if (-not $candidates.Count) { return $null }
    $chosen=@($candidates | Sort-Object sortKey -Descending)[0]
    $compare=Invoke-GitHub "/repos/$Repository/compare/$($chosen.commit)...$($Branch)?per_page=1"
    if ($compare.status -cnotin @('ahead','identical')) { Stop-Puller 'FORA_DO_MAIN' "commit aprovado $($chosen.commit) nao esta no $Branch (compare: $($compare.status))" } #guard:no-main
    return ($chosen | Select-Object commit,tag,tagger,date,approvalId,signatureVerified)
}

# ------------------------------------------------------------------------------------------------- Run e artefato
function Resolve-PackagingArtifact([string]$Commit) {
    $runs=@((Invoke-GitHub "/repos/$Repository/actions/workflows/$PackagingWorkflow/runs?head_sha=$Commit&per_page=100").workflow_runs)
    $valid=@($runs | Where-Object {
        $_.head_sha -ceq $Commit -and #guard:run-sha
        $_.event -ceq 'push' -and #guard:run-push
        $_.head_branch -ceq $Branch -and $_.conclusion -ceq 'success' -and
        $_.path -ceq ".github/workflows/$PackagingWorkflow" -and $_.repository.full_name -ceq $Repository -and $_.head_repository.full_name -ceq $Repository })
    if ($valid.Count -eq 0) {
        $other=@($runs | ForEach-Object { "$($_.event)/$($_.conclusion)" }) -join ', '
        Stop-Puller 'RUN_AUSENTE' "nenhuma execucao push/$Branch com sucesso de $PackagingWorkflow para $Commit (encontradas: $(if ($other) { $other } else { 'nenhuma' })). Execucao de PR ou workflow_dispatch nao serve: ferramental de outro commit"
    }
    if ($valid.Count -gt 1) { Stop-Puller 'RUN_AMBIGUO' "mais de uma execucao valida para $Commit" }
    $run=$valid[0]
    $name="windows-homologation-$Commit-$($run.id)-$($run.run_attempt)"
    $artifacts=@((Invoke-GitHub "/repos/$Repository/actions/runs/$($run.id)/artifacts?per_page=100").artifacts)
    $found=@($artifacts | Where-Object { $_.name -ceq $name }) #guard:artefato-nome
    if ($found.Count -ne 1) { Stop-Puller 'ARTEFATO_AUSENTE' "artefato $name ausente ou ambiguo na execucao $($run.id)" }
    $artifact=$found[0]
    if ($artifact.expired) { Stop-Puller 'ARTEFATO_EXPIRADO' "artefato $name expirou em $((ConvertTo-UtcDate $artifact.expires_at).ToString('o')). Regerar pelo workflow_dispatch NAO serve (ferramental do dia); aprovar um commit novo do $Branch" } #guard:expirado
    if ($artifact.workflow_run.id -ne $run.id -or $artifact.workflow_run.head_sha -cne $Commit) { Stop-Puller 'ARTEFATO_AUSENTE' "artefato $name nao pertence a execucao $($run.id) do commit $Commit" } #guard:artefato-run
    if ([string](Get-Field $artifact 'digest') -cnotmatch '^sha256:([0-9a-f]{64})$') { Stop-Puller 'ARTEFATO_DIGEST' "artefato $name sem digest SHA-256 publicado pelo GitHub" } #guard:digest-presente
    return [pscustomobject]@{ run=$run; artifact=$artifact; digest=$Matches[1] }
}

function Expand-UntrustedZip([string]$Zip,[string]$Destination) {
    # O zip e dado nao confiavel: nomes validados ANTES de qualquer escrita, destino novo e vazio, nada e executado.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive=[IO.Compression.ZipFile]::OpenRead($Zip)
    try {
        $seen=@{}; [UInt64]$total=0
        foreach ($entry in $archive.Entries) {
            $name=$entry.FullName
            if ($name.EndsWith('/')) { $name=$name.TrimEnd('/') }
            try { Assert-RelativePath $name } catch { Stop-Puller 'ZIP_INSEGURO' 'entrada do zip com caminho inseguro' } #guard:zip-caminho
            if ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { Stop-Puller 'ZIP_INSEGURO' 'entrada do zip e link simbolico' }
            if ($seen.ContainsKey($name.ToLowerInvariant())) { Stop-Puller 'ZIP_INSEGURO' 'entrada duplicada no zip' }
            $seen[$name.ToLowerInvariant()]=$true
            $total+=[UInt64]$entry.Length
            if ($total -gt $MaxPackageBytes) { Stop-Puller 'ZIP_INSEGURO' 'conteudo descompactado acima de MaxPackageBytes' }
        }
        $base=[IO.Path]::GetFullPath($Destination).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
        foreach ($entry in $archive.Entries) {
            $target=[IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
            if (-not $target.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)) { Stop-Puller 'ZIP_INSEGURO' 'entrada escaparia do diretorio de extracao' }
            if ($entry.FullName.EndsWith('/')) { New-Item -ItemType Directory -Force -Path $target | Out-Null; continue }
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$false)
        }
    } finally { $archive.Dispose() }
}

function Get-ExpectedTooling([string]$Commit,[string]$Scratch) {
    # Fonte independente do pacote: o blob de deployment/windows/<arquivo> NO COMMIT APROVADO.
    $expected=@{}
    foreach ($name in Get-ToolingFileNames) {
        $blob=Join-Path $Scratch ('blob-'+[guid]::NewGuid().ToString('N'))
        Invoke-GitHub "/repos/$Repository/contents/deployment/windows/$($name)?ref=$Commit" -Raw -OutFile $blob
        $expected[$name]=Get-Sha256 $blob
        Remove-Item -LiteralPath $blob -Force
    }
    return $expected
}

function Test-ComponentProvenance([hashtable]$Manifest,[string]$Commit) {
    # Os artefatos de backend e frontend que o pacote declara vieram de execucoes push/main do mesmo commit.
    if ($Manifest['provenance'] -isnot [Collections.IDictionary]) { Stop-Puller 'PROCEDENCIA_COMPONENTE' 'pacote sem procedencia dos componentes' }
    foreach ($component in @('backend','frontend')) {
        $declared=$Manifest['provenance'][$component]
        if ($declared -isnot [Collections.IDictionary] -or [string]$declared['run'] -notmatch '^\d+$') { Stop-Puller 'PROCEDENCIA_COMPONENTE' "procedencia do $component ausente" }
        $run=Invoke-GitHub "/repos/$Repository/actions/runs/$($declared['run'])"
        $ok=$run.head_sha -ceq $Commit -and $run.event -ceq 'push' -and $run.head_branch -ceq $Branch -and $run.conclusion -ceq 'success' -and
            $run.path -ceq ".github/workflows/ci-$component.yml" -and $run.repository.full_name -ceq $Repository -and
            [string]$declared['name'] -ceq "$component-$Commit-$($run.id)-$($run.run_attempt)"
        if (-not $ok) { Stop-Puller 'PROCEDENCIA_COMPONENTE' "o $component do pacote nao veio de uma execucao push/$Branch com sucesso de $Commit" } #guard:componente
    }
}

function Test-StagedPackage([string]$Path,[string]$Commit,[hashtable]$ExpectedTooling) {
    try { $manifest=Test-PackageIntegrity $Path } catch { Stop-Puller 'INTEGRIDADE' ('Test-PackageIntegrity: '+$_.Exception.Message) } #guard:integridade
    if ($manifest['commit'] -cne $Commit -or $manifest['version'] -cne "r-$Commit") { Stop-Puller 'IDENTIDADE' "manifesto do pacote e de $($manifest['commit']), aprovado e $Commit" } #guard:identidade
    try { Test-PackageTooling -PackagePath $Path -ExpectedSha256 $ExpectedTooling } catch { Stop-Puller 'FERRAMENTAL' ('ferramental do pacote difere do commit aprovado: '+$_.Exception.Message) } #guard:ferramental
    return $manifest
}

function Get-ServiceFlags([string]$RootPath) {
    # Flag reportada como ligada/desligada; nunca o valor de outra variavel.
    $xml=Join-Path $RootPath 'config/service/InfraMonitorBackend.xml'
    if (-not (Test-Path -LiteralPath $xml)) { return 'nao lido (XML do servico ausente)' }
    $flags=[ordered]@{}
    try {
        [xml]$model=Get-Content -Raw -LiteralPath $xml
        foreach ($node in @($model.SelectNodes('/service/env'))) {
            $name=$node.GetAttribute('name')
            if ($name -cmatch '^[A-Z0-9_]+_ENABLED$') {
                $flags[$name]=switch -Regex ($node.GetAttribute('value')) { '^(?i)true$' { 'ligada' } '^(?i)false$' { 'desligada' } default { 'indefinida' } }
            }
        }
    } catch { return 'nao lido (XML invalido)' }
    return $flags
}

function Invoke-Prune([string]$Packages,[string[]]$Keep) {
    # So o que e do puller: <PullerRoot>\packages\r-<sha>. Nunca -Root. Preserva em uso, anterior e aprovado.
    $removed=@()
    if (-not (Test-Path -LiteralPath $Packages)) { return $removed }
    foreach ($dir in @(Get-ChildItem -LiteralPath $Packages -Directory -Force)) {
        if ($dir.Name -cnotmatch '^r-[0-9a-f]{40}$' -or $dir.Name -cin $Keep) { continue } #guard:poda-preserva
        if ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        if (@(Get-ChildItem -LiteralPath $dir.FullName -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { continue }
        Remove-Item -LiteralPath $dir.FullName -Recurse -Force
        Remove-Item -LiteralPath (Join-Path $Packages "$($dir.Name).verified.json") -Force -ErrorAction SilentlyContinue
        $removed+=$dir.Name
    }
    return $removed
}

function Write-PullerEvent([string]$Status,[string]$Summary) {
    $type=switch ($Status) { 'RECUSADO' { 'ERROR' } 'ADIADO' { 'WARNING' } default { 'INFORMATION' } }
    $id=switch ($Status) { 'PRONTO' { 100 } 'RECUSADO' { 300 } 'ADIADO' { 200 } default { 101 } }
    $text=(Protect-Text $Summary) -replace '"',"'"
    & "$env:SystemRoot\System32\eventcreate.exe" /L APPLICATION /T $type /SO InfraMonitorReleasePuller /ID $id /D $text | Out-Null
}

# ================================================================================================= Execucao
$exit=1
$ownPath=$null
$mutex=$null; $held=$false
try {
    if ($ApiBaseUrl -cnotmatch '^https://[A-Za-z0-9.-]+(:\d+)?$' -and $ApiBaseUrl -cnotmatch '^http://127\.0\.0\.1:\d+$') { Stop-Puller 'PARAMETRO' 'ApiBaseUrl precisa ser https (http so em 127.0.0.1, laboratorio)' }
    if ($Repository -cnotmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' -or $Branch -cnotmatch '^[A-Za-z0-9_./-]+$' -or $ApprovalTagPrefix -cnotmatch '^[A-Za-z0-9_-]+/$' -or $PackagingWorkflow -cnotmatch '^[A-Za-z0-9_.-]+\.ya?ml$') { Stop-Puller 'PARAMETRO' 'repositorio, branch, workflow ou prefixo de tag invalido' }
    $script:Api=$ApiBaseUrl
    $rootPath=Assert-AbsolutePath $Root
    $ownPath=Assert-AbsolutePath $PullerRoot
    $sep=[IO.Path]::DirectorySeparatorChar
    if ($ownPath -ieq $rootPath -or $ownPath.StartsWith($rootPath+$sep,[StringComparison]::OrdinalIgnoreCase) -or $rootPath.StartsWith($ownPath+$sep,[StringComparison]::OrdinalIgnoreCase)) { Stop-Puller 'PARAMETRO' 'PullerRoot e Root nao podem conter um ao outro' } #guard:fora-do-root
    $script:Report.puller.script=Get-Sha256 $PSCommandPath
    $script:Report.puller.module=Get-Sha256 (Join-Path $PSScriptRoot 'ReleaseTools.psm1')
    foreach ($dir in @('packages','downloads','reports')) { New-Item -ItemType Directory -Force -Path (Join-Path $ownPath $dir) | Out-Null }

    # 2.1 Idempotente: uma execucao por vez; a segunda sai sem fazer nada.
    $key=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($ownPath.ToLowerInvariant())))
    $mutex=[Threading.Mutex]::new($false,'Global\InfraMonitorReleasePuller-'+$key)
    $held=$mutex.WaitOne(0)
    if (-not $held) { Stop-Puller 'CONCORRENTE' 'outra execucao do puller esta em andamento' 'ADIADO' }
    # Sobras de execucao interrompida: so a quarentena do proprio puller.
    foreach ($old in @(Get-ChildItem -LiteralPath (Join-Path $ownPath 'downloads') -Force)) { Remove-Item -LiteralPath $old.FullName -Recurse -Force }

    # 2.6 Janela de implantacao: observa, nao bloqueia; se houver sinal, sai antes de baixar ou ler o banco.
    $window=Get-WindowReason $rootPath $ownPath
    if ($window) { Stop-Puller 'JANELA' $window 'ADIADO' } #guard:janela

    try { $deployed=Get-DeployedReleases -Root $rootPath } catch { Stop-Puller 'ESTADO_ILEGIVEL' ('estado da implantacao ilegivel: '+$_.Exception.Message) }
    $script:Report.deployed=$deployed
    if ($deployed.interrupted) { Stop-Puller 'TRANSICAO_INTERROMPIDA' 'existe current\*.swap: troca de juncoes interrompida, revisao humana' }

    if ($TokenFile) {
        $tokenPath=Assert-AbsolutePath $TokenFile
        if ($IsWindows) { try { Test-SecretFileAcl -Path $tokenPath -AllowedSids $TokenAllowedSids } catch { Stop-Puller 'CREDENCIAL' ('arquivo do token: '+$_.Exception.Message) } } #guard:token-acl
        $script:Token=([IO.File]::ReadAllText($tokenPath)).Trim()
        if (-not $script:Token) { Stop-Puller 'CREDENCIAL' 'arquivo do token vazio' }
        $script:Secrets.Add($script:Token)
    }

    $approval=Resolve-Approval
    $script:Report.approval=$approval
    if (-not $approval) { Stop-Puller 'SEM_APROVACAO' "nenhuma tag $($ApprovalTagPrefix)r-<sha> no repositorio" 'NADA_NOVO' }
    $version="r-$($approval.commit)"
    $packages=Join-Path $ownPath 'packages'
    $final=Join-Path $packages $version
    $sidecar=Join-Path $packages "$version.verified.json"
    $keep=@($deployed.backend,$deployed.frontend,$deployed.previousBackend,$deployed.previousFrontend,$version) | Where-Object { $_ }

    if ($deployed.backend -ceq $version -and $deployed.frontend -ceq $version) {
        $script:Report.pruned=@(Invoke-Prune $packages $keep)
        Stop-Puller 'JA_NO_AR' "$version ja esta no ar (backend e frontend)" 'JA_NO_AR'
    }

    $scratch=Join-Path (Join-Path $ownPath 'downloads') ([guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $scratch | Out-Null
    $expectedTooling=Get-ExpectedTooling $approval.commit $scratch

    if ((Test-Path -LiteralPath $final) -and (Test-Path -LiteralPath $sidecar)) {
        # Ja baixado e verificado antes: nao baixa de novo, mas reverifica o que esta no disco.
        $previous=Get-Content -Raw -LiteralPath $sidecar | ConvertFrom-Json -AsHashtable
        $manifest=Test-StagedPackage $final $approval.commit $expectedTooling
        $script:Report.run=$previous['run']; $script:Report.artifact=$previous['artifact']
        $script:Report.package=[ordered]@{ path=$final; reused=$true }
    } else {
        if (Test-Path -LiteralPath $final) { Stop-Puller 'ESTADO_ILEGIVEL' "$final existe sem registro de verificacao; revisar e remover manualmente" }
        $resolved=Resolve-PackagingArtifact $approval.commit
        $script:Report.run=[ordered]@{ id=$resolved.run.id; attempt=$resolved.run.run_attempt; event=$resolved.run.event; url=[string]$resolved.run.html_url }
        $script:Report.artifact=[ordered]@{ id=$resolved.artifact.id; name=$resolved.artifact.name; digest=$resolved.digest; bytes=$resolved.artifact.size_in_bytes; expiresAt=(ConvertTo-UtcDate $resolved.artifact.expires_at).ToString('o') }

        # Disco: o mesmo portao do Stage (22 GiB projetados), com zip + extracao + folga.
        $free=([IO.DriveInfo]::new([IO.Path]::GetPathRoot($ownPath))).AvailableFreeSpace
        try { Test-FreeSpacePolicy -FreeBytes $free -AdditionalBytes ([UInt64]$resolved.artifact.size_in_bytes*3) -PeakBytes $OperationalPeakBytes | Out-Null } catch { Stop-Puller 'ESPACO' $_.Exception.Message } #guard:espaco

        $zip=Join-Path $scratch 'artifact.zip'
        Invoke-GitHub "/repos/$Repository/actions/artifacts/$($resolved.artifact.id)/zip" -OutFile $zip
        if ((Get-Sha256 $zip) -cne $resolved.digest) { Stop-Puller 'ARTEFATO_DIGEST' 'zip baixado difere do digest publicado pelo GitHub' } #guard:digest
        $extract=Join-Path $scratch 'x'
        New-Item -ItemType Directory -Path $extract | Out-Null
        Expand-UntrustedZip $zip $extract
        $manifest=Test-StagedPackage $extract $approval.commit $expectedTooling
        Test-ComponentProvenance $manifest $approval.commit
        # Stage do puller: renomeia a pasta verificada para o caminho canonico (mesmo volume, sem copia).
        Move-Item -LiteralPath $extract -Destination $final
        [ordered]@{ verifiedUtc=[DateTime]::UtcNow.ToString('o'); approval=$approval; run=$script:Report.run; artifact=$script:Report.artifact; tooling=$expectedTooling } |
            ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $sidecar -Encoding utf8
        $script:Report.package=[ordered]@{ path=$final; reused=$false }
    }
    Remove-Item -LiteralPath $scratch -Recurse -Force
    $script:Report.package.version=$manifest['version']
    $script:Report.package.schemaVersion=$manifest['schemaVersion']
    $script:Report.package.minSchemaVersion=$manifest['minSchemaVersion']
    $script:Report.package.tooling=$expectedTooling

    # 2.4 Banco: so leitura, papel da aplicacao, nunca superusuario.
    $userFile=Join-Path $rootPath 'config/secrets/DB_USERNAME'
    $passwordFile=Join-Path $rootPath 'config/secrets/DB_PASSWORD'
    try { $dbUser=([IO.File]::ReadAllText($userFile)).Trim() } catch { Stop-Puller 'BANCO_ILEGIVEL' 'config\secrets\DB_USERNAME ilegivel (o puller precisa rodar como SYSTEM ou administrador)' }
    if (-not $dbUser -or $dbUser -ieq 'postgres') { Stop-Puller 'SUPERUSUARIO' 'o puller usa o papel da aplicacao, nunca postgres' }
    try {
        $schema=Get-DatabaseSchemaVersion -PostgreSQLHome $PostgreSQLHome -PasswordFile $passwordFile -Database $DatabaseName -User $dbUser -DatabaseHost $DatabaseHost -Port $DatabasePort -RefuseSuperuser #guard:superusuario
    } catch {
        if ($_.Exception.Message -match 'Superuser') { Stop-Puller 'SUPERUSUARIO' 'o papel de DB_USERNAME e superusuario; o puller recusa' }
        Stop-Puller 'BANCO_ILEGIVEL' ('leitura do flyway_schema_history: '+$_.Exception.Message)
    }
    $script:Report.database=[ordered]@{ schemaVersion=$schema; role='papel da aplicacao (config\secrets\DB_USERNAME)'; readOnly=$true; fits=$false }
    try { Test-DatabaseSchemaFit -Target $manifest -DatabaseSchemaVersion $schema } catch { Stop-Puller 'BANCO_FORA' ("banco em V$schema; pacote suporta V$($manifest['minSchemaVersion'])..V$($manifest['schemaVersion']): "+$_.Exception.Message) } #guard:banco
    $script:Report.database.fits=$true

    $releasesDir=Join-Path $rootPath 'releases'; $stagingDir=Join-Path $rootPath 'staging'
    $script:Report.root=[ordered]@{
        releases=@(if (Test-Path -LiteralPath $releasesDir) { (Get-ChildItem -LiteralPath $releasesDir -Directory).Name })
        staging=@(if (Test-Path -LiteralPath $stagingDir) { (Get-ChildItem -LiteralPath $stagingDir -Directory).Name })
    }
    $script:Report.root.stageWouldRefuse=($script:Report.root.releases.Count -ge 2)
    $script:Report.flags=Get-ServiceFlags $rootPath
    $script:Report.pruned=@(Invoke-Prune $packages $keep)
    $script:Report.nextStep="Pacote verificado. Na janela, `$Pkg = '$final'. O Switch continua sendo do operador, com a prova humana."
    $script:Report.status='PRONTO'; $script:Report.code='PRONTO'
    $script:Report.message="$version verificado; banco V$schema dentro de V$($manifest['minSchemaVersion'])..V$($manifest['schemaVersion'])"
    $exit=0
} catch {
    $status=$_.Exception.Data['status']; $code=$_.Exception.Data['code']
    if (-not $status) { $status='RECUSADO'; $code='ERRO_INESPERADO' }
    $script:Report.status=$status; $script:Report.code=$code
    $script:Report.message=Protect-Text $_.Exception.Message
    $exit=switch ($status) { 'ADIADO' { 3 } 'NADA_NOVO' { 0 } 'JA_NO_AR' { 0 } default { 1 } }
} finally {
    if ($held) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}

$json=Protect-Text ($script:Report | ConvertTo-Json -Depth 8)
$summary="$($script:Report.status) [$($script:Report.code)] $($script:Report.message)"
if ($ownPath -and (Test-Path -LiteralPath (Join-Path $ownPath 'reports'))) {
    $reports=Join-Path $ownPath 'reports'
    $stamp=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    Set-Content -LiteralPath (Join-Path $reports "$stamp-$($script:Report.status).json") -Value $json -Encoding utf8
    Set-Content -LiteralPath (Join-Path $ownPath 'ULTIMO.txt') -Value ((Protect-Text $summary)+"`n"+$json) -Encoding utf8
    @(Get-ChildItem -LiteralPath $reports -File -Filter '*.json' | Sort-Object Name -Descending | Select-Object -Skip $KeepReports) | Remove-Item -Force
    # Aviso (D3) so quando o resultado muda, para nao virar ruido.
    $stateFile=Join-Path $ownPath 'state.json'
    $fingerprint="$($script:Report.status)|$($script:Report.code)|$(if ($script:Report.approval) { $script:Report.approval.commit })"
    $last=if (Test-Path -LiteralPath $stateFile) { (Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json).fingerprint } else { $null }
    if ($fingerprint -cne $last) {
        if ($EventLog -and $IsWindows) { try { Write-PullerEvent $script:Report.status $summary } catch { Write-Warning 'eventcreate falhou; relatorio em arquivo mantido' } }
        @{ fingerprint=$fingerprint; utc=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding utf8
    }
}
Write-Output (Protect-Text $summary)
exit $exit

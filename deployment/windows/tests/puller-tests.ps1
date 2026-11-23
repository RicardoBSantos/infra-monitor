# Testes do puller de release (Invoke-ReleasePuller.ps1) contra um GitHub FALSO local (fake-github.ps1) e um PostgreSQL
# DESCARTAVEL. Cria e apaga bancos puller_* e os papeis puller_app/puller_su; nunca aponte para um banco com dados.
# Windows (juncoes, ACL). Cada cenario usa Root e PullerRoot proprios em pasta temporaria.
#
# Cada cenario de recusa confere o CODIGO e o trecho da mensagem: se a verificacao correspondente for removida, outro
# guarda (ou nenhum) responde e o cenario falha. puller-mutation-tests.ps1 prova isso removendo cada guarda.
param(
    [Parameter(Mandatory)][string]$FixturePackage,
    [Parameter(Mandatory)][string]$PostgreSQLHome,
    [Parameter(Mandatory)][string]$PasswordFile,
    [string]$User='postgres',[int]$Port=5432,[string]$DatabaseHost='127.0.0.1',
    [string]$PullerScript=(Join-Path $PSScriptRoot '../Invoke-ReleasePuller.ps1'),
    [string[]]$Only,
    [string]$WorkRoot=[IO.Path]::GetTempPath()
)
$ErrorActionPreference='Stop'
$Only=@($Only | ForEach-Object { $_ -split ',' } | Where-Object { $_ })   # -File passa "a,b" como um texto so
Import-Module (Join-Path $PSScriptRoot '../ReleaseTools.psm1') -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$pwshExe=(Get-Process -Id $PID).Path
$PullerScript=[IO.Path]::GetFullPath($PullerScript)
$work=Join-Path $WorkRoot ('puller-tests-'+[guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $work | Out-Null
$repo='lab/infra-monitor'
$A='a'*40; $D='d'*40
$old='r-'+('1'*40); $older='r-'+('2'*40)
$token='ghp_'+('T0kenDeLab0ratorio'*3).Substring(0,36)
$dbPassword='senha-lab-'+[guid]::NewGuid().ToString('N')
$failures=[Collections.Generic.List[string]]::new(); $passed=0

function Get-Sha([string]$p) { (Get-FileHash -Algorithm SHA256 -LiteralPath $p).Hash.ToLowerInvariant() }

# ---------------------------------------------------------------------------------------------- PostgreSQL descartavel
$psql=Join-Path (Assert-AbsolutePath $PostgreSQLHome) ('bin/psql'+$(if ($IsWindows) { '.exe' } else { '' }))
$env:PGPASSWORD=[IO.File]::ReadAllText((Assert-AbsolutePath $PasswordFile)).Trim()
function Invoke-Sql([string]$Database,[string]$Sql) {
    & $psql -h $DatabaseHost -p $Port -U $User -d $Database -w -At -X -q -v ON_ERROR_STOP=1 -c $Sql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "psql failed on $Database" }
}
$history='create table flyway_schema_history (installed_rank int primary key, version varchar(50), description varchar(200), success boolean not null)'
$databases=@{ puller_ok='select v, v::text, ''m'', true from generate_series(1,27) v'; puller_old='select v, v::text, ''m'', true from generate_series(1,25) v'
              puller_ahead='select v, v::text, ''m'', true from generate_series(1,28) v'
              puller_failed='select v, v::text, ''m'', v<>27 from generate_series(1,27) v' }
foreach ($db in $databases.Keys) { Invoke-Sql 'postgres' "drop database if exists $db" }
foreach ($role in 'puller_app','puller_su') { Invoke-Sql 'postgres' "drop role if exists $role" }
foreach ($db in $databases.Keys) { Invoke-Sql 'postgres' "create database $db" }
Invoke-Sql 'postgres' "create role puller_app login password '$dbPassword' nosuperuser"
Invoke-Sql 'postgres' "create role puller_su login password '$dbPassword' superuser"
foreach ($db in $databases.Keys) {
    Invoke-Sql $db "$history; insert into flyway_schema_history $($databases[$db]); grant select on flyway_schema_history to puller_app"
}

# ---------------------------------------------------------------------------------------------- Pacotes e zips
function Copy-Package([string]$Name) { $d=Join-Path $work $Name; Copy-Item -LiteralPath $FixturePackage -Destination $d -Recurse; return $d }
function Update-Sums([string]$Pkg) {
    $lines=foreach ($f in Get-ChildItem -LiteralPath $Pkg -Recurse -File | Where-Object Name -ne 'SHA256SUMS') {
        "$(Get-Sha $f.FullName)  $([IO.Path]::GetRelativePath($Pkg,$f.FullName).Replace('\','/'))" }
    [IO.File]::WriteAllText((Join-Path $Pkg 'SHA256SUMS'),((@($lines) | Sort-Object { $_.Substring(66) } -CaseSensitive) -join "`n")+"`n")
}
function Edit-Manifest([string]$Pkg,[scriptblock]$Change) {
    $m=Get-Content -Raw -LiteralPath (Join-Path $Pkg 'package-manifest.json') | ConvertFrom-Json -AsHashtable
    & $Change $m
    [IO.File]::WriteAllText((Join-Path $Pkg 'package-manifest.json'),($m | ConvertTo-Json -Depth 20))
    Update-Sums $Pkg
}
function New-Zip([string]$Pkg,[string]$Name) { $z=Join-Path $work "$Name.zip"; [IO.Compression.ZipFile]::CreateFromDirectory($Pkg,$z); return $z }
$provenance={ param($m) $m['provenance']=@{ backend=@{ run=601; artifact=7001; name="backend-$A-601-1" }; frontend=@{ run=602; artifact=7002; name="frontend-$A-602-1" } } }
$good=Copy-Package 'good'; Edit-Manifest $good $provenance
$goodZip=New-Zip $good 'good'
# SHA256SUMS adulterado: uma linha com hash trocado (o zip tem digest correto: quem publicou controlava o artefato).
$sums=Copy-Package 'sums'; Edit-Manifest $sums $provenance
$lines=[IO.File]::ReadAllLines((Join-Path $sums 'SHA256SUMS')); $lines[0]=('0'*64)+$lines[0].Substring(64)
[IO.File]::WriteAllText((Join-Path $sums 'SHA256SUMS'),($lines -join "`n")+"`n"); $sumsZip=New-Zip $sums 'sums'
# Ferramental divergente, montado de forma CONSISTENTE (manifesto e SHA256SUMS recalculados), como num pacote de PR.
$tool=Copy-Package 'tool'
Add-Content -LiteralPath (Join-Path $tool 'ReleaseTools.psm1') -Value '# alteracao de PR'
Edit-Manifest $tool { param($m) & $provenance $m; $m['files']=@{}; foreach ($f in Get-ChildItem -LiteralPath $tool -Recurse -File | Where-Object Name -notin 'SHA256SUMS','package-manifest.json') { $m['files'][[IO.Path]::GetRelativePath($tool,$f.FullName).Replace('\','/')]=(Get-Sha $f.FullName) } }
$toolZip=New-Zip $tool 'tool'
# Zip com entrada fora da pasta.
$evilZip=Join-Path $work 'evil.zip'
$archive=[IO.Compression.ZipFile]::Open($evilZip,'Create')
try { $w=[IO.StreamWriter]::new($archive.CreateEntry('../evil.txt').Open()); $w.Write('x'); $w.Dispose() } finally { $archive.Dispose() }

# ---------------------------------------------------------------------------------------------- GitHub falso
$routesFile=Join-Path $work 'routes.json'; $portFile=Join-Path $work 'port'; $logFile=Join-Path $work 'requests.log'
'{}' | Set-Content -LiteralPath $routesFile
New-Item -ItemType File -Path $logFile | Out-Null
$server=Start-Process -FilePath $pwshExe -ArgumentList @('-NoProfile','-File',(Join-Path $PSScriptRoot 'fake-github.ps1'),'-RoutesFile',$routesFile,'-PortFile',$portFile,'-LogFile',$logFile) -PassThru -WindowStyle Hidden
for ($i=0; $i -lt 100 -and -not (Test-Path -LiteralPath $portFile); $i++) { Start-Sleep -Milliseconds 100 }
$api='http://127.0.0.1:'+(Get-Content -Raw -LiteralPath $portFile)

function New-Run([long]$Id,[string]$Sha,[string]$Workflow,[string]$Event='push',[string]$Conclusion='success') {
    @{ id=$Id; run_attempt=1; head_sha=$Sha; event=$Event; head_branch='main'; conclusion=$Conclusion; path=".github/workflows/$Workflow"
       repository=@{ full_name=$repo }; head_repository=@{ full_name=$repo }; html_url="https://example.invalid/runs/$Id" }
}
function New-Routes([string]$Commit=$A,[string]$Zip=$goodZip) {
    $r=@{}
    $r["/repos/$repo/git/matching-refs/tags/aprovada/"]=@{ status=200; json=@(@{ ref="refs/tags/aprovada/r-$Commit"; object=@{ type='tag'; sha='7a9' } }) }
    $r["/repos/$repo/git/tags/7a9"]=@{ status=200; json=@{ object=@{ type='commit'; sha=$Commit }; tagger=@{ name='Responsavel'; date='2026-11-17T10:00:00Z' }; message="D02.13-lab`n"; verification=@{ verified=$false } } }
    $r["/repos/$repo/compare/$Commit...main"]=@{ status=200; json=@{ status='ahead' } }
    $r["/repos/$repo/actions/workflows/ci-windows-packaging.yml/runs"]=@{ status=200; json=@{ workflow_runs=@((New-Run 500 $Commit 'ci-windows-packaging.yml')) } }
    $r["/repos/$repo/actions/runs/500/artifacts"]=@{ status=200; json=@{ artifacts=@(@{ id=900; name="windows-homologation-$Commit-500-1"; expired=$false; expires_at='2026-11-24T00:00:00Z'
        size_in_bytes=(Get-Item $Zip).Length; digest='sha256:'+(Get-Sha $Zip); workflow_run=@{ id=500; head_sha=$Commit } }) } }
    $r["/repos/$repo/actions/artifacts/900/zip"]=@{ status=302; location="$api/blob/900?sig=SEGREDO-DE-URL-ASSINADA"; requireAuth=$true }
    $r['/blob/900']=@{ status=200; file=$Zip; type='application/zip' }
    $r["/repos/$repo/actions/runs/601"]=@{ status=200; json=(New-Run 601 $Commit 'ci-backend.yml') }
    $r["/repos/$repo/actions/runs/602"]=@{ status=200; json=(New-Run 602 $Commit 'ci-frontend.yml') }
    foreach ($f in Get-ToolingFileNames) { $r["/repos/$repo/contents/deployment/windows/$f"]=@{ status=200; file=(Join-Path $PSScriptRoot "../$f"); type='text/plain' } }
    return $r
}
function Set-Routes([hashtable]$Routes) { $Routes | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $routesFile }
function Get-Requests { @(Get-Content -LiteralPath $logFile) }

# ---------------------------------------------------------------------------------------------- Raiz falsa e execucao
function New-Lab([string]$Name,[string]$Deployed=$old,[string]$DbUser='puller_app') {
    $base=Join-Path $work $Name
    $root=Join-Path $base 'InfraMonitor'; $own=Join-Path $base 'puller'
    foreach ($p in "releases/$old/backend","releases/$old/frontend","releases/$older/backend","releases/$older/frontend",'current','logs','config/secrets','config/service') { New-Item -ItemType Directory -Force -Path (Join-Path $root $p) | Out-Null }
    foreach ($part in 'backend','frontend') {
        New-Item -ItemType Junction -Path (Join-Path $root "current/$part") -Target (Join-Path $root "releases/$old/$part") | Out-Null
        New-Item -ItemType Junction -Path (Join-Path $root "current/$part.previous") -Target (Join-Path $root "releases/$older/$part") | Out-Null
    }
    @{ backend=$Deployed; frontend=$Deployed } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'config/deployment-state.json')
    Set-Content -LiteralPath (Join-Path $root 'config/secrets/DB_USERNAME') -Value $DbUser -NoNewline
    Set-Content -LiteralPath (Join-Path $root 'config/secrets/DB_PASSWORD') -Value $dbPassword -NoNewline
    Set-Content -LiteralPath (Join-Path $root 'config/service/InfraMonitorBackend.xml') -Value '<service><env name="MONITOR_ENABLED" value="true"/><env name="TELEGRAM_ENABLED" value="false"/><env name="DB_URL" value="jdbc:postgresql://127.0.0.1/inframonitor?password=nao-vaza"/></service>'
    $tokenFile=Join-Path $base 'token.txt'
    Set-Content -LiteralPath $tokenFile -Value $token -NoNewline
    $acl=Get-Acl -LiteralPath $tokenFile; $acl.SetAccessRuleProtection($true,$false)
    foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRule($rule) }
    $me=[Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($me,'FullControl','Allow')); Set-Acl -LiteralPath $tokenFile -AclObject $acl
    return [pscustomobject]@{ Base=$base; Root=$root; Own=$own; Token=$tokenFile; Sid=$me.Value }
}
function Get-Snapshot([string]$Path) {
    @(Get-ChildItem -LiteralPath $Path -Recurse -Force | Sort-Object FullName | ForEach-Object {
        "$($_.FullName)|$($_.LinkType)|$(@($_.Target) -join ',')|$(if (-not $_.PSIsContainer) { "$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" })" }) -join "`n"
}
function Invoke-Puller($Lab,[hashtable]$Extra=@{},[string]$Database='puller_ok',[switch]$NoToken) {
    $argv=@('-NoProfile','-File',$PullerScript,'-Root',$Lab.Root,'-PullerRoot',$Lab.Own,'-PostgreSQLHome',$PostgreSQLHome,
            '-Repository',$repo,'-ApiBaseUrl',$api,'-DatabaseName',$Database,'-DatabaseHost',$DatabaseHost,'-DatabasePort',$Port)
    if (-not $NoToken) { $argv+=@('-TokenFile',$Lab.Token,'-TokenAllowedSids',$Lab.Sid) }
    foreach ($k in $Extra.Keys) { $argv+=@("-$k",$Extra[$k]) }
    $before=Get-Snapshot $Lab.Root
    $saved=$env:PGPASSWORD; Remove-Item Env:PGPASSWORD
    try { $out=& $pwshExe @argv 2>&1 | Out-String; $code=$LASTEXITCODE } finally { $env:PGPASSWORD=$saved }
    $last=Join-Path $Lab.Own 'ULTIMO.txt'
    $report=if (Test-Path -LiteralPath $last) { (Get-Content -Raw -LiteralPath $last) -replace '^[^\n]*\n','' | ConvertFrom-Json -AsHashtable } else { $null }
    return [pscustomobject]@{ Exit=$code; Output=$out; Report=$report; RootChanged=($before -cne (Get-Snapshot $Lab.Root)) }
}
function Assert-Result($R,[int]$Exit,[string]$Status,[string]$Code,[string]$Message) {
    if (-not $R.Report) { throw "sem relatorio; saida: $($R.Output)" }
    if ($R.Exit -ne $Exit -or $R.Report.status -cne $Status -or $R.Report.code -cne $Code) { throw "esperado $Exit/$Status/$Code, veio $($R.Exit)/$($R.Report.status)/$($R.Report.code): $($R.Report.message)" }
    if ($Message -and $R.Report.message -notmatch $Message) { throw "mensagem sem '$Message': $($R.Report.message)" }
    if ($R.RootChanged) { throw 'o puller alterou algo sob Root' }
}

$scenarios=[ordered]@{}
$scenarios['feliz']={
    $lab=New-Lab 'feliz'; Set-Routes (New-Routes)
    $r=Invoke-Puller $lab
    Assert-Result $r 0 'PRONTO' 'PRONTO'
    $pkg=Join-Path $lab.Own "packages/r-$A"
    Test-PackageIntegrity $pkg | Out-Null
    if (-not (Test-Path -LiteralPath "$pkg.verified.json")) { throw 'sem registro de verificacao' }
    if ($r.Report.database.schemaVersion -ne 27 -or -not $r.Report.database.fits) { throw 'schema do banco nao reportado' }
    if ($r.Report.flags.MONITOR_ENABLED -cne 'ligada' -or $r.Report.flags.TELEGRAM_ENABLED -cne 'desligada' -or $r.Report.flags.Contains('DB_URL')) { throw 'flags mal reportadas' }
    if ($r.Report.approval.approvalId -cne 'D02.13-lab') { throw 'id de aprovacao nao veio da tag' }
    if (@(Get-ChildItem -LiteralPath (Join-Path $lab.Own 'downloads')).Count) { throw 'quarentena nao foi limpa' }
    if (@(Get-Requests | Where-Object { $_ -like '/blob/900*' -and $_ -like '*auth=True' }).Count) { throw 'Authorization seguiu para o host do blob' }
}
$scenarios['idempotente']={
    $lab=New-Lab 'idem'; Set-Routes (New-Routes)
    Assert-Result (Invoke-Puller $lab) 0 'PRONTO' 'PRONTO'
    $downloads=@(Get-Requests | Where-Object { $_ -like '/blob/*' }).Count
    $r=Invoke-Puller $lab
    Assert-Result $r 0 'PRONTO' 'PRONTO'
    if (-not $r.Report.package.reused) { throw 'segunda execucao nao reaproveitou o pacote' }
    if (@(Get-Requests | Where-Object { $_ -like '/blob/*' }).Count -ne $downloads) { throw 'segunda execucao baixou de novo' }
}
$scenarios['concorrente']={
    $lab=New-Lab 'conc'; Set-Routes (New-Routes); New-Item -ItemType Directory -Force -Path $lab.Own | Out-Null
    $key=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(([IO.Path]::GetFullPath($lab.Own)).ToLowerInvariant())))
    $m=[Threading.Mutex]::new($true,'Global\InfraMonitorReleasePuller-'+$key)
    try { Assert-Result (Invoke-Puller $lab) 3 'ADIADO' 'CONCORRENTE' } finally { $m.ReleaseMutex(); $m.Dispose() }
}
$scenarios['janela-pausa']={
    $lab=New-Lab 'pausa'; Set-Routes (New-Routes); New-Item -ItemType Directory -Force -Path $lab.Own | Out-Null
    New-Item -ItemType File -Path (Join-Path $lab.Own 'PAUSA') | Out-Null
    $n=(Get-Requests).Count
    Assert-Result (Invoke-Puller $lab) 3 'ADIADO' 'JANELA' 'PAUSA'
    if ((Get-Requests).Count -ne $n) { throw 'adiado mas falou com o GitHub' }
}
$scenarios['janela-mutex']={
    $lab=New-Lab 'mutex'; Set-Routes (New-Routes)
    $m=[Threading.Mutex]::new($true,(Get-DeploymentMutexName $lab.Root))
    try { Assert-Result (Invoke-Puller $lab) 3 'ADIADO' 'JANELA' 'mutex' } finally { $m.ReleaseMutex(); $m.Dispose() }
}
$scenarios['janela-ndjson']={
    $lab=New-Lab 'ndjson'; Set-Routes (New-Routes)
    $ev=Join-Path $lab.Root 'logs/deployment.ndjson'
    Set-Content -LiteralPath $ev -Value ('{"event":"START","operation":"Switch","utc":"'+[DateTime]::UtcNow.AddHours(-5).ToString('o')+'"}')
    Assert-Result (Invoke-Puller $lab) 3 'ADIADO' 'JANELA' 'START'
    $lab2=New-Lab 'ndjson2'
    Set-Content -LiteralPath (Join-Path $lab2.Root 'logs/deployment.ndjson') -Value ('{"event":"SUCCESS","utc":"'+[DateTime]::UtcNow.AddMinutes(-10).ToString('o')+'"}')
    Assert-Result (Invoke-Puller $lab2) 3 'ADIADO' 'JANELA' 'SUCCESS'
    $lab3=New-Lab 'ndjson3'
    Set-Content -LiteralPath (Join-Path $lab3.Root 'logs/deployment.ndjson') -Value ('{"event":"SUCCESS","utc":"'+[DateTime]::UtcNow.AddHours(-3).ToString('o')+'"}')
    Assert-Result (Invoke-Puller $lab3) 0 'PRONTO' 'PRONTO'
}
$scenarios['transicao-interrompida']={
    $lab=New-Lab 'swap'; Set-Routes (New-Routes)
    New-Item -ItemType Junction -Path (Join-Path $lab.Root 'current/backend.swap') -Target (Join-Path $lab.Root "releases/$old/backend") | Out-Null
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'TRANSICAO_INTERROMPIDA'
}
$scenarios['sem-aprovacao']={
    $lab=New-Lab 'semtag'; $r=New-Routes; $r["/repos/$repo/git/matching-refs/tags/aprovada/"]=@{ status=200; body='[]' }; Set-Routes $r
    Assert-Result (Invoke-Puller $lab) 0 'NADA_NOVO' 'SEM_APROVACAO'
}
$scenarios['tag-leve']={
    $lab=New-Lab 'leve'; $r=New-Routes; $r["/repos/$repo/git/matching-refs/tags/aprovada/"]=@{ status=200; json=@(@{ ref="refs/tags/aprovada/r-$A"; object=@{ type='commit'; sha=$A } }) }; Set-Routes $r
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'TAG_LEVE'
}
$scenarios['tag-sha-divergente']={
    $lab=New-Lab 'tagsha'; $r=New-Routes; $r["/repos/$repo/git/tags/7a9"].json.object.sha=$D; Set-Routes $r
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'TAG_NOME'
}
$scenarios['fora-do-main']={
    $lab=New-Lab 'foramain'; $r=New-Routes; $r["/repos/$repo/compare/$A...main"].json.status='diverged'; Set-Routes $r
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'FORA_DO_MAIN'
}
$scenarios['run-de-pr-com-nome-do-main']={
    # O caso do 7060e28: execucao de PR publica windows-homologation-<sha do main> com o ferramental do PR.
    $lab=New-Lab 'pr'; $r=New-Routes -Zip $toolZip
    $r["/repos/$repo/actions/workflows/ci-windows-packaging.yml/runs"].json.workflow_runs=@((New-Run 500 $A 'ci-windows-packaging.yml' 'pull_request'),(New-Run 499 $A 'ci-windows-packaging.yml' 'push' 'cancelled'))
    Set-Routes $r
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'RUN_AUSENTE' 'pull_request/success'
}
$scenarios['run-workflow-dispatch']={
    $lab=New-Lab 'dispatch'; $r=New-Routes -Zip $toolZip
    $r["/repos/$repo/actions/workflows/ci-windows-packaging.yml/runs"].json.workflow_runs=@((New-Run 500 $A 'ci-windows-packaging.yml' 'workflow_dispatch')); Set-Routes $r
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'RUN_AUSENTE' 'workflow_dispatch'
}
$scenarios['run-de-outro-commit']={
    $lab=New-Lab 'runsha'; $r=New-Routes
    $r["/repos/$repo/actions/workflows/ci-windows-packaging.yml/runs"].json.workflow_runs=@((New-Run 500 $D 'ci-windows-packaging.yml')); Set-Routes $r
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'RUN_AUSENTE'
}
$scenarios['artefato-expirado']={
    $lab=New-Lab 'expirado'; $r=New-Routes; $r["/repos/$repo/actions/runs/500/artifacts"].json.artifacts[0].expired=$true; Set-Routes $r
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'ARTEFATO_EXPIRADO' 'expirou'
}
$scenarios['artefato-nome-errado']={
    $lab=New-Lab 'nome'; $r=New-Routes; $r["/repos/$repo/actions/runs/500/artifacts"].json.artifacts[0].name="windows-homologation-$A-500-2"; Set-Routes $r
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'ARTEFATO_AUSENTE' 'ausente'
}
$scenarios['artefato-de-outra-execucao']={
    $lab=New-Lab 'outrarun'; $r=New-Routes; $r["/repos/$repo/actions/runs/500/artifacts"].json.artifacts[0].workflow_run.head_sha=$D; Set-Routes $r
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'ARTEFATO_AUSENTE' 'nao pertence'
}
$scenarios['artefato-sem-digest']={
    $lab=New-Lab 'semdigest'; $r=New-Routes; $r["/repos/$repo/actions/runs/500/artifacts"].json.artifacts[0].Remove('digest'); Set-Routes $r
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'ARTEFATO_DIGEST' 'sem digest'
}
$scenarios['digest-divergente']={
    $lab=New-Lab 'digest'; $r=New-Routes; $r['/blob/900'].file=$sumsZip; Set-Routes $r
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'ARTEFATO_DIGEST' 'difere'
    if (Test-Path -LiteralPath (Join-Path $lab.Own "packages/r-$A")) { throw 'pacote recusado foi para packages' }
}
$scenarios['sha256sums-adulterado']={
    $lab=New-Lab 'sums'; Set-Routes (New-Routes -Zip $sumsZip)
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'INTEGRIDADE'
    if (Test-Path -LiteralPath (Join-Path $lab.Own "packages/r-$A")) { throw 'pacote recusado foi para packages' }
}
$scenarios['ferramental-divergente']={
    $lab=New-Lab 'tool'; Set-Routes (New-Routes -Zip $toolZip)
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'FERRAMENTAL' 'ReleaseTools.psm1'
}
$scenarios['pacote-de-outro-commit']={
    $lab=New-Lab 'identidade'; Set-Routes (New-Routes -Commit $D -Zip $goodZip)
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'IDENTIDADE'
}
$scenarios['zip-com-caminho-inseguro']={
    $lab=New-Lab 'zip'; Set-Routes (New-Routes -Zip $evilZip)
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'ZIP_INSEGURO' 'caminho inseguro'
    if (Get-ChildItem -LiteralPath $lab.Own -Recurse -Filter 'evil.txt') { throw 'entrada do zip foi escrita' }
}
$scenarios['componente-de-pr']={
    $lab=New-Lab 'componente'; $r=New-Routes; $r["/repos/$repo/actions/runs/601"].json.event='pull_request'; Set-Routes $r
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'PROCEDENCIA_COMPONENTE' 'backend'
}
$scenarios['disco-insuficiente']={
    $lab=New-Lab 'disco'; Set-Routes (New-Routes); $n=@(Get-Requests | Where-Object { $_ -like '*/zip*' }).Count
    Assert-Result (Invoke-Puller $lab @{ OperationalPeakBytes=[UInt64]::MaxValue/2 }) 1 'RECUSADO' 'ESPACO' '22 GiB'
    if (@(Get-Requests | Where-Object { $_ -like '*/zip*' }).Count -ne $n) { throw 'baixou sem espaco' }
}
$scenarios['banco-antigo']={ $lab=New-Lab 'old'; Set-Routes (New-Routes); Assert-Result (Invoke-Puller $lab -Database 'puller_old') 1 'RECUSADO' 'BANCO_FORA' 'older' }
$scenarios['banco-a-frente']={ $lab=New-Lab 'ahead'; Set-Routes (New-Routes); Assert-Result (Invoke-Puller $lab -Database 'puller_ahead') 1 'RECUSADO' 'BANCO_FORA' 'ahead' }
$scenarios['banco-migration-falha']={ $lab=New-Lab 'failed'; Set-Routes (New-Routes); Assert-Result (Invoke-Puller $lab -Database 'puller_failed') 1 'RECUSADO' 'BANCO_ILEGIVEL' 'Failed migration' }
$scenarios['superusuario']={
    $lab=New-Lab 'su' -DbUser 'puller_su'; Set-Routes (New-Routes)
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'SUPERUSUARIO'
    $lab2=New-Lab 'pg' -DbUser 'postgres'; Assert-Result (Invoke-Puller $lab2) 1 'RECUSADO' 'SUPERUSUARIO'
}
$scenarios['sem-token']={ $lab=New-Lab 'semtoken'; Set-Routes (New-Routes); Assert-Result (Invoke-Puller $lab -NoToken) 1 'RECUSADO' 'CREDENCIAL' '401' }
$scenarios['token-com-heranca']={
    $lab=New-Lab 'acl'; Set-Routes (New-Routes)
    icacls $lab.Token /inheritance:e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'icacls falhou' }
    Assert-Result (Invoke-Puller $lab) 1 'RECUSADO' 'CREDENCIAL' 'inheritance'
}
$scenarios['ja-no-ar']={ $lab=New-Lab 'noar' -Deployed "r-$A"; Set-Routes (New-Routes); Assert-Result (Invoke-Puller $lab) 0 'JA_NO_AR' 'JA_NO_AR' }
$scenarios['poda']={
    $lab=New-Lab 'poda'; Set-Routes (New-Routes)
    $packages=Join-Path $lab.Own 'packages'
    foreach ($v in $old,$older,('r-'+('3'*40)),('r-'+('4'*40))) { New-Item -ItemType Directory -Force -Path (Join-Path $packages "$v/releases") | Out-Null; '{}' | Set-Content (Join-Path $packages "$v.verified.json") }
    Assert-Result (Invoke-Puller $lab) 0 'PRONTO' 'PRONTO'
    $left=@((Get-ChildItem -LiteralPath $packages -Directory).Name | Sort-Object)
    if (($left -join ',') -cne ((@($old,$older,"r-$A") | Sort-Object) -join ',')) { throw "poda errada: $($left -join ',')" }
    if (-not (Test-Path -LiteralPath (Join-Path $lab.Root "releases/$older/backend"))) { throw 'tocou em Root' }
}
$scenarios['puller-dentro-do-root']={
    $lab=New-Lab 'dentro'; Set-Routes (New-Routes); $lab.Own=Join-Path $lab.Root 'puller'
    $r=Invoke-Puller $lab
    if ($r.Exit -ne 1 -or $r.Output -notmatch 'PARAMETRO') { throw "PullerRoot dentro de Root nao foi recusado: $($r.Output)" }
    if (Test-Path -LiteralPath $lab.Own) { throw 'escreveu dentro de Root' }
}

try {
    foreach ($name in $scenarios.Keys) {
        if ($Only -and $name -notin $Only) { continue }
        try { & $scenarios[$name]; $passed++; Write-Output "ok   $name" }
        catch { $failures.Add("$name :: $($_.Exception.Message)"); Write-Output "FALHA $name :: $($_.Exception.Message)" }
    }
    # 2.5: nenhum segredo em relatorio, ULTIMO.txt ou estado, em nenhum cenario.
    if (-not $Only) {
        # So o que o puller escreveu (<lab>\puller\...); routes.json do GitHub falso contem o token de proposito.
        $written=@(Get-ChildItem -LiteralPath $work -Recurse -File -Include '*.json','ULTIMO.txt' | Where-Object { [IO.Path]::GetRelativePath($work,$_.FullName) -match '^[^\\/]+[\\/]puller[\\/]' })
        if ($written.Count -lt 30) { $failures.Add("varredura de segredos leu so $($written.Count) arquivos") }
        foreach ($f in $written) {
            $text=Get-Content -Raw -LiteralPath $f.FullName
            foreach ($secret in $token,$dbPassword,'SEGREDO-DE-URL-ASSINADA','nao-vaza') { if ($text.Contains($secret)) { $failures.Add("segredo em $($f.Name)") } }
        }
        $passed++; Write-Output 'ok   sem-segredos-nos-relatorios'
    }
} finally {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    foreach ($db in $databases.Keys) { try { Invoke-Sql 'postgres' "drop database if exists $db" } catch { } }
    foreach ($role in 'puller_app','puller_su') { try { Invoke-Sql 'postgres' "drop role if exists $role" } catch { } }
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failures.Count) { throw ("Puller: $($failures.Count) falha(s)`n"+($failures -join "`n")) }
Write-Output "Release puller assertions passed: $passed"
exit 0   # sem herdar $LASTEXITCODE de um processo filho

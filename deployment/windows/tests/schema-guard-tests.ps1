# Trava de schema das ferramentas de release (correcao de 2026-11-16).
# Roda em qualquer SO com PowerShell 7.2+ e um PostgreSQL DESCARTAVEL: no CI, o do runner Windows; localmente,
# um container. Cria e apaga bancos guard_*; nunca aponte para um banco com dados.
#
# Cobre as tres pontas:
#   1. igualdade das tres declaracoes (operador, banco, prova) e o schema do pacote >= 25;
#   2. minSchemaVersion declarado (tolerancia a banco anterior) e banco a frente do release (rollback);
#   3. leitura real do flyway_schema_history por Get-DatabaseSchemaVersion.
# Antes da correcao o unico caso aceito era "declarar 25"; banco 27 + pacote 27 + operador 27 era recusado.
param(
    [Parameter(Mandatory)][string]$PostgreSQLHome,
    [Parameter(Mandatory)][string]$PasswordFile,
    [string]$User='postgres',[int]$Port=5432,[string]$DatabaseHost='127.0.0.1'
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../ReleaseTools.psm1') -Force
$count=0
function Assert-Blocked([scriptblock]$Code,[string]$Pattern) {
    $message=$null
    try { & $Code | Out-Null } catch { $message=$_.Exception.Message }
    if ($null -eq $message) { throw "Expected a blocked operation: $Pattern" }
    if ($message -notmatch $Pattern) { throw "Blocked for the wrong reason: '$message' (expected: $Pattern)" }
}
$version='r-'+('a'*40)
$current=@{backend='r-'+('0'*40);frontend='r-'+('0'*40)}
function New-Target([int]$Schema,$Minimum) {
    $m=@{version=$version;historyGuard=$true;schemaVersion=[long]$Schema}
    if ($null -ne $Minimum) { $m.minSchemaVersion=[long]$Minimum }
    return $m
}
function New-Proof([int]$Schema,[hashtable]$Extra=@{}) {
    $p=@{approved=$true;schemaVersion=[long]$Schema;current=$current;target=@{backend=$version;frontend=$version}}
    foreach ($key in $Extra.Keys) { $p[$key]=$Extra[$key] }
    return $p
}
# Assinatura: Proof, Current, Target, Component, SchemaVersion (operador), DatabaseSchemaVersion (lido do banco)

# --- 1. As tres declaracoes -------------------------------------------------------------------------------
# O caso que era impossivel: banco 27, pacote 27, operador 27, prova 27.
Test-RollbackCompatibility (New-Proof 27) $current (New-Target 27 27) 'Both' 27 27; $count++
# O caso que era o UNICO aceito: operador declarando 25 com o banco em 27.
Assert-Blocked { Test-RollbackCompatibility (New-Proof 25) $current (New-Target 27 27) 'Both' 25 27 } 'does not match the database'; $count++
Assert-Blocked { Test-RollbackCompatibility (New-Proof 25) $current (New-Target 27 27) 'Both' 27 27 } 'not proven'; $count++
Assert-Blocked { Test-RollbackCompatibility (New-Proof 27) $current (New-Target 27 27) 'Both' 0 27 } 'Operator schema declaration required'; $count++
Assert-Blocked { Test-RollbackCompatibility @{} $current (New-Target 27 27) 'Both' 27 27 } 'not proven'; $count++
Assert-Blocked { Test-RollbackCompatibility (New-Proof 24) $current (New-Target 24 24) 'Both' 24 24 } 'V25 history protection'; $count++
$wrongPair=New-Proof 27; $wrongPair.current=@{backend='r-'+('9'*40);frontend='r-'+('9'*40)}
Assert-Blocked { Test-RollbackCompatibility $wrongPair $current (New-Target 27 27) 'Both' 27 27 } 'release pair'; $count++

# --- 2. minSchemaVersion e banco a frente ---------------------------------------------------------------
# JAR em 27 que declara tolerar banco em 26 (a V27 so falta; GET usa padroes, PUT 503): passa com o banco em 26.
Test-RollbackCompatibility (New-Proof 26) $current (New-Target 27 26) 'Both' 26 26; $count++
Assert-Blocked { Test-RollbackCompatibility (New-Proof 25) $current (New-Target 27 26) 'Both' 25 25 } 'older than the release supports'; $count++
# Sem declaracao (manifesto antigo) nao ha tolerancia presumida.
Assert-Blocked { Test-RollbackCompatibility (New-Proof 26) $current (New-Target 27 $null) 'Both' 26 26 } 'older than the release supports'; $count++
# Rollback para release anterior com o banco ja migrado: so com aprovacao explicita na prova.
Assert-Blocked { Test-RollbackCompatibility (New-Proof 27) $current (New-Target 26 26) 'Both' 27 27 } 'ahead of the release'; $count++
Test-RollbackCompatibility (New-Proof 27 @{databaseAheadOfRelease=$true}) $current (New-Target 26 26) 'Both' 27 27; $count++

# --- 3. Leitura real do flyway_schema_history -------------------------------------------------------------
$pg=Assert-AbsolutePath $PostgreSQLHome
$psql=Join-Path $pg ('bin/psql'+$(if ($IsWindows) { '.exe' } else { '' }))
$env:PGPASSWORD=[IO.File]::ReadAllText((Assert-AbsolutePath $PasswordFile)).Trim()
function Invoke-Sql([string]$Database,[string]$Sql) {
    & $psql -h $DatabaseHost -p $Port -U $User -d $Database -w -At -X -q -v ON_ERROR_STOP=1 -c $Sql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "psql failed on $Database" }
}
$history='create table flyway_schema_history (installed_rank int primary key, version varchar(50), description varchar(200), success boolean not null)'
$databases=@('guard_ok','guard_failed','guard_empty','guard_notable')
try {
    foreach ($db in $databases) { Invoke-Sql 'postgres' "drop database if exists $db"; Invoke-Sql 'postgres' "create database $db" }
    Invoke-Sql 'guard_ok' "$history; insert into flyway_schema_history select v, v::text, 'm', true from generate_series(1,27) v; insert into flyway_schema_history values (28, null, 'repeatable sem versao', true)"
    Invoke-Sql 'guard_failed' "$history; insert into flyway_schema_history select v, v::text, 'm', true from generate_series(1,27) v; insert into flyway_schema_history values (28, '28', 'falhou', false)"
    Invoke-Sql 'guard_empty' $history
    $read=@{PostgreSQLHome=$PostgreSQLHome;PasswordFile=$PasswordFile;User=$User;Port=$Port;DatabaseHost=$DatabaseHost}
    $schema=Get-DatabaseSchemaVersion @read -Database 'guard_ok'
    if ($schema -ne 27) { throw "Expected 27 from flyway_schema_history, got $schema" }; $count++
    # O valor lido entra na trava: operador declarando 25 com o banco real em 27 e recusado.
    Assert-Blocked { Test-RollbackCompatibility (New-Proof 25) $current (New-Target 27 27) 'Both' 25 $schema } 'does not match the database'; $count++
    Test-RollbackCompatibility (New-Proof 27) $current (New-Target 27 27) 'Both' 27 $schema; $count++
    Assert-Blocked { Get-DatabaseSchemaVersion @read -Database 'guard_failed' } 'Failed migration'; $count++
    Assert-Blocked { Get-DatabaseSchemaVersion @read -Database 'guard_empty' } 'No applied migration'; $count++
    Assert-Blocked { Get-DatabaseSchemaVersion @read -Database 'guard_notable' } 'Could not read'; $count++
    $wrong=Join-Path ([IO.Path]::GetTempPath()) ('guard-wrong-'+[guid]::NewGuid())
    Set-Content -LiteralPath $wrong -Value 'not-the-password' -NoNewline
    try { Assert-Blocked { Get-DatabaseSchemaVersion @read -PasswordFile $wrong -Database 'guard_ok' } 'Could not read'; $count++ }
    finally { Remove-Item -LiteralPath $wrong -Force }
    if ($env:PGPASSWORD -cne [IO.File]::ReadAllText((Assert-AbsolutePath $PasswordFile)).Trim()) { throw 'Get-DatabaseSchemaVersion must restore PGPASSWORD' }; $count++
} finally {
    foreach ($db in $databases) { try { Invoke-Sql 'postgres' "drop database if exists $db" } catch { } }
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

# --- Ligacao: as duas chamadas da trava no Switch/Rollback recebem o schema lido do banco -------------------
$source=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../ReleaseTools.psm1')
if ($source -notmatch '\$databaseSchema=Get-DatabaseSchemaVersion ') { throw 'Switch/Rollback must read the database schema' }
if (([regex]::Matches($source,'Test-RollbackCompatibility \$proof \$state \$(package|release) \$Component \$SchemaVersion \$databaseSchema')).Count -ne 2) { throw 'Both compatibility checks must receive the database schema' }; $count++
Write-Output "Schema guard assertions passed: $count"

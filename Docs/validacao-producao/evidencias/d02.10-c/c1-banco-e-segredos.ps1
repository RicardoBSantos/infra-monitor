# D02.10-C passo 1 - papeis, banco e segredos (nenhum valor secreto e impresso ou passado em linha de comando)
$ErrorActionPreference = 'Stop'
$root = 'C:\InfraMonitor'
$psql = 'C:\Program Files\PostgreSQL\16\bin\psql.exe'

function New-Secret([int]$Length) {
  $chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $bytes = New-Object byte[] $Length
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}
function Write-SecretFile([string]$Dir, [string]$Name, [string]$Value) {
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  $path = Join-Path $Dir $Name
  if (Test-Path $path) { throw "Ja existe: $path" }
  [IO.File]::WriteAllText($path, $Value)   # sem newline
}

$secrets = Join-Path $root 'config\secrets'
$flyway = Join-Path $root 'config\admin\flyway'
$bootstrap = Join-Path $root 'config\admin\bootstrap'

$appPassword = New-Secret 32
$ownerPassword = New-Secret 32
Write-SecretFile $secrets 'DB_NAME' 'inframonitor'
Write-SecretFile $secrets 'DB_USERNAME' 'inframonitor_app'
Write-SecretFile $secrets 'DB_PASSWORD' $appPassword
Write-SecretFile $secrets 'JWT_SECRET' (New-Secret 64)
Write-SecretFile $flyway 'MIGRATOR_USERNAME' 'inframonitor_owner'
Write-SecretFile $flyway 'MIGRATOR_PASSWORD' $ownerPassword
Write-SecretFile $bootstrap 'BOOTSTRAP_ADMIN_ENABLED' 'true'
Write-SecretFile $bootstrap 'BOOTSTRAP_ADMIN_NAME' 'Administrador Infra Monitor'
Write-SecretFile $bootstrap 'BOOTSTRAP_ADMIN_EMAIL' 'informatica@se.sesc.com.br'
Write-SecretFile $bootstrap 'BOOTSTRAP_ADMIN_PASSWORD' (New-Secret 20)

# SQL via stdin: senhas nao aparecem na linha de comando do processo
$sql = @"
\set ON_ERROR_STOP on
CREATE ROLE inframonitor_owner LOGIN PASSWORD '$ownerPassword' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE inframonitor_app LOGIN PASSWORD '$appPassword' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE inframonitor OWNER inframonitor_owner ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE inframonitor FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE inframonitor TO inframonitor_app;
\connect inframonitor
ALTER SCHEMA public OWNER TO inframonitor_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO inframonitor_app;
ALTER DEFAULT PRIVILEGES FOR ROLE inframonitor_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO inframonitor_app;
ALTER DEFAULT PRIVILEGES FOR ROLE inframonitor_owner IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO inframonitor_app;
ALTER DEFAULT PRIVILEGES FOR ROLE inframonitor_owner IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO inframonitor_app;
"@
Remove-Variable appPassword, ownerPassword

$env:PGPASSWORD = [IO.File]::ReadAllText("$root\config\admin\postgres-superuser.txt")
try {
  $sql | & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -q -X -f - 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) { throw "psql falhou ($LASTEXITCODE)" }
  & $psql -h 127.0.0.1 -p 5432 -U postgres -d inframonitor -At -X -c "select current_database(), pg_encoding_to_char(encoding), datcollate from pg_database where datname='inframonitor';" -c "select rolname, rolsuper, rolcreatedb, rolcanlogin from pg_roles where rolname like 'inframonitor%' order by 1;"
} finally {
  Remove-Item Env:PGPASSWORD
  Remove-Variable sql
}
Get-ChildItem $secrets, $flyway, $bootstrap -File | ForEach-Object { "$($_.FullName) bytes=$($_.Length)" }

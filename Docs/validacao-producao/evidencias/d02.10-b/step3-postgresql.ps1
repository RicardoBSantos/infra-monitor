# D02.10-B passo 3 - instalacao nao interativa do PostgreSQL 16 (senha nunca exibida)
$ErrorActionPreference = 'Stop'
$root = 'C:\InfraMonitor'
$ev = Join-Path $root 'evidencias\D02.10-B'
$installer = Join-Path $root 'installers\PostgreSQL 16_16.15-5_Machine_X64_exe_en-US.exe'
$expected = '4065DBC5FFB52010E7357DFD6A74934878F1C6FAF7A75CAD1411A22E11B7B929'
if ((Get-FileHash $installer -Algorithm SHA256).Hash -ne $expected) { throw 'SHA-256 do instalador divergente' }
if (Get-Service 'postgresql-x64-16' -ErrorAction SilentlyContinue) { throw 'Servico postgresql-x64-16 ja existe' }

# Senha do superusuario: 32 caracteres alfanumericos aleatorios, gravada apenas em config\admin (ACL Admin/SYSTEM)
$chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
$bytes = New-Object byte[] 64
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$pwd = -join ($bytes[0..31] | ForEach-Object { $chars[$_ % $chars.Length] })
$pwdFile = Join-Path $root 'config\admin\postgres-superuser.txt'
[IO.File]::WriteAllText($pwdFile, $pwd)

$opt = Join-Path $root 'config\admin\pg-install.opt'
@"
mode=unattended
unattendedmodeui=none
superaccount=postgres
superpassword=$pwd
serverport=5432
servicename=postgresql-x64-16
prefix=C:\Program Files\PostgreSQL\16
datadir=$root\pgdata
enable-components=server,commandlinetools
disable-components=pgAdmin,stackbuilder
"@ | Set-Content -Path $opt -Encoding ascii
Remove-Variable pwd

try {
  $p = Start-Process -FilePath $installer -ArgumentList '--optionfile', "`"$opt`"" -Wait -PassThru
  "installer_exit=$($p.ExitCode)"
} finally {
  Remove-Item $opt -Force
}

# Restringe a escuta ao loopback e o pg_hba a conexoes locais com scram-sha-256
$conf = "$root\pgdata\postgresql.conf"
$hba = "$root\pgdata\pg_hba.conf"
Copy-Item $conf "$conf.orig-d0210b"; Copy-Item $hba "$hba.orig-d0210b"
(Get-Content $conf) -replace "^\s*#?\s*listen_addresses\s*=.*$", "listen_addresses = 'localhost'`t# D02.10-B: somente loopback" | Set-Content $conf -Encoding ascii
@"
# D02.10-B: somente conexoes locais (loopback) com scram-sha-256
# TYPE  DATABASE        USER            ADDRESS                 METHOD
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
host    replication     all             127.0.0.1/32            scram-sha-256
host    replication     all             ::1/128                 scram-sha-256
"@ | Set-Content $hba -Encoding ascii
Restart-Service postgresql-x64-16
Start-Sleep -Seconds 3
Get-Service postgresql-x64-16 | Format-List Name,Status,StartType | Out-String

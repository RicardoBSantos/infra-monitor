# D02.10-C passo 4 - servico WinSW do backend com conta virtual NT SERVICE\InfraMonitorBackend
param([Parameter(Mandatory)][string]$TemplatePath)
$ErrorActionPreference = 'Stop'
$root = 'C:\InfraMonitor'
$svcDir = Join-Path $root 'config\service'
$approvedSha = '05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da'
$src = Join-Path $root 'tools\winsw\WinSW-x64.exe'
if ((Get-FileHash $src -Algorithm SHA256).Hash.ToLower() -ne $approvedSha) { throw 'Hash WinSW divergente' }
if (Get-Service InfraMonitorBackend -ErrorAction SilentlyContinue) { throw 'Servico InfraMonitorBackend ja existe' }

$exe = Join-Path $svcDir 'InfraMonitorBackend.exe'
Copy-Item $src $exe
$java = Join-Path ([Environment]::GetEnvironmentVariable('JAVA_HOME','Machine')) 'bin\java.exe'
$xml = (Get-Content -Raw $TemplatePath) -replace '(?s)<!--.*?-->\s*', ''
$xml = $xml.Replace('@@JAVA_EXE@@', $java).Replace('@@ROOT_URI@@', 'C:/InfraMonitor').Replace('@@ROOT@@', $root)
if ($xml -match '@@') { throw 'Placeholder nao substituido' }
# tmpdir curto e dedicado: o JDK 21 no Windows cria o pipe de wakeup do NIO como socket AF_UNIX no tmpdir
$tmp = Join-Path $root 'tmp\backend'
New-Item -ItemType Directory -Force $tmp | Out-Null
$xml = $xml.Replace('<arguments>-jar ', "<arguments>-Djava.io.tmpdir=$tmp -Djdk.net.unixdomain.tmpdir=$tmp -jar ")
if ($xml -notmatch 'unixdomain\.tmpdir') { throw 'Ajuste de tmpdir nao aplicado' }
# WinSW 2.12 resolve o nome da conta antes de criar o servico quando allowservicelogon=true; a conta virtual
# NT SERVICE\<id> so existe apos a criacao e recebe o direito de logon como servico automaticamente.
$xml = $xml.Replace('<allowservicelogon>true</allowservicelogon>', '<allowservicelogon>false</allowservicelogon>')
[xml]$xml | Out-Null
[IO.File]::WriteAllText((Join-Path $svcDir 'InfraMonitorBackend.xml'), $xml)

& $exe install
if ($LASTEXITCODE -ne 0) { throw "WinSW install falhou ($LASTEXITCODE)" }
$sid = ([Security.Principal.NTAccount]'NT SERVICE\InfraMonitorBackend').Translate([Security.Principal.SecurityIdentifier]).Value
"service_sid=$sid"

# ACL: leitura da aplicacao, escrita so em logs, segredos por arquivo sem heranca (exigido por Test-WindowsPrerequisites)
icacls $root /grant "*${sid}:(OI)(CI)RX" | Out-Null
foreach ($d in 'logs\backend','logs\service','tmp\backend') { icacls (Join-Path $root $d) /grant "*${sid}:(OI)(CI)M" | Out-Null }
icacls (Join-Path $root 'config\secrets') /grant "*${sid}:RX" | Out-Null
foreach ($f in Get-ChildItem (Join-Path $root 'config\secrets') -File) {
  icacls $f.FullName /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' "*${sid}:R" | Out-Null
}
Get-CimInstance Win32_Service -Filter "Name='InfraMonitorBackend'" | ForEach-Object { "$($_.Name) | $($_.State) | $($_.StartMode) | $($_.StartName) | $($_.PathName)" }

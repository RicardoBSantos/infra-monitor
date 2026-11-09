# D02.10-B passo 1 - estrutura de diretorios e ACLs (idempotente)
$ErrorActionPreference = 'Stop'
$root = 'C:\InfraMonitor'
$dirs = 'releases','current','staging','config\secrets','config\service','config\compatibility','config\admin','logs\backend','logs\service','evidencias\D02.10-B','installers'
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path (Join-Path $root $d) | Out-Null }

# Diretorios sensiveis: sem heranca, apenas Administrators e SYSTEM (SID da conta de servico entra na D02.10-C)
foreach ($d in 'config\secrets','config\admin') {
  $p = Join-Path $root $d
  icacls $p /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
}
# Raiz: remove permissao de escrita herdada de Users autenticados (mantem leitura)
icacls $root /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
# Reaplica restricao dos sensiveis (a raiz nao propaga para eles pois a heranca esta desabilitada)

$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
"free_before_GiB=$([math]::Round($disk.FreeSpace/1GB,2)) at $(Get-Date -Format o)" | Out-File -Encoding utf8 (Join-Path $root 'evidencias\D02.10-B\espaco.txt')
Get-ChildItem $root -Recurse -Directory | ForEach-Object FullName
icacls (Join-Path $root 'config\secrets')
icacls (Join-Path $root 'config\admin')
icacls $root

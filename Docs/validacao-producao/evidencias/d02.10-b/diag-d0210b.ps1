# D02.10-B - diagnostico somente leitura (nao altera nada no sistema)
$out = Join-Path $PSScriptRoot 'diag-d0210b.txt'
& {
  '=== HOST ==='
  hostname
  whoami
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $PSVersionTable.PSVersion.ToString()
  $os = Get-CimInstance Win32_OperatingSystem
  "$($os.Caption) $($os.Version) build $($os.BuildNumber) RAM_GB=$([math]::Round($os.TotalVisibleMemorySize/1MB,1)) LastBoot=$($os.LastBootUpTime)"
  '=== DISCOS ==='
  Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { "$($_.DeviceID) total=$([math]::Round($_.Size/1GB,2))GiB free=$([math]::Round($_.FreeSpace/1GB,2))GiB" }
  '=== REBOOT PENDENTE ==='
  Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
  Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
  '=== JAVA ==='
  Get-Command java -All -ErrorAction SilentlyContinue | ForEach-Object Source
  "JAVA_HOME=$env:JAVA_HOME"
  Get-ChildItem 'C:\Program Files\Java','C:\Program Files\Eclipse Adoptium','C:\Program Files\Microsoft\jdk*' -Directory -ErrorAction SilentlyContinue | ForEach-Object FullName
  '=== POSTGRESQL ==='
  Get-Service | Where-Object { $_.Name -like '*postgres*' } | Format-Table -AutoSize Name,Status,StartType | Out-String
  Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue | ForEach-Object FullName
  Get-Command psql -ErrorAction SilentlyContinue | ForEach-Object Source
  '=== IIS ==='
  Get-Service W3SVC,WAS -ErrorAction SilentlyContinue | Format-Table -AutoSize Name,Status,StartType | Out-String
  Test-Path "$env:windir\System32\inetsrv\appcmd.exe"
  '=== PORTAS 80/443/5432/8080 ==='
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in 80,443,5432,8080 | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) pid=$($_.OwningProcess) $((Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName)" }
  '=== SERVICOS EM EXECUCAO (nao Microsoft) ==='
  Get-CimInstance Win32_Service | Where-Object { $_.State -eq 'Running' -and $_.PathName -notmatch '\\Windows\\' } | ForEach-Object { "$($_.Name) | $($_.StartName) | $($_.PathName)" }
  '=== GIT / GH / NODE ==='
  Get-Command git,gh,node,npm,winget -ErrorAction SilentlyContinue | ForEach-Object Source
  '=== REPOSITORIO LOCAL ==='
  Get-ChildItem C:\ -Directory -ErrorAction SilentlyContinue | ForEach-Object FullName
  Get-ChildItem $env:USERPROFILE -Directory -Recurse -Depth 3 -Filter 'infra-monitor*' -ErrorAction SilentlyContinue | ForEach-Object FullName
  Get-ChildItem C:\ -Directory -Recurse -Depth 2 -Filter 'infra-monitor*' -ErrorAction SilentlyContinue | ForEach-Object FullName
  '=== VSS / BACKUP ==='
  Get-Service wbengine,VSS -ErrorAction SilentlyContinue | Format-Table -AutoSize Name,Status,StartType | Out-String
  Get-PSDrive -PSProvider FileSystem | ForEach-Object { "$($_.Name): $($_.Root) $($_.DisplayRoot)" }
} *>&1 | Out-File -FilePath $out -Encoding utf8
"Diagnostico gravado em $out"

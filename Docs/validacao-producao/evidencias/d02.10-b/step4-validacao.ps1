# D02.10-B passo 4 - validacao (somente leitura; a senha nunca e impressa)
$root = 'C:\InfraMonitor'
$pg = 'C:\Program Files\PostgreSQL\16\bin'
'=== JAVA ==='
& "$([Environment]::GetEnvironmentVariable('JAVA_HOME','Machine'))\bin\java.exe" -version 2>&1 | ForEach-Object { "$_" }
'=== POSTGRES SERVICO ==='
Get-CimInstance Win32_Service -Filter "Name='postgresql-x64-16'" | ForEach-Object { "$($_.Name) | $($_.State) | $($_.StartMode) | $($_.StartName)" }
'=== POSTGRES SQL (loopback) ==='
$env:PGPASSWORD = [IO.File]::ReadAllText("$root\config\admin\postgres-superuser.txt")
& "$pg\psql.exe" -h 127.0.0.1 -p 5432 -U postgres -d postgres -At -c "select version();" -c "show listen_addresses;" -c "show password_encryption;" -c "show data_directory;" -c "select datname from pg_database order by 1;" 2>&1 | ForEach-Object { "$_" }
& "$pg\psql.exe" -h ::1 -p 5432 -U postgres -d postgres -At -c "select 'ipv6 ok';" 2>&1 | ForEach-Object { "$_" }
'--- tentativa via IP de rede (deve falhar) ---'
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } | Select-Object -First 1).IPAddress
"ip=$ip"
& "$pg\psql.exe" -h $ip -p 5432 -U postgres -d postgres -At -c "select 1;" -w 2>&1 | ForEach-Object { "$_" }
Remove-Item Env:PGPASSWORD
'=== PORTAS ==='
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 80,443,5432,8080 | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) pid=$($_.OwningProcess) $((Get-Process -Id $_.OwningProcess).ProcessName)" }
'=== FIREWALL (regras com postgres/5432) ==='
Get-NetFirewallRule | Where-Object { $_.DisplayName -match 'postgres|5432' } | ForEach-Object { "$($_.DisplayName) enabled=$($_.Enabled) dir=$($_.Direction)" }
Get-NetFirewallPortFilter -Protocol TCP | Where-Object LocalPort -eq 5432 | ForEach-Object { "portfilter 5432 em regra: $($_.InstanceID)" }
'=== VAZAMENTO DE SENHA EM LOGS DO INSTALADOR ==='
$secret = [IO.File]::ReadAllText("$root\config\admin\postgres-superuser.txt")
$logs = Get-ChildItem $env:TEMP, "$env:windir\Temp" -Filter '*postgres*' -File -ErrorAction SilentlyContinue
$logs += Get-ChildItem "$root\evidencias\D02.10-B" -File
foreach ($l in $logs) { if (Select-String -Path $l.FullName -SimpleMatch $secret -Quiet) { "VAZOU: $($l.FullName)" } else { "ok: $($l.FullName)" } }
Remove-Variable secret
'=== ACL ==='
icacls "$root\config\admin\postgres-superuser.txt"
icacls "$root\pgdata"
'=== ESPACO ==='
$d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
"free_after_GiB=$([math]::Round($d.FreeSpace/1GB,2)) at $(Get-Date -Format o)"
"pgdata_MiB=$([math]::Round((Get-ChildItem $root\pgdata -Recurse -File | Measure-Object Length -Sum).Sum/1MB,1))"
"pg_prefix_MiB=$([math]::Round((Get-ChildItem 'C:\Program Files\PostgreSQL\16' -Recurse -File | Measure-Object Length -Sum).Sum/1MB,1))"
"jdk_MiB=$([math]::Round((Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Recurse -File | Measure-Object Length -Sum).Sum/1MB,1))"
"installers_MiB=$([math]::Round((Get-ChildItem $root\installers -Recurse -File | Measure-Object Length -Sum).Sum/1MB,1))"
'=== SERVICOS PREEXISTENTES ==='
Get-Service 'DB2MGMTSVC_DB2COPY1','Zabbix Agent 2','glpi-agent','RustDesk','IntuneManagementExtension' -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name) $($_.Status)" }
'=== REBOOT PENDENTE ==='
Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue) -ne $null

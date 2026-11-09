# D02.10-C passo 5 - inicia o servico e valida health, autenticacao, escuta e recursos desligados (sem imprimir segredos)
$ErrorActionPreference = 'Stop'
$root = 'C:\InfraMonitor'
Start-Service InfraMonitorBackend
$health = $null
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 3
  try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/actuator/health' -TimeoutSec 3; if ($health.status -eq 'UP') { break } } catch {}
}
'=== SERVICO ==='
Get-CimInstance Win32_Service -Filter "Name='InfraMonitorBackend'" | ForEach-Object { "$($_.Name) | $($_.State) | $($_.StartMode) | $($_.StartName) | pid=$($_.ProcessId)" }
$javaPid = (Get-CimInstance Win32_Process -Filter "Name='java.exe'" | Where-Object { $_.CommandLine -match 'current\\backend\\app.jar' }).ProcessId
"java_pid=$javaPid"
'=== HEALTH (loopback) ==='
$health | ConvertTo-Json -Compress
'=== ESCUTA ==='
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 80,443,5432,8080,18080 | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) pid=$($_.OwningProcess)" }
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } | Select-Object -First 1).IPAddress
try { Invoke-WebRequest -UseBasicParsing -Uri "http://${ip}:8080/actuator/health" -TimeoutSec 3 | Out-Null; 'via_ip_intranet=ACESSIVEL (inesperado)' } catch { 'via_ip_intranet=recusado (esperado)' }
'=== AUTENTICACAO ==='
try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/api/v1/auth/me' -TimeoutSec 5 | Out-Null; 'sem_token=200 (inesperado)' } catch { "sem_token=$([int]$_.Exception.Response.StatusCode)" }
$bad = @{ email = 'informatica@se.sesc.com.br'; senha = 'senha-incorreta-teste' } | ConvertTo-Json
try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8080/api/v1/auth/login' -Method Post -ContentType 'application/json' -Body $bad -TimeoutSec 5 | Out-Null; 'senha_errada=200 (inesperado)' } catch { "senha_errada=$([int]$_.Exception.Response.StatusCode)" }
$body = @{ email = [IO.File]::ReadAllText("$root\config\admin\bootstrap\BOOTSTRAP_ADMIN_EMAIL"); senha = [IO.File]::ReadAllText("$root\config\admin\bootstrap\BOOTSTRAP_ADMIN_PASSWORD") } | ConvertTo-Json
$login = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/api/v1/auth/login' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 10
Remove-Variable body
"login_ok=$([bool]$login.accessToken) expiresIn=$($login.expiresIn) papel=$($login.usuario.papel)"
$me = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/api/v1/auth/me' -Headers @{ Authorization = "Bearer $($login.accessToken)" } -TimeoutSec 5
"me=$($me.email) papel=$($me.papel)"
try { $st = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/api/v1/status' -Headers @{ Authorization = "Bearer $($login.accessToken)" } -TimeoutSec 5; "status=$($st | ConvertTo-Json -Compress -Depth 4)" } catch { "status_erro=$([int]$_.Exception.Response.StatusCode)" }
Remove-Variable login
'=== LOG: perfil, motor, telegram, retencao ==='
Select-String -Path "$root\logs\backend\application.log" -Pattern 'profile|Started InfraMonitor|engine|Telegram|dispatcher|Retention|retencao|ERROR' | Select-Object -Last 15 | ForEach-Object { $_.Line.Substring(0, [math]::Min(200, $_.Line.Length)) }
'=== SEGREDOS NOS LOGS ==='
$values = Get-ChildItem "$root\config\secrets", "$root\config\admin\flyway", "$root\config\admin\bootstrap" -File | Where-Object Length -ge 16 | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }
$values += [IO.File]::ReadAllText("$root\config\admin\postgres-superuser.txt")
$files = Get-ChildItem "$root\logs", "$root\evidencias", "$root\config\service", "$root\pgdata\log" -File -Recurse
$leaks = 0
foreach ($f in $files) { foreach ($v in $values) { if (Select-String -Path $f.FullName -SimpleMatch $v -Quiet) { "VAZOU em $($f.FullName)"; $leaks++ } } }
"leaks=$leaks arquivos_verificados=$($files.Count)"
Remove-Variable values
'=== ACL SEGREDOS ==='
Get-ChildItem "$root\config\secrets" -File | ForEach-Object { $a = Get-Acl $_.FullName; "$($_.Name) protegido=$($a.AreAccessRulesProtected) " + (($a.Access | ForEach-Object { "$($_.IdentityReference):$($_.FileSystemRights)" }) -join '; ') }
'=== ESPACO ==='
$d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
"free_GiB=$([math]::Round($d.FreeSpace/1GB,2))"

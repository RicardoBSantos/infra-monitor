# GitHub falso para os testes do puller: HTTP/1.1 minimo sobre TcpListener em 127.0.0.1 (sem HttpListener, que exige
# urlacl/admin em algumas maquinas). Rotas lidas de -RoutesFile A CADA requisicao, para o teste trocar o cenario sem
# reiniciar. Chave: caminho+query exato; se ausente, so o caminho. Registra cada requisicao em -LogFile.
param([Parameter(Mandatory)][string]$RoutesFile,[Parameter(Mandatory)][string]$PortFile,[Parameter(Mandatory)][string]$LogFile)
$ErrorActionPreference='Stop'
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start()
Set-Content -LiteralPath $PortFile -Value $listener.LocalEndpoint.Port -NoNewline
while ($true) {
    $client=$listener.AcceptTcpClient()
    try {
        $stream=$client.GetStream()
        $reader=[IO.StreamReader]::new($stream,[Text.Encoding]::ASCII,$false,8192,$true)
        $requestLine=$reader.ReadLine()
        $auth=$false
        while ($true) { $h=$reader.ReadLine(); if ([string]::IsNullOrEmpty($h)) { break }; if ($h -match '^(?i)authorization:') { $auth=$true } }
        $target=($requestLine -split ' ')[1]
        Add-Content -LiteralPath $LogFile -Value ("$target auth=$auth")
        $routes=Get-Content -Raw -LiteralPath $RoutesFile | ConvertFrom-Json -AsHashtable
        $path=($target -split '\?')[0]
        $route=if ($routes.ContainsKey($target)) { $routes[$target] } elseif ($routes.ContainsKey($path)) { $routes[$path] } else { @{ status=404; body='{"message":"Not Found"}' } }
        $status=[int]$route['status']
        $bytes=if ($route['file']) { [IO.File]::ReadAllBytes($route['file']) } elseif ($null -ne $route['json']) { [Text.Encoding]::UTF8.GetBytes(($route['json'] | ConvertTo-Json -Depth 20 -AsArray:($route['json'] -is [Collections.IList]))) } else { [Text.Encoding]::UTF8.GetBytes([string]$route['body']) }
        if ($route['requireAuth'] -and -not $auth) { $status=401; $bytes=[Text.Encoding]::UTF8.GetBytes('{"message":"Requires authentication"}') }
        $type=if ($route['type']) { $route['type'] } else { 'application/json; charset=utf-8' }
        $head="HTTP/1.1 $status X`r`nContent-Type: $type`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n"
        if ($route['location']) { $head+="Location: $($route['location'])`r`n" }
        $head+="`r`n"
        $headBytes=[Text.Encoding]::ASCII.GetBytes($head)
        $stream.Write($headBytes,0,$headBytes.Length)
        if ($bytes.Length) { $stream.Write($bytes,0,$bytes.Length) }
        $stream.Flush()
    } catch {
        Add-Content -LiteralPath $LogFile -Value ("server-error " + $_.Exception.Message)
    } finally { $client.Close() }
}

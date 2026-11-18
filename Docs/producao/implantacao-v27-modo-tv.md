# Implantação da V27 (modo TV) com a trava de schema nova — procedimento

> **Situação: PLANO PARA REVISÃO.** Nada que **altere** produção foi executado; o ensaio **só de leitura** (Parte 1) foi,
> em 2026-11-18. Escrito em 2026-11-16 sobre o `main`
> `c6e3f482aace95231082c730a5b6f10c8beefc5d` (PRs #39, #41 e #42 mergeados). O autor não tem acesso a produção: tudo o que
> depende do servidor está marcado e é fechado pelo **ensaio de leitura** (Parte 1), dias antes da janela.
>
> **Ensaios locais executados em 2026-11-16** (Parte 5): falha do Switch depois da troca de junções e recuperação manual,
> jar antigo sobre banco em V27, rollback com e sem `databaseAheadOfRelease`, ferramental antigo com os parâmetros novos,
> Switch sem `-Apply` contra a trava e reprodutibilidade do pacote. **Eles mostraram que o plano estava errado em sete
> pontos**, listados logo abaixo e já corrigidos no texto.
>
> **Ensaio de leitura executado no servidor em 2026-11-18** (SED-TI-D05, 10:28, transcript
> `C:\src\packages\ensaio-v27-20261118-1028.txt`, no servidor). **E6 = 26: o portão passou e a janela pode ser
> marcada**, com a **P2** antes (há `.previous` e 2 releases). O que ele mostrou e o que mudou neste plano está no quadro
> logo abaixo do quadro dos ensaios locais. Os fatos de produção marcados **[P, ensaio]** vêm do resumo do responsável,
> que leu a saída; o autor não leu o transcript.
>
> Estado de partida: `Docs/producao/estado-atual.md`. Ao concluir, ele é atualizado **no mesmo commit** que registrar a
> implantação (regra do próprio arquivo).

**Marcação.** **[P]** provado: lido no código deste commit ou executado, com a fonte ao lado. **[P-lab]** executado no
laboratório da Parte 5: código e pacotes reais, IIS e SCM simulados. **[E]** informado pelo responsável ou por documento
de fase, sem conferência minha. **[I]** inferido: raciocínio sobre o código, ainda não exercitado.

**Fato do ambiente:** produção **não tem backup** (descartado pelo responsável em 2026-11-11) **[E]**. O passo "1. Backup"
das seções V26/V27 do README do backend não se aplica a esta implantação. Este plano não o propõe de novo.

**Decisões do responsável nesta rodada [E]:** ensaiar localmente antes da janela (feito, Parte 5); janela **nesta
semana**, com o pacote atual; aviso à equipe por mensagem direta (texto na 3.6); papel do banco para a trava = o **papel
da aplicação** (`config\secrets`). O papel só de leitura fica para depois, e a circularidade (a trava confere o banco com
a credencial da própria aplicação) está aceita e registrada.

---

## ⚠ O que os ensaios mostraram que o plano tinha ERRADO

| # | O plano dizia | O ensaio mostrou | Onde foi corrigido |
|---|---|---|---|
| 1 | Recuperação 4.1-B: `Start-Service`, depois `Health`, depois `Start-Website` | **O site ficaria parado.** O `Health` roda uma vez, logo depois do `Start-Service`; o backend ainda não abriu a porta, o `Invoke-WebRequest` lança erro **terminante** e o resto do bloco colado **não executa**. O `Start-Website` nunca roda **[P-lab]** | 4.1-B reescrito, com espera; a versão nova foi reexecutada e funcionou |
| 2 | Depois de um Switch que falhou, o Rollback recusa com `Unexpected current link` | Com a prova que a 4.1-A manda escrever, a mensagem é **`Compatibility proof does not match release pair`**. `Unexpected current link` só aparece se a prova casar com o estado gravado. Nenhuma das duas diz "o Switch anterior falhou no meio" **[P-lab]** | 4.1-B, J9 |
| 3 | Para tentar de novo, "o Switch recusaria o `.previous`; faça a P2 antes" | Depois da recuperação, a nova tentativa é **J8 + J9 direto, sem Stage**. O J8 como estava escrito **falha** (`Unexpected or missing file`), porque o primeiro Switch levou `releases\` para fora do staging **[P-lab]** | J8 |
| 4 | Regerar o pacote dá o mesmo pacote, "sobre o blob do git" do commit | O `workflow_dispatch` pega o ferramental do **`main` no dia do disparo**, não do commit informado. E execuções de **PR** geram artefatos com o **nome e a versão do `main`** e o **ferramental do PR** **[P, workflow + artefatos baixados]** | 6.1, 6.2 |
| 5 | Ferramental antigo com `-DatabaseUser` falha nomeando `'DatabaseUser'` | Falha no bind, sim, mas nomeia **o primeiro parâmetro desconhecido que o PowerShell encontrar**. No Rollback com `@Comum`, foi `'DatabasePasswordFile'`. A mensagem não diz "ferramental velho" **[P]** | 2.3, 2.4, função `Release` |
| 6 | Health: "a cada 5 s, até 12 tentativas" (~60 s) | No Windows, cada tentativa contra porta fechada leva ~2 s a mais: o Switch desistiu em **85–89 s** **[P-lab]**. A mensagem final é genérica, e o `deployment.ndjson` grava só `errorType: RuntimeException`: a causa (health) se perde. *Refinado pelo ensaio de 18/11:* o prazo depende de **como** cada tentativa falha, de ~60 s a ~180 s (J9) | J9, 3.4 |
| 7 | Switch que falha depois de parar = site e motor parados | A release nova pode **terminar de subir depois que o script desistiu**. Ficam o site parado, o estado na release antiga **e o backend novo rodando**, com motor e Telegram se estiverem ligados **[P-lab]** | J9, 4.1-B |

O que os ensaios **confirmaram** e passou de [I] a [P-lab]: jar antigo sobe sobre V27 (P3); recusa sem
`databaseAheadOfRelease` acontece antes de parar qualquer coisa; Rollback de volta para a nova funciona (4.1-A, passo 5);
Switch sem `-Apply` não exercita a trava (3.3); V27 aplicada com a release antiga no ar não a afeta (J5).

## ⚠ O que o ensaio no SERVIDOR (2026-11-18) mostrou

| # | O plano dizia | O servidor mostrou | Onde foi corrigido |
|---|---|---|---|
| S1 | Release no ar: **A CONFERIR**; `921dd90` era **[I]**; data do deploy desconhecida | **`r-921dd90…`**; Switch de **2026-11-12T17:12:43.69Z → SUCCESS 17:13:00.34Z, 16,7 s**. `.previous` = `r-8f593ef…` **[P, ensaio]** | 0, 4.3 |
| S2 | O manifesto da release no ar declara 25 sem `minSchemaVersion` **[E]** | **Observado:** `schemaVersion = 25`, `minSchemaVersion` vazio, banco em **26** **[P, ensaio]** | 4.3 |
| S3 | Inventário 3/7 **[E]** | **8 unidades, 102 equipamentos, 102 monitores a 60 s**, `falhas_para_incidente` 10 (monitor 92: 11) **[P, ensaio]**. Muda o prazo até incidente falso (10 min) e o tamanho do pior caso no grupo (102, não 7) | 3.4, E8 |
| S4 | Credencial de superusuário: presente ou ausente, **[I]** | **Existe**, 32 bytes, ACL só SISTEMA e Administradores; **lê 26** (E5) **[P, ensaio]**. Consequência: esquecer `-DatabaseUser` **não falha mais**, cai no superusuário e funciona | 1.2 |
| S5 | Grants da V27 automáticos **[P-lab; E em produção]** | Default privileges: `inframonitor_app` com `arwd` em tabelas e `rwU` em sequências **[P, ensaio]** | 3.3 |
| S6 | Três cópias de ferramental | **Cinco** **[P, ensaio]** | 2.1, 2.2, 2.3 |
| S7 | "Só se o E7 mostrou bloqueio" | **Mostrou:** `.previous` e 2 releases. **P2 necessária** **[P, ensaio]** | P2 |
| S8 | Tempo de subida no servidor: o E7 mede | O trecho **imprimiu o cabeçalho e nada**: o filtro `application*.log` não lê os `.gz` que o logback gira todo dia **[P, padrão do Spring Boot 4.1; P-lab, reproduzido]**. A resposta veio do `deployment.ndjson`: Switch completo em **16,7 s** | bloco E7 corrigido; 3.4 |
| S9 | Switch que falha desiste em 85–89 s | A falha real de **2026-11-09** levou **60,5 s**: outro caminho (health falso-negativo com o backend de pé), não o Ensaio A. O prazo vai de ~60 s a ~180 s conforme a falha | J9, 5.2 |
| S10 | — | Fila de notificações: **65 `ENVIADA`, 33 `FALHA`**. Fora do deploy: `pendencias.md`, P-01. A mensagem à equipe deixa de prometer que o alerta "chega" | 3.6 |
| S11 | Flags: motor, Telegram e manutenção ligados **[E]** | Os quatro `_ENABLED=true` (motor, Telegram, dispatcher, manutenção); **retenção ausente = desligada** **[P, ensaio]** | `estado-atual.md` |

---

## 0. De onde para onde

| | Hoje | Depois |
|---|---|---|
| Release | **`r-921dd90321db113c8faff9f8b5e16463a3d4f614`**, implantada em 2026-11-12 17:12:43Z **[P, ensaio]** | `r-c6e3f482aace95231082c730a5b6f10c8beefc5d` |
| Schema | **26** **[P, ensaio, E5 e E6]** | V27 |
| Ferramental de release | o que veio com o pacote anterior: trava antiga, que crava 25 | o do pacote novo: lê o banco **[P]** (`ReleaseTools.psm1`) |
| Motor, Telegram, dispatcher, manutenção | ligados (`_ENABLED=true`), grupo real **[P, ensaio]**; retenção desligada | iguais |

O backend muda pouco entre `921dd90` (merge do #38) e `c6e3f48`. São 11 arquivos de `src/main`, todos do modo TV, mais a
V27 e a declaração de schema. Motor, incidente, dispatcher, manutenção e autenticação **não mudaram**
**[P, `git diff --stat 921dd90 c6e3f48 -- infra-monitor-backend/src/main`]**. Que a release no ar seja a do `921dd90`
era **[I]**; o ensaio de 18/11 confirmou **[P, ensaio, E7]**.

---

## PARTE 1 — Ensaio só de leitura, dias antes da janela

**Objetivo:** provar no servidor o que a trava nova pressupõe e fechar os "A CONFERIR". Nada é parado, criado no banco
ou alterado na raiz `C:\InfraMonitor`.

**Escritas, todas fora da raiz:** baixar e descompactar o pacote em `C:\src\packages`, como na D02.10-C **[E]**, e o
transcript do ensaio na mesma pasta.

### 1.0 Variáveis e portão de ferramental (as mesmas no ensaio e na janela)

PowerShell 7, **como administrador**: os arquivos de senha só abrem para Administrators e SYSTEM **[E, D02.10-C]**.

```powershell
$Root     = 'C:\InfraMonitor'
$Pkg      = 'C:\src\packages\windows-homologation-c6e3f48'      # pacote NOVO, descompactado; nunca outro caminho
$PgHome   = 'C:\Program Files\PostgreSQL\16'                     # confirmado no E3
$Aprovado = 'c6e3f482aace95231082c730a5b6f10c8beefc5d'          # o commit aprovado: é a aprovação, não um hash de build
$Nova     = "r-$Aprovado"
$DbUser   = ([IO.File]::ReadAllText("$Root\config\secrets\DB_USERNAME")).Trim()   # papel da aplicação (1.2)
$DbPass   = "$Root\config\secrets\DB_PASSWORD"
function Ler-Sql([string]$Sql) {   # sessão psql SOMENTE LEITURA, com o papel da aplicação
  $env:PGPASSWORD = [IO.File]::ReadAllText($DbPass).Trim()
  try { & "$PgHome\bin\psql.exe" -h 127.0.0.1 -U $DbUser -d inframonitor -w -X -v ON_ERROR_STOP=1 -c 'set default_transaction_read_only = on' -c $Sql }
  finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}
# Portão de ferramental, calculado do próprio pacote no momento (nenhum hash transcrito deste documento).
# TODA chamada ao ferramental passa por 'Release', nunca por '& ...\Invoke-WindowsRelease.ps1'.
$Inv   = "$Pkg\Invoke-WindowsRelease.ps1"
$Somas = @{}; Get-Content "$Pkg\SHA256SUMS" | ForEach-Object { if ($_ -match '^([0-9a-f]{64})  (.+)$') { $Somas[$Matches[2]] = $Matches[1] } }
function Release {
  if (-not (Get-Command $Inv).Parameters.ContainsKey('DatabaseUser')) { throw "PARE: ferramental ANTIGO em $Inv (sem -DatabaseUser). Corrija `$Pkg e repita o portão." }
  foreach ($f in 'Invoke-WindowsRelease.ps1','ReleaseTools.psm1') {
    if ((Get-FileHash -Algorithm SHA256 "$Pkg\$f").Hash.ToLower() -cne $Somas[$f]) { throw "PARE: $f difere do SHA256SUMS do próprio pacote." }
  }
  & $Inv @args
}
```

- `config\secrets\DB_USERNAME` e `DB_PASSWORD` são os mesmos arquivos que o serviço lê (`configtree:` no XML do WinSW)
  **[P, `winsw.xml.template`]**. Que existam com esses nomes no servidor é **[E, D02.10-C]**.
- **A função `Release`** barra o script antigo com uma mensagem que nomeia a causa, em vez do erro de bind (2.4). Repassa
  splat, `-Apply` e `-ApprovalId` sem alteração **[P: eco dos parâmetros vinculados; o script antigo foi recusado com
  `PARE: ferramental ANTIGO…`]**.

### 1.1 Bloco de leitura E1–E9

**Para colar inteiro** no PowerShell 7 aberto como administrador. Cada passo imprime **OK** (verde) ou **RUIM**
(vermelho) e diz o que fazer. Um passo que dá erro não interrompe os seguintes. No fim, mande a saída inteira (ou o
arquivo do transcript) para revisão.

> **O resultado que PARA TUDO:** E6 diferente de **26**. Aparece como faixa vermelha `PARE TUDO`. Não marcar a janela;
> nada mais do plano vale enquanto o banco não estiver onde o `estado-atual.md` diz.

```powershell
# ================= ENSAIO DE LEITURA V27 — colar inteiro no PowerShell 7 "Executar como administrador" =================
# SÓ LÊ. Não para serviço nem site, não grava no banco, não altera C:\InfraMonitor.
# Única escrita: o transcript em C:\src\packages. Pré-requisito: pacote descompactado em $Pkg (ver 6.1).
$ErrorActionPreference = 'Continue'
$Root     = 'C:\InfraMonitor'
$Pkg      = 'C:\src\packages\windows-homologation-c6e3f48'
$PgHome   = 'C:\Program Files\PostgreSQL\16'
$Aprovado = 'c6e3f482aace95231082c730a5b6f10c8beefc5d'
Start-Transcript "C:\src\packages\ensaio-v27-$(Get-Date -Format yyyyMMdd-HHmm).txt"
function Passo($t) { Write-Host "`n==== $t" -ForegroundColor Cyan }
function Ok($m)    { Write-Host "  OK   $m" -ForegroundColor Green }
function Ruim($m)  { Write-Host "  RUIM $m" -ForegroundColor Red }
function Ver($cond, $ok, $ruim) { if ($cond) { Ok $ok } else { Ruim $ruim } }
$DbPass = "$Root\config\secrets\DB_PASSWORD"
$DbUser = try { ([IO.File]::ReadAllText("$Root\config\secrets\DB_USERNAME")).Trim() } catch { Ruim "não li DB_USERNAME: $_"; $null }
function Ler-Sql([string]$Sql) {
  $env:PGPASSWORD = [IO.File]::ReadAllText($DbPass).Trim()
  try { & "$PgHome\bin\psql.exe" -h 127.0.0.1 -U $DbUser -d inframonitor -w -X -v ON_ERROR_STOP=1 -c 'set default_transaction_read_only = on' -c $Sql }
  finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}

Passo 'E1 — o ferramental do pacote é o NOVO e confere com o próprio pacote'
try {
  $Somas = @{}; Get-Content "$Pkg\SHA256SUMS" | ForEach-Object { if ($_ -match '^([0-9a-f]{64})  (.+)$') { $Somas[$Matches[2]] = $Matches[1] } }
  $m = Get-Content -Raw "$Pkg\package-manifest.json" | ConvertFrom-Json
  foreach ($f in 'ReleaseTools.psm1','Invoke-WindowsRelease.ps1') {
    $h = (Get-FileHash -Algorithm SHA256 "$Pkg\$f").Hash.ToLower()
    Ver ($h -ceq $Somas[$f]) "$f sha256 $h (ANOTE: a janela compara com este)" "$f não confere com o SHA256SUMS do pacote. Baixar de novo."
  }
  Ver ($m.commit -eq $Aprovado) "commit do pacote = $($m.commit)" "commit do pacote = $($m.commit); esperado $Aprovado. Pasta errada: corrigir `$Pkg."
  Ver ((Get-Command "$Pkg\Invoke-WindowsRelease.ps1").Parameters.ContainsKey('DatabaseUser')) 'script aceita -DatabaseUser: ferramental novo' 'script SEM -DatabaseUser: ferramental ANTIGO. Corrigir `$Pkg.'
  Ver ($m.schemaVersion -eq 27 -and $m.minSchemaVersion -eq 26) 'schemaVersion 27, minSchemaVersion 26' "schemaVersion=$($m.schemaVersion) minSchemaVersion=$($m.minSchemaVersion): pacote errado. Não seguir."
  Import-Module "$Pkg\ReleaseTools.psm1" -Force
} catch { Ruim "E1: $_" }

Passo 'E2 — integridade de TODOS os arquivos do pacote (Verify do próprio ferramental novo)'
try {
  $v = & "$Pkg\Invoke-WindowsRelease.ps1" -Operation Verify -Root $Root -PackagePath $Pkg -DatabaseUser $DbUser -DatabasePasswordFile $DbPass
  Ver ($v.version -eq "r-$Aprovado") "Verify OK: $($v.version)" "Verify devolveu $($v.version)."
} catch { Ruim "E2: $($_.Exception.Message) — 'Checksum mismatch'/'Unexpected or missing file' = pacote incompleto: baixar de novo." }

Passo 'E3 — psql no lugar esperado'
$psqlOk = Test-Path "$PgHome\bin\psql.exe"
if ($psqlOk) { Ok (& "$PgHome\bin\psql.exe" --version) } else {
  Ruim "psql não está em $PgHome\bin. Achados (use a pasta ACIMA de bin como PgHome, e repita o bloco):"
  Get-ChildItem 'C:\Program Files\PostgreSQL' -Recurse -Filter psql.exe -ErrorAction SilentlyContinue | ForEach-Object FullName }

Passo 'E4 — arquivo de senha do superusuário (padrão do Switch se -DatabasePasswordFile faltar). Nunca imprimir o conteúdo'
$Su = "$Root\config\admin\postgres-superuser.txt"
if (Test-Path $Su) { Ok "existe, $((Get-Item $Su).Length) bytes. ACL abaixo deve ter só Administrators e SYSTEM:"; icacls $Su }
else { Ruim 'ausente. NÃO bloqueia a janela (usamos o papel da aplicação). Registrar no estado-atual. Não criar o arquivo.' }

Passo 'E5 — schema lido com o superusuário (só se o E4 achou o arquivo)'
if (Test-Path $Su) { try { Ok ("superusuário lê: " + (Get-DatabaseSchemaVersion -PostgreSQLHome $PgHome -PasswordFile $Su)) } catch { Ruim "E5: $($_.Exception.Message) — não bloqueia se o E6 der 26." } }

Passo 'E6 — schema lido com o PAPEL DA APLICAÇÃO (o que a trava vai usar)'
$E6 = $null
try { $E6 = Get-DatabaseSchemaVersion -PostgreSQLHome $PgHome -PasswordFile $DbPass -User $DbUser } catch { Ruim "E6: $($_.Exception.Message)" }
if ($E6 -eq 26) { Ok 'banco em 26' } else {
  Write-Host "`n  ############  PARE TUDO: o banco respondeu '$E6', não 26. Não marque a janela. Traga esta saída.  ############`n" -BackgroundColor DarkRed -ForegroundColor White
  Write-Host '  25 ou menos = estado-atual errado | 27 = alguém já aplicou a V27 | "Failed migration…" = migration falha no histórico'
  Write-Host '  "Could not read…" = o psql falhou (motivo na linha vermelha acima: senha, permissão, porta) | "psql not found" = volte ao E3' }

Passo 'E7 — raiz de implantação, serviço, site, flags, ACLs e TEMPO DE SUBIDA do backend'
try {
  $st = Get-Content -Raw "$Root\config\deployment-state.json" | ConvertFrom-Json; $Atual = $st.backend
  "deployment-state.json: backend=$($st.backend) frontend=$($st.frontend)"
  $cur = Get-ChildItem "$Root\current" -Force; $cur | Select-Object Name, LinkType, @{n='Target';e={@($_.Target)[0]}} | Format-Table -AutoSize | Out-String -Width 250
  foreach ($p in 'backend','frontend') { $t = [string]@(($cur | Where-Object Name -eq $p).Target)[0]
    Ver ($t -like "*\releases\$($st.$p)\$p") "current\$p aponta para a release do estado" "current\$p -> $t diverge do estado: PARE e reconcilie com o responsável (o Switch recusaria: Unexpected current link)." }
  Ver ($st.backend -eq $st.frontend) 'backend e frontend na mesma release' 'backend e frontend em releases diferentes: levar ao responsável.'
  Ver (-not ($cur | Where-Object Name -like '*.previous')) 'sem .previous' 'existe .previous: o Switch recusa. Vira o passo P2 (com aval).'
  $rel = @(Get-ChildItem "$Root\releases" -Directory); "releases\: " + ($rel.Name -join ', ')
  Ver ($rel.Count -lt 2) 'menos de 2 releases' '2 ou mais releases: o Stage recusa. Vira o passo P2 (com aval).'
  "staging\: " + ((Get-ChildItem "$Root\staging" -Directory -ErrorAction SilentlyContinue).Name -join ', ')
  Get-Content -Raw "$Root\releases\$Atual\release-manifest.json" | ConvertFrom-Json | Select-Object version, schemaVersion, minSchemaVersion | Format-List | Out-String
  '--- cópias de ferramental no disco (só a de $Pkg deve ser usada):'
  Get-ChildItem C:\src\packages, "$Root\staging" -Recurse -Filter ReleaseTools.psm1 -ErrorAction SilentlyContinue | Get-FileHash | Select-Object Hash, Path | Format-Table -AutoSize | Out-String -Width 250
} catch { Ruim "E7 (raiz): $_" }
try {
  Import-Module WebAdministration
  $phys = (Get-Website -Name InfraMonitor).physicalPath
  Ver ($phys -ieq "$Root\current\frontend") "site aponta para $phys" "site aponta para $($phys): levar ao responsável."
} catch { Ruim "E7 (IIS): $_" }
try {
  $svc = Get-CimInstance Win32_Service -Filter "Name='InfraMonitorBackend'"; $svc | Select-Object State, StartName, PathName | Format-List | Out-String -Width 250
  Ver ($svc.State -eq 'Running') 'serviço Running' "serviço $($svc.State): PARE."
  '--- flags no XML e nomes em config\secrets (o configtree também injeta flags):'
  Select-String -Path "$Root\config\service\InfraMonitorBackend.xml" -Pattern '_ENABLED|shutdown|stoptimeout|onfailure' | ForEach-Object Line
  (Get-ChildItem "$Root\config\secrets").Name -join ', '
  '--- ACLs: frontend e backend da release atual, staging e raiz (o Switch NÃO ajusta ACL):'
  icacls "$Root\releases\$Atual\frontend"; icacls "$Root\releases\$Atual\backend"; icacls "$Root\staging"; icacls "$Root"
  '--- tempo de subida do backend: logs\backend, INCLUSIVE os .gz que o logback gira todo dia (guarda 7 dias):'
  $arqs = @(Get-ChildItem "$Root\logs\backend" -File -Filter 'application.log*' | Sort-Object LastWriteTime)
  $partidas = foreach ($a in $arqs) {
    $fs = [IO.FileStream]::new($a.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite); $rd = $null
    try {
      $st = if ($a.Name -like '*.gz') { [IO.Compression.GZipStream]::new($fs, [IO.Compression.CompressionMode]::Decompress) } else { $fs }
      $rd = [IO.StreamReader]::new($st)
      while ($null -ne ($l = $rd.ReadLine())) {
        if ($l -match 'Started InfraMonitorApplication in ([0-9.]+) seconds') { '{0}  subiu em {1,7} s  ({2})' -f ($l -split '\s+', 2)[0], $Matches[1], $a.Name }
      }
    } finally { if ($rd) { $rd.Dispose() }; $fs.Dispose() }
  }
  if ($partidas) { $partidas | Select-Object -Last 5 }
  else { Ruim "nenhuma partida nos $($arqs.Count) arquivo(s) de logs\backend: a última subida é mais velha que a retenção do log. Vale o deployment.ndjson abaixo." }
  $arqs | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize | Out-String -Width 200
  '--- deployment.ndjson: duração de cada operação, START → SUCCESS/FAILED (inclui parada, subida e health):'
  if (Test-Path "$Root\logs\deployment.ndjson") {
    $ini = $null
    foreach ($e in Get-Content "$Root\logs\deployment.ndjson" | ForEach-Object { try { $_ | ConvertFrom-Json } catch { } }) {
      if ($e.event -eq 'START') { $ini = $e }
      elseif ($ini -and $e.event -in 'SUCCESS', 'FAILED') {
        $t0 = ([DateTime]$ini.utc).ToUniversalTime(); $t1 = ([DateTime]$e.utc).ToUniversalTime()
        '{0:yyyy-MM-ddTHH:mm:ss.ffZ}  {1,-8} {2,-7} {3,7:N2} s  {4}' -f $t0, $ini.operation, $e.event, ($t1 - $t0).TotalSeconds, $ini.version
        $ini = $null
      }
    }
    '--- deployment.ndjson (últimas 10, cruas):'
    Get-Content "$Root\logs\deployment.ndjson" -Tail 10
  }
  else { Ruim 'deployment.ndjson ausente: nenhuma operação do ferramental registrada nesta raiz. Levar ao responsável.' }
} catch { Ruim "E7 (serviço, flags, ACL, logs): $_" }

Passo 'E8 — banco: histórico, inventário, monitores, fila, incidentes, manutenção, privilégios'
Ler-Sql "select version, success, installed_on from flyway_schema_history where version is not null order by installed_rank desc limit 3"
Ler-Sql "select (select count(*) from unidade where deleted_at is null) unidades, (select count(*) from unidade where deleted_at is null and ativo) unidades_ativas, (select count(*) from equipamento where deleted_at is null) equipamentos, (select count(*) from equipamento where deleted_at is null and ativo) equipamentos_ativos"
Ler-Sql "select id, ativo, intervalo_segundos, falhas_para_incidente, sucessos_para_recovery from monitor order by id"
Ler-Sql "select status, count(*) from notificacao group by status"
Ler-Sql "select count(*) incidentes_abertos from incidente where status = 'ABERTO'"
Ler-Sql "select id, status, inicio_previsto, fim_previsto from manutencao_agendada where status in ('AGENDADA','ATIVA') order by inicio_previsto"
Ler-Sql "select count(*) em_manutencao from equipamento where em_manutencao"
Ler-Sql "select has_table_privilege(current_user,'flyway_schema_history','SELECT') sel, has_table_privilege(current_user,'flyway_schema_history','INSERT') ins"
Ler-Sql "select pg_get_userbyid(defaclrole) dono, defaclobjtype tipo, defaclacl from pg_default_acl"
Stop-Transcript
# E9 (opcional, fora do bloco): pré-requisitos com o ferramental novo — ver o texto do plano, exige o SHA do WinSW.
```

**Como ler o E7 e o E8 (o que o bloco não decide sozinho):**
- `release-manifest` da release atual com `schemaVersion` 25 e sem `minSchemaVersion`: esperado, empacotado pela trava
  antiga **[P, ensaio 18/11: `r-921dd903…`, 25, vazio, com o banco em 26]**.
- ACLs: o `RX` de `IIS AppPool\InfraMonitor` e `IUSR` no frontend atual vira o J4. Se a conta `NT SERVICE\InfraMonitorBackend`
  aparece com leitura em `releases\<atual>\backend` **e não** em `staging` nem na raiz, a release nova sairia sem leitura
  para o serviço: o backend não subiria depois da troca (o caso da Parte 4.1-B). Nesse caso, replicar também essa ACL
  no J4 **[I: o Switch faz `Move-Item` e não toca em ACL, P; o efeito no serviço não foi exercitado]**.
- Tempo de subida: se alguma partida passou de **60 s**, o Switch pode desistir antes de o backend ficar pronto (o prazo
  do health vai de ~60 s a ~180 s conforme a falha, J9). Levar ao responsável antes de marcar a janela. A duração do
  `Switch` no `deployment.ndjson` já inclui parada, subida e health: **16,7 s em 12/11** **[P, ensaio]**.
- **Por que o trecho de subida saiu vazio em 18/11, e o que mudou:** o serviço grava em `logs\backend\application.log`
  **[P, `winsw.xml.template`]**, e o logback do Spring Boot gira o arquivo **todo dia** para
  `application.log.AAAA-MM-DD.N.gz` **[P, `file-appender.xml` do `spring-boot-4.1.0.jar`:
  `${LOG_FILE}.%d{yyyy-MM-dd}.%i.gz`]**, guardando 7 dias (`max-history=7`). A última partida foi em 12/11; em 18/11 a
  linha `Started InfraMonitorApplication` estava num `.gz`, e o filtro `application*.log` só pegava o arquivo do dia, sem
  a partida. O `Select-String` não acha nada e não reclama: cabeçalho e nada **[P-lab: reproduzido com um `.gz` real do
  mesmo formato; o bloco antigo imprimiu só o cabeçalho, o novo leu a partida de dentro do `.gz`]**. O bloco novo lê os
  `.gz`, **diz RUIM** quando não acha partida (em vez de silêncio) e calcula a duração de cada operação do
  `deployment.ndjson`, que não gira e não expira. *Limite que continua:* partida mais velha que 7 dias não está em log
  nenhum; o ndjson é a fonte permanente. Que a causa no servidor foi esta é **[I]**: o transcript mostraria a lista dos
  arquivos de `logs\backend`, que o bloco antigo não imprimia.
- E8 **OK:** inventário 8/102 e 102 monitores **[P, ensaio, 18/11]** (mudança grande daqui em diante = levar ao
  responsável); nenhuma notificação em `ENVIANDO`; `pg_default_acl` do `inframonitor_owner` com DML de
  `inframonitor_app` em tabelas (`r`) e USAGE/SELECT/UPDATE em sequências (`S`).
- Levar para a janela: `intervalo_segundos` × `falhas_para_incidente` (prazo até um incidente falso, 3.4) e as janelas de
  manutenção previstas (P4).

**E9 (opcional) — pré-requisitos com o ferramental novo.** Só lê **[P, `Test-WindowsPrerequisites`]**. Preencher os três
valores entre `<>` e rodar depois do bloco:

```powershell
$Sid   = ([Security.Principal.NTAccount]'NT SERVICE\InfraMonitorBackend').Translate([Security.Principal.SecurityIdentifier]).Value
& "$Pkg\Invoke-WindowsRelease.ps1" -Operation Prerequisites -Root $Root -JavaHome '<JAVA_HOME do XML>' -ServiceSid $Sid -WinSWExecutable '<executável do PathName, E7>' -WinSWSha256 '<SHA aprovado na D02.10-C>' -PostgreSQLHome $PgHome -DatabaseUser $DbUser -DatabasePasswordFile $DbPass
```
**OK:** `Java=21; IISModules=present; SecretACL=checked`.

### 1.2 Papel do banco para a trava

**Decidido pelo responsável [E]: papel da aplicação nesta implantação.** A consulta precisa só de `SELECT` em
`flyway_schema_history` **[P, `Get-DatabaseSchemaVersion`]**. O backup exigia `postgres` por causa do
`pg_dumpall --globals-only` **[P, `ops/Backup-InfraMonitorDatabase.ps1`]**; a trava herdou o padrão sem precisar dele.

- **Como:** toda chamada passa `-DatabaseUser` (conteúdo de `config\secrets\DB_USERNAME`) e
  `-DatabasePasswordFile C:\InfraMonitor\config\secrets\DB_PASSWORD`, via `@Comum` **[P, `Invoke-WindowsRelease.ps1`]**.
- **Circularidade aceita [E]:** a trava confere o banco com a credencial da própria aplicação, que também pode escrever
  em `flyway_schema_history` pelos default privileges **[P-lab: com os grants da D02.10-C reproduzidos, `sel=t, ins=t`;
  em produção, os default privileges do E8 dão `arwd` em tabelas ao `inframonitor_app` (P, ensaio 18/11)]**.
- **Se o parâmetro for esquecido:** cai no padrão `postgres`. **Em produção isso funciona:** o arquivo do superusuário
  existe (32 bytes, ACL só SISTEMA e Administradores) e o E5 leu `26` com ele **[P, ensaio 18/11]**. Deixou de ser
  pressuposto: é o único caminho do deploy que nunca tinha sido exercitado nesta máquina, e foi. Esquecer o parâmetro,
  então, não falha: a trava lê o mesmo número com outra credencial. Os casos de recusa (arquivo ausente →
  `Could not find file`; senha errada → `Could not read flyway_schema_history`, sempre **antes de parar qualquer coisa**)
  ficam como comportamento provado **[P-lab]**, não como o que vai acontecer aqui. A função `Release` e o `@Comum` seguem
  passando `-DatabaseUser`, pela decisão da 1.2 e pela rede contra o ferramental antigo (2.3, item 3).
- **Papel só-leitura:** depois desta implantação, num PR que também troque o padrão do parâmetro.
- **Pré-condição para a janela:** o E6 dar `26`.

### 1.3 O que o ensaio fecha no `estado-atual.md`

| Campo do `estado-atual.md` | Fechado por |
|---|---|
| Release no ar (backend e frontend) | **E7**: `deployment-state.json` + alvo de `current\backend` e `current\frontend` |
| Schema, versão máxima exata | **E6** (número) + **E8** (últimas 3 linhas do `flyway_schema_history`, com data) |
| Demais flags, valor de cada variável | **E7**: `_ENABLED` no XML **e** nomes em `config\secrets`. Variável ausente nos dois = padrão desligado **[P, `application.yml`]** |
| Inventário (contagem exata) | **E8** |
| *novo:* Caminho do PostgreSQL | **E3** |
| *novo:* Arquivo do superusuário (presente/ausente, ACL) | **E4** (+ E5) |
| *novo:* `.previous` e número de releases | **E7** |
| *novo:* Cópias de ferramental no disco, com hash | **E7** |
| *novo:* Ferramental da janela (hash calculado no ensaio) | **E1** |
| *novo:* Tempo de subida do backend no servidor | **E7** |
| *novo:* ACL do frontend, do backend e do staging | **E7** |

O commit do ensaio altera **só** o `estado-atual.md`, com data, quem conferiu e "ensaio só leitura".

**Executado em 2026-11-18.** Fechou: release, schema, histórico do Flyway, flags, inventário, superusuário,
`.previous`/releases, cópias de ferramental. **Ainda abertos** (no transcript, não transcritos; ou não medidos):
`estado-atual.md`, seção "Ainda aberto depois do ensaio". O tempo de subida **não** saiu do E7 (defeito, corrigido acima);
veio do `deployment.ndjson`. O registro foi um commit só do `estado-atual.md`; as correções deste plano e o
`pendencias.md` vieram em commits separados, no mesmo PR.

---

## PARTE 2 — Qual ferramental vai rodar

### 2.1 O mecanismo

**[P]:**
- `package.py` copia `ReleaseTools.psm1`, `Invoke-WindowsRelease.ps1` e os dois modelos para a **raiz do pacote**;
- `Invoke-WindowsRelease.ps1` faz `Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force`. A trava que roda
  é a que está **ao lado do script executado**, não a do pacote passado em `-PackagePath`.

**Mais uma cópia a cada implantação [P, P-lab].** O `Stage` copia o pacote **inteiro** para `staging\<versão>\`, ferramental incluído. O
`Switch` move para `releases\` só `staging\<versão>\releases\<versão>`. O resto do staging fica no disco, com o
ferramental, e **incompleto** (o J8 de uma nova tentativa não pode mais usá-lo: ver J8).

**O rollback também depende disso [P: `Test-RollbackCompatibility` em `7060e28`].** O ferramental antigo **não lê o
banco**. Exige `-SchemaVersion 25` e prova com `schemaVersion: 25`. Com o banco em 27, **recusa** a declaração honesta
(`Schema compatibility not proven`) e **aceita** a mentira (`25`).

### 2.2 Onde ficam as cópias

**São cinco no disco hoje, não três [P, ensaio 18/11, E7]** (`ReleaseTools.psm1`, SHA-256 com o prefixo lido no
servidor), e a janela cria a sexta:

| Cópia | Caminho | SHA-256 | O que é |
|---|---|---|---|
| **nova** (a única a usar) | `C:\src\packages\windows-homologation-c6e3f48\` | `D5E1B3C5…` | download do ensaio (6.1); confere com o blob de `c6e3f48` (`d5e1b3c5…`) **[P]** |
| antiga, implantação do #38 | `C:\src\packages\windows-homologation-921dd903\` | `4D353534…` | trava antiga (crava 25); = blob de `921dd90`/`7060e28` **[P]** |
| antiga, staging do #38 | `C:\InfraMonitor\staging\r-921dd903…\` | `4D353534…` | sobra do `Stage` de 12/11 |
| antiga, D02.10-C | `C:\src\packages\windows-homologation-8f593ef\` | `CAB53060…` | ferramental de 09/11 |
| antiga, staging da D02.10-C | `C:\InfraMonitor\staging\r-8f593ef…\` | `CAB53060…` | sobra do `Stage` de 09/11 |
| *nova, depois do Stage* | `C:\InfraMonitor\staging\r-c6e3f482…\` (incompleta depois do Switch) | `D5E1B3C5…` | criada pelo J3 |

*`CAB53060…` × `cab5306d…`:* o blob de `8f593ef` tem `cab5306d0d4d…` **[P]**, a versão **anterior** à correção do health
no PowerShell 7 (`4e8a9af`). Sete caracteres iguais e o oitavo diferente: **[I]** mesmo arquivo, prefixo transcrito com
um caractere trocado. Se for, as duas cópias de 09/11 têm o health que **reprova backend saudável** (2.4 e 5.2): mais um
motivo para nunca rodá-las. Conferir o hash inteiro no transcript.

### 2.3 Como não depender da memória do operador

1. **Um caminho, uma vez.** `$Pkg` é definido no bloco 1.0. **Toda** chamada é `Release …`, inclusive Rollback e
   Health. Nunca `cd` + `.\Invoke-…`, nunca o `staging`.
2. **Portão calculado no momento** (1.0 e E1): o ferramental confere com o `SHA256SUMS` do próprio pacote, o commit do
   manifesto é o aprovado, o script aceita `-DatabaseUser` e o manifesto declara `minSchemaVersion`. Na janela (J1), o
   hash calculado é comparado com o **hash calculado no ensaio** (transcript do E1), não com um número deste documento.
3. **Armadilha de parâmetro** (rede de segurança por baixo da função `Release`): toda chamada passa `-DatabaseUser` e
   `-DatabasePasswordFile`. O script antigo **falha no bind, antes de executar qualquer linha** **[P, 2.4]**.
4. **Depois da implantação**, numa revisão humana (regra da D02.10), arquivar fora de `C:\src\packages` os pacotes antigos
   e as sobras de `staging\`: as **quatro** cópias antigas da 2.2 e a sobra do staging da V27. Também libera espaço no
   volume do banco (`pendencias.md`, P-03).

**No código, para o próximo PR (recomendação; não implementado):**
- `package-manifest.json` ganha `"toolingFormat": 2`, e o módulo declara a mesma constante;
- no `Stage` e no `Switch`, o módulo compara o hash do **próprio arquivo** com o `files['ReleaseTools.psm1']` do manifesto;
  se diferir, recusa: "rode o `Invoke-WindowsRelease.ps1` de dentro do pacote";
- no `Rollback`, exige `toolingFormat >= 2`;
- **novo, pelo ensaio:** o `catch` do `Invoke-ReleaseOperation` grava no `deployment.ndjson` só `errorType`, e relança
  uma mensagem genérica. Gravar também a mensagem original (`Health failed…`, `Junction target missing`…) e a fase
  (antes/depois da troca de junções). Hoje o operador só descobre o caso olhando as junções.
- **novo, pelo ensaio:** a espera do health desiste em ~85 s **[P-lab]**, sem relação com o tempo de subida real.
  Tornar o prazo um parâmetro e registrar o tempo medido.

### 2.4 A mensagem que o operador vê com a cópia errada

Reproduzido com o `Invoke-WindowsRelease.ps1` do pacote `921dd90` (ferramental `4d353534…` = `7060e28`) **[P]**:

| Chamada com ferramental antigo | Mensagem exata | Aponta a causa? |
|---|---|---|
| `Verify` com `-DatabaseUser` (E2) | `Invoke-WindowsRelease.ps1: A parameter cannot be found that matches parameter name 'DatabaseUser'.` | Em parte. Diz que o script não conhece o parâmetro; não diz "ferramental velho" |
| `Switch … @Comum` | idem, `'DatabaseUser'` | idem |
| `Rollback … @Comum` | `…matches parameter name 'DatabasePasswordFile'.` | idem; e o nome **muda** conforme a ordem do hashtable |
| `Verify` sem os parâmetros de banco | `Invalid package manifest` | **Não.** Sugere pacote corrompido |
| Rollback honesto (`-SchemaVersion 27`) | `Schema compatibility not proven` **[P, leitura]** | Não |
| Rollback com `-SchemaVersion 25` e prova 25 | **aceita** **[P, leitura]** | — é o risco |
| **qualquer chamada pela função `Release`** | `PARE: ferramental ANTIGO em <caminho> (sem -DatabaseUser). Corrija $Pkg e repita o portão.` **[P]** | **Sim** |

O erro de bind acontece antes de o script executar qualquer linha: nada é lido, parado ou gravado **[P: semântica de bind
do PowerShell; a pasta de teste ficou vazia]**. **A rede funciona, mas a mensagem confunde**: por isso a função `Release`.

**Texto proposto para a versão nova do código** (a antiga não muda): separar a condição combinada do
`Test-PackageIntegrity` em "schema/format que este ferramental não entende — você provavelmente está rodando o
ferramental de um pacote antigo" e "identidade inválida (commit/versão/historyGuard)".

---

## PARTE 3 — A sequência

### Preparação, antes do dia (não para nada)

| # | O quê | Como saber que deu certo |
|---|---|---|
| P1 | Bloco E1–E8 completo, `estado-atual.md` atualizado | nenhum RUIM sem ação; E6 = 26 |
| P2 | **Necessária: o E7 de 18/11 mostrou `.previous` e 2 releases [P, ensaio].** Remover os `.previous` e tirar a release mais velha (`r-8f593ef…`) de `releases\` (abaixo), com aval | `current\` só com `backend` e `frontend`; `releases\` com 1 diretório (`r-921dd903…`) |
| P3 | ~~Provar o jar antigo sobre V27~~ **Feito no laboratório [P-lab]**: subiu em 10,5 s e 15,1 s, sem WARN nem ERROR, login 200 (Parte 5) | — |
| P4 | Escolher a hora: nenhuma janela de manutenção começando ou terminando entre T−15 min e T+30 min (E8) | consulta do E8 vazia nesse intervalo |
| P5 | ID de aprovação, ex.: `D02.12-V27-AAAA-MM-DD-<responsável>` | — |
| P6 | Mandar o aviso à equipe (3.6) | mensagem enviada |

**P2 (necessária, ensaio de 18/11).** Mutação manual, exige o aval do responsável. Não toca no que está no ar: o IIS e o serviço usam
`current\backend` e `current\frontend` **[P: `physicalPath` e `<workingdirectory>`]**.

```powershell
# remove só o LINK (rmdir de junção não segue o alvo; P-lab); nunca Remove-Item -Recurse
cmd /c rmdir "C:\InfraMonitor\current\backend.previous"
cmd /c rmdir "C:\InfraMonitor\current\frontend.previous"
# release mais velha (a que NÃO é $Atual): mover, não apagar
New-Item -ItemType Directory C:\InfraMonitor-arquivo -Force | Out-Null
Move-Item "C:\InfraMonitor\releases\<release mais velha>" C:\InfraMonitor-arquivo\
```

### A janela

Antes de tudo: `Start-Transcript "$Root\logs\implantacao-v27-$(Get-Date -f yyyyMMdd-HHmm).txt"` e o bloco 1.0. Depois:

```powershell
$Sid   = ([Security.Principal.NTAccount]'NT SERVICE\InfraMonitorBackend').Translate([Security.Principal.SecurityIdentifier]).Value
$WinSW = '<executável do PathName, E7>'
$Atual = (Get-Content -Raw "$Root\config\deployment-state.json" | ConvertFrom-Json).backend
$Aprov = '<ID da P5>'
$Comum = @{ Root=$Root; ServiceName='InfraMonitorBackend'; SiteName='InfraMonitor'; ServiceSid=$Sid; WinSWExecutable=$WinSW;
            PostgreSQLHome=$PgHome; DatabaseUser=$DbUser; DatabasePasswordFile=$DbPass }
```

**J1 — Portão.** O E1 e o E6 de novo (copiar do bloco 1.1).
- **OK:** todas as linhas do E1 verdes, o hash do `ReleaseTools.psm1` **igual ao anotado no ensaio**, e banco `26`.
- **Hash diferente do ensaio:** o pacote foi trocado ou regerado. Não é necessariamente adulteração: ver 6.2. Parar e
  conferir com o responsável antes de seguir.
- **Falhou:** parar. Nada foi tocado.

**J2 — Espaço.** `Release -Operation Space -PackagePath $Pkg @Comum`
- **OK:** `ProjectedFreeBytes` acima de 22 GiB. **Falhou:** `Projected free space below 22 GiB`. Parar.

**J3 — Stage.** `Release -Operation Stage -PackagePath $Pkg -Apply -ApprovalId $Aprov @Comum`. Pede confirmação
(`ConfirmImpact High`); responder `Y`.
- **OK:** `Staged = r-c6e3f482…` **[P-lab]**.
- **Falhou:** `Staging already exists` (sobra de tentativa anterior: revisar) ou `Previous release must be reviewed
  manually` (a P2 não foi feita). Nada no ar mudou.

**J4 — ACL do frontend novo (e do backend, se o E7 indicou)**, antes do Switch. O Switch não ajusta ACL **[P]**. Release
sem RX para o IIS = site 500 **[I, como o incidente 4 da D02.10-D]**. Replicar **exatamente** as concessões que o E7
mostrou em `releases\$Atual\frontend` (esperado pela D02.10-D **[E]**):

```powershell
icacls "$Root\staging\$Nova\releases\$Nova\frontend" /grant "IIS AppPool\InfraMonitor:(OI)(CI)RX" "IUSR:(OI)(CI)RX"
icacls "$Root\staging\$Nova\releases\$Nova\frontend"
```

- **OK:** as duas entradas aparecem. O `Move-Item` do Switch é no mesmo volume e preserva a ACL **[I; o laboratório não
  tinha IIS para conferir]**.

> **Substituído em 2026-11-18 pelo passo 4 de `janela-v27-2026-11-19.md`.** O comando abaixo (o do README) conecta como
> `inframonitor_owner` e põe a senha **na linha de comando**; a senha do owner não está registrada. O roteiro aplica a
> V27 com o Flyway como `postgres` + `SET ROLE inframonitor_owner` em cada conexão (`spring.flyway.init-sqls`),
> senhas só em variável de ambiente. Sem o `SET ROLE`, as tabelas nascem do `postgres`, **sem grant**, e o
> `inframonitor_app` não as acessa **[P-lab, prova de reversão no roteiro]**.

**J5 — Aplicar a V27**, com o backend antigo **ainda no ar** na 8080. Comando do passo 2 da V26 no README do backend, com
`--spring.flyway.target=27` e o `app.jar` em `$Root\staging\$Nova\releases\$Nova\backend\app.jar`.

**Pré-condição:** as seis variáveis `*_ENABLED='false'` no **mesmo** console. Sem elas, um segundo motor e um segundo
dispatcher subiriam contra produção.

- **OK:** `Successfully applied 1 migration to schema "public", now at version v27`, depois
  `Started InfraMonitorApplication`. Então Ctrl+C **[P-lab: V27 aplicada em 0,03 s; o jar novo subiu como owner; a release
  antiga seguiu respondendo durante e depois]**.
- **`Port 18080 was already in use` depois de "applied":** um java de tentativa anterior ficou vivo. A V27 já foi aplicada
  (conferir no J6). Encerrar o processo na 18080 e seguir **[P-lab: aconteceu no laboratório por um processo-filho que
  sobreviveu]**.
- **Falhou** (exceção ou nenhuma linha de "applied"): Ctrl+C. **Produção não foi tocada.** O Flyway roda cada migration
  numa transação: uma V27 que falha volta inteira **[I: DDL transacional]**. Conferir com o E6; se der `26`, a janela
  termina aqui.

**J6 — Conferir a V27 e os grants** (3.3). Depois: `Get-DatabaseSchemaVersion … -User $DbUser` → **`27`** **[P-lab]**.

**J7 — Prova de compatibilidade**, em `C:\InfraMonitor\config\admin\prova-v27.json`:

```json
{ "approved": true, "schemaVersion": 27,
  "current": { "backend": "<$Atual>", "frontend": "<$Atual>" },
  "target":  { "backend": "r-c6e3f482aace95231082c730a5b6f10c8beefc5d", "frontend": "r-c6e3f482aace95231082c730a5b6f10c8beefc5d" },
  "approvedBy": "<responsável>", "evidence": "ensaio <data>; V27 aplicada <hora>" }
```

> ### ⚠ O Switch sem `-Apply` NÃO testa a trava
> Ele devolve `DryRun = True` **antes** de ler a prova e o banco. No ensaio, devolveu `DryRun = True` com prova de
> `schemaVersion` errado, com `-SchemaVersion` diferente do banco **e com um arquivo de prova que não existe**
> **[P-lab; P, `if (-not $Apply) { return … DryRun }` vem antes da leitura]**. Um "ensaio" com dry-run produz confiança
> falsa. **A pré-checagem é o J8**, que no mesmo cenário recusou com `Operator schema declaration does not match the
> database` e `Schema compatibility not proven` **[P-lab]**.

**J8 — Pré-checagem da trava, sem parar nada.** As mesmas funções que o Switch chama, só leitura:

```powershell
Import-Module "$Pkg\ReleaseTools.psm1" -Force
$db     = Get-DatabaseSchemaVersion -PostgreSQLHome $PgHome -PasswordFile $DbPass -User $DbUser
$prova  = Get-Content -Raw "$Root\config\admin\prova-v27.json" | ConvertFrom-Json -AsHashtable
$estado = Get-Content -Raw "$Root\config\deployment-state.json" | ConvertFrom-Json -AsHashtable
# 1a tentativa: o alvo está no staging. Nova tentativa (depois de 4.1-B): já está em releases\, e o staging ficou incompleto.
$alvo   = if (Test-Path "$Root\releases\$Nova") { Test-ReleaseIntegrity "$Root\releases\$Nova" } else { Test-PackageIntegrity "$Root\staging\$Nova" }
Test-RollbackCompatibility $prova $estado $alvo 'Both' 27 $db; 'TRAVA OK'
```

- **OK:** `TRAVA OK` **[P-lab, nas duas formas]**.
- **Falhou:** a mensagem diz qual condição: operador × banco, prova, `minSchemaVersion`, par de releases. Corrigir a prova.
  Nada foi parado.

**J9 — Switch.**

```powershell
Release -Operation Switch -PackagePath $Pkg -Component Both -CompatibilityProof "$Root\config\admin\prova-v27.json" -SchemaVersion 27 -Apply -ApprovalId $Aprov @Comum
```

- **OK:** termina sem exceção; `deployment.ndjson` ganha `START` e `SUCCESS`; `deployment-state.json` passa a `$Nova`.
  No laboratório, o site ficou parado **22 s** **[P-lab]**.
- **Falhou — dois tipos, com consequências opostas [P, ordem do código; P-lab]:**
  - **Antes de parar** (trava, prova, banco, IIS, serviço, junções): a mensagem é a da causa (ex.:
    `Could not read flyway_schema_history`). Nada foi parado; o site e o motor seguem na release antiga.
  - **Depois de parar:** `Release operation failed; preserve stopped site and review evidence. No migration rollback was
    attempted.` A mensagem **não diz a causa** e o `deployment.ndjson` grava só `"errorType":"RuntimeException"`.
    O script desiste do health depois de 12 tentativas; **quanto tempo depende de como cada uma falha** (abaixo). O site
    fica parado. O backend pode estar parado **ou de pé
    com a release nova**, se ela terminou de subir depois que o script desistiu **[P-lab]**; nesse caso, com motor e
    Telegram ligados, ela já está coletando e alertando. Ir **direto** ao 4.1-B, que descobre o caso sozinho.

**Quanto tempo o Switch leva para desistir.** O laço é `for 12 × { Test-BackendHealth (TimeoutSec 10); se falhar,
Start-Sleep 5 }`, depois da parada e da troca **[P, `ReleaseTools.psm1`, igual em `8f593ef` e `c6e3f48`]**. Então:
desistência ≈ parada + 12 × (duração de uma tentativa + 5 s).

| Como cada tentativa falha | Duração de uma tentativa | Desiste em | Fonte |
|---|---|---|---|
| Na hora: backend de pé com resposta que a trava reprova (corpo ilegível, `DOWN`, HTTP ≠ 200) | ~0 s | **~60 s** | **[P, produção, 09/11: 60,5 s]**, ver 5.2 |
| Porta fechada (backend ainda subindo ou morto), no Windows | ~2 s (o Windows repete a conexão recusada) | **~85–89 s** | **[P-lab, Ensaio A]** |
| Porta aberta sem resposta (backend travado) | até 10 s (`TimeoutSec`) | **até ~180 s** | **[I, código]** |

Com `-Component Both`, somar a parada graciosa do serviço (até 45 s, `WaitForStatus`). O caso esperado de uma subida
lenta é o da porta fechada. *Por que importa:* o operador não deve concluir pela duração qual foi a causa; a 4.1-B
descobre o estado pelas junções, não pelo tempo.

**J10 — Conferência imediata** (3.5). **J11 —** `Stop-Transcript`; atualizar o `estado-atual.md` (release, schema 27,
data, quem) no commit que registra a implantação.

### 3.2 A V27 antes ou depois do Switch?

**Recomendo V27 primeiro (J5) e Switch depois (J9).** A trava aceita os dois, porque o pacote declara
`minSchemaVersion: 26` **[P]**. Aplicar a V27 depois também funciona: o PUT responde 503 até a tabela existir **[P, teste
`semTabelaGetPadroesPutIndisponivel`]**.
- **Falha na V27 não custa parada:** acontece com a release antiga no ar e o motor coletando.
- **A trava vira portão da V27:** banco com migration falha faz o Switch recusar **antes** de parar qualquer coisa.
- **Um estado só para conferir** depois do Switch.

O custo é a release antiga rodar alguns minutos sobre o banco em 27. **[P-lab]**: ela seguiu respondendo durante e
depois do J5, e também **subiu do zero** sobre a V27 (P3).

### 3.3 Grants da V27

A V27 cria duas tabelas e **uma** sequência (`configuracao_modo_tv_id_seq`) **[P, `V27__…sql`]**. Conferência (J6):

```sql
select version, success from flyway_schema_history where version in ('26','27') order by version;   -- 26|t e 27|t
select has_table_privilege('inframonitor_app','configuracao_modo_tv','SELECT,INSERT,UPDATE,DELETE');        -- t
select has_table_privilege('inframonitor_app','configuracao_modo_tv_tela','SELECT,INSERT,UPDATE,DELETE');   -- t
select has_sequence_privilege('inframonitor_app','configuracao_modo_tv_id_seq','USAGE,SELECT');            -- t
select count(*) from configuracao_modo_tv;                                                                  -- 0
```

Se algum vier `f`, **como `inframonitor_owner`**, não como superusuário:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON configuracao_modo_tv, configuracao_modo_tv_tela TO inframonitor_app;
GRANT USAGE, SELECT ON SEQUENCE configuracao_modo_tv_id_seq TO inframonitor_app;
```

**O esperado é tudo `t` sem GRANT** **[P-lab com os default privileges da D02.10-C reproduzidos; P, ensaio 18/11: o
`pg_default_acl` de produção dá `arwd` em tabelas e `rwU` em sequências ao `inframonitor_app`]**. O GRANT acima fica
como contingência.

### 3.4 Indisponibilidade, e o que acontece com o que está rodando

**Quanto tempo.** Só o J9 para alguma coisa **[P, `Invoke-ReleaseOperation`]**: `Stop-Website`, `Stop-Service`
(gracioso, até 45 s), troca das junções, `Start-Service`, health (12 tentativas, 5 s entre elas), `Start-Website`.

| | Laboratório **[P-lab]** | Servidor |
|---|---|---|
| Switch com sucesso: site parado | 22 s (subida do jar 15–16 s) | **16,7 s** do START ao SUCCESS no Switch de 12/11 (parada graciosa, subida e health incluídos; o site para logo depois do START) **[P, ensaio, `deployment.ndjson`]**. Um ponto só; com folga grande contra qualquer prazo do health |
| Rollback com sucesso: site parado | 16,5 s | não medido; mesma ordem do Switch **[I]** |
| Switch que falha: até o script desistir | 85–89 s (porta fechada) | **60,5 s** na falha real de 09/11, por outro caminho (J9, 5.2); de ~60 a ~180 s conforme a falha, mais a parada graciosa |

**Motor ICMP:**

| Pergunta | Resposta |
|---|---|
| Para? | **Sim**, junto com a JVM **[I]** |
| Perde medição? | Não grava nenhuma durante a parada: um buraco do tamanho da parada. Nada é registrado como falha **[P: medição só nasce de uma execução]** |
| A parada gera incidente? | **Não.** Incidente só abre com `falhas_para_incidente` medições **FALHA** consecutivas **[P, `IncidentProcessor.processarAbertura`]**. A ausência de medição não é falha **[E, registro anterior]** |
| Na volta | espera a primeira passada do reconciliador de manutenção (MA12) e pinga os **102** de uma vez **[P, `MonitoringScheduler`; 102 pelo ensaio]**. A capacidade para 250 a 60 s foi provada na D02.11-A.1 **[E]** |
| Incidente aberto antes da janela | continua aberto; recuperação pela regra normal **[P]** |
| Equipamento que cai **durante** a parada | o alerta é gerado atrasado, não perdido **[I]**; a entrega no Telegram é outra questão (`pendencias.md`, P-01) |

**Pode sair alerta falso no grupo do Telegram?**
- **Pela parada em si: não [P].**
- **Pelo processo novo:** só se ele não conseguir pingar (permissão, tmpdir, ICMP). Aí, após `falhas × intervalo` =
  **10 × 60 s = 10 min** (11 min no monitor 92) **[P, ensaio, E8]**, sairiam até **102** incidentes no grupo, um por
  monitor. Probabilidade baixa **[I]**: o código ICMP e de incidente é idêntico ao no ar
  **[P, diff]**. **Mitigação:** a primeira conferência do 3.5 é a das medições, dentro desse prazo.
- **Duplicata possível [P, README "at-least-once" e `releaseStaleReservations`]:** uma notificação `ENVIANDO` interrompida
  volta para a fila depois de 60 s e é reenviada. Daí o aviso à equipe (3.6).

**Silenciar o grupo durante a janela? Não.** Desligar dispatcher/Telegram exige mexer no XML e reiniciar de novo, e só
**atrasa** **[P, README]**; pôr os equipamentos em manutenção **anuncia no grupo** a entrada e a saída **[E, F3]**.

**Janela de manutenção ativa:** o estado sobrevive à parada; a primeira passada do reconciliador aplica o que o relógio
pede; início ou fim dentro da parada é anunciado com atraso; janela que começaria e terminaria dentro da parada vira
`EXPIRADA` sem anunciar **[P, `ReconciliadorManutencao`, MA08/MA27]**. Daí a P4.

**Sessões abertas:** o refresh token está em `sessao_usuario` e o `JWT_SECRET` não muda: quem está logado continua
logado **[P, `auth.interceptor.ts`]**. Abas com o JS antigo podem falhar ao navegar para uma tela ainda não carregada,
até um F5 **[I, `web.config`]**. Nenhuma TV está aberta, porque `/tv` só existe no front novo.

### 3.5 Conferência imediata

Na ordem. As duas primeiras dentro do prazo `falhas × intervalo`.

1. **Motor pingando.**
   ```powershell
   Ler-Sql "select monitor_id, status, executado_em from medicao where executado_em > now() - interval '3 minutes' order by executado_em desc"
   ```
   **OK:** uma linha por monitor ativo, depois do J9, em `SUCESSO` (salvo os já fora). **Falhou:** `FALHA` em todos com os
   equipamentos de pé → 4.1 já.
2. **Health e log.** `Release -Operation Health @Comum` → `True`. No `logs\backend\application.log`: nenhum `ERROR` desde a
   subida e nenhum `Configuracao do modo TV indisponivel`.
3. **Itens da V26** (README): login do ADMIN; cookie `inframonitor_refresh` (HttpOnly, Secure, SameSite Strict); F5 numa
   tela interna continua logado; Sair + F5 vai ao login.
4. **Modo TV, pela API:** `GET /api/v1/configuracoes/modo-tv` → 200 **[P-lab: 200 com o backend novo, 404 com o antigo]**.
   Como ADMIN, salvar → 200 e `select count(*) from configuracao_modo_tv` = 1. Um **503** = V27 ausente ou sem grant:
   voltar ao J6. Não é motivo de rollback.
5. **`/tv` atrás do IIS — nunca testado.** Rota SPA reescrita para `/index.html` **[I, `web.config.template`]**. Da estação
   da VLAN de TI: `https://<host>/tv` direto na barra; F5 em `/tv`; DevTools sem 404 nem violação de CSP; troca de tela no
   intervalo; "Dados de HH:MM" atualiza; aba em `/dashboard` não troca. `/tv` em 404 ou em branco **não** é motivo de
   rollback sozinho. Site inteiro em 500 é: provavelmente ACL (J4) → conceder RX em `releases\$Nova\frontend` e testar de
   novo antes de decidir.
6. **Notificações e incidentes** depois do J9: nada novo além de eventos reais.
7. **Registro:** `estado-atual.md` (J11).

### 3.6 Aviso à equipe (mensagem direta, antes da janela)

Não usar a funcionalidade de manutenção do sistema para isto: ela anuncia no grupo, que é o barulho que se quer evitar
(3.4). Texto para o responsável enviar, ajustando dia e hora:

> Oi, pessoal. Na **[dia], entre [hora] e [hora]**, vou atualizar o Infra Monitor (o sistema que vigia os equipamentos
> de rede e manda os alertas no grupo).
>
> - O site fica **fora do ar por alguns minutos**. Se você estiver com ele aberto, é só atualizar a página (F5) depois.
> - Nesses minutos o sistema **para de checar os equipamentos**. Se algum cair nesse meio-tempo, o alerta pode chegar
>   **com alguns minutos de atraso**.
> - Depois da atualização, pode aparecer no grupo **uma mensagem repetida** de um alerta que já tinha saído. É efeito da
>   atualização; pode ignorar.
> - Se der algum problema, posso precisar voltar a versão anterior, com **mais uma parada curta**.
>
> Se notar algo estranho depois das [hora], me avise por aqui. Obrigado!

*Por que o texto não diz mais "mas chega" (18/11):* a fila tem 33 `FALHA` em 98 **[P, ensaio]**. Enquanto o P-01 de
`pendencias.md` não for entendido, não há base para prometer entrega.

---

## PARTE 4 — Voltar atrás

### 4.1 Passo a passo, com a V27 aplicada

**Quando:** login quebrado; motor sem conseguir pingar (3.5-1); erro sistemático no log. **Não** é motivo: só o `/tv` ou
só o PUT do modo TV.

**4.1-A — o Switch terminou com SUCCESS** (estado e junções na nova; `.previous` → antiga):

1. Prova em `C:\InfraMonitor\config\admin\prova-rollback-v27.json`:
   ```json
   { "approved": true, "schemaVersion": 27, "databaseAheadOfRelease": true,
     "current": { "backend": "r-c6e3f482aace95231082c730a5b6f10c8beefc5d", "frontend": "r-c6e3f482aace95231082c730a5b6f10c8beefc5d" },
     "target":  { "backend": "<$Atual, a release anterior>", "frontend": "<$Atual>" },
     "approvedBy": "<responsável>", "evidence": "<motivo do rollback>" }
   ```
2. Com o ferramental **novo**, sem `-PackagePath`:
   ```powershell
   Release -Operation Rollback -Version $Atual -Component Both -CompatibilityProof "$Root\config\admin\prova-rollback-v27.json" -SchemaVersion 27 -Apply -ApprovalId "$Aprov-rollback" @Comum
   ```
3. **OK:** `SUCCESS`, estado de volta a `$Atual`, health UP, login funciona **[P-lab: 17,3 s; site parado 16,5 s; backend
   antigo sobre V27, login 200]**. A 3.5-1 de novo. A V27 **fica**.
4. Com o front antigo, `/tv` não existe. Uma aba com o front novo recebe 404 na configuração e mostra o aviso **[E, README]**.
5. **Para reimplantar a nova depois:** o `Switch` recusa (`Previous link is not the approved rollback target`) **[P-lab]**.
   A operação é **`Rollback -Version $Nova`** com a prova do J7 (`current` = antiga, `target` = nova, `schemaVersion` 27)
   **[P-lab: SUCCESS em 22,8 s]**.

**4.1-B — o Switch falhou depois de parar** (`Release operation failed; preserve stopped site…`).

> **⚠ Não use o bloco de recuperação abaixo: use o R1 de `janela-v27-2026-11-19.md`.** Numa segunda recuperação na
> mesma janela, `current\backend.falhou` já existe, e `Move-Item` para destino existente **move para dentro** sem dar
> erro: a junção `current\backend` vai parar dentro da release nova, apontando para a própria pasta-mãe (idem no
> frontend), e o bloco imprime "SITE NO AR" **[P-lab, 2026-11-18, reproduzido com o R1 da primeira versão do roteiro,
que tem estes mesmos dois `Move-Item`]**. O R1 usa sufixo de
> hora, confere destino livre antes de cada `Move-Item`, para no primeiro erro, e não abre o site se o Windows tiver
> religado o serviço sozinho.

O que fica para trás **[P-lab]**:
- **falha depois da troca** (o caso típico: o health não subiu a tempo): junções na nova, `.previous` na antiga,
  `deployment-state.json` ainda na antiga, site parado, e o backend novo **parado ou de pé** (subida atrasada);
- **falha antes da troca** (ex.: `Stop-Service` estourando o tempo): junções na antiga, sem `.previous`.

O Rollback **não serve** aqui, e as mensagens não ajudam **[P-lab]**:
- com a prova da 4.1-A (`current` = nova): `Compatibility proof does not match release pair`;
- com uma prova que casa com o estado (`current` = antiga): `Unexpected current link`;
- um novo Switch: `Previous link is not the approved rollback target`.

**Recuperação manual.** Colar o bloco inteiro no mesmo console da janela (bloco 1.0, `$Comum`, `$Atual`, `$Aprov` e a
função `Release` carregados). Ele descobre o caso, só move ponteiros, **espera o backend subir** antes de abrir o site e
registra o que fez **[P-lab: executado como bloco único, 14,7 s do início ao site no ar]**:

```powershell
Import-Module WebAdministration
# 1. Qual caso? Só lê.
Get-ChildItem "$Root\current" -Force | Select-Object Name, LinkType, @{n='Target';e={@($_.Target)[0]}} | Format-Table -AutoSize | Out-String -Width 300
$estado      = (Get-Content -Raw "$Root\config\deployment-state.json" | ConvertFrom-Json).backend
$alvoAgora   = [string]@((Get-Item "$Root\current\backend" -Force).Target)[0]
$temPrevious = Test-Path "$Root\current\backend.previous"
if ($alvoAgora -like "*\releases\$Nova\backend" -and $temPrevious -and $estado -eq $Atual) { $caso = 'DEPOIS-DA-TROCA' }
elseif ($alvoAgora -like "*\releases\$Atual\backend" -and -not $temPrevious) { $caso = 'ANTES-DA-TROCA' }
else { $caso = 'DESCONHECIDO' }
"CASO: $caso"
if ($caso -eq 'DESCONHECIDO') { Write-Host 'PARE: combinação inesperada de junções e estado. Não mexa em nada; chame o responsável.' -ForegroundColor Red }
else {
  # 2. Parar o serviço (pode estar de pé com a release nova, que subiu atrasada)
  Stop-Service InfraMonitorBackend
  # 3. Só no caso DEPOIS-DA-TROCA: desfazer a troca de ponteiros (sem apagar nada)
  if ($caso -eq 'DEPOIS-DA-TROCA') {
    foreach ($p in 'backend','frontend') {
      Move-Item "$Root\current\$p" "$Root\current\$p.falhou"
      Move-Item "$Root\current\$p.previous" "$Root\current\$p"
    }
  }
  # 4. Religar e ESPERAR a subida (até 3 min); só então abrir o site
  Start-Service InfraMonitorBackend
  $ok = $false
  foreach ($i in 1..36) { try { Release -Operation Health @Comum | Out-Null; $ok = $true; break } catch { Start-Sleep 5 } }
  if ($ok) { Start-Website InfraMonitor; Write-Host 'SITE NO AR com a release anterior' -ForegroundColor Green }
  else { Write-Host 'PARE: backend não subiu em 3 min. Site segue PARADO. Ler logs\backend\application.log e chamar o responsável.' -ForegroundColor Red }
  # 5. Registrar (o script de release não registra recuperação manual)
  @{ event='MANUAL_RECOVERY'; case=$caso; version=$Atual; healthy=$ok; approval="$Aprov-recuperacao"; utc=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress | Add-Content "$Root\logs\deployment.ndjson"
  Get-ChildItem "$Root\current" -Force | Select-Object Name, @{n='Target';e={@($_.Target)[0]}} | Format-Table -AutoSize | Out-String -Width 300
}
```

Depois:
- 3.5-1 a 3.5-3 (motor, health, login).
- **Tentar de novo**, se a causa foi entendida (por exemplo, subida lenta): **J8** (a forma nova, que lê `releases\`) e
  **J9**. Sem Stage: ele recusaria (`Staging already exists`, e `releases\` já tem 2) **[P-lab: TRAVA OK e Switch
  SUCCESS em seguida]**. As junções `*.falhou` não atrapalham **[P-lab]**; removê-las depois, com o responsável:
  `cmd /c rmdir "$Root\current\backend.falhou"` (e `frontend.falhou`). O `rmdir` remove só o link **[P-lab]**.
- **Não recomendo "terminar a troca à mão"** quando a nova subiu atrasada: exigiria escrever o `deployment-state.json`, que
  o script só grava depois do health. O bloco acima volta a um estado que o script reconhece.

**O que o ensaio mostrou sobre o texto anterior do 4.1-B:** o `Health` chamado uma vez lançava erro terminante e o
`Start-Website` não rodava (o site ficaria parado); o `Stop-Service`, os `Move-Item` e o `Start-Service` funcionaram como
escritos; faltavam a detecção do caso, a espera e o registro **[P-lab]**.

**Tempo e indisponibilidade da recuperação [P-lab]:**
- **Bloco corrigido:** 14,7 s, da primeira linha ao site no ar (backend antigo subiu em ~11 s).
- **Ensaio inteiro:** site parado de 1 min 40 s (bloco corrigido, sem tempo de leitura humana) a 2 min 28 s (bloco
  antigo + conclusão manual + tentativas de Rollback). Desses, **85 s são o Switch esperando o health** antes de desistir
  (caminho da porta fechada; em produção pode ser de ~60 a ~180 s, J9).
- **Sim, o sistema fica indisponível durante toda a recuperação:** o site está parado desde o início do J9 até o
  `Start-Website` do bloco. O backend fica parado durante o bloco (~15 s + subida no servidor). No servidor, somar o tempo
  de o operador ler a mensagem, decidir e colar o bloco: **minutos**.
- Monitoramento: sem medições enquanto o backend está parado; a parada não abre incidente (3.4). Se a nova subiu
  atrasada, ela coletou e alertou nesse intervalo, com o site parado.

### 4.2 Sem backup — o que isso significa aqui

**Em uma linha:** a V27 só **cria**, então o rollback não precisa de backup; o que não teria volta é um erro manual no
banco durante a janela, e por isso este plano só escreve no banco pela V27, com o Flyway.

- **O DROP opcional do README** (`DROP TABLE configuracao_modo_tv_tela; DROP TABLE configuracao_modo_tv; DELETE FROM
  flyway_schema_history WHERE version='27'`) **não faz parte deste rollback**: apaga a configuração sem volta e não é
  necessário, porque o jar antigo roda com as tabelas paradas **[P-lab]**.
- **O rollback com o ferramental velho aceita a mentira:** 2.1.
- **Switch que falha no meio:** o Rollback recusa e a volta é manual (4.1-B, ensaiada).

### 4.3 `databaseAheadOfRelease=true`

É o caso de voltar com o banco em 27: a release antiga declara `schemaVersion: 25` e nenhum `minSchemaVersion` **[P-lab
com o pacote `921dd90`; P, ensaio 18/11: o `release-manifest.json` instalado diz 25 e vazio, com o banco já em 26]**,
logo banco 27 > 25 = "banco à frente do release". Hoje o banco **já** está à frente (26 > 25) e nada recusa, porque a
trava antiga não lê o banco: é a mentira da trava, observada em produção.

**Como o operador o usa:** um campo a mais na prova do rollback (4.1-A, passo 1). É a aprovação humana de que o jar antigo
roda sobre o schema mais novo; a evidência é a P3 **[P-lab]**.

**Se esquecer [P-lab]:** `Database schema ahead of the release; explicit approval required`. **Nada é parado**: o mesmo
processo do backend novo segue (PID igual antes e depois), o site segue `Started`, nenhuma linha nova no
`deployment.ndjson`, e a API segue respondendo com a release nova. O operador acrescenta o campo e repete.

**Se usar o ferramental velho:** 2.4.

---

## PARTE 5 — Ensaios locais (2026-11-16)

### 5.1 Laboratório: o que era real e o que era simulado

| Real (código e artefatos de produção) | Simulado ou desviado |
|---|---|
| `Invoke-WindowsRelease.ps1` e `ReleaseTools.psm1` **do pacote baixado do CI** (`d5e1b3c5…`), PowerShell 7.4.6 no Windows 11 | **IIS** (`Get-Website`, `Stop/Start-Website`, binding, ARR): funções no lugar do `WebAdministration` |
| `app.jar` reais: pacote `921dd90` (release antiga, ferramental `4d353534…`) e pacote `c6e3f48` | **SCM:** o "serviço" é o `app.jar` de `current\backend` lançado com os **argumentos do `winsw.xml.template`** (configtree, Flyway desligado, porta 8080). Parada = processo encerrado na hora (sem gracioso, sem `onfailure restart`) |
| PostgreSQL 16 descartável com `inframonitor_owner`, `inframonitor_app` e default privileges da D02.10-C; V1–V26 aplicadas pelo jar antigo, V27 pelo novo | Identidade do serviço = a conta do ensaio (não `NT SERVICE\…`) |
| Junções NTFS, `Move-Item`, mutex global, `deployment-state.json`, `deployment.ndjson`, health HTTP real na 8080, login e API reais | **D1:** a trava lê `127.0.0.1:5432` fixo; aqui a 5432 era de outro PostgreSQL. Porta 55432 por `$PSDefaultParameterValues` **na sessão do módulo** (sem alterar código) |
| | **D2:** o disco desta máquina tinha 20,7 GiB livres, abaixo do portão de 22 GiB. Para Stage/Switch/Rollback, só `Test-FreeSpacePolicy` foi neutralizada na sessão do módulo, e `Invoke-ReleaseOperation` chamado direto (o script só importa e repassa). Verify e Health usaram o script real |

Scripts e saídas do laboratório ficaram fora do repositório (scratchpad da sessão); os números e mensagens deste
documento foram copiados das saídas.

### 5.2 Ensaio A — Switch falhando depois da troca de junções

**Como a falha foi provocada (1.1).** O SCM simulado atrasou em 75 s o início da release nova depois do `Start-Service`.
O script não sabe disso: ele só vê o health HTTP real da 8080 falhar 12 vezes e lança a exceção da linha do health,
**depois** de `Invoke-JunctionTransition`. **Por que é representativo:** qualquer causa depois da troca (subida lenta,
crash, ACL do backend, porta, banco) passa pelo mesmo `throw` e deixa o mesmo estado: junções novas, `.previous` antigos,
estado antigo, site parado. O atraso reproduz a causa mais provável no servidor (tempo de subida nunca medido lá; janela
de ~85 s) e a variante mais confusa: a nova **sobe depois** que o script desistiu. A segunda execução (R2) cobriu a
variante "processo vivo, ainda não pronto" quando a recuperação começa. A variante "processo morto" não foi executada; o
bloco a trata igual (`Stop-Service` sem efeito) **[I]**.

**Resultados [P-lab]:**
- Switch: `Release operation failed; preserve stopped site and review evidence. No migration rollback was attempted.`
  após 89,2 s (R1) e ~85 s (R2). `deployment.ndjson`: `START`, depois `{"errorType":"RuntimeException","operation":"Switch","event":"FAILED"}`.
- 4 s depois de o script desistir, a release nova respondia na 8080 (`modo-tv` 200), com estado antigo e site parado.
- Rollback e novo Switch: as três mensagens da 4.1-B.
- 4.1-B como estava escrito: `Stop-Service` e `Move-Item` OK; `Health` lançou
  `Invoke-WebRequest: Nenhuma conexão pôde ser feita porque a máquina de destino as recusou ativamente.` e o bloco parou;
  site ficou `Stopped`. Concluído à mão: backend antigo UP 21 s depois do `Stop-Service`.
- 4.1-B corrigido (R2, laboratório refeito do zero): `CASO: DEPOIS-DA-TROCA`, `SITE NO AR com a release anterior`,
  14,7 s; linha `MANUAL_RECOVERY` gravada. Nova tentativa: J8 corrigido `TRAVA OK`, Switch `SUCCESS`.

**A falha real de 2026-11-09 em produção NÃO foi este cenário (conclusão do ensaio de 18/11).**

O `deployment.ndjson` do servidor tem **START 15:14:24.59Z → FAILED 15:15:25.06Z (60,5 s, `RuntimeException`)** e, na
retomada, **START 15:16:43.87Z → SUCCESS em 0,19 s** **[P, ensaio]**. Cruzando com a D02.10-D (seção "Publicação do
frontend") e com o código daquele dia:

1. **Foi `Switch -Component frontend`** **[E, D02.10-D, item 3]**: o backend já rodava desde a D02.10-C. Sem `backend` nos
   componentes, o Switch **não para nem religa o serviço** **[P, `if ('backend' -in $components)` em `8f593ef`]**.
2. **A causa foi o health, não a subida:** no PowerShell 7 o `Invoke-WebRequest` devolvia `byte[]` para
   `application/vnd.spring-boot.actuator.v3+json`, e o `Test-BackendHealth` de `8f593ef` reprovava um backend **saudável**
   **[E, D02.10-D, incidente 1; P, a correção `ConvertFrom-HealthContent` entrou em `4e8a9af`]**. Cada tentativa
   falhava **na hora**: 12 × 5 s de espera = **60 s**, mais ~0,5 s de site, junção e 12 chamadas HTTP locais. Os 60,5 s
   batem com a conta sem nenhum termo de porta fechada **[P, aritmética sobre o laço; I, que não houve outra demora]**.
3. **Os 0,19 s da retomada não são trabalho deixado pela primeira tentativa.** A primeira tinha criado a junção
   `current\frontend`, mas o operador a removeu antes de tentar de novo **[E, D02.10-D, item 2]**. A retomada refez a
   junção, achou o health UP **na primeira tentativa** (módulo corrigido, backend de pé desde antes) e não parou serviço
   nenhum: por isso 0,19 s.
4. **Não é o Ensaio A.** No Ensaio A o backend **foi parado** e subiu **depois** de o script desistir. Em 09/11 o backend
   **nunca parou**. O que os dois têm em comum é só o efeito no ndjson: `FAILED` com `RuntimeException`, sem a causa.

**Consequência para o plano:** o número de laboratório (85–89 s) **vale** para o caminho dele (porta fechada); os 60,5 s
são **outro caminho** (resposta reprovada na hora), e não desmentem o laboratório nessa máquina. O prazo de desistência
foi reescrito como faixa por modo de falha (J9). E a falha de 09/11 é o melhor exemplo do defeito já registrado na 2.3:
o ndjson não guarda a mensagem nem a fase.

### 5.3 Ensaio B — jar antigo sobre V27 e rollback

- **Sobe?** Sim. `Started InfraMonitorApplication in 10.534 seconds` (recuperação) e `15.057` (rollback), **0 WARN, 0
  ERROR**, com Flyway desligado e `ddl-auto: validate` sobre um banco com as duas tabelas da V27, que ele não mapeia.
  Login 200; `GET /configuracoes/modo-tv` 404 (esperado: a rota não existe nele) **[P-lab]**.
- **Esquecendo `databaseAheadOfRelease`:** recusa antes de parar (4.3) **[P-lab]**.
- **Com o campo:** `SUCCESS` em 17,3 s **[P-lab]**.

### 5.4 Rede contra a cópia errada

- Erros exatos: 2.4 **[P]**.
- Confuso? **Em parte.** Nomeia o parâmetro (e qual nome depende da chamada), não a causa. Melhoria aplicada: função
  `Release` (1.0) **[P]**.
- Dry-run × J8: quadro de destaque antes do J8 **[P-lab]**.

### 5.5 Os blocos para colar

- Os 11 blocos PowerShell deste documento passam no analisador do PowerShell 7.4 **[P]**. A análise pegou um erro que
  quebraria o E7 no servidor (`"$phys: …"`, lido como variável de unidade); corrigido.
- O bloco E1–E8 foi **colado e executado** contra o laboratório, só trocando caminhos e porta: 17 linhas OK, E6 = 26, e o
  único RUIM esperado (laboratório sem `deployment.ndjson`). Um passo com erro não interrompe os seguintes **[P-lab]**.
  *O que esse ensaio não pegou:* o laboratório não tinha log girado, então o trecho de subida nunca foi exercitado contra
  um `.gz`. No servidor saiu vazio (S8).
- **2026-11-18:** o trecho de subida e duração do E7, corrigido, foi executado **copiado deste documento** contra uma raiz
  sintética com `application.log` do dia, dois `.gz` no formato do logback e o `deployment.ndjson` com os horários de
  09/11 e 12/11: leu a partida de dentro do `.gz` e calculou **60,47 s / 0,19 s / 16,65 s**; sem o `.gz` da partida,
  imprimiu RUIM em vez de nada. O bloco antigo, na mesma raiz, imprimiu só o cabeçalho **[P-lab]**. Os 11 blocos passam
  no analisador do PowerShell 7.4 **[P]**.

### 5.6 O pacote e a data de 23/11

Parte 6.

---

## PARTE 6 — O pacote

### 6.1 Regerar o pacote é caso normal

| Quando | Pacote | Por quê |
|---|---|---|
| até **2026-11-23 14:59 UTC** | artefato **14237840405**, execução 43890548297 (**push** do `main` em `c6e3f48`) | é o que foi ensaiado; expira nesse horário **[P, API do GitHub]** |
| de 23/11 até **2026-11-30 ~14:54 UTC** | `workflow_dispatch` do *CI Windows Packaging* **no `main`**, com `commit = c6e3f48…` | o `resolve` reaproveita os artefatos `backend-c6e3f48…` e `frontend-c6e3f48…` do CI do `main`, que vivem 14 dias (expiram 30/11 14:59 e 14:54) **[P, API + `package.py resolve`]** |
| depois de 30/11 | re-executar antes o CI de backend e frontend do `main` em `c6e3f48`, depois o `workflow_dispatch` | sem eles, o `resolve` falha com `Approved artifact absent/ambiguous` **[P, `package.py`; I, não executado]** |

**Duas armadilhas, ambas [P]:**
1. **O `workflow_dispatch` pega o ferramental do `main` no dia do disparo**, não do commit informado (`actions/checkout`
   sem `ref`; `--templates deployment/windows` da árvore que foi checada). Antes de regerar, conferir:
   `git log c6e3f48..origin/main -- deployment/windows` **vazio**. Se não estiver, o pacote regerado traz outro
   ferramental com a mesma versão `r-c6e3f48…`: tratar como pacote novo (ensaio de leitura de novo).
2. **Execuções de PR também publicam `windows-homologation-<commit do main>`**, com o app do `main` e o **ferramental do
   PR**. Exemplo real: a execução 43877216046 (PR #41) publicou `windows-homologation-7060e28…` com ferramental
   `d5e1b3c5…`, schema 27/min 27; a do push do mesmo `7060e28` tem `4d353534…`, schema 25. **Escolher o artefato pela
   execução (evento `push` ou `workflow_dispatch` no `main`), nunca só pelo nome.** O portão do E1 pega ferramental
   antigo, mas não pega ferramental *novo e diferente* de um PR.

**O portão não depende de hash transcrito** (1.0, E1, J1): o ferramental é conferido contra o `SHA256SUMS` do próprio
pacote; o commit, contra o aprovado; a capacidade, pelo parâmetro `-DatabaseUser` e pelo `minSchemaVersion`. O hash
calculado no ensaio vai para o `estado-atual.md`, e o J1 compara o da janela com ele.

### 6.2 O build é reprodutível?

**Depende do trecho [P]:**
- **Montagem do pacote: sim.** Com os mesmos artefatos do CI e o mesmo ferramental, duas execuções diferentes deram
  `SHA256SUMS` **idênticos byte a byte** (`7060e28`: execução de push 43874997573 e de PR 43877590970). O `app.jar` foi o
  mesmo nas três execuções do `7060e28` (`9c9debb6…`), porque vem do artefato do CI de backend, não é recompilado.
- **Compilação do jar: não.** Dois `./mvnw package` seguidos do mesmo commit deram jars com hashes diferentes
  (`42d4dc56…` e `144af3e7…`) e **conteúdo idêntico**: só mudam os horários das entradas do zip. O `pom.xml` não fixa
  `project.build.outputTimestamp`.

**Consequência para a janela:** até 30/11, regerar dá **o mesmo** `SHA256SUMS` (se o `main` não mudou o ferramental).
Depois de 30/11, o jar é recompilado: `app.jar`, `package-manifest.json` e `SHA256SUMS` **mudam legitimamente**, e o
`ReleaseTools.psm1` não muda. **Diferença no hash do `app.jar` depois de 30/11 é esperada, não é adulteração.** Diferença
no hash do `ReleaseTools.psm1` nunca é esperada sem mudança em `deployment/windows`.

---

## O que não pôde ser verificado

- **IIS e SCM reais.** O laboratório simulou os dois: a ACL do frontend (J4), o `Move-Item` preservando ACL, a parada
  graciosa do WinSW, o `onfailure restart` (que pode religar sozinho, a cada 30 s/60 s/5 min, uma release nova que caiu,
  durante a recuperação) e o `Start-Website` real **[I]**.
- **ACL do backend para a conta do serviço** numa release vinda do staging **[I]**; o E7 de 18/11 mostrou os dados, que
  ainda não foram transcritos para o repositório (`estado-atual.md`, "Ainda aberto").
- ~~**Tempo de subida no servidor**~~ **Respondido em 18/11** pelo `deployment.ndjson` (Switch completo em 16,7 s), não
  pelo E7, cujo trecho de log saiu vazio (corrigido, 1.1). Um ponto só; a subida isolada do jar no servidor segue sem
  número.
- **`/tv` atrás do IIS/ARR:** nunca testado.
- **O servidor nunca foi lido por mim.** O ensaio de 18/11 foi colado pelo responsável; o que dele está aqui como
  **[P, ensaio]** veio do resumo dele. O transcript em si não passou por mim.
- **Variante "processo novo morto" da falha do Switch:** não executada; tratada pelo mesmo bloco **[I]**.
- **Regerar depois de 30/11:** caminho lido no código, não executado.
- ~~**Default privileges em produção**~~ **Lidos em 18/11:** `arwd` em tabelas e `rwU` em sequências para o
  `inframonitor_app` **[P, ensaio]**. Os grants da V27 vêm sozinhos (3.3).

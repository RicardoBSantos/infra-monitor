# Implantação da V27 (modo TV) com a trava de schema nova — procedimento

> **Situação: PLANO PARA REVISÃO. Nada deste documento foi executado.** Escrito em 2026-11-16 sobre o `main`
> `c6e3f482aace95231082c730a5b6f10c8beefc5d` (PRs #39, #41 e #42 mergeados). O autor não tem acesso a produção: tudo o que
> depende do servidor está marcado e é fechado pelo **ensaio** (Parte 1), dias antes da janela.
>
> Estado de partida: `Docs/producao/estado-atual.md`. Ao concluir, ele é atualizado **no mesmo commit** que registrar a
> implantação (regra do próprio arquivo).

**Marcação.** **[P]** provado: lido no código deste commit ou executado, com a fonte ao lado.
**[E]** informado pelo responsável ou por documento de fase, sem conferência minha. **[I]** inferido: raciocínio sobre
o código, ainda não exercitado.

**Fato do ambiente:** produção **não tem backup** (descartado pelo responsável em 2026-11-11) **[E]**. O passo "1. Backup"
das seções V26/V27 do README do backend não se aplica a esta implantação. Este plano não o propõe de novo.

## 0. De onde para onde

| | Hoje | Depois |
|---|---|---|
| Release | anterior ao `main`. Qual exatamente: **A CONFERIR** (ensaio E7). | `r-c6e3f482aace95231082c730a5b6f10c8beefc5d` |
| Schema | V26 **[E]** | V27 |
| Ferramental de release | o que veio com o pacote anterior: trava antiga, que crava 25 | o do pacote novo: lê o banco **[P]** (`ReleaseTools.psm1`) |
| Motor, Telegram, manutenção | ligados, grupo real **[E]** | iguais |

O backend muda pouco entre `921dd90` (merge do #38) e `c6e3f48`. São 11 arquivos de `src/main`, todos do modo TV, mais a
V27 e a declaração de schema. Motor, incidente, dispatcher, manutenção e autenticação **não mudaram**
**[P, `git diff --stat 921dd90 c6e3f48 -- infra-monitor-backend/src/main`]**. *Ressalva:* que a release no ar seja a do
`921dd90` é **[I]**, e o E7 confirma.

---

## PARTE 1 — Ensaio só de leitura, dias antes da janela

**Objetivo:** provar no servidor o que a trava nova pressupõe e fechar os "A CONFERIR". Nada é parado, criado no banco
ou alterado na raiz `C:\InfraMonitor`.

**Único passo que escreve, e fora da raiz:** baixar e descompactar o pacote novo em `C:\src\packages`, como na
D02.10-C **[E]**. O artefato do CI expira em **7 dias** (`retention-days: 7`, `ci-windows-packaging.yml`) **[P]**. O artefato de
`c6e3f48` expira em **2026-11-23 14:59 UTC** **[P, API do GitHub]**. Se o ensaio e a janela ficarem depois dessa data,
gere de novo por `workflow_dispatch` com o mesmo commit.
O pacote sai idêntico: o hash do `ReleaseTools.psm1` é o mesmo, porque o `assemble` roda em `ubuntu-24.04` sobre o
blob do git.

### 1.0 Variáveis (as mesmas no ensaio e na janela)

PowerShell 7, **como administrador**: os arquivos de senha só abrem para Administrators e SYSTEM **[E, D02.10-C]**.

```powershell
$Root   = 'C:\InfraMonitor'
$Pkg    = 'C:\src\packages\windows-homologation-c6e3f48'      # pacote NOVO, descompactado; nunca outro caminho
$PgHome = 'C:\Program Files\PostgreSQL\16'                     # confirmado no E3
$Nova   = 'r-c6e3f482aace95231082c730a5b6f10c8beefc5d'
$DbUser = ([IO.File]::ReadAllText("$Root\config\secrets\DB_USERNAME")).Trim()   # papel da aplicação (ver 1.2)
$DbPass = "$Root\config\secrets\DB_PASSWORD"
function Ler-Sql([string]$Sql) {   # sessão psql SOMENTE LEITURA, com o papel da aplicação
  $env:PGPASSWORD = [IO.File]::ReadAllText($DbPass).Trim()
  try { & "$PgHome\bin\psql.exe" -h 127.0.0.1 -U $DbUser -d inframonitor -w -X -v ON_ERROR_STOP=1 -c 'set default_transaction_read_only = on' -c $Sql }
  finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}
```

`config\secrets\DB_USERNAME` e `DB_PASSWORD` são os mesmos arquivos que o serviço lê (`configtree:` no XML do WinSW)
**[P, `winsw.xml.template`]**. Que existam com esses nomes no servidor é **[E, D02.10-C: o `Prerequisites` exige
`DB_NAME`, `DB_USERNAME`, `DB_PASSWORD` e `JWT_SECRET`]**.

### 1.1 Passos do ensaio

Cada passo traz a resposta boa (**OK**), a ruim (**RUIM**) e o que fazer. Qualquer **RUIM** sem ação descrita = **não
marcar a janela**; trazer a saída para revisão.

**E1 — o ferramental é o novo.**

```powershell
(Get-FileHash -Algorithm SHA256 "$Pkg\ReleaseTools.psm1").Hash.ToLower()
Select-String -Path "$Pkg\SHA256SUMS" -Pattern '  ReleaseTools\.psm1$'
Import-Module "$Pkg\ReleaseTools.psm1" -Force
Get-Command Get-DatabaseSchemaVersion -Module ReleaseTools
```

- **OK:** o hash é `d5e1b3c536942ccbf4baaa90ab58c1b18539872a64712cea9ee5a9d056a38a1d` e o `SHA256SUMS` diz o mesmo.
  O `Get-Command` lista a função.
  - É o hash do blob `deployment/windows/ReleaseTools.psm1` em `c6e3f48` e também o do `SHA256SUMS` do artefato real
    `windows-homologation-c6e3f482…-43890548297-1` **[P, baixado e conferido em 2026-11-16]**.
  - O mesmo artefato declara `schemaVersion` 27 e `minSchemaVersion` 26 **[P]**. O `Invoke-WindowsRelease.ps1` tem hash
    `84d0196f9c13790465bd7d74b27b9412a61a41133361e21e9fe4d9ed02a01b02` **[P]**.
- **RUIM — hash `4d353534…`:** é o ferramental antigo (`921dd90` e `7060e28`). **RUIM — hash `cab5306d…`:** também antigo
  (`8f593ef`). Nos dois casos, `$Pkg` aponta para o pacote errado. Corrigir o caminho e repetir.
- **RUIM — `Get-Command` não acha a função:** ferramental antigo. Mesma ação.

**E2 — o pacote novo é íntegro e declara o que deve.**

```powershell
& "$Pkg\Invoke-WindowsRelease.ps1" -Operation Verify -Root $Root -PackagePath $Pkg -DatabaseUser $DbUser -DatabasePasswordFile $DbPass |
  Select-Object version, commit, schemaVersion, minSchemaVersion
```

- **OK:** `version = $Nova`, `schemaVersion = 27`, `minSchemaVersion = 26`. O `Verify` só lê **[P,
  `Invoke-ReleaseOperation`: retorna o manifesto]**. Os dois parâmetros de banco não são usados aqui; estão na linha de
  propósito (ver 2.3).
- **RUIM — `A parameter cannot be found that matches parameter name 'DatabaseUser'`:** o `Invoke-WindowsRelease.ps1`
  executado é o antigo. Ver 2.4.
- **RUIM — `Invalid package manifest` / `Checksum mismatch` / `Unexpected or missing file`:** pacote incompleto ou
  alterado. Baixar de novo.
- **RUIM — `minSchemaVersion = 27`:** o JAR veio sem a declaração. Commit errado; o `c6e3f48` a tem **[P]**. Não seguir.

**E3 — o psql está onde se espera.**

```powershell
Test-Path "$PgHome\bin\psql.exe"; & "$PgHome\bin\psql.exe" --version
```

- **OK:** `True` e `psql (PostgreSQL) 16.x`.
- **RUIM — `False`:** procurar com `Get-ChildItem 'C:\Program Files\PostgreSQL' -Recurse -Filter psql.exe`. Corrigir
  `$PgHome` para a pasta **acima** de `bin`; esse será o `-PostgreSQLHome` da janela. Registrar no `estado-atual.md`.

**E4 — o arquivo de senha do superusuário existe.** Este é o caminho padrão do Switch quando `-DatabasePasswordFile` não
é passado **[P, `ReleaseTools.psm1`: `config/admin/postgres-superuser.txt`]**. Nunca foi provado no servidor, porque o
backup nunca rodou **[E]**.

```powershell
$Su = "$Root\config\admin\postgres-superuser.txt"
Test-Path $Su; if (Test-Path $Su) { (Get-Item $Su).Length; icacls $Su }   # nunca imprimir o conteúdo
```

- **OK:** `True`, tamanho maior que 0, ACL só com Administrators e SYSTEM.
- **RUIM — `False`:** não bloqueia a janela se o E6 passar. A recomendação 1.2 é não usar o superusuário. Registrar
  "arquivo do superusuário ausente" no `estado-atual.md`. **Não criar o arquivo** só para isto.
- **RUIM — ACL com outros grupos:** registrar e levar ao responsável. Não altera este plano.

**E5 — `Get-DatabaseSchemaVersion` com o superusuário** (só se o E4 deu `True`).

```powershell
Get-DatabaseSchemaVersion -PostgreSQLHome $PgHome -PasswordFile $Su
```

**E6 — `Get-DatabaseSchemaVersion` com o papel da aplicação** (o caminho recomendado).

```powershell
Get-DatabaseSchemaVersion -PostgreSQLHome $PgHome -PasswordFile $DbPass -User $DbUser
```

Leitura das respostas de E5 e E6 (mensagens **[P, `Get-DatabaseSchemaVersion`]**):

| Resposta | Significado | Ação |
|---|---|---|
| `26` | **OK.** Coincide com o estado informado | seguir |
| `25` ou menor | o banco não está onde o `estado-atual.md` diz | **parar**; o estado está errado, e o plano parte dele |
| `27` | V27 já aplicada por alguém | **parar**; descobrir quem aplicou e quando, antes de qualquer outra coisa |
| `Failed migration recorded in flyway_schema_history…` | há linha `success = false` | **parar**; nenhuma release passa assim, de propósito |
| `Could not read flyway_schema_history` | o psql falhou; a causa vem na linha de erro **acima** | ver as duas linhas abaixo |
| ↳ `password authentication failed` | arquivo com senha errada (ou com BOM/linha extra que o `Trim()` não tira) | E5: o superusuário não serve; seguir com o E6. E6: o serviço usa o mesmo arquivo, então é improvável **[I]**; investigar antes da janela |
| ↳ `permission denied for table flyway_schema_history` | o papel não tem SELECT | E6: usar o superusuário (E5), se ele passou; senão, parar |
| `psql not found under PostgreSQLHome` | `$PgHome` errado | voltar ao E3 |
| `Could not find file …` | o arquivo de senha não existe | E5: esperado se o E4 deu `False`. E6: parar |

**E7 — estado da raiz de implantação** (fecha "Release no ar" e mostra o que bloqueia o Switch).

```powershell
Get-Content "$Root\config\deployment-state.json"
Get-ChildItem "$Root\current" -Force | Select-Object Name, LinkType, Target
Get-ChildItem "$Root\releases" -Directory | Select-Object Name, CreationTime
Get-ChildItem "$Root\staging" -Directory -ErrorAction SilentlyContinue | Select-Object Name
$Atual = (Get-Content -Raw "$Root\config\deployment-state.json" | ConvertFrom-Json).backend
Get-Content -Raw "$Root\releases\$Atual\release-manifest.json" | ConvertFrom-Json | Select-Object version, schemaVersion, minSchemaVersion
icacls "$Root\releases\$Atual\frontend"; icacls "$Root\current"
Get-ChildItem C:\src\packages, "$Root\staging" -Recurse -Filter ReleaseTools.psm1 -ErrorAction SilentlyContinue | Get-FileHash | Select-Object Hash, Path
Import-Module WebAdministration; (Get-Website -Name InfraMonitor).physicalPath
Get-CimInstance Win32_Service -Filter "Name='InfraMonitorBackend'" | Select-Object State, StartName, PathName
Select-String -Path "$Root\config\service\InfraMonitorBackend.xml" -Pattern '_ENABLED|shutdown'
Get-ChildItem "$Root\config\secrets" | Select-Object Name     # só nomes: flags também podem vir daqui (configtree)
Get-Content "$Root\logs\deployment.ndjson" -Tail 10
```

- **OK:**
  - `deployment-state.json` tem `backend` e `frontend` iguais, e as junções `current\backend` e `current\frontend`
    apontam para `releases\<esse valor>\…`.
  - O `release-manifest` da release atual mostra `schemaVersion` 25 e nenhum `minSchemaVersion`: foi empacotado pela
    trava antiga **[E, implantação do #38]**.
  - O site aponta para `C:\InfraMonitor\current\frontend`.
- **Bloqueios conhecidos do Switch.** Nenhum é erro do ensaio; cada um vira um passo da preparação (P2):
  - **existe `backend.previous` ou `frontend.previous` em `current\`:** o Switch recusa
    (`Previous link is not the approved rollback target`), porque só o Rollback aceita `.previous` **[P,
    `Invoke-ReleaseOperation`]**;
  - **`releases\` tem 2 ou mais diretórios:** o Stage recusa (`Previous release must be reviewed manually; no automatic
    cleanup`) **[P]**;
  - **sobra `staging\<versão>` da implantação anterior:** não bloqueia. Fica registrada e não deve ser usada como
    ferramental (Parte 2).
- **RUIM — estado e junções divergem:** a implantação anterior foi feita à mão sem gravar o estado. O Switch recusaria
  (`Unexpected current link`). **Parar** e reconciliar com o responsável.
- **RUIM — `State` diferente de `Running`:** parar.

**E8 — banco: inventário e o que a janela pode perturbar.**

```powershell
Ler-Sql "select version, success, installed_on from flyway_schema_history where version is not null order by installed_rank desc limit 3"
Ler-Sql "select (select count(*) from unidade where deleted_at is null) unidades, (select count(*) from unidade where deleted_at is null and ativo) unidades_ativas, (select count(*) from equipamento where deleted_at is null) equipamentos, (select count(*) from equipamento where deleted_at is null and ativo) equipamentos_ativos"
Ler-Sql "select id, ativo, intervalo_segundos, falhas_para_incidente, sucessos_para_recovery from monitor order by id"
Ler-Sql "select status, count(*) from notificacao group by status"
Ler-Sql "select count(*) incidentes_abertos from incidente where status = 'ABERTO'"
Ler-Sql "select id, status, inicio_previsto, fim_previsto from manutencao_agendada where status in ('AGENDADA','ATIVA') order by inicio_previsto"
Ler-Sql "select count(*) em_manutencao from equipamento where em_manutencao"
Ler-Sql "select has_table_privilege(current_user,'flyway_schema_history','SELECT') sel, has_table_privilege(current_user,'flyway_schema_history','INSERT') ins"
Ler-Sql "select pg_get_userbyid(defaclrole) dono, defaclobjtype tipo, defaclacl from pg_default_acl"
```

- **OK:**
  - inventário 3/7, coincidindo com o informado **[E]**;
  - nenhuma notificação parada em `ENVIANDO`;
  - `pg_default_acl` mostra, para o dono `inframonitor_owner`, DML de `inframonitor_app` em tabelas (`r`) e
    USAGE/SELECT/UPDATE em sequências (`S`). Isso antecipa que os grants da V27 já nascem certos (3.3).
- **O que levar para o planejamento da janela:**
  - os valores de `intervalo_segundos` e `falhas_para_incidente`: o tempo até um incidente falso, se o motor novo não
    pingar, é `falhas × intervalo` (3.4);
  - as janelas de manutenção previstas, para escolher a hora (3.4).

**E9 (opcional) — pré-requisitos com o ferramental novo.** Só lê **[P, `Test-WindowsPrerequisites`]**:

```powershell
$Sid   = ([Security.Principal.NTAccount]'NT SERVICE\InfraMonitorBackend').Translate([Security.Principal.SecurityIdentifier]).Value
$WinSW = '<executável do PathName mostrado no E7>'
& "$Pkg\Invoke-WindowsRelease.ps1" -Operation Prerequisites -Root $Root -JavaHome '<JAVA_HOME do XML>' -ServiceSid $Sid -WinSWExecutable $WinSW -WinSWSha256 '<SHA aprovado na D02.10-C>' -PostgreSQLHome $PgHome -DatabaseUser $DbUser -DatabasePasswordFile $DbPass
```

- **OK:** `Java=21; IISModules=present; SecretACL=checked`.

### 1.2 Papel do banco para a trava: recomendação

**O que a consulta precisa:** `SELECT` em `flyway_schema_history`, e mais nada **[P, `Get-DatabaseSchemaVersion`]**.
O backup exigia `postgres` por causa do `pg_dumpall --globals-only` **[P, `ops/Backup-InfraMonitorDatabase.ps1`]**; a
trava herdou o padrão sem precisar dele.

**Recomendo: usar já o papel da aplicação, sem mudar código.** O Switch já aceita os dois parâmetros
**[P, `Invoke-WindowsRelease.ps1`]**: `-DatabaseUser <conteúdo de config\secrets\DB_USERNAME>` e
`-DatabasePasswordFile C:\InfraMonitor\config\secrets\DB_PASSWORD`.

| | Deixar `postgres` (padrão) | Papel da aplicação (recomendado) | Papel novo só-leitura |
|---|---|---|---|
| Mudança agora | nenhuma | nenhuma em código; dois parâmetros em toda chamada (que já entram na linha para o 2.3) | `CREATE ROLE` + `GRANT SELECT` como superusuário, arquivo de senha novo com ACL, procedimento novo |
| Depende de | arquivo nunca provado (E4) | arquivo que o serviço lê todo dia **[I]** | a credencial de superusuário, a mesma em dúvida |
| Privilégio usado | superusuário | DML no schema. *Ressalva:* ele **também pode escrever** em `flyway_schema_history` via default privileges **[I: "16 de 16 tabelas com DML" na D02.10-C = 15 tabelas de V2–V25 + a do Flyway]** | só `SELECT` |
| Se o parâmetro for esquecido | — | cai no padrão `postgres`. Arquivo ausente → `Could not find file` **antes de parar qualquer coisa** **[P: a leitura vem antes do `Stop-Website`]** | idem |

**O papel só-leitura é o certo a prazo**, mas fica para depois desta implantação, num PR que também troque o padrão do
parâmetro. Pré-condição para usar o papel da aplicação na janela: o E6 dar `26`.

### 1.3 O que o ensaio fecha no `estado-atual.md`

| Campo "A CONFERIR NO SERVIDOR" | Fechado por |
|---|---|
| Release no ar (backend e frontend) | E7: `deployment-state.json` + `Target` de `current\backend` e `current\frontend` |
| Schema, versão máxima exata | E5/E6 (número) + E8 (últimas 3 linhas do `flyway_schema_history`, com data) |
| Demais flags, valor de cada variável | E7: `Select-String _ENABLED` no XML **e** nomes em `config\secrets` (o `configtree:` também injeta). Variável ausente nos dois = padrão desligado **[P, CLAUDE.md / `application.yml`]** |
| Inventário (contagem exata) | E8 |

**Campos que o ensaio também mostra e que ainda não existem no arquivo** (sugiro acrescentar ao fechar):
- caminho do PostgreSQL (E3);
- arquivo do superusuário presente ou ausente (E4);
- `.previous` e número de releases (E7);
- cópias de ferramental no disco, com o hash de cada uma (E7).

O commit do ensaio altera **só** o `estado-atual.md`, com data, quem conferiu e "ensaio só leitura".

---

## PARTE 2 — Qual ferramental vai rodar

### 2.1 O mecanismo: sua leitura está certa, com dois acréscimos

**Certo [P]:**
- `package.py` copia `ReleaseTools.psm1`, `Invoke-WindowsRelease.ps1` e os dois modelos para a **raiz do pacote**
  (`assemble`, laço `for name in (…)`);
- `Invoke-WindowsRelease.ps1` faz `Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force`. A trava que roda
  é a que está **ao lado do script executado**, não a do pacote passado em `-PackagePath`.

**Acréscimo 1 — há uma terceira cópia [P].** O `Stage` copia o pacote **inteiro** para `staging\<versão>\`, incluindo o
ferramental. O `Switch` move para `releases\` só a pasta `staging\<versão>\releases\<versão>`. Por isso
`staging\<versão anterior>\ReleaseTools.psm1` fica no disco depois de cada implantação, com o ferramental antigo.

**Acréscimo 2 — o rollback também depende disso, e é pior [P: `Test-RollbackCompatibility` em `7060e28`].** O ferramental
antigo **não lê o banco**. Ele exige `-SchemaVersion 25` e uma prova com `schemaVersion: 25`. Com o banco em 27, ele:
- **recusa** a declaração honesta (`27`): `Schema compatibility not proven`;
- **aceita** a mentira (`25`).

Rollback com a cópia velha = a falha que o PR #41 corrigiu, de volta.

### 2.2 Onde ficam as cópias

| Cópia | Caminho | Origem |
|---|---|---|
| **nova** (a única a usar) | `C:\src\packages\windows-homologation-c6e3f48\` | download do ensaio |
| nova, depois do Stage | `C:\InfraMonitor\staging\r-c6e3f482…\` | o próprio Stage |
| antiga, D02.10-C | `C:\src\packages\windows-homologation-8f593ef\` | **[E, D02.10-C]**, hash `cab5306d…` |
| antiga, staging | `C:\InfraMonitor\staging\r-8f593ef…\`, e a da implantação do #38, se houve Stage | **[I]** pelo acréscimo 1 |
| antiga, implantação do #38 | desconhecida | **A CONFERIR** (E7 lista todas com hash) |

**Os caminhos se confundem, sim.**
- Os nomes `windows-homologation-<sha curto>` diferem só pelo hash, e o operador tende a reabrir o último terminal ou a
  última pasta usada.
- O `staging\r-…` parece "o lugar da implantação". Em `releases\` não há ferramental.

### 2.3 Como não depender da memória do operador

**Na janela, sem mudar código:**
1. **Um caminho, uma vez.** `$Pkg` é definido no bloco 1.0. **Toda** chamada é `& "$Pkg\Invoke-WindowsRelease.ps1"`,
   inclusive o Rollback. Nunca `cd` + `.\Invoke-…`, nunca o `staging`.
2. **Portão de ferramental no início da janela:** o E1, com o hash fixo deste documento. Hash diferente = parar.
3. **Armadilha de parâmetro:** toda chamada passa `-DatabaseUser` e `-DatabasePasswordFile`, o que a 1.2 já pede. O
   script antigo não tem esses parâmetros e **falha no bind, antes de ler qualquer coisa**, com uma mensagem que nomeia o
   parâmetro **[I: script com `[CmdletBinding()]` rejeita parâmetro nomeado desconhecido; `Invoke-WindowsRelease.ps1` em
   `7060e28` não os declara, P]**. Isso cobre também o Rollback.
4. **Depois da implantação**, numa revisão humana e não por automação (regra da D02.10), arquivar fora de `C:\src\packages`
   as pastas de pacotes antigos e as sobras de `staging\`.

**No código, para o próximo PR (recomendação; não implementado):**
- `package-manifest.json` ganha `"toolingFormat": 2`, e o módulo declara a mesma constante;
- no `Stage` e no `Switch`, o módulo compara o hash do **próprio arquivo** (`$MyInvocation.MyCommand.Module.Path`) com o
  `files['ReleaseTools.psm1']` do manifesto do pacote ou do staging. Se diferir, recusa: "rode o
  `Invoke-WindowsRelease.ps1` de dentro do pacote";
- no `Rollback`, que não tem pacote novo, exige `toolingFormat >= 2`.

Isso não protege contra o ferramental **já** instalado, que não muda. Protege da próxima vez em diante.

### 2.4 A mensagem que o operador vê com a cópia errada

| Chamada com ferramental antigo | Mensagem | Aponta a causa? |
|---|---|---|
| qualquer operação com `-PackagePath` do pacote novo, sem os parâmetros novos | `Invalid package manifest` **[P: `$m.schemaVersion -ne 25` em `7060e28`; reprodução da reversão E na rodada do #41]** | **Não.** Sugere pacote corrompido |
| mesma, com `-DatabaseUser` (procedimento 2.3) | `A parameter cannot be found that matches parameter name 'DatabaseUser'` **[I]** | Em parte: diz que o script não conhece o parâmetro, mas não diz "ferramental velho" |
| Rollback honesto (`-SchemaVersion 27`) | `Schema compatibility not proven` **[P]** | Não |
| Rollback com `-SchemaVersion 25` e prova 25 | **aceita** **[P]** | — é o risco |

**Proposta de texto** (na versão nova; a antiga não muda). Separar a condição combinada do `Test-PackageIntegrity`:

- schema fora do que esta versão entende:
  `Package declares schemaVersion <n> / format <f>, which this ReleaseTools.psm1 (toolingFormat <t>) does not understand. You are probably running release tooling from an older package: run the Invoke-WindowsRelease.ps1 shipped inside <PackagePath>.`
- identidade inválida (commit, versão, `historyGuard`): `Invalid package identity (commit/version/historyGuard)`. Manter
  a palavra "manifest" só para o que é, de fato, manifesto malformado.

**Para esta janela:** o procedimento diz, em texto, que `Invalid package manifest` num pacote que passou no E2 significa
**ferramental errado**, não pacote corrompido.

---

## PARTE 3 — A sequência

### Preparação, antes do dia (não para nada)

| # | O quê | Como saber que deu certo |
|---|---|---|
| P1 | Ensaio da Parte 1 completo, `estado-atual.md` atualizado | E1–E8 OK |
| P2 | **Só se o E7 mostrou bloqueio:** remover os `.previous` e tirar a release mais velha de `releases\` (ver abaixo) | `current\` só com `backend` e `frontend`; `releases\` com 1 diretório |
| P3 | **Recomendado:** provar localmente, em banco descartável, o jar da release atual subindo sobre um banco em V27, com Flyway desligado. É o que o rollback faz, e o README diz "não provado" | health UP, login 200 |
| P4 | Escolher a hora: nenhuma janela de manutenção começando ou terminando entre T−15 min e T+30 min (E8) | consulta do E8 vazia nesse intervalo |
| P5 | ID de aprovação, ex.: `D02.12-V27-AAAA-MM-DD-<responsável>` | — |

**P2, se necessário.** É mutação manual e exige o aval do responsável. Não toca no que está no ar: o IIS e o serviço usam
`current\backend` e `current\frontend`, não o `.previous` **[P: `physicalPath` e `<workingdirectory>`]**.

```powershell
# remove só o LINK (rmdir de junção não segue o alvo); nunca Remove-Item -Recurse
cmd /c rmdir "C:\InfraMonitor\current\backend.previous"
cmd /c rmdir "C:\InfraMonitor\current\frontend.previous"
# release mais velha (a que NÃO é $Atual): mover, não apagar
New-Item -ItemType Directory C:\InfraMonitor-arquivo -Force | Out-Null
Move-Item "C:\InfraMonitor\releases\<release mais velha>" C:\InfraMonitor-arquivo\
```

### A janela

Antes de tudo: `Start-Transcript "$Root\logs\implantacao-v27-$(Get-Date -f yyyyMMdd-HHmm).txt"` e o bloco 1.0. Depois,
parâmetros comuns:

```powershell
$Sid   = ([Security.Principal.NTAccount]'NT SERVICE\InfraMonitorBackend').Translate([Security.Principal.SecurityIdentifier]).Value
$WinSW = '<executável do PathName, E7>'
$Atual = (Get-Content -Raw "$Root\config\deployment-state.json" | ConvertFrom-Json).backend
$Aprov = '<ID da P5>'
$Comum = @{ Root=$Root; ServiceName='InfraMonitorBackend'; SiteName='InfraMonitor'; ServiceSid=$Sid; WinSWExecutable=$WinSW;
            PostgreSQLHome=$PgHome; DatabaseUser=$DbUser; DatabasePasswordFile=$DbPass }
```

**J1 — Portão.** Repetir o E1 e o E6.
- **OK:** hash `d5e1b3c5…` e banco `26`.
- **Falhou:** parar. Nada foi tocado.

**J2 — Espaço.** `& "$Pkg\Invoke-WindowsRelease.ps1" -Operation Space -PackagePath $Pkg @Comum`
- **OK:** `ProjectedFreeBytes` acima de 22 GiB.
- **Falhou:** `Projected free space below 22 GiB`. Parar.

**J3 — Stage.** `& "$Pkg\Invoke-WindowsRelease.ps1" -Operation Stage -PackagePath $Pkg -Apply -ApprovalId $Aprov @Comum`.
Ele pede confirmação (`ConfirmImpact High`); responder `Y`.
- **OK:** `Staged = r-c6e3f482…`.
- **Falhou:**
  - `Staging already exists`: sobra de tentativa anterior; revisar.
  - `Previous release must be reviewed manually`: a P2 não foi feita.
- Nada no ar mudou.

**J4 — ACL do frontend novo**, antes do Switch. O Switch não ajusta ACL, e release sem RX para o IIS = site 500
**[P: o código não toca em ACL; I: efeito, como o incidente 4 da D02.10-D]**. Replicar **exatamente** as concessões que o
E7 mostrou em `releases\$Atual\frontend`. O esperado pela D02.10-D **[E]**:

```powershell
icacls "$Root\staging\$Nova\releases\$Nova\frontend" /grant "IIS AppPool\InfraMonitor:(OI)(CI)RX" "IUSR:(OI)(CI)RX"
icacls "$Root\staging\$Nova\releases\$Nova\frontend"
```

- **OK:** as duas entradas aparecem.
- O `Move-Item` do Switch é no mesmo volume e preserva a ACL **[I]**.

**J5 — Aplicar a V27**, com o backend antigo **ainda no ar** na 8080. É o comando do passo 2 da V26 no README do backend,
com `--spring.flyway.target=27` e o `app.jar` em `$Root\staging\$Nova\releases\$Nova\backend\app.jar`.

**Pré-condição:** as seis variáveis `*_ENABLED='false'` no **mesmo** console. Sem elas, um segundo motor e um segundo
dispatcher subiriam contra produção.

- **OK:** `Successfully applied 1 migration to schema "public", now at version v27`, depois
  `Started InfraMonitorApplication`. Então Ctrl+C.
- **Falhou** (exceção ou nenhuma linha de "applied"): Ctrl+C. **Produção não foi tocada:** a 8080 segue servindo e o
  motor segue coletando.
  - No PostgreSQL o Flyway roda cada migration numa transação. Uma V27 que falha volta inteira e o banco continua em 26
    **[I: DDL transacional; a V27 não tem comando proibido em transação]**.
  - Conferir com o E6. Se der `26`, a janela termina aqui e nada precisa ser desfeito.

**J6 — Conferir a V27 e os grants** (3.3). Depois: `Get-DatabaseSchemaVersion … -User $DbUser` → **`27`**.

**J7 — Prova de compatibilidade**, em `C:\InfraMonitor\config\admin\prova-v27.json` (pasta só de administradores):

```json
{ "approved": true, "schemaVersion": 27,
  "current": { "backend": "<$Atual>", "frontend": "<$Atual>" },
  "target":  { "backend": "r-c6e3f482aace95231082c730a5b6f10c8beefc5d", "frontend": "r-c6e3f482aace95231082c730a5b6f10c8beefc5d" },
  "approvedBy": "<responsável>", "evidence": "ensaio <data>; V27 aplicada <hora>" }
```

**J8 — Pré-checagem da trava, sem parar nada.** O Switch **sem** `-Apply` não serve para isso: ele retorna o plano
**antes** de ler a prova e o banco **[P: `if (-not $Apply) { return … DryRun }` vem antes]**. As mesmas funções, chamadas à
mão, só leem:

```powershell
Import-Module "$Pkg\ReleaseTools.psm1" -Force
$db     = Get-DatabaseSchemaVersion -PostgreSQLHome $PgHome -PasswordFile $DbPass -User $DbUser
$prova  = Get-Content -Raw "$Root\config\admin\prova-v27.json" | ConvertFrom-Json -AsHashtable
$estado = Get-Content -Raw "$Root\config\deployment-state.json" | ConvertFrom-Json -AsHashtable
$pacote = Test-PackageIntegrity "$Root\staging\$Nova"
Test-RollbackCompatibility $prova $estado $pacote 'Both' 27 $db; 'TRAVA OK'
```

- **OK:** `TRAVA OK`.
- **Falhou:** a mensagem diz qual das condições falhou: operador × banco, prova, `minSchemaVersion`, par de releases.
  Corrigir a prova. Nada foi parado.

**J9 — Switch.**

```powershell
& "$Pkg\Invoke-WindowsRelease.ps1" -Operation Switch -PackagePath $Pkg -Component Both -CompatibilityProof "$Root\config\admin\prova-v27.json" -SchemaVersion 27 -Apply -ApprovalId $Aprov @Comum
```

- **OK:** termina sem exceção. `logs\deployment.ndjson` ganha `START` e `SUCCESS` com `$Nova`, e `deployment-state.json`
  passa a `$Nova` nos dois campos.
- **Falhou — dois tipos, com consequências opostas [P, ordem do código]:**
  - **Antes de parar** (qualquer `throw` da trava ou das conferências de IIS, serviço e junções): nada foi parado. O site e
    o motor seguem com a release antiga.
  - **Depois de parar:** `Release operation failed; preserve stopped site and review evidence.` O **site fica parado** e o
    motor também, se o serviço não voltou. Ir **direto** ao 4.1-B.

**J10 — Conferência imediata** (3.5). **J11 —** `Stop-Transcript`; atualizar o `estado-atual.md` (release, schema 27,
data, quem) no commit que registra a implantação.

### 3.2 A V27 antes ou depois do Switch?

**A ordem deixou de ser obrigatória para a trava; continua recomendada.** O pacote novo declara `minSchemaVersion: 26`
**[P, `schema-compatibility.json`]**. A trava aceita o Switch com o banco em 26 (`-SchemaVersion 26`) ou em 27
(`-SchemaVersion 27`). Aplicar a V27 depois, com o jar novo já no ar, também funciona: o PUT responde 503 até a tabela
existir e passa a funcionar sem reiniciar **[P: acesso por JDBC tolerante, por chamada; teste
`semTabelaGetPadroesPutIndisponivel`]**.

**Recomendo V27 primeiro (J5) e Switch depois (J9):**
- **Falha na V27 não custa parada:** acontece com a release antiga no ar e o motor coletando. Na ordem inversa, a parada
  já aconteceu quando a V27 falha.
- **A trava vira portão da V27:** banco com migration falha (`success = false`) faz o Switch recusar **antes** de parar
  qualquer coisa.
- **Um estado só para conferir** depois do Switch: a conferência 3.5 inclui o PUT funcionando, sem um "503 esperado"
  intermediário.

O custo é a combinação "release antiga sobre banco em 27" durar alguns minutos, entre J5 e J9. A release antiga **já está
rodando**, e o `ddl-auto: validate` só confere tabelas na subida, e só as das entidades. Tabelas a mais não a afetam
**[I; a subida da release antiga sobre a V27 é exatamente a P3]**.

### 3.3 Grants da V27

A V27 cria duas tabelas e **uma** sequência: `configuracao_modo_tv.id` é `IDENTITY` →
`configuracao_modo_tv_id_seq`. `configuracao_modo_tv_tela` tem chave composta, sem sequência **[P, `V27__…sql`]**.

Conferência (J6), mesmo padrão da V26:

```sql
select version, success from flyway_schema_history where version in ('26','27') order by version;   -- 26|t e 27|t
select has_table_privilege('inframonitor_app','configuracao_modo_tv','SELECT,INSERT,UPDATE,DELETE');        -- t
select has_table_privilege('inframonitor_app','configuracao_modo_tv_tela','SELECT,INSERT,UPDATE,DELETE');   -- t
select has_sequence_privilege('inframonitor_app','configuracao_modo_tv_id_seq','USAGE,SELECT');            -- t
select count(*) from configuracao_modo_tv;                                                                  -- 0
```

Se algum vier `f`, **como `inframonitor_owner`** (dono do schema), não como superusuário:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON configuracao_modo_tv, configuracao_modo_tv_tela TO inframonitor_app;
GRANT USAGE, SELECT ON SEQUENCE configuracao_modo_tv_id_seq TO inframonitor_app;
```

**O esperado é vir tudo `t` sem GRANT:** os default privileges do `inframonitor_owner` dão DML e uso de sequência ao papel
da aplicação **[E, D02.10-C; o E8 mostra `pg_default_acl`]**. O GRANT de sequência pode não ser necessário para coluna
`IDENTITY` **[I]**; fica pelo mesmo padrão da V26, sem custo.

### 3.4 Indisponibilidade, e o que acontece com o que está rodando

**Quanto tempo.** Só o J9 para alguma coisa. A sequência dentro dele **[P, `Invoke-ReleaseOperation`]**:
1. `Stop-Website` (o site sai do ar);
2. `Stop-Service`. O serviço tem `--server.shutdown=graceful` e 30 s por fase, `stoptimeout` de 45 s, e o script espera
   até 45 s **[P, `winsw.xml.template`; I: que o XML de produção mantenha]**;
3. troca das junções (instantânea);
4. `Start-Service`;
5. health a cada 5 s, até 12 tentativas;
6. `Start-Website`.

Estimativa **[I]**: **20 s a 1 min** de site fora do ar. A subida do Spring medida localmente foi 5,6 s **[P, evidência
`status-motor-desligado-captura-completa.md`, ambiente local]**; a do servidor não foi medida. Pior caso antes de o script
desistir: cerca de 4 min.

**Motor ICMP** — esta é a resposta ao item que mais importa:

| Pergunta | Resposta |
|---|---|
| Para? | **Sim**, junto com a JVM. O desligamento gracioso deixa terminar o ping em curso **[I]** |
| Perde medição? | Não grava nenhuma durante a parada: um buraco de 20 s a 1 min. Nada é registrado como falha **[P: medição só nasce de uma execução]** |
| A parada gera incidente? | **Não.** Incidente só abre com `falhas_para_incidente` medições **FALHA** consecutivas, contadas dentro da observação **[P, `IncidentProcessor.processarAbertura`]**. A ausência de medição não é falha. A disponibilidade também não conta o buraco como queda (a queda do processo não aparece no SLA) **[E, registro anterior]** |
| Na volta | o motor espera a primeira passada do reconciliador de manutenção (MA12) e então pinga os 7 de uma vez, todos vencidos **[P, `MonitoringScheduler`, `isDue`]** |
| Incidente aberto antes da janela | continua aberto. A recuperação segue a regra normal, com medições novas **[P]** |
| Equipamento que cai **durante** a parada | o alerta sai atrasado, não perdido: as falhas aparecem nas primeiras medições depois da volta **[I]** |

**Pode sair alerta falso no grupo do Telegram?**
- **Pela parada em si: não [P].**
- **Pelo processo novo:** só se ele não conseguir pingar, por ambiente (permissão, tmpdir, implementação ICMP). Aí as 7
  medições falhariam e, após `falhas × intervalo` (E8; padrão 3 falhas), sairiam até 7 incidentes reais no grupo.
  - Probabilidade baixa **[I]**: o código ICMP e de incidente é idêntico ao que está no ar **[P, diff]**, e a conta do
    serviço e o XML não mudam.
  - **Mitigação:** a primeira conferência do 3.5 é a das medições. Ela acontece **dentro** do prazo `falhas × intervalo`.
    Falha generalizada com os equipamentos de pé = rollback imediato (4.1), antes do limiar, se der tempo.
- **Duplicata possível [P, README "at-least-once" e `releaseStaleReservations`]:** uma notificação `ENVIANDO` interrompida
  pela parada volta para a fila depois de `processing-timeout-ms` (60 s) e é reenviada. O gracioso reduz a chance, mas
  não a zera.

**Silenciar o grupo durante a janela? Não recomendo, e nenhuma das formas evita o alerta:**
- **desligar o dispatcher ou o Telegram:** exige mexer no XML e reiniciar mais uma vez. As notificações ficam
  `PENDENTE` e saem quando religar: **atrasa, não evita** **[P, README "Telegram Dispatcher"]**;
- **pôr os 7 equipamentos em manutenção:** a entrada e a saída da manutenção **anunciam no grupo** (F3) **[E, F3]**.
  Seriam mensagens certas no lugar de um risco baixo.

**Notificações pendentes no dispatcher:** estão no banco e saem depois da volta, atrasadas pelo tempo de parada **[P: fila
em `notificacao`, `status = PENDENTE`]**. O E8 e a 3.5 contam por status.

**Janela de manutenção ativa:**
- o estado `em_manutencao` está no banco e sobrevive à parada;
- a primeira passada do reconciliador, na volta, aplica a situação que o relógio pede, com os instantes reais
  **[P, comentário de `ReconciliadorManutencao`, MA08]**;
- início ou fim que caiu dentro da parada é anunciado no grupo com atraso;
- janela que começaria **e** terminaria dentro da parada vira `EXPIRADA` e não anuncia (MA27) **[P, idem]**.

Daí a P4: escolher hora longe de início ou fim de janela. Manutenção manual é flag persistente e não é afetada.

**Sessões abertas:**
- o refresh token está em `sessao_usuario`, e o `JWT_SECRET` não muda: quem está logado continua logado **[P,
  `auth.interceptor.ts`: o front só encerra a sessão depois de um **401** e de um refresh que falha]**;
- com o backend parado não há 401: as telas mostram erro de carga e se recuperam na volta;
- abas abertas com o JS antigo: ao navegar para uma tela ainda não carregada, pedem um *chunk* com hash antigo, que deixou
  de existir. A navegação falha até um F5 **[I: o arquivo tem ponto no nome, então a regra "SPA routes" do `web.config`
  não o reescreve e ele dá 404]**;
- nenhuma TV está aberta, porque `/tv` só existe no front novo.

### 3.5 Conferência imediata

Na ordem. As duas primeiras dentro do prazo `falhas × intervalo`.

1. **Motor pingando.** Logo depois do J9:
   ```powershell
   Ler-Sql "select monitor_id, status, executado_em from medicao where executado_em > now() - interval '3 minutes' order by executado_em desc"
   ```
   - **OK:** uma linha por monitor ativo, depois da hora do J9, em `SUCESSO`, salvo os equipamentos que já estavam fora.
   - **Falhou:** `FALHA` em todos com os equipamentos de pé → 4.1 já.
2. **Health e log.** `& "$Pkg\Invoke-WindowsRelease.ps1" -Operation Health @Comum` → `True`. No
   `logs\backend\application.log`: nenhum `ERROR` desde a subida e nenhum `Configuracao do modo TV indisponivel`.
3. **Itens da V26** (README): login do ADMIN; cookie `inframonitor_refresh` (HttpOnly, Secure, SameSite Strict);
   F5 numa tela interna continua logado; Sair + F5 vai ao login.
4. **Modo TV, pela API:** `GET /api/v1/configuracoes/modo-tv` → 200 com `persistida:false`. Como ADMIN, salvar a
   configuração → 200 e `select count(*) from configuracao_modo_tv` = 1.
   - Um **503** aqui = V27 ausente ou sem grant: voltar ao J6. Não é motivo de rollback.
5. **`/tv` atrás do IIS — nunca testado.** A URL abre pelo IIS como rota SPA: casa com `^[^.]*$` e é reescrita para
   `/index.html` **[I, `web.config.template`]**. Da estação da VLAN de TI:
   - `https://<host>/tv` direto na barra (deep link), não por navegação: abre a TV;
   - F5 em `/tv`: continua na TV;
   - DevTools sem 404 nem violação de CSP;
   - a tela troca no intervalo configurado;
   - "Dados de HH:MM" atualiza;
   - uma aba em `/dashboard` não troca de tela.
   - **Falhou:** `/tv` em 404 ou em branco **não** é motivo de rollback sozinho. O resto do sistema funciona; registrar e
     corrigir depois. Site inteiro em 500 é: provavelmente ACL (J4) → conceder RX em
     `releases\$Nova\frontend` e testar de novo antes de decidir.
6. **Notificações e incidentes.**
   - `select status, count(*) from notificacao where created_at > '<hora do J9>' group by status`: nada novo além de
     eventos reais.
   - `incidente` aberto depois do J9: só se houver causa real.
7. **Registro:** `estado-atual.md` (J11).

---

## PARTE 4 — Voltar atrás

### 4.1 Passo a passo, com a V27 aplicada

**Quando:** login quebrado; motor sem conseguir pingar (3.5-1); erro sistemático no log. **Não** é motivo: só o `/tv`
ou só o PUT do modo TV.

**4.1-A — o Switch terminou com SUCCESS** (estado e junções na release nova; `.previous` → release antiga):

1. Prova em `C:\InfraMonitor\config\admin\prova-rollback-v27.json`:
   ```json
   { "approved": true, "schemaVersion": 27, "databaseAheadOfRelease": true,
     "current": { "backend": "r-c6e3f482aace95231082c730a5b6f10c8beefc5d", "frontend": "r-c6e3f482aace95231082c730a5b6f10c8beefc5d" },
     "target":  { "backend": "<$Atual, a release anterior>", "frontend": "<$Atual>" },
     "approvedBy": "<responsável>", "evidence": "<motivo do rollback>" }
   ```
2. Com o ferramental **novo**, sem `-PackagePath`:
   ```powershell
   & "$Pkg\Invoke-WindowsRelease.ps1" -Operation Rollback -Version $Atual -Component Both -CompatibilityProof "$Root\config\admin\prova-rollback-v27.json" -SchemaVersion 27 -Apply -ApprovalId "$Aprov-rollback" @Comum
   ```
3. **OK:** `SUCCESS` no `deployment.ndjson`, estado de volta a `$Atual`, health UP, login funciona. A 3.5-1 de novo
   (motor). A V27 **fica**: o jar antigo não a conhece e não a confere.
4. Com o front antigo, `/tv` não existe. Se sobrar uma aba com o front novo, ela recebe 404 na configuração e mostra o
   aviso, tentando de novo **[E, README V27]**.
5. **Depois do rollback:** `current\*.previous` aponta para a release nova. Para implantá-la de novo, a operação é
   **`Rollback` para `$Nova`** com a prova invertida, porque o `Switch` recusaria o `.previous`. Ou faça a P2 antes **[I,
   código das junções]**.

**4.1-B — o Switch falhou depois de parar** (`Release operation failed; preserve stopped site…`). **Isto é o menos óbvio
do plano.**
- Se a falha veio **depois da troca das junções** (o caso típico: o health não subiu), as junções apontam para a release
  nova e o `.previous` para a antiga, mas o `deployment-state.json` **não foi atualizado** e ainda diz a antiga.
- O Rollback confere `current\*` contra o estado e **recusa** com `Unexpected current link` **[I, leitura de
  `Invoke-ReleaseOperation`: o estado só é gravado depois do health]**.
- A recuperação é manual. São os mesmos movimentos de ponteiro do script, sem apagar nada:

```powershell
Stop-Service InfraMonitorBackend
foreach ($p in 'backend','frontend') {
  Move-Item "$Root\current\$p" "$Root\current\$p.falhou"        # junção da release nova
  Move-Item "$Root\current\$p.previous" "$Root\current\$p"      # volta a antiga
}
Start-Service InfraMonitorBackend
& "$Pkg\Invoke-WindowsRelease.ps1" -Operation Health @Comum     # True
Start-Website InfraMonitor
```

- Depois: 3.5-1 a 3.5-3. Ainda com o responsável, `cmd /c rmdir` nas junções `*.falhou`, e registrar o evento em
  `deployment.ndjson`.
- Se a falha veio **antes** da troca (por exemplo, `Stop-Service` estourando o tempo), as junções não mudaram e não existe
  `.previous`. Basta `Start-Service` + health + `Start-Website`.
- Para distinguir os dois casos: `Get-ChildItem "$Root\current" -Force | Select Name, Target`.

### 4.2 Sem backup — o que isso significa aqui

**Em uma linha:** a V27 só **cria**, então o rollback não precisa de backup; o que não teria volta é um erro manual no
banco durante a janela (um `DROP` ou `DELETE` errado, sobretudo com o superusuário), e por isso este plano só escreve no
banco pela V27, com o Flyway.

**O rollback é trivial no banco, mas não é trivial no todo:**
- **O DROP opcional do README** (`DROP TABLE configuracao_modo_tv_tela; DROP TABLE configuracao_modo_tv; DELETE FROM
  flyway_schema_history WHERE version='27'`) **não faz parte deste rollback**. Ele apaga a configuração salva sem volta e
  não é necessário: o jar antigo roda com as tabelas paradas.
- **O jar antigo nunca subiu sobre um banco em 27.** É a prova P3; sem ela, essa parte do rollback é **[I]**.
- **O rollback com o ferramental velho aceita a mentira**: 2.1, acréscimo 2.
- **Switch que falha no meio:** o Rollback do ferramental recusa, e a volta é manual (4.1-B).
- **Depois do rollback, o `.previous` aponta para a release nova**, e um Switch para reimplantá-la seria recusado (4.1-A,
  passo 5).

### 4.3 `databaseAheadOfRelease=true`

É exatamente o caso de voltar com o banco em 27:
- a release antiga declara `schemaVersion: 25` e nenhum `minSchemaVersion` **[E, E7 confirma]**;
- logo, banco 27 > 25 = "banco à frente do release".

**Como o operador o usa:** um campo a mais na prova do rollback (4.1-A, passo 1). Ele é a aprovação humana de que o jar
antigo roda sobre o schema mais novo; a evidência é a P3. Sem a P3 feita, quem assina a prova aceita o **[I]**.

**Se esquecer:** `Database schema ahead of the release; explicit approval required`. A trava roda antes do
`Stop-Website`, então **nada é parado**: a release nova continua no ar **[P, ordem em `Invoke-ReleaseOperation`]**. O
operador acrescenta o campo e repete.

**Se usar o ferramental velho:** 2.4. Com os parâmetros de banco na linha, falha no bind **[I]**. Sem eles, recusa a
declaração honesta e aceita `25` **[P]**.

---

## O que não pôde ser verificado daqui

- **Switch e Rollback reais (`-Apply`) nunca foram exercitados** com o ferramental novo, nem em servidor nem em
  laboratório com IIS e WinSW. Os testes do #41 cobrem a trava (funções) e a leitura do banco, não a operação inteira.
  A ligação entre a leitura do banco e as duas chamadas da trava foi conferida por leitura do código.
- **`/tv` atrás do IIS/ARR nunca foi testado.** A reescrita SPA é inferida do `web.config.template`.
- **O servidor nunca foi lido** por mim. Release no ar, `.previous`, número de releases, ACLs, caminho do PostgreSQL,
  arquivos de senha, flags reais e intervalos dos monitores: tudo é fechado pelo ensaio.
- **Arquivo do superusuário:** existência não provada (E4); motivo para a 1.2.
- **Jar antigo subindo sobre V27:** não provado (P3).
- **Tempo de parada:** estimado; a subida no servidor não foi medida.
- **Hash do `ReleaseTools.psm1`:** conferido no artefato baixado do CI. Que a cópia baixada no servidor seja a mesma é o
  que o E1 confere.
- **Mensagem de bind do script antigo** com `-DatabaseUser`: inferida da semântica do PowerShell, não reproduzida.
- **Default privileges incluindo `flyway_schema_history`** para o papel da aplicação: inferido da contagem 16/16 da
  D02.10-C; o E8 mostra.

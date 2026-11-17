# Puller de release iniciado pelo servidor

> **Situação: CONSTRUÍDO E ENSAIADO EM LABORATÓRIO. NÃO INSTALADO.** Nada deste documento foi executado no servidor.
> Escrito em 2026-11-17 sobre o `main` `3df8253` (PR #43 e #40 mergeados). A instalação só acontece **depois** da
> implantação manual da V27 (`implantacao-v27-modo-tv.md`), e só com as decisões D1–D4 confirmadas pelo responsável.
>
> **As decisões D1–D4 abaixo são PROPOSTAS minhas, não decisões do responsável.** O código já as segue onde não havia
> como parametrizar; onde havia, ficaram em parâmetro.

**Marcação.** **[P]** provado: lido no código deste commit ou executado, com a fonte ao lado. **[P-lab]** executado no
laboratório (GitHub falso local, PostgreSQL 16 descartável, raiz simulada com junções reais). **[E]** informado pelo
responsável ou por documento de fase, sem conferência minha. **[I]** inferido, ainda não exercitado.

---

## 1. Por que existe

A esteira termina no artefato (`upload-artifact`, retenção de 7 dias) e os runners do GitHub não alcançam a VM. Quem
inicia tem de ser o servidor. O que o plano manual combate com engenharia pesada, e o puller resolve por **procedência**:

| Problema | Como o plano manual se defende | Como o puller resolve |
|---|---|---|
| Três cópias do ferramental com o mesmo nome | `$Pkg` uma vez, portão de hash, função `Release` | Um caminho canônico por versão, `<PullerRoot>\packages\r-<sha>`, só preenchido depois da verificação; cópias velhas podadas |
| Execução de PR publica artefato com nome e versão do `main` e ferramental do PR (aconteceu no `7060e28`) | Conferência humana do hash do ferramental | Só aceita execução `push`/`main`/`success` do commit aprovado **e** compara o ferramental do pacote com o blob do commit aprovado na API |
| Artefato expira em 7 dias; regerar dá outro pacote | — | Baixa dentro do prazo e guarda; artefato expirado é recusado com a explicação de que `workflow_dispatch` não serve |

## 2. Escopo rígido

Faz **só**: (1) descobre a release aprovada; (2) baixa o artefato; (3) verifica procedência e integridade; (4) faz o
stage **no diretório próprio**; (5) roda checagens só de leitura (schema real do banco, `minSchemaVersion`, identidade
do ferramental); (6) escreve relatório e avisa; (7) para.

**Nunca:** chama Switch ou Rollback, para ou inicia serviço/site, escreve no banco, aplica migration, altera junções,
mexe em `config`, apaga qualquer coisa sob `C:\InfraMonitor` **[P: `Invoke-ReleasePuller.ps1` não chama
`Invoke-ReleaseOperation`, `Stop-*`, `Start-*` nem escreve fora de `-PullerRoot`; P-lab: todo cenário compara um retrato
da raiz simulada antes e depois — `Assert-Result` em `puller-tests.ps1`]**.

**Reuso do módulo.** O puller importa o `ReleaseTools.psm1` **que está ao lado dele** (a cópia instalada, nunca a de
dentro do pacote baixado) e não reimplementa nenhuma verificação. O que faltava foi **acrescentado ao módulo**:

| Função | Situação | Uso no puller |
|---|---|---|
| `Test-PackageIntegrity` | existente | integridade do pacote extraído |
| `Get-DatabaseSchemaVersion` | existente; agora **sempre** em sessão `default_transaction_read_only` e com `-RefuseSuperuser` | schema real do banco |
| `Test-FreeSpacePolicy` | existente | o mesmo portão de 22 GiB do Stage |
| `Assert-AbsolutePath`, `Assert-RelativePath` | existentes (a segunda passou a ser exportada) | caminhos e nomes do zip |
| `Test-DatabaseSchemaFit` | **nova**, extraída de `Test-RollbackCompatibility` (que passou a chamá-la; mensagens iguais) | `minSchemaVersion ≤ banco ≤ schemaVersion` |
| `Test-PackageTooling` | **nova** (era a recomendação 2.3 do plano V27) | identidade do ferramental contra hashes esperados |
| `Test-DeploymentOperationActive`, `Get-DeploymentMutexName` | **novas**; o Switch passou a usar a mesma função de nome | detectar operação em andamento sem bloquear |
| `Get-DeployedReleases` | **nova**, só leitura | release em uso e alvo de rollback (poda) |
| `Test-SecretFileAcl` | **nova**, extraída de `Test-WindowsPrerequisites` (que passou a chamá-la) | ACL do arquivo do token |

**Efeito na janela da V27 desta semana: nenhum.** A janela usa o ferramental **de dentro do pacote `c6e3f48`**, já
baixado em `C:\src\packages` (`implantacao-v27-modo-tv.md`, 2.1) **[P]**. Estas mudanças no módulo só chegam a um
pacote montado a partir de um commit que as contenha.

---

## 3. ETAPA 1 — As quatro decisões (propostas, a confirmar)

### D1. O que é "release aprovada"

| Opção | Ato explícito | Auditável depois | O puller verifica sem ambiguidade | Contra |
|---|---|---|---|---|
| **Tag anotada `aprovada/r-<sha40>`** | sim: `git tag -a` + `git push` | sim: autor, data, mensagem no objeto tag; ruleset impede apagar/mover | sim: nome contém o sha; objeto tag → commit; `compare` prova que está no `main` | quem tem push cria tag, até existir ruleset; data do autor vem do relógio de quem criou |
| GitHub Release | sim (UI) | sim | sim (é uma tag por baixo) | mais superfície editável (notas, assets, draft); vantagem real só se o pacote virar asset (ver D2-B) |
| Arquivo versionado (`release/aprovada.json`) | sim, via PR | sim, pelo git | **não**: aprovar cria um commit novo no `main`, que tem a própria execução de empacotamento; "qual commit?" vira corrida | mistura aprovar com mudar código |
| Label no PR | fraco | fraco: label é mutável, histórico só em eventos | **não**: PR ≠ commit de merge | qualquer triador coloca |

**Recomendo: tag anotada `aprovada/r-<sha de 40>`**, com a primeira linha da mensagem = ID de aprovação (o mesmo da P5
do plano V27, ex. `D02.12-V27-2026-11-20-<responsável>`), mais um **ruleset de tag** em `refs/tags/aprovada/*`:
restringir criação a admin, bloquear update e delete. Revogar = aprovar outro commit (a tag mais nova pela data do autor
vence); a tag antiga fica, para auditoria.

O puller exige **[P-lab, cenários `tag-leve`, `tag-sha-divergente`, `fora-do-main`]**: tag anotada (leve é recusada);
objeto tag apontando para o **commit do nome**; commit ancestral do `main` (`compare` = `ahead` ou `identical`); tag fora
do formato sob o prefixo = recusa (não ignora). Parâmetro: `-ApprovalTagPrefix` (padrão `aprovada/`).
**Assinatura**: `verification.verified` vai para o relatório, **não** é exigida. Exigir é uma decisão a mais.

### D2. Credencial

**Fatos [P]:** o repositório é **público** (`gh repo view`). Tags, execuções, lista de artefatos, `compare` e conteúdo
de arquivo respondem **sem token** — o puller rodado aqui contra a API real, sem token, devolveu `NADA_NOVO` (não há
tag `aprovada/*`). O **download** do zip do artefato exige autenticação mesmo em repositório público: `curl` anônimo em
`/actions/artifacts/<id>/zip` → **401**.

**Escopo mínimo (opção A, recomendada):** *fine-grained personal access token*, acesso **só a
`RicardoBSantos/infra-monitor`**, permissão **Actions: Read-only** (Metadata: Read vem junto). Não precisa de Contents
nem de nada de escrita **[I: o conteúdo do repo público é legível com qualquer token; confirmar no primeiro uso — se a
chamada `contents` der 403, acrescentar Contents: Read-only]**. Validade de **90 dias**.

- **Onde mora:** `C:\InfraMonitor-puller\secrets\GITHUB_TOKEN`, herança de ACL **desligada**, leitura só SYSTEM e
  Administrators. O puller **recusa** o arquivo com herança ou com outra identidade (`Test-SecretFileAcl`, o mesmo
  critério dos segredos da aplicação) **[P-lab, `token-com-heranca`]**. Nunca em arquivo versionado, nunca na linha de
  comando (o puller recebe o **caminho**), nunca em variável de ambiente da tarefa agendada.
- **Rotação:** gerar o novo, sobrescrever o arquivo, revogar o antigo no GitHub. Token vencido aparece sozinho: o
  relatório vira `RECUSADO [CREDENCIAL] ... HTTP 401` **[P-lab, `sem-token`]**.
- **Vazamento:** o pior caso é baixar artefatos de um repositório público. Não escreve nada.

**Opção B, sem token no servidor:** um workflow novo, disparado pela tag de aprovação, copia o artefato verificado para
um **asset de GitHub Release**, que é baixável anonimamente e não expira. Custa um workflow com `contents: write` no CI
(superfície nova) e não é necessária enquanto o puller baixar dentro dos 7 dias. Fica como evolução.
**Opção C, sem rede para o blob:** o operador baixa o zip em outra máquina e o deixa numa pasta de entrada; o puller
confere o SHA-256 contra o `digest` da API anônima. Não implementado; útil se a VM alcançar `api.github.com` mas não o
host do blob.

**Alcance da VM: NÃO SEI.** O operador precisa conferir, **como SYSTEM** (a tarefa roda assim, e o proxy de usuário não
vale para SYSTEM):

1. `Test-NetConnection api.github.com -Port 443`
2. `Invoke-RestMethod https://api.github.com/zen` (anônimo)
3. O download **redireciona para outro host**, de armazenamento do GitHub Actions (`*.blob.core.windows.net`; no
   laboratório anterior foi `productionresultssa15…` **[E, memória do laboratório]**). Liberar no firewall/proxy.
4. Proxy: `netsh winhttp show proxy`; variáveis `HTTPS_PROXY`; o puller aceita `-Proxy <url>`.
5. Inspeção TLS: se o proxy reassina, a CA tem de estar no repositório **da máquina**.
6. Prova final, quando instalar: rodar o puller uma vez como SYSTEM sem tag → `NADA_NOVO` prova o caminho da API (não o
   do blob).

### D3. Onde vai o relatório

Telegram fica fora (é o grupo de alerta operacional).

| Opção | Situação |
|---|---|
| **Arquivo**: `<PullerRoot>\ULTIMO.txt` (resumo + JSON) e `reports\<utc>-<status>.json` (últimos 200) | **implementado, sempre** |
| **Log de eventos do Windows** (Application, origem `InfraMonitorReleasePuller`, IDs 100 PRONTO / 101 nada novo / 200 ADIADO / 300 RECUSADO), **só quando o resultado muda** | implementado atrás de `-EventLog` **[I: `eventcreate` exige administrador para criar a origem; não executado aqui]** |
| E-mail (relay SMTP interno) | não sei se existe relay; seria o único aviso **ativo** |
| Status/comentário no GitHub | exigiria token de escrita: contraria D2 |
| Página no próprio Infra Monitor | mudança de backend; fora do escopo |

**Recomendo: arquivo + log de eventos**, e o `ULTIMO.txt` passa a ser o primeiro passo do operador na janela (substitui
o portão E1 manual). Se quiser aviso ativo, e-mail só para o responsável, se houver relay.

### D4. Agendamento

**Recomendo: tarefa agendada como SYSTEM, duas vezes por dia (ex.: 07:40 e 13:40), mais invocação manual.**

- **Por que SYSTEM:** o puller lê `config\secrets\DB_USERNAME`/`DB_PASSWORD`, cuja ACL é só SYSTEM, Administrators e o
  SID do serviço **[E, D02.10-C]**. Dar leitura a uma conta nova **quebraria** o `Prerequisites`, que recusa qualquer
  outra identidade nesses arquivos **[P, `Test-SecretFileAcl` chamado por `Test-WindowsPrerequisites`]**.
- **Frequência:** aprovação é rara; 2×/dia deixa folga larga nos 7 dias de retenção. Execução sem novidade = algumas
  chamadas à API + 1 `SELECT`; download só quando surge aprovação nova **[P-lab, `idempotente`: a segunda execução não
  baixa]**.
- **Configuração da tarefa:** "não iniciar nova instância"; parar após 30 min; sem "acordar o computador". O puller tem
  também mutex próprio: execução concorrente sai `ADIADO [CONCORRENTE]` **[P-lab, `concorrente`]**.
- **Disco (hoje 34 GiB livres [E]):** zip real 61 MiB (`c6e3f48`) **[P]**; pico ≈ zip + extração + folga. Antes de
  baixar, o mesmo portão do Stage (`Test-FreeSpacePolicy`: projetado ≥ 22 GiB, já contando 3 GiB de pico operacional);
  abaixo disso, `RECUSADO [ESPACO]` **sem baixar** **[P-lab, `disco-insuficiente`]**.
- **Poda (2.7):** só em `<PullerRoot>\packages`. Mantém a release em uso (backend e frontend do
  `deployment-state.json`), a anterior (alvos de `current\*.previous`) e a aprovada; apaga as outras **[P-lab, `poda`]**.
  Se o estado for ilegível, não poda (sai antes). **`C:\InfraMonitor\releases` não é podado**: o Stage tem a regra
  "no automatic cleanup" de propósito. O relatório traz `root.stageWouldRefuse=true` quando há 2+ releases, para o
  operador fazer a P2 à mão.

### Decisões a mais que apareceram (também a confirmar)

- **D5 — "stage" = pacote verificado em `<PullerRoot>\packages\r-<sha>`, não `C:\InfraMonitor\staging`.** O Stage do
  ferramental exige `-Apply` + ID de aprovação + confirmação, pega o mutex da implantação, recusa com 2+ releases e cria
  justamente a terceira cópia do ferramental (plano V27, 2.1). O operador continua fazendo o Stage na janela, a partir
  do caminho canônico.
- **D6 — `PullerRoot` = `C:\InfraMonitor-puller`**, fora da raiz. Recusado se um contiver o outro **[P-lab,
  `puller-dentro-do-root`]**.
- **D7 — atualização do próprio puller** é manual (copiar `Invoke-ReleasePuller.ps1` + `ReleaseTools.psm1` de um commit
  aprovado). O relatório traz o SHA-256 dos dois, para conferência.

---

## 4. Como funciona

```
mutex próprio → limpa quarentena → JANELA? → estado da raiz → token → tag aprovada → já no ar?
  → já verificado antes? (reverifica no disco, não baixa)
  → senão: execução push/main/success → artefato exato → espaço → download → digest → zip seguro
           → Test-PackageIntegrity → commit do manifesto → ferramental = blob do commit → procedência dos componentes
           → renomeia para packages\r-<sha>
  → banco (só leitura, papel da aplicação, nunca superusuário) → Test-DatabaseSchemaFit → flags → poda → relatório
```

**Saídas:** `0` = `PRONTO`, `NADA_NOVO`, `JA_NO_AR`; `3` = `ADIADO`; `1` = `RECUSADO` (com código).

**Dado não confiável (2.3):** o zip vai para `downloads\<guid>\` (novo, vazio); todos os nomes são validados **antes**
de qualquer escrita (sem `..`, sem absoluto, sem link simbólico, sem duplicata por caixa, teto de tamanho); nada de
dentro dele é executado; só vai para `packages\` depois de todas as verificações **[P-lab, `zip-com-caminho-inseguro`,
`digest-divergente`, `sha256sums-adulterado`]**.

**Banco (2.4):** papel lido de `config\secrets\DB_USERNAME`; `postgres` é recusado pelo nome, e qualquer superusuário
pela sessão (`is_superuser`) **[P-lab, `superusuario`]**. Sessão `default_transaction_read_only=on`: um
`flyway_schema_history` que escreva ao ser lido **falha** **[P-lab, `schema-guard-tests.ps1`, banco `guard_readonly`]**.

**Segredos (2.5):** token, senha e URL assinada do blob nunca saem. O texto passa por `Protect-Text` (valores conhecidos,
padrões `ghp_`/`github_pat_`, URL com query, `senha=`). Flag é reportada como `ligada`/`desligada`/`indefinida`, e só
variáveis `*_ENABLED` **[P-lab, `sem-segredos-nos-relatorios` varre todos os relatórios de todos os cenários atrás do
token, da senha do banco, da assinatura da URL e de um valor plantado no XML]**.

**Durante uma janela (2.6)** — o puller **observa e sai**, antes de falar com o GitHub ou com o banco:

| Sinal | Como | Prova |
|---|---|---|
| `PAUSA` em `<PullerRoot>` | pausa manual do operador | [P-lab, `janela-pausa`: nenhuma requisição feita] |
| Operação do ferramental viva | `Mutex.TryOpenExisting` do mesmo nome do Switch: **abre, não adquire**; o Switch do operador nunca encontra o mutex ocupado pelo puller | [P-lab, `janela-mutex`] [I: entre sessões diferentes (tarefa SYSTEM × PowerShell do operador) — o namespace `Global\` existe para isso, não exercitado] |
| `deployment.ndjson` termina em `START` | operação em curso ou interrompida | [P-lab, `janela-ndjson`] |
| evento no `deployment.ndjson` há menos de `-QuietMinutes` (120) | janela recente | [P-lab] |
| transcript `logs\implantacao-*.txt` escrito há menos de 120 min | o plano manda abrir transcript no início da janela | [I] |
| `current\*.swap` | troca de junções interrompida → `RECUSADO`, revisão humana | [P-lab, `transicao-interrompida`] |

**Recomendação operacional:** no início da janela, criar `C:\InfraMonitor-puller\PAUSA`; apagar no fim.

---

## 5. Provas

### Testes (`deployment/windows/tests/`, rodam no job Windows do `ci-windows-packaging.yml`)

- `puller-tests.ps1` — **35 cenários** contra GitHub falso (`fake-github.ps1`, HTTP sobre `TcpListener`) e PostgreSQL
  descartável; cada recusa confere **código e trecho da mensagem**, e que a raiz não mudou.
- `puller-mutation-tests.ps1` — **prova de reversão**: para cada verificação, copia puller e módulo, **remove aquela
  verificação** e roda os cenários dela; passa só se eles **falharem**. **26/26 mortas [P-lab]**:

| Verificação removida | Cenário que falha |
|---|---|
| tag anotada; sha da tag; commit no `main` | `tag-leve`; `tag-sha-divergente`; `fora-do-main` |
| `head_sha` da execução; evento `push` | `run-de-outro-commit`; `run-de-pr-com-nome-do-main`, `run-workflow-dispatch` |
| nome exato do artefato; expirado; artefato da execução certa | `artefato-nome-errado`; `artefato-expirado`; `artefato-de-outra-execucao` |
| digest presente; digest confere | `artefato-sem-digest`; `digest-divergente` |
| nome seguro no zip | `zip-com-caminho-inseguro` |
| `Test-PackageIntegrity`; commit do manifesto; ferramental; procedência dos componentes | `sha256sums-adulterado`; `pacote-de-outro-commit`; `ferramental-divergente`; `componente-de-pr` |
| espaço; superusuário; banco na faixa | `disco-insuficiente`; `superusuario`; `banco-antigo`, `banco-a-frente` |
| janela; puller fora da raiz; ACL do token; poda preserva | `janela-*`; `puller-dentro-do-root`; `token-com-heranca`; `poda` |
| **no módulo:** `Test-PackageTooling`, `Test-DeploymentOperationActive`, `-RefuseSuperuser`, `Test-DatabaseSchemaFit` | `ferramental-divergente`, `janela-mutex`, `superusuario`, `banco-antigo` |

- `schema-guard-tests.ps1` ganhou: sessão só leitura (visão com efeito colateral tem de falhar), `PGOPTIONS` restaurado,
  `-RefuseSuperuser` recusa superusuário e aceita o papel da aplicação. **Reversão [P-lab]:** sem a linha do
  `PGOPTIONS` no módulo, o teste cai em `Expected a blocked operation: Could not read`.
- `windows-tests.ps1` e `schema-guard-tests.ps1` existentes continuam verdes com o módulo refatorado **[P-lab: 22 e 25
  asserções]**.

### Ensaio com o artefato REAL do `c6e3f48` [P-lab]

Respostas **reais** da API gravadas em 2026-11-17 (execução 43890548297, artefato 14237840405, execuções dos componentes
43890548391 e 43890548168, blobs do ferramental no commit, `compare`), servidas pelo GitHub falso. Único dado sintético:
a tag de aprovação (nenhuma tag foi criada no repositório).

| Caso | Resultado |
|---|---|
| banco em **V26** (como produção hoje [E]) | `PRONTO`: banco V26 dentro de V26..V27 |
| banco em V27 | `PRONTO` |
| banco em V25 | `RECUSADO [BANCO_FORA]` |
| aprovar `90645b7` (execução de empacotamento cancelada) | `RECUSADO [RUN_AUSENTE] … push/cancelled` |
| aprovar `3df8253` (empacotamento falhou: main vermelho, ver §7) | `RECUSADO [RUN_AUSENTE] … push/failure` |

Também provado no caminho: o `digest` publicado pelo GitHub é o SHA-256 do zip baixado (`42e1f691…`), e o ferramental
do artefato é **byte a byte** o blob do commit (`ReleaseTools.psm1` `d5e1b3c5…`, `Invoke-WindowsRelease.ps1`
`84d0196f…`): não há problema de fim de linha entre o runner Linux e a API **[P]**.

### Ressalvas do laboratório

- O C: desta máquina tem ~21 GiB livres, abaixo do portão de 22 GiB. **Só no laboratório local** o puller rodou de uma
  cópia com o portão reduzido a 10 GiB (`disco-insuficiente` continuou recusando, com pico gigante). **No CI roda o
  código sem alteração.**
- Cliente `psql` 17 local contra PostgreSQL 16 em container; no servidor, o `psql` do próprio PostgreSQL 16.

---

## 6. O que NÃO foi verificado (depende do servidor real)

- **Alcance de rede** da VM até `api.github.com` e até o host do blob; proxy; inspeção TLS (D2, lista de conferência).
- Tarefa agendada como **SYSTEM**: criação, execução, leitura dos segredos, `eventcreate` [I].
- **`Global\` entre sessões**: a tarefa SYSTEM enxergar o mutex aberto pelo PowerShell do operador [I].
- Grants reais do papel da aplicação em `flyway_schema_history` [E: E8 do plano V27 mostra `sel=t`].
- Espaço real no volume do `PullerRoot` e tamanho dos pacotes futuros.
- Ruleset de tag no GitHub (D1) — configuração do responsável, não feita.

## 7. Achado lateral

O `main` em `3df8253` está **vermelho**: o PR #40 acrescentou a 57ª classe `@RequerDocker` e a documentação dizia 56
(`DocumentacaoRequerDockerTest`). Por isso a execução de empacotamento desse commit falhou. Este PR corrige a contagem
num commit separado (`docs(testes)`), que pode ir antes por cherry-pick.

## 8. Instalação (para DEPOIS da janela; não executada)

1. Confirmar D1–D7. Criar o ruleset de tag.
2. Conferências de rede da D2, como SYSTEM.
3. `C:\InfraMonitor-puller\bin\` ← `Invoke-ReleasePuller.ps1` + `ReleaseTools.psm1` de um commit aprovado; anotar os
   SHA-256.
4. Token em `C:\InfraMonitor-puller\secrets\GITHUB_TOKEN` (ACL protegida: SYSTEM + Administrators).
5. Execução manual, como SYSTEM, sem tag existente → `NADA_NOVO`.
6. Tarefa agendada (D4).
7. Primeira aprovação real: `git tag -a aprovada/r-<sha> -m "<ID de aprovação>" <sha> && git push origin aprovada/r-<sha>`.

```powershell
& 'C:\InfraMonitor-puller\bin\Invoke-ReleasePuller.ps1' -Root 'C:\InfraMonitor' -PullerRoot 'C:\InfraMonitor-puller' `
  -PostgreSQLHome 'C:\Program Files\PostgreSQL\16' -TokenFile 'C:\InfraMonitor-puller\secrets\GITHUB_TOKEN' -EventLog
```

Depois de instalado, o plano de implantação seguinte troca `$Pkg = 'C:\src\packages\…'` por
`$Pkg = 'C:\InfraMonitor-puller\packages\r-<sha>'` e o portão E1 pela leitura do `ULTIMO.txt`. **O plano da V27 não é
alterado por este PR.**

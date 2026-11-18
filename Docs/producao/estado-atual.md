# Estado atual de produção

> **Este arquivo é a fonte única para a pergunta "o que está no ar?".** Release, schema, flags e inventário de
> produção se leem **aqui**. Os documentos de fase em `Docs/validacao-producao/` (D02.10-C, D02.10-D, D02.11-A,
> D02.11-A.1 e seguintes) são **histórico**: estavam corretos na data em que foram escritos e não são atualizados
> depois. Se um deles disser outra coisa, vale este arquivo.

## Regra

**Toda mudança que altera produção atualiza este arquivo no MESMO commit — nunca depois.** Implantação de release,
migration aplicada, flag ligada ou desligada, inventário relevante. O PR da implantação não é aprovado sem o diff
deste arquivo. Campo que não foi conferido no servidor fica **A CONFERIR NO SERVIDOR**, com o comando para conferir;
nunca se preenche por dedução a partir do repositório.

*Por que existe:* em 2026-11-16 quatro documentos de fase diziam, em unanimidade, que produção estava em `r-8f593ef`
(Flyway V25). Era falso: a V26 (PR #38) já tinha sido aplicada, e ninguém atualizou os documentos. Essa unanimidade
levou a contradizer um registro correto e a investigar um risco com a premissa errada. *Reincidência:* o mesmo arquivo
dizia "3 unidades, 7 equipamentos" (valor de 11/11, repassado em 16/11); o ensaio de 18/11 leu **8 e 102**. Inventário
também é campo deste arquivo.

## Estado

**Última conferência:** **2026-11-18, ensaio de leitura no servidor** (bloco E1–E8 da Parte 1 de
`implantacao-v27-modo-tv.md`, só leitura), colado pelo responsável em PowerShell 7 como administrador na máquina
**SED-TI-D05**, às 10:28. Transcript: `C:\src\packages\ensaio-v27-20261118-1028.txt`, **no servidor, não versionado**.

*Como estes valores chegaram aqui:* o autor deste commit **não leu o transcript** (não tem acesso ao servidor). Os
valores abaixo marcados **[P, ensaio]** foram transcritos do resumo do responsável, que leu a saída. Onde o resumo não
trouxe o valor, o campo continua aberto (seção seguinte).

| Campo | Valor | Origem |
|---|---|---|
| Release no ar | **`r-921dd90321db113c8faff9f8b5e16463a3d4f614`** (merge do PR #38, sessão com refresh token, V26) | **[P, ensaio]** E7, `deployment-state.json` |
| Quando foi implantada | `Switch` **START 2026-11-12T17:12:43.69Z → SUCCESS 17:13:00.34Z = 16,7 s**, parada, subida e health incluídos | **[P, ensaio]** E7, `logs\deployment.ndjson` |
| Release anterior (`.previous`) | era `r-8f593ef…` no ensaio; **removido pela P2 em 2026-11-18** (`r-8f593ef` arquivada em `C:\InfraMonitor-arquivo`) | **[P, ensaio]** E7; P2: **[E, responsável]**, o passo 2 do roteiro de 19/11 confere |
| Manifesto da release no ar | `version = r-921dd903…`, **`schemaVersion = 25`**, **`minSchemaVersion` vazio** — com o banco em **26**. É a trava antiga declarando 25 qualquer que seja o conteúdo, agora **observada** em produção (antes era inferência, ver `D02.10-empacotamento-windows.md` e PR #41) | **[P, ensaio]** E7, `release-manifest.json` |
| Schema | **26** | **[P, ensaio]** E6 (papel da aplicação) **e** E5 (superusuário): os dois leram 26 |
| Histórico do Flyway | V24, V25 e V26 aplicadas, todas `success = t`. **V26 em 2026-11-12 14:11:47** (`installed_on` não tem fuso; em hora local UTC−03 são 17:11:47Z, **56 s antes do START do Switch**: a V26 foi aplicada e o Switch veio logo depois, a sequência do README **[I, fuso do servidor]**) | **[P, ensaio]** E8 |
| Motor ICMP | `MONITORING_ENGINE_ENABLED=true` | **[P, ensaio]** E7, XML do serviço |
| Alertas Telegram | `TELEGRAM_ENABLED=true` (grupo real, com pessoas **[E]**) | **[P, ensaio]** E7 |
| Dispatcher de notificações | `NOTIFICATION_DISPATCHER_ENABLED=true` | **[P, ensaio]** E7 |
| Manutenção agendada | `MANUTENCAO_AGENDADA_ENABLED=true` | **[P, ensaio]** E7 |
| Retenção de medições | **desligada**: `RETENTION_ENABLED` não aparece. Ausente = padrão `false` **[P, `application.yml`]**. Consequência em `pendencias.md`, P-03 | **[P, ensaio]** E7 |
| Inventário | **8 unidades (8 ativas), 102 equipamentos (102 ativos)** | **[P, ensaio]** E8 |
| Monitores | **102 ativos**, todos com intervalo de **60 s**; `falhas_para_incidente` = **10** (o monitor **92** tem **11**) | **[P, ensaio]** E8 |
| Estado operacional na conferência | **0** incidentes abertos; **nenhuma** janela de manutenção `AGENDADA`/`ATIVA`; **0** equipamentos em manutenção | **[P, ensaio]** E8 |
| Fila de notificações | **65 `ENVIADA`, 33 `FALHA`** (um terço falhando). Item aberto: `pendencias.md`, **P-01** | **[P, ensaio]** E8 |
| Credencial de superusuário | `C:\InfraMonitor\config\admin\postgres-superuser.txt` **existe**, 32 bytes, ACL **só SISTEMA e Administradores**; o E5 leu 26 com ela. Era o único caminho do deploy nunca exercitado nesta máquina | **[P, ensaio]** E4, E5 |
| Default privileges | `inframonitor_app` recebe **`arwd`** em tabelas e **`rwU`** em sequências: os grants de tabelas novas (V27) vêm sozinhos | **[P, ensaio]** E8, `pg_default_acl` |
| Raiz de implantação | No ensaio: `.previous` e 2 releases. **Depois da P2 (2026-11-18):** `current\` só com `backend` e `frontend` → `r-921dd903…`; `releases\` com 1 diretório | ensaio **[P]**; P2 **[E, responsável]**, conferida no passo 2 de `janela-v27-2026-11-19.md` |
| Cópias de ferramental no disco | **cinco** (tabela abaixo) | **[P, ensaio]** E7 |
| Tempo de subida do backend no servidor | O trecho do E7 que lia o log **não produziu saída** (defeito do bloco, corrigido no plano, 1.1). Resposta pelo `deployment.ndjson`: o `Switch` completo de 12/11 levou **16,7 s** | **[P, ensaio]** ndjson |

**Cópias de ferramental (`ReleaseTools.psm1`) no disco:**

| Caminho | SHA-256 (prefixo, do ensaio) | O que é |
|---|---|---|
| `C:\src\packages\windows-homologation-c6e3f48` | `D5E1B3C5…` | **a do portão**, a única a usar na janela. Confere com o blob de `c6e3f48` (`d5e1b3c536942ccb…`) **[P, `sha256` do blob]** |
| `C:\src\packages\windows-homologation-921dd903` | `4D353534…` | ferramental da implantação de 12/11; trava antiga |
| `C:\InfraMonitor\staging\r-921dd903…` | `4D353534…` | sobra do `Stage` de 12/11 |
| `C:\src\packages\windows-homologation-8f593ef` | `CAB53060…` | ferramental da D02.10-C (09/11) |
| `C:\InfraMonitor\staging\r-8f593ef…` | `CAB53060…` | sobra do `Stage` de 09/11 |

*Nota sobre `CAB53060…`:* o blob de `ReleaseTools.psm1` em `8f593ef` tem SHA-256 `cab5306d0d4d…` **[P]**, que é a versão
**anterior** à correção do health no PowerShell 7 (`4e8a9af`, incidente 1 da D02.10-D). Os sete primeiros caracteres
coincidem e o oitavo não (`0` × `d`). **[I]**: quase certamente o mesmo arquivo, com o prefixo transcrito com um
caractere trocado; se for, as duas cópias de `8f593ef` no disco têm o **health que reprova backend saudável no
PowerShell 7**. Conferir o hash inteiro no transcript. Nenhuma delas é usada na janela (função `Release`, plano 1.0).

## Ainda aberto depois do ensaio

**Registrados no transcript, ainda não transcritos para este arquivo** (o resumo não os trouxe; estão na saída do
E1–E8): hash **completo** do `ReleaseTools.psm1` e do `Invoke-WindowsRelease.ps1` do pacote (E1, é o que o J1 compara),
resultado do `Verify` (E2), caminho do PostgreSQL (E3), `physicalPath` do site (E7), `State`/`StartName`/`PathName` do
serviço (E7, dá o executável do WinSW para o `$WinSW` da janela), ACLs de `releases\<atual>\frontend`, `backend`,
`staging` e raiz (E7, decidem o J4), release do **frontend** separada da do backend (E7 imprime as duas).

**Não medidos pelo ensaio — A CONFERIR NO SERVIDOR:**

| Campo | Por que importa | Como conferir |
|---|---|---|
| Espaço livre em `C:` | Último valor: **34 GiB [E, D02.11-A.1]**, antes do inventário de 102. O ferramental **recusa Stage, Switch e Rollback** abaixo de ~25 GiB livres (portão de 22 GiB + pico de 3 GiB) **[P, `Test-FreeSpacePolicy`]** | J2 do plano, ou `Release -Operation Space -PackagePath $Pkg @Comum` |
| Medições nos últimos 30 dias | Confirma a estimativa do D-07 (`pendencias.md`, P-02) | consulta abaixo |
| `BOOTSTRAP_*` e demais variáveis sem `_ENABLED` | o E7 só filtra `_ENABLED` | `Select-String -Path C:\InfraMonitor\config\service\InfraMonitorBackend.xml -Pattern 'env name'` |

## Como conferir (operador, no servidor, como administrador)

Somente leitura. Raiz `C:\InfraMonitor`, serviço `InfraMonitorBackend` (D02.10-C). O caminho completo é o bloco
E1–E8 do plano de implantação (1.1); os comandos abaixo são as leituras isoladas.

**Release no ar:**

```powershell
Get-Content C:\InfraMonitor\config\deployment-state.json
(Get-Item C:\InfraMonitor\current\backend).Target
(Get-Item C:\InfraMonitor\current\frontend).Target
```

**Schema aplicado** (mesmo acesso do `ops/Backup-InfraMonitorDatabase.ps1`; o arquivo existe e lê, ensaio de 18/11):

```powershell
$env:PGPASSWORD = [IO.File]::ReadAllText('C:\InfraMonitor\config\admin\postgres-superuser.txt').Trim()
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -h 127.0.0.1 -U postgres -d inframonitor -w -At -X -c "select version, description, installed_on, success from flyway_schema_history where version is not null order by installed_rank desc limit 5"
Remove-Item Env:PGPASSWORD
```

**Flags** (as variáveis que o serviço recebe):

```powershell
Select-String -Path C:\InfraMonitor\config\service\InfraMonitorBackend.xml -Pattern '_ENABLED'
```

**Inventário** (mesma sessão `psql` acima):

```sql
-- Não excluídos logicamente; "ativos" separa os desativados (ativo = false).
select (select count(*) from unidade where deleted_at is null) unidades,
       (select count(*) from unidade where deleted_at is null and ativo) unidades_ativas,
       (select count(*) from equipamento where deleted_at is null) equipamentos,
       (select count(*) from equipamento where deleted_at is null and ativo) equipamentos_ativos;
```

**Medições nos últimos 30 dias e primeiro dia com os 102** (mesma sessão; só leitura, usa `ix_medicao_executado_em`):

```sql
select count(*) linhas_30d, min(executado_em) mais_antiga from medicao where executado_em > now() - interval '30 days';
select date_trunc('day', executado_em) dia, count(distinct monitor_id) monitores, count(*) linhas
  from medicao where executado_em > now() - interval '30 days' group by 1 order by 1;
```

Ao conferir: preencha a tabela, troque a data de "Última conferência", diga **quem** conferiu e **como**, e faça o
commit só deste arquivo, ou junto com a mudança que motivou a conferência.

## Diferença entre o repositório e produção (2026-11-18)

Produção está em `r-921dd90…` com o banco em **26**. O `main` (`3df8253`) tem a **V27** (modo TV, PR #39), a trava de
schema nova (PR #41) e o PR #40 (D-07, plano custom), que o PR #45 reverte (aberto; o `main` está com *CI Backend* e
*CI Windows Packaging* vermelhos até ele entrar). A próxima implantação é a do pacote **`c6e3f48`**
(`Docs/producao/implantacao-v27-modo-tv.md`); o ensaio de leitura passou (**E6 = 26**), a P2 foi feita em 18/11, e a
janela está marcada para **2026-11-19 às 09h**, com o roteiro `Docs/producao/janela-v27-2026-11-19.md`.

**Itens abertos de produção fora do deploy** (notificações falhando, D-07 fora da meta, retenção desligada com 102
monitores): `Docs/producao/pendencias.md`.

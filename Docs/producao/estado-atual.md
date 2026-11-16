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
levou a contradizer um registro correto e a investigar um risco com a premissa errada.

## Estado

**Última conferência:** 2026-11-16, por confirmação do responsável (não por leitura no servidor feita pelo autor deste
arquivo, que não tem acesso a produção).

| Campo | Valor | Origem |
|---|---|---|
| Release no ar (backend e frontend) | **A CONFERIR NO SERVIDOR** | — |
| Schema (última migration aplicada) | **V26 aplicada** (`sessao_usuario`, PR #38). Versão máxima exata: **A CONFERIR NO SERVIDOR** | responsável, 2026-11-16 |
| Sessão com refresh token (PR #38) | no ar | responsável, 2026-11-16 |
| Motor ICMP | **ligado**, coletando | responsável, 2026-11-16 |
| Alertas Telegram | **ligados**, em grupo real (com pessoas) | responsável, 2026-11-16 |
| Manutenção agendada | **ligada** | responsável, 2026-11-16 |
| Demais flags (dispatcher, retenção, bootstrap) — valor de cada variável | **A CONFERIR NO SERVIDOR** | — |
| Inventário | **3 unidades, 7 equipamentos** | responsável, 2026-11-16 |

## Como conferir (operador, no servidor, como administrador)

Somente leitura. Raiz `C:\InfraMonitor`, serviço `InfraMonitorBackend` (D02.10-C).

**Release no ar:**

```powershell
Get-Content C:\InfraMonitor\config\deployment-state.json
(Get-Item C:\InfraMonitor\current\backend).Target
(Get-Item C:\InfraMonitor\current\frontend).Target
```

**Schema aplicado** (mesmo acesso do `ops/Backup-InfraMonitorDatabase.ps1`):

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

Ao conferir: preencha a tabela, troque a data de "Última conferência", diga **quem** conferiu e **como**, e faça o
commit só deste arquivo, ou junto com a mudança que motivou a conferência.

## Diferença entre o repositório e produção (2026-11-16)

O `main` (`7060e28`) tem a V27 (modo TV, PR #39), que **não** consta como aplicada em produção. A próxima implantação
depende da correção da trava de schema das ferramentas de release (PR #41): com as ferramentas do `main`, o pacote
declara schema 25 qualquer que seja o conteúdo (ver `Docs/validacao-producao/D02.10-empacotamento-windows.md`).

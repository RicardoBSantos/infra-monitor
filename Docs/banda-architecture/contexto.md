# Teste de banda — contexto e achados

O que o sistema faz hoje e é relevante para o teste de banda. Base: `origin/main` 94f5689.

Os achados vêm de duas fontes:
- a investigação de 2026-11-23 (duas rodadas). Mantêm a marca original;
- a consolidação, que reconferiu no código o que está marcado [P].

Legenda em [banda-architecture.md](banda-architecture.md).

---

## Verificações V1–V4 (feitas na consolidação)

### V1 — Abertura de episódio é avaliada por nível

**É nível, não borda.**
- `LatencyEpisodeProcessor.process` roda **para cada medição persistida** do monitor
  (`LatencyEpisodeProcessor.java:65-95`) **[P]**.
- A abertura lê as últimas `latencia-ciclos` medições e exige que **todas** estejam acima do limiar
  (`ultimasMedicoes` + `sequenciaCompleta`, linhas 97-101 e 151-157) **[P]**.
- O comentário da própria classe diz "Nao mantem contador" (linhas 32-33) **[P]**.
- `iniciadoEm` é a medição mais antiga da cauda (linha 113) **[P]**.

**Com a D5 original (`suprimir_ate`), mantido como histórico [I]:**
- Um episódio real não se perdia, só atrasava.
- O risco residual era a cauda ainda conter uma medição do teste depois de `suprimir_ate`.
- A D5 revista elimina esse risco por construção (ver abaixo).

**Com a D5 revista, supressão por medição [I]:**
- **Contaminação.** A sequência avaliada é a mesma que abriria o episódio. Se ela tocou a janela de
  um teste, o episódio não abre.
  - Não existe "cauda contaminada depois da janela": enquanto alguma medição da sequência estiver
    dentro dela, o predicado segura a abertura.
  - Isso vale para qualquer intervalo de monitor, de 10 a 86400 s.
- **Episódio real.** Não se perde, só atrasa: a avaliação é por nível, então a primeira sequência
  inteira fora da janela abre o episódio.
  - O atraso é de até `ciclos` medições depois de `janela_fim`: cerca de 2 min com 60 s de
    intervalo, e mais com intervalos longos.
- **Só se perde** a degradação que cabe inteira em sequências que tocam a janela. Com `ciclos=2` e
  60 s, é algo como 1 a 2 min em torno de um teste de ~40 s, exatamente o que se quer suprimir.
- **Bordas.** O eco em voo antes de `iniciado_em` (coberto pelo `timeout_ms`, S1) e o teste que passaria de `janela_fim` (prazo duro, S3) estão resolvidos em
  [dividas.md](dividas.md#sinalizações-da-segunda-rodada--resolvidas-em-2026-11-23), itens S1 e S3.

**Conclusão:** D4 se sustenta com a D5 revista. O risco do enunciado ("perder um episódio que
transita dentro da janela") não existe porque a avaliação não é por borda.

### Item 1 — Timestamps da sequência no ponto do insert

**Os dois timestamps já estão em memória no insert. Não precisa de consulta extra [P]:**
- `processarAbertura` carrega a sequência em `List<Medicao> medicoes = ultimasMedicoes(monitorId)`.
  A lista vem em ordem **DESC** de `executadoEm, id` (`LatencyEpisodeProcessor.java:98, 151-153`).
- `sequenciaCompleta` exige exatamente `ciclos` elementos (linha 156).
- **Medição mais antiga:** `medicoes.get(medicoes.size() - 1).getExecutadoEm()`.
  - **Já é calculada** e passada ao insert como `iniciadoEm` (linhas 113-114).
  - Ou seja, o `:iniciadoEm` do SQL **é** a medição mais antiga.
- **Medição mais recente:** `medicoes.get(0).getExecutadoEm()`.
  - É igual a `medicaoPersistida.getExecutadoEm()`, porque `process` já descarta a medição
    atrasada que não é a última (linhas 69-73).
- **Mudança necessária:**
  - um parâmetro novo, `:medicaoMaisRecente`, em `inserirSeElegivel` e na chamada da linha 114;
  - o `NOT EXISTS` usa `:iniciadoEm` como a medição mais antiga.

**O que `executado_em` representa [P]:**
- É o instante **antes** de enviar o eco.
- `IcmpMonitorExecutor.execute` faz `Instant executedAt = clock.instant()` e só depois
  `commandRunner.run(...)` (`IcmpMonitorExecutor.java:38-40`).
- A resposta pode chegar até `timeout_ms` depois. Isso importa para a borda esquerda (S1).

### Item 8 — Rollback × `minSchemaVersion`

- Análise completa em [v28-proposta.md § Rollback](v28-proposta.md#rollback-e-minschemaversion),
  citando `ReleaseTools.psm1:84-125` **[P]**.
- A V28 não impede o rollback, mas ele exige `databaseAheadOfRelease=true`.
- Falta provar que o jar antigo tolera a coluna nova em `unidade`.

### V2 — D4 não toca a inserção de incidente

- A inserção de incidente é `IncidenteRepository.inserirSeElegivel` (`IncidenteRepository.java:127-138`,
  `INSERT INTO incidente` na linha 129) **[P]**.
- A inserção de episódio é outro método, em outro repositório:
  `MonitorEpisodioLatenciaRepository.inserirSeElegivel` (`MonitorEpisodioLatenciaRepository.java:33-43`),
  chamado só por `LatencyEpisodeProcessor.java:114` **[P]**.
- O `IncidentProcessor` e o `LatencyEpisodeProcessor` rodam em transações `REQUIRES_NEW` separadas
  (linhas 28-30 da classe) **[P]**.

**Confirmado:** D4 muda só o SQL das linhas 34-41 do repositório de episódio, com um
`AND NOT EXISTS (...)`. Com a D5 revista, entra também um parâmetro a mais (Item 1).

**Corrida que a decisão MA01 já apontou [P/I]:**
- `manutencao-agendada-decisoes.md` (MA01) descartou predicados que dependem "de linhas de outra
  tabela que o `FOR UPDATE OF e` não trava" **[P]**.
- O mesmo vale aqui: um `INSERT` de episódio concorrente com o `INSERT` de `teste_banda` pode não
  ver a linha nova.
- Aqui a corrida é **benigna**, desde que a linha `teste_banda` seja **commitada antes** de o iperf3
  começar. Uma medição que perde a corrida foi tomada antes do tráfego, então não está contaminada
  **[I]**.
- Isso vira requisito de implementação (D4, condição).
- **Sem lock novo** e sem tocar no `FOR UPDATE OF e` **[I]**.

### V3 — Como `updated_at` é mantido

- **Não há trigger de `updated_at`** em nenhuma migration. Os únicos triggers do schema são os de
  `janela_monitoramento` da V24 **[P]**.
- Os carimbos vêm da camada JPA:
  - `@PrePersist` grava `createdAt = updatedAt = Instant.now()`;
  - `@PreUpdate` atualiza `updatedAt`.
  - Exemplos: `Unidade.java:82,89`, `Equipamento.java:97,104`, `Incidente.java:115,122`,
    `MonitorEpisodioLatencia.java:72,79` **[P]**.
- Em bulk update ou `UPDATE` nativo, `@PreUpdate` não dispara. Nesses casos o SQL faz
  `SET updated_at = :agora` explicitamente:
  - `IncidenteRepository.java:53`, `CoberturaManutencao.java:133-188`,
    `MonitorEpisodioLatenciaRepository.java:56,68` **[P]**.
- A migration só traz `DEFAULT now()` como rede de segurança (V21) **[P]**.

**Padrão para `teste_banda` [I]:**
- `@PrePersist` e `@PreUpdate` na entidade.
- Os dois `UPDATE` condicionais de D14 (órfão no boot e no POST) e a gravação final, se for nativa,
  levam `updated_at = :agora` no `SET`.

### V4 — `solicitado_por_id` no mesmo padrão de `criado_por_id`

- `manutencao_agendada.criado_por_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT`
  (V21) **[P]**.
- O mesmo padrão aparece em `encerrada_por_id` e `cancelada_por_id` (V21), em `alterado_por_id`
  (V22), e com nome de constraint em `reconhecido_por` (V16) e `fechado_por` (V17) **[P]**.
- **Justificativa registrada na V16/V17:** `usuarios` não tem exclusão física; a desativação é
  `ativo = false` **[P]**.
- O mapeamento JPA é `@ManyToOne` + `@JoinColumn(name = "criado_por_id", nullable = false,
  updatable = false)` (`ManutencaoAgendada.java:58`) **[P]**.

**Confirmado:** `solicitado_por_id` segue o mesmo molde, inclusive `updatable = false`.

---

## Motor ICMP

- **Limiar e ciclos:**
  - `monitoring.latencia-degradada-ms` = `${MONITORING_LATENCIA_DEGRADADA_MS:250}`
    (`application.yml:99`) **[P]**;
  - `monitoring.latencia-ciclos` = `${MONITORING_LATENCIA_CICLOS:2}` (`application.yml:101`) **[P]**.
  - Os valores de produção são **desconhecidos** **[E]**.
- **Uma medição é um eco só.** Uma medição `FALHA` quebra a sequência de latência
  (`acimaDoLimiar`, linhas 160-163) **[P]**.
- **Intervalo:**
  - é por monitor: `monitor.intervalo_segundos`, com `CHECK BETWEEN 10 AND 86400` (V5) **[P]**;
  - em produção, 60 s **[E]**.
- **O motor não pinga equipamento em manutenção** (`MonitorRepository.java:45`,
  `e.emManutencao = false`) **[P]**.
- **Efeito de um teste de até 30 s:** cada monitor faz no máximo 1 medição durante o tráfego. Com
  `ciclos=2`, isso sozinho não abre episódio. Incidente exige 10 falhas seguidas **[I]**.
- **Quando pode abrir:** latência já degradada antes do teste, dois testes próximos, fila que
  continua cheia depois do iperf3, ou produção com `ciclos=1` **[I]**. É o que D4 e D5 cobrem.
- **Executável externo:**
  - o único `ProcessBuilder` é o de `ProcessoPingIcmpRunner.java:26`, que chama `ping` pelo nome,
    sem shell **[P]**;
  - no Windows ele é o plano B do JNA `IcmpSendEcho` **[E]**.

## Manutenção e por que não serve

- **Estado:**
  - `equipamento.em_manutencao` é o estado efetivo: botão manual OU janela agendada ativa
    (V21, MA01) **[P]**;
  - a janela tem escopo `UNIDADE` ou `EQUIPAMENTOS`. Não há modo global **[P]**.
- **Efeitos:** o motor para de pingar, os incidentes e episódios abertos são fechados, a janela de SLA
  fecha e o Telegram é avisado (`MANUTENCAO_*`, `*_ENCERRADA_MANUTENCAO`) **[E, investigação]**.
- **Ritmo:** o reconciliador roda a cada 30 s **[E]**.
- **Autor obrigatório:** `criado_por_id NOT NULL` **[P]**.

**Por que não serve para o teste [I]:**
- interromperia o ping, que é justamente o que se quer observar;
- distorceria o SLA;
- geraria de 2 a 4 mensagens de Telegram por teste;
- só ativaria no tick de 30 s, quando o teste já estaria pela metade.

## IIS / ARR

- `deployment/windows/web.config.template` só tem regras de rewrite (`/api/v1` →
  `http://127.0.0.1:8080/api/v1{R:1}`, linha 52) e regras de saída de `Cache-Control`. **Não há
  `responseBufferLimit`** nem configuração de buffering **[P]**.
- O proxy ARR está habilitado no servidor, com timeout de 2 min, e isso **não está versionado**
  **[E, D02.10-D]**.
- **SSE exigiria:**
  - `responseBufferLimit=0` e desligar a compressão dinâmica na rota, fora do repositório;
  - conviver com o timeout de 2 min **[I]**.
- **Polling de 1 s:** cerca de 30 GETs por teste, para um usuário só **[I]**. Daí D10.

## WinSW, conta do serviço e ACL

- WinSW 2.12, `<serviceaccount>` (`winsw.xml.template:24-30`), `<stoptimeout>45sec</stoptimeout>`
  (linha 31) **[P]**.
- O XML define só `DB_*` e `CORS_ALLOWED_ORIGINS`, **sem `PATH`** (linhas 14-18) **[P]**.
- A conta é a virtual `NT SERVICE\InfraMonitorBackend` **[E]**.
- **Desdobramentos:**
  - `BANDA_TESTE_EXECUTAVEL` precisa de caminho absoluto (D13) **[I]**;
  - a pasta do iperf3 precisa de ACL de leitura e execução para o SID do serviço. É a mesma classe de
    falha do 500 por ACL no IIS na troca de release **[E, memória]**;
  - parar o serviço não mata o processo filho. Daí `destroyForcibly` no shutdown e `-t` curto
    (D14) **[E]**.
- **Firewall:**
  - a saída da D05 não está documentada, e o padrão do Windows permite saída **[E/I]**;
  - a entrada no servidor da unidade é nova: TCP 5201, ou outra porta, aberta só para o IP da D05
    (D9) **[I]**.

## Controle de aplicativos: por que o `iperf3.exe` não roda (diagnóstico de 2026-11-24)

Diagnóstico **somente leitura** na `SED-TI-D07` (Windows 11 Enterprise 10.0.26200, domínio
`sesc-se.lan`), sessão do usuário `SESC-SE\rbfilho`. Nada foi contornado: sem `Unblock-File`, sem
copiar o binário para outra pasta, sem mexer em política, Defender ou ACL. Arquivo examinado: o
`iperf3.exe` extraído do artefato da execução
[45215529546](https://github.com/RicardoBSantos/infra-monitor/actions/runs/45215529546).
O bloqueio e o que falta decidir estão em [dividas.md](dividas.md) e na D17 de
[decisoes.md](decisoes.md).

**Conclusão [P]: quem bloqueia é a regra de ASR do Microsoft Defender
`01443614-CD74-433A-B99E-2ECDC07BFC25`** ("bloquear executáveis, a menos que atendam a um critério de
prevalência, idade ou lista confiável"). Nenhum outro mecanismo participa.

| # | Mecanismo | O que foi lido | Resultado |
|---|---|---|---|
| 1 | Marca da internet | `Get-Item -Stream *` | Só o fluxo `:$DATA` (710.409 bytes). **Sem `Zone.Identifier`** **[P]** |
| 2 | ACL | `icacls` do arquivo, da pasta e da pasta pai | `SESC-SE\rbfilho:(I)(F)`, mais SISTEMA e Administradores com controle total. O usuário tem leitura e execução de sobra **[P]** |
| 3 | AppLocker | `Get-AppLockerPolicy -Effective -Xml`; log `AppLocker/EXE and DLL` | Política efetiva **vazia**, sem nenhuma coleção. `AppIDSvc` parado (manual). Nenhum evento desde 23/11 **[P]** |
| 4 | SRP | `HKLM\SOFTWARE\Policies\Microsoft\Windows\Safer\CodeIdentifiers` | A chave existe: `DefaultLevel=262144` (irrestrito), duas regras de caminho irrestritas (`%SystemRoot%`, `%ProgramFilesDir%`), **nenhuma regra de bloqueio**. Nada em HKCU **[P]** |
| 5 | WDAC | `Win32_DeviceGuard`; log `CodeIntegrity/Operational`; `CiTool` | `UsermodeCodeIntegrityPolicyEnforcementStatus=0` (sem política para modo usuário). Nenhum evento citando iperf3 ou cygwin. `CiTool --list-policies` recusado (`0x80070005`) **[P]** |
| 6 | Defender | `Get-MpThreatDetection`, `Get-MpThreat`, log `Windows Defender/Operational` | **Nenhuma detecção de malware.** Três eventos **1121** da regra ASR `01443614-…` (abaixo). Nenhum evento cita a `cygwin1.dll` **[P]** |
| 7 | GPOs | `gpresult /r /scope computer` (recusado: "Acesso negado"); lista lida em `HKLM\...\Group Policy\State\Machine\GPO-List` | 20 GPOs de computador, nenhuma com nome de controle de aplicativos ou Defender **[I]**. **As chaves de ASR que uma GPO criaria não existem** (`Policies\Microsoft\Windows Defender\Windows Defender Exploit Guard\ASR`) **[P]** |

**Eventos 1121 que citam o `iperf3.exe` [P]** (horário local, UTC-03):

| Horário | Usuário | Processo | O que aconteceu |
|---|---|---|---|
| 2026-11-23 13:25:15 | `SESC-SE\rbfilho` | `powershell.exe` | Primeira tentativa de execução. O arquivo tinha sido criado às 13:24:51 |
| 2026-11-23 13:25:17 | idem | idem | Segunda tentativa, pelo caminho curto (`DCE6E5~1\…`) |
| 2026-11-24 10:35:33 | idem | idem | **Leitura** para calcular o SHA-256 (`Get-FileHash`), durante este diagnóstico. **A regra bloqueia até a leitura do arquivo**, por isso o hash não foi reconferido na D07 |

No mesmo log há 183 eventos 1121 da regra `9E6C4E1F-…` (proteção de credenciais do LSASS, ligada ao
SysMain), sem relação com o iperf3.

**Origem da política [I, forte]:** Intune ou Microsoft Defender for Endpoint (MDE), não GPO.
- A máquina está inscrita no Intune (`HKLM\SOFTWARE\Microsoft\Enrollments`, provedor `MS DM Server`,
  tenant `sesesc.onmicrosoft.com`) e cadastrada no MDE (`OnboardingState=1`) **[P]**.
- A GPO "Define - Registro Intune Estacoes" faz a inscrição; nenhuma GPO aplicada traz ASR **[P/I]**.
- A prova direta seria a chave `HKLM\SOFTWARE\Policies\Microsoft\Windows Defender\Policy Manager`,
  que recusou a leitura nesta sessão. Fica com o administrador do Intune/MDE.

**O que permitiria a execução (todas as vias com o administrador do Intune/MDE):** indicador
"Permitir" por SHA-256, exclusão de ASR por caminho, ou binário assinado com indicador de
certificado. Prós e contras na D17.

### D05 e conta de serviço

- **A D05 está no mesmo domínio e na mesma OU que a D07? Sem registro no repositório.**
  - A D07 está em `OU=Computadores,OU=TecnologiaDaInformacao,OU=Sede,OU=SESC-SE,DC=sesc-se,DC=lan`
    **[P]**.
  - A D05 roda o `IntuneManagementExtension`
    (`Docs/validacao-producao/D02.10-B-infraestrutura-windows.md:95`) **[E]**, logo também é
    gerenciada pelo Intune.
  - `D02.11-A.1-estabilizacao-operacional.md:157` escreve `DOMÍNIO\SED-TI-D05$`: indica máquina no
    domínio, sem nomear o domínio **[E]**. O nome `SED-TI-*` sugere a mesma OU **[I]**.
- **Mudaria algo para a conta virtual `NT SERVICE\InfraMonitorBackend`?**
  - AppLocker e SRP: não, porque na D07 não há nenhuma regra por SID **[P]**.
  - **ASR não filtra por usuário nem por SID.** Só tem exclusões por caminho e indicadores. A conta
    de serviço seria bloqueada igual **[I, documentação da Microsoft; não provado na D05]**.
- **Como a política vem do tenant e não da OU, ela deve valer para toda máquina com o mesmo perfil
  de ASR**, inclusive os servidores das unidades **[I]**.

### Roteiro somente leitura para a D05 (e para um servidor de unidade)

- Rodar em janela combinada, num Windows PowerShell 5.1 elevado, **sem copiar nenhum binário** para
  a máquina.
- **O roteiro escreve um arquivo:** a transcrição em `C:\src\packages\`, a mesma pasta da transcrição
  do ensaio de 18/11. É a única escrita. Se a pasta não existir na máquina, trocar o caminho antes de
  rodar.
- **Repetir o mesmo roteiro num servidor de unidade.** A D05 é o cliente, mas o servidor iperf3 roda
  na unidade, e a política de servidor pode ser outra.

```powershell
$out = "C:\src\packages\leitura-asr-$env:COMPUTERNAME-$(Get-Date -f yyyyMMdd-HHmm).txt"
Start-Transcript -Path $out
Get-CimInstance Win32_ComputerSystem | Format-List Name,Domain,PartOfDomain
(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Group Policy\State\Machine').'Distinguished-Name'
gpresult /r /scope computer
dsregcmd /status
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Advanced Threat Protection\Status' -EA SilentlyContinue | Format-List OnboardingState,OrgId
Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Enrollments' | % { $p = Get-ItemProperty $_.PSPath; if ($p.ProviderID) { "$($_.PSChildName) $($p.ProviderID)" } }
Get-AppLockerPolicy -Effective -Xml; Get-Service AppIDSvc
Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Safer\CodeIdentifiers' -EA SilentlyContinue
Get-CimInstance -Namespace root\Microsoft\Windows\DeviceGuard Win32_DeviceGuard | Format-List *Enforcement*
CiTool.exe --list-policies
Get-MpComputerStatus | Format-List AMRunningMode,IsTamperProtected,AMProductVersion,AntivirusSignatureVersion
$p = Get-MpPreference; for ($i = 0; $i -lt @($p.AttackSurfaceReductionRules_Ids).Count; $i++) { "$($p.AttackSurfaceReductionRules_Ids[$i]) = $($p.AttackSurfaceReductionRules_Actions[$i])" }
$p.AttackSurfaceReductionOnlyExclusions
Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Windows Defender/Operational'; Id=1121,1122} -MaxEvents 500 -EA SilentlyContinue |
  % { if ($_.Message -match 'ID: ([0-9A-F-]{36})') { $matches[1] } } | Group-Object | Format-Table Name,Count
Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CodeIntegrity/Operational'; Id=3033,3077} -MaxEvents 50 -EA SilentlyContinue | Format-List TimeCreated,Id,Message
Stop-Transcript
```

**Como ler o resultado:**
- `01443614-…` com ação `1` (bloquear) ou `6` (avisar): a máquina bloqueia como a D07.
- Ação `2` (auditar): não bloqueia, só registra o evento 1122.
- Regra ausente: não bloqueia por ASR.
- Se `Get-MpPreference` falhar como na D07 (`0x8007000d`), a resposta vem dos eventos 1121/1122 já
  existentes ou do portal do MDE, com o administrador.

## Gráfico

- O projeto **não tem biblioteca de gráfico**. O drawer de equipamento desenha em SVG próprio, com
  `polyline` por trecho. `y` nulo vira lacuna (`segmentosLatencia`) **[E, investigação]**.
- Não há medidor ou gauge em `shared/`. O velocímetro será SVG próprio (D12) **[E/I]**.
- A projeção em `viewBox` e a lógica de trechos servem para a curva do teste e para o histórico
  **[I]**.

## Status

- O `StatusBadgeComponent` tem `SUCESSO` → "Sucesso"/`success` e `FALHA` → "Falha"/`danger`
  (`status-badge.component.ts:11,18`) **[P]**.
- Não há chave com o sentido de "em execução": `ENVIANDO` é "Em envio"/`info` e `ATIVA` é
  "Ativa"/`info` (linhas 11, 18, 20) **[P]**. Daí D11.

## Perfis

- Os papéis são `ADMIN`, `OPERADOR` e `VISUALIZADOR` (V12, `ck_usuarios_papel`) **[P]**.
- Regras em `SecurityConfiguration.java` **[P]**:

| Linhas | Rotas | Papéis |
|---|---|---|
| 13 | `GET /api/v1/**` | os três papéis |
| 14-17 | `POST`, `PUT`, `PATCH` e `DELETE` em `/unidades/**`, `/equipamentos/**`, `/monitores/**`, `/manutencoes/**` e afins | ADMIN e OPERADOR |
| 18 | qualquer outra rota `/api/**` | só ADMIN |

- **Consequências:**
  - `POST /api/v1/testes-banda` cai na linha 18 e fica **só ADMIN** sem regra nova **[P]**;
  - `PUT` e `DELETE /api/v1/unidades/{id}/ponta-banda` caem nas linhas 15 e 17 e ficam
    **ADMIN+OPERADOR** **[P]**. Isso é intencional pela D7 detalhada: a ponta é cadastro;
  - o histórico (`GET`) fica visível aos três papéis **[P]**.

## Segurança em dev

- `IcmpRedeRealIT` pinga IPs reais. Fica fora da suíte padrão pela tag `rede-real` **[E, investigação]**.
- Os e2e apontam para `API_PORT`, que por padrão é **8080** (`e2e/api-porta.cjs:6`) **[P]**. A 8080
  já rodou com motor e Telegram de produção ligados **[E, memória]**. Ver dividas.md.
- Os IPs do dev e da carga colidem com a rede real **[P-lab + E]**.
- Hoje nenhum código executa iperf3 **[P]**.

# Teste de banda — plano de laboratório

**Revisto em 2026-11-23: não existe Windows Server de laboratório.** O plano tem três partes:

| Parte | O que prova | Onde | Depende de |
|---|---|---|---|
| [A](#parte-a--binário-no-windows-sem-windows-server) | O binário, o serviço e a proteção de acesso no Windows | Um Windows 10/11 fora de produção (servidor) e a D07 (cliente) | **Bloqueada pelo ASR** até a liberação (A.0, D17 pendente) |
| [B](#parte-b--calibração-da-margem-de-fila-docker-na-d07) | A margem de fila da `janela_fim` (D5) | Containers Linux na D07 | **Bloqueada na D07**: reconferido em 2026-11-24 (B.0) |
| [C](#parte-c--supressão-e-rollback-na-implementação-não-é-laboratório) | A supressão (g) e o rollback da V28 (h) | Testes de integração e ensaio de implantação | Código da feature e V28 |

- Tudo aqui é **[I]** até ser executado. Ao executar, cada passo recebe **[P-lab]** com data e
  evidência, no formato de `Docs/producao/janela-v27-2026-11-19.md`.
- O roteiro anterior (itens c a h, com gargalo e Windows Server de laboratório) foi substituído por
  este. O item (e) já tinha sido retirado no PR #49 (D16 fechada).

## Regras de isolamento (valem para as três partes)

1. **Nenhum banco de dev (5434) nem da carga (5436).** Os IPs do dev colidem com a rede real, como
   10.79.10.6, o AD real **[P-lab + E]**. A Parte A e a Parte B não usam banco nenhum. A Parte C usa
   Testcontainers (C.g) ou um PostgreSQL descartável criado só para o ensaio (C.h).
2. **Nenhum Telegram.** Nenhuma parte sobe backend com Telegram. Onde houver backend (C.h),
   `TELEGRAM_ENABLED=false` e `NOTIFICATION_DISPATCHER_ENABLED=false`.
3. **Nenhuma instância na 8080 nem na 8081.** A 8080 pode mandar Telegram de produção **[E]**.
4. Nada toca a WAN de produção nem equipamento de unidade.

---

## Inventário da D07 [P, 2026-11-23]

Lido nesta sessão, somente leitura (exceto os containers de prova, removidos com `--rm`).

| Item | Valor |
|---|---|
| Máquina | `SED-TI-D07`, domínio `SESC-SE` |
| Windows | Windows 11 Enterprise 25H2, versão 10.0.26200, 64 bits |
| Usuário da sessão do Claude Code | `SESC-SE\rbfilho` |
| Administrador? | Membro de `BUILTIN\Administradores`, mas o token da sessão **não é elevado**: o grupo aparece como "usado apenas para negar", nível de integridade **Médio** (`S-1-16-8192`), UAC ligado (`EnableLUA=1`) |
| Consequência | **O Claude Code não cria conta local, serviço nem regra de firewall nesta sessão.** Isso exigiria um terminal "Executar como administrador", com o prompt do UAC aceito por uma pessoa |
| Docker | Docker Desktop, cliente e servidor 27.5.1, engine `linux/amd64`, contexto `desktop-linux` |
| WSL | 2.4.12.0, kernel `5.15.167.4-microsoft-standard-WSL2` |
| Recursos da VM do Docker | 24 CPUs, ~7,6 GiB de memória |
| Docker funcional? | Sim: `docker run` de `alpine:3.20` com `apk add iproute2 iperf3` funcionou |
| `tc` no kernel do Docker | **`tbf`, `netem`, `htb` e `cake`: "Specified qdisc kind is unknown".** Só `fq_codel` e `pfifo` são aceitos. Na config do kernel: `# CONFIG_NET_SCH_TBF is not set`, `# CONFIG_NET_SCH_NETEM is not set`, `# CONFIG_NET_SCH_HTB is not set`, `# CONFIG_IFB is not set`, e não há `CONFIG_NET_ACT_POLICE` |
| Microsoft Defender | Proteção em tempo real ligada |
| AppLocker | Nenhuma regra efetiva retornada |
| Smart App Control | Desligado (`VerifiedAndReputablePolicyState=0`) |
| **ASR** | **A regra `01443614-CD74-433A-B99E-2ECDC07BFC25` bloqueia o `iperf3.exe` da build.** Evento 1121 do Defender, "Microsoft Defender Exploit Guard bloqueou uma operação que não é permitida por seu administrador de TI", às 16:25:15Z e 16:25:17Z, caminho do `iperf3.exe` baixado da execução [45215529546](https://github.com/RicardoBSantos/infra-monitor/actions/runs/45215529546). No PowerShell, a execução falha com "Acesso negado" |

- A regra `01443614-…` é a do ASR que bloqueia executáveis "a menos que atendam a um critério de
  prevalência, idade ou lista confiável" **[E, documentação da Microsoft]**. Um binário novo, sem
  assinatura e sem histórico de prevalência, cai nela **[I]**.
- A política vem do domínio (administrador de TI), não da máquina **[I]**.
- **Atualização de 2026-11-24 (diagnóstico somente leitura):**
  - a política chega pelo **Intune/MDE**, não por GPO **[I, forte]**: a máquina está inscrita no
    Intune e cadastrada no MDE, e não existem as chaves de ASR de GPO **[P]**;
  - AppLocker, SRP, WDAC, a marca da internet e a ACL foram descartados **[P]**;
  - **a regra bloqueia até a leitura do arquivo extraído** (`Get-FileHash` gerou outro 1121)
    **[P]**.
  - Diagnóstico completo e roteiro para a D05: `contexto.md` (PR #51).

---

## Parte A — binário no Windows (sem Windows Server)

### A.0 Pré-condição: o binário precisa poder rodar

> **⛔ PARTE A BLOQUEADA pelo ASR (2026-11-24).** Nenhum caso da Parte A roda antes da liberação.
>
> - Regra ASR `01443614-…`, eventos 1121 na D07 **[P]**.
> - Dono da liberação: o **administrador do Intune/MDE**.
> - Forma: **D17, pendente**. Recomendado: indicador "Permitir" por SHA-256 (PR #51).
> - Os hashes a liberar são os da **Release oficial
>   [`iperf3-v3.22.1-cygwin.10`](https://github.com/RicardoBSantos/infra-monitor/releases/tag/iperf3-v3.22.1-cygwin.10)**
>   (execução 45407615612):
>   - `iperf3.exe`: `0f2e15029a3aaaab5043b609876b4d0d7ec6a2222163727c153d458cf2ab8a0a`;
>   - `cygwin1.dll`: `ed9d5379061e5de79c3375cc62246c2142ea1c97d94f4d16bfbea6fb1b7fc889`.
> - **Na D07, não extrair nem executar o binário** antes da liberação: cada tentativa gera um 1121
>   novo. Para conferir hashes, ler o zip em memória, como em `build-iperf3.md` (PR #51).

**Hoje não roda na D07 [P].** Antes de qualquer caso da Parte A:

1. Pedir à TI uma exceção do ASR para o `iperf3.exe`, ou confirmar que outra via (assinatura de
   código, lista confiável) é a escolhida. **Decisão do responsável, não deste plano.**
2. Registrar a forma da exceção (caminho, hash ou certificado) e a data.
3. Atenção: **a build não é reprodutível** ([build-iperf3.md](build-iperf3.md)). Uma exceção por hash
   vale só para aquele artefato. Cada build nova pede outra **[P/I]**.
4. Conferir no Windows 10/11 servidor se a mesma política de ASR se aplica (máquina no domínio ou
   não), e registrar.

### A.1 Máquinas

| Papel | Máquina | Condição |
|---|---|---|
| Servidor iperf3 | Um Windows 10 ou 11 **fora de produção**, a escolher | Não é servidor de unidade, não é a D05, não hospeda nada de produção. Registrar nome, versão, build, perfil de rede (`Get-NetConnectionProfile`) e se está no domínio |
| Cliente | D07 | Não precisa de privilégio de administrador para rodar `iperf3 -c` **[I]** |
| Terceira origem (só no caso A.3) | Outra máquina qualquer da LAN, fora de produção | Só roda `iperf3 -c` ou `Test-NetConnection`; nada é instalado nela |

- **Quem executa o quê:** tudo o que muda o servidor (conta, serviço, firewall) roda **na própria
  máquina servidora**, num PowerShell "Executar como administrador", por uma pessoa. O Claude Code
  da D07 não está elevado e não faz isso remotamente.

### A.2 Condição de tráfego (vale para todos os casos)

- **Todo `iperf3 -c` usa `-b 100M` e `-t 10`**, exceto o caso de `--server-max-duration`, que pede
  `-t 300` justamente para ser cortado.
- Motivo: não saturar a LAN do escritório. A Parte A prova comportamento do binário, não banda.
- Fazer fora do horário de pico e avisar a equipe de rede antes.
- Registrar no resultado a vazão medida. Se ela ficar acima de 100 Mbit/s, o `-b` não foi respeitado
  e o caso para.

### A.3 Preparação do servidor

1. **Binário:** o zip da Release oficial `iperf3-v3.22.1-cygwin.10`
   (SHA-256 `47de9236f7baa5aac8a0817e26e550fd37f2ca1481bb94804759bd5ad848dab2`), com cada arquivo
   conferido contra `SHA256SUMS` (`sha256sum -c` ou `Get-FileHash`). Nenhum binário de outra fonte,
   nem o de uma execução não publicada.
2. **Pasta:** `C:\iperf3\` com os 8 arquivos do zip. ACL: leitura e execução para a conta do
   serviço; escrita só para administradores.
3. **Conta local de baixo privilégio:**
   ```powershell
   New-LocalUser -Name svc-iperf3 -Password (Read-Host -AsSecureString) `
     -PasswordNeverExpires -UserMayNotChangePassword -Description 'iperf3 laboratorio'
   ```
   - Fora de `Administradores` e de `Usuários da Área de Trabalho Remota`.
   - Direito "Fazer logon como serviço", concedido pelo próprio WinSW ou por `secpol.msc`.
   - Negar logon interativo.
4. **Serviço WinSW:** a mesma linha do WinSW do projeto, 2.12.0 x64 .NET Framework
   (`deployment/windows/winsw.xml.template:4`) **[P]**, com o executável trazido à parte e
   conferido por hash, copiado como `C:\iperf3\iperf3-service.exe` ao lado de `iperf3-service.xml`
   e instalado com `iperf3-service.exe install`.
   ```xml
   <service>
     <id>iperf3</id>
     <executable>C:\iperf3\iperf3.exe</executable>
     <arguments>-s -p 5201 -B &lt;ip-servidor&gt; --server-max-duration 20 --idle-timeout 30 --forceflush</arguments>
     <serviceaccount><domain>.</domain><user>svc-iperf3</user><password>…</password><allowservicelogon>true</allowservicelogon></serviceaccount>
     <onfailure action="restart" delay="10 sec"/>
     <log mode="roll-by-size"/>
   </service>
   ```
   - `-B`, `--server-max-duration`, `--idle-timeout`, `--forceflush` e `--json-stream` constam do
     `--help` desta build (saída `help.txt` da execução 45215529546) **[P]**.
5. **Regra de entrada restrita ao IP do cliente:**
   ```powershell
   New-NetFirewallRule -Name iperf3-lab -DisplayName 'iperf3 laboratorio' -Direction Inbound `
     -Protocol TCP -LocalPort 5201 -RemoteAddress <IP-da-D07> -Program C:\iperf3\iperf3.exe `
     -Profile Any -Action Allow
   ```
   - Nenhuma outra regra de entrada para a 5201. Conferir com
     `Get-NetFirewallPortFilter | Where-Object LocalPort -eq 5201`.
6. **Antes de começar, fotografar o estado** para a reversão:
   `Get-Service`, `Get-LocalUser`, `Get-NetFirewallRule` salvos em arquivo.

### A.4 Casos

| # | Caso | Como | Esperado | Registrar |
|---|---|---|---|---|
| A-1 | Serviço com conta de baixo privilégio | `Get-CimInstance Win32_Service -Filter "Name='iperf3'"` e `Get-Process iperf3 -IncludeUserName` | `StartName = .\svc-iperf3`; processo sob essa conta | Saída dos dois comandos |
| A-2 | `-B` | `Get-NetTCPConnection -LocalPort 5201 -State Listen` | Escuta só em `<ip-servidor>`, não em `0.0.0.0` | Saída |
| A-3 | Outra origem é recusada | Da terceira máquina: `iperf3 -c <ip-servidor> -b 100M -t 10` e `Test-NetConnection <ip-servidor> -Port 5201` | Timeout de conexão; `TcpTestSucceeded: False`. Da D07, o mesmo comando funciona | As duas saídas, com os IPs de origem |
| A-4 | `--server-max-duration` corta `-t 300` | Da D07: `iperf3 -c <ip-servidor> -b 100M -t 300 -J` | O servidor encerra em ~20 s. O cliente termina com erro ou resultado parcial | Duração real, mensagem do cliente, log do serviço |
| A-5 | Segunda conexão recebe "server busy" | Com um teste em curso, segundo cliente da D07 | Erro de "server busy" no segundo cliente; o primeiro teste não é afetado | Mensagem exata |
| A-6 | Processo morto no meio | Matar o `iperf3` **cliente** no meio de um `-t 10` | O servidor volta a aceitar dentro do `--idle-timeout` (30 s) | Tempo até aceitar de novo |
| A-6b | Processo morto no meio, lado servidor | `Stop-Process` do `iperf3` do serviço durante um teste | O WinSW reinicia em ~10 s (`onfailure`); o cliente falha com erro de conexão | Tempo de volta; mensagem do cliente |
| A-7 | `--json-stream` amostra a amostra | Da D07: `iperf3 -c <ip-servidor> -b 100M -t 10 --json-stream`, lendo a saída **linha a linha** enquanto o teste corre, com o horário de chegada de cada linha | Um objeto por linha, `event` = `start`, `interval` (1 por segundo, chegando durante o teste, não no fim) e `end`; `end.sum_received` nos dois sentidos (repetir com `-R`) | Horário de chegada de cada linha; contagem de `interval` |
| A-8 | Defender e SmartScreen diante do binário sem assinatura | Copiar o zip para a máquina como um operador faria (download pelo navegador, que marca o arquivo com Mark-of-the-Web) e rodar `iperf3.exe --version` | **Já provado na D07: o ASR bloqueia** (inventário) **[P]**. No servidor: registrar se aparece SmartScreen, ASR ou bloqueio do Defender, e o evento (`Microsoft-Windows-Windows Defender/Operational`) | Evento, regra e o que foi preciso para liberar |

- **Fora da Parte A, e por quê:**
  - CPU do servidor (antigo item c): um Windows 10/11 de escritório não representa o servidor da
    unidade. Fica para a primeira instalação real (risco residual, abaixo).
  - Comportamento do backend (FALHA quando o servidor está fora, INTERROMPIDO_REINICIO,
    processo órfão): é código da feature e vai para a [Parte C](#parte-c--supressão-e-rollback-na-implementação-não-é-laboratório).

### A.5 Reversão

No servidor, PowerShell elevado:

```powershell
& C:\iperf3\iperf3-service.exe stop
& C:\iperf3\iperf3-service.exe uninstall
Remove-NetFirewallRule -Name iperf3-lab
Remove-LocalUser -Name svc-iperf3
Remove-Item C:\iperf3 -Recurse          # só depois das três conferências abaixo
```

**Conferência — nada pode ter ficado:**

```powershell
Get-Service iperf3 -ErrorAction SilentlyContinue                    # vazio
Get-LocalUser svc-iperf3 -ErrorAction SilentlyContinue              # vazio
Get-NetFirewallRule -Name iperf3-lab -ErrorAction SilentlyContinue  # vazio
Get-NetFirewallPortFilter | Where-Object LocalPort -eq 5201         # vazio
Get-Process iperf3 -ErrorAction SilentlyContinue                    # vazio
Get-NetTCPConnection -LocalPort 5201 -ErrorAction SilentlyContinue  # vazio
```

- Comparar com a foto do estado tirada em A.3, item 6.
- O direito "Fazer logon como serviço" concedido à conta: conferir em `secpol.msc` que o SID órfão
  não ficou na lista.
- Na D07: apagar o zip e a pasta extraída. Nada foi instalado nela.
- Se houve exceção de ASR só para o laboratório, pedir à TI a remoção e registrar.

### A.6 Risco residual declarado

- **O comportamento específico do Windows Server fica [I]** até a primeira instalação numa unidade:
  - CPU durante o teste;
  - política de ASR e Defender do servidor (pode ser outra);
  - perfil de firewall `Domain`;
  - direitos de logon como serviço impostos por GPO de servidor.
- **Reduz o risco, sem eliminar:** o binário já rodou em Windows Server 2022 no runner do CI
  (`runnervmhh3zg`, image win22), em loopback, como processo comum e não como serviço **[P]**.
- **Como a primeira instalação acontece:**
  - em **janela combinada** com a unidade;
  - com os casos A-1 a A-8 repetidos ali, com `-b` e `-t` da A.2;
  - com a **desinstalação da A.5 como reversão**, já ensaiada na Parte A.

---

## Parte B — calibração da margem de fila (Docker na D07)

**Objetivo:** substituir os **10 s provisórios** da margem de fila da D5 por um valor medido.

### B.0 Bloqueio [P, 2026-11-23]

> **A Parte B, como desenhada, não roda na D07 hoje.**
>
> - O kernel da VM do Docker Desktop (`5.15.167.4-microsoft-standard-WSL2`) não tem `tbf`,
>   `netem`, `htb`, `cake`, `ifb` nem `police` (inventário acima).
> - Sem nenhum deles não existe gargalo: os containers trocam tráfego na velocidade da memória, a
>   fila não enche, e a medição sairia "zero", sem provar nada.
> - **A margem de fila continua com os 10 s provisórios.**
>
> **Reconferido em 2026-11-24 [P-lab]**, mesmo Docker Desktop 27.5.1, mesmo kernel
> `5.15.167.4-microsoft-standard-WSL2`:
>
> - Na config do kernel (`/proc/config.gz`), **nenhum qdisc que modele tráfego**. Só `fifo`,
>   `fq_codel`, `multiq` e `ingress` estão ligados. Ausentes: `tbf`, `netem`, `htb`, `hfsc`, `fq`,
>   `sfq`, `prio`, `red`, `cake`, `codel`, `pie`, `drr`, `qfq`, `cbs`, `etf`, `taprio`. Também não
>   há `ifb` nem as ações `police` e `gact`.
> - A topologia da B.1 foi montada: projeto `banda-lab`, duas redes `internal: true`, roteador com
>   `NET_ADMIN` e `ip_forward=1`, imagem `alpine` fixada por digest. No roteador:
>   - `tc qdisc add dev eth1 root handle 1: <tbf|netem|htb|hfsc|fq|sfq|prio|red>` →
>     `Error: Specified qdisc kind is unknown.`, em todos;
>   - `tc filter … police rate 20mbit` → `Error: Failed to load TC action module.`
> - **Achado lateral [P-lab]:** com as duas redes `internal: true`, o ping do cliente ao servidor
>   **através do roteador** perdeu 100% dos pacotes, mesmo com as rotas e o `ip_forward` no lugar.
>   Quando o bloqueio cair, a B.1 precisa primeiro provar o encaminhamento entre as duas redes, antes
>   de qualquer medição. Causa provável: o isolamento de redes `internal` do próprio Docker **[I]**.
> - **Desmontagem provada:** `docker compose -p banda-lab down --volumes --remove-orphans --rmi local`.
>   Depois disso, nenhum container, rede ou imagem com o rótulo `banda-lab`. Os totais voltaram aos
>   de antes: 13 redes e 16 containers. Os containers de outros projetos não foram tocados.
> - **Nenhuma margem foi medida.** Seguem valendo os 10 s provisórios.
>
> **Saídas possíveis — decisão do responsável, nenhuma foi tentada [I]:**
>
> 1. **Kernel WSL2 próprio, com `NET_SCH_TBF` e `NET_SCH_NETEM`**, apontado por `kernel=` no
>    `.wslconfig` do usuário. Não exige administrador; afeta todas as distros WSL da D07 e o Docker
>    Desktop; reversão = remover a linha e `wsl --shutdown`. Exige compilar o kernel.
> 2. **Uma máquina ou VM Linux** fora de produção, com o mesmo `docker compose`. Na D07, uma VM
>    Hyper-V exigiria administrador.
> 3. **Atualizar o WSL/Docker Desktop** e reconferir: não verifiquei se um kernel mais novo da
>    Microsoft traz esses qdiscs.
> 4. **Medir no enlace real**, na primeira instalação em unidade (A.6), com `ping` a 200 ms durante
>    um teste de 10 s: dá a fila real daquele link, mas só daquele.

### B.1 Topologia (para quando o bloqueio cair)

Só containers Linux, em **duas redes Docker `internal: true`** (sem saída para fora):

```
[cliente]──rede lab-cli──[roteador]──rede lab-srv──[servidor]
 iperf3 -c, ping           tc nas duas       iperf3 -s
                           interfaces
```

- **Nenhum IP fora das redes Docker.** Nenhum backend, nenhum banco, nenhum Telegram.
- O roteador tem `net.ipv4.ip_forward=1` (via `sysctls` do compose) e `cap_add: NET_ADMIN`.
- Cliente e servidor recebem rota um para o outro via roteador (também `NET_ADMIN`, só para
  `ip route add`).
- **Gargalo nos dois sentidos:** `tc` na interface do roteador voltada ao servidor (fila do sentido
  normal) e na voltada ao cliente (fila do `-R`). Exemplo, por interface:
  ```
  tc qdisc add dev <if> root handle 1: tbf rate 20mbit burst 32kbit latency <fila>
  tc qdisc add dev <if> parent 1:1 handle 10: netem delay 15ms
  ```
  - `rate 20mbit` simula um enlace de unidade;
  - `netem delay 15ms` dá o RTT de repouso de uma WAN, para a medição não partir de ~0 ms;
  - `latency <fila>` define o tamanho da fila.
- **Imagens:** fixadas por digest no compose, como as actions do CI.

### B.2 Medição

Para cada tamanho de fila, por exemplo **`latency 50ms`, `200ms` e `500ms`**:

1. **Repouso:** `ping -i 0.2` do cliente ao servidor por 30 s, com horário em cada linha
   (`ping -D`). Registrar a mediana e o p95.
2. **Sentido normal:** com o ping a 200 ms correndo, `iperf3 -c <servidor> -t 10 --json-stream`.
   O ping continua por mais 60 s depois do fim.
3. **Sentido `-R`:** o mesmo, com `-R`.
4. **Por sentido e por fila, calcular:**
   - pico de latência durante o teste;
   - **tempo de volta ao repouso:** do `end` do iperf3 até a primeira de 5 amostras seguidas abaixo
     de `p95 do repouso + 5 ms`;
   - repetir 3 vezes e ficar com o maior.

### B.3 Saída

- Tabela: fila × sentido × pico × tempo de volta.
- **Margem recomendada = maior tempo de volta observado + folga**, arredondada para cima. A folga e
  a fila de referência são escolha do responsável.
- A margem entra na D5 (`janela_fim`) e na D14 (prazo duro em `janela_fim − margem`).
- **Limite [I]:** a fila de um container com `tbf` não é a fila do roteador da unidade. O número
  vale como ordem de grandeza; o enlace real pode ser diferente.

### B.4 Desmontagem

```
docker compose -p banda-lab down --volumes --remove-orphans
docker ps -a --filter label=com.docker.compose.project=banda-lab      # vazio
docker network ls --filter label=com.docker.compose.project=banda-lab # vazio
```

- As redes e containers do projeto `banda-lab` não podem sobrar. Containers de outros projetos
  (como `inframonitor-postgres` e `inframonitor-carga`) **não** são tocados.

---

## Parte C — supressão e rollback na implementação (não é laboratório)

**Dependência:** (g) e (h) só existem **depois do código da feature e do arquivo da V28**. Nada da
Parte C roda antes disso.

### C.g Supressão por medição: teste de integração

Teste com Testcontainers (PostgreSQL 16 real, `@RequerDocker`), no molde das classes de integração
do backend. **Sem rede, sem iperf3, sem motor ICMP:** as medições são sintéticas, gravadas pelo
mesmo caminho do motor (`MedicaoService.criar`), para que o predicado da D5 rode exatamente como
em produção.

**Predicado sob teste (D5, com a borda esquerda S1):**

```sql
AND NOT EXISTS (SELECT 1 FROM teste_banda tb
                 WHERE tb.iniciado_em <= :medicaoMaisRecente + make_interval(secs => :timeoutMs / 1000.0)
                   AND tb.janela_fim  >= :medicaoMaisAntigaDaSequencia)
```

**Monitores:** 20 s, 60 s e 300 s, em **duas unidades** (prova o escopo global da D4).
`latencia-ciclos=2`, limiar de 250 ms.

| # | Cenário | Esperado com o predicado | Esperado **sem** o predicado (reversão) |
|---|---|---|---|
| g-1 | Linha de base: 2 medições acima do limiar, sem teste | Episódio abre | Episódio abre |
| g-2 | Sequência inteira dentro de `[iniciado_em, janela_fim]` (monitor de 20 s) | Não abre | **Abre** |
| g-3 | Teste entre duas medições da sequência (monitor de 300 s) | Não abre (atraso de até um intervalo, D5) | **Abre** |
| g-4 | **Borda esquerda:** medição mais recente com `executado_em = iniciado_em − timeoutMs + 1 ms` | Não abre | **Abre** |
| g-5 | Borda esquerda, do lado de fora: `executado_em = iniciado_em − timeoutMs − 1 ms`, e mais antiga também fora | Abre | Abre |
| g-6 | **Borda direita:** medição mais antiga em `executado_em = janela_fim` | Não abre | **Abre** |
| g-7 | Borda direita, do lado de fora: mais antiga em `janela_fim + 1 ms` | Abre (episódio real depois da janela) | Abre |
| g-8 | Monitor de outra unidade (D4, escopo global) | Não abre | **Abre** |
| g-9 | Falha total (FALHA) durante a janela | **Incidente abre normalmente** (D4: só o episódio de latência é suprimido) | Incidente abre |
| g-10 | Ordem da D4 (condição C4): a linha `teste_banda` está commitada antes de o iperf3 iniciar | O runner falso registra o instante da chamada; nesse instante, outra conexão já enxerga a linha | — |

- **Regra de validade:** cada linha marcada **Abre** na coluna da reversão tem de abrir de fato. Se
  não abrir, a linha da esquerda não provou nada e o teste falha.
- **Como fazer a reversão sem build separada:** o mesmo teste roda a consulta com e sem o
  `AND NOT EXISTS (…)`. A forma (consulta parametrizada no teste, ou repositório de teste) fica para
  a implementação, sem abstração especulativa no código de produção.
- **Também na Parte C, vindo do roteiro antigo:**
  - S3 (prazo duro da D14): com o runner falso da D13, um teste que passa de `janela_fim − margem` é
    encerrado e gravado como `FALHA` com o erro de prazo;
  - servidor fora do ar: o runner falso devolve erro de conexão e o teste vira `FALHA`;
  - reinício do backend: `EXECUTANDO` vira `FALHA/INTERROMPIDO_REINICIO` no boot;
  - órfão de processo: `destroyForcibly` no shutdown. Este depende de processo real e entra no teste
    marcado `banda-lab` (D13).

### C.h Rollback: ensaio na fase de implantação da V28

No mesmo molde do **Ensaio B da V27** (`Docs/producao/implantacao-v27-modo-tv.md` § 5.1 e § 5.3):
ferramental real do pacote do CI, jars reais, PostgreSQL 16 descartável com os papéis de produção,
IIS e SCM simulados como lá.

1. Aplicar V1–V27 com o jar anterior e a V28 com o jar novo, no banco descartável.
2. Com o jar novo, marcar a ponta: a unidade U1 com `ponta_teste_banda_id = E`. Criar U2.
3. Subir o **jar anterior** com `--spring.flyway.enabled=false` e `ddl-auto: validate`, igual ao
   serviço de produção (`winsw.xml.template:12`) **[P]**.
   - **Esperado:** sobe sem WARN nem ERROR, apesar de `unidade.ponta_teste_banda_id`, que ele não
     mapeia. Esse é o caso **não coberto** pelo Ensaio B da V27, que só tinha tabelas novas.
4. **Mover a ponta de unidade com o jar antigo:** `PUT /api/v1/equipamentos/{E}` com o corpo
   completo e `unidadeId = U2`. O jar V27 aceita a troca (`EquipamentoService.java:99`) **[P]**.
   - **Registrar o real, não o esperado:** o **código HTTP**, o `code` do `ErroResposta`, a
     `message` e a linha do log com a exceção e a constraint.
   - Hipóteses **[I]**: **409** `DATA_INTEGRITY_VIOLATION` (`TratadorGlobalDeErros.java:86-88`)
     **[P]**, ou **500**, se a violação chegar embrulhada no commit.
   - Conferir depois: E continua em U1 e U1 continua com a ponta.
5. Com o jar antigo, excluir uma unidade com histórico de teste e sem outra dependência.
   Esperado: o `CASCADE` apaga o histórico.
6. `Rollback` sem e com `databaseAheadOfRelease=true`. Esperado: recusa, depois `SUCCESS`, como no
   Ensaio B da V27 e em `deployment/windows/tests/schema-guard-tests.ps1:58` **[P]**.
7. Voltar ao jar novo: um `EXECUTANDO` deixado de propósito vira `FALHA/INTERROMPIDO_REINICIO`.

- O portão de espaço (`ReleaseTools.psm1:21`) é tratado como no Ensaio B da V27: só
  `Test-FreeSpacePolicy` neutralizada na sessão do módulo, se o disco da máquina do ensaio estiver
  abaixo do portão. O bloqueio de disco de produção ([dividas.md](dividas.md)) continua valendo.

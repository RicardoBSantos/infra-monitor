# Teste de banda — Plano B: medição de vazão em Java, sem iperf3

**Estado: investigação, 2026-11-25. Nada implementado, nenhum módulo criado.**

- Nada aqui foi executado em produção, na D05 ou em servidor de unidade.
- Na D07 só houve leitura, mais um `jlink` gerado no scratchpad, conferido por hash e assinatura,
  **não executado** e depois apagado.
- As marcas seguem a legenda de [banda-architecture.md](banda-architecture.md):
  - **[P]** conferido nesta investigação;
  - **[P-lab]** conferido em laboratório;
  - **[E]** documento (do repositório ou externo, com a fonte);
  - **[I]** inferência.

> **Este plano não é forma de contornar a política.** A regra ASR `01443614-…` avalia executáveis
> nativos. Um `.jar` executado por um `java.exe` assinado fica, em tese, fora do critério dela (item 1).
> É **exatamente por isso** que o plano B só pode ser usado **depois de apresentado à segurança e
> aceito por ela**. Usá-lo sem esse aval seria explorar uma lacuna da regra, e não cumpri-la.
>
> **Gatilho de uso:** a segurança **negar** a liberação do `iperf3.exe` (D17, PR #51) **e aprovar**
> este desenho. Enquanto a liberação estiver pendente, o plano A continua sendo o caminho.

---

## 1. Premissa de ASR

### 1.1 O `java.exe` da D07 roda sem evento 1121 [P]

| Item | Valor |
|---|---|
| Caminho | `C:\Program Files\Java\jdk-21\bin\java.exe` (`JAVA_HOME` do projeto; o `java` do `PATH` resolve para `C:\Program Files\Common Files\Oracle\Java\javapath\java.exe`) |
| Fornecedor | Oracle Corporation, Java(TM) Platform SE **21.0.8** (`21.0.8+12-LTS-250`) |
| Assinatura | `Get-AuthenticodeSignature`: **Valid**. Signatário `CN="Oracle America, Inc."`. Emissor `DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1`. Carimbo de tempo DigiCert |
| SHA-256 | `F3D26E4F17C45DA613A4676B5B0C6A387BF36D990BE0835D60A177234B2F28BA` |

**Eventos [P]:** o log `Microsoft-Windows-Windows Defender/Operational` da D07 tem **196 eventos
1121/1122**, de 24/08 a 25/11/2026.

- **Nenhum** cita `java.exe`.
- A regra `01443614` aparece só para:
  - os `iperf3.exe` (23/11 e 24/11);
  - um `Meu IP.exe` compilado localmente (09/11, ×2). Esse caso mostra que a regra pega **qualquer**
    executável novo e sem assinatura, e não só o iperf3.
- Os demais são da regra `9e6c4e1f-…` (LSASS) sobre `svchost.exe`, sem relação com este assunto.
- O `java -version` rodado nesta investigação (25/11) não gerou evento.
- O backend de dev (jar Spring Boot) rodou na D07 em 24/11 sem evento.

**Achado lateral [P]:**
- O backend usa JNA 5.19.0 (`pom.xml:23`).
- Ao subir, o JNA extraiu para `%TEMP%\jna-999295648\` uma DLL **sem assinatura**
  (`Get-AuthenticodeSignature`: `NotSigned`), e não houve 1121.
- **Isso não prova que DLL desconhecida passa.** A `jnidispatch` é idêntica em todas as instalações
  do JNA 5.19 e tem, com toda a probabilidade, prevalência alta **[I]**.
- **Consequência para o desenho:** o lado da unidade **não pode ter nenhum código nativo**. Só
  `java.base`, sem JNA nem biblioteca com DLL embutida.

### 1.2 O que a Microsoft documenta sobre a regra [E]

Fonte: [ASR rules reference](https://learn.microsoft.com/en-us/defender-endpoint/attack-surface-reduction-rules-reference#block-executable-files-from-running-unless-they-meet-a-prevalence-age-or-trusted-list-criterion),
atualizada em 2026-09-11.

> "This ASR rule blocks executable files (for example, .exe, .dll, or .scr, from launching)."

- **Dependências:** Microsoft Defender Antivirus e Cloud Protection.
- **Exclusões:** suporte "limitado", detalhado na página de
  [visão geral](https://learn.microsoft.com/en-us/defender-endpoint/attack-surface-reduction-rules-overview#file-and-folder-exclusions-for-asr-rules).

**O que a fonte sustenta:**
- A regra avalia **executáveis no lançamento** (PE: `.exe`, `.dll`, `.scr`).
- A lista vem precedida de "for example". A documentação **não diz** que `.jar` fica fora; ela só
  não o cita.
- Um `.jar` não é lançado pelo carregador do Windows: quem é lançado é o `java.exe`, e o jar é
  **lido** por ele como dado.
- Portanto **"um jar executado por um `java.exe` assinado e difundido não é bloqueado por esta
  regra"** é **[I] sustentada pela documentação e pelo comportamento observado [P]**. Não é garantia
  documentada.
- Outras camadas (AV, AMSI, WDAC/App Control, se um dia for ligado) continuam valendo para o jar
  **[E]**.

**Achado que muda a D17 [E]:** a tabela de exclusões da página de visão geral marca, para esta regra:

| MDAV file/folder | Global ASR | Per-rule | IoC de arquivo | IoC de certificado |
|---|---|---|---|---|
| Y | Y | Y | **Y** | **Y** |

- A D17 dizia "falta confirmar que esta regra ASR respeita o indicador **[I]**". Pela documentação, ela
  **respeita** o indicador de arquivo (hash) e o de certificado.
- Isso **fortalece o plano A**: a opção recomendada na D17 é suportada.

**A "exclusão local ignorada" bate com a documentação [E/I]:**
- Exclusões de ASR podem vir de várias fontes, e a precedência é da política gerenciada.
- A máquina está em Intune + MDE (diagnóstico de 24/11).
- A exclusão precisa vir do Intune/MDE (per-rule ou indicador), e não da máquina.

### 1.3 Como o backend roda na D05 [E, repositório]

| Item | Valor | Fonte |
|---|---|---|
| Runtime | Eclipse **Temurin JDK 21.0.13+9** LTS x64, via winget `EclipseAdoptium.Temurin.21.JDK` (MSI oficial da Adoptium), em `C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot\` | `D02.10-B-infraestrutura-windows.md:46,51,86` |
| Tamanho em disco do JDK | 328 MiB | `D02.10-B…:102` |
| Wrapper | **WinSW 2.12.0 x64**, renomeado `C:\InfraMonitor\config\service\InfraMonitorBackend.exe`, SHA-256 `05b82d46…a0da`, **sem assinatura Authenticode** | `D02.10-C-backend-banco-servico.md:103-104` |
| Gestão | `IntuneManagementExtension` em execução na D05 | `D02.10-B…:95` |

**O WinSW passou pela ASR na D05? Não sabemos [I].**
- O WinSW é um `.exe` sem assinatura e o serviço roda em produção **[E]**.
- Há três explicações possíveis:
  - a regra `01443614` não está aplicada à D05;
  - a D05 tem exclusão;
  - o hash `05b82d46…` (release pública do WinSW, usada no mundo todo) tem prevalência alta.
- Só a leitura da política efetiva e dos eventos na D05 decide. O roteiro **somente leitura** já
  está no PR #51 (`contexto.md § Roteiro somente leitura para a D05`).

**Lado da unidade: Agendador de Tarefas em vez de WinSW [I, a provar em laboratório]**
- O WinSW seria um `.exe` **novo** em cada servidor de unidade.
- Mesmo com o hash da D05, cairia na mesma pergunta de prevalência.
- **Alternativa sem executável novo:** tarefa agendada que chama o `java.exe` do runtime assinado.

```
Ação:      "<runtime>\bin\java.exe" -Xmx32m -XX:+UseSerialGC -XX:MaxDirectMemorySize=8m
           -jar C:\InfraMonitor\banda\banda-ponta.jar --config C:\InfraMonitor\banda\ponta.properties
Conta:     NT AUTHORITY\LocalService   (sem login interativo, não administradora, sem senha a guardar)
Gatilhos:  "Na inicialização" + "a cada 5 min" com MultipleInstances = IgnoreNew
           (se o processo morrer, volta em até 5 min sem depender de "restart on failure")
Limites:   ExecutionTimeLimit = PT0S (sem limite), prioridade normal
```

- `schtasks.exe` e `java.exe` são binários assinados (Microsoft e fornecedor do JDK) **[P para o
  java da D07; I para o da unidade]**.
- **Perde-se, frente ao WinSW:**
  - a parada graciosa com `stoptimeout` (aqui basta: o servidor não tem estado a salvar);
  - o log de stdout do wrapper (o próprio jar grava log com rotação, item 3.6).
- Que a `LocalService` possa abrir porta de escuta e ler o arquivo de segredo com ACL própria é
  **[I]**, item do laboratório.

---

## 2. Runtime nas unidades

**Necessário:** um runtime Java 21 LTS x64 de fornecedor que assine os binários.

- **Mesma família da D05: Eclipse Temurin.** É gratuito, e o operador já o homologou **[E]**.
- A Adoptium documenta que os `.exe`/`.dll` do Temurin para Windows **têm assinatura própria**:
  - [reproducible build Windows x64](https://adoptium.net/docs/reproducible-verification-builds/reproduce-windows-x64/);
  - o [audit response](https://adoptium.net/pdf/temurin-audit-response.pdf) diz que todas as releases
    são assinadas;
  - o sujeito exato do certificado **não foi conferido [I]**. Conferir com
    `Get-AuthenticodeSignature` no `java.exe` da D05, no roteiro somente leitura.
- O Oracle JDK da D07 **não** serve para as unidades: a licença dele não é a do Temurin **[I]**.
  Mantém-se o fornecedor da D05.

### Comparação

| Critério | MSI oficial do Temurin **JRE** 21 | Runtime enxuto com `jlink` |
|---|---|---|
| Assinatura do `java.exe` | A do fornecedor, intacta | **Intacta.** Ver a prova abaixo **[P]** |
| Executável novo para a ASR | Nenhum | Nenhum, enquanto o `jlink` só copia (abaixo) |
| Tamanho | Dezenas de MB instalado **[I]**. O JDK da D05 ocupa 328 MiB **[E]** | **42 MB** com só `java.base` **[P, D07]** |
| Instalador | MSI assinado, instalável por Intune/winget | Pasta copiada (zip). Não há instalador; nós a geramos |
| Atualização (CPU trimestral do JDK: jan/abr/jul/out) | Novo MSI, implantável pelo Intune ou pelo winget | **Nós** regeramos e redistribuímos a pasta em cada unidade |
| Caminho estável para a tarefa | Não: a pasta leva a versão (`jre-21.0.x.y-hotspot`). A tarefa precisa ser atualizada a cada versão, ou apontar para um caminho fixo que o MSI ofereça **[I]** | Sim: `C:\InfraMonitor\banda\runtime\` |
| Quem é dono do patch | TI, pelo canal que ela já usa | Nós |

**Prova de que o `jlink` preserva assinatura e hash [P, D07, 2026-11-25]:**
- Comando: `jlink --add-modules java.base --strip-debug --no-header-files --no-man-pages` sobre o
  Oracle JDK 21.0.8 da D07.
- `bin\java.exe`, `bin\server\jvm.dll`, `bin\net.dll` e `bin\nio.dll` saíram com **o mesmo SHA-256**
  do JDK de origem e assinatura **Valid** (Oracle).
- Os **58** `.exe`/`.dll` gerados estão **todos** assinados.
- O `jlink` copia os nativos dos `.jmod` sem regravá-los. A reconferência com os `.jmod` do Temurin é
  **[I]**: o mecanismo é o mesmo, mas não foi rodado.
- O runtime **não foi executado** e foi apagado.

**Armadilha [I]:**
- O `jpackage` gera um **launcher `.exe` próprio**, sem assinatura, e cairia na ASR. **Não usar.**
- Pelo mesmo motivo: nada de wrappers `.exe` (Launch4j, WinSW novo) nem de plugins de `jlink` que
  mexam em nativos.

**Recomendação: MSI oficial do Temurin JRE 21.**
- Mantém a assinatura sem depender de nós.
- Põe o patch do runtime no canal que a TI já opera (Intune).
- Não cria um artefato binário nosso para conferir.
- O ganho de tamanho do `jlink` não pesa num Windows Server.
- O `jlink` fica como alternativa se a TI não quiser um JRE "de sistema" instalado nos servidores.
  Nesse caso a responsabilidade pelo patch trimestral é nossa, e isso precisa estar escrito.

---

## 3. Protocolo (desenho em texto)

Nome de trabalho: **protocolo `IMB1`** (Infra Monitor Banda, versão 1). Ele substitui o par
`iperf3 -c` / `iperf3 -s`. O **cliente** é a D05 (o backend). O **servidor** é a "ponta" da
unidade (D1, D3).

### 3.1 Conexões e porta

- **Uma porta TCP** configurável no servidor, por exemplo 5211. O firewall fica simples (3.5).
- **Conexão de controle**, uma por teste: handshake, parâmetros, amostras do lado receptor e
  resultado final.
- **Conexão de dados**, uma por sentido, aberta depois do controle aceito. Ela se identifica no
  primeiro quadro (3.3).
- **Um fluxo TCP por sentido** (equivale a `-P 1`, o padrão do iperf3). Paralelismo só se o
  laboratório mostrar que um fluxo não satura o link.

### 3.2 Sequência

```
D05 (cliente)                                     ponta da unidade (servidor)
  ── TCP controle ─────────────────────────────▶  accept (≤ 4 handshakes pendentes, prazo 2 s)
  ◀──────────── DESAFIO  (48 B: magic, versão, nonce_s 32 B, hora_s 8 B)
  ── OLA        (128 B: magic, versão, nonce_c 16 B, hora_c, parâmetros fixos, HMAC 32 B) ─▶
                                                   valida tamanho → magic/versão → HMAC (tempo
                                                   constante) → janela de hora → faixas dos parâmetros
  ◀──────────── ACEITO | OCUPADO | RECUSADO  (32 B, com HMAC da sessão)
  ── TCP dados #1 + QUADRO_DADOS (64 B: token de sessão, sentido=DOWN, HMAC) ─▶
  ══ bytes D05 → unidade por D s ═══════════════▶  o servidor conta bytes por segundo
  ◀──────────── AMOSTRA (32 B: seq, t_ms, bytes, flag omit, HMAC truncado) × D
  ── TCP dados #2 + QUADRO_DADOS (sentido=UP) ──▶
  ◀═════════════ bytes unidade → D05 por D s ════  a D05 conta bytes por segundo
  ── FIM ────────────────────────────────────────▶  o servidor fecha tudo e entra em cooldown
```

- **Download** (sede→unidade) e **upload** (unidade→sede) correm no mesmo teste, em sequência, como
  na D2.
- O valor de cada sentido é lido **no receptor**, como na D2:
  - no download, o receptor é a unidade, e as amostras vêm pelo controle autenticado;
  - no upload, o receptor é a própria D05.
- **Amostras por segundo** (D10): o receptor fecha um balde a cada 1 s (`System.nanoTime`), com bytes
  e duração real do balde.
  - O backend expõe os baldes no polling de 1 s, como faria com o `--json-stream`.
- **Descarte do arranque (equivale ao `-O`):**
  - os primeiros `O` segundos (proposta: 2 s, configurável, `O < D`) saem com a flag `omit`;
  - a média do sentido é `bytes após omit / tempo após omit`, medida no receptor;
  - a curva ao vivo mostra os baldes omitidos esmaecidos.
- **Conteúdo dos dados:** um buffer de 128 KiB com bytes **aleatórios**, preenchido uma vez no início.
  - Evita que um otimizador de WAN comprima ou deduplique o tráfego e infle a medida **[I]**.
  - O iperf3 também usa carga aleatória por padrão **[E]**.
- **Buffers de socket:** **não** fixar `SO_SNDBUF`/`SO_RCVBUF`. No Windows, fixá-los desliga o
  autoajuste da janela TCP e limita a vazão em links com RTT alto **[I]**. Item do laboratório.

### 3.3 Mensagens e autenticação

- **Segredo compartilhado** de 32 bytes aleatórios **por unidade** (3.5 e item 4).
- **Sem desserialização de objetos Java.** Sem `ObjectInputStream`, JSON, XML ou campo de tamanho
  variável. Toda mensagem tem **tamanho fixo por tipo**, e todo campo tem **offset fixo**.
- **Ordem de validação no servidor:**
  1. ler **exatamente** N bytes do tipo esperado num `byte[]` **pré-alocado no início do processo**,
     com prazo de leitura de 2 s. Se faltar byte ou estourar o prazo, a conexão fecha sem resposta;
  2. conferir `magic` e `versão`;
  3. calcular `HMAC-SHA256(segredo, DESAFIO ‖ OLA sem o campo HMAC)` e comparar com
     `MessageDigest.isEqual` (tempo constante);
  4. conferir a hora do cliente: |hora_c − hora_s| ≤ 30 s. O replay já é impedido pelo `nonce_s`
     novo a cada conexão; a hora é uma barreira extra;
  5. **só então** ler os parâmetros e conferir as faixas:
     - duração por sentido 1–15 s (D14);
     - omit 0–5 s e menor que a duração;
     - sentidos;
     - `teste_id` (16 B, correlação com `teste_banda.id`);
  6. alocação **zero** por conexão além do que já existe: os buffers de dados também são
     pré-alocados (um `ByteBuffer` direto de 128 KiB por sentido) e só existe uma sessão por vez.
- **Chave de sessão:** `K_s = HMAC(segredo, "sessao" ‖ nonce_s ‖ nonce_c)`.
  - `ACEITO`, `AMOSTRA`, `RESULTADO` e `QUADRO_DADOS` levam HMAC com `K_s` e número de sequência.
  - A D05 rejeita amostra forjada ou reordenada. O servidor também se autentica, porque só quem tem
    o segredo deriva `K_s`.
- **Lição dos CVEs de 2026 do iperf3:** os defeitos estavam no tratamento de parâmetros, que roda
  **antes** da autenticação (D9, **[P, notas da 3.22]**). Aqui nenhum byte vindo da rede é
  interpretado antes do passo 3: os passos 1 e 2 só comparam constantes.

### 3.4 Regras do servidor (equivalentes às opções do iperf3)

| iperf3 | IMB1 |
|---|---|
| "server busy" (um teste por vez) | Semáforo de 1 sessão. Um segundo cliente autenticado recebe `OCUPADO`. Conexões de dados que não sejam da sessão atual fecham sem resposta |
| `--server-max-duration` | O servidor encerra a sessão em `2 × 15 s + 5 s` contados do `ACEITO`, **qualquer que seja o pedido**. Fecha os sockets à força (prazo duro do lado da unidade, a segunda barreira da D14) |
| `--idle-timeout` | Handshake: 2 s. Controle ocioso: 5 s sem mensagem esperada encerra a sessão |
| limite de bytes | O servidor só **envia** no sentido UP e para em `min(D, 15 s)` **ou** em um teto de bytes (proposta: `15 s × 2 Gbit/s ≈ 3,75 GB`), o que vier antes. Ao receber, conta e descarta, também limitado pelo tempo |
| `-B <ip>` | Bind obrigatório num IP específico. O servidor **recusa subir** com `0.0.0.0`/`::` |
| — | **Cooldown no servidor:** 60 s entre sessões, independente do backend. É uma segunda barreira da cortesia de 120 s da D14 |

### 3.5 Rede e segredo

- **Firewall de entrada** no servidor da unidade:
  - TCP na porta configurada;
  - **endereço remoto = IP da D05**;
  - programa = o `java.exe` do runtime.
  - Uma regra por programa vale para **qualquer** processo daquele `java.exe`. Por isso porta e IP
    remoto continuam obrigatórios **[I]**.
- **Segredo da unidade:**
  - arquivo `C:\InfraMonitor\banda\segredo` com ACL de leitura só para `LocalService` e
    administradores;
  - na D05, um arquivo por unidade sob `config\secrets\` (o mesmo padrão `configtree:` já usado para
    `DB_PASSWORD`, **[E, `implantacao-v27-modo-tv.md:124`]**).
- **Rotação:** trocar os dois arquivos e reiniciar a tarefa. O protocolo não negocia segredo.

### 3.6 Log

- Arquivo com rotação por tamanho (por exemplo 4 × 1 MiB), em `C:\InfraMonitor\banda\logs\`.
- Uma linha por conexão: IP, resultado (aceito, recusado, motivo **genérico**), duração e bytes.
- Falha de autenticação vira **contador**, sem eco de dados recebidos.
- O teto de tamanho importa: há servidor com disco curto (ver o portão de ~25 GiB da janela de
  produção).

### 3.7 O que se perde frente ao iperf3

| Perda | Aceitável aqui? |
|---|---|
| **Maturidade.** O iperf3 tem duas décadas de uso e bugs conhecidos e corrigidos | **Não, sem compensação.** A compensação é a prova do item 6 e uma revisão de segurança do código antes de ir às unidades |
| **Metodologia conhecida.** "Medido com iperf3" é comparável com o que a operadora ou um técnico medem | Parcial. Perde-se a comparabilidade direta. Mitigação: o laboratório calibra contra o iperf3 (item 6) e o documento de uso declara "ferramenta própria, aferida contra iperf3 3.22.1" |
| **UDP** (jitter, perda) | Sim. A D2 só usa TCP, e a latência vem do motor ICMP |
| **Retransmissões** | Sim. A D16 já tirou as colunas, porque a build Windows do iperf3 também não as dava |
| Vários fluxos (`-P`), controle de congestionamento, zerocopy, afinidade de CPU | Sim, por ora. `-P` pode entrar depois se o laboratório pedir |
| Relatório de CPU do iperf3 | Sim |

---

## 4. Modelo de ameaça do serviço nas unidades

**Atacante considerado:** alguém na rede interna, sem o segredo, que alcança o IP do servidor da
unidade. **Pré-barreira:** o firewall só aceita a D05. Para chegar ao handshake, o atacante precisa
estar **na D05** ou **no caminho**, para falsificar o IP de origem numa conexão TCP completa **[I]**.

| # | O que o atacante tenta | Efeito sem mitigação | Mitigação |
|---|---|---|---|
| A1 | Inundar a porta com conexões (SYN/accept) | Esgotar threads e sockets do serviço | Firewall por IP remoto. Até 4 handshakes pendentes; o excedente fecha no `accept`. Prazo de 2 s. A pilha TCP do Windows já trata SYN flood **[I]** |
| A2 | Slowloris: abrir e mandar byte a byte | Segurar as vagas de handshake | Prazo **total** de 2 s para os 128 B, e não por byte |
| A3 | Mensagem malformada ou gigante | Corromper o parser e alocar memória | Tamanho fixo, `byte[]` pré-alocado, nada interpretado antes do HMAC (3.3). Teste de fuzz com entradas aleatórias e truncadas no CI |
| A4 | Esgotar memória | Derrubar o serviço ou o servidor | Sem alocação por conexão. `-Xmx32m` e `MaxDirectMemorySize=8m`: o pior caso é o próprio processo cair, e não o servidor. A tarefa religa em até 5 min |
| A5 | Esgotar CPU com HMAC | Ocupar a CPU do servidor | Um HMAC-SHA256 por handshake, limitado por A1/A2. Após 10 falhas por minuto, pausa de 10 s no `accept` |
| A6 | **Usar a ponta como gerador de tráfego** | Saturar a WAN ou um terceiro | Exige o segredo. O servidor só envia **para a conexão TCP já aceita**, e TCP não deixa redirecionar para terceiro. Teto de tempo e de bytes (3.4). Cooldown de 60 s no próprio servidor: no pior caso, ~30 s de tráfego a cada 95 s, só em direção à D05 |
| A7 | Replay de um handshake capturado | Disparar teste sem segredo | `nonce_s` novo a cada conexão e janela de hora |
| A8 | Homem no meio forjando resultado | Gravar vazão falsa no histórico | `AMOSTRA` e `RESULTADO` autenticadas com `K_s`. Os bytes de dados não são autenticados; um atacante no caminho já consegue degradar o link de qualquer forma **[I]** |
| A9 | **Roubar o segredo** (da D05 ou de uma unidade) | Disparar testes à vontade | Segredo **por unidade**: o roubo numa unidade só vale para ela. O roubo na D05 vale para todas, mas a D05 já é o ponto mais sensível do sistema. Os tetos de A6 continuam valendo. Rotação documentada |
| A10 | Explorar falha da pilha de rede da JVM | Execução remota | JRE atualizado a cada CPU trimestral (item 2, custo recorrente). Conta `LocalService` e nenhuma escrita fora de `logs\` |
| A11 | Encher o disco pelo log | Parar o servidor | Rotação com teto (3.6). Falhas viram contador |
| A12 | Escalar privilégio pelo serviço | — | `LocalService`, sem rede autenticada no domínio, sem login interativo |

**Risco residual declarado:** existe **um serviço de escuta novo** em cada servidor de unidade. Isso
é igual no plano A (o `iperf3 -s` também escuta). A diferença é que o código é nosso, e não de um
projeto maduro.

---

## 5. Impacto nas decisões D1–D17

| Decisão | Plano B | O que muda |
|---|---|---|
| D1 link e pontas | **Igual** | O servidor deixa de ser o iperf3 e vira o `banda-ponta.jar` |
| D2 manual, download + upload, leitura no receptor | **Igual** | Sem `-R`: o sentido é parâmetro do protocolo |
| D3 ponta em `unidade` | Igual | — |
| D4/D5 supressão e janela | **Igual** | A fórmula da janela é a mesma. A margem de fila continua sendo do laboratório |
| D6 relatórios | Igual | — |
| D7 perfis | Igual | — |
| D8 histórico | Igual | — |
| **D9 binário no CI** | **Substituída** | Sai o build Cygwin. Entra o **jar compilado no CI** (3.4 e item 7) mais o **JRE de fornecedor**. O texto dos CVEs do iperf3 deixa de se aplicar. As três barreiras (firewall restrito, bind, conta de baixo privilégio) **continuam** e ganham uma quarta: a autenticação HMAC |
| **D10 tempo real** | **Muda a fonte, não o contrato** | O polling de 1 s e `amostras` JSONB continuam. Sai o parser de `--json-stream`; as amostras chegam como `AMOSTRA` do protocolo (download) ou contadas localmente (upload) |
| D11 status, D12 velocímetro | Iguais | — |
| **D13 configuração** | **Muda** | Sai `BANDA_TESTE_EXECUTAVEL`. Entram `BANDA_TESTE_PORTA` e o diretório de segredos por unidade. `BANDA_TESTE_ENABLED` e `BANDA_TESTE_ALVOS_PERMITIDOS` ficam |
| **D14 limites e prazo duro** | **Muda o mecanismo** | Os limites e o prazo duro em `janela_fim − margem` ficam. O `destroyForcibly` de processo sai: o cliente fecha os sockets e interrompe a thread (ver PB-2). O `--server-max-duration` passa a ser a regra 3.4 do próprio servidor. O risco "parar o serviço não mata o processo filho" **some** se o cliente rodar dentro do backend |
| D15 ponta desativada | Igual | — |
| **D16 retransmissões** | **Continua fechada** | Java puro não expõe `TCP_INFO`. No Windows, ler retransmissões exige `WSAIoctl(SIO_TCP_INFO)` por código nativo **[I]**. A D05 até tem JNA (já usado pelo ICMP), mas isso daria só o sentido em que a D05 **envia** (download); na unidade não pode haver nativo (1.1). Medida parcial confunde mais que ajuda: **sem colunas**, como já decidido. O contador de sistema `TCPv4\Segments Retransmitted/sec` é da máquina inteira e não serve para o teste |
| **D17 liberação no ASR** | **Desnecessária para o B**, mas **substituída por aprovação da segurança** | O B não pede indicador nem exclusão. Pede o **aval formal** de que um serviço Java próprio pode escutar nos servidores. Ver também 1.2: a regra respeita indicador de hash, o que favorece o A |
| Laboratório Parte A (binário no Windows) | **Desbloqueada em parte** | O `java.exe` roda na D07 **[P]**. Dá para provar protocolo, prazos, OCUPADO, fuzz e tetos em loopback na D07. **Não** dá para comparar com o iperf3 no Windows, porque o iperf3 continua bloqueado |
| Laboratório Parte B (margem de fila, Docker) | **Continua bloqueada na D07** | O kernel do Docker Desktop não tem qdisc modelador **[P, 24/11]**. A prova do item 6 precisa de outro Linux (item 6.2) |
| Laboratório Parte C (supressão, rollback) | Igual | Não depende da ferramenta |

**V28: não muda o schema [I].**
- As colunas da proposta são genéricas: `download_mbps`, `upload_mbps`, `amostras`, `erro`,
  `duracao_sentido_segundos`, `janela_fim`.
- Só os comentários do SQL citam o iperf3 (`v28-proposta.md:28,62`) e precisariam ser reescritos.
- **Opcional, para o responsável:** uma coluna `ferramenta` (`'iperf3-3.22.1'` / `'imb1-1.0.0'`), se
  houver chance de os dois planos coexistirem no histórico. Sem ela, um histórico misto fica sem
  procedência.

### Questões novas, numeradas PB-n para não colidir com D-NN

- **PB-1:** um segredo por unidade (recomendado) ou um único segredo.
- **PB-2: o cliente roda dentro do backend ou como processo filho `java -jar`.**
  - **Dentro:** acaba a classe de falhas de processo órfão. Em troca, divide CPU e GC com o motor
    ICMP durante ~35 s; as medições desse intervalo já são suprimidas pela D5.
  - **Processo filho:** mantém o isolamento e a mecânica atual da D14.
  - **Recomendação [I]:** dentro do backend, com thread dedicada e buffers diretos pré-alocados,
    **se** o laboratório mostrar CPU de 1 núcleo ou menos a 1 Gbit/s na D05.
- **PB-3:** coluna `ferramenta` na V28.

---

## 6. Prova proposta (só plano, não executar)

### 6.1 O que precisa ser provado

1. **Exatidão:** a ferramenta Java mede a mesma vazão que o iperf3 no mesmo link.
2. **Forma da curva:** as amostras por segundo seguem a mesma subida e o mesmo patamar. É o que o
   operador vê ao vivo (D10).
3. **Limites:** OCUPADO, prazo do servidor, teto de bytes, cooldown, handshake malformado (fuzz),
   slowloris e bind recusado em `0.0.0.0`.
4. **Que não é a aplicação que limita:** em loopback, a ferramenta passa de 5 Gbit/s na D07, de modo
   que o gargalo no link real é sempre a rede **[I, meta]**.

### 6.2 Onde

- **Comparação com o iperf3 (itens 1 e 2): Linux.**
  - A topologia da Parte B no Docker da D07 **não serve**: o kernel do WSL2 não tem `tbf`, `htb` nem
    `netem` **[P, 24/11]**.
  - **Proposta:** runner `ubuntu` do GitHub Actions, com dois *network namespaces* ligados por `veth`
    e `tc` no meio (`tbf` para a banda, `netem` para o atraso).
    - Tem sudo, kernel completo e não toca rede corporativa. Que os módulos `sch_tbf`/`sch_netem`
      estejam disponíveis no runner é **[I]**: é o primeiro passo do workflow, e o job falha se
      faltarem.
  - O iperf3 do runner é o Linux do Ubuntu, sem ASR. Isso **compara as ferramentas, não a pilha TCP
    do Windows**.
- **Limites e loopback (itens 3 e 4): D07, Windows real.** O `java.exe` roda **[P]**.
- **Windows ↔ link real:** só na D05, com servidor numa unidade, e **depois** do aval da segurança.

### 6.3 Matriz

- **Banda (`tbf rate`):** 10, 50 e 200 Mbit/s.
  - Cobre de unidade pequena a link folgado. **Os contratos reais das unidades não estão no cadastro
    [I]**; ajustar se a TI informar.
- **Fila (`tbf latency`):** 50 ms (fila curta) e 400 ms (bufferbloat).
- **RTT fixo (`netem delay`):** 15 ms em cada sentido (30 ms de ida e volta), uma WAN MPLS típica
  **[I]**.
  - Sem RTT o produto banda × atraso é trivial e esconde problema de janela TCP.
- **Por combinação** (3 × 2 = 6) e por sentido: **5 rodadas alternadas** (iperf3, Java, iperf3, …),
  15 s cada, omit 2 s. A alternância cancela deriva do runner.

### 6.4 Critério de aceite

Para **cada** combinação e sentido:

| Medida | Critério | Por quê |
|---|---|---|
| Média da vazão (após omit) | `|Java − iperf3| / iperf3 ≤ 5%` | Com `tbf`, as duas ferramentas usam o **mesmo** kernel e o **mesmo** controle de congestionamento. A diferença só pode vir da aplicação (tamanho de escrita, janela de contagem, omit). O ruído entre rodadas do próprio iperf3 num link moldado fica na casa de 1–2% **[I, medir na 1ª rodada]**. 5% é ~2–3× esse ruído e ainda é invisível na escala do velocímetro (D12). Mais apertado reprovaria por ruído; mais frouxo deixaria passar erro de contagem |
| Dispersão | coeficiente de variação do Java ≤ CV do iperf3 + 2 p.p. | Uma ferramenta que acerta a média mas oscila mais engana na curva ao vivo |
| Forma da curva | (a) instante em que atinge 90% do patamar difere ≤ 1 s; (b) mediana da diferença absoluta amostra a amostra, após omit, ≤ 10% | O balde de 1 s tem borda imprecisa nas duas ferramentas. Amostra isolada varia mais que a média; por isso a tolerância é maior e se usa a mediana |
| Teto físico | média de ambas entre 85% e 100% do `rate` do `tbf` | Confere que o laboratório está moldando o que acha que molda. Se as duas ferramentas erram juntas, o critério relativo não pega |

**Se reprovar:** antes de mexer no critério, investigar o tamanho do buffer de escrita, o
`SO_RCVBUF` e a borda do balde. O critério só muda com o responsável.

---

## 7. Esforço e manutenção

### 7.1 Tamanho estimado [I]

| Parte | Conteúdo | Ordem de grandeza |
|---|---|---|
| `banda-ponta` (servidor das unidades) | Configuração, escuta limitada, codec de tamanho fixo, HMAC, sessão com prazos e tetos, emissor e receptor, cooldown, log com rotação | 8–10 classes, ~1.200–1.500 linhas, **só `java.base`**, sem Spring e sem dependência de runtime |
| Testes do servidor | Vetores fixos do codec (hex), HMAC, fuzz de truncamento e lixo, prazos, OCUPADO, tetos, bind recusado, ponta a ponta em loopback | ~40 testes JUnit |
| Cliente no backend | Codec (cópia), cliente de controle e de dados, adaptador no lugar do runner do iperf3 | 5–6 classes, ~600 linhas |
| Testes do cliente | Servidor falso em teste, amostra forjada recusada, prazo duro, integração com o runner falso que a D4 já exige | ~20 testes |
| Workflow de CI | Build, testes, vetores, publicação de Release com SHA-256 e a prova do item 6 | 2 workflows |

### 7.2 Onde ficaria

- Diretório novo `infra-monitor-banda-ponta/`, projeto Maven próprio, irmão de
  `infra-monitor-backend/`.
- O backend é Maven de módulo único: transformá-lo em multi-módulo só para dividir o codec é obra
  demais.
- **O codec fica duplicado** (2 classes pequenas). A paridade é garantida por um **arquivo de
  vetores** (`imb1-vetores.hex`) idêntico nos dois `src/test/resources`, com um passo de CI que
  falha se os dois arquivos divergirem **[I]**.

### 7.3 Empacotamento e versão

- **Jar único**, sem dependências, `banda-ponta-<semver>.jar`.
- **Build reproduzível** com `project.build.outputTimestamp` do Maven **[E, Maven]**. É uma vantagem
  real sobre o iperf3, cujo build **não** é reproduzível (`build-iperf3.md`): qualquer um recompila e
  confere o SHA-256.
- Publicado em Release do GitHub (`banda-ponta-v1.0.0`), no mesmo modelo da Release do iperf3: hash
  na Release e conferência pelo operador antes de copiar.
- **Versão do protocolo** (`IMB1`) separada da versão do jar.
  - O cliente recusa servidor de versão de protocolo diferente com erro claro: "ponta da unidade X
    com protocolo N, esperado M".
  - Atualizar o protocolo obriga a atualizar **todas** as unidades **antes** do backend.

### 7.4 Custo de manter um protocolo próprio

- **Cada mudança é uma mudança de segurança.** Qualquer campo novo no handshake reabre o item 3.3
  e precisa de revisão.
- **Patch trimestral do JRE em cada servidor de unidade**, para sempre. No plano A, o iperf3 também
  pede atualização, mas raramente. **Esse é o maior custo recorrente do B [I].**
- Distribuição do jar e do segredo em N unidades, sem ferramenta de implantação nas unidades hoje
  **[I]**.
- Conhecimento concentrado: quem não escreveu o protocolo precisa deste documento para mantê-lo.

---

## 8. Recomendação

| Critério | **Plano A: iperf3 + liberação no ASR** | **Plano B: Java próprio** |
|---|---|---|
| Segurança | Binário maduro, com CVEs públicos e corrigidos. Escuta antes da autenticação (sem OpenSSL, sem autenticação nenhuma). Barreiras: firewall, bind, conta. Liberação **estreita** por hash, suportada pela regra **[E, 1.2]** | Código nosso, sem histórico. Autenticação **antes** de qualquer interpretação. Sem nativo na unidade. Barreiras: firewall, bind, conta e HMAC. Exige revisão de código e aval |
| Precisão | Referência do mercado | Precisa provar (item 6). Até lá, desconhecida |
| Esforço até funcionar | Quase pronto: build oficial publicada, só falta a liberação | ~2.000 linhas mais testes, 2 workflows, laboratório novo |
| Dependências externas | Admin do Intune/MDE (uma vez por build). Cygwin/esnet só ao recompilar | Admin para aprovar o desenho. JRE em cada unidade (patch trimestral). Sem dependência de terceiro no código |
| Operação | Serviço iperf3 por unidade (WinSW ou tarefa) | Tarefa agendada + JRE + jar + segredo por unidade |
| Reversão | Remover o serviço e a regra | Remover a tarefa, o JRE (se não for usado por mais nada) e a regra |

**Recomendação: plano A.**
- A documentação da Microsoft diz que esta regra respeita indicador por hash (1.2).
- A liberação pedida é pequena (dois hashes), estreita e auditável.

**O plano B vale a pena em um só cenário: a segurança negar, de forma definitiva, qualquer
liberação para o `iperf3.exe` E aceitar, por escrito, um serviço Java próprio escutando nos
servidores das unidades.**
- Ajuda se as unidades **já tiverem** um JRE gerenciado pela TI, porque some o maior custo recorrente.
- Se a segurança negar o iperf3 **por ser um executável novo escutando na rede**, o plano B tem o
  **mesmo** problema: também escuta. A resposta provável é a mesma, e não vale construí-lo.

---

## Premissas que ficaram [I]

1. Que `.jar` fique fora da regra `01443614`. A documentação diz "for example, .exe, .dll, or .scr" e
   não exclui o jar expressamente. O comportamento na D07 sustenta a premissa.
2. Por que o WinSW sem assinatura roda na D05: regra ausente, exclusão ou prevalência do hash.
3. Que o `java.exe` do Temurin seja assinado com um certificado aceito pela regra. A Adoptium diz que
   assina; o sujeito não foi conferido.
4. Que o `jlink` sobre o Temurin preserve os hashes como fez sobre o Oracle JDK.
5. Que a `LocalService` numa tarefa agendada possa escutar a porta e ler o segredo com a ACL
   proposta, e que o gatilho de 5 min com `IgnoreNew` religue o processo.
6. Que não fixar `SO_RCVBUF`/`SO_SNDBUF` seja o certo no Windows (autoajuste).
7. Que os runners `ubuntu` do GitHub Actions tenham `sch_tbf` e `sch_netem`.
8. O ruído de 1–2% do iperf3 entre rodadas, base do critério de 5%.
9. A CPU do cliente dentro do backend a 1 Gbit/s na D05 (PB-2).

## O que confirmar com a segurança

- **Primeiro, sobre o plano A:** se aceita o **indicador "Permitir" por SHA-256** (ou exclusão
  per-rule) para o `iperf3.exe` e a `cygwin1.dll` da Release `iperf3-v3.22.1-cygwin.10`. Se a
  resposta for sim, este documento vira arquivo morto.
- Se negar: **o motivo** (executável sem assinatura? serviço novo escutando na rede? terceiro sem
  suporte?). O motivo decide se o B tem chance.
- Se o B for considerado:
  - aceitar o desenho do item 3, com o modelo de ameaça do item 4;
  - aceitar um JRE Temurin instalado nos servidores das unidades;
  - aceitar a tarefa agendada como `LocalService`;
  - definir quem revisa o código antes da primeira implantação;
  - confirmar que a política de App Control/WDAC não vai passar a bloquear `.jar` (o que mataria o B
    depois de pronto).

## O que confirmar nas unidades (somente leitura)

- Versão do Windows Server.
- Se já existe algum Java instalado, de qual fornecedor e quem atualiza.
- Se as regras ASR de lá são as mesmas da D07: eventos 1121 e política efetiva, pelo roteiro do
  PR #51.
- Espaço em disco.
- Se o firewall local é gerenciado por GPO/Intune (uma regra local pode ser ignorada, como a exclusão
  de ASR foi).
- Banda contratada de cada unidade, para recalibrar a matriz do item 6.3.
- Na D05: o sujeito da assinatura do `java.exe` do Temurin e os eventos 1121/1122 (o WinSW está
  passando por quê?).

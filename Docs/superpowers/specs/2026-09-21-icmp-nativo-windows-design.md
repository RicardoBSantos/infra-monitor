# Correção do ICMP: status nativo em vez de código de saída — design

Data: 2026-09-21 · Ciclo: validação com equipamentos reais

## Problema

`LinuxPingCommandRunner` roda `ping`, descarta a saída
(`redirectOutput(Redirect.DISCARD)`) e decide por `exitValue()`.
`IcmpMonitorExecutor` traduz `exitCode != 0` em FALHA.

O `ping.exe` do Windows devolve **exit 0** quando a resposta é um erro ICMP
vindo de um roteador intermediário. Medido nesta máquina em 2026-09-21:

| Alvo | Saída do ping.exe | exitCode | Leitura atual |
|---|---|---|---|
| 10.79.10.6 | `Resposta de 10.79.10.6: bytes=32 tempo<1ms TTL=127` | 0 | SUCESSO ✓ |
| 10.72.10.16 | `Resposta de 192.168.0.252: A vida útil (TTL) expirou em trânsito.` | **0** | **SUCESSO ✗** |
| 10.79.20.250 | `Resposta de 10.79.20.163: Host de destino inacessível.` | **0** | **SUCESSO ✗** |
| 10.73.10.15 | `Esgotado o tempo limite do pedido.` | 1 | FALHA ✓ |

Dois dos quatro alvos são falsos positivos. Um equipamento inalcançável por
rota quebrada aparece como disponível, e a latência gravada é o tempo de
processo medido em Java, não o RTT da rede.

## Decisão: IcmpSendEcho via JNA no Windows

Reverte explicitamente a orientação de
`Docs/Back-End-Docs/prompt-09-monitoring-engine-icmp.md`, que mandava
executar o binário `ping` em qualquer sistema. Motivo: no Windows o binário
não expõe o status ICMP pelo código de saída, e o texto que o expõe é
localizado — depende do idioma do sistema operacional. A API
`IcmpSendEcho` devolve o status como número, imune a idioma.

A leitura do texto continua existindo, para Linux e como válvula de escape.

### Descoberta do A.0 que vira requisito

Chamar `IcmpSendEcho` com `RequestOptions = NULL` usa um TTL default baixo e
produz **timeout espúrio**: no alvo de TTL expirado a API devolveu 11013
apenas 1 vez em 10, contra 10 em 10 do `ping.exe`. Passando
`IP_OPTION_INFORMATION` com `Ttl = 128` (o mesmo default do `ping.exe`), o
resultado foi 5/5 correto e o RTT caiu de centenas de ms para 2 ms.

**A implementação nativa é obrigada a passar `IP_OPTION_INFORMATION` com
`Ttl = 128`.** Sem isso, a correção troca um falso positivo por um falso
negativo.

### Os dois caminhos de retorno

Confirmado empiricamente que a mesma condição chega por dois caminhos:

- `IcmpSendEcho` devolve ≥ 1 → o status está em `ICMP_ECHO_REPLY.Status`.
- `IcmpSendEcho` devolve 0 → **nenhuma resposta chegou** e o código está em
  `GetLastError()`, não no reply.

Medido: 10.73.10.15 devolveu 0 com `GetLastError() = 11010`; 10.79.20.250
devolveu 1 com `Status = 11003`. Os dois caminhos são obrigatórios.

O `RoundTripTime` vem preenchido mesmo em resposta de erro (1042 ms e
2998 ms no host inacessível), então só é confiável quando o status é 0.

## Contrato

```java
public enum StatusIcmp { SUCESSO, TIMEOUT, HOST_INACESSIVEL, REDE_INACESSIVEL, TTL_EXPIRADO, ERRO }

public record IcmpResult(StatusIcmp status, Integer rttMs, Integer codigoNativo) { }
```

`rttMs` só é preenchido em `SUCESSO`. `codigoNativo` só é preenchido em
`ERRO`, para compor a mensagem.

> **Desvio declarado.** O pedido original especificava dois campos. Com dois
> campos a mensagem `"Erro ICMP <código>"` é impossível de montar. O terceiro
> campo existe só para isso e é nulo em todos os outros status.

Substitui `IcmpProcessResult(boolean timedOut, int exitCode, long elapsedMs)`,
que some.

### Mapeamento de códigos

| Código | Constante Win32 | StatusIcmp |
|---|---|---|
| 0 | `IP_SUCCESS` | `SUCESSO` |
| 11002 | `IP_DEST_NET_UNREACHABLE` | `REDE_INACESSIVEL` |
| 11003 | `IP_DEST_HOST_UNREACHABLE` | `HOST_INACESSIVEL` |
| 11010 | `IP_REQ_TIMED_OUT` | `TIMEOUT` |
| 11013 | `IP_TTL_EXPIRED_TRANSIT` | `TTL_EXPIRADO` |
| outro | — | `ERRO` (código vai na mensagem) |

### Efeito na medição

`StatusMedicao` **não muda**: continua `SUCESSO` e `FALHA`, e a CHECK
`ck_medicao_status` continua com dois valores. Nenhuma migration nesta parte.

O motivo detalhado vai para `medicao.mensagem`, que é `VARCHAR(255)`
(`V6__create_medicao.sql`) — folga de sobra para a maior das mensagens.

| StatusIcmp | StatusMedicao | mensagem |
|---|---|---|
| `SUCESSO` | SUCESSO | `null` |
| `TIMEOUT` | FALHA | `Timeout` |
| `HOST_INACESSIVEL` | FALHA | `Host de destino inacessível` |
| `REDE_INACESSIVEL` | FALHA | `Rede de destino inacessível` |
| `TTL_EXPIRADO` | FALHA | `TTL expirado em trânsito` |
| `ERRO` | FALHA | `Erro ICMP <código>` |

`IcmpMonitorExecutor` decide **só** pelo `status`. O cronômetro
`System.nanoTime()` em volta da chamada some: a latência gravada passa a ser
o RTT informado pela pilha de rede (Windows) ou pelo texto do `ping` (Linux).

## Componentes

```
monitoring/icmp/
├── StatusIcmp.java              enum novo
├── IcmpResult.java              record novo (substitui IcmpProcessResult)
├── IcmpCommandRunner.java       interface, assinatura passa a devolver IcmpResult
├── IcmpMonitorExecutor.java     decide por status; sem cronômetro
├── IcmpImplementacao.java       enum AUTO, NATIVO_WINDOWS, PROCESSO_PING
├── IcmpProperties.java          @ConfigurationProperties("monitoring.icmp")
├── IcmpRunnerConfiguration.java escolhe o bean e loga a escolha na subida
├── nativo/
│   ├── Iphlpapi.java            interface JNA fina (IcmpCreateFile/SendEcho/CloseHandle)
│   ├── IcmpEchoReply.java       Structure JNA
│   └── WindowsNativeIcmpRunner.java
└── processo/
    ├── PingOutputParser.java    texto → IcmpResult, puro, sem processo
    └── ProcessoPingIcmpRunner.java   (renomeia LinuxPingCommandRunner)
```

`Iphlpapi` é a camada fina isolada: nos testes ela é simulada, e
`WindowsNativeIcmpRunner` é exercitado sem tocar na rede.

### Handle por chamada, não por thread

`IcmpCreateFile` devolve um HANDLE. A documentação garante que
`IcmpSendEcho` é thread-safe, mas **não** garante que o mesmo HANDLE possa ser
usado por threads simultâneas. Com `workerThreads = 4` isso seria uma aposta.

Decisão: **um handle por chamada**, aberto e fechado em `try/finally`.
`IcmpCreateFile` é barato (abre um device handle, não faz I/O de rede) e o
custo desaparece ao lado de um timeout de rede na casa dos milissegundos —
o A.0 mediu RTT de 0–2 ms abrindo um handle por chamada. Handle por thread só
se pagaria se o custo aparecesse na medição, e não apareceu.

O `finally` fecha o handle mesmo quando `IcmpSendEcho` lança.

### Escolha da implementação

`monitoring.icmp.implementacao`, com três valores:

- `auto` (padrão) — Windows usa o nativo, o resto usa o processo.
- `nativo-windows` — força o nativo.
- `processo-ping` — força a leitura de texto, inclusive no Windows.

Válvula de escape: se a JNA falhar num servidor de produção, é uma variável
de ambiente, não um redeploy. A escolha é registrada em log na subida.

### Leitura de texto (Linux e fallback)

- Sucesso **só** quando existe uma linha contendo o IP do alvo **e** `ttl=`
  (sem diferenciar maiúsculas). Isso descarta a resposta do roteador
  intermediário, cujo IP é outro.
- Latência por regex tolerante: `(?:tempo|time)\s*([=<])\s*(\d+(?:[.,]\d+)?)\s*ms`.
  Com `<`, a latência vira 0. Vírgula decimal aceita.
- `-W <ceil(timeoutMs/1000)>` entra no comando Linux.
- A saída do processo passa a ser **lida**, não descartada.
- Classificação da falha por texto, em português e inglês: TTL expirado,
  host inacessível, rede inacessível, timeout.

O formato do `iputils` do Linux **não foi verificado nesta máquina** — a
fixture existe como formato de referência e está marcada como tal no teste.

## Testes

1. `PingOutputParserTest` — fixtures reais capturadas em 2026-09-21 nesta
   máquina (pt-BR), mais variantes em inglês, mais a fixture de referência do
   Linux.
2. `WindowsNativeIcmpRunnerTest` — códigos nativos → `StatusIcmp`, com
   `Iphlpapi` simulada; cobre os dois caminhos (retorno ≥ 1 com `Status`,
   retorno 0 com `GetLastError`).
3. `IcmpMonitorExecutorTest` — status → `MonitorExecutionResult` e mensagem.
4. `ProvaDeReversaoIcmpTest` — as mesmas fixtures contra a lógica antiga
   (`exitCode != 0`), provando que TTL expirado e host inacessível passariam
   como SUCESSO. Falha se a correção for revertida.
5. `IcmpRedeRealIT` — `@EnabledOnOs(WINDOWS)` + `@Tag("rede-real")`, fora da
   execução padrão, contra os 4 alvos do A.0.

## Fora de escopo

Não liga o motor de monitoramento, não liga o Telegram, não toca no banco de
desenvolvimento, não altera nenhum arquivo do frontend, não cria migration.

## Dívidas registradas

- Nada detecta um período em que o monitoramento parou. Se o processo cai, a
  ausência de medições é indistinguível de um monitor sem candidatos.
- O formato de saída do `ping` do Linux não foi verificado em máquina Linux.
- Condição (2) do A.0 (execução como SYSTEM) não foi verificada: `schtasks
  /ru SYSTEM` devolveu `ERRO: Acesso negado.` nesta máquina, que não é
  administradora.

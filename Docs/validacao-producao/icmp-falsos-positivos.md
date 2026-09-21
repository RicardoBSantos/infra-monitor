# ICMP — falsos positivos do `ping.exe` e a decisão pela API nativa

Data da medição: 2026-09-21. Máquina de desenvolvimento, Windows, usuário `rbfilho` sem elevação.
Branch `fix/icmp-nativo-windows`.

## O problema

`LinuxPingCommandRunner` (renomeado nesta rodada para `ProcessoPingIcmpRunner`) rodava `ping`,
descartava a saída (`redirectOutput(Redirect.DISCARD)`) e decidia sucesso ou falha pelo
`exitValue()` do processo. No Windows, o `ping.exe` devolve **exit 0** mesmo quando a resposta é um
erro ICMP vindo de um roteador intermediário — o processo terminou normalmente, só que a rede
respondeu com um problema, não com um eco.

Sondagem contra quatro alvos reais desta rede, com `ping -n 1 -w 3000 <alvo>` e o código de saída do
processo:

| Alvo | Linha de resposta do `ping.exe` | exitCode | Leitura antiga (`exitCode != 0` é falha) |
|---|---|---|---|
| 10.79.10.6 | `Resposta de 10.79.10.6: bytes=32 tempo<1ms TTL=127` | 0 | SUCESSO — correto |
| 10.72.10.16 | `Resposta de 192.168.0.252: A vida útil (TTL) expirou em trânsito.` | **0** | **SUCESSO — errado** |
| 10.79.20.250 | `Resposta de 10.79.20.163: Host de destino inacessível.` | **0** | **SUCESSO — errado** |
| 10.73.10.15 | `Esgotado o tempo limite do pedido.` | 1 | FALHA — correto |

Dois dos quatro alvos são falsos positivos. Em ambos, o IP que respondeu não é o IP sondado — é um
roteador intermediário devolvendo um erro ICMP (TTL expirado em trânsito; host de destino
inacessível) — e a lógica antiga registrava o equipamento como disponível, com latência medida como
o tempo do processo Java, não como RTT de rede nenhum.

## A decisão: `IcmpSendEcho` via JNA no Windows

Esta decisão **reverte explicitamente** a orientação de
`Docs/Back-End-Docs/prompt-09-monitoring-engine-icmp.md`. Esse documento (seção 62, "Charset/locale")
mandava:

> Não dependa de texto localizado do `ping` para decidir sucesso. Prefira: exit code para
> sucesso/falha.

e na seção 63 ("Exit code"):

> Use exit code como principal indicação de sucesso quando utilizar `ping`. Conceitualmente: 0 ->
> sucesso, diferente de 0 -> falha [...] mas valide comportamento real do ambiente Linux alvo.

A orientação já previa o risco de texto localizado e por isso mandava usar o exit code — mas a
premissa de que o exit code do `ping` expressa o status ICMP é falsa no Windows. É exatamente o
inverso do problema que a seção 62 tentava evitar: no Windows não é o texto que varia por idioma e
compromete a decisão, é o **próprio código de saída** que não carrega a informação — ele só diz que o
processo terminou, não o que a rede respondeu. O texto que carrega essa informação (`"A vida útil
(TTL) expirou em trânsito"`, `"Host de destino inacessível"`) é localizado: em outro idioma do
sistema operacional essas strings mudam, e uma classificação por texto seria tão frágil quanto o
próprio problema que a seção 62 queria evitar.

A saída: parar de depender do binário `ping` no Windows e chamar a API `IcmpSendEcho` do
`iphlpapi.dll` diretamente, via JNA. Essa API devolve o status ICMP como número (`IP_SUCCESS`,
`IP_TTL_EXPIRED_TRANSIT`, `IP_DEST_HOST_UNREACHABLE`, `IP_REQ_TIMED_OUT`, ...), imune a idioma do
sistema. A leitura de texto continua existindo, para Linux (que não tem equivalente de
`IcmpSendEcho` disponível sem privilégio de socket raw) e como válvula de escape controlada pela
propriedade `monitoring.icmp.implementacao` (`auto` | `nativo-windows` | `processo-ping`), registrada
em log na subida.

## Saída bruta do `IcmpSendEcho`

`IP_OPTION_INFORMATION.Ttl = 128` (mesmo default do `ping.exe`), timeout 3000 ms, usuário `rbfilho`
sem elevação, JNA 5.19.0, amd64:

```
alvo=10.79.10.6     retorno=1      replyStatus=0      lastError=-      rttMs=0
alvo=10.72.10.16    retorno=1      replyStatus=11013  lastError=-      rttMs=2
alvo=10.79.20.250   retorno=1      replyStatus=11003  lastError=-      rttMs=1042
alvo=10.79.20.250   retorno=1      replyStatus=11003  lastError=-      rttMs=2998
alvo=10.73.10.15    retorno=0      replyStatus=-      lastError=11010  rttMs=-
```

A repetição de `10.79.20.250` é a segunda sondagem seguida ao mesmo alvo, para cobrir o cache ARP
frio e o quente — as duas deram o mesmo resultado.

### Os dois caminhos de retorno

Observado na mesma rede: quando `IcmpSendEcho` devolve ≥ 1, o status vem em
`ICMP_ECHO_REPLY.Status` (11003 no host inacessível, acima). Quando devolve 0, significa que nenhuma
resposta chegou dentro do prazo e o código está em `GetLastError()`, não no reply (11010 no alvo que
deu timeout, acima). Os dois caminhos são obrigatórios: implementar só um deles deixaria metade dos
casos sem classificação.

`RoundTripTime` vem preenchido mesmo em resposta de erro — 1042 ms e 2998 ms no host inacessível,
acima — por isso só é confiável quando o status é 0 (`IP_SUCCESS`); nos demais casos o valor não
representa RTT de rede nenhum e é descartado.

## A descoberta do `RequestOptions = NULL`

Chamar `IcmpSendEcho` sem `IP_OPTION_INFORMATION` (`RequestOptions = NULL`) usa um TTL default baixo
da própria API, diferente do TTL que o `ping.exe` usa. Contra `10.72.10.16`, 10 sondagens seguidas
numa única JVM, com `RequestOptions = NULL`:

```
retorno=0 lastError=11010   (9 vezes)
retorno=1 replyStatus=11013 rttMs=181   (1 vez)
```

Na mesma janela de tempo, `ping.exe` contra o mesmo alvo, 10 vezes seguidas: "A vida útil (TTL)
expirou em trânsito." **10 de 10.**

Com `IP_OPTION_INFORMATION.Ttl = 128`, 5 sondagens seguidas contra o mesmo alvo:
`retorno=1 replyStatus=11013 rttMs=2`, **5 de 5**, e o RTT caiu de centenas de milissegundos para
2 ms.

Sem `Ttl = 128`, a API devolve timeout espúrio 9 vezes em 10 onde a rede na verdade está
respondendo com TTL expirado — a correção trocaria um falso positivo (sucesso onde há erro) por um
falso negativo (timeout onde há resposta). Por isso virou requisito:

**A implementação nativa é obrigada a passar `IP_OPTION_INFORMATION` com `Ttl = 128`.**

## Comparação de RTT: JNA × `ping.exe`

10 amostras cada, contra `10.79.10.6`:

- JNA (`RoundTripTime`, ms): `1 1 0 0 1 0 0 0 0 1`
- `ping.exe` (`tempo=`, ms): `<1ms <1ms <1ms 1ms <1ms 1ms 1ms <1ms <1ms 1ms`

Mesma faixa. O `ping.exe` não tem resolução abaixo de 1 ms — `<1ms` e `0` são a mesma medição, só
com formatos de saída diferentes.

## Handle por chamada, não por thread

`IcmpCreateFile` devolve um HANDLE do sistema operacional. A documentação da Microsoft garante que
`IcmpSendEcho` é thread-safe, mas **não** garante que o mesmo HANDLE possa ser usado por threads
simultâneas. O pool de monitoramento roda com 4 workers (`monitoring.engine.worker-threads`), o que
tornaria compartilhar um handle entre threads uma aposta sem garantia documentada a favor.

A decisão: um handle por chamada, aberto e fechado em `try/finally`, para eliminar a dúvida —
`IcmpCreateFile` só abre um device handle, não faz I/O de rede, e o custo não apareceu na medição:
o RTT de 0 a 2 ms relatado acima já foi medido abrindo um handle novo em cada chamada. Handle por
thread só se pagaria se esse custo tivesse aparecido, e não apareceu. O `finally` fecha o handle
mesmo quando `IcmpSendEcho` lança exceção.

## Mapeamento de códigos e o contrato resultante

| Código | Constante Win32 | `StatusIcmp` |
|---|---|---|
| 0 | `IP_SUCCESS` | `SUCESSO` |
| 11002 | `IP_DEST_NET_UNREACHABLE` | `REDE_INACESSIVEL` |
| 11003 | `IP_DEST_HOST_UNREACHABLE` | `HOST_INACESSIVEL` |
| 11010 | `IP_REQ_TIMED_OUT` | `TIMEOUT` |
| 11013 | `IP_TTL_EXPIRED_TRANSIT` | `TTL_EXPIRADO` |
| outro | — | `ERRO` (código vai na mensagem) |

```java
public enum StatusIcmp { SUCESSO, TIMEOUT, HOST_INACESSIVEL, REDE_INACESSIVEL, TTL_EXPIRADO, ERRO }

public record IcmpResult(StatusIcmp status, Integer rttMs, Integer codigoNativo) { }
```

Substitui `IcmpProcessResult(boolean timedOut, int exitCode, long elapsedMs)`, que saiu do código.
`IcmpMonitorExecutor` passou a decidir só pelo `status`, sem cronômetro (`System.nanoTime()`) em
volta da chamada: a latência gravada é o RTT informado pela pilha de rede (Windows) ou pelo texto do
`ping` (Linux), não o tempo do processo Java.

## Teste contra a rede real — `IcmpRedeRealIT`

Teste `@EnabledOnOs(WINDOWS)` + `@Tag("rede-real")`, fora da execução padrão da suíte (excluído via
`<excludedGroups>${excluded.groups}</excludedGroups>` no `maven-surefire-plugin`, propriedade
`excluded.groups` fixada em `rede-real` no `pom.xml`). No JUnit a exclusão vence a inclusão: rodar
só com `-Dgroups=rede-real` seleciona **zero** testes. É preciso liberar a exclusão também, com
`-Dexcluded.groups=` vazio. Contra os mesmos 4 alvos, saída integral capturada em 2026-09-21,
`./mvnw -o test -Dexcluded.groups= -Dgroups=rede-real -Dtest=IcmpRedeRealIT`:

```
[INFO] Running br.com.inframonitor.monitoring.icmp.IcmpRedeRealIT
10.73.10.15 -> IcmpResult[status=TIMEOUT, rttMs=null, codigoNativo=null]
10.79.10.6 -> IcmpResult[status=SUCESSO, rttMs=0, codigoNativo=null]
10.72.10.16 -> IcmpResult[status=TTL_EXPIRADO, rttMs=null, codigoNativo=null]
10.79.20.250 frio -> IcmpResult[status=HOST_INACESSIVEL, rttMs=null, codigoNativo=null] | quente -> IcmpResult[status=HOST_INACESSIVEL, rttMs=null, codigoNativo=null]
[INFO] Tests run: 5, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 13.82 s -- in br.com.inframonitor.monitoring.icmp.IcmpRedeRealIT
[INFO]
[INFO] Results:
[INFO]
[INFO] Tests run: 5, Failures: 0, Errors: 0, Skipped: 0
[INFO]
[INFO] ------------------------------------------------------------------------
[INFO] BUILD SUCCESS
[INFO] ------------------------------------------------------------------------
[INFO] Total time:  17.170 s
[INFO] Finished at: 2026-09-21T13:36:50-03:00
[INFO] ------------------------------------------------------------------------
```

Conferência contra o esperado:

| IP | Esperado | Obtido | OK |
|---|---|---|---|
| `10.79.10.6` | SUCESSO, RTT 0–2 ms | `SUCESSO, rttMs=0` | Sim |
| `10.72.10.16` | TTL_EXPIRADO | `TTL_EXPIRADO, rttMs=null` | Sim |
| `10.79.20.250` | HOST_INACESSIVEL (frio e quente) | `HOST_INACESSIVEL` nas duas sondagens | Sim |
| `10.73.10.15` | TIMEOUT | `TIMEOUT, rttMs=null` | Sim |

O quinto teste da classe (`nenhumAlvoCaiEmErro`) também passou: nenhum dos quatro alvos foi
classificado como `ERRO`.

Complementarmente, `ProvaDeReversaoIcmpTest` roda as mesmas fixtures contra a lógica antiga
(`exitCode != 0`) e falha se a correção for revertida — prova que TTL expirado e host inacessível
passariam como SUCESSO sob a regra descartada. Depois da onda de correções finais desta revisão
(2026-09-21: `catch (RuntimeException | LinkageError)` na camada nativa, handle inválido não vira
11010, `leitor.join(250)` passa a checar `isAlive()`, casamento de IP por fronteira de token, `erro(0)`
não vira mais "Erro ICMP 0", `naoPrendeAThreadAlemDoTimeout` removido por tocar rede real, e a
dependência `jna-platform` removida por não ter uso), suíte completa `BUILD SUCCESS`,
`Tests run: 291, Failures: 0, Errors: 0, Skipped: 0`.

## Condição (2) da trava de viabilidade: NÃO VERIFICADA

O pedido original mandava também rodar a sondagem nativa como conta de sistema (SYSTEM), porque é
assim que o serviço do Windows vai executar em produção. A tentativa, nesta máquina:

```
schtasks /create /tn InfraMonitorA0Probe /tr C:\Temp\a0-system.bat /sc once /st 23:59 /ru SYSTEM /rl HIGHEST /f
ERRO: Acesso negado.
```

A máquina de desenvolvimento não é administradora — `IsInRole(Administrator)` devolveu `False` — e
`/ru SYSTEM` exige elevação para criar a tarefa agendada. Nenhuma tarefa ficou criada; o `.bat`
temporário foi apagado. Isso fica registrado como **NÃO VERIFICADO**, não como verificado por outro
meio.

Separado da verificação, como raciocínio e não como medição: a API ICMP Helper (`IcmpSendEcho`) não
exige privilégio de administrador para ser chamada, ao contrário de um socket raw, e a conta SYSTEM
tem privilégio estritamente maior que o de um usuário comum sem elevação. Isso sugere que a chamada
funcionaria sob SYSTEM, mas é inferência, não algo medido nesta rodada.

## Dívidas do ciclo

1. Nada detecta um período em que o monitoramento parou: se o processo cai, a ausência de medições
   é indistinguível de um monitor sem candidatos.
2. O formato de saída do `ping` do Linux não foi verificado em máquina Linux — a fixture do
   `iputils` existe nos testes de `PingOutputParserTest` marcada como formato de referência, não
   como formato confirmado.
3. A execução como conta de sistema (SYSTEM) não foi verificada, pelo motivo acima
   (`schtasks /ru SYSTEM` recusado por falta de elevação nesta máquina).
4. `WindowsNativeIcmpRunner.paraOrdemDeRede` só entende IPv4, mas `equipamento.ip` é do tipo `INET`
   e aceitaria IPv6; um alvo IPv6 falharia em toda sondagem.

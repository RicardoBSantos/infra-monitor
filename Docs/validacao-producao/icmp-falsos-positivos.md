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

**Carga única na subida (2026-09-22).** A carga da biblioteca nativa deixou de acontecer por
sondagem e passou a acontecer uma única vez na subida, em `IcmpAmbienteConfiguration.resolver`. Com
`monitoring.icmp.implementacao=nativo-windows` pedido explicitamente, uma falha na carga derruba a
subida da aplicação inteira com `IllegalStateException`; com `auto`, a mesma falha faz o processo
cair para `processo-ping` e registra um log `ERROR` com o detalhe da falha, sem impedir a subida.
`GET /api/v1/status` publica o resultado dessa decisão em quatro campos: `pedida` (o que foi
configurado), `ativa` (o que este processo está de fato usando), `cargaNativa` (`NAO_TENTADA`, `OK`
ou `FALHOU`) e `motorLigado`. `detalheFalha` existe em `IcmpAmbiente` e é logado na subida, mas
**não sai no payload HTTP** desde 2026-09-22 — a mensagem crua do `Native.load` carrega o caminho
completo do sistema de arquivos, e o endpoint é acessível a ADMIN, OPERADOR e VISUALIZADOR.

## GET /api/v1/status

Verificado em 2026-09-22, subindo a aplicação localmente (`MONITORING_ENGINE_ENABLED=false`,
`DB_PORT=5434`, porta 8080), sem escrita no banco além de um `SELECT` para achar um usuário
elegível. Sem token:

```
{"timestamp":"2026-09-22T12:22:48.429344900Z","status":401,"error":"Unauthorized","code":"UNAUTHORIZED","message":"Autenticacao obrigatoria","path":"/api/v1/status"}
```

`SecurityConfiguration.java:13` exige role para qualquer `GET /api/v1/**`:

```java
.requestMatchers(HttpMethod.GET,"/api/v1/**").hasAnyRole("ADMIN","OPERADOR","VISUALIZADOR")
```

O `401` é o comportamento correto e pré-existente dessa regra, não uma falha da coleta. Com um token
JWT válido (usuário `id=1`, `ADMIN`, ativo, sem troca de senha obrigatória — único usuário do banco
de dev), `200 OK`:

```
{"aplicacao":"infra-monitor-backend","status":"UP","instante":"2026-09-22T12:26:44.469096600Z","icmp":{"pedida":"AUTO","ativa":"NATIVO_WINDOWS","cargaNativa":"NAO_TENTADA","detalheFalha":null,"motorLigado":false}}
```

**Coleta de 2026-09-22, anterior à remoção de `detalheFalha` do payload** (ver correção
2026-09-22 mais abaixo). O JSON acima é a captura real feita naquele momento, e é mantido como
registro histórico — não é o formato atual. O payload atual de `GET /api/v1/status` tem os mesmos
campos, exceto `detalheFalha`, que deixou de ser serializado.

**Correção 2026-09-22 (nesta rodada).** O Javadoc de `StatusController`
(`src/main/java/br/com/inframonitor/common/api/StatusController.java:14-18`) foi reescrito: já não
descreve o endpoint como "endpoint minimo de infraestrutura" que "prova que a API responde", e passou
a dizer explicitamente que ele exige token com role ADMIN, OPERADOR ou VISUALIZADOR, igual a qualquer
outro endpoint de negócio sob `/api/v1`, com referência a `SecurityConfiguration`. A divergência entre
a intenção documentada (endpoint mínimo, implícito público) e o comportamento real (autenticado,
`hasAnyRole`) registrada aqui deixou de existir; a regra de segurança em si não foi alterada.

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

**Reexecução em 2026-09-22:** sonda descartável `SondaA0.java` (fora do repositório), mesmo
`Ttl = 128`, timeout 3000 ms, `10.79.20.250` sondado duas vezes seguidas (evidência 4a do relatório
da Task 6):

```
alvo=10.79.10.6 retorno=1 replyStatus=0 lastError=- rttMs=1
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.79.20.250 retorno=1 replyStatus=11003 lastError=- rttMs=3002
alvo=10.79.20.250 retorno=1 replyStatus=11003 lastError=- rttMs=3003
alvo=10.73.10.15 retorno=0 replyStatus=- lastError=11010 rttMs=-
```

Divergências em relação a 2026-09-21: `10.72.10.16` deu `retorno=0 lastError=11010` (timeout puro)
hoje, contra `retorno=1 replyStatus=11013` (`TTL_EXPIRADO`) em 2026-09-21 — o alvo está inalcançável
agora, ver a nota sobre a evidência 4b abaixo. `10.73.10.15` deu timeout nas duas datas, com
`rttMs=-` nas duas — sem divergência nesse alvo.
`10.79.20.250` manteve `HOST_INACESSIVEL` (`replyStatus=11003`) nas duas datas, com `rttMs` em
~3000 ms nos dois casos (1042/2998 ms em 2026-09-21, 3002/3003 ms hoje) — mesma ordem de grandeza,
perto do teto do timeout configurado, sem contradição entre as duas medições. `10.79.10.6` deu
sucesso nas duas datas, RTT 0–1 ms nos dois casos. As duas medições ficam registradas; nenhuma
substitui a outra.

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

**Reexecução em 2026-09-22 — INCONCLUSIVA:** mesma sonda, mesmo alvo `10.72.10.16`, mesma máquina
(evidência 4b do relatório da Task 6):

```
-- RequestOptions = NULL --
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
Contagem (RequestOptions=NULL): {retorno=0,lastError=11010=10}
-- Ttl = 128 --
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
alvo=10.72.10.16 retorno=0 replyStatus=- lastError=11010 rttMs=-
Contagem (Ttl=128): {retorno=0,lastError=11010=5}
```

Nesta rodada, `10.72.10.16` deu timeout (`lastError=11010`) nas 15 tentativas, tanto com
`RequestOptions=NULL` (10/10) quanto com `Ttl=128` (5/5) — os dois modos deram 100% timeout, sem
nenhum sucesso em nenhum dos dois. Isso **não reproduz nem contradiz** o "9 timeouts espúrios em 10
com `RequestOptions=NULL`, sucesso com `Ttl=128`" medido em 2026-09-21: o alvo simplesmente está
fora do ar agora (o mesmo padrão de timeout puro apareceu na reexecução da evidência 4a acima, e o
comentário de código em `WindowsNativeIcmpRunner.java:27` que registra a medição original de
2026-09-21 continua correto quanto ao que foi medido naquela data). A medição de 2026-09-21
permanece válida e não foi apagada; a de 2026-09-22 fica registrada como inconclusiva, não como
substituição.

## Comparação de RTT: JNA × `ping.exe`

10 amostras cada, contra `10.79.10.6`:

- JNA (`RoundTripTime`, ms): `1 1 0 0 1 0 0 0 0 1`
- `ping.exe` (`tempo=`, ms): `<1ms <1ms <1ms 1ms <1ms 1ms 1ms <1ms <1ms 1ms`

Mesma faixa. O `ping.exe` não tem resolução abaixo de 1 ms — `<1ms` e `0` são a mesma medição, só
com formatos de saída diferentes.

**Reexecução em 2026-09-22:** mesmo alvo `10.79.10.6`, mesma sonda, 10 amostras cada
(evidência 4c do relatório da Task 6):

```
alvo=10.79.10.6 retorno=1 replyStatus=0 lastError=- rttMs=1
alvo=10.79.10.6 retorno=1 replyStatus=0 lastError=- rttMs=0
alvo=10.79.10.6 retorno=1 replyStatus=0 lastError=- rttMs=0
alvo=10.79.10.6 retorno=1 replyStatus=0 lastError=- rttMs=0
alvo=10.79.10.6 retorno=1 replyStatus=0 lastError=- rttMs=0
alvo=10.79.10.6 retorno=1 replyStatus=0 lastError=- rttMs=0
alvo=10.79.10.6 retorno=1 replyStatus=0 lastError=- rttMs=0
alvo=10.79.10.6 retorno=1 replyStatus=0 lastError=- rttMs=0
alvo=10.79.10.6 retorno=1 replyStatus=0 lastError=- rttMs=1
alvo=10.79.10.6 retorno=1 replyStatus=0 lastError=- rttMs=1
```

RTT nativo hoje: `{0, 0, 0, 0, 0, 0, 0, 1, 1, 1}` ms — 10/10 sucesso.

`ping -n 1 -w 3000 10.79.10.6`, 10 execuções (saída crua do console Windows, mojibake de cp1252
preservado — ver a nota sobre acentuação corrompida na seção `## O campo de mensagem da medição`
abaixo, o mesmo fenômeno se aplica aqui: `�` é artefato de exibição do console, os valores numéricos
não são afetados):

```
-- execucao 1 --

Disparando 10.79.10.6 com 32 bytes de dados:
Resposta de 10.79.10.6: bytes=32 tempo=1ms TTL=127

Estat�sticas do Ping para 10.79.10.6:
    Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de
             perda),
Aproximar um n�mero redondo de vezes em milissegundos:
    M�nimo = 1ms, M�ximo = 1ms, M�dia = 1ms
-- execucao 2 --

Disparando 10.79.10.6 com 32 bytes de dados:
Resposta de 10.79.10.6: bytes=32 tempo<1ms TTL=127

Estat�sticas do Ping para 10.79.10.6:
    Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de
             perda),
Aproximar um n�mero redondo de vezes em milissegundos:
    M�nimo = 0ms, M�ximo = 0ms, M�dia = 0ms
-- execucao 3 --

Disparando 10.79.10.6 com 32 bytes de dados:
Resposta de 10.79.10.6: bytes=32 tempo=3ms TTL=127

Estat�sticas do Ping para 10.79.10.6:
    Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de
             perda),
Aproximar um n�mero redondo de vezes em milissegundos:
    M�nimo = 3ms, M�ximo = 3ms, M�dia = 3ms
-- execucao 4 --

Disparando 10.79.10.6 com 32 bytes de dados:
Resposta de 10.79.10.6: bytes=32 tempo<1ms TTL=127

Estat�sticas do Ping para 10.79.10.6:
    Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de
             perda),
Aproximar um n�mero redondo de vezes em milissegundos:
    M�nimo = 0ms, M�ximo = 0ms, M�dia = 0ms
-- execucao 5 --

Disparando 10.79.10.6 com 32 bytes de dados:
Resposta de 10.79.10.6: bytes=32 tempo<1ms TTL=127

Estat�sticas do Ping para 10.79.10.6:
    Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de
             perda),
Aproximar um n�mero redondo de vezes em milissegundos:
    M�nimo = 0ms, M�ximo = 0ms, M�dia = 0ms
-- execucao 6 --

Disparando 10.79.10.6 com 32 bytes de dados:
Resposta de 10.79.10.6: bytes=32 tempo<1ms TTL=127

Estat�sticas do Ping para 10.79.10.6:
    Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de
             perda),
Aproximar um n�mero redondo de vezes em milissegundos:
    M�nimo = 0ms, M�ximo = 0ms, M�dia = 0ms
-- execucao 7 --

Disparando 10.79.10.6 com 32 bytes de dados:
Resposta de 10.79.10.6: bytes=32 tempo=1ms TTL=127

Estat�sticas do Ping para 10.79.10.6:
    Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de
             perda),
Aproximar um n�mero redondo de vezes em milissegundos:
    M�nimo = 1ms, M�ximo = 1ms, M�dia = 1ms
-- execucao 8 --

Disparando 10.79.10.6 com 32 bytes de dados:
Resposta de 10.79.10.6: bytes=32 tempo<1ms TTL=127

Estat�sticas do Ping para 10.79.10.6:
    Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de
             perda),
Aproximar um n�mero redondo de vezes em milissegundos:
    M�nimo = 0ms, M�ximo = 0ms, M�dia = 0ms
-- execucao 9 --

Disparando 10.79.10.6 com 32 bytes de dados:
Resposta de 10.79.10.6: bytes=32 tempo<1ms TTL=127

Estat�sticas do Ping para 10.79.10.6:
    Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de
             perda),
Aproximar um n�mero redondo de vezes em milissegundos:
    M�nimo = 0ms, M�ximo = 0ms, M�dia = 0ms
-- execucao 10 --

Disparando 10.79.10.6 com 32 bytes de dados:
Resposta de 10.79.10.6: bytes=32 tempo<1ms TTL=127

Estat�sticas do Ping para 10.79.10.6:
    Pacotes: Enviados = 1, Recebidos = 1, Perdidos = 0 (0% de
             perda),
Aproximar um n�mero redondo de vezes em milissegundos:
    M�nimo = 0ms, M�ximo = 0ms, M�dia = 0ms
```

`ping.exe` hoje: `{1, <1, 3, <1, <1, <1, 1, <1, <1, <1}` ms — 10/10 sucesso, TTL=127 em todas. Nativo
e `ping.exe` concordam de novo hoje, mesma faixa (0–3 ms), sem timeout espúrio — sem divergência em
relação a 2026-09-21, o alvo `10.79.10.6` respondeu bem nas duas datas.

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

O `try`/`finally` do handle, `WindowsNativeIcmpRunner.java:36-81`:

```java
@Override
public IcmpResult run(String ip, int timeoutMs) {
    Pointer handle = null;
    try {
        handle = iphlpapi.icmpCreateFile();
        if (handle == null || Pointer.nativeValue(handle) == 0L || Pointer.nativeValue(handle) == -1L) {
            // Falha local de recurso, nao da rede: nao pode sair como 11010
            // (IP_REQ_TIMED_OUT), que faria o banco dizer que o alvo nao respondeu.
            log.warn("IcmpCreateFile devolveu handle invalido ao sondar {}", ip);
            return IcmpResult.erro(0);
        }
        try (Memory requisicao = new Memory(TAMANHO_REQUISICAO);
             Memory reply = new Memory(TAMANHO_REPLY);
             Memory opcoes = new Memory(TAMANHO_OPCOES)) {
            requisicao.clear();
            reply.clear();
            opcoes.clear();
            opcoes.setByte(0, TTL_PADRAO);

            Iphlpapi.Retorno retorno = iphlpapi.icmpSendEcho(handle, paraOrdemDeRede(ip), requisicao,
                    (short) TAMANHO_REQUISICAO, opcoes, reply, TAMANHO_REPLY, timeoutMs);

            if (retorno.valor() == 0) {
                return paraResultado(retorno.ultimoErro(), 0);
            }
            IcmpEchoReply lido = new IcmpEchoReply(reply);
            return paraResultado(lido.status, lido.roundTripTime);
        }
    } catch (RuntimeException | LinkageError excecao) {
        // LinkageError e' obrigatorio aqui: a carga da biblioteca ja aconteceu na
        // subida (Iphlpapi.Jna.carregar(), fora deste runner), mas a JNA resolve
        // cada simbolo de funcao de forma preguicosa, na primeira invocacao do
        // proxy. Um IcmpSendEcho ou IcmpCloseHandle ausente na DLL ainda sobe como
        // UnsatisfiedLinkError aqui dentro, na sondagem, mesmo com a biblioteca ja
        // carregada. Sem este catch esse erro escapa ate' o FutureTask do pool e
        // desaparece: o motor para de gravar medicao sem deixar rastro.
        log.warn("Falha na camada nativa ICMP ao sondar {}", ip, excecao);
        return IcmpResult.erro(0);
    } finally {
        if (handle != null) {
            try {
                iphlpapi.icmpCloseHandle(handle);
            } catch (RuntimeException ignorada) {
                // Fechar o handle nunca pode derrubar a sondagem.
            }
        }
    }
}
```

(Evidência corrigida em 2026-09-22: o comentário anterior, colado acima em versões anteriores
deste documento, descrevia um mecanismo que já não existe — atribuía o `UnsatisfiedLinkError` ao
inicializador estático de `Iphlpapi.Jna.Biblioteca`, disparado pela primeira chamada a
`icmpCreateFile`. Essa carga virou explícita em `Iphlpapi.Jna.carregar()`, chamada uma única vez na
subida por `IcmpAmbienteConfiguration`; o `catch` continua necessário porque a JNA resolve cada
símbolo de função sob demanda, na primeira invocação do proxy.)

O tamanho do pool que motivaria compartilhar handle, `MonitoringEngineProperties.java:9`:

```java
private int workerThreads = 4;
```

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

## O campo de mensagem da medição

Campo: `medicao.mensagem`, `VARCHAR(255)` (`V6__create_medicao.sql:7`). Todas as mensagens que o
código pode gravar vêm de um único lugar, `IcmpMonitorExecutor.mensagem` mais os dois literais do
`catch` de `execute` — `PingOutputParser` devolve status, nunca texto. Medido por
`IcmpMonitorExecutorTest.todaMensagemCabeNoCampo` em 2026-09-22:

```
[4e] campo: medicao.mensagem VARCHAR(255)
[4e] 7 | Timeout
[4e] 27 | Host de destino inacess�vel
[4e] 27 | Rede de destino inacess�vel
[4e] 24 | TTL expirado em tr�nsito
[4e] 21 | Erro ICMP -2147483648
[4e] 26 | Erro ICMP n�o identificado
[4e] 32 | Erro ao executar a sondagem ICMP
[4e] 26 | Sondagem ICMP interrompida
[4e] maior: 32 | Erro ao executar a sondagem ICMP
```

Os caracteres `�` são mojibake do console do Windows (cp1252/850) capturando saída UTF-8 — artefato
de exibição, não do dado; os comprimentos impressos já contam corretamente cada caractere acentuado
como 1 unidade (é o que `String.length()` devolve). As mesmas oito mensagens, com a acentuação
correta do código-fonte (UTF-8), para quem for ler este documento sem herdar o mojibake:

- `Timeout` (7)
- `Host de destino inacessível` (27)
- `Rede de destino inacessível` (27)
- `TTL expirado em trânsito` (24)
- `Erro ICMP -2147483648` (21)
- `Erro ICMP não identificado` (26)
- `Erro ao executar a sondagem ICMP` (32)
- `Sondagem ICMP interrompida` (26)

A maior mensagem gerável tem 32 caracteres, com folga de 223 caracteres (255 − 32) sobre o limite da
coluna — cerca de 12,5% do limite ocupado no pior caso.

## O comando do `ping` em cada sistema

Windows (`ProcessoPingIcmpRunner:68`): `ping -n 1 -w <timeoutMs> <ip>` — `-w` em milissegundos.

Linux (`ProcessoPingIcmpRunner:70-73`):

    ping -n -c 1 -W <segundos> <ip>

`-n` suprime a resolução de nomes; `-c 1` envia um pacote; `-W` é o timeout de resposta **em
segundos** e não aceita fração, então `timeoutMs` é arredondado para cima —
`Math.max(1L, (timeoutMs + 999L) / 1000L)` — para o timeout efetivo nunca ficar menor que o pedido.
Um `timeoutMs` de 2000 vira `-W 2`; de 2001, `-W 3`.

Continua valendo a dívida 2: o formato de saída do `ping` do Linux não foi verificado em máquina
Linux.

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

**Onde isso será verificado.** Na **instalação do serviço Windows**, fase de implantação do
Monitoring Engine — o primeiro momento em que a aplicação roda sob a conta de serviço de verdade, e
o único em que a verificação não seria uma simulação. Item de checklist daquela fase, em uma linha:
*com o serviço instalado e rodando sob a conta de produção, e o motor ligado, conferir em
`GET /api/v1/status` que `icmp.cargaNativa = OK` e `icmp.ativa = NATIVO_WINDOWS`, e confirmar no log
de subida que não houve queda para `processo-ping`.* Enquanto essa fase não chegar, a condição (2)
permanece **NÃO VERIFICADA**, e nenhuma inferência sobre privilégio a substitui.

## Dívidas do ciclo

1. Nada detecta um período em que o monitoramento parou: se o processo cai, a ausência de medições
   é indistinguível de um monitor sem candidatos.
2. O formato de saída do `ping` do Linux não foi verificado em máquina Linux — a fixture do
   `iputils` existe nos testes de `PingOutputParserTest` marcada como formato de referência, não
   como formato confirmado.
3. A execução como conta de sistema (SYSTEM) não foi verificada, pelo motivo acima
   (`schtasks /ru SYSTEM` recusado por falta de elevação nesta máquina).
4. `WindowsNativeIcmpRunner.paraOrdemDeRede` só entende IPv4. A coluna do alvo é
   `equipamento.ip_address`, e o tipo é `VARCHAR(45)` **desde a `V4`**, não `INET`:

   ```
    ip_address          | character varying(45)    |           |          |
   ```

   Um registro anterior desta série afirmou que a coluna era `INET`; **estava errado**, no nome e no
   tipo. A `V2:88` de fato a criou como `INET NOT NULL`, com `ck_equipamento_ip_e_host` (`V2:104-106`)
   exigindo máscara de host; a `V4:5-9` derrubou a constraint e converteu para `VARCHAR(45)` NULL.
   O CLAUDE.md do projeto registrava "endereços IP deverão utilizar o tipo PostgreSQL `INET`" como
   decisão arquitetural sem mencionar o desvio; **corrigido em 2026-09-22** (`CLAUDE.md:45-46` agora
   nota o estado real). A divergência entre decisão e banco em si — `VARCHAR(45)` no lugar de
   `INET` — segue aberta; só a lacuna de registro foi fechada.

   O risco **aumentou** com a conversão: `VARCHAR(45)` não valida nada — aceita IPv6, hostname e
   lixo, enquanto o `INET` original ao menos rejeitava o que não fosse endereço. Um alvo não-IPv4
   faz `paraOrdemDeRede` lançar `IllegalArgumentException` (`:109`), que o
   `catch (RuntimeException | LinkageError)` de `:64` transforma em `IcmpResult.erro(0)`, e o banco
   recebe medição `FALHA` com `"Erro ICMP não identificado"` em **toda** sondagem daquele monitor,
   sem nada apontar para a causa.
5. `monitoring.engine.enabled` aceita binding relaxado do Spring (`yes`, `on`, `1`) para
   `MonitoringEngineProperties.isEnabled()`, mas `IcmpRunnerConfiguration` usa
   `@ConditionalOnProperty(prefix = "monitoring.engine", name = "enabled", havingValue = "true")`,
   que compara o valor bruto da property literalmente contra a string `"true"`. Com um desses
   valores relaxados, `isEnabled()` devolve `true` e `IcmpAmbienteConfiguration` carrega a DLL
   ansiosamente na subida — ela roda fora do `@ConditionalOnProperty` do motor, de proposito, para
   que `/api/v1/status` sempre tenha o que informar — mas o `@ConditionalOnProperty` do
   `IcmpRunnerConfiguration` não bate com o valor relaxado e o bean do runner não é montado: o
   motor nunca chega a ser efetivamente montado. Com
   `monitoring.icmp.implementacao=nativo-windows`, essa carga ansiosa derruba a subida inteira
   (`IcmpAmbienteConfiguration.resolver` lança `IllegalStateException` quando a implementação
   nativa foi pedida explicitamente e a carga falha) por um motor que nunca seria usado. Antes
   desta rodada a carga era preguiçosa (por sondagem), então nada disparava; a carga ansiosa é
   nova nesta rodada, e o risco é novo junto com ela. Registrado como dívida; comportamento não
   alterado nesta rodada.

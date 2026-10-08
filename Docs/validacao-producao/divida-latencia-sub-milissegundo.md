# Dívida: latência sub-milissegundo gravada como 0

Registro de dívida. **Nenhum código nem schema foi alterado** por este documento.

## Sintoma

`medicao.latencia_ms` é `INTEGER` (`V6__create_medicao.sql`, linha 6). Um RTT menor que 1 ms é
arredondado para 0 antes de chegar ao banco e gravado como `0`. Em servidor real na mesma rede o
RTT medido é da ordem de 0,3 ms, então o caso não é teórico: medições bem-sucedidas aparecem com
`0 ms` na tela, nos relatórios e no CSV/PDF. O `0` é um dado verdadeiro de "respondeu em menos de
1 ms", mas indistinguível de "não medido" para quem lê a coluna sem contexto.

O banco ainda protege a semântica: `ck_medicao_latencia_nao_negativa` (>= 0) e
`ck_medicao_falha_sem_latencia` (FALHA nunca tem latência), então `0` só ocorre em SUCESSO.

## Onde o valor é truncado (fonte)

| Caminho | Arquivo | O que acontece |
|---|---|---|
| Runner nativo Windows | `monitoring/icmp/nativo/IcmpEchoReply.java` (`roundTripTime`, `int`) e `WindowsNativeIcmpRunner.paraResultado` | `IcmpSendEcho` devolve o RTT já em ms inteiros. A resolução se perde na API do Windows, antes de qualquer código nosso. |
| Runner por processo | `monitoring/icmp/processo/PingOutputParser.java`, `latenciaMs(String)` | `"<1ms"` vira `0`; `time=0,31 ms` passa por `Math.round` e vira `0`. |
| Contrato do runner | `monitoring/icmp/IcmpResult.java` (`Integer rttMs`) | O tipo já é inteiro. |
| Executor | `monitoring/icmp/IcmpMonitorExecutor.java` (`MonitorExecutionResult.success(int, ...)`) | Repassa o inteiro; `rttMs == null` vira `0`. |

Todas as camadas abaixo do runner herdam a perda; consertar só a coluna não recupera a precisão
sem mudar também a fonte.

## Opções

**A. `NUMERIC(10,3)` em milissegundos.** Mantém o nome e a unidade (`latencia_ms`), só ganha casas
decimais. Menor mudança conceitual: `avg` e comparações continuam em ms. Risco: aritmética
decimal em toda a pilha (`BigDecimal` no Java, número fracionário no JSON e no front).

**B. `latencia_us BIGINT` em microssegundos.** Inteiro exato, sem ponto flutuante nem
arredondamento; exige conversão explícita em toda exibição (÷ 1000) e renomeia a coluna, o que
obriga a trocar o contrato JSON ou manter um campo derivado.

## Impacto por camada

1. **Migration nova** (nunca editar a V6): `ALTER COLUMN ... TYPE` (A) ou coluna nova + backfill
   (`latencia_ms * 1000`) + remoção da antiga (B), recriando as CHECK
   `ck_medicao_latencia_nao_negativa` e `ck_medicao_falha_sem_latencia`. O limiar do episódio,
   `monitor_episodio_latencia.limiar_ms INTEGER` (V15, linha 14, com `ck_..._limiar` > 0), pode
   continuar inteiro em ms: ele é configuração, não medição.
2. **Entidade e DTOs**: `medicao/entity/Medicao.java` (`latenciaMs`), `MedicaoResponse`,
   `CreateMedicaoRequest` (`@Min(0) Integer latenciaMs`), `MedicaoService`, `MedicaoController`;
   `dashboard/dto/DashboardEquipamentoResponse`, `DashboardEquipamentoListaResponse`;
   `relatorio/dto/HistoricoMedicaoResponse`, `LatenciaIcmpResponse`, `LatenciaUnidadeResponse`
   (min/máx hoje `Integer`); `monitoring/latency/dto/EpisodioLatenciaResponse` e
   `notificacao/dto/EpisodioLatenciaNotificacaoResponse` (pico). Muda o contrato JSON.
3. **SQL de relatório**: `relatorio/service/RelatorioService.java` (`min`, `round(avg(...),2)`,
   `max`, `percentile_cont(0.95)`, e a ordenação `latenciaMs`), `relatorio/pdf/VisaoGeralPdfRepository.java`
   (linhas 31 a 36; o `p95` hoje é `round(...)::numeric)::int`) e
   `relatorio/exportacao/RelatorioExportService.java` (linhas 46 a 61 e 121 a 130). Com A, o
   `round(avg, 2)` passa a mascarar a precisão ganha; com B, o `avg` precisa dividir por 1000.
4. **Comparação com limiar**: `dashboard/DashboardReadRepository.java` (linha 25,
   `um.latencia_ms > ?1`), `dashboard/OperationalStatusResolver.degradado(Integer, Integer)` e
   `monitoring/latency/LatencyEpisodeProcessor.java` (métodos `acimaDoLimiar` e `dentroDoLimiar`,
   `getLatenciaMs() > limiarMs`). Com B, o limiar tem de ser convertido para µs na
   comparação; com A, `0,3 > limiar_ms` continua correto, mas os tipos mudam (`BigDecimal` vs `int`).
5. **CSV e PDF**: `RelatorioExportService` (CSV, ponto decimal por decisão, ver
   `correcoes-pre-carga-real.md`) e `VisaoGeralPdfModel`/`VisaoGeralPdfRenderer` (`millis`,
   `decimalMillis`, hoje `Integer`/`BigDecimal` de 2 casas).
6. **Parser do ping**: `PingOutputParser.latenciaMs` precisa devolver fração (`time=0,31 ms`
   → 0,31 ms / 310 µs) e tratar `"<1ms"` sem inventar valor (opção: manter `0`/nulo explícito).
7. **Runner nativo**: `WindowsNativeIcmpRunner`/`IcmpEchoReply` **já entregam ms inteiro**;
   `IcmpSendEcho` não tem resolução melhor. Para ganhar precisão no Windows é preciso mudar a
   fonte (`QueryPerformanceCounter` em volta da chamada, ou outra API), o que é decisão própria. Sem
   isso, o lado Windows continua em ms inteiros mesmo com a coluna nova, e só o caminho por
   processo (Linux) ganha precisão. `IcmpResult.rttMs` e `IcmpMonitorExecutor` mudam de tipo.
8. **Frontend**: modelos `core/models/medicao.ts`, `relatorio.ts`, `dashboard.ts`,
   `dashboard-incidente.ts`, `episodio-latencia.ts`, `notificacao.ts`; exibição em
   `dashboard.component.ts` (`Math.round(media)`, linhas 219 e 228), `equipamento-list.component.html`
   (linha 145), `equipamento-detalhe-drawer.component.ts` (`Math.round(valor)`, linha 430),
   `incidentes/timeline/timeline.ts` (linhas 221, 258, 294, 307, `${latenciaMs} ms`),
   `incidente-detalhe-drawer.component`, `ocorrencia-grafico.component.ts` (eixo e escala),
   `unidades/detalhe/visao-geral.component`, `relatorios.component`, `medicao-list.component`.
   Além do tipo, há decisão de apresentação: "0,3 ms" em vez de "0 ms" e arredondamentos com
   `Math.round` que hoje escondem a fração.
9. **Zero na interface** (relacionado): as gavetas tratam `0 ms` de pico como valor neutro, de
   propósito (`correcoes-pre-carga-real.md`, item "zero"). Com a precisão corrigida, esse
   caso deixa de existir na prática, mas a regra continua correta.
10. **Testes**: fixtures de `Medicao` com `Integer`, `PingOutputParserTest`, testes de relatório e
    PDF, e specs do front que afirmam `"55,00 ms"`.

## Recomendação

Opção **A (`NUMERIC(10,3)` em ms)**, em uma única migration `ALTER COLUMN TYPE` (conversão
implícita sem perda de dados existentes, pois todo valor atual é inteiro). Mantém nome, unidade e
limiar em ms; a mudança é de tipo, não de conceito. Fazer em duas etapas independentes:

1. coluna, entidade, DTOs, SQL e front (precisão suportada de ponta a ponta);
2. fonte: `PingOutputParser` (simples) e runner nativo (decisão separada, ver item 7).

Enquanto a etapa 2 do Windows não existir, a coluna nova não muda o que o produto mede nesta
máquina.

## Gatilho de cobrança

Tratar quando **qualquer** destas condições aparecer:

- o primeiro equipamento real da carga mostrar um percentual relevante de medições `0 ms` (por
  exemplo, mais de 10% das medições SUCESSO de um monitor na mesma LAN do servidor);
- alguém precisar de limiar de degradação abaixo de 1 ms, ou de média/p95 de enlaces locais;
- relatório de SLA de latência passar a ser entregue a terceiros (média inteira esconde variação).

Não bloqueia a carga real: o efeito é perda de resolução, não perda de disponibilidade nem falso
incidente (a comparação `> limiar_ms` com limiar >= 1 ms trata `0` corretamente).

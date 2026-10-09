# Rodada curta antes da carga real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A timeline só afirma o que lista; o cadastro só aceita IPv4 de host monitorável (API, banco, tela, script); monitoramento parado fica investigado e documentado.

**Architecture:** Item 1: o backend expõe o motivo de encerramento do episódio, e o módulo puro `timeline.ts` decide o texto a partir da sequência de fechamento que encontrou de fato. Item 2: uma regra única (`RegraIpv4`) alimenta a anotação Bean Validation e a defesa no service. A mesma regra vira CHECK na V20, validator no Angular e função no script de carga. Item 3: só documento.

**Tech Stack:** Java 21, Spring Boot 4.1, Flyway, PostgreSQL 16, Testcontainers; Angular (builder `@angular/build:unit-test`), Playwright; Node ≥ 18 (`node --test`).

**Spec:** `Docs/superpowers/specs/2026-10-09-rodada-curta-pre-carga-design.md`

## Global Constraints

- Banco de dev (`inframonitor-postgres`, porta 5434): só `SELECT`. Nunca subir a aplicação apontando para ele (o Flyway aplicaria a V20).
- Motor nunca contra o dev. `MONITORING_ENGINE_ENABLED`, `TELEGRAM_ENABLED` e `NOTIFICATION_DISPATCHER_ENABLED` ficam no default `false`. `.env` não é exportado.
- Sem Lombok, sem abstração especulativa, datas `Instant`.
- Mensagens do backend e do script **sem acento**, como as já existentes (`"deve conter exatamente 7 digitos"`). As do frontend **com acento**, com a mesma redação.
- Nunca editar migration já executada. A mudança de schema é só a `V20__check_equipamento_ip_ipv4.sql`.
- Commits locais terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nada de push.
- Backend: `cd infra-monitor-backend && ./mvnw test`. Frontend: `cd infra-monitor-frontend && npx ng test --watch=false`. Script: `cd tools/carga-real && node --test test/`.
- Dois agentes **não** rodam `./mvnw` ao mesmo tempo (o `target/` é compartilhado).

## Review Focus

1. IP com espaços ao redor (`" 10.0.0.1 "`) tem de continuar aceito e ser gravado sem espaço. Testado em T3 (regra) e T5 (form).
2. Equipamento sem IP (`null`/`""`) continua válido em todas as camadas, inclusive no CHECK. Testado em T3, T4 e T6.
3. Episódio pré-V19 (`motivoEncerramento` nulo) sem sequência não pode virar "Latência normalizada". Testado em T2.
4. Sequência parcial não pode ganhar numeração `k/N` começando em 1. Testado em T2.
5. Edição de equipamento já cadastrado com IP válido não pode ser bloqueada pelo validator novo, e o form carregado não pode nascer inválido. Testado em T5.

---

## Wave plan (paralelismo)

- **Agente Backend** (sequencial, é o único a rodar `./mvnw`): T1 → T3 → T4.
- **Agente Frontend** (sequencial): T2 → T5. T2 depende só do contrato de T1 (campo `motivoEncerramento` no JSON do episódio), definido abaixo.
- **Agente Script**: T6.
- **Agente Investigação** (só leitura): T7.
- **Controlador** (depois das ondas): T8 (e2e Playwright no ambiente descartável) e T9 (suítes finais e docs).

---

### Task 1: Expor o motivo de encerramento do episódio de latência

**Files:**
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/latency/dto/EpisodioLatenciaResponse.java`
- Modify: `infra-monitor-backend/src/main/java/br/com/inframonitor/monitoring/latency/service/EpisodioLatenciaService.java:36-39`
- Test: `infra-monitor-backend/src/test/java/br/com/inframonitor/monitoring/latency/controller/EpisodioLatenciaControllerTest.java`

**Interfaces:**
- Produces: JSON do episódio (`GET /api/v1/episodios-latencia/{id}`; conferir a rota no controller) ganha `"motivoEncerramento": "NORMALIZACAO" | "INCIDENTE" | "MANUTENCAO" | null`, como último componente do record.

- [ ] **Step 1: Teste que falha.** Em `EpisodioLatenciaControllerTest`, troque o construtor (`:27-29`) para passar `MotivoEncerramentoEpisodio.INCIDENTE` como último argumento e um `encerradoEm` não nulo (`Instant.parse("2026-09-01T08:45:11Z")`). No teste que faz `GET` do id 1, acrescente:

```java
.andExpect(jsonPath("$.motivoEncerramento").value("INCIDENTE"))
```

- [ ] **Step 2: Confirmar a falha.** `./mvnw -q test -Dtest=EpisodioLatenciaControllerTest`. Esperado: erro de compilação, porque o construtor tem um argumento a mais.

- [ ] **Step 3: Implementar.** No record, acrescente o componente e atualize o javadoc:

```java
public record EpisodioLatenciaResponse(Long id,
                                       Long monitorId, String monitorNome,
                                       Long equipamentoId, String equipamentoNome,
                                       Long unidadeId, String unidadeNome,
                                       Instant iniciadoEm, Instant encerradoEm, int limiarMs,
                                       int ciclosParaEpisodio,
                                       MotivoEncerramentoEpisodio motivoEncerramento) {
}
```

Javadoc a acrescentar: `{@code motivoEncerramento} nulo em episodio aberto ou encerrado antes da V19 (sem backfill, ver V19)`. Import `br.com.inframonitor.monitoring.latency.MotivoEncerramentoEpisodio`. No service, passe `episodio.getMotivoEncerramento()` como último argumento. Rode `grep -rn "new EpisodioLatenciaResponse(" src` e corrija todo construtor em main e test.

- [ ] **Step 4: Verde.** `./mvnw -q test -Dtest='EpisodioLatencia*'`. Esperado: PASS.

- [ ] **Step 5: Commit.** `feat(latencia): expoe motivo de encerramento do episodio`

---

### Task 2: Timeline só cita N quando lista as N medições

**Files:**
- Modify: `infra-monitor-frontend/src/app/core/models/api-enums.ts` (novo enum)
- Modify: `infra-monitor-frontend/src/app/core/models/episodio-latencia.ts`
- Modify: `infra-monitor-frontend/src/app/features/incidentes/timeline/timeline.ts`
- Modify: `infra-monitor-frontend/src/app/features/incidentes/incidente-detalhe-drawer.component.ts` (`OcorrenciaDetalhe` `:39-60`, `deIncidente` ~`:449`, `deEpisodio` `:461-480`)
- Test: `infra-monitor-frontend/src/app/features/incidentes/timeline/timeline.spec.ts`, mais fixtures de `incidente-detalhe-drawer.component.spec.ts` e de qualquer spec que monte `EpisodioLatenciaResponse` ou `OcorrenciaTimeline` (`grep -rn "ciclosParaEpisodio" src --include=*.spec.ts`)
- Evidence: `Docs/validacao-producao/evidencias/timeline-1-sem-correcao.txt`, `timeline-2-com-correcao.txt`

**Interfaces:**
- Consumes (T1): `EpisodioLatenciaResponse.motivoEncerramento: LatencyClosureReason | null`.
- Produces:

```ts
// api-enums.ts
export enum LatencyClosureReason {
  Normalization = 'NORMALIZACAO',
  Incident = 'INCIDENTE',
  Maintenance = 'MANUTENCAO',
}
// OcorrenciaTimeline e OcorrenciaDetalhe
motivoEncerramentoEpisodio: LatencyClosureReason | null; // só o episódio tem
```

- [ ] **Step 1: Modelos (só tipos).** Acrescente o enum. Em `episodio-latencia.ts`, depois de `ciclosParaEpisodio`, acrescente:

```ts
  /** Nulo em episódio aberto ou encerrado antes da V19, que não fez backfill. */
  motivoEncerramento: LatencyClosureReason | null;
```

Acrescente também `motivoEncerramentoEpisodio: LatencyClosureReason | null;` em `OcorrenciaTimeline` (timeline.ts) e em `OcorrenciaDetalhe` (drawer). No drawer: `deIncidente` passa `motivoEncerramentoEpisodio: null`; `deEpisodio` passa `motivoEncerramentoEpisodio: episodio.motivoEncerramento`. Corrija as fixtures de spec que deixarem de compilar, acrescentando `motivoEncerramentoEpisodio: null` (ou `motivoEncerramento: null` nos `EpisodioLatenciaResponse`).

- [ ] **Step 2: Testes novos (falham contra o código atual).** Em `timeline.spec.ts`, acrescente um `describe('só afirma o que lista', ...)` reaproveitando `medicao`, `entradaDeIncidente` e `entradaDeEpisodio`. As constantes de texto saem da spec:

```ts
const AUTO_SEM_SEQUENCIA = 'Recuperação automática registrada pelo motor; a sequência completa de respostas não está no histórico carregado';
const NORMALIZACAO_SEM_SEQUENCIA = 'Normalização registrada pelo motor; a sequência completa de medições não está no histórico carregado';

describe('só afirma o que lista', () => {
  const fechamentoDe = (entrada: EntradaTimeline) => derivarTimeline(entrada).find(e => e.tipo === 'fechamento');
  const recuperacoesDe = (entrada: EntradaTimeline) => derivarTimeline(entrada).filter(e => e.tipo === 'recuperacao').map(e => e.rotulo);

  it('recuperação automática sem nenhuma resposta no histórico não cita N', () => {
    const entrada = { ...entradaDeIncidente, medicoes: medicoesDoIncidente.slice(0, 4) };
    expect(fechamentoDe(entrada)?.detalhe).toBe(AUTO_SEM_SEQUENCIA);
    expect(recuperacoesDe(entrada)).toEqual([]);
  });

  it('recuperação automática com sequência parcial lista sem numerar e não cita N', () => {
    // Só a última resposta (a do encerramento) está no histórico: a 08:02:00 sumiu.
    const entrada = { ...entradaDeIncidente, medicoes: [...medicoesDoIncidente.slice(0, 4), medicoesDoIncidente[5]] };
    expect(recuperacoesDe(entrada)).toEqual(['Resposta ICMP']);
    expect(fechamentoDe(entrada)?.detalhe).toBe(AUTO_SEM_SEQUENCIA);
  });

  it('N maior que a sequência medida (limiar editado depois) não cita N', () => {
    const entrada = { ...entradaDeIncidente, limiares: { falhasParaIncidente: 3, sucessosParaRecovery: 3 } };
    expect(recuperacoesDe(entrada)).toEqual(['Resposta ICMP', 'Resposta ICMP']);
    expect(fechamentoDe(entrada)?.detalhe).toBe(AUTO_SEM_SEQUENCIA);
  });

  it('sequência completa continua numerada e cita N', () => {
    expect(recuperacoesDe(entradaDeIncidente)).toEqual(['Resposta ICMP — recuperação 1/2', 'Resposta ICMP — recuperação 2/2']);
    expect(fechamentoDe(entradaDeIncidente)?.detalhe).toBe('2 respostas consecutivas restabeleceram o monitor');
  });

  it('legado sem autor com sequência parcial lista sem numerar e não afirma causa', () => {
    const entrada = {
      ...entradaDeIncidente,
      ocorrencia: { ...entradaDeIncidente.ocorrencia, motivoEncerramento: null },
      medicoes: [...medicoesDoIncidente.slice(0, 4), medicoesDoIncidente[5]],
    };
    expect(recuperacoesDe(entrada)).toEqual(['Resposta ICMP']);
    expect(fechamentoDe(entrada)?.rotulo).toBe('Incidente fechado');
    expect(fechamentoDe(entrada)?.detalhe).toBeNull();
  });

  const episodioCom = (motivo: LatencyClosureReason | null, medicoes = entradaDeEpisodio.medicoes) => ({
    ...entradaDeEpisodio, medicoes,
    ocorrencia: { ...entradaDeEpisodio.ocorrencia, motivoEncerramentoEpisodio: motivo },
  });

  it('episódio encerrado por incidente não diz que normalizou', () => {
    const eventos = derivarTimeline(episodioCom(LatencyClosureReason.Incident));
    const fechamento = eventos.find(e => e.tipo === 'fechamento');
    expect(fechamento?.rotulo).toBe('Encerrado pela abertura de incidente');
    expect(fechamento?.detalhe).toBe('O monitor deixou de responder e um incidente foi aberto. A latência não normalizou.');
    expect(fechamento?.severidade).toBe('critico');
    expect(eventos.some(e => e.tipo === 'recuperacao')).toBe(false);
  });

  it('episódio encerrado por manutenção não diz que normalizou', () => {
    const eventos = derivarTimeline(episodioCom(LatencyClosureReason.Maintenance));
    const fechamento = eventos.find(e => e.tipo === 'fechamento');
    expect(fechamento?.rotulo).toBe('Encerrado por manutenção');
    expect(fechamento?.detalhe).toBe('O equipamento entrou em manutenção e saiu da observação. Nenhuma normalização foi medida.');
    expect(eventos.some(e => e.tipo === 'recuperacao')).toBe(false);
  });

  it('normalização com sequência completa cita N', () => {
    const fechamento = derivarTimeline(episodioCom(LatencyClosureReason.Normalization)).find(e => e.tipo === 'fechamento');
    expect(fechamento?.rotulo).toBe('Latência normalizada');
    expect(fechamento?.detalhe).toBe('2 medições consecutivas dentro do limiar encerraram o episódio');
  });

  it('normalização sem a sequência no histórico não cita N nem numera', () => {
    const semUltima = entradaDeEpisodio.medicoes.slice(0, -2).concat(entradaDeEpisodio.medicoes.slice(-1));
    const eventos = derivarTimeline(episodioCom(LatencyClosureReason.Normalization, semUltima));
    expect(eventos.find(e => e.tipo === 'fechamento')?.detalhe).toBe(NORMALIZACAO_SEM_SEQUENCIA);
    expect(eventos.filter(e => e.tipo === 'recuperacao').every(e => e.rotulo === 'Dentro do limiar')).toBe(true);
  });

  it('episódio legado sem sequência não vira "Latência normalizada"', () => {
    const semUltima = entradaDeEpisodio.medicoes.slice(0, -2).concat(entradaDeEpisodio.medicoes.slice(-1));
    const fechamento = derivarTimeline(episodioCom(null, semUltima)).find(e => e.tipo === 'fechamento');
    expect(fechamento?.rotulo).toBe('Episódio encerrado');
    expect(fechamento?.detalhe).toBeNull();
  });

  it('episódio legado com sequência completa é lido como normalização', () => {
    const fechamento = derivarTimeline(episodioCom(null)).find(e => e.tipo === 'fechamento');
    expect(fechamento?.rotulo).toBe('Latência normalizada');
  });
});
```

Antes de fixar os índices, leia `medicoesDoEpisodio` (spec `:100-111`) e confira que `semUltima` remove de fato a penúltima medição dentro do limiar, deixando só a do encerramento. Se o fixture tiver outra forma, ajuste os índices: o objetivo é "a medição do `encerradoEm` presente, a anterior ausente". `entradaDeEpisodio` está dentro de um `describe`; se o novo bloco não a enxergar, mova o novo `describe` para dentro dele ou extraia o fixture para o escopo do arquivo.

- [ ] **Step 3: Prova de reversão.** Com os testes novos e os modelos do Step 1, mas com o `timeline.ts` sem a mudança de lógica:

```bash
cd infra-monitor-frontend
npx ng test --watch=false --include=src/app/features/incidentes/timeline/timeline.spec.ts 2>&1 | tee ../Docs/validacao-producao/evidencias/timeline-1-sem-correcao.txt
```

Esperado: FALHA nos casos novos (AUTO sem sequência, parcial, N maior, legado parcial, episódio INCIDENTE/MANUTENCAO, normalização sem sequência, legado sem sequência). Se `--include` não for aceito pelo builder, use o filtro que o `@angular/build:unit-test` aceitar (ver `npx ng test --help`) e registre o comando usado na evidência.

- [ ] **Step 4: Implementar em `timeline.ts`.**

(a) Import `LatencyClosureReason` de `api-enums`.

(b) Em `eventosDeFechamento`, troque o trecho a partir de `const recuperacao = ...` por:

```ts
  const total = limiares.sucessosParaRecovery;
  const sequencia = sequenciaDeFechamento(encerradoEm, medicoes, total,
    (medicao) => medicao.status === MeasurementStatus.Success);
  const completa = total !== null && sequencia.length === total;
  const recuperacao = eventosDeRecuperacao(sequencia, completa ? total : null);
  if (completa) {
    return [...recuperacao, fechamento('Incidente fechado',
      `${plural(total, 'resposta consecutiva', 'respostas consecutivas')} ${total === 1 ? 'restabeleceu' : 'restabeleceram'} o monitor`)];
  }
  // N só é dito quando as N respostas estão na tela. O motivo gravado prova que foi o motor,
  // não quantas respostas ele exigiu: o N exibido é o limiar de hoje, não o da hora do fechamento.
  return [...recuperacao, fechamento('Incidente fechado',
    motivo === IncidentClosureReason.AutomaticRecovery ? RECUPERACAO_SEM_SEQUENCIA : null)];
```

Remova o `if (motivo === null && recuperacao.length === 0)`, que fica coberto. Constantes no topo do módulo:

```ts
const RECUPERACAO_SEM_SEQUENCIA =
  'Recuperação automática registrada pelo motor; a sequência completa de respostas não está no histórico carregado';
const NORMALIZACAO_SEM_SEQUENCIA =
  'Normalização registrada pelo motor; a sequência completa de medições não está no histórico carregado';
```

(c) `eventosDeRecuperacao` recebe a sequência pronta:

```ts
/** `total` nulo = sequência incompleta: lista o que foi medido sem numerar, porque as encontradas são as últimas, não as primeiras. */
function eventosDeRecuperacao(sequencia: HistoricoMedicaoResponse[], total: number | null): EventoTimeline[] {
  return sequencia.map((medicao, indice) => ({
    chave: `recuperacao-${medicao.medicaoId}`,
    instante: medicao.executadoEm,
    tipo: 'recuperacao' as const,
    severidade: 'ok' as const,
    rotulo: total !== null ? `Resposta ICMP — recuperação ${indice + 1}/${total}` : 'Resposta ICMP',
    detalhe: medicao.latenciaMs !== null ? `${medicao.latenciaMs} ms` : null,
  }));
}
```

(d) Em `eventosDeLatencia`, troque o bloco `if (ocorrencia.encerradoEm) { ... }` por `if (ocorrencia.encerradoEm) eventos.push(...eventosDeEncerramentoDoEpisodio(ocorrencia, ocorrencia.encerradoEm, medicoes, total, limiar));` e acrescente:

```ts
/**
 * Mesmo critério do incidente: o motivo diz o caminho, a sequência listada diz o N.
 * INCIDENTE e MANUTENCAO não têm normalização para mostrar — a latência não melhorou.
 */
function eventosDeEncerramentoDoEpisodio(ocorrencia: OcorrenciaTimeline, encerradoEm: string,
                                         medicoes: HistoricoMedicaoResponse[], total: number | null,
                                         limiar: number | null): EventoTimeline[] {
  const fechamento = (rotulo: string, detalhe: string | null,
                      severidade: SeveridadeEvento = 'ok'): EventoTimeline => ({
    chave: 'fechamento', instante: encerradoEm, tipo: 'fechamento', severidade, rotulo, detalhe,
  });
  const motivo = ocorrencia.motivoEncerramentoEpisodio;
  if (motivo === LatencyClosureReason.Incident) {
    return [fechamento('Encerrado pela abertura de incidente',
      'O monitor deixou de responder e um incidente foi aberto. A latência não normalizou.', 'critico')];
  }
  if (motivo === LatencyClosureReason.Maintenance) {
    return [fechamento('Encerrado por manutenção',
      'O equipamento entrou em manutenção e saiu da observação. Nenhuma normalização foi medida.')];
  }
  const sequencia = sequenciaDeFechamento(encerradoEm, medicoes, total, (medicao) => dentroDoLimiar(medicao, limiar));
  const completa = total !== null && sequencia.length === total;
  const normalizacao = sequencia.map((medicao, indice): EventoTimeline => ({
    chave: `normalizacao-${medicao.medicaoId}`,
    instante: medicao.executadoEm,
    tipo: 'recuperacao',
    severidade: 'ok',
    rotulo: completa ? `Dentro do limiar — normalização ${indice + 1}/${total}` : 'Dentro do limiar',
    detalhe: medicao.latenciaMs !== null ? `${medicao.latenciaMs} ms` : null,
  }));
  if (completa) {
    return [...normalizacao, fechamento('Latência normalizada',
      `${plural(total, 'medição consecutiva', 'medições consecutivas')} dentro do limiar ${total === 1 ? 'encerrou' : 'encerraram'} o episódio`)];
  }
  if (motivo === LatencyClosureReason.Normalization) {
    return [...normalizacao, fechamento('Latência normalizada', NORMALIZACAO_SEM_SEQUENCIA)];
  }
  // Pré-V19: normalização e encerramento por incidente gravavam as mesmas colunas.
  return [...normalizacao, fechamento('Episódio encerrado', null)];
}
```

No narrowing de `total` dentro de `plural(total, ...)`: se o TS não estreitar a partir de `completa`, use `total!`, ou reestruture com `if (total !== null && sequencia.length === total)`.

(e) Atualize o docstring de `eventosDeFechamento`: N só é dito com a sequência completa na tela.

- [ ] **Step 5: Ajustar testes antigos que afirmavam o comportamento revertido.** Rode a spec inteira. Testes antigos que esperam `'episódio encerrado automaticamente'` (N nulo) ou "Latência normalizada" sem motivo e sem sequência passam a esperar `'Episódio encerrado'` / `null`. Mude **só** o esperado, nunca o fixture, e diga no relatório quais testes mudaram e por quê. Rode depois a suíte inteira do frontend.

- [ ] **Step 6: Verde e evidência.**

```bash
npx ng test --watch=false --include=src/app/features/incidentes/timeline/timeline.spec.ts 2>&1 | tee ../Docs/validacao-producao/evidencias/timeline-2-com-correcao.txt
npx ng test --watch=false
```

Esperado: tudo PASS. Registre as contagens.

- [ ] **Step 7: Commit.** `fix(timeline): so cita N quando a sequencia esta listada; motivo do episodio` (inclui as duas evidências).

---

### Task 3: Regra única de IPv4 monitorável no backend

**Files:**
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/equipamento/validation/RegraIpv4.java`
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/equipamento/validation/Ipv4Monitoravel.java`
- Create: `infra-monitor-backend/src/main/java/br/com/inframonitor/equipamento/validation/Ipv4MonitoravelValidator.java`
- Modify: `equipamento/dto/CreateEquipamentoRequest.java`, `equipamento/dto/UpdateEquipamentoRequest.java` (campo `ip`)
- Modify: `equipamento/service/EquipamentoService.java:262-276` (`normalizarIp`)
- Test: Create `src/test/java/br/com/inframonitor/equipamento/validation/RegraIpv4Test.java`; Modify `equipamento/controller/EquipamentoControllerTest.java`; conferir `EquipamentoServiceTest` (mensagens antigas)

**Interfaces:**
- Produces: `RegraIpv4.motivoDeRecusa(String valor) → String` (nulo = aceito). Mensagens (constantes públicas):
  - `IPV6 = "apenas IPv4 e suportado: o monitoramento ICMP nao sonda IPv6"`
  - `FORMATO = "deve ser um endereco IPv4 no formato 192.168.0.10"`
  - `OCTETO_FORA_DA_FAIXA = "cada octeto do IP vai de 0 a 255"`
  - `ZERO_A_ESQUERDA = "octeto com zero a esquerda e ambiguo (pode ser lido como octal): escreva 10.0.0.1, nao 010.000.000.001"`
  - `REDE_ZERO = "a faixa 0.0.0.0/8 nao e endereco de host"`
  - `NAO_HOST = "multicast, reservado ou broadcast (224.0.0.0 em diante) nao e endereco de host monitoravel"`
- API: IP recusado → 400 `VALIDATION_ERROR` com `fields.ip` = a mensagem.

- [ ] **Step 1: Teste da regra (falha: classe não existe).**

```java
package br.com.inframonitor.equipamento.validation;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

class RegraIpv4Test {

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"   ", "10.0.0.1", " 10.0.0.1 ", "1.0.0.0", "223.255.255.255", "127.0.0.1",
            "192.168.0.10", "169.254.1.1", "8.8.8.8", "100.64.0.1", "10.0.0.0", "10.10.100.200"})
    void aceita(String valor) {
        assertThat(RegraIpv4.motivoDeRecusa(valor)).isNull();
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "2001:db8::1|IPV6", "::1|IPV6", "::ffff:10.0.0.1|IPV6", "fe80::1%eth0|IPV6",
            "10.0.0|FORMATO", "10.0.0.1.5|FORMATO", "servidor.local|FORMATO", "10.0.0.1/32|FORMATO",
            "10.0.0.-1|FORMATO", "1000.0.0.1|FORMATO", "10..0.1|FORMATO", "10.0.0.1 x|FORMATO", "١٠.0.0.1|FORMATO",
            "256.0.0.1|OCTETO_FORA_DA_FAIXA", "10.0.0.999|OCTETO_FORA_DA_FAIXA",
            "010.0.0.1|ZERO_A_ESQUERDA", "10.0.0.01|ZERO_A_ESQUERDA", "10.00.0.1|ZERO_A_ESQUERDA",
            "0.0.0.0|REDE_ZERO", "0.1.2.3|REDE_ZERO",
            "224.0.0.1|NAO_HOST", "239.255.255.250|NAO_HOST", "240.0.0.1|NAO_HOST", "255.255.255.255|NAO_HOST"})
    void recusaComMotivo(String valor, String motivo) throws Exception {
        String esperado = (String) RegraIpv4.class.getField(motivo).get(null);
        assertThat(RegraIpv4.motivoDeRecusa(valor)).isEqualTo(esperado);
    }
}
```

- [ ] **Step 2: Confirmar a falha.** `./mvnw -q test -Dtest=RegraIpv4Test`. Esperado: erro de compilação.

- [ ] **Step 3: Implementar `RegraIpv4`.**

```java
package br.com.inframonitor.equipamento.validation;

import java.util.regex.Pattern;

/**
 * Unica regra de IP de equipamento. O motor so sonda IPv4 (WindowsNativeIcmpRunner
 * converte octetos em decimal; o ping do Linux le "010" como octal), entao tudo que
 * nao for um endereco IPv4 de host sem ambiguidade e recusado na entrada — senao
 * falha em toda sondagem e abre incidente permanente sem apontar a causa.
 *
 * <p>Espelhos: CHECK da V20, {@code ip-helper.ts} no frontend e
 * {@code tools/carga-real/lib/validacao.mjs}. Mudou aqui, muda nos tres.
 */
public final class RegraIpv4 {

    public static final String IPV6 = "apenas IPv4 e suportado: o monitoramento ICMP nao sonda IPv6";
    public static final String FORMATO = "deve ser um endereco IPv4 no formato 192.168.0.10";
    public static final String OCTETO_FORA_DA_FAIXA = "cada octeto do IP vai de 0 a 255";
    public static final String ZERO_A_ESQUERDA =
            "octeto com zero a esquerda e ambiguo (pode ser lido como octal): escreva 10.0.0.1, nao 010.000.000.001";
    public static final String REDE_ZERO = "a faixa 0.0.0.0/8 nao e endereco de host";
    public static final String NAO_HOST =
            "multicast, reservado ou broadcast (224.0.0.0 em diante) nao e endereco de host monitoravel";

    // [0-9] e nao \d: so digito ASCII.
    private static final Pattern QUATRO_OCTETOS = Pattern.compile("[0-9]{1,3}(\\.[0-9]{1,3}){3}");

    private RegraIpv4() {
    }

    /** Nulo quando aceito. Nulo, vazio ou so espacos e "sem IP", que e permitido. */
    public static String motivoDeRecusa(String valor) {
        if (valor == null || valor.isBlank()) return null;
        String ip = valor.trim();
        if (ip.indexOf(':') >= 0) return IPV6;
        if (!QUATRO_OCTETOS.matcher(ip).matches()) return FORMATO;
        String[] octetos = ip.split("\\.");
        for (String octeto : octetos) {
            if (Integer.parseInt(octeto) > 255) return OCTETO_FORA_DA_FAIXA;
        }
        for (String octeto : octetos) {
            if (octeto.length() > 1 && octeto.charAt(0) == '0') return ZERO_A_ESQUERDA;
        }
        int primeiro = Integer.parseInt(octetos[0]);
        if (primeiro == 0) return REDE_ZERO;
        if (primeiro >= 224) return NAO_HOST;
        return null;
    }
}
```

Confira que `normalizarOpcional` do service usa `trim()`. Se usar `strip()`, use `strip()` aqui também, para que as duas camadas concordem.

- [ ] **Step 4: Verde.** `./mvnw -q test -Dtest=RegraIpv4Test`. Esperado: PASS.

- [ ] **Step 5: Teste do controller (falha).** Em `EquipamentoControllerTest`:

```java
    @Test
    void recusaIpNaoMonitoravelComMensagemNoCampo() throws Exception {
        mockMvc.perform(post("/api/v1/equipamentos").contentType(MediaType.APPLICATION_JSON)
                        .content(corpoValido().replace("10.0.0.10", "2001:db8::1")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
                .andExpect(jsonPath("$.fields.ip").value(RegraIpv4.IPV6));
        mockMvc.perform(put("/api/v1/equipamentos/1").contentType(MediaType.APPLICATION_JSON)
                        .content(corpoValido().replace("10.0.0.10", "010.0.0.10")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fields.ip").value(RegraIpv4.ZERO_A_ESQUERDA));
        verify(equipamentoService, never()).criar(any());
        verify(equipamentoService, never()).atualizar(any(), any());
    }
```

(import estático `org.mockito.Mockito.never`; import de `RegraIpv4`.) Esperado: FAIL, porque hoje o mock recebe a chamada e responde 201/200.

- [ ] **Step 6: Anotação e validator.**

```java
package br.com.inframonitor.equipamento.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** IP opcional; quando presente, so IPv4 de host monitoravel. Regra em {@link RegraIpv4}. */
@Documented
@Constraint(validatedBy = Ipv4MonitoravelValidator.class)
@Target({ElementType.FIELD, ElementType.METHOD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
public @interface Ipv4Monitoravel {
    String message() default RegraIpv4.FORMATO;
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
```

```java
package br.com.inframonitor.equipamento.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

/** Troca a mensagem padrao pelo motivo exato, para o formulario dizer o que corrigir. */
public class Ipv4MonitoravelValidator implements ConstraintValidator<Ipv4Monitoravel, String> {

    @Override
    public boolean isValid(String valor, ConstraintValidatorContext contexto) {
        String motivo = RegraIpv4.motivoDeRecusa(valor);
        if (motivo == null) return true;
        contexto.disableDefaultConstraintViolation();
        contexto.buildConstraintViolationWithTemplate(motivo).addConstraintViolation();
        return false;
    }
}
```

Nos dois DTOs: `@Size(max = 45) @Ipv4Monitoravel String ip,`.

- [ ] **Step 7: Service como defesa.** Troque o corpo de `normalizarIp`:

```java
    /** Defesa para chamador sem @Valid; a mesma regra do DTO (RegraIpv4). */
    private String normalizarIp(String ip) {
        String normalizado = normalizarOpcional(ip);
        if (normalizado == null) return null;
        String motivo = RegraIpv4.motivoDeRecusa(normalizado);
        if (motivo != null) throw new IllegalArgumentException("IP invalido: " + motivo);
        return normalizado;
    }
```

Atualize em `EquipamentoServiceTest` os testes que afirmavam `"IP deve ser um endereco IPv4 valido"`, e acrescente um caso `010.0.0.1` → `IllegalArgumentException` com mensagem contendo `RegraIpv4.ZERO_A_ESQUERDA`.

- [ ] **Step 8: Verde.** `./mvnw -q test -Dtest='RegraIpv4Test,EquipamentoControllerTest,EquipamentoServiceTest,TratadorGlobalDeErrosTest'`. Esperado: PASS.

- [ ] **Step 9: Commit.** `fix(equipamento): IP so aceita IPv4 de host, com motivo no campo`

---

### Task 4: V20 — CHECK de IPv4 no banco

**Files:**
- Create: `infra-monitor-backend/src/main/resources/db/migration/V20__check_equipamento_ip_ipv4.sql`
- Test: Create `infra-monitor-backend/src/test/java/br/com/inframonitor/equipamento/IpEquipamentoCheckPostgresIntegrationTest.java`

**Interfaces:**
- Consumes: a regra de `RegraIpv4` (T3), em regex POSIX.
- Produces: constraint `ck_equipamento_ip_ipv4`.

- [ ] **Step 1: Teste Postgres (falha sem a V20).** Copie a estrutura de `ManutencaoPostgresIntegrationTest`: `@EnabledIf("dockerDisponivel")`, as mesmas `properties`, o container `postgres:16-alpine`, `@DynamicPropertySource`, `JdbcTemplate`, e o truncate do `@BeforeEach` restrito a `equipamento, tipo_equipamento, unidade restart identity cascade`. Leia `V2`, `V3`, `V11`, `V14` e `V18` para os `NOT NULL` de `unidade` e `tipo_equipamento`, e insira uma unidade e um tipo mínimos no `@BeforeEach`. Teste:

```java
    @ParameterizedTest
    @ValueSource(strings = {"2001:db8::1", "010.0.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
            "256.0.0.1", "servidor", " 10.0.0.1", "10.0.0.1 "})
    void checkRecusaIpInvalidoGravadoPorSql(String ip) {
        assertThatThrownBy(() -> inserirEquipamento(ip))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_equipamento_ip_ipv4");
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"10.0.0.1", "1.0.0.0", "223.255.255.255", "127.0.0.1", "192.168.0.10", "10.0.0.0"})
    void checkAceitaIpv4DeHostENulo(String ip) {
        inserirEquipamento(ip);
        assertThat(jdbc.queryForObject("select count(*) from equipamento", Integer.class)).isEqualTo(1);
    }

    @Test
    void regraDoBancoConcordaComARegraJava() {
        // Mesmos casos dos dois lados: se a regex da V20 e RegraIpv4 divergirem, este teste diz qual.
        List<String> casos = List.of("10.0.0.1", "2001:db8::1", "010.0.0.1", "0.1.1.1", "223.1.1.1", "224.1.1.1",
                "10.0.0.255", "10.0.0.256", "1.2.3", "99.99.99.99", "100.100.100.100", "199.249.250.255");
        for (String caso : casos) {
            boolean banco = Boolean.TRUE.equals(jdbc.queryForObject(
                    "select ?::varchar ~ (select substring(pg_get_constraintdef(oid) from '''(.*)''') "
                            + "from pg_constraint where conname = 'ck_equipamento_ip_ipv4')", Boolean.class, caso));
            assertThat(banco).as(caso).isEqualTo(RegraIpv4.motivoDeRecusa(caso) == null);
        }
    }
```

`inserirEquipamento(String ip)` faz `jdbc.update("insert into equipamento (unidade_id, tipo_equipamento_id, nome, ip_address, ...) values (?, ?, ?, ?, ...)", ...)` com as colunas `NOT NULL` lidas das migrations e nome único por chamada. Se o `substring` sobre `pg_get_constraintdef` ficar frágil (o Postgres reescreve a expressão), troque por uma constante Java `REGEX_V20` copiada da migration e um teste que confira que `pg_get_constraintdef` contém essa constante. O objetivo é provar a concordância Java × banco.

Esperado sem a V20: os casos de recusa FALHAM (o insert passa).

- [ ] **Step 2: Migration.**

```sql
-- V20 - IP do equipamento: so IPv4 de host monitoravel, tambem no banco.
--
-- A V4 trocou INET NOT NULL por VARCHAR(45) NULL para permitir equipamento sem IP
-- e manter o mapeamento JPA simples. Desde entao o banco aceita qualquer texto
-- por SQL direto (seed, manutencao manual), e o motor so sonda IPv4: alvo
-- invalido falha em toda sondagem e abre incidente permanente.
--
-- Mesma regra de RegraIpv4 (API), ip-helper.ts (tela) e tools/carga-real:
--   1o octeto 1-223 (fora 0.0.0.0/8 e multicast/reservado/broadcast),
--   demais 0-255, sem zero a esquerda (o ping do Linux le "010" como octal),
--   sem espacos (a API grava sem eles).
-- NULL continua permitido (equipamento sem IP; o motor ignora o monitor).
--
-- Pre-checagem antes de aplicar em producao (tem de devolver 0):
--   SELECT count(*) FROM equipamento WHERE ip_address IS NOT NULL AND ip_address !~ '<regex abaixo>';
-- Dev em 2026-10-09: 222 equipamentos, 0 violacoes.
ALTER TABLE equipamento ADD CONSTRAINT ck_equipamento_ip_ipv4 CHECK (
    ip_address IS NULL
    OR ip_address ~ '^(22[0-3]|2[01][0-9]|1[0-9]{2}|[1-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9][0-9]|[0-9])){3}$'
);
```

No comentário, troque `<regex abaixo>` pela regex literal, para a pré-checagem ser copiável.

- [ ] **Step 3: Verde.** `./mvnw -q test -Dtest=IpEquipamentoCheckPostgresIntegrationTest`. Esperado: PASS (com Docker; sem Docker o teste é ignorado, e isso tem de ser dito no relatório).

- [ ] **Step 4: Suíte completa do backend.** `./mvnw test`. Esperado: BUILD SUCCESS. Algum teste Postgres que inseria IP fora da regra quebra aqui: corrija o **fixture** para um IP válido e liste no relatório.

- [ ] **Step 5: Commit.** `feat(db): V20 CHECK de IPv4 de host em equipamento.ip_address`

---

### Task 5: Validator espelho no formulário de equipamento

**Files:**
- Modify: `infra-monitor-frontend/src/app/features/equipamentos/ip-helper.ts`
- Modify: `infra-monitor-frontend/src/app/features/equipamentos/equipamento-list.component.ts:144` (controle `ip`)
- Modify: `infra-monitor-frontend/src/app/features/equipamentos/equipamento-list.component.html:235-237, 262-264`
- Test: Create `infra-monitor-frontend/src/app/features/equipamentos/ip-helper.spec.ts`; Modify `equipamento-list.component.spec.ts`

**Interfaces:**
- Produces: `motivoRecusaIp(valor: string | null | undefined): string | null` e `validadorIpv4Monitoravel: ValidatorFn` (erro `{ ipv4: string }`).

- [ ] **Step 1: Spec do helper (falha).**

```ts
import { FormControl } from '@angular/forms';
import { motivoRecusaIp, validadorIpv4Monitoravel } from './ip-helper';

describe('motivoRecusaIp', () => {
  it.each([null, undefined, '', '   ', '10.0.0.1', ' 10.0.0.1 ', '223.255.255.255', '127.0.0.1', '10.0.0.0'])(
    'aceita %p', (valor) => expect(motivoRecusaIp(valor)).toBeNull());

  it.each([
    ['2001:db8::1', 'Apenas IPv4 é suportado: o monitoramento ICMP não sonda IPv6'],
    ['servidor.local', 'IP deve ser um endereço IPv4 no formato 192.168.0.10'],
    ['256.0.0.1', 'Cada octeto do IP vai de 0 a 255'],
    ['010.0.0.1', 'Octeto com zero à esquerda é ambíguo (pode ser lido como octal): escreva 10.0.0.1, não 010.000.000.001'],
    ['0.0.0.0', 'A faixa 0.0.0.0/8 não é endereço de host'],
    ['255.255.255.255', 'Multicast, reservado ou broadcast (224.0.0.0 em diante) não é endereço de host monitorável'],
  ])('recusa %p', (valor, mensagem) => expect(motivoRecusaIp(valor)).toBe(mensagem));

  it('validator devolve o motivo em `ipv4`', () => {
    expect(validadorIpv4Monitoravel(new FormControl('::1'))).toEqual({ ipv4: 'Apenas IPv4 é suportado: o monitoramento ICMP não sonda IPv6' });
    expect(validadorIpv4Monitoravel(new FormControl('10.0.0.1'))).toBeNull();
  });
});
```

Se o runner (vitest via `@angular/build:unit-test`) não tiver `it.each`, use um laço `for` com `it` dentro.

- [ ] **Step 2: Confirmar a falha.** `npx ng test --watch=false --include=src/app/features/equipamentos/ip-helper.spec.ts`. Esperado: FAIL (exports inexistentes).

- [ ] **Step 3: Implementar no `ip-helper.ts`**, sem mudar `classificarIp`:

```ts
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Mesma regra de `RegraIpv4` (backend), da V20 e de `tools/carga-real`: só IPv4 de host,
 * sem zero à esquerda (o ping do Linux lê "010" como octal). Vazio = sem IP.
 */
export function motivoRecusaIp(valor: string | null | undefined): string | null {
  const ip = (valor ?? '').trim();
  if (!ip) return null;
  if (ip.includes(':')) return 'Apenas IPv4 é suportado: o monitoramento ICMP não sonda IPv6';
  if (!/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(ip)) return 'IP deve ser um endereço IPv4 no formato 192.168.0.10';
  const octetos = ip.split('.');
  if (octetos.some((octeto) => Number(octeto) > 255)) return 'Cada octeto do IP vai de 0 a 255';
  if (octetos.some((octeto) => octeto.length > 1 && octeto.startsWith('0'))) {
    return 'Octeto com zero à esquerda é ambíguo (pode ser lido como octal): escreva 10.0.0.1, não 010.000.000.001';
  }
  const primeiro = Number(octetos[0]);
  if (primeiro === 0) return 'A faixa 0.0.0.0/8 não é endereço de host';
  if (primeiro >= 224) return 'Multicast, reservado ou broadcast (224.0.0.0 em diante) não é endereço de host monitorável';
  return null;
}

export const validadorIpv4Monitoravel: ValidatorFn = (controle: AbstractControl): ValidationErrors | null => {
  const motivo = motivoRecusaIp(controle.value as string | null);
  return motivo ? { ipv4: motivo } : null;
};
```

Atualize o comentário do topo do arquivo: `classificarIp` continua informativo, e a validação agora é `validadorIpv4Monitoravel`.

- [ ] **Step 4: Form e template.** Controle: `ip: ['', [Validators.required, Validators.maxLength(45), validadorIpv4Monitoravel]],`. Template, logo depois da `<small class="equipamento-modal__dica">` da linha 237, ainda dentro do `<label>`:

```html
              @if (form.get('ip')?.touched && form.get('ip')?.errors) {
                <small class="campo-erro" id="equipamento-ip-erro" role="alert">{{ form.get('ip')?.errors?.['ipv4'] || form.get('ip')?.errors?.['backend'] || 'Revise este campo.' }}</small>
              }
```

No `<input formControlName="ip" ...>`, acrescente `[attr.aria-invalid]="form.get('ip')?.touched && form.get('ip')?.invalid ? 'true' : null"` e `[attr.aria-describedby]="form.get('ip')?.touched && form.get('ip')?.errors ? 'equipamento-ip-erro' : null"`. No laço da linha 262, tire `'ip'` da lista, porque o erro de IP agora aparece sob o campo e não pode sair duplicado. Confira no SCSS do componente se `.campo-erro` dentro do `<label>` herda um `display` que quebra o layout. Se quebrar, acrescente `display: block` só nesse contexto. Mantenha o estilo existente de `.campo-erro`, sem visual novo.

- [ ] **Step 5: Spec do form (falha antes do Step 4, verde depois).** Em `equipamento-list.component.spec.ts`, seguindo o padrão de criação já usado (abrir criação, preencher, salvar):
  1. Preencher IP `2001:db8::1` (mais campos obrigatórios válidos) e salvar: `api.create` **não** chamado; o DOM contém `#equipamento-ip-erro` com o texto IPv6; a lista de erros do rodapé não repete a mensagem.
  2. Edição de equipamento existente com `ip: '10.0.0.10'`: depois de carregar, `form.get('ip')?.valid === true` e salvar chama `api.update`.
  3. IP `' 10.0.0.1 '`: válido e o corpo enviado tem `ip: '10.0.0.1'`.

- [ ] **Step 6: Verde.** `npx ng test --watch=false`. Esperado: PASS.

- [ ] **Step 7: Commit.** `feat(equipamentos): valida IPv4 de host no formulario`

---

### Task 6: Script de carga com a mesma regra

**Files:**
- Modify: `tools/carga-real/lib/validacao.mjs:27-34, 118`
- Modify: `tools/carga-real/test/validacao.test.mjs:40-57`
- Modify: `tools/carga-real/README.md` (tabela de `equipamentos`, coluna `ip`)
- Modify: `Docs/validacao-producao/carga-real-procedimento.md:26`

**Interfaces:**
- Produces: `motivoRecusaIp(valor) → string | null` (mensagens **sem acento**, iguais às de `RegraIpv4`). `ipv4Valido` é removida.

- [ ] **Step 1: Testes (falham).** Troque o bloco `// --- ipv4Valido ---` por:

```js
// --- motivoRecusaIp (espelha RegraIpv4 do backend) ---

for (const valor of [null, undefined, '', '   ', '10.0.0.1', ' 10.0.0.1 ', '223.255.255.255', '127.0.0.1']) {
  test(`motivoRecusaIp: aceita ${JSON.stringify(valor)}`, () => {
    assert.equal(motivoRecusaIp(valor), null);
  });
}

for (const [valor, mensagem] of [
  ['2001:db8::1', 'apenas IPv4 e suportado: o monitoramento ICMP nao sonda IPv6'],
  ['servidor.local', 'deve ser um endereco IPv4 no formato 192.168.0.10'],
  ['999.1.1.1', 'cada octeto do IP vai de 0 a 255'],
  ['010.0.0.1', 'octeto com zero a esquerda e ambiguo (pode ser lido como octal): escreva 10.0.0.1, nao 010.000.000.001'],
  ['0.0.0.0', 'a faixa 0.0.0.0/8 nao e endereco de host'],
  ['224.0.0.1', 'multicast, reservado ou broadcast (224.0.0.0 em diante) nao e endereco de host monitoravel'],
]) {
  test(`motivoRecusaIp: recusa ${valor}`, () => {
    assert.equal(motivoRecusaIp(valor), mensagem);
  });
}

test('validarLinhaEquipamento: IP recusado vira erro com o motivo', () => {
  const { erros } = validarLinhaEquipamento({ unidadeSigla: 'EX-01', tipoNome: 'Switch', nome: 'SW', ip: '010.0.0.1' });
  assert.deepEqual(erros, ['ip: octeto com zero a esquerda e ambiguo (pode ser lido como octal): escreva 10.0.0.1, nao 010.000.000.001']);
});
```

Troque `ipv4Valido` por `motivoRecusaIp` no import. Confira em `carga.test.mjs` se algum teste fixa o texto antigo `'ip deve ser um endereco IPv4 valido (IPv6 nao e aceito)'` e atualize.

- [ ] **Step 2: Confirmar a falha.** `cd tools/carga-real && node --test test/`. Esperado: FAIL (export inexistente).

- [ ] **Step 3: Implementar.**

```js
/**
 * Espelha RegraIpv4 do backend (e a V20): so IPv4 de host, sem zero a esquerda
 * (o ping do Linux le "010" como octal). Nulo = aceito; vazio = sem IP.
 */
export function motivoRecusaIp(valor) {
  const ip = normalizarTexto(valor);
  if (ip === null) return null;
  if (ip.includes(':')) return 'apenas IPv4 e suportado: o monitoramento ICMP nao sonda IPv6';
  if (!/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(ip)) return 'deve ser um endereco IPv4 no formato 192.168.0.10';
  const octetos = ip.split('.');
  if (octetos.some((octeto) => Number(octeto) > 255)) return 'cada octeto do IP vai de 0 a 255';
  if (octetos.some((octeto) => octeto.length > 1 && octeto.startsWith('0'))) {
    return 'octeto com zero a esquerda e ambiguo (pode ser lido como octal): escreva 10.0.0.1, nao 010.000.000.001';
  }
  const primeiro = Number(octetos[0]);
  if (primeiro === 0) return 'a faixa 0.0.0.0/8 nao e endereco de host';
  if (primeiro >= 224) return 'multicast, reservado ou broadcast (224.0.0.0 em diante) nao e endereco de host monitoravel';
  return null;
}
```

Confira que `normalizarTexto` faz trim e devolve `null` para vazio, como o teste `' 10.0.0.1 '` exige. Em `validarLinhaEquipamento`:

```js
  const motivoIp = motivoRecusaIp(linha.ip);
  if (motivoIp !== null) erros.push(`ip: ${motivoIp}`);
```

Confirme lendo `carga.mjs` que linha com erro bloqueia antes de qualquer `POST`, inclusive com `--aplicar`, e cite a linha no relatório.

- [ ] **Step 4: Verde.** `node --test test/`. Esperado: PASS. Registre a contagem.

- [ ] **Step 5: Docs.** No README, na linha `ip` da tabela de equipamentos: "não | IPv4 de host: 4 octetos 0-255 sem zero à esquerda, 1º octeto 1-223; IPv6 recusado ("apenas IPv4 é suportado") | `192.0.2.10`". Em `carga-real-procedimento.md:26`, mesma regra em uma frase, mais a nota de que a V20 recusa o mesmo no banco.

- [ ] **Step 6: Commit.** `fix(carga-real): mesma regra de IPv4 de host da API`

---

### Task 7: Investigação — monitoramento parado (só leitura, sem código)

**Files:**
- Create: `Docs/validacao-producao/monitoramento-parado-investigacao.md`

Ler e citar com `arquivo:linha`:
- `monitoring/scheduler/MonitoringScheduler.java`, `monitoring/execution/MonitorExecutionCoordinator.java` (`isDue`, `scheduleDueMonitors`), executor de workers e `monitoring/config/*`;
- `dashboard/DashboardReadRepository.java` (`ESTADOS`: última medição sem idade, então o painel fica verde com o motor parado), `dashboard/OperationalStatusResolver.java`;
- disponibilidade/SLA (`grep -rn "DisponibilidadeSqlRepository"`): como o tempo sem medição entra no denominador e no numerador;
- `janela_monitoramento` (V13, `CicloJanelaMonitoramentoService`, `MonitoringClockConfiguration.java:7`): o que abre e fecha janela, e se reinício ou hibernação mexem nela;
- `IncidentProcessor` / `InicioDaObservacao`: o que acontece com um incidente aberto quando o motor volta depois de horas (a contagem de sucessos fecha na hora? a duração fica inflada?);
- Actuator/health (`application.yml`), notificação Telegram (o dispatcher roda no mesmo processo?).

Documento (pt-BR, mesmo tom dos vizinhos em `Docs/validacao-producao/`):
1. **Estado atual verificado**: o que se vê hoje quando (a) o processo cai, (b) a máquina hiberna ou suspende, (c) a máquina reinicia e o serviço sobe sozinho, (d) o banco cai mas o processo segue vivo, (e) o motor sobe com `MONITORING_ENGINE_ENABLED=false` por engano. Para cada um: painel, SLA, incidentes, Telegram.
2. **Opções**, cada uma com custo (código, schema, operação), impacto (escrita por ciclo, carga), o que detecta, o que **não** detecta, e o comportamento em hibernação e reinício:
   (a) heartbeat gravado a cada ciclo (tabela de uma linha, `UPDATE ... SET visto_em = now()`); (b) verificação na subida (última medição × intervalo esperado → registro de lacuna e notificação "monitoramento ficou parado de X a Y"); (c) idade da última medição no painel (status "desatualizado" quando `now() - executado_em > k × intervalo`; corrige o verde falso); (d) vigia externo ao processo (systemd timer/cron/healthcheck do Docker lendo heartbeat ou `/actuator/health` e alertando no Telegram por conta própria); (e) lacuna tratada no SLA (tempo sem observação fora do denominador, ou marcado). Inclua qualquer outra opção que a leitura revelar.
3. **Matriz** opção × cenário (detecta / não detecta / detecta tarde).
4. **Recomendação** combinada, em ordem de custo/benefício, e o que continua sem cobertura (ex.: ninguém vê alerta se o Telegram e o processo caem juntos).
5. Nenhum código, nenhuma migration, nenhum boot contra o dev.

- [ ] **Step 1:** Ler o código listado e anotar as citações.
- [ ] **Step 2:** Escrever o documento.
- [ ] **Step 3: Commit.** `docs(validacao-producao): investigacao de monitoramento parado`

---

### Task 8 (controlador): E2E Playwright no ambiente descartável

**Files:**
- Create: `infra-monitor-frontend/e2e/rodada-curta-seed.sql`, com a mesma guarda `app.banco_descartavel` e a mesma marca de limpeza de `pre-carga-seed.sql`
- Create: `infra-monitor-frontend/e2e/rodada-curta.cjs` (estrutura, armadilhas e helpers de `pre-carga-timeline-e-tela.cjs`)
- Modify: `infra-monitor-frontend/package.json` (`"e2e:rodada-curta": "node e2e/rodada-curta.cjs"`)
- Evidence: `infra-monitor-frontend/e2e/rodada-curta-evidence/`

Ambiente: container `infra-e2e` (porta 5437), restaurado de `pg_dump` do dev e marcado com `ALTER DATABASE inframonitor SET app.banco_descartavel = 'sim'`. Backend com `DB_PORT=5437`, `JWT_SECRET` de teste e motor/Telegram/dispatcher desligados. O Flyway aplica a V20 no descartável, o que também prova a migration sobre a cópia dos 222 equipamentos. `ng serve` em 4200. Contagem de controle no dev antes e depois (mesma consulta da rodada anterior).

Seed:
- incidente `RECUPERACAO_AUTOMATICA` com falhas e **sem** nenhuma medição de sucesso na janela;
- episódio com `motivo_encerramento = 'INCIDENTE'`;
- episódio com `motivo_encerramento = 'NORMALIZACAO'` e sequência completa (controle positivo).

Casos (só por clique; a API só para descobrir ids):
1. Gaveta do incidente AUTO sem sequência: detalhe do fechamento = texto sem número; nenhum `.timeline__item` com "recuperação k/N"; nenhum texto `/\d+ respostas? consecutivas?/`.
2. Gaveta do episódio INCIDENTE: rótulo "Encerrado pela abertura de incidente"; a página não contém "Latência normalizada".
3. Gaveta do episódio NORMALIZACAO completa: "2 medições consecutivas dentro do limiar encerraram o episódio" (controle positivo: o seletor enxerga o detalhe).
4. Formulário de novo equipamento, IP `2001:db8::1`: `#equipamento-ip-erro` com o texto IPv6; nenhuma requisição `POST /equipamentos` no log de rede.
5. Mesmo formulário com `010.0.0.1`: mensagem de zero à esquerda.
6. API direta: `POST /equipamentos` com IPv6 → 400, `fields.ip` = mensagem sem acento.
7. Regressão: `npm run e2e:pre-carga` continua 17/17 (com o seed dele).

Screenshots por caso; JSON de resultados gravado em `finally`.

---

### Task 9 (controlador): Suítes finais e documentação

- [ ] `./mvnw test`, `npx ng test --watch=false`, `node --test test/` (script), `npx ng build`: contagens exatas.
- [ ] Create `Docs/validacao-producao/rodada-curta-pre-carga.md`: os três itens, os achados que corrigiram a premissa do item 2 (a API já validava desde 2026-08-19; o que faltava: zero à esquerda, faixas, mensagem por campo, banco), as decisões do usuário, a contagem do dev (222 / 0), as evidências de reversão, o e2e, as suítes, as pendências.
- [ ] Modify `Docs/validacao-producao/correcoes-pre-carga-real.md`: na "Decisão registrada" do texto "N respostas consecutivas…", nota de que foi revertida em 2026-10-09, com link.
- [ ] Modify `CLAUDE.md` regra 14: acrescentar que a V20 voltou a validar no banco (CHECK de IPv4 de host, `VARCHAR(45)` mantido).
- [ ] Commit `docs(validacao-producao): rodada curta antes da carga real`.
- [ ] Reportar ao usuário antes de qualquer push.

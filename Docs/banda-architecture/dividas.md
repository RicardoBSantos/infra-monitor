# Teste de banda — lacunas, dívidas e contradições

Legenda em [banda-architecture.md](banda-architecture.md).

## ⛔ BLOQUEIO EXTERNO — o ASR do Defender impede o `iperf3.exe` de rodar

> **O binário publicado não roda onde precisa rodar. A liberação não depende de nós.**
>
> - **Regra:** ASR `01443614-CD74-433A-B99E-2ECDC07BFC25`, a que bloqueia executáveis "a menos que
>   atendam a um critério de prevalência, idade ou lista confiável", em modo de bloqueio **[P]**.
> - **Evidência:** eventos **1121** no log `Microsoft-Windows-Windows Defender/Operational` da
>   **SED-TI-D07**, em **2026-11-23 às 13:25:15 e 13:25:17** (UTC-03), usuário `SESC-SE\rbfilho`,
>   caminho do `iperf3.exe` da execução 45215529546 **[P]**. Um terceiro evento, em 2026-11-24 às
>   10:35:33, mostra que a regra **bloqueia até a leitura** do arquivo **[P]**.
> - **Entrega: Intune/MDE, não GPO** **[I, forte]**. A máquina está inscrita no Intune e cadastrada
>   no Microsoft Defender for Endpoint, e as chaves de ASR de GPO não existem **[P]**. Diagnóstico
>   completo em [contexto.md](contexto.md#controle-de-aplicativos-por-que-o-iperf3exe-não-roda-diagnóstico-de-2026-11-24).
> - **Dono:** o **administrador do Intune/MDE**. Não é o administrador das GPOs.
> - **Opção pedida:** **indicador "Permitir" por SHA-256** no MDE, para o `iperf3.exe` e a
>   `cygwin1.dll` da Release oficial ([build-iperf3.md § Builds](build-iperf3.md#builds)). A forma da
>   liberação é a **D17, pendente** ([decisoes.md](decisoes.md)).
> - **Pendente confirmar, com o administrador:**
>   1. que o indicador "Permitir" é respeitado **por esta regra** de ASR **[I]**;
>   2. que a mesma política vale para a **D05** e para os **servidores das unidades**. Roteiro somente
>      leitura em [contexto.md](contexto.md#roteiro-somente-leitura-para-a-d05-e-para-um-servidor-de-unidade).
> - **Consequências:**
>   - **a Parte A do [laboratório](laboratorio.md) fica bloqueada** até a liberação;
>   - a produção também: a D05 é o cliente e executa o mesmo binário (D9) **[I]**.
> - **Cada build nova pede liberação nova**, porque o build não é reproduzível. Daí a regra "não
>   recompilar sem motivo" em [build-iperf3.md](build-iperf3.md#builds).

## ⛔ BLOQUEIO DE PRODUÇÃO — espaço em disco

> **A janela desta feature não acontece antes de a frente de retenção e disco estar resolvida.**
>
> - **Implantar a V28 exige `Stage` e `Switch`. Reverter exige `Rollback`.** O ferramental recusa as
>   três operações com pouco espaço livre, **inclusive o rollback de emergência** **[P]**.
> - **Limiar no código [P], em `deployment/windows/ReleaseTools.psm1`:**
>   - `Test-FreeSpacePolicy`, **linha 21**: `if ($projected -lt 22GB) { throw 'Projected free space below 22 GiB; operation blocked' }`;
>   - `projected = livre − adicional − pico` (linha 20);
>   - pico operacional padrão `$OperationalPeakBytes=3GB` (**linha 206**);
>   - em `Stage`, o adicional é o tamanho do pacote mais 1 MB; nas outras operações, 1 MB
>     (**linhas 227-229**).
>   - O portão é avaliado **antes** de qualquer ação, em toda operação, `Rollback` incluído
>     (linha 229).
>   - **Na prática: recusa abaixo de ~25 GiB livres** (22 + 3 + pacote).
> - **Hoje: cerca de 26 GiB livres e caindo** **[E, informado pelo responsável em 2026-11-23]**. O
>   repositório ainda registra 34 GiB, um valor anterior ao inventário de 102 equipamentos
>   (`Docs/producao/estado-atual.md:85`, `pendencias.md:140`) **[E]**: o documento está defasado.
> - **Consequência [I]:**
>   - a ~1 GiB do portão, um `Stage` da V28 pode ser recusado;
>   - pior: um `Switch` aceito pode ser seguido de um `Rollback` **recusado** se o disco cair entre
>     as duas operações. O sistema ficaria na versão nova sem caminho de volta pelo ferramental.
>   - A coleta de medições consome cerca de 0,7 a 1 GiB por mês (`pendencias.md:147`) **[E]**.
> - **Condição para abrir a janela:** espaço livre medido com folga sobre ~25 GiB, somando a V28, o
>   pacote e um rollback. A frente de retenção e disco (`pendencias.md`) precisa ter entregue isso
>   antes.

## Rollback — leia antes da janela da V28

> **A V28 NÃO impede o rollback, mas ele NÃO é automático.**
>
> - O ferramental recusa a volta para o jar anterior, sobre um banco já na V28, a menos que a prova
>   traga **`databaseAheadOfRelease=true`** (`ReleaseTools.psm1:120`) **[P]**.
> - O `Rollback` também está sujeito ao **bloqueio de espaço** acima **[P]**.
> - O banco **fica** na V28: não existe migration de volta.
> - Ainda falta provar que o jar anterior sobe com a coluna nova `unidade.ponta_teste_banda_id`, e o
>   que ele devolve ao mover a ponta. É o item (h) do [laboratório](laboratorio.md) **[I]**.
> - **Sem essa prova, o rollback da V28 é uma aposta.**
>
> Detalhes em [v28-proposta.md § Rollback](v28-proposta.md#rollback-e-minschemaversion).

## Sinalizações da segunda rodada — resolvidas em 2026-11-23

| # | Sinalização | Resolução | Onde |
|---|---|---|---|
| S1 | Eco em voo antes de `iniciado_em`: `executado_em` é gravado **antes** do eco (`IcmpMonitorExecutor.java:38-40`) **[P]** | A borda esquerda passa a valer a partir de `iniciado_em` menos o `timeout_ms` do monitor avaliado: o predicado usa `iniciado_em <= :maisRecente + :timeoutMs`. Como RTT ≤ timeout, todo eco em voo fica coberto | D5 |
| S2 | O predicado compara intervalos, enquanto o texto falava em medições | O predicado de sobreposição é mantido. O texto da D5 foi reescrito, com o atraso de até um intervalo em monitores de intervalo longo | D5 |
| S3 | O teste podia passar de `janela_fim` | Prazo duro: `destroyForcibly` em `janela_fim − margem de fila`. `--server-max-duration` é a segunda barreira | D14 |
| S4 | O índice `(iniciado_em, janela_fim)` lia o índice inteiro | Índice invertido para `(janela_fim, iniciado_em)`. Medição: 2 buffers contra 141 | [v28-proposta.md](v28-proposta.md#índice-da-supressão--justificativa-e-medição) |

**Ainda a provar no laboratório:**
- S1 e S3: item (g), passo 6;
- margem de fila: item (g), passo 4.

---

## Contradições da primeira rodada — estado

| # | Contradição | Estado |
|---|---|---|
| C1 | D9: piso 3.19.1 e premissa dos CVEs em `iperf_auth.c` | **Resolvida:** D9 detalhada, 3.22.1 fixa, texto corrigido |
| C2 | D7 × D3: endpoints de ponta abertos ao OPERADOR | **Resolvida:** D7 detalhada; a ponta é cadastro, ADMIN e OPERADOR, por decisão |
| C3 | D5: intervalo por monitor travava o POST | **Resolvida:** D5 revista; a supressão passou a ser por medição. Novas bordas S1–S3 |
| C4 | D4: predicado em outra tabela, contra a MA01 | **Resolvida:** condição de implementação com teste de integração da ordem (D4) |

## Verificações sem contradição

- **V1:** a abertura é avaliada por nível. Com a D5 revista, um episódio real não se perde, só
  atrasa.
- **V2:** a inserção de incidente não é tocada.
- **V3:** `updated_at` é mantido por JPA e por `SET` explícito, sem trigger.
- **V4:** `solicitado_por_id` usa o mesmo molde de `criado_por_id`.
- **Item 1:** os dois timestamps da sequência estão em memória no insert. `:iniciadoEm` já é a
  medição mais antiga **[P]**.

---

## Dívida SEPARADA e PRIORITÁRIA — e2e apontam para a 8080 por padrão

- `infra-monitor-frontend/e2e/api-porta.cjs:6` faz `process.env.API_PORT || '8080'` **[P]**.
- A 8080 já rodou com **motor e Telegram de produção ligados** **[E, memória]**.
- **Risco [I]:** um e2e sem `API_PORT` escreve na instância que estiver na 8080. Isso pode **gerar
  mensagens no Telegram real** e, com a feature implementada, **disparar iperf3**.
- **Deve ser tratada antes desta feature.**
- **Proposta [I]:**
  - tornar `API_PORT` obrigatório, sem padrão; ou
  - usar uma porta reservada a e2e e checar, antes de qualquer escrita, que a instância está com o
    Telegram desligado.

## `MONITORING_LATENCIA_*` de produção ainda desconhecido

- O E7 leu só as variáveis `_ENABLED` **[E]**.
- `MONITORING_LATENCIA_CICLOS` e `MONITORING_LATENCIA_DEGRADADA_MS` de produção **não são
  conhecidos**.
- Com a D5 revista, a supressão não depende mais deles. Eles ainda definem:
  - o atraso na abertura de um episódio real depois da janela;
  - se um teste sozinho abriria episódio sem a supressão (`ciclos=1`) **[I]**.
- **Ação:** ler em janela, **somente leitura** (variáveis do serviço WinSW), e registrar em
  `Docs/producao/estado-atual.md`.

---

## Lacunas da investigação

| # | Lacuna | Onde se resolve |
|---|---|---|
| L1 | Não há marcação da ponta do teste | V28 (D3) |
| L2 | Não há supressão leve com expiração | V28 + `MonitorEpisodioLatenciaRepository` (D4, D5 revista) |
| L3 | Não há job assíncrono com limpeza de órfão | Implementação (D14) |
| L4 | Não há padrão para executável externo com lista de alvos | Implementação (D13) |
| L5 | Falta a chave `EXECUTANDO` no badge | Front (D11) |
| L6 | Não há componente de velocímetro | Front (D12) |
| L7 | Firewall: saída da D05 e entrada nas unidades não documentadas | Operação, fora do repositório |
| L8 | `MONITORING_LATENCIA_*` de produção desconhecido | Leitura em janela (acima) |
| L9 | O relatório de 30 dias inclui medições feitas durante o teste | D6, adiado para D-07 |
| L10 | Configuração do ARR não versionada | Fora do escopo; o polling contorna (D10) |
| L11 | O dev não tem SO, fabricante nem modelo; as 8 unidades de produção não foram consultadas | Ponta escolhida à mão (D3) |
| L12 | Servidor iperf3 nas unidades é serviço a instalar e operar fora do repositório | Runbook a escrever |

## Pendências de desenho

- **S1–S4:** resolvidas por decisão; S1 e S3 ainda dependem de prova no laboratório (g).
- **Margem de fila:** 10 s provisórios; o laboratório calibra no item (g), passo 4.
- **Retransmissões:** D16 fechada; colunas fora da V28 (run 45191296655).
- **`minSchemaVersion` 28:** é proposta. Com ela, o jar da V28 não sobe em banco V27, e o rollback
  segue o destaque do topo **[I]**.
- **Onde fica o artefato do iperf3:** numa release do repositório ou em outro lugar
  ([build-iperf3.md](build-iperf3.md)).

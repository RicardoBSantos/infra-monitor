# Teste de banda — lacunas, dívidas e contradições

Legenda em [banda-architecture.md](banda-architecture.md).

## Rollback — leia antes da janela da V28

> **A V28 NÃO impede o rollback, mas ele NÃO é automático.**
>
> - A volta para o jar anterior, sobre um banco já na V28, é recusada pela trava de release, a menos
>   que a prova traga **`databaseAheadOfRelease=true`** (`ReleaseTools.psm1:120`) **[P]**.
> - O banco **fica** na V28: não existe migration de volta.
> - Ainda falta provar que o jar anterior sobe com a coluna nova `unidade.ponta_teste_banda_id`, que
>   ele mapeia por tabela mas não por coluna. É o item (h) do [laboratório](laboratorio.md) **[I]**.
> - **Sem essa prova, o rollback da V28 é uma aposta.**
>
> Detalhes em [v28-proposta.md § Rollback](v28-proposta.md#rollback-e-minschemaversion).

## Sinalizações abertas

Aqui o código contraria, ou deixa uma lacuna em, uma decisão vigente. **Nenhuma foi ajustada sem o
responsável.**

### S1 — Borda esquerda: eco em voo antes de `iniciado_em` (D5 revista)

- `executado_em` é o instante **antes** de o eco sair (`IcmpMonitorExecutor.java:38-40`) **[P]**.
- Cenário: o eco sai em `iniciado_em − ε`, o tráfego do teste começa e a resposta chega inflada.
  - A medição fica com `executado_em < iniciado_em`, fora da janela, mas está contaminada **[I]**.
- **Na prática o risco é pequeno [I]:**
  - entre o commit da linha e o primeiro byte do iperf3 há o tempo de criar o processo e abrir a
    conexão de controle;
  - um eco normal, de dezenas de ms, volta antes disso.
- O risco existe quando o link **já** está lento.
- **Opções (DECISÃO DO RESPONSÁVEL):**
  - aceitar;
  - comparar com `tb.iniciado_em - make_interval(secs => <timeout máximo>)` no predicado;
  - gravar `janela_inicio` separado.
- Prova no item (g), passo 6, do laboratório.

### S2 — O predicado compara intervalos, não medições (D5 revista)

- **A decisão diz:** "não abre se **alguma das N medições** caiu dentro da janela".
- **O predicado pedido testa sobreposição** entre `[mais antiga, mais recente]` e
  `[iniciado_em, janela_fim]` **[P, texto da D5]**.
- Ele também segura a abertura quando o teste cabe **entre** duas medições sem que nenhuma caia
  dentro dele.
  - Exemplo: monitor de 300 s, teste de ~40 s entre duas medições.
  - Nesse caso o predicado é **mais conservador** que a frase da decisão **[I]**.
- **Custo [I]:** atraso de mais uma sequência na abertura de um episódio real. O caso típico é um
  monitor com intervalo maior que a janela. Não há falso positivo de contaminação.
- **Forma exata, se a decisão quiser a frase ao pé da letra [I]:**
  - os N timestamps já estão em memória (`medicoes`, [contexto.md § Item 1](contexto.md#item-1--timestamps-da-sequência-no-ponto-do-insert));
  - eles podem ser passados como array:
    ```sql
    NOT EXISTS (SELECT 1 FROM teste_banda tb, unnest(CAST(:instantes AS timestamptz[])) AS m(t)
                 WHERE m.t BETWEEN tb.iniciado_em AND tb.janela_fim)
    ```
  - Diante de S1, as duas formas se comportam igual: o eco em voo tem `executado_em` antes da
    janela nas duas.
  - **Recomendação: manter o predicado por intervalo.** Ele é mais simples, usa um único intervalo de
    índice e erra só para o lado conservador. A frase da D5 ficaria "a sequência avaliada sobrepõe a
    janela". **DECISÃO DO RESPONSÁVEL.**

### S3 — Borda direita: teste que passa de `janela_fim` (D5 revista)

- `janela_fim` é gravado **no disparo** como estimativa: `2 × duração + 10 s`.
- O teste real tem mais etapas:
  - criação de dois processos;
  - duas conexões de controle;
  - a troca de resultados no fim de cada sentido;
  - eventuais tentativas de conexão.
- Se o tráfego continuar depois de `janela_fim`, as medições desse trecho **não** são suprimidas
  **[I]**.
- **Condição de implementação proposta [I]:** `janela_fim` vira **prazo duro** do executor.
  - O processo iperf3 é morto (`destroyForcibly`) em `janela_fim − margem de fila`.
  - O teste é gravado como `FALHA` com o valor parcial.
  - Isso transforma a estimativa em garantia, sem mudar o modelo.
- Prova no item (g), passo 6, do laboratório.

### S4 — Índice `(iniciado_em, janela_fim)` percorre o índice inteiro (V28)

- **Medido [P-lab, 2026-11-23]:**
  - 141 buffers com a ordem pedida, contra 2 com `(janela_fim, iniciado_em)`;
  - 36.501 linhas, caso comum: nenhum teste sobreposto.
- A coluna líder `iniciado_em <= :maisRecente` casa com quase todo o histórico.
- **Recomendação:** `(janela_fim, iniciado_em)`.
- O SQL da [v28-proposta.md](v28-proposta.md#índice-da-supressão--justificativa-e-sinalização)
  mantém a ordem pedida até a decisão.

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

- **S1–S4** (acima).
- **Margem de fila:** 10 s provisórios; o laboratório calibra no item (g), passo 4.
- **Retransmissões:** decisão condicional D16, que depende do item (e) do laboratório.
- **`minSchemaVersion` 28:** é proposta. Com ela, o jar da V28 não sobe em banco V27, e o rollback
  segue o destaque do topo **[I]**.
- **Onde fica o artefato do iperf3:** numa release do repositório ou em outro lugar
  ([build-iperf3.md](build-iperf3.md)).

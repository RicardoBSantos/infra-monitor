# Teste de banda — lacunas, dívidas e contradições

Legenda em [banda-architecture.md](banda-architecture.md).

## Contradições entre a verificação e as decisões

Nenhuma decisão foi alterada. Cada item precisa de uma resposta do responsável **antes da
implementação**.

### C1 — D9: piso de versão e premissa dos CVEs

- **A decisão diz:** tag ≥ 3.19.1, e compilar sem OpenSSL "remove `iperf_auth.c`, onde estavam os
  CVEs".
- **A verificação mostra [P]:**
  - A 3.22 corrige um **use-after-free remoto em `iperf_server_api.c`**, no código do servidor. Também
    corrige um DoS por laço infinito (CVE-2026-102253) e um problema de parâmetros de teste
    (CVE-2026-71217). Nenhum dos três está em `iperf_auth.c`.
  - Qualquer tag entre 3.19.1 e 3.21 sem OpenSSL continua vulnerável no papel de servidor, que é o
    papel da unidade.
  - O `iperf_auth.c` não é removido. Ele é compilado com o corpo sob `#if defined(HAVE_SSL)`.
- **Proposta:** subir o piso para **3.22**, recomendando **3.22.1** ([build-iperf3.md](build-iperf3.md)).

### C2 — D7 × D3: endpoints da ponta ficam abertos ao OPERADOR

- **A decisão diz:** somente ADMIN.
- **A verificação mostra [P]:**
  - `PUT` e `DELETE /api/v1/unidades/**` são **ADMIN+OPERADOR** (`SecurityConfiguration.java:15,17`).
  - Os endpoints `/unidades/{id}/ponta-banda` herdam essa regra.
  - Só o `POST /api/v1/testes-banda` fica restrito ao ADMIN, pela regra geral da linha 18.
- **Por que importa [I]:** trocar a ponta muda **para onde** o iperf3 manda tráfego. A lista de
  alvos em CIDR (D13) limita o dano, mas não o elimina.
- **A decidir:**
  - **(a)** D7 vale também para a ponta: um matcher explícito
    `/api/v1/unidades/*/ponta-banda` → `ADMIN` **antes** da linha 15; ou
  - **(b)** a ponta é cadastro, e o OPERADOR pode alterá-la.
- **Observação:** em qualquer caso, a rota do teste **não pode** ficar sob `/unidades/**`. Do
  contrário ela herdaria ADMIN+OPERADOR **[P]**.

### C3 — D5: o intervalo é por monitor e pode travar o botão

- **A decisão diz:** fatores "lidos da configuração".
- **A verificação mostra [P]:**
  - `latencia-ciclos` é configuração.
  - O intervalo **não** é: é `monitor.intervalo_segundos`, por monitor, com
    `CHECK BETWEEN 10 AND 86400` (V5).
- **Consequência [I]:**
  - Com `ciclos = 2` e 30 s de tráfego, **basta um monitor ativo com intervalo acima de cerca de
    135 s**, em qualquer unidade, para que `suprimir_ate` passe de 5 min.
  - Nesse caso **todo** POST é recusado com 409, para sempre, enquanto esse monitor existir.
  - Produção tem 60 s **[E]**, mas nada no cadastro impede um monitor de 5 min.
- **A decidir:**
  - aceitar, com a mensagem do 409 nomeando o monitor que estoura; ou
  - restringir o `max` a um subconjunto de monitores; ou
  - limitar o intervalo no cadastro.
  - Não ajustar sem decisão.

### C4 — D4: predicado em outra tabela, contra o que a MA01 descartou

- **O que a MA01 diz:** descartou predicados que dependem de outra tabela que o `FOR UPDATE OF e` não
  trava **[P, `manutencao-agendada-decisoes.md`]**.
- **Para D4, a corrida é benigna [I]**, desde que a linha `teste_banda` seja commitada **antes** de
  o tráfego começar ([contexto.md § V2](contexto.md#v2--d4-não-toca-a-inserção-de-incidente)).
- **Não é contradição de fato.** É uma condição de implementação que precisa constar no PR e no teste
  de integração.

### Sem contradição

- **V1:** a abertura é avaliada por nível, então nenhum episódio real se perde. O risco é só de atraso
  e de cauda contaminada, que o laboratório mede.
- **V2:** a inserção de incidente não é tocada.
- **V3:** `updated_at` é mantido por JPA e por `SET` explícito, sem trigger.
- **V4:** `solicitado_por_id` usa o mesmo molde de `criado_por_id`.

---

## Dívida SEPARADA e PRIORITÁRIA — e2e apontam para a 8080 por padrão

- `infra-monitor-frontend/e2e/api-porta.cjs:6` faz `process.env.API_PORT || '8080'` **[P]**.
- A 8080 já rodou a stack da carga com **motor e Telegram de produção ligados**. A memória registra
  um período em que a 8080 mandava Telegram de produção **[E, memória]**.
- **Risco:** rodar e2e sem `API_PORT` escreve na instância que estiver na 8080: cria e fecha
  incidente, inicia manutenção, dispara teste de envio. Isso pode **gerar mensagens no Telegram real**
  **[I]**. Com o teste de banda implementado, poderia também **disparar iperf3**, se a flag e a lista
  de alvos estiverem ligadas nessa instância **[I]**.
- **Independe desta feature e deve ser tratada antes dela.** Proposta **[I]**:
  - `API_PORT` obrigatório, sem padrão; ou
  - padrão numa porta reservada a e2e, com uma checagem de que a instância alvo está com
    `TELEGRAM_ENABLED=false` antes de qualquer escrita.

## `MONITORING_LATENCIA_*` de produção ainda desconhecido

- O E7 leu só as variáveis `_ENABLED` **[E]**.
- `MONITORING_LATENCIA_CICLOS` e `MONITORING_LATENCIA_DEGRADADA_MS` de produção **não são
  conhecidos**. Se `ciclos = 1`, um teste de banda sozinho abre episódio na primeira medição; D4/D5
  passam a ser indispensáveis, e não só prudentes **[I]**.
- **Ação:** ler em janela, **somente leitura** (variáveis do serviço WinSW, sem alterar nada), e
  registrar em `Docs/producao/estado-atual.md`.

---

## Lacunas da investigação

| # | Lacuna | Onde se resolve |
|---|---|---|
| L1 | Não há marcação da ponta do teste | V28 (D3) |
| L2 | Não há supressão leve com expiração | V28 + `MonitorEpisodioLatenciaRepository` (D4) |
| L3 | Não há job assíncrono com limpeza de órfão | Implementação (D14) |
| L4 | Não há padrão para executável externo com lista de alvos | Implementação (D13) |
| L5 | Falta a chave `EXECUTANDO` no badge | Front (D11) |
| L6 | Não há componente de velocímetro | Front (D12) |
| L7 | Firewall: saída da D05 e entrada nas unidades não documentadas | Operação, fora do repo |
| L8 | `MONITORING_LATENCIA_*` de produção desconhecido | Leitura em janela (acima) |
| L9 | O relatório de 30 dias inclui as medições feitas durante o teste | D6, adiado para D-07 |
| L10 | A configuração do ARR não está versionada | Fora do escopo; o polling contorna (D10) |
| L11 | O dev não tem SO, fabricante nem modelo; as 8 unidades de produção não foram consultadas | A ponta é escolhida à mão (D3) |
| L12 | O servidor iperf3 nas unidades é serviço a instalar e operar fora deste repositório | Runbook de operação, a escrever |

## Pendências de desenho (sem decisão ainda)

- **Ponta desativada.** `ativo = false` não dispara a FK. É preciso decidir se a referência é
  limpa ou se o POST é recusado com 409 **[I]**.
- **Referência do cooldown.** Contar do início ou de `concluido_em` do teste anterior? Com 120 s a
  partir do início, o próximo teste pode começar dentro da supressão do anterior, que dura até
  ~150 s. Isso não quebra nada (o predicado é `EXISTS`), mas encadeia supressões globais. **Sugestão
  [I]:** contar de `concluido_em`.
- **Retransmissões no Cygwin.** Se o laboratório mostrar que o Cygwin não expõe `TCP_INFO`, as duas
  colunas ficam sempre nulas. Nesse caso, avaliar se continuam na V28 **[I]**.
- **`minSchemaVersion` 28.** É proposta. Exige aceitar que um jar da V28 não sobe em banco V27
  ([v28-proposta.md](v28-proposta.md)) **[I]**.
- **Tag 3.22 ou 3.22.1** ([build-iperf3.md](build-iperf3.md)).
- **Onde fica o artefato:** release do repositório ou outro lugar ([build-iperf3.md](build-iperf3.md)).

# Teste de banda — log de decisões

Todas fechadas pelo responsável em **2026-11-23**. Estado: **decididas, não implementadas.**
Cada entrada traz o que foi decidido, por quê, e o que foi descartado quando houve alternativa.
As marcas de origem seguem a legenda de [banda-architecture.md](banda-architecture.md).

Quando a verificação no código contraria uma decisão, isso está em
[dividas.md § Contradições](dividas.md#contradições-entre-a-verificação-e-as-decisões). Nenhuma
decisão foi alterada neste documento por causa disso.

---

## D1 — Link medido: unidade↔sede

O teste mede o link MPLS/WAN entre a sede e a unidade. A **SED-TI-D05** é o cliente iperf3. Em cada
unidade, **um Windows Server** é o servidor iperf3. Ele é marcado explicitamente como ponta (D3) e
não é necessariamente o AD.

**Motivo:**
- A D05 já é o ponto de onde o motor ICMP mede tudo **[E]**, então o teste reflete o mesmo caminho
  que gera os alertas **[I]**.
- O cadastro não tem como identificar o servidor da unidade. O tipo "Servidor" agrupa de 1 a 4
  equipamentos por unidade no dev, e na carga há um firewall cadastrado com esse tipo **[P-lab]**.
  Por isso a ponta é escolhida à mão (D3) **[I]**.

## D2 — Disparo somente manual; um clique = download + upload

- Só pelo botão "Testar". Não há agendamento nem disparo automático.
- Um clique faz dois sentidos, em sequência:
  - **download** = sede→unidade, modo normal do iperf3 (a D05 envia);
  - **upload** = unidade→sede, com `-R` (o servidor da unidade envia).
- O valor de cada sentido é lido **do lado receptor** (`end.sum_received`).
- Sem ping dentro do teste.

**Motivo:**
- Um teste automático saturaria a WAN sem ninguém olhando **[I]**.
- O lado receptor mede o que de fato atravessou o link. O lado emissor conta o que entrou no buffer
  local, o que superestima em links com perda **[I]**.
- A latência já é medida pelo motor ICMP. Um ping dentro do teste duplicaria a medição e geraria
  tráfego extra **[I]**.

## D3 — Ponta do teste é referência em `unidade`

- Coluna `unidade.ponta_teste_banda_id`.
- FK composta `(ponta_teste_banda_id, id) → equipamento(id, unidade_id)`, com
  `ON DELETE SET NULL (ponta_teste_banda_id)`. Essa sintaxe com lista de colunas exige PostgreSQL 15
  ou superior. Produção roda 16.15 **[E, `D02.10-B-infraestrutura-windows.md:87`]**.
- Endpoints próprios: `PUT /api/v1/unidades/{id}/ponta-banda {equipamentoId}` e
  `DELETE /api/v1/unidades/{id}/ponta-banda`.
- O `PUT /unidades/{id}` **nunca** toca a ponta.
- Mover o equipamento-ponta para outra unidade é recusado com **409** e mensagem clara.

**Motivo:**
- A FK composta garante no próprio banco que a ponta pertence à unidade. Uma coluna só já impõe
  "uma ponta por unidade" sem índice extra **[I]**.
- A V18 já recusou um booleano "principal" e adotou uma FK para o hub **[P]**.
- O endpoint próprio segue o molde do endpoint de conexão da unidade **[E]**. Ele também evita a
  dívida "PUT não distingue ausente de limpar" **[E, memória]**.
- Ao mover o equipamento, o update de `equipamento.unidade_id` viola a FK, que é `NO ACTION` por
  omissão. O serviço traduz o erro em 409 **[I]**.
- `SET NULL` só na coluna da ponta. Sem a lista de colunas, o `SET NULL` tentaria anular também
  `unidade.id` **[I]**.

**Descartado:**
- **Flag no equipamento:** exigiria índice parcial e acompanharia o equipamento se ele mudasse de
  unidade. Hoje `UpdateEquipamentoRequest` permite trocar `unidadeId` **[E, investigação]**.
- **Escolha automática pelo tipo "Servidor":** ver D1.

## D4 — Supressão só da abertura de episódio de latência, escopo global

- Durante o teste, **só a abertura de episódio de latência** é suprimida.
- A abertura de incidente **não muda**.
- O predicado é de tempo: `EXISTS (SELECT 1 FROM teste_banda WHERE now() < suprimir_ate)`.
- Não há estado a desfazer, nem Telegram. Ping e SLA ficam intactos.
- **Escopo GLOBAL (todas as unidades) — DECISÃO ASSUMIDA.** Não foi provada em laboratório. A
  alternativa, só a unidade testada, foi deixada de lado conscientemente.

**Motivo:**
- A D05 está na sede. Saturar o uplink da sede pode elevar a latência medida de **todas** as
  unidades, e não só da unidade testada **[I]**. A prova está no [laboratório](laboratorio.md).
- O predicado de tempo expira sozinho, inclusive com o serviço fora do ar. Passado `suprimir_ate`,
  ele deixa de valer sem que ninguém precise agir **[I]**.
- Incidente exige `falhas_para_incidente` falhas seguidas (10 em produção **[E]**). Um teste de até
  30 s não chega lá, então não há o que suprimir **[I]**.
- Os efeitos colaterais da manutenção não servem aqui: ela para o ping, fecha o SLA e envia Telegram
  **[P, contexto.md § Manutenção]**.

**Descartado:**
- **Reusar a manutenção agendada:** ver contexto.md.
- **Flag booleana ligada e desligada:** se o serviço caísse no meio, o flag ficaria ligado **[I]**.

**Condição de implementação [I]:** a linha `teste_banda` tem de estar **commitada antes** de o
iperf3 começar. Ver [contexto.md § V2](contexto.md#v2--d4-não-toca-a-inserção-de-incidente).

## D5 — Cálculo de `suprimir_ate` e teto de 5 min

```
suprimir_ate = início
             + duração total (soma dos dois sentidos)
             + monitoring.latencia-ciclos × max(monitor.intervalo_segundos dos monitores ativos)
```

- Os fatores vêm da configuração e do banco no momento do POST. Nunca `2` fixo.
- Se `suprimir_ate − início` passar de **5 min**, o POST é recusado com **409**.

**Motivo:**
- Depois do fim do tráfego, uma medição contaminada pelo teste ainda pode estar na cauda de
  `latencia-ciclos` medições que o processador avalia. A margem `ciclos × maior intervalo` cobre essa
  cauda **[I]**. A dedução está em [contexto.md § V1](contexto.md#v1--abertura-de-episódio-é-avaliada-por-nível).
- O teto de 5 min impede uma supressão global longa demais **[I]**.

**Atenção:** `intervalo_segundos` é coluna por monitor (`CHECK BETWEEN 10 AND 86400`, V5) **[P]**,
não configuração. Ver [dividas.md](dividas.md#contradições-entre-a-verificação-e-as-decisões),
item C3.

## D6 — Relatórios não excluem medições do teste neste ciclo

- As medições ICMP tomadas durante o teste **continuam** no relatório de latência, no PDF e na
  exportação.
- A exclusão fica para o **agregado por hora (D-07)** e será aplicada na construção do agregado.

**Impacto registrado:**
- Cada teste contamina **no máximo 1 amostra por monitor**: o tráfego dura até 30 s e o intervalo é
  de 60 s **[I]**.
- O relatório de 30 dias filtra só `status='SUCESSO' AND latencia_ms IS NOT NULL` + período + tipo
  ICMP (`RelatorioService.java:80`) **[P]**.

**Motivo:** fazer um anti-join contra `teste_banda` na consulta atual pesaria numa consulta já
sensível a desempenho **[E, memórias de latência]**. A D-07 vai reconstruir essa consulta de
qualquer forma **[E]**.

## D7 — Somente ADMIN

**Motivo:** o teste satura a WAN de produção. Hoje a única ação comparável restrita ao ADMIN é o
teste de envio do Telegram, que cai na regra geral `/api/**` **[P, `SecurityConfiguration.java:18`]**.

**Atenção:** os endpoints de ponta de D3 ficam sob `/api/v1/unidades/**`, que hoje é
ADMIN+OPERADOR. Ver dividas.md, item C2.

## D8 — O que acontece com o histórico quando cadastros são excluídos

- **Excluir a unidade apaga o histórico:** `teste_banda.unidade_id ... ON DELETE CASCADE`.
- **Excluir o equipamento preserva o histórico:**
  - `equipamento_id` é anulável, com `ON DELETE SET NULL`;
  - `equipamento_nome` e `ip_alvo` ficam gravados como retrato do momento do teste.

**Motivo:**
- Sem a unidade, o histórico não tem contexto para ser exibido **[I]**.
- A ponta de uma unidade pode ser trocada, e o teste antigo continua valendo para o link **[I]**.

**Nota [I]:** na prática, a exclusão da unidade continua barrada pelas outras dependências, como
equipamentos e `manutencao_agendada`, que são `RESTRICT` **[P, V21]**. O CASCADE só age quando
nada mais segura a unidade.

## D9 — Binário compilado no nosso CI, sem OpenSSL

- Compilado a partir do fonte oficial (`esnet/iperf`), com tag fixa e commit fixo.
- `--without-openssl`.
- SHA-256 do artefato registrado.
- Proteção de acesso:
  - firewall de entrada no servidor da unidade, aceitando só o IP da D05;
  - lista de alvos permitidos no backend (D13).

**Motivo:**
- O projeto oficial não publica build para Windows. Windows nem está entre as plataformas suportadas
  (`README.md:29-32`) **[P]**.
- Binário de terceiros sem procedência verificável não entra em servidor de produção **[I]**.
- Sem OpenSSL, todo o código de autenticação RSA fica fora da compilação: o corpo de `iperf_auth.c`
  está sob `#if defined(HAVE_SSL)` **[P]**.

**Atenção:** a premissa de que "os CVEs estavam em iperf_auth.c" é só **parcialmente** verdadeira,
e a versão mínima precisa subir para **3.22**. Ver dividas.md, item C1, e
[build-iperf3.md](build-iperf3.md).

## D10 — Tempo real por polling de 1 s

- O front chama `GET /api/v1/testes-banda/{id}?desde=<seq>` a cada 1 s.
- Durante a execução, as amostras ficam **em memória**.
- No fim do teste, são gravadas em `teste_banda.amostras` (JSONB).

**Motivo:**
- SSE atrás do IIS/ARR exigiria mexer em buffering e compressão no servidor, numa configuração que
  não está versionada **[P/E, contexto.md § IIS]**.
- O polling usa o caminho HTTP já homologado **[I]**.
- Se o serviço reiniciar, as amostras em memória se perdem. Isso já é coberto por D14
  (`INTERROMPIDO_REINICIO`) **[I]**.

**Descartado:** SSE e WebSocket.

## D11 — Status: SUCESSO, FALHA e nova chave EXECUTANDO

- `SUCESSO` e `FALHA` já existem no `StatusBadgeComponent` **[P]**.
- Entra uma chave nova: `EXECUTANDO`, rótulo "Em execução", tom `info`.

**Motivo:** nenhuma chave existente tem o sentido certo. `ENVIANDO` é "Em envio" e `ATIVA` é
"Ativa" **[P]**.

## D12 — Velocímetro

- Escala configurável: `BANDA_ESCALA_MAX_MBPS=1000`.
- Escala não linear.
- Desenhado em SVG próprio.
- Sem "% do contratado".

**Motivo:**
- O projeto não usa biblioteca de gráfico: o drawer de equipamento já desenha em SVG próprio
  **[E, investigação]**.
- Banda contratada não está no cadastro, e mostrar um percentual sem esse dado induziria a erro
  **[I]**.

## D13 — Proteção em dev e configuração

| Variável | Padrão | Comportamento |
|---|---|---|
| `BANDA_TESTE_ENABLED` | `false` | Desligada, o POST responde 409. Coberta pelo `ConfiguracaoPadraoDesligadaTest`. |
| `BANDA_TESTE_ALVOS_PERMITIDOS` | vazia | CIDR. Vazia recusa tudo. |
| `BANDA_TESTE_EXECUTAVEL` | — | Caminho absoluto. Validado no boot **só com a flag ligada**. |

- Nos testes automatizados, o runner é falso.
- O ensaio real usa a tag `banda-lab`, fora da suíte padrão, no mesmo idioma de `rede-real`.

**Motivo:**
- O padrão "desligado sem variável" é obrigatório no projeto (CLAUDE.md) **[P]**.
- Os IPs do dev e da carga colidem com a rede real: 10.79.10.6 é o AD real **[P-lab + E]**.
- O serviço roda sob WinSW sem `PATH` próprio, então o executável precisa de caminho absoluto
  **[P, `winsw.xml.template`]**.

## D14 — Limites de execução e recuperação

- `-t` de no máximo **15 s por sentido**.
- **Cooldown global** de no mínimo **120 s**.
- **Um teste por vez** no sistema inteiro.
- `destroyForcibly` no shutdown.
- **Limpeza de órfão no BOOT:** `EXECUTANDO` → `FALHA`, com `erro = INTERROMPIDO_REINICIO`.
- **Limpeza de órfão também no POST:** `UPDATE` condicional de `EXECUTANDO` mais antigo que a
  duração máxima + margem.
- **Nunca** reexecutar automaticamente.

**Motivo:**
- A D05 é o único cliente. Dois testes simultâneos se distorcem **[I]**.
- O índice único parcial de "um `EXECUTANDO`" travaria o sistema para sempre se um órfão
  sobrevivesse **[I]**.
- A limpeza no POST cobre o órfão que não passou por um reboot: thread morta, exceção não tratada
  **[I]**.
- Parar o serviço não mata o processo filho **[E, memória]**.

**Pendente:** de quando conta o cooldown, do início ou de `concluido_em` do teste anterior. Ver
dividas.md.

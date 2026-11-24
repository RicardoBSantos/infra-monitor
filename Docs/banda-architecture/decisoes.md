# Teste de banda — log de decisões

Todas foram fechadas pelo responsável em **2026-11-23**. Estado: **decididas, não implementadas.**

- Cada entrada diz o que foi decidido, por quê, e o que foi descartado.
- Uma decisão revista mantém o texto antigo ~~riscado~~, com o motivo da revisão.
- As marcas de origem seguem a legenda de [banda-architecture.md](banda-architecture.md).

**Revisão de 2026-11-23 (ajuste do PR #48):**
- D4 e D5 mudaram de predicado. Ver C3 em [dividas.md](dividas.md).
- D7, D9 e D14 foram detalhadas.
- D15 e D16 são novas. A D16 foi fechada depois, no PR #49.

**2026-11-24:** entra a **D17, PENDENTE** (forma de liberar o binário no ASR). Não altera nenhuma
decisão anterior.

Quando a verificação no código contraria uma decisão, o ponto fica em
[dividas.md § Sinalizações](dividas.md#sinalizações-da-segunda-rodada--resolvidas-em-2026-11-23). Nenhuma decisão foi alterada sem o
responsável.

---

## D1 — Link medido: unidade↔sede

O teste mede o link MPLS/WAN entre a sede e uma unidade.

- **Cliente iperf3:** a **SED-TI-D05**.
- **Servidor iperf3:** **um Windows Server** em cada unidade, marcado explicitamente como ponta
  (D3). Não é necessariamente o AD.

**Motivo:**
- A D05 já é o ponto de onde o motor ICMP mede tudo **[E]**. Assim o teste reflete o mesmo caminho
  que gera os alertas **[I]**.
- O cadastro não identifica o servidor da unidade:
  - no dev, o tipo "Servidor" agrupa de 1 a 4 equipamentos por unidade **[P-lab]**;
  - na carga, há um firewall cadastrado com esse tipo **[P-lab]**.

## D2 — Disparo somente manual; um clique = download + upload

- O teste só dispara pelo botão "Testar".
- Um clique roda os dois sentidos, em sequência:
  - **download**: sede→unidade, no modo normal do iperf3 (a D05 envia);
  - **upload**: unidade→sede, com `-R` (o servidor da unidade envia).
- O valor de cada sentido é lido **no lado receptor** (`end.sum_received`).
- Não há ping dentro do teste.

**Motivo:**
- Um teste automático saturaria a WAN sem ninguém olhando **[I]**.
- O lado receptor mede o que de fato atravessou o link. O lado emissor conta o que entrou no buffer
  local **[I]**.
- A latência já é medida pelo motor ICMP **[I]**.

## D3 — Ponta do teste é referência em `unidade`

- **Coluna:** `unidade.ponta_teste_banda_id`.
- **FK composta:** `(ponta_teste_banda_id, id) → equipamento(id, unidade_id)`, com
  `ON DELETE SET NULL (ponta_teste_banda_id)`.
  - Essa sintaxe exige PostgreSQL 15 ou superior. Produção roda 16.15
    **[E, `D02.10-B-infraestrutura-windows.md:87`]**.
- **Endpoints próprios:**
  - `PUT /api/v1/unidades/{id}/ponta-banda {equipamentoId}`;
  - `DELETE /api/v1/unidades/{id}/ponta-banda`.
- O `PUT /unidades/{id}` **nunca** toca a ponta.
- Mover o equipamento-ponta para outra unidade é recusado com **409** e mensagem clara.

**Motivo:**
- A FK composta garante, no banco, que a ponta pertence à própria unidade.
- Uma coluna só já impõe uma ponta por unidade **[I]**.
- Há precedente: a V18 também usou uma FK em vez de booleano **[P]**.
- O endpoint próprio evita a dívida "PUT não distingue ausente de limpar" **[E, memória]**.
- Mover o equipamento viola a FK, que é `NO ACTION` por omissão, e o serviço traduz o erro em 409
  **[I]**.

**Descartado:**
- **Flag no equipamento:** exige índice parcial e acompanharia o equipamento quando ele trocasse de
  unidade **[E]**.
- **Escolha automática pelo tipo do equipamento:** ver D1.

## D4 — Supressão só da abertura de episódio de latência, escopo global

Durante o teste, **só a abertura de episódio de latência** é suprimida.

- A abertura de incidente **não muda**.
- Não há estado a desfazer nem mensagem de Telegram.
- Ping e SLA ficam intactos.
- **Escopo GLOBAL, todas as unidades.** É uma **DECISÃO ASSUMIDA** e não foi provada.
  - A alternativa, suprimir só a unidade testada, foi deixada de lado conscientemente.
- O predicado ficou definido na D5 revista.
  - ~~Predicado de tempo: `EXISTS (SELECT 1 FROM teste_banda WHERE now() < suprimir_ate)`.~~
  - Esse predicado foi substituído em 2026-11-23 pelo predicado por medição da D5 revista.

**Motivo:**
- A D05 está na sede. Saturar o uplink da sede pode elevar a latência de **todas** as unidades **[I]**.
- Incidente exige `falhas_para_incidente` falhas seguidas, 10 em produção **[E]**. Um teste de cerca
  de 40 s não chega lá **[I]**.
- A manutenção não serve: ela para o ping, fecha o SLA e manda Telegram
  **[P, contexto.md § Manutenção]**.

**Descartado:**
- **Reusar a manutenção agendada:** ver contexto.md.
- **Flag booleana ligada e desligada:** ficaria ligada se o serviço caísse no meio do teste **[I]**.

**Condição de implementação: a linha é commitada antes do iperf3 (C4, item 6 do ajuste)**
- A linha `teste_banda` precisa estar **commitada antes** de o processo iperf3 iniciar.
- Um teste de integração tem de **provar a ordem**: o runner falso registra o instante em que foi
  chamado, e o teste confere que, nesse instante, outra conexão já enxerga a linha.
- Motivo: a corrida contra outra tabela que o `FOR UPDATE OF e` não trava é benigna só nessa
  ordem. Ver [contexto.md § V2](contexto.md#v2--d4-não-toca-a-inserção-de-incidente).

## D5 — Janela do teste e supressão por medição (REVISTA em 2026-11-23)

**Texto original, substituído:**

> ~~`suprimir_ate = início + duração total + latencia-ciclos × max(monitor.intervalo_segundos dos
> monitores ativos)`, lidos da configuração (nunca "2" fixo). Se passar de 5 min → POST recusado com
> 409.~~

**Motivo da revisão: C3.**
- `intervalo_segundos` é coluna **por monitor**, com `CHECK BETWEEN 10 AND 86400` (V5) **[P]**.
- Bastava um monitor ativo acima de cerca de 135 s para que todo POST recebesse 409, para sempre.
- A janela dependia de configuração de terceiros e não do próprio teste.

**Decisão vigente:**

1. **A supressão é por sobreposição. Texto final, ajuste S2 de 2026-11-23:** **"o episódio não abre
   se o intervalo coberto pela sequência avaliada sobrepõe a janela de um teste."**
   - ~~O episódio não abre se alguma das N medições da sequência avaliada caiu dentro da janela de um
     teste.~~ Foi trocado porque o predicado testa sobreposição de intervalos, não medição a medição.
   - **Atraso possível:** o predicado também segura a abertura quando o teste cai **entre** duas
     medições da sequência. Num monitor de intervalo longo, por exemplo 300 s com um teste de ~40 s
     entre duas medições, um episódio real pode abrir **um intervalo depois** do que abriria sem o
     teste. O erro é sempre para o lado conservador: nunca abre episódio por causa do teste **[I]**.

   **Predicado em `MonitorEpisodioLatenciaRepository.inserirSeElegivel`, com a borda esquerda do
   ajuste S1 de 2026-11-23:**
   ```sql
   AND NOT EXISTS (SELECT 1 FROM teste_banda tb
                    WHERE tb.iniciado_em <= :medicaoMaisRecente + make_interval(secs => :timeoutMs / 1000.0)
                      AND tb.janela_fim  >= :medicaoMaisAntigaDaSequencia)
   ```
   - `:timeoutMs` é o `timeout_ms` **do monitor avaliado**.
   - **Por que o timeout basta:**
     - `executado_em` é gravado **antes** de o eco sair (`IcmpMonitorExecutor.java:38-40`) **[P]**;
     - uma medição `SUCESSO` tem RTT ≤ `timeout_ms`, porque acima disso ela é `FALHA` e já não entra
       na sequência de latência (`acimaDoLimiar` exige `SUCESSO`, `LatencyEpisodeProcessor.java:160-163`)
       **[P/I]**;
     - portanto, um eco que sai em `t` só pode ser afetado pelo tráfego do teste se `t + timeout_ms >=
       iniciado_em`;
     - o predicado cobre esse caso para a medição mais recente, e, por sobreposição, para todas as
       anteriores **[I]**.
   - **De onde vem o timeout [P]:**
     - o motor grava a medição por `MedicaoService.criar` (`MonitorExecutionCoordinator.java:82`);
     - `criar` carrega o `Monitor` com `monitorRepository.findById`, uma entidade inicializada e não
       um proxy, e o associa à medição (`MedicaoService.java:47-51`);
     - esse mesmo objeto chega ao processador como `medicaoPersistida.getMonitor()` e é passado a
       `processarAbertura(Monitor monitor, ...)` (`LatencyEpisodeProcessor.java:93, 97`);
     - `monitor.getTimeoutMs()` existe em `Monitor.java:89`;
     - **não há consulta extra.**
   - **Ressalva [I]:** o valor lido é o `timeout_ms` atual do monitor, e não o da época de cada medição.
     Se alguém mudar o timeout entre duas medições, a borda usa o valor novo. Isso não tem efeito
     prático: o CHECK da V5 limita o timeout a 100–60000 ms.
2. **A janela é gravada no disparo:**
   ```
   janela_fim = iniciado_em + 2 × duracao_sentido_segundos + margem de fila
   ```
   - A margem de fila vale **10 s, de forma provisória**. O valor definitivo sai do
     [laboratório](laboratorio.md).
   - A janela expira por tempo, mesmo que o teste fique órfão.
3. **Removidos:** o 409 por teto, o teto de 5 min e toda dependência de `latencia-ciclos` e de
   intervalo na supressão.

**Motivo:**
- A janela passa a depender só do próprio teste.
- A sequência avaliada é a mesma que abriria o episódio. Se ela tocou o teste, o episódio não abre.
  Assim que a sequência inteira estiver fora da janela, a avaliação por nível (V1) abre o episódio
  real, sem margem calculada.
- Os dois timestamps já estão disponíveis no ponto do insert, sem consulta extra
  ([contexto.md § Item 1](contexto.md#item-1--timestamps-da-sequência-no-ponto-do-insert)) **[P]**.

**S1–S4 resolvidas em 2026-11-23:**
- **S1:** borda esquerda estendida pelo timeout (acima).
- **S2:** o texto da decisão passa a falar em sobreposição (acima).
- **S3:** prazo duro do executor (D14).
- **S4:** índice `(janela_fim, iniciado_em)` ([v28-proposta.md](v28-proposta.md)).

## D6 — Relatórios não excluem as medições do teste neste ciclo

- As medições ICMP tomadas durante o teste **continuam** no relatório de latência, no PDF e na
  exportação.
- A exclusão fica para o **agregado por hora (D-07)** e será aplicada na construção do agregado.

**Impacto:**
- No máximo 1 amostra por monitor por teste. A janela de cerca de 40 s é menor que o intervalo de
  60 s **[I]**.
- O filtro atual é `status='SUCESSO' AND latencia_ms IS NOT NULL`, mais período e tipo
  (`RelatorioService.java:80`) **[P]**.
- Com a D5 revista, a exclusão na D-07 usa o mesmo par (`iniciado_em`, `janela_fim`) **[I]**.

**Motivo:** um anti-join pesaria numa consulta já sensível a desempenho
**[E, memórias de latência]**.

## D7 — Perfis (DETALHADA em 2026-11-23)

| Ação | Rota | Perfis | Regra que se aplica |
|---|---|---|---|
| Marcar a ponta | `PUT /api/v1/unidades/{id}/ponta-banda` | ADMIN e OPERADOR | Regra atual de `/unidades/**` (`SecurityConfiguration.java:15`) **[P]** |
| Limpar a ponta | `DELETE /api/v1/unidades/{id}/ponta-banda` | ADMIN e OPERADOR | Regra atual de `/unidades/**` (`SecurityConfiguration.java:17`) **[P]** |
| **Disparar o teste** | `POST /api/v1/testes-banda` | **somente ADMIN** | Regra geral `/api/**` (`SecurityConfiguration.java:18`) **[P]** |
| Consultar teste e histórico | `GET /api/v1/testes-banda/**` | ADMIN, OPERADOR e VISUALIZADOR | `SecurityConfiguration.java:13` **[P]** |

**Marcar ou limpar a ponta é cadastro.** Disparar o teste satura a WAN de produção.

**ARMADILHA.**
- Um `POST /api/v1/unidades/{id}/...` (por exemplo `/unidades/{id}/teste-banda`) **herdaria
  ADMIN+OPERADOR** pela linha 14 da `SecurityConfiguration` **[P]**.
- Por isso a rota de disparo fica **fora de `/unidades/**`**.

**Exigência de implementação:** um teste que prove que **OPERADOR recebe 403** no
`POST /api/v1/testes-banda`, e que ADMIN não recebe. Sem esse teste, uma troca de rota passa
despercebida.

## D8 — O que acontece com o histórico quando um cadastro é excluído

- **Excluir a unidade apaga o histórico:** `teste_banda.unidade_id ... ON DELETE CASCADE`.
- **Excluir o equipamento preserva o histórico:**
  - `equipamento_id` é anulável, com `ON DELETE SET NULL`;
  - `equipamento_nome` e `ip_alvo` ficam gravados como retrato do momento do teste.

**Motivo:**
- Sem a unidade, o histórico perde contexto **[I]**.
- A ponta pode ser trocada, e o teste antigo continua valendo para o link **[I]**.

**Nota [I]:** a exclusão da unidade continua barrada por outras dependências `RESTRICT`, como a
`manutencao_agendada` (V21) **[P]**.

## D9 — Binário compilado no nosso CI (DETALHADA em 2026-11-23)

**Versão:** iperf3 **3.22.1**, com tag e commit fixos (`acc0ed500fb2c421999948a72bb6a9e05af528d8`)
**[P, API do GitHub]**.
- ~~Tag ≥ 3.19.1~~. Foi substituída por causa da C1.
- **Antes de ir para produção, reconferir se há versão mais nova** em `esnet/iperf/releases` e ler as
  notas de segurança.

**Build:** sem OpenSSL (`--without-openssl`). O SHA-256 do artefato é registrado.

**Correção do texto original:**
- ~~Sem OpenSSL (remove `iperf_auth.c`, onde estavam os CVEs).~~
- **Compilar sem OpenSSL NÃO elimina os CVEs de 2026.** Eles estão:
  - no código do **servidor**: use-after-free remoto em `iperf_server_api.c`;
  - no tratamento de parâmetros do teste (CVE-2026-71217) e num laço infinito (CVE-2026-102253).
- Esse código roda **antes de qualquer autenticação** **[P, notas da 3.22]**. A localização "antes
  da autenticação" é dedução: a autenticação RSA nem é compilada nesta build **[I]**.
- O que tirar o OpenSSL elimina de fato:
  - o código de autenticação, cujo corpo está sob `#if defined(HAVE_SSL)` **[P]**;
  - a dependência de uma biblioteca a mais.

**A barreira real é a combinação de três coisas:**
1. **Firewall de entrada** no servidor da unidade, restrito ao IP da D05 e ao programa `iperf3.exe`.
2. **Bind em IP específico** (`-B <ip-do-servidor>`), em vez de todas as interfaces.
3. **Conta de baixo privilégio** para o serviço iperf3: local, sem login interativo, não
   administradora.

Do lado do backend, entra ainda a lista de alvos permitidos (D13).

**Motivo:**
- O upstream não publica build para Windows, e Windows não é plataforma suportada (`README.md:29-32`)
  **[P]**.
- Binário sem procedência verificável não entra em servidor de produção **[I]**.

## D10 — Tempo real por polling de 1 s

- O front consulta `GET /api/v1/testes-banda/{id}?desde=<seq>`.
- As amostras ficam em memória durante a execução e são gravadas em `amostras` (JSONB) ao final.

**Motivo:** SSE atrás do IIS/ARR exigiria mexer em configuração não versionada do servidor
**[P/E]**. O polling usa o caminho HTTP já homologado **[I]**.

## D11 — Status

- `SUCESSO` e `FALHA` são reaproveitados **[P]**.
- Entra uma chave nova, `EXECUTANDO`: rótulo "Em execução", tom `info`.

**Motivo:** nenhuma chave existente tem esse sentido **[P]**.

## D12 — Velocímetro

- Escala máxima configurável: `BANDA_ESCALA_MAX_MBPS=1000`.
- Escala não linear.
- SVG próprio.
- Sem "% do contratado".

**Motivo:**
- O projeto não usa biblioteca de gráfico **[E]**.
- A banda contratada não está no cadastro **[I]**.

## D13 — Proteção em dev e configuração

| Variável | Padrão | Comportamento |
|---|---|---|
| `BANDA_TESTE_ENABLED` | `false` | Desligada, o POST responde 409. Coberta pelo `ConfiguracaoPadraoDesligadaTest`. |
| `BANDA_TESTE_ALVOS_PERMITIDOS` | vazia | Lista em CIDR. Vazia, recusa todos os alvos. |
| `BANDA_TESTE_EXECUTAVEL` | — | Caminho absoluto. Validado no boot **só com a flag ligada**. |

- Os testes automatizados usam um runner falso.
- O teste contra iperf3 real recebe a tag `banda-lab`.

**Motivo:**
- O padrão do projeto é desligado sem variável **[P]**.
- Os IPs do dev colidem com a rede real **[P-lab + E]**.
- O WinSW não define `PATH` **[P]**.

## D14 — Limites de execução e recuperação (cooldown DETALHADO em 2026-11-23)

**Limites:**
- `-t` de no máximo **15 s por sentido**.
- **Um teste por vez** no sistema.
- `destroyForcibly` no shutdown.
- **Prazo duro, ajuste S3 de 2026-11-23.** O executor encerra o iperf3 com `destroyForcibly` em
  **`janela_fim − margem de fila`**, qualquer que seja o sentido em execução.
  - O teste é gravado como `FALHA`, com o valor parcial que houver e um `erro` dizendo que o prazo
    estourou.
  - Assim, `janela_fim` deixa de ser uma estimativa e vira garantia. Nenhum tráfego do teste
    acontece depois de `janela_fim − margem`, e a margem cobre a fila que ainda escoa até
    `janela_fim` **[I]**.
  - **Segunda barreira:** `--server-max-duration` no servidor iperf3 da unidade
    ([laboratorio.md](laboratorio.md), preparação). Ela corta pelo lado do servidor se o cliente
    falhar em parar. A opção existe no fonte da 3.22 (`src/iperf_api.c:1122`) **[P]**; a prova é na
    build Cygwin.

**Limpeza de órfão:**
- **No boot:** todo `EXECUTANDO` vira `FALHA` com `erro = INTERROMPIDO_REINICIO`.
- **No POST:** `UPDATE` condicional sobre `EXECUTANDO` mais antigo que a duração máxima + margem.
- O teste **nunca** é reexecutado automaticamente.

**Cooldown global de 120 s.**
- Desde a D5 revista, o cooldown **não tem papel na supressão**. Ele existe só **por cortesia com o
  link**.
- A contagem parte de `concluido_em` do teste anterior.
- Se o teste anterior for órfão (sem `concluido_em`), a contagem parte de `janela_fim`.
- ~~Cooldown global ≥ 120 s~~: o mínimo vira um valor fixo de 120 s e a referência fica explícita.

**Motivo:**
- A D05 é o único cliente **[I]**.
- Sem limpeza, o índice único de um `EXECUTANDO` travaria o sistema **[I]**.
- Parar o serviço não mata o processo filho **[E, memória]**.

## D15 — Ponta desativada (NOVA em 2026-11-23)

- Se a ponta da unidade estiver com `ativo = false`, o POST é recusado com **409 "ponta inativa"**.
- **A referência é mantida.** Reativar o equipamento basta para voltar a testar.

**Motivo:**
- Desativar o equipamento (`EquipamentoService.desativar`) não dispara a FK **[P]**.
- Limpar a referência automaticamente apagaria uma escolha de cadastro sem ninguém pedir **[I]**.

## D16 — Retransmissões: FECHADA em 2026-11-23 (sem colunas)

**Texto condicional original:**

> ~~**Se** o laboratório, no item (e), provar que as retransmissões **não vêm** na build Windows
> (Cygwin), as colunas `retransmissoes_download` e `retransmissoes_upload` **saem da V28**. **Se
> vierem**, ficam. Ordem obrigatória: o item (e) do laboratório roda antes de a V28 virar arquivo.~~

**Decisão:**
- `retransmissoes_download`, `retransmissoes_upload` e `ck_teste_banda_retransmissoes` **saem da
  V28** ([v28-proposta.md](v28-proposta.md)).
- O item (e) do laboratório foi retirado.

**Evidência [P]:**
- Execução [45191296655](https://github.com/RicardoBSantos/infra-monitor/actions/runs/45191296655)
  do workflow `build-iperf3-windows.yml` (PR #49), com o iperf3 3.22.1 compilado no Cygwin 3.6.12.
- Testes em loopback (`127.0.0.1`), `-t 2`, nos dois sentidos: modo normal e `-R`.
- Em nenhum dos dois o `end.sum_sent` traz a chave `retransmits`.
- O iperf3 só emite essa chave quando a plataforma informa retransmissões. Uma chave ausente não
  depende de haver perda **[I]**.

**Motivo:** uma coluna sempre nula engana quem lê o histórico e o contrato da API **[I]**.

## D17 — Forma de liberar o binário no ASR: PENDENTE (2026-11-24)

**Estado: pendente.** Decisão do responsável, executada pelo administrador do Intune/MDE. Contexto em
[dividas.md § Bloqueio externo](dividas.md#-bloqueio-externo--o-asr-do-defender-impede-o-iperf3exe-de-rodar).

**Problema [P]:** a regra ASR `01443614-…` bloqueia o `iperf3.exe` (eventos 1121 na D07). Sem
liberação, o binário não roda nem no laboratório nem em produção.

**Recomendação: indicador "Permitir" por SHA-256 no MDE**, para o `iperf3.exe` e a `cygwin1.dll`
da Release oficial.

| Opção | A favor | Contra |
|---|---|---|
| **Hash (recomendada)** | Mais estreita: libera exatamente o artefato publicado e nada mais. Independe da pasta e da conta. O hash já é publicado na Release e conferido pelo operador | **Cada build nova pede liberação nova**, porque o build não é reproduzível ([build-iperf3.md](build-iperf3.md#builds)). Mitigação: a regra "não recompilar sem motivo". O hash da `cygwin1.dll` só muda com a versão do Cygwin. **Falta confirmar** que esta regra ASR respeita o indicador **[I]** |
| Caminho (exclusão de ASR por pasta, por exemplo `C:\InfraMonitor\tools\iperf3\`) | Sobrevive a uma recompilação. Uma liberação só | Libera **qualquer executável** colocado na pasta. A proteção passa a depender da ACL da pasta (escrita só para administradores), em cada máquina. Se a exclusão for global (`AttackSurfaceReductionOnlyExclusions`) e não por regra, desliga **todas** as regras de ASR para a pasta |
| Assinatura de código + indicador de certificado | Sobrevive a recompilações. Procedência mais forte que o hash | Exige certificado de assinatura de código, que não temos, e guardar a chave privada no CI. Ainda precisa do indicador de certificado no MDE. É o maior trabalho das três |

**Descartado:** esperar a prevalência subir. Não depende de nós e não tem prazo **[I]**.

**Ao decidir, registrar aqui:** a opção, a data, quem aplicou no Intune/MDE, os hashes ou o caminho
liberados, e a prova de que a execução passou (ausência do evento 1121 e `iperf3.exe --version` na
D07, na D05 e num servidor de unidade).

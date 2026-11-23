# Teste de banda — roteiro de laboratório

**Estado: roteiro, não executado.** Tudo aqui é **[I]** até ser rodado. Ao executar, cada passo
recebe **[P-lab]** com data e evidência, no formato de `Docs/producao/janela-v27-2026-11-19.md`.

Objetivo: provar, **antes de qualquer uso em produção**, que o binário, a proteção de acesso e a
supressão (D4/D5) se comportam como o desenho supõe.

## Regras de isolamento (inegociáveis)

1. **Banco de laboratório NOVO.** Um PostgreSQL 16 descartável, criado só para isto, com Flyway
   aplicado do zero e cadastro contendo **somente os IPs do laboratório**.
   - **Nunca** o banco de dev (5434), que tem IPs que colidem com a rede real, como 10.79.10.6, o AD
     real **[P-lab + E]**.
   - **Nunca** o banco da carga (5436) **[E]**.
2. **Telegram desligado** na instância do laboratório: `TELEGRAM_ENABLED=false` e
   `NOTIFICATION_DISPATCHER_ENABLED=false`. As notificações são conferidas na tabela `notificacao`,
   nunca no canal.
3. **Porta própria** para o backend do laboratório. **Não** é a 8080 nem a 8081. Ver em dividas.md o
   risco dos e2e apontarem para a 8080.
4. `BANDA_TESTE_ALVOS_PERMITIDOS` contém **só** a sub-rede do laboratório.
5. Nada no laboratório toca a WAN de produção.

## Topologia

```
[cliente: Windows, papel da D05]──┐
  backend lab (motor LIGADO,      │
  porta própria, banco lab)       │
                                  ├──[GARGALO OBRIGATÓRIO]──[servidor: Windows Server lab, iperf3 -s]
[monitor ICMP alvo 2 (outra       │      switch com rate limit
 "unidade" do laboratório)]───────┘      OU Linux com tc
```

- **(b) Enlace limitado é obrigatório.** Sem gargalo, a fila não enche e a latência não passa de
  250 ms. O ensaio de supressão sairia "verde" sem provar nada.
- Opções de gargalo:
  - switch com limitação de banda na porta, por exemplo 10 Mbit/s;
  - máquina Linux roteando entre as duas pontas com
    `tc qdisc add dev <if> root tbf rate 10mbit burst 32kbit latency 400ms`.
- A latência de fila tem de passar **com folga** do limiar. Validar antes, com ping sob carga.
- **Pelo menos dois alvos ICMP atrás do gargalo**, em duas "unidades" do cadastro do laboratório,
  para observar o efeito global (D4).

## Preparação

1. **Binário:** o artefato do job de [build-iperf3.md](build-iperf3.md), com o SHA-256 conferido
   contra o registrado. Nenhum binário de outra fonte.
2. **Servidor:**
   - conta local de baixo privilégio (`svc-iperf3`), sem login interativo e sem ser administradora;
   - iperf3 rodando sob WinSW ou tarefa agendada:
     ```
     iperf3.exe -s -p 5201 -B <ip-servidor> --server-max-duration 20 --idle-timeout 30
     ```
   - antes, confirmar com `iperf3.exe --help` que cada flag existe nesta build.
3. **Firewall do servidor:**
   ```
   New-NetFirewallRule -Direction Inbound -Protocol TCP -LocalPort 5201 `
     -RemoteAddress <IP-cliente> -Program <caminho\iperf3.exe> -Profile Domain,Private -Action Allow
   ```
   Sem nenhuma outra regra de entrada para a 5201.
4. **Backend do laboratório:**
   - `MONITORING_ENGINE_ENABLED=true`;
   - `MONITORING_LATENCIA_CICLOS=2` e `MONITORING_LATENCIA_DEGRADADA_MS=250`, iguais aos padrões e
     ainda **a confirmar em produção** (dividas.md);
   - monitores com os intervalos da tabela do item (g): 60 s (igual a produção **[E]**), 20 s e 300 s.

## Casos a provar

### (c) CPU do servidor

Medir a CPU do servidor durante o teste nos dois sentidos, com `Get-Counter
'\Processor(_Total)\% Processor Time' -SampleInterval 1`. Registrar o pico e a média.

O servidor da unidade é um Windows Server de produção, e o teste não pode derrubá-lo.

### (d) `--json-stream` na build compilada

- Rodar `iperf3 -c <ip> -t 5 --json-stream`.
- Esperado: um objeto JSON por linha, com `event` igual a `start`, `interval` e `end`. A opção
  existe no fonte da 3.22 (`src/iperf_api.c:1113`) **[P]**. A prova é na build Cygwin.
- Conferir que `end.sum_received.bits_per_second` está presente nos dois sentidos.

### (e) Retransmissões no modo `-R`

- Rodar `iperf3 -c <ip> -t 10 -R --json-stream`.
- Conferir se `end.sum_sent.retransmits` vem preenchido quando quem envia é o **servidor**.
- Sob gargalo com perda, o valor tem de ser maior que zero.
- Repetir sem `-R` e conferir `retransmissoes_download` pelo mesmo caminho.
- **Decisão condicional D16:** se as retransmissões **não vierem** na build Windows, as duas colunas
  **saem da V28** e não ficam sempre nulas.
- **Este item roda antes de a V28 virar arquivo.**
- **Suspeita [I]:** o Cygwin pode não expor `TCP_INFO`, e então as retransmissões viriam ausentes
  **nos dois sentidos**. É exatamente o que este caso prova ou derruba.

### (f) Cliente não autorizado é recusado — pelo firewall

- Sem OpenSSL não há `--rsa-*`. O `iperf_auth.c` é compilado vazio (`#if defined(HAVE_SSL)`)
  **[P]**, então **a única barreira é o firewall**.
- **Passos:**
  1. De uma terceira máquina, rodar `iperf3 -c <ip-servidor> -t 3`. Esperado: timeout de conexão.
  2. Do cliente autorizado, rodar o mesmo comando. Esperado: sucesso.
  3. Rodar `iperf3.exe --help | findstr rsa` no binário. Esperado: nenhuma opção `--rsa`, ou opção
     rejeitada em tempo de execução. Registrar qual dos dois.
- Conferir também que `--server-max-duration 20` corta um cliente que peça `-t 300`.

### Robustez (do roteiro original)

- Duas conexões simultâneas: a segunda recebe "server busy".
- Matar o processo cliente no meio do teste: o servidor volta a aceitar conexões dentro do
  `--idle-timeout`.
- Servidor fora do ar: o cliente falha dentro do timeout. O backend grava `FALHA`.
- Reiniciar o backend durante um teste: a linha vira `FALHA/INTERROMPIDO_REINICIO` e **nenhum
  processo iperf3 sobra órfão** (`Get-Process iperf3`).

### (g) Supressão por medição segura o episódio, e a reversão prova que ele abriria

Este caso testa o predicado da **D5 revista**:

```sql
NOT EXISTS (SELECT 1 FROM teste_banda tb
             WHERE tb.iniciado_em <= :medicaoMaisRecente
               AND tb.janela_fim  >= :medicaoMaisAntiga)
```

**Regra de validade:** o teste só vale se **as duas metades** (com e sem o predicado) passarem com a
**mesma** carga.

**Monitores atrás do gargalo, em duas "unidades" do laboratório:**

| Monitor | Intervalo | Papel no ensaio |
|---|---|---|
| A1 | 60 s | Igual a produção **[E]** |
| A2 | 60 s | Outra unidade; prova o escopo global (D4) |
| **B** | **20 s** | Intervalo curto: **várias** medições caem dentro da janela, e a sequência inteira pode estar nela |
| **C** | **300 s** | Intervalo longo: a sequência cobre muito mais tempo que a janela. É o caso que travava a D5 original (C3) |

`MONITORING_LATENCIA_CICLOS=2` e `MONITORING_LATENCIA_DEGRADADA_MS=250`.

**Passos:**

1. **Linha de base, sem teste:**
   - saturar o gargalo com um iperf3 manual, fora do backend, por tempo suficiente para A1, A2 e B
     terem 2 medições acima de 250 ms;
   - esperado: episódio abre em A1, A2 e B.
   - Isso prova que o gargalo e o limiar estão calibrados. **Sem isso, o resto não vale.**
2. **Com o predicado, só o teste:**
   - disparar pelo backend (`POST /testes-banda`), sem carga extra.
   - **Esperado:**
     - nenhuma linha nova em `monitor_episodio_latencia` cuja sequência toque `[iniciado_em,
       janela_fim]`;
     - nenhuma `notificacao` `LATENCIA_ALTA`, em **nenhum** dos quatro monitores.
   - **Registrar:**
     - `iniciado_em`, `janela_fim` e `concluido_em`;
     - a lista de medições de cada monitor (`executado_em`, `latencia_ms`, `status`);
     - para cada avaliação de abertura no período, se o predicado segurou ou não.
3. **Prova de reversão:**
   - build do laboratório **sem** o `AND NOT EXISTS (...)`; mesmo teste, mesma carga;
   - **esperado:** o episódio **abre** pelo menos em B, cujas duas medições seguidas caem dentro do
     teste;
   - **se não abrir, o passo 2 não provou nada e o ensaio falha.**
   - Repetir até ter uma execução em que, sem o predicado, A1 também abra. Para isso basta a
     saturação manual cobrir a medição anterior à janela.
4. **Margem de fila (calibra os 10 s provisórios da D5):**
   - medir, após o fim do tráfego do iperf3, quanto tempo a latência leva para voltar abaixo de
     250 ms;
   - usar B (20 s) e pings manuais de 1 s em paralelo, fora do motor;
   - **o maior valor observado mais uma folga vira a margem definitiva.**
5. **Fim da janela, com degradação real que continua:**
   - manter a saturação manual além de `janela_fim`;
   - **esperado:** o episódio abre na primeira sequência **inteiramente** depois de `janela_fim`, com
     `iniciado_em > janela_fim`;
   - registrar o atraso por monitor: em B, de cerca de 40 s; em A1, de cerca de 2 min; em C, de
     cerca de 10 min;
   - **C é a prova de que o intervalo longo não trava mais o botão**: o POST foi aceito e o atraso
     ficou limitado à própria cauda de C.
6. **Bordas:**
   - **S1:** disparar o teste com uma medição de A1 agendada para ~0,5 s antes de `iniciado_em`.
     Registrar a latência dessa medição e se ela entrou numa sequência que abriu episódio;
   - **S3:** com o gargalo mais apertado, forçar um teste cujo `concluido_em` passe de `janela_fim`,
     por exemplo atrasando a conexão do segundo sentido. Registrar o que o executor faz.
7. **Incidente intocado:**
   - derrubar um alvo ICMP durante a janela;
   - **esperado:** incidente no fluxo normal (D4).

### (h) Rollback: jar anterior sobre banco na V28

1. Aplicar a V28 no banco do laboratório com o jar novo.
2. Subir o **jar anterior** (V27) com `--spring.flyway.enabled=false` e `ddl-auto: validate`, igual
   ao serviço de produção (`winsw.xml.template:12`) **[P]**.
   - **Esperado:** sobe sem WARN nem ERROR, apesar de `unidade.ponta_teste_banda_id`, que ele não
     mapeia. Esse é o caso **não coberto** pelo Ensaio B da V27, que só tinha tabelas novas.
3. Com o jar antigo, mover de unidade o equipamento que é ponta. Registrar o status HTTP e o código
   de erro: 409 `DATA_INTEGRITY_VIOLATION` ou 500.
4. Com o jar antigo, excluir uma unidade que tenha histórico de teste e nenhuma outra dependência.
   Esperado: o `CASCADE` apaga o histórico.
5. Rodar `Test-RollbackCompatibility` sem e com `databaseAheadOfRelease` na prova.
   - **Esperado:** recusa e depois aceite, como em
     `deployment/windows/tests/schema-guard-tests.ps1:58` **[P]**.
6. Voltar ao jar novo: um `EXECUTANDO` deixado de propósito vira `FALHA/INTERROMPIDO_REINICIO`.

## Desfazer

- Remover a regra de firewall, o serviço iperf3 e a conta `svc-iperf3` do servidor.
- Parar o backend do laboratório e apagar o banco descartável.
- Conferir que não restou nenhum processo iperf3 e nenhuma porta ocupada.

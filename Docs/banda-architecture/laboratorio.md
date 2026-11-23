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
   - monitores com intervalo de 60 s, igual a produção **[E]**.

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
- **Se não vier, `retransmissoes_upload` fica sempre `NULL`.** Registrar o fato, e a V28 mantém a
  coluna anulável.
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

### (g) Supressão segura o episódio e a reversão prova que ele abriria

O teste só tem valor se **as duas metades** passarem com a **mesma** carga.

1. **Linha de base:**
   - sem teste nenhum, saturar o gargalo por cerca de 2,5 min com um iperf3 manual, fora do backend;
   - esperado: um episódio de latência abre nos monitores atrás do gargalo;
   - essa é a prova de que o gargalo e o limiar estão calibrados. **Sem isso, o resto não vale.**
2. **Com supressão:**
   - disparar o teste **pelo backend** (`POST /testes-banda`) e, logo em seguida, manter a mesma
     saturação manual até `suprimir_ate`;
   - esperado: nenhuma linha nova em `monitor_episodio_latencia` com `iniciado_em` dentro da janela,
     e nenhuma `notificacao` `LATENCIA_ALTA`;
   - registrar `suprimir_ate`, as medições (`executado_em`, `latencia_ms`) e o espaçamento real entre
     elas. Esse espaçamento é a evidência do risco residual de
     [contexto.md § V1](contexto.md#v1--abertura-de-episódio-é-avaliada-por-nível).
3. **Prova de reversão:**
   - remover o `AND NOT EXISTS (...)` do build do laboratório, ou zerar a supressão;
   - repetir o passo 2 com a mesma carga;
   - esperado: **o episódio abre**.
   - Se não abrir, o passo 2 não provou nada e o ensaio falha.
4. **Fim da janela:**
   - manter a saturação além de `suprimir_ate`;
   - esperado: o episódio abre na primeira medição depois da janela, com `iniciado_em` **depois**
     do fim do tráfego do teste (V1).
5. **Incidente intocado:**
   - derrubar um alvo ICMP durante a janela;
   - esperado: o incidente segue o fluxo normal, sem nenhuma supressão (D4).

## Desfazer

- Remover a regra de firewall, o serviço iperf3 e a conta `svc-iperf3` do servidor.
- Parar o backend do laboratório e apagar o banco descartável.
- Conferir que não restou nenhum processo iperf3 e nenhuma porta ocupada.

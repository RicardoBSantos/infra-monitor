# Teste em condição de produção — SED + ITA

Data: 2026-10-14. Duas unidades reais, IPs reais, motor ICMP ligado e Telegram no grupo real (equipe
avisada). Plano: [../superpowers/plans/2026-10-14-producao-duas-unidades.md](../superpowers/plans/2026-10-14-producao-duas-unidades.md).
Rede: [rede-sesc-enderecamento.md](rede-sesc-enderecamento.md).

**Resultado:** os 7 passos concluídos. 4 h de observação sem incidente, sem ciclo perdido, sem
ERROR/WARN; queda controlada abriu e fechou o incidente sozinha e entregou as duas mensagens ao grupo.
Banco de dev intocado do início ao fim.

## 1. Ambiente

| Item | Valor |
|---|---|
| Banco | `inframonitor-carga`, `127.0.0.1:5436`, recriado do zero (container + volume), Flyway V1–V20 |
| Backend | jar do HEAD (`./mvnw -DskipTests package`), porta 8081, perfil `prod`, ICMP `NATIVO_WINDOWS` |
| Frontend | `ng serve --configuration production`, porta 4200, proxy `/api` → 8081 |
| Segredos | senha do banco, `JWT_SECRET` e senha do admin aleatórios em `~/.inframonitor-carga/env.sh` (fora do repo); token do Telegram lido do `.env` só por export no processo |
| Telegram | `TELEGRAM_CHAT_ID=-5375858646`, bot `@Infra_monitor2026_bot`, só por variável de ambiente; nada commitado |

Banco de dev (`inframonitor-postgres`, 5434), conferido só com `SELECT` antes do passo 1 e depois
das 4 h: `unidades=12 equipamentos=222 monitores=222 medicoes=317080 flyway=19` nas duas vezes.

## 2. Cadastro pela API

Entrada: [`tools/carga-real/levantamento/producao-sed-ita.json`](../../tools/carga-real/levantamento/producao-sed-ita.json).

| Unidade | IBGE | Equipamento | IP | Monitor |
|---|---|---|---|---|
| SED — Sede Administrativa (Aracaju) | 2800308 | Servidor AD Core (Servidor) | 10.79.10.6 | ICMP `ping-principal` 30 s / 2000 ms / 3 / 2 |
| ITA — Sesc Itabaiana | 2802908 | Gateway Servidores (Roteador) | 10.70.10.1 | ICMP `ping-principal` 30 s / 2000 ms / 3 / 2 |

Conexão ITA → SED.

| Rodada | Resultado |
|---|---|
| Simulação | `criados=9 pulados=0 divergentes=0 falhas=0 avisos=0` |
| `--aplicar` | `criados=9` |
| `--aplicar` de novo | `criados=0 pulados=9` (idempotente) |

Coordenadas arredondadas para 6 casas antes do `--aplicar` (coluna `NUMERIC(9,6)`): com 7 casas a
reexecução acusaria "divergente". Diferença de ~0,1 m.

## 3. Janela de silêncio (11:34:20Z–11:49:20Z)

Motor ligado, Telegram/dispatcher desligados. Trava: qualquer FALHA ou incidente pararia a rodada.

| Equipamento | Medições | Falhas | Latência mín / mediana / máx |
|---|---|---|---|
| Gateway Servidores (ITA) | 30 | 0 | 4 / 4 / 19 ms |
| Servidor AD Core (SED) | 30 | 0 | 0 / 0 / 16 ms |

Intervalo entre medições 30,26–30,39 s; 0 incidentes; 0 ERROR/WARN; pool 20 conexões idle. Trava
não disparou.

## 4. Telegram no grupo real

Backend reiniciado (~11:49:50Z) com `TELEGRAM_ENABLED` e `NOTIFICATION_DISPATCHER_ENABLED`. Bot com
status VERIFICADO. Mensagem de teste enviada pelo botão da tela, por clique no Playwright, às
11:50:19Z: `POST /notificacoes/telegram/teste` → 200, `{"enviado":true}`. O token não aparece no log.
A mensagem de teste não passa pela tabela `notificacao`.

## 5. Observação de 4 h (11:50Z–15:50Z)

| Equipamento | Hora | Medições | Falha | Latência mín / mediana / máx (ms) |
|---|---|---|---|---|
| Gateway Servidores (ITA) | H1 | 119 | 0 | 3 / 4 / 12 |
| | H2 | 118 | 0 | 3 / 4 / 22 |
| | H3 | 118 | 0 | 3 / 4 / 8 |
| | H4 | 119 | **2** | 3 / 4 / 19 |
| Servidor AD Core (SED) | H1 | 119 | 0 | 0 / 0 / 3 |
| | H2 | 118 | 0 | 0 / 0 / 19 |
| | H3 | 118 | 0 | 0 / 0 / 3 |
| | H4 | 119 | 0 | 0 / 0 / 17 |

- 948 medições, 946 SUCESSO, 2 FALHA. Nenhum valor acima de 50 ms (máximo 22 ms).
- **As 2 falhas são timeouts isolados no ITA**, às 15:11:18Z e 15:47:19Z, cada um entre dois
  sucessos. Nenhuma sequência chegou a 3, então nenhum incidente abriu: comportamento esperado. No
  mesmo horário o SED não falhou, o que aponta para perda pontual no enlace até Itabaiana.
- Intervalo entre medições: 30,02 / 30,41 / 30,97 s (mín / mediana / máx). Nenhum acima de 35 s,
  logo nenhum ciclo perdido.
- Incidentes 0, episódios de latência 0, `notificacao` 0 linhas, ERROR/WARN 0.

Memória e pool:

| | Hora 1 | Hora 2 | Final (15:53Z) |
|---|---|---|---|
| Heap usado / total | 104 / 199 MB | 75 MB | 157 / 194 MB (110 MB de geração jovem) |
| Working set | 430 MB | 446 MB | 305 MB |
| Threads | 67 | — | 67 |
| Pool | 20 idle | 20 idle | 20 idle |

Teto do heap estável em ~194 MB e threads estáveis: sem sinal de vazamento. A oscilação do heap é o
ciclo do G1. A queda do working set no fim acompanha a pressão de memória da máquina (o Windows
recolhe páginas), não uma mudança no processo.

Observação de método: o amostrador horário em background foi abandonado depois da hora 2 por falta
de RAM na máquina de teste; as horas 3 e 4 saíram do banco ao final, numa consulta única.

## 6. Telas

Roteiro `infra-monitor-frontend/e2e/carga-real-telas.cjs` (`npm run e2e:carga-real`), navegação só
por clique após login, credencial por variável de ambiente: **43/43**. Capturas conferidas uma a uma:

- Mapa com 2 marcadores verdes pulsando e a linha ITA → SED com os pings em movimento;
- clique em cada marcador abre o painel da unidade certa, sem vazar para o município;
- Painel, Unidades, gaveta de cada equipamento com gráfico de latência, Relatórios com 100%.

Correção no roteiro durante a rodada: esperar o título da gaveta deixar de ser o rótulo genérico
"Equipamento" antes de ler (a primeira leitura chegava antes da resposta da API e dava falha falsa).

## 7. Queda controlada

Executada com aval explícito, trocando o IP do Gateway Servidores (ITA, equipamento 2) para
`192.0.2.1` (TEST-NET-1, aceito pela `RegraIpv4` e nunca roteado) e depois devolvendo
`10.70.10.1`. O `PUT /api/v1/equipamentos/{id}` aplica o corpo inteiro, então o corpo vai completo,
copiado do `GET`:

```json
{ "unidadeId": 2, "tipoEquipamentoId": 2, "nome": "Gateway Servidores", "ip": "192.0.2.1",
  "hostname": null, "descricao": "<igual ao atual>", "localizacao": null,
  "numeroSerie": null, "fabricante": null, "modelo": null }
```

| Horário (UTC) | Evento |
|---|---|
| 15:58:16 | PUT: IP → 192.0.2.1 (200) |
| 15:58:27 / 15:58:58 / 15:59:28 | 3 FALHAs (Timeout), já no ciclo seguinte à troca |
| 15:59:30 | Incidente 1 ABERTO ("apos 3 falhas consecutivas") |
| 15:59:31 | Telegram `INCIDENTE_ABERTO` ENVIADA, tentativa 1 |
| 15:59:41 | PUT: IP → 10.70.10.1 (200) |
| 15:59:58 / 16:00:29 | 2 SUCESSOs (4 ms) |
| 16:00:29 | Incidente 1 FECHADO, `RECUPERACAO_AUTOMATICA` |
| 16:00:30 | Telegram `INCIDENTE_FECHADO` ENVIADA, tentativa 1 |

Da troca do IP até o alerta no grupo: 75 s. Da restauração até o alerta de recuperação: 50 s.
Incidente com 2 min 02 s de duração. Regra 3/2 cumprida. Depois: `notificacao` com exatamente essas
2 linhas, 0 episódios de latência, 0 ERROR/WARN no log.

## 8. Achados

1. **Resposta do PUT de equipamento traz o `updatedAt` anterior.** O PUT de derrubar respondeu
   `updatedAt=11:33:33Z` (a criação); o de restaurar respondeu `15:58:16Z` (o horário da derrubada).
   O banco fica certo; só o corpo da resposta vem uma gravação atrasado (provavelmente lido antes do
   flush). Não corrigido nesta rodada.
2. **Timeouts isolados no ITA** (2 em 4 h, ~0,4% das medições da hora 4). O limiar de 3 falhas
   absorveu ambos. Vale acompanhar na carga das demais unidades remotas antes de mexer no limiar.
3. **Esquema de endereçamento a confirmar** com a equipe de rede (2º octeto = unidade, 3º = VLAN,
   pelos IPs reais; a descrição verbal dizia 3º/4º). Ver [rede-sesc-enderecamento.md](rede-sesc-enderecamento.md).

## 9. Estado ao fim

Backend rodando na 8081 com motor, Telegram e dispatcher ligados, apontado para `inframonitor-carga`;
Gateway Servidores de volta a `10.70.10.1`; frontend na 4200. Nada empurrado ao remoto.

# Validação de 4 horas com equipamentos reais

Data: 2026-10-14, das 11:50Z às 15:50Z (08:50 a 12:50 em Brasília). Parte do teste em condição de
produção registrado em [producao-sed-ita.md](producao-sed-ita.md). Nenhum código alterado.

## Conclusão principal

> **As 2 falhas do período são perda pontual no enlace entre cidades, e os parâmetros atuais as
> absorveram sem alarme falso.**
>
> As duas falhas foram do gateway de Itabaiana, às **15:11:18Z** e **15:47:19Z**. Cada uma foi um
> único `Timeout`, seguido de SUCESSO no ciclo seguinte (30 s depois). Nos dois horários a sede não
> falhou. Isso descarta problema na máquina de monitoramento ou no motor e aponta para o enlace
> Itabaiana → Aracaju.
>
> Com `falhas_para_incidente = 3`, nenhuma das duas virou incidente nem mensagem no Telegram. **Com
> limiar 1, teriam sido 2 alarmes falsos em 4 horas, cerca de 12 por dia, só dessa unidade.** É a
> evidência que justifica os parâmetros atuais: 30 s / 2000 ms / 3 falhas para abrir / 2 sucessos
> para fechar.
>
> **Ressalva:** a taxa é de um enlace só, numa manhã. Com as 11 unidades, reavaliar depois da carga
> completa: mais enlaces somam mais falhas isoladas, e um enlace pior pode pedir outro limiar ou outro
> timeout.

## Ambiente

| Item | Valor |
|---|---|
| Banco | `inframonitor-carga`, `127.0.0.1:5436`, Flyway V1–V20; banco de dev (5434) intocado |
| Backend | jar do HEAD, porta 8081, perfil `prod`, ICMP `NATIVO_WINDOWS` |
| Motor | ligado (`MONITORING_ENGINE_ENABLED=true`) |
| Telegram | ligado, com dispatcher, no grupo real (`TELEGRAM_CHAT_ID=-5375858646`), por variável de ambiente |
| Máquina de origem | `10.79.20.163` (sede, VLAN 20), ver [segmentacao-rede-sesc.md](segmentacao-rede-sesc.md) |

## Unidades e equipamentos monitorados

| Unidade | Equipamento | IP | Monitor |
|---|---|---|---|
| SED — Sede Administrativa (Aracaju) | Servidor AD Core | 10.79.10.6 | ICMP, 30 s / 2000 ms / 3 / 2 |
| ITA — Sesc Itabaiana | Gateway Servidores (gateway da VLAN 10) | 10.70.10.1 | ICMP, 30 s / 2000 ms / 3 / 2 |

Conexão no mapa: ITA → SED.

## Números

**948 medições: 946 SUCESSO, 2 FALHA.**

| Equipamento | Hora | Medições | Sucesso | Falha | Latência mín / mediana / máx (ms) |
|---|---|---|---|---|---|
| Gateway Servidores (ITA) | H1 11:50–12:50 | 119 | 119 | 0 | 3 / 4 / 12 |
| | H2 12:50–13:50 | 118 | 118 | 0 | 3 / 4 / 22 |
| | H3 13:50–14:50 | 118 | 118 | 0 | 3 / 4 / 8 |
| | H4 14:50–15:50 | 119 | 117 | **2** | 3 / 4 / 19 |
| Servidor AD Core (SED) | H1 | 119 | 119 | 0 | 0 / 0 / 3 |
| | H2 | 118 | 118 | 0 | 0 / 0 / 19 |
| | H3 | 118 | 118 | 0 | 0 / 0 / 3 |
| | H4 | 119 | 119 | 0 | 0 / 0 / 17 |

- Nenhuma medição acima de 50 ms; a maior foi 22 ms.
- O `0` da sede é RTT abaixo de 1 ms, gravado como 0
  ([divida-latencia-sub-milissegundo.md](divida-latencia-sub-milissegundo.md)).

**Intervalo entre medições consecutivas do mesmo monitor:** 30,02 s de mínimo, 30,41 s de mediana e
30,97 s de máximo, igual nos dois. Nenhum intervalo acima de 35 s, então nenhum ciclo perdido.

**Memória e pool:**

| | Hora 1 | Hora 2 | Final (15:53Z) |
|---|---|---|---|
| Heap usado / total | 104 / 199 MB | 75 MB | 157 / 194 MB (110 MB de geração jovem) |
| Working set | 430 MB | 446 MB | 305 MB |
| Threads | 67 | — | 67 |
| Pool JDBC | 20 idle | 20 idle | 20 idle |

O teto do heap ficou estável em cerca de 194 MB e as threads também: não há sinal de vazamento. A
queda do working set no fim acompanha a pressão de memória da máquina de teste, porque o Windows
recolhe páginas; não é mudança no processo.

**Incidentes:** 0. **Episódios de latência:** 0. **Notificações na tabela:** 0. **ERROR/WARN no
log:** 0.

## Método

Uma consulta única em `medicao`, `incidente`, `monitor_episodio_latencia` e `notificacao`, com
`jcmd GC.heap_info`, o working set do processo e `pg_stat_activity` ao fim das 4 h. As horas 1 e 2
também foram amostradas na hora; o amostrador em background foi desligado por falta de RAM na
máquina de teste, e os números de todas as horas acima saem da consulta final.

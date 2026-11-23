# Teste de banda manual (iperf3) — índice

Estado em 2026-11-23: **desenho consolidado, nada implementado.** Nenhum código, migration ou
workflow de CI existe para esta feature. Este diretório é a referência única até a implementação.

Base: `origin/main` 94f5689 (PR #47). Todas as referências a arquivo e linha são desse commit.

## Legenda de origem

Toda afirmação traz uma marca:

| Marca | Significado |
|---|---|
| **[P]** | Conferido no código, no repositório ou na fonte oficial (GitHub do esnet/iperf) durante a consolidação. |
| **[P-lab]** | Executado contra banco local, só leitura, na investigação de 2026-11-23. |
| **[E]** | Vem de documento ou memória já existente, sem reverificar agora. |
| **[I]** | Inferência ou proposta; ainda precisa de prova. |

## Documentos

| Arquivo | Conteúdo |
|---|---|
| [decisoes.md](decisoes.md) | D1–D14, fechadas em 2026-11-23, com o motivo de cada uma. |
| [contexto.md](contexto.md) | Achados da investigação: motor ICMP, manutenção, IIS/ARR, WinSW/ACL, gráfico, perfis, e as verificações V1–V4. |
| [v28-proposta.md](v28-proposta.md) | Texto da V28 revisada e do `schema-compatibility.json`. **Não é arquivo de migration.** |
| [laboratorio.md](laboratorio.md) | Roteiro do ensaio que precisa acontecer antes de qualquer uso em produção. |
| [build-iperf3.md](build-iperf3.md) | Plano do job de CI que compila o iperf3 para Windows. |
| [dividas.md](dividas.md) | Lacunas, dívidas relacionadas e pontos em que a verificação contraria uma decisão. |

## Resumo

- **O que mede:** o link MPLS/WAN entre a sede e uma unidade. A SED-TI-D05 é o cliente iperf3. Um
  Windows Server de cada unidade, marcado explicitamente como ponta, é o servidor (D1) **[I]**.
- **Como dispara:** só pelo botão "Testar", somente ADMIN. Um clique roda download e depois upload
  (D2, D7) **[I]**.
- **Alertas durante o teste:** só a **abertura de episódio de latência** é suprimida, em todas as
  unidades, por um predicado de tempo que expira sozinho. Incidente, ping, SLA e Telegram não mudam
  (D4, D5) **[I]**.
- **Tela:** polling de 1 s com amostras incrementais, velocímetro em SVG próprio, histórico por
  unidade (D10, D11, D12) **[I]**.
- **Proteção:** desligada por padrão, lista de alvos em CIDR, executável por caminho absoluto, um
  teste por vez, cooldown global e limpeza de órfãos (D13, D14) **[I]**.
- **Binário:** iperf3 compilado no nosso CI a partir do fonte oficial, sem OpenSSL, com SHA-256
  registrado (D9) **[I]**. **A versão mínima tem de subir para 3.22.** Ver
  [dividas.md § Contradições](dividas.md#contradições-entre-a-verificação-e-as-decisões).

## Fluxo de um teste

```
ADMIN clica "Testar" (unidade U)
  │
  ▼
POST /api/v1/testes-banda {unidadeId}
  │  flag BANDA_TESTE_ENABLED?                  não → 409
  │  U tem ponta? ip da ponta ∈ ALVOS_PERMITIDOS? não → 409
  │  suprimir_ate − início > 5 min?             sim → 409 (D5)
  │  UPDATE condicional: EXECUTANDO velho → FALHA (órfão, D14)
  │  cooldown global (120 s) ainda corre?        sim → 409
  │  INSERT teste_banda (EXECUTANDO, suprimir_ate)
  │     └─ índice único parcial: outro EXECUTANDO → 409
  │  COMMIT  ← a supressão passa a valer aqui, ANTES do tráfego
  ▼
Thread do executor (fora da transação do POST)
  ├─ iperf3 -c <ip> -t ≤15 --json-stream        (download: sede→unidade)
  ├─ iperf3 -c <ip> -t ≤15 --json-stream -R     (upload: unidade→sede)
  │     amostras em memória, por seq ──► GET /testes-banda/{id}?desde=<seq>  (front, 1 s)
  └─ UPDATE final: SUCESSO | FALHA, mbps, retransmissões, amostras (JSONB)

Motor ICMP (paralelo, intocado)
  └─ cada medição → LatencyEpisodeProcessor
        inserirSeElegivel(...) AND NOT EXISTS (teste_banda WHERE now() < suprimir_ate)
        └─ 0 linhas → episódio não abre, nenhuma notificação

Boot do backend
  └─ EXECUTANDO → FALHA, erro = INTERROMPIDO_REINICIO (nunca reexecuta)
```

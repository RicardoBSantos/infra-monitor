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
| [decisoes.md](decisoes.md) | D1–D16 (2026-11-23), com motivo; D5 revista e D16 fechada, com o texto antigo riscado. |
| [contexto.md](contexto.md) | Achados da investigação: motor ICMP, manutenção, IIS/ARR, WinSW/ACL, gráfico, perfis, e as verificações V1–V4. |
| [v28-proposta.md](v28-proposta.md) | Texto da V28 revisada e do `schema-compatibility.json`. **Não é arquivo de migration.** |
| [laboratorio.md](laboratorio.md) | Plano sem Windows Server: A) binário e serviço num Windows 10/11 com a D07 de cliente; B) margem de fila em Docker (bloqueada na D07); C) supressão (g) como teste de integração e rollback (h) como ensaio de implantação. Inventário da D07. |
| [build-iperf3.md](build-iperf3.md) | Plano do job de CI que compila o iperf3 para Windows. |
| [dividas.md](dividas.md) | Bloqueio de produção (disco), destaque de rollback, S1–S4 resolvidas, C1–C4, dívidas e lacunas. |

> **⛔ Bloqueio de produção:** Stage, Switch e Rollback são recusados abaixo de ~25 GiB livres, e hoje há ~26 GiB. A janela desta feature espera a frente de retenção e disco. Ver [dividas.md](dividas.md#-bloqueio-de-produção--espaço-em-disco).
>
> **Rollback da V28:** possível, mas exige `databaseAheadOfRelease=true`, e ainda falta provar que o
> jar anterior tolera a coluna nova em `unidade`. Ver [dividas.md](dividas.md#rollback--leia-antes-da-janela-da-v28).

## Resumo

- **O que mede:** o link MPLS/WAN entre a sede e uma unidade.
  - A SED-TI-D05 é o cliente iperf3.
  - Em cada unidade, o servidor é um Windows Server marcado explicitamente como ponta (D1) **[I]**.
- **Como dispara:** só pelo botão "Testar". Um clique roda download e depois upload (D2) **[I]**.
- **Perfis (D7):**
  - disparar o teste: **só ADMIN**, pela rota `/api/v1/testes-banda`, fora de `/unidades/**`;
  - marcar a ponta: ADMIN e OPERADOR **[P]**.
- **Alertas durante o teste:** só a **abertura de episódio de latência** é suprimida, em todas as
  unidades.
  - O episódio não abre se a sequência avaliada sobrepõe a janela `[iniciado_em, janela_fim]` de um
    teste. A janela é gravada no disparo e expira por tempo.
  - Incidente, ping, SLA e Telegram não mudam (D4, D5 revista) **[I]**.
- **Tela:** polling de 1 s, velocímetro em SVG próprio, histórico por unidade (D10, D11, D12) **[I]**.
- **Proteção:**
  - desligado por padrão;
  - lista de alvos em CIDR;
  - executável por caminho absoluto;
  - um teste por vez;
  - limpeza de órfãos;
  - recusa com a ponta inativa;
  - cooldown de cortesia (D13, D14, D15) **[I]**.
- **Binário:** iperf3 **3.22.1** compilado no nosso CI, sem OpenSSL, com SHA-256 registrado (D9).
  - A barreira real é o firewall restrito à D05, mais o `-B` e a conta de baixo privilégio **[I]**.

## Fluxo de um teste

```
ADMIN clica "Testar" (unidade U)
  │
  ▼
POST /api/v1/testes-banda {unidadeId}          (OPERADOR → 403; teste obrigatório, D7)
  │  flag BANDA_TESTE_ENABLED?                    não → 409
  │  U tem ponta? ponta ativa?                    não → 409 ("ponta inativa", D15)
  │  ip da ponta ∈ ALVOS_PERMITIDOS?              não → 409
  │  UPDATE condicional: EXECUTANDO velho → FALHA (órfão, D14)
  │  cooldown: 120 s desde concluido_em (ou janela_fim, se órfão)?  ainda corre → 409
  │  INSERT teste_banda (EXECUTANDO, iniciado_em, janela_fim = início + 2×t + margem)
  │     └─ índice único parcial: outro EXECUTANDO → 409
  │  COMMIT  ← a janela passa a valer aqui, ANTES do tráfego (D4; teste de integração da ordem)
  ▼
Thread do executor (fora da transação do POST)
  │  prazo duro: destroyForcibly em janela_fim − margem (D14); --server-max-duration no servidor
  ├─ iperf3 -c <ip> -t ≤15 --json-stream        (download: sede→unidade)
  ├─ iperf3 -c <ip> -t ≤15 --json-stream -R     (upload: unidade→sede)
  │     amostras em memória, por seq ──► GET /testes-banda/{id}?desde=<seq>  (front, 1 s)
  └─ UPDATE final: SUCESSO | FALHA, mbps, amostras (JSONB)  (sem retransmissões: D16)

Motor ICMP (paralelo, intocado)
  └─ cada medição → LatencyEpisodeProcessor (avaliação por nível sobre as últimas N)
        inserirSeElegivel(..., :iniciadoEm = mais antiga, :medicaoMaisRecente)
          AND NOT EXISTS (teste_banda tb WHERE tb.iniciado_em <= :medicaoMaisRecente + :timeoutMs
                                           AND tb.janela_fim  >= :iniciadoEm)
        └─ 0 linhas → episódio não abre, nenhuma notificação

Boot do backend
  └─ EXECUTANDO → FALHA, erro = INTERROMPIDO_REINICIO (nunca reexecuta)
```

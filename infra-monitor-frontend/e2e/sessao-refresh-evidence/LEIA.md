# Evidência — sessão com refresh token (2026-11-11)

Roteiro: `e2e/sessao-refresh.cjs` (`npm run e2e:sessao`). Spec: `Docs/superpowers/specs/2026-11-11-sessao-refresh-token-design.md`.

Ambiente descartável, nunca o banco de dev nem o da carga: PostgreSQL 16 em container próprio (127.0.0.1:5441),
backend do branch na 8083 com `JWT_ACCESS_TOKEN_MINUTES=1` e `JWT_REFRESH_TOKEN_DURATION=4m`, motor ICMP,
Telegram, dispatcher e agendador desligados; `ng serve` com o proxy na 4310 (`API_PORT=8083`).

| Pasta / arquivo | O que prova |
|---|---|
| `novo/`, `novo.log` | Front e backend do branch (jar de `bfaa4b0`): 6/6 PASS — login; `page.reload()` mantém a sessão (sintoma 2); link direto; 150 s de uso com access de 60 s sem queda, 2 refresh 200 (sintoma 1); cookie antigo reenviado depois do Sair → 204; fim da sessão (4 min) → login com "Sua sessão expirou". |
| `antigo-origin-main/`, `.log` | Prova de reversão: front de `origin/main` (920e4d5) na 4311 contra o mesmo backend. Passo 2 FAIL (reload → `/login?returnUrl=%2Fequipamentos`, nenhum refresh); passo 3 FAIL. O passo 4 desta rodada abortou por um defeito do roteiro (corrigido depois). |
| `antigo-origin-main-passo4/`, `.log` | Passo 4 repetido com o roteiro corrigido no front antigo: FAIL — "caiu no login após 75s". |
| `splash-light.png`, `splash-dark.png` | Tela "Restaurando sessão…" durante o refresh do bootstrap (refresh atrasado 3 s de propósito); sem erro de console numa primeira visita sem cookie (o refresh responde 204). |

A última correção (`53e8e60`: 503 em falha transitória do banco, WARN no modo degradado) veio depois destas
rodadas e não foi repetida no navegador: o ambiente de prova foi derrubado por falta de memória na máquina.
Ela é coberta pelos testes de integração do backend e pela CI.

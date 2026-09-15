# Mapa — arquitetura e ciclo

Documentação persistente do ciclo do Mapa operacional (`/mapa`): cartografia de Sergipe, extrusão
3D, painel lateral, topologia entre unidades e a gaveta de equipamento sobre o mapa.

Segue o padrão de `auth-architecture/` e `reports-architecture/`: uma pasta por ciclo grande, com um
arquivo-índice de mesmo nome da pasta.

## Arquivos

| Arquivo | O que é |
|---|---|
| [mapa-decisoes.md](mapa-decisoes.md) | Log cronológico de decisões (D01–D12): o que foi decidido, o que foi descartado, por quê |
| [mapa-contexto-atual.md](mapa-contexto-atual.md) | Estado da rodada em curso, com números medidos |
| [mapa-dividas.md](mapa-dividas.md) | O que ficou em aberto de propósito, e quando cobrar |

## Regra de manutenção

**Toda investigação ou decisão nova do Mapa atualiza `mapa-decisoes.md` e `mapa-contexto-atual.md`
dentro do commit da própria mudança — nunca como documentação separada, feita depois.**

Não é preferência de organização. Este ciclo já perdeu contexto duas vezes por documentação
adiada: os spikes N01 e N02 rodaram em worktree fora do repositório e não deixaram commit, e as
etapas M01–M06 e N01–N06 só existiam em mensagem de commit e memória de sessão até esta rodada.
Decisão que não chega junto com o código vira arqueologia de `git log`.

Dívida nova entra em `mapa-dividas.md` com origem e critério de cobrança. Decisão que **reverte**
outra não apaga a entrada antiga: acrescenta uma nova que diz o que mudou e por quê.

## Estado do ciclo

| Etapa | Estado |
|---|---|
| M01–M05 — cartografia, painel lateral, seleção, zoom | fechado e commitado (`a2f2e71`) |
| Coordenadas no read-model | fechado e commitado (`e8642d8`) |
| N01–N03 — spike MapLibre, acessibilidade, altura da extrusão | fechado e commitado (`f6b5eb6`) |
| N04 — hub por auto-referência | fechado e commitado (`8cd4e28`, `e008504`, `3aa79fb`) |
| N05 — extrusão 3D, offset de câmera, CSS no chunk lazy | fechado e commitado (`f6b5eb6`) |
| **M06 — gaveta de equipamento sobre o mapa** | **implementado, entra nesta rodada** |
| **Dados de demonstração persistentes** | **implementado, entra nesta rodada** |
| **Marcador de unidade por coordenada** | **implementado, entra nesta rodada** |
| **N06 — linhas de conexão** | **implementado, entra nesta rodada** |
| **Layout: rolagem, legenda, painel** | **implementado, entra nesta rodada** |
| Zoom BRASIL/REGIÃO com dado fora de Sergipe | bloqueado por dado (ver DV01) |

## Onde o código vive

```
infra-monitor-frontend/src/app/features/mapa/        componente, folha e spec
infra-monitor-frontend/src/app/core/services/geo-municipio.service.ts
infra-monitor-frontend/public/assets/maps/           cartografia GeoJSON de Sergipe
infra-monitor-frontend/e2e/n0{4,5,6}-*.cjs           roteiros executáveis em clone limpo
infra-monitor-backend/db/dev-seed/                   dado de demonstração (não é migration)
infra-monitor-backend/src/main/java/.../dashboard/   read-model que alimenta o mapa
```

Verificação do ciclo inteiro:

```bash
cd infra-monitor-frontend
npm run e2e:n04 && npm run e2e:n05 && npm run e2e:n06   # exigem backend, ng serve e a senha em N0X_SENHA
```

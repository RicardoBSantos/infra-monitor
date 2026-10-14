# Preparação da carga real das unidades

Data: 2026-10-13. Investigação e preparação; a carga das demais unidades **não** foi executada.
Motor ICMP, Telegram e dispatcher desligados o tempo todo. Só a SEDE foi cadastrada, no banco novo.

> **Situação posterior (2026-10-14):** o `inframonitor-carga` foi destruído e recriado do zero
> (mesmo nome, porta e V1–V20). A SEDE desta rodada não existe mais: o banco tem SED e ITA,
> cadastradas pela API, e o backend da carga rodou com motor ligado e Telegram no grupo real. Ver
> [producao-sed-ita.md](producao-sed-ita.md). As perguntas da seção 5 sobre hub e parâmetros
> tiveram resposta parcial: ITA → SED, 30 s / 2000 ms / 3 / 2 validados em 4 h
> ([validacao-4h-equipamentos-reais.md](validacao-4h-equipamentos-reais.md)).

## 1. Banco da carga: novo, limpo, separado do dev

O banco de dev (`inframonitor-postgres`, porta 5434) tem 12 unidades e 222 equipamentos fictícios
cujos IPs colidem com a rede real do Sesc, e está em **V19** (a V20 nunca foi aplicada nele). A
carga real **não** vai para ele.

| | Dev (preservado) | Carga real (novo) |
|---|---|---|
| Container | `inframonitor-postgres` | `inframonitor-carga` |
| Criado por | `infra-monitor-backend/compose.yml` | `docker run` avulso (abaixo) |
| Porta | `0.0.0.0:5434` | `127.0.0.1:5436` (só local) |
| Database / usuário | `inframonitor` / `inframonitor` | `inframonitor_carga` / `inframonitor_carga` |
| Volume | `inframonitor-postgres-data` | `inframonitor-carga-data` |
| Flyway | V19 | V1 a V20, do zero |
| Backend apontado | — (nenhum boot nesta rodada) | jar na porta **8081**, motor/Telegram/dispatcher `false` |

```bash
docker run -d --name inframonitor-carga \
  -e POSTGRES_DB=inframonitor_carga -e POSTGRES_USER=inframonitor_carga -e POSTGRES_PASSWORD=<gerada> \
  -e TZ=UTC -e PGTZ=UTC -p 127.0.0.1:5436:5432 -v inframonitor-carga-data:/var/lib/postgresql/data \
  --restart unless-stopped --health-cmd "pg_isready -U inframonitor_carga -d inframonitor_carga" \
  postgres:16-alpine
```

Como o dev continua preservado:

- container, volume, porta e credenciais diferentes; nada no banco novo enxerga o dev;
- **não usar `docker compose` para o banco novo**: o `compose.yml` fixa
  `container_name: inframonitor-postgres`, e um `docker compose up` com outras variáveis recriaria o
  container do dev;
- o backend da carga recebe `DB_PORT=5436` explicitamente e roda fora do diretório do backend (o
  `.env`, que aponta para 5434, não é lido de qualquer forma);
- prova: contagem do dev antes e depois da rodada (só `SELECT`), idêntica —
  `unidades=12 equipamentos=222 monitores=222 medicoes=317080 flyway=19`.

Senhas do banco, `JWT_SECRET` e a senha do admin de bootstrap (`admin.carga@inframonitor.local`,
papel ADMIN, sem troca obrigatória) foram geradas aleatoriamente e ficam **fora do repositório**,
num arquivo de ambiente local da sessão. Para uso continuado, mover para um cofre/arquivo do
operador e trocar a senha do admin pela tela.

Quando houver servidor de produção, a recomendação é **rodar o mesmo script contra a API de lá**
(é idempotente), e não copiar este banco: este é o ensaio com dados reais.

## 2. Pré-checagem da V20 (passo 0 de [carga-real-procedimento.md](carga-real-procedimento.md))

Para o passo 0 ter onde rodar, o backend subiu primeiro com `--spring.flyway.target=19` (V1–V19,
`Successfully applied 19 migrations ... now at version v19`). Resultado da consulta do cabeçalho da
V20:

```
passo 0 (count violacoes): 0      equipamentos: 0      ck_equipamento_ip_ipv4: ausente
```

Depois, boot normal: `Migrating schema "public" to version "20 - check equipamento ip ipv4"`,
`Successfully applied 1 migration ... now at version v20`. Histórico Flyway `1..20` todos `success`,
constraint `ck_equipamento_ip_ipv4` presente, `/actuator/health` UP.

Leitura honesta: num banco vazio o 0 é trivial. O passo 0 continua obrigatório para o banco que já
tiver dados quando receber a V20 (um servidor de produção já existente); para este banco, o que
protege é a própria V20, já aplicada antes de qualquer cadastro.

## 3. Simulação com a SEDE

Entrada: [`tools/carga-real/levantamento/exemplo-sede.json`](../../tools/carga-real/levantamento/exemplo-sede.json).
O nome do monitor (`ping-principal`) não veio na especificação; segui o modelo do script.

Backend no ar (8081), motor desligado (`/api/v1/status` → `"motorLigado":false`), Telegram
desligado (`/notificacoes/telegram/configuracao` → `telegramEnabled:false`,
`dispatcherEnabled:false`, `destinoConfigurado:false`).

**Simulação (sem `--aplicar`):**

```
[dry-run] criados=4 pulados=0 divergentes=0 falhas=0 avisos=0
tipo         servidor                                criar   dry-run: seria criado
unidade      sede                                    criar   dry-run: seria criada
equipamento  sede::servidor ad core                  criar   dry-run: seria criado
monitor      sede::servidor ad core::ping-principal  criar   dry-run: seria criado
```

Banco depois da simulação: `tipos=0 unidades=0 equip=0 monitores=0` — nada escrito. Nenhum aviso:
IBGE 2800308 existe e a coordenada (-10,9197; -37,0522) cai dentro de Aracaju.

**`--aplicar`:** `[aplicar] criados=4 pulados=0 divergentes=0 falhas=0 avisos=0` →
`tipos=1 unidades=1 equip=1 monitores=1 medicoes=0`.

**`--aplicar` de novo (idempotência):** `[aplicar] criados=0 pulados=4 divergentes=0 falhas=0 avisos=0`,
os quatro itens com "ja existe na API e e igual ao arquivo"; contagens inalteradas.

Gravado no banco (conferido por SQL): unidade `SEDE` com endereço
`Rua Dom José Thomaz, 235 — São José` (travessão e acentos preservados), Aracaju/SE, IBGE 2800308,
-10.919700/-37.052200, sem hub; equipamento `Servidor AD Core`, 10.79.10.6, `srv-ad-01`, Dell
PowerEdge R650, `FICT-0001`, `Sala de TI — rack 1`, tipo Servidor, ativo; monitor `ping-principal`
ICMP 30 s / 2000 ms / 3 / 2, ativo. `medicao=0` e `notificacao=0`: nenhum ping, nenhum alerta.

## 4. O que o usuário precisa levantar

Planilha: [`tools/carga-real/levantamento/levantamento-carga-real.xlsx`](../../tools/carga-real/levantamento/levantamento-carga-real.xlsx)
(aberta e conferida no Excel desta máquina). Abas:

- `leia-me` — como preencher, o que o script confere e o que não confere;
- `tipos`, `unidades`, `equipamentos`, `monitores`, `conexoes` — linha 1 com o nome técnico da
  coluna (o mesmo do script), linha 2 com obrigatoriedade e regra, linha 3 com a SEDE como exemplo,
  preenchimento a partir da linha 4. Cabeçalho laranja = obrigatório, amarelo = recomendado,
  cinza = opcional. Listas/validações do Excel em `tipo` (ICMP), `uf`, `codigoIbge` (7) e `sigla` (≤ 30);
- `perguntas` — as perguntas abaixo, com coluna de resposta.

| Aba | Obrigatório | Recomendado | Opcional |
|---|---|---|---|
| tipos | nome | — | descricao |
| unidades | nome, sigla | codigoIbge, endereco, cidade, uf, latitude, longitude | descricao |
| equipamentos | unidadeSigla, tipoNome, nome | **ip** (sem IP o motor ignora o equipamento) | hostname, descricao, localizacao, numeroSerie, fabricante, modelo |
| monitores | unidadeSigla, equipamentoNome, tipo, nome, intervaloSegundos, timeoutMs | falhasParaIncidente, sucessosParaRecovery (vazio = 3 / 2) | — |
| conexoes | unidadeSigla, conectaSigla | — | — |

**Devolver o `.xlsx`, não CSV.** O parser do script só aceita vírgula como separador e o Excel em
português grava CSV com `;` (e decimal com vírgula). Na volta, a conversão `.xlsx → JSON` do modelo
é feita aqui e passa pela mesma simulação antes de qualquer `--aplicar`. A linha 3 (SEDE) pode
ficar: já existe e sai como `pulado`.

### O que o script valida antes de enviar

Obrigatórios por linha; sigla ≤ 30; coordenadas em par e na faixa; IBGE com 7 dígitos e existente
no GeoJSON de SE (coordenada fora do município = aviso, a coordenada vale); IPv4 de host (sem zero à
esquerda, 1º octeto 1–223); IP repetido na mesma unidade = erro, entre unidades = aviso; nome de
equipamento único por unidade e de monitor por equipamento; `tipo` = ICMP; intervalo 10–86400,
timeout 100–60000, falhas/sucessos 1–100; referências entre abas resolvidas (arquivo + API); ciclo
no grafo de hub (arquivo + API). Existente e igual → `pulado`; existente e diferente → `divergente`,
sem sobrescrever.

### O que ele não valida

Achados novos desta leitura, conferidos contra os DTOs e o `MonitorService` do backend — passam na
simulação e **só falham no `--aplicar`**, como 400/409 da API:

- tamanho máximo dos textos além da sigla (nomes 150, endereço 255, cidade 100, descrição 1000,
  hostname/localização 255, série/modelo 150, fabricante 100);
- `timeoutMs < intervaloSegundos × 1000` (`MonitorService.validarIntervaloTimeout`);
- nome de unidade repetido com siglas diferentes (unicidade case-insensitive de `nome` no banco).

E os já documentados no README do script: se o IP responde ping, se a coordenada é a real, IBGE
errado mas coerente com a coordenada, unicidade global de IP, concorrência com outro operador,
correção de dados existentes.

## 5. Perguntas antes da carga

1. **Quais unidades** entram (nome, sigla definitiva, endereço, município)? A sigla é a chave: mudar
   depois cria outra unidade.
2. **Qual equipamento representa cada unidade** no painel — o que define "unidade no ar"? Um por
   unidade, ou mais de um?
3. O IP desse equipamento é fixo e **responde ping a partir da máquina do Infra Monitor** (ICMP
   liberado no firewall/VPN)?
4. **Há topologia de hub?** Quais unidades chegam à rede passando por outra (interior → SEDE)? A SEDE
   é o hub de todas ou há hubs regionais? Sem resposta, `conexoes` fica vazia e o mapa não desenha
   ligações (pode ser preenchida numa segunda carga).
5. Os parâmetros da SEDE (30 s / 2000 ms / 3 / 2) valem para todas, ou há links lentos que pedem
   timeout maior?
6. Que **tipos** de equipamento existem (Servidor, Roteador, Switch, Firewall…), com grafia fixa?
7. Quem levanta latitude/longitude, e de que fonte?
8. A SEDE tem `numeroSerie` fictício (`FICT-0001`). O número real substitui? A carga não sobrescreve:
   a correção é pela tela.

## Estado ao final

- `inframonitor-carga` no ar (5436, só localhost), V20, com a SEDE. Backend da carga parado ao fim
  da rodada.
- Dev intocado (contagens idênticas, V19).
- Motor e Telegram nunca ligados. Apontar para o grupo real é decisão do usuário, depois.

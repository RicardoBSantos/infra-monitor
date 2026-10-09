# Rodada curta antes da carga real — desenho

Data: 2026-10-09. Branch: `fix/pre-carga-real` (continua a partir de `cce2fcd`). Sem push.

Regras de execução (iguais à rodada anterior): banco de dev (`inframonitor-postgres`, 5434) só
`SELECT`, nunca boot da aplicação apontando para ele; motor nunca contra o dev; Telegram real nunca
acionado; e2e contra Postgres descartável restaurado de `pg_dump` com o marcador
`app.banco_descartavel = 'sim'`.

Decisões do usuário (2026-10-09): timeline **híbrida**; **V20 com CHECK**; recusar
**0/8, 224+ e broadcast**; **validator espelho no formulário**.

---

## Item 1 — Timeline só afirma o que lista

### Problema

`features/incidentes/timeline/timeline.ts`:

- Incidente, `eventosDeFechamento` (`:180-182`): com `RECUPERACAO_AUTOMATICA` (ou legado com
  sequência parcial) o detalhe diz "N respostas consecutivas restabeleceram o monitor" mesmo quando
  `eventosDeRecuperacao` encontrou menos de N medições, ou nenhuma. Além disso N vem de
  `GET /monitores/{id}` — **configuração vigente**, não a da hora do fechamento.
- Latência, `eventosDeLatencia` (`:313-315`): mesma afirmação ("N medições consecutivas dentro do
  limiar encerraram o episódio") sem conferir a sequência listada.
- Latência, mais grave: `monitor_episodio_latencia.motivo_encerramento` (V19) tem `NORMALIZACAO`,
  `INCIDENTE`, `MANUTENCAO`, mas `EpisodioLatenciaResponse` não expõe o campo e o drawer passa
  `motivoEncerramento: null` (`incidente-detalhe-drawer.component.ts:475`). Episódio encerrado
  porque o monitor caiu (incidente aberto) ou por manutenção aparece como "Latência normalizada".
- Sequência parcial é numerada a partir de 1 (`recuperação 1/3`), embora as encontradas sejam as
  **últimas** da sequência — numeração errada.

### Regra (híbrida)

N só é citado quando as N medições da sequência estão na própria timeline.

**Incidente**, `motivoEncerramento`:

| Caso | Eventos de recuperação | Título | Detalhe |
|---|---|---|---|
| `MANUTENCAO` / `FECHAMENTO_MANUAL` / legado com autor | nenhum (inalterado) | inalterado | inalterado |
| `RECUPERACAO_AUTOMATICA`, sequência completa (= N) | numerados `k/N` | "Incidente fechado" | texto atual, agora verificável: "N respostas consecutivas restabeleceram o monitor" (plural/singular) |
| `RECUPERACAO_AUTOMATICA`, parcial (0 < k < N) | sem numeração: "Resposta ICMP" | "Incidente fechado" | "Recuperação automática registrada pelo motor; a sequência completa de respostas não está no histórico carregado" |
| `RECUPERACAO_AUTOMATICA`, nenhuma | nenhum | "Incidente fechado" | mesmo texto do parcial |
| legado (`null`, sem autor), completa | numerados | "Incidente fechado" | texto da completa |
| legado, parcial | sem numeração | "Incidente fechado" | `null` |
| legado, nenhuma | nenhum | "Incidente fechado" | `null` (inalterado) |
| N desconhecido (monitor não carregou) | nenhum (inalterado) | "Incidente fechado" | AUTO: texto do parcial; legado: `null` |

**Episódio de latência**, novo `motivoEncerramentoEpisodio`:

| Caso | Eventos | Título | Detalhe |
|---|---|---|---|
| `NORMALIZACAO`, completa | numerados `k/N` | "Latência normalizada" | texto atual: "N medições consecutivas dentro do limiar encerraram o episódio" |
| `NORMALIZACAO`, parcial/nenhuma | sem numeração: "Dentro do limiar" | "Latência normalizada" | "Normalização registrada pelo motor; a sequência completa de medições não está no histórico carregado" |
| `INCIDENTE` (severidade `critico`) | nenhum | "Encerrado pela abertura de incidente" | "O monitor deixou de responder e um incidente foi aberto. A latência não normalizou." |
| `MANUTENCAO` | nenhum | "Encerrado por manutenção" | "O equipamento entrou em manutenção e saiu da observação. Nenhuma normalização foi medida." |
| `null` (pré-V19), completa | numerados | "Latência normalizada" | texto da completa |
| `null`, parcial/nenhuma, ou N desconhecido | sem numeração (se houver) | "Episódio encerrado" | `null` |

Parcial = a caminhada de `sequenciaDeFechamento` parou antes de N (lacuna no histórico ou critério
quebrado). Nos dois tipos a parcial **não** recebe `k/N`.

Limite aceito e documentado: se N foi **reduzido** depois do fechamento, uma sequência de N
(atuais) ainda é encontrada e citada; a afirmação continua verificável na tela (as N estão
listadas), apenas não é o N que o motor usou.

### Backend

- `MotivoEncerramentoEpisodio` (já existe) entra em `EpisodioLatenciaResponse` como
  `motivoEncerramento` (último componente do record); `EpisodioLatenciaService:36` passa
  `episodio.getMotivoEncerramento()`. Conferir todos os construtores (main e test).
- Frontend: `LatencyClosureReason` em `core/models/api-enums.ts` (`Normalization = 'NORMALIZACAO'`,
  `Incident = 'INCIDENTE'`, `Maintenance = 'MANUTENCAO'`), campo em `EpisodioLatenciaResponse` TS,
  `OcorrenciaDetalhe`/`OcorrenciaTimeline.motivoEncerramentoEpisodio`, `deEpisodio` repassa,
  `deIncidente` passa `null`.

### Testes (com prova de reversão)

`timeline.spec.ts`: cada linha das duas tabelas. Prova de reversão: os testes novos rodados contra o
`timeline.ts` de `cce2fcd` (via `git stash` só do `.ts`) falham e a saída fica em
`Docs/validacao-producao/evidencias/timeline-1-sem-correcao.txt`; com a correção, verdes em
`timeline-2-com-correcao.txt`. Backend: teste do service/controller afirmando `motivoEncerramento`
no JSON do episódio. E2E Playwright (ambiente descartável): episódio `INCIDENTE` mostra o título
novo e não mostra "normalizada"; incidente AUTO sem sequência mostra o texto sem número.

---

## Item 2 — IP: só IPv4 monitorável entra

### Estado encontrado

- API já recusava não-IPv4 desde 2026-08-19 (`EquipamentoService.normalizarIp`), como
  `IllegalArgumentException` → 400 `INVALID_REQUEST` **sem `campos`** — o formulário não marca o
  campo. Mensagem genérica também para IPv6.
- **Zero à esquerda aceito** (`010.0.0.1`): o runner nativo Windows lê decimal (10.0.0.1); o `ping`
  do Linux (`ProcessoPingIcmpRunner`) lê octal (8.0.0.1). Mesmo cadastro, alvo diferente, sem erro.
- Banco: V4 trocou `INET NOT NULL` + `ck_equipamento_ip_e_host` por `VARCHAR(45)` NULL, para
  permitir equipamento sem IP e "manter o mapeamento JPA simples" (comentário da V4). Desde então o
  banco aceita qualquer texto por SQL direto (seed, manutenção manual).
- Script de carga já valida (`tools/carga-real/lib/validacao.mjs:28`), com a mesma lacuna de zero à
  esquerda e faixas.
- Formulário: só `required` + `maxLength(45)`; `classificarIp` é informativo.
- Dev (somente `SELECT`, 2026-10-09): **222 equipamentos, 0 com IP nulo, 0 fora da regra estrita
  nova** (0 IPv6, 0 zero à esquerda, 0 em 0/8 ou 224+). Rejeitar na API não quebra nenhum.

### Regra única

Entrada opcional; `null`/vazio/só espaços = sem IP (válido). Com valor, após `trim`, na ordem:

1. contém `:` → **"Apenas IPv4 é suportado: o monitoramento ICMP não sonda IPv6"**
2. não é `d.d.d.d` com 1-3 dígitos por octeto → **"IP deve ser um endereço IPv4 no formato 192.168.0.10"**
3. algum octeto > 255 → **"Cada octeto do IP vai de 0 a 255"**
4. octeto com zero à esquerda (`0` seguido de dígito) → **"Octeto com zero à esquerda é ambíguo (pode ser lido como octal): escreva 10.0.0.1, não 010.000.000.001"**
5. primeiro octeto 0 → **"A faixa 0.0.0.0/8 não é endereço de host"**
6. primeiro octeto ≥ 224 → **"Multicast, reservado ou broadcast (224.0.0.0 em diante) não é endereço de host monitorável"**

Loopback (127/8), privadas, link-local passam.

### Onde

- **Backend:** `equipamento/validation/Ipv4Monitoravel` com método estático puro
  `motivoDeRecusa(String) → String|null` (fonte única das mensagens) e anotação Bean Validation
  `@Ipv4Monitoravel` + validator, aplicada a `ip` em `CreateEquipamentoRequest` e
  `UpdateEquipamentoRequest` → erro de validação com `campos.ip` (formato `ErroResposta` existente).
  `EquipamentoService.normalizarIp` mantém trim/vazio→null e chama `motivoDeRecusa` como defesa para
  chamadores sem `@Valid`, lançando a mesma mensagem. Mensagens do backend seguem a convenção de
  acentuação já usada nas mensagens de validação do projeto (conferir na implementação).
- **Banco:** `V20__check_equipamento_ip_ipv4.sql` — `CHECK (ip_address IS NULL OR ip_address ~ '<regex>')`
  com a mesma regra (1º octeto 1-223, demais 0-255, sem zero à esquerda). Sem voltar a `INET`.
  Antes de aplicar em produção: consulta de pré-checagem documentada (mesma regex, deve dar 0).
  Teste Testcontainers: insert inválido por SQL é recusado pelo CHECK; válido e `NULL` passam.
- **Frontend:** `validarIpv4Monitoravel(valor): string | null` em `ip-helper.ts` (mesmas mensagens) e
  `ValidatorFn` no controle `ip`; mensagem sob o campo, envio bloqueado. A dica informativa
  continua. Erro de servidor em `campos.ip` já é aplicado por `aplicarErroDeFormulario`; conferir que
  o template exibe `errors.backend` e o novo erro.
- **Script de carga:** `ipv4Valido` vira `motivoRecusaIp` com as mesmas mensagens; linha inválida
  bloqueia antes de qualquer `POST`. README e `carga-real-procedimento.md` atualizados.
- Seeds SQL do repositório (e2e e dev-seed): conferir que todos os IPs passam na regra.

### Testes

Backend: tabela de casos do `motivoDeRecusa` (cada regra, limites 1/223/224/255, espaços, vazio,
nulo); `@WebMvcTest` do controller com IPv6 → 400 com `campos.ip` = mensagem IPv6; teste do CHECK
em Postgres real. Frontend: spec do validator e do form (erro sob o campo, sem chamada à API).
Script: `node --test` com os mesmos casos. Playwright: cadastro com IPv6 e com `010.0.0.1` mostra a
mensagem sob o campo.

---

## Item 3 — Monitoramento parado (só investigar)

Nenhum código. Documento `Docs/validacao-producao/monitoramento-parado-investigacao.md` com:

- Estado atual verificado no código: o que acontece hoje quando o processo cai, a máquina hiberna ou
  reinicia — incluindo o achado de que `DashboardReadRepository.ESTADOS` usa a última medição sem
  idade (painel segue **verde**), e o efeito em disponibilidade/SLA (`DisponibilidadeSqlRepository`)
  e em `janela_monitoramento`.
- Opções, cada uma com custo, impacto, o que detecta e o que **não** detecta, e comportamento em
  hibernação/reinício: (a) heartbeat gravado a cada ciclo; (b) verificação na subida comparando a
  última medição com o intervalo esperado; (c) "idade da última medição" no painel (status
  desatualizado); (d) vigia externo (cron/systemd timer/healthcheck que lê o heartbeat e alerta por
  Telegram independente do processo); (e) outras que surgirem na leitura.
- Recomendação combinada e o que fica sem cobertura.

---

## Fora de escopo

Lista unificada de incidentes exibir motivo do episódio; cidade × IBGE; dívida sub-ms.

## Entrega

Suítes backend (`./mvnw test`), frontend (`ng test`), script (`node --test`), build de produção,
Playwright no ambiente descartável; `Docs/validacao-producao/` atualizado (novo
`rodada-curta-pre-carga.md` + investigação do item 3 + procedimento de carga). Commits locais,
nada de push; reporte antes.

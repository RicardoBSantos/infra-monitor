# Rodada curta antes da carga real

Data: 2026-10-09. Branch `fix/pre-carga-real`, commits `86bcb86..` (spec e plano em
`Docs/superpowers/specs/2026-10-09-rodada-curta-pre-carga-design.md` e
`Docs/superpowers/plans/2026-10-09-rodada-curta-pre-carga.md`). Sem push.

Regras de execução: banco de dev (`inframonitor-postgres`, 5434) só `SELECT`, aplicação nunca subiu
contra ele (o Flyway aplicaria a V20); motor nunca contra o dev; Telegram real nunca acionado; e2e
contra Postgres descartável `infra-e2e` (5437) restaurado de `pg_dump` do dev, com o marcador
`app.banco_descartavel = 'sim'`, backend com `MONITORING_ENGINE_ENABLED`, `TELEGRAM_ENABLED` e
`NOTIFICATION_DISPATCHER_ENABLED` em `false`.

Decisões do usuário: timeline **híbrida**; **V20 com CHECK**; recusar **0/8, 224+ e broadcast**;
**validator espelho no formulário**.

## Item 1 — A timeline só afirma o que lista

### Defeito

- Incidente fechado por `RECUPERACAO_AUTOMATICA` dizia "N respostas consecutivas restabeleceram o
  monitor" mesmo quando o histórico carregado não continha a sequência (ou continha só parte dela).
  N vinha da configuração **atual** do monitor, não da hora do fechamento.
- Episódio de latência: o mesmo defeito ("N medições consecutivas dentro do limiar…") e um mais
  grave — `EpisodioLatenciaResponse` não expunha `motivo_encerramento` (V19), então episódio
  encerrado pela **abertura de incidente** ou por **manutenção** aparecia como "Latência
  normalizada".
- Sequência parcial era numerada a partir de 1 (`recuperação 1/3`), embora as encontradas fossem as
  últimas.

### Regra adotada (híbrida)

N só é citado quando as N medições estão na própria timeline. Sequência completa: texto e numeração
`k/N` de antes. Parcial ou ausente: eventos sem numeração ("Resposta ICMP" / "Dentro do limiar") e
detalhe que diz o que o dado prova — "Recuperação automática registrada pelo motor; a sequência
completa de respostas não está no histórico carregado" (incidente) ou "Normalização registrada pelo
motor; a sequência completa de medições não está no histórico carregado" (episódio). Episódio
`INCIDENTE`: "Encerrado pela abertura de incidente", severidade crítica, "A latência não
normalizou."; `MANUTENCAO`: "Encerrado por manutenção". Pré-V19 sem sequência: "Episódio
encerrado", sem detalhe. Tabelas completas na spec.

Limite aceito: se N for **reduzido** depois do fechamento, uma sequência de N atuais ainda é
citada; a afirmação continua verificável (as N estão listadas), só não é o N que o motor usou.
Se N foi **aumentado** depois do fechamento, a sequência real completa está listada, mas o texto diz que a
sequência completa não consta no histórico carregado: nenhum número é inventado, e a frase erra para o lado
da cautela; o texto foi mantido como especificado.

### Commits e provas

- `f5e5364` backend: `motivoEncerramento` no JSON do episódio (teste de controller).
- `19a2649` frontend: `timeline.ts`, enum `LatencyClosureReason`, drawer repassa o motivo.
- Prova de reversão: os testes novos contra o `timeline.ts` antigo —
  [evidencias/timeline-1-sem-correcao.txt](evidencias/timeline-1-sem-correcao.txt) (8 falham,
  26 passam); com a correção — [evidencias/timeline-2-com-correcao.txt](evidencias/timeline-2-com-correcao.txt)
  (34/34).
- Reverte a "Decisão registrada" de [correcoes-pre-carga-real.md](correcoes-pre-carga-real.md)
  (texto com N mesmo sem a sequência).

## Item 2 — IP: só IPv4 de host entra

### A premissa estava parcialmente desatualizada

A API já recusava não-IPv4 desde 2026-08-19 (`EquipamentoService.normalizarIp`). O que faltava:

- **Zero à esquerda** aceito: `010.0.0.1` é 10.0.0.1 para o runner nativo do Windows e 8.0.0.1 (octal)
  para o `ping` do Linux. Mesmo cadastro, alvo diferente, sem erro.
- **Faixas que não são host** (0/8, multicast, reservado, broadcast) aceitas.
- Erro como 400 `INVALID_REQUEST` **sem `fields`**: o formulário não marcava o campo; mensagem
  genérica também para IPv6.
- **Banco sem nenhuma regra.** A `V4__make_equipamento_ip_optional.sql` trocou `INET NOT NULL` +
  `ck_equipamento_ip_e_host` por `VARCHAR(45)` NULL para permitir equipamento sem IP e manter o
  mapeamento JPA simples; desde então SQL direto (seed, manutenção) grava qualquer texto.
- Formulário só com `required` + `maxLength(45)`; script de carga com as mesmas lacunas.

Contagem no dev (somente `SELECT`, 2026-10-09): **222 equipamentos, 0 com IP nulo, 0 fora da regra
nova** (0 IPv6, 0 zero à esquerda, 0 em 0/8 ou 224+). A regra mais estrita não quebra nenhum.

### Regra única (mesma ordem nas quatro camadas)

Vazio/nulo = sem IP (válido). Com valor, após `trim`: (1) contém `:` → apenas IPv4 é suportado;
(2) não é `d.d.d.d` com 1–3 dígitos → formato; (3) octeto > 255; (4) zero à esquerda; (5) primeiro
octeto 0; (6) primeiro octeto ≥ 224. Loopback, privadas e link-local passam.

| Camada | Onde | Commit |
|---|---|---|
| API | `equipamento/validation/RegraIpv4` (fonte das mensagens), `@Ipv4Monitoravel` nos DTOs de criação e edição → 400 `VALIDATION_ERROR` com `fields.ip`; `normalizarIp` repete a regra para chamador sem `@Valid` | `a39af6f` |
| Banco | `V20__check_equipamento_ip_ipv4.sql`: `ck_equipamento_ip_ipv4`, regex equivalente, `NULL` permitido, `VARCHAR(45)` mantido (sem voltar a `INET`) | `4b87a42` |
| Formulário | `motivoRecusaIp` + `validadorIpv4Monitoravel` em `ip-helper.ts`; mensagem sob o campo (`#equipamento-ip-erro`, `aria-invalid`, `aria-describedby`), envio bloqueado | `5c6d354`, `2eb8243`, `9077310` |
| Script de carga | `motivoRecusaIp` em `tools/carga-real/lib/validacao.mjs`; linha inválida é pulada (as demais seguem), como o README já documentava | `17f16e2` |

O teste do CHECK em Postgres real (`IpEquipamentoCheckPostgresIntegrationTest`, 17 casos) lê a
expressão com `pg_get_constraintdef` e confere que `RegraIpv4` e o banco concordam caso a caso;
sem a V20, 10 dos 17 falham.

**Antes de aplicar a V20 em produção**, rodar a pré-checagem do comentário da migration (mesma
regex): precisa dar 0, senão o Flyway falha na subida.

## Item 3 — Monitoramento parado (só investigação)

[monitoramento-parado-investigacao.md](monitoramento-parado-investigacao.md) (`858acef`,
`03d5396`). Achados principais: o painel fica **verde** com o motor parado (a última medição não
tem idade); o SLA conta o tempo parado como disponível (ou indisponível, se havia incidente aberto);
`/actuator/health` segue `UP`; o Telegram roda no mesmo processo. Recomendação em ordem: serviço
com reinício automático e máquina sem suspensão; idade da última medição no painel + indicador de
saúde do motor; vigia externo com Telegram próprio; alerta fora da máquina. Lacuna no SLA precisa de
migration e fica para depois da carga. O SO de produção não está confirmado.

## E2E (Playwright, ambiente descartável)

Commit `e548451`. Seeds `e2e/pre-carga-seed.sql` e `e2e/rodada-curta-seed.sql`.

- `npm run e2e:rodada-curta` — **11/11**: incidente AUTO sem respostas não cita número; episódio
  `INCIDENTE` diz "A latência não normalizou" e não mostra "Latência normalizada"; episódio
  `NORMALIZACAO` completo cita "2 medições consecutivas" (controle positivo); formulário recusa
  `2001:db8::1` e `010.0.0.1` com a mensagem sob o campo e nenhum `POST`; API recusa IPv6 e
  `224.0.0.1` com 400 `VALIDATION_ERROR` e o motivo em `fields.ip`; `" 10.250.0.7 "` é gravado como
  `10.250.0.7`; nenhum erro de página. Evidência em `infra-monitor-frontend/e2e/rodada-curta-evidence/`.
- Regressão `npm run e2e:pre-carga` — **17/17** (o incidente com sequência completa continua
  dizendo "2 respostas consecutivas restabeleceram o monitor").

## Suítes

Rodadas de 2026-10-09 sobre `e548451`:

| Suíte | Resultado |
|---|---|
| `./mvnw test` (backend, Testcontainers com Docker) | **648** testes, 0 falhas, 0 erros, 0 ignorados (75 classes); última rodada documentada: 590 |
| `npx ng test --watch=false` (frontend) | **450** testes em 50 arquivos, todos passando; última rodada documentada: 413 em 49 |
| `node --test test/*.test.mjs` (`tools/carga-real`) | **85** testes, todos passando |
| `npx ng build` (produção) | sucesso; bundle inicial **351,96 kB** bruto / **97,42 kB** transferido, igual à rodada anterior |
| `npm run e2e:rodada-curta` | **11/11** |
| `npm run e2e:pre-carga` (regressão) | **17/17** |

Aviso de build: só o budget de `mapa.component.scss` (95,78 kB contra 6 kB), preexistente e já
registrado em [correcoes-pre-carga-real.md](correcoes-pre-carga-real.md).

Durante a T5, uma rodada da suíte do frontend com a máquina carregada teve um timeout em
`app.routes.spec` (passa isolado); na rodada final acima, 450/450 sem falha.

## Pendências

- Débitos menores aceitos nas revisões por tarefa: mapeamento do drawer só coberto pelo e2e; caso de
  N desconhecido no episódio sem teste unitário; entrada com mais de 45 caracteres gera duas
  violações (`@Size` e `@Ipv4Monitoravel`), a mensagem em `fields.ip` depende da ordem; testes de
  limite no script (`0.1.2.3`, `255.255.255.255`, 223/224); dica informativa `classificarIp` e
  validador podem divergir em entrada malformada (cosmético).
- Formulário mantém `required` no IP, a API aceita sem IP (fora de escopo).
- Lista unificada de incidentes ainda não mostra o motivo do episódio; cidade × IBGE; dívida sub-ms.
- Monitoramento parado: nada implementado; ver recomendação acima.

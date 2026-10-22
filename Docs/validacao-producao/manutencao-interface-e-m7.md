# Manutenção pela interface e M7 — incidente manual fora de observação

Data: 2026-10-22 · Branch: `feat/manutencao-interface` · Design aprovado:
[2026-10-22-manutencao-interface-e-m7-design.md](../superpowers/specs/2026-10-22-manutencao-interface-e-m7-design.md).

A manutenção de equipamento já estava implementada e verificada no backend
([manutencao-verificacao-ponta-a-ponta.md](manutencao-verificacao-ponta-a-ponta.md)), mas
`EquipamentoApiService.startMaintenance`/`endMaintenance` não tinham chamador: não havia botão, e por isso
ela nunca foi usada no banco da carga. Esta rodada expõe a ação na tela e fecha o M7 da
[auditoria de concorrência](auditoria-concorrencia-ciclo-de-vida.md).

## 1. O que mudou

### Botão de manutenção

- **Lugar.** Os mesmos de ativar/desativar monitoramento: item novo no menu "…" da linha de Equipamentos
  (logo depois de "Desativar/Ativar monitoramento", antes do divisor de "Excluir") e botão novo no
  rodapé do drawer. No Mapa o drawer não tem ações de gestão: nada muda lá. O drawer não chama a API,
  emite `alternarManutencao`; a lista executa pelo mesmo caminho de hoje (diálogo de confirmação, depois a chamada).
- **Qual ação aparece.**

  | Estado da linha | Item |
  |---|---|
  | `emManutencao` | "Encerrar manutenção" (mesmo com `ativo = false`: sair tem de ser sempre possível) |
  | `ativo && !emManutencao` | "Iniciar manutenção" |
  | `!ativo && !emManutencao` | nenhum item (manutenção de equipamento não monitorado não tem efeito) |

  Sem permissão de gestão o item aparece desabilitado, como os demais.
- **Tom `primario` no botão de confirmar.** `ConfirmDialogComponent` ganhou o input
  `confirmTone: 'perigo' | 'primario'` (padrão `'perigo'`, então nenhum chamador anterior muda). A
  manutenção usa `primario` porque não é destrutiva nem irreversível (preserva o histórico e se desfaz
  pela mesma tela), mas também não restaura nada, o que descarta `--sucesso`. O azul casa com o tom `info` do badge
  `EM_MANUTENCAO`.
- **Confirmação nos dois sentidos**, com texto fiel ao código: iniciar avisa que o equipamento deixa de
  ser verificado por ICMP, que incidentes e episódios de latência abertos são encerrados com motivo
  Manutenção, que abertura já avisada no Telegram gera aviso de encerramento, que avisos pendentes são
  cancelados e que o período não conta na disponibilidade; encerrar avisa que a verificação volta na
  próxima varredura e que, se continuar fora do ar, o incidente nasce depois das falhas consecutivas configuradas.
- **Depois da ação.** Badge `EM_MANUTENCAO` já existente (coluna de status, cabeçalho do drawer, "Estado
  atual"), aviso de sucesso e recarga da lista. Erro da API aparece dentro do diálogo.

### Campo `emManutencao` no read-model

`DashboardEquipamentoLista` não tinha `emManutencao`, e o status sozinho não basta: o
`OperationalStatusResolver` dá precedência a `DESABILITADO` sobre `EM_MANUTENCAO`, e a entrada em
manutenção não valida `ativo`. Um equipamento inativo em manutenção apareceria como "Iniciar" e não
haveria como sair pela tela. O campo `boolean emManutencao` foi acrescentado na query
(`DashboardReadRepository.equipamentos`, que já agrupava por `e.em_manutencao`), no response, no
mapeamento do serviço e na interface do front.

### M7 — incidente manual fora de observação

- **Decisão:** `POST /incidentes` recusa com 409 `BUSINESS_CONFLICT`.
- **Justificativa.** O motor não mede equipamento em manutenção nem monitor/equipamento inativo. Um
  incidente manual criado ali nunca seria fechado automaticamente: ficaria aberto durante a manutenção
  inteira e além dela, contando no SLA, e ainda dispararia `INCIDENTE_ABERTO` no Telegram. "Permitir
  sem notificar" conserta só a mensagem e deixa o incidente órfão.
- **Predicado.** O mesmo de `IncidenteRepository.inserirSeElegivel`: `m.ativo AND e.ativo AND NOT
  e.em_manutencao`. Uma mensagem por condição (monitor inativo, equipamento inativo, equipamento em manutenção).
- **Lock.** `IncidenteService.criar` lê a elegibilidade antes do `existsBy` com
  `IncidenteRepository.travarElegibilidadeParaAbertura`, uma consulta nativa com `FOR UPDATE OF e`.
  É a mesma linha e a mesma ordem de lock de `entrarEmManutencao` (equipamento antes de incidente): a
  corrida descrita no M7 fica serializada, sem ciclo. Desfechos legítimos: manutenção primeiro, e a
  criação recebe 409; criação primeiro, e a entrada em manutenção fecha o incidente com motivo `MANUTENCAO`.

## 2. Dívidas registradas, sem correção

1. **4 violações da invariante da janela no dev** (monitores 1, 4, 7, 9). Legado de SQL direto e de
   antes da guarda de setembro; o banco da carga está limpo.
   *Gatilho:* só se o dev passar a ser usado para medir SLA.
2. **Fila de corrida para rodada própria**, nesta ordem: **A4** primeiro (a abertura sai e o
   encerramento nunca nasce; é a mais relevante para a operação), depois A3, A5, M1 e M3–M6.
   O comentário de `NotificacaoRepository` sobre a reserva já aponta o A4.
   *Gatilho:* antes do primeiro uso da manutenção no banco da carga com o Telegram ligado — é ali que o
   A4 deixa o grupo com a abertura e sem o encerramento.
3. **Contador por unidade multiplica equipamento com mais de um monitor** (o join equipamento × monitor
   acontece antes da contagem). Latente: ninguém tem mais de um monitor hoje.
   *Gatilho:* o primeiro equipamento com mais de um monitor ativo.
4. **"Ativar monitoramento" confirma com botão `--perigo`** (vermelho) sem ser destrutivo. Inconsistência
   visual, não alterada. *Gatilho:* a próxima revisão visual do diálogo (o `confirmTone` já permite trocar o tom).
5. **Unidade inativa não barra a abertura de incidente**, nem manual nem pelo motor: o predicado olha
   monitor e equipamento, não a unidade. *Gatilho:* decisão de produto sobre o que "unidade inativa" significa para o monitoramento.
6. **Latência da lista não respeita manutenção nem desativação.** `/dashboard/equipamentos` devolve a
   latência da última medição mesmo com o equipamento em manutenção ou desabilitado (a captura
   `03-lista-em-manutencao.png` mostra "360 ms" ao lado do badge), enquanto o drawer mostra "—".
   Preexistente; esta rodada não mexeu na coluna. *Gatilho:* a próxima mudança no read-model da lista.
7. **O aviso de sucesso some ao fechar o drawer.** Fechar navega para `/equipamentos`, rota irmã de
   `/equipamentos/:id`, e a lista é recriada (dívida já anotada em `equipamento-list.component.ts`,
   "rotas IRMÃS"). Vale para ativar/desativar desde antes; o e2e confere o aviso antes de fechar.
   *Gatilho:* a correção das rotas de detalhe como filhas, como já feito em `/incidentes`.
8. **O lock do M7 serializa só com a entrada em manutenção e com a desativação/atualização do equipamento**
   (ambas escrevem a linha de `equipamento`). `MonitorService.desativar` × `criar` não é serializado
   (`m.ativo` não é travado): um monitor desativado no meio do `criar` pode deixar incidente aberto, como
   no `inserirSeElegivel` do motor. *Gatilho:* a desativação de monitor passar a ocorrer durante a
   operação, e não só no cadastro.

## 3. Prova de reversão do M7

Os testes de integração da guarda (`AberturaManualElegibilidadePostgresIntegrationTest`, Postgres real)
foram executados com e sem a guarda; as saídas brutas estão em
`evidencias/`:

- [m7-reversao-sem-guarda.txt](evidencias/m7-reversao-sem-guarda.txt): sem a guarda, os testes ficam vermelhos;
- [m7-reversao-sem-lock.txt](evidencias/m7-reversao-sem-lock.txt): com o predicado mantido e só o
  `FOR UPDATE OF e` removido, 21 de 25 falham — o teste determinístico
  `travarElegibilidadeBloqueiaEntrarEmManutencaoAteOCommit` (uma transação segura a linha; a entrada em
  manutenção tem de esperar, com `pg_locks` mostrando lock não concedido) e as 20 repetições da corrida;
- [m7-reversao-com-guarda.txt](evidencias/m7-reversao-com-guarda.txt): com guarda e lock restaurados,
  40/40 passam, e a corrida registra os dois desfechos legítimos (`manutencao-primeiro`, `criar-primeiro`).

A prova da guarda sozinha não bastava: em sequência o predicado já recusa, e o desfecho ilegítimo do
M7 (incidente ABERTO dentro da manutenção) só aparece sob corrida — é o lock que o impede.

## 4. Verificação

Em `315340f`, com Docker ativo:

| Suíte | Resultado |
|---|---|
| Backend `./mvnw test` | 685 run, 0 falhas, 0 erros, 0 puladas; sem o bloco `!!` de Docker indisponível |
| Frontend `ng test` | 55 arquivos, 594/594 |
| Frontend `ng build` | OK; único aviso é o budget de `mapa.component.scss` (97,27 kB), preexistente — o arquivo não é tocado por este branch |
| e2e `npm run e2e:manutencao-interface` | 20/20 no clone do dev (`SWI-07-U1`); 20/20 + 20/20 no clone da carga (dois equipamentos) |

O roteiro (`infra-monitor-frontend/e2e/manutencao-interface.cjs`) navega só por clique: menu "…" →
"Iniciar manutenção" → diálogo (título, os quatro efeitos no texto, botão `--primario`) → badge na
linha e aviso → menu (agora "Encerrar") → "Ver" → drawer com badge e "Encerrar manutenção" → diálogo →
encerra → foco continua na gaveta → Escape fecha → linha sem badge. Capturas versionadas, de dados
fictícios: [`e2e/manutencao-interface-evidence/`](../../infra-monitor-frontend/e2e/manutencao-interface-evidence/).

O e2e achou dois defeitos, corrigidos antes do fechamento:

- **Foco perdido depois de agir pelo drawer.** O rodapé tinha dois `<button>` em `@if/@else`; ao
  recarregar a lista o elemento focado era destruído, o foco caía no `<body>` e o Escape parava de fechar
  a gaveta. Ativar/desativar não sofre disso porque é um único botão com rótulo interpolado. Corrigido do
  mesmo jeito (um botão), com spec de identidade do elemento e o caso `foco-na-gaveta` no e2e.
- **Faixa vermelha no diálogo primário.** O acento superior do `ConfirmDialog` era `--im-danger` fixo;
  agora segue o `confirmTone`.

## 5. Exercício na carga

**Não foi no banco vivo.** O único usuário da carga (`admin.carga@inframonitor.local`) devolve 401 com a
senha do `~/.inframonitor-carga/env.sh` — a senha foi trocada pela interface. Criar outro admin,
redefinir a senha ou forjar um JWT com o segredo do `env.sh` no ambiente que o usuário usa no dia a dia
foi considerado ação sensível e não foi feito. O exercício rodou num **clone `pg_dump` da carga**
(container descartável, já removido), com o jar deste branch, admin de bootstrap próprio e motor,
Telegram e dispatcher desligados. A stack do usuário (8080/4200) não foi tocada.

Como a carga não tinha incidente aberto, o cenário foi montado no clone: incidente manual nos monitores
dos equipamentos 1 e 4, e a abertura do 4 marcada `ENVIADA` (como se o dispatcher já a tivesse
mandado), para exercitar os dois ramos de notificação. Manutenção iniciada e encerrada **pela tela**
nos dois (e2e 20/20 em cada). Estado depois, por SQL:

| | Equipamento 1 (abertura pendente) | Equipamento 4 (abertura já enviada) |
|---|---|---|
| Incidente | `FECHADO`, `motivo_encerramento = MANUTENCAO` | `FECHADO`, `MANUTENCAO` |
| `INCIDENTE_ABERTO` | `PENDENTE` → `CANCELADA` | segue `ENVIADA` |
| Aviso de encerramento | nenhum (nada tinha saído) | `INCIDENTE_ENCERRADO_MANUTENCAO` criada, `PENDENTE` ("🔧 Incidente encerrado: equipamento entrou em manutenção …") |
| Janela | fechada no início da manutenção, nova aberta no encerramento | idem |
| `em_manutencao` ao final | `false` | `false` |

**M7 pela API:** equipamento 3 em manutenção → `POST /incidentes` → 409 `BUSINESS_CONFLICT`
"Nao e possivel abrir incidente porque o equipamento esta em manutencao"; zero incidentes e zero
notificações no monitor 3.

**SLA:** no equipamento 2, incidente aberto em T0, manutenção de T0+20 s a T0+80 s, relatório de
T0 a T0+100 s: `tempoMonitorado = 20 s`, `tempoIndisponivel = 20 s`. Os 60 s de manutenção ficaram fora
do denominador e o incidente parou de contar no início da manutenção. Os 20 s depois do encerramento
também não contaram: o SQL de disponibilidade começa cada janela na **primeira medição** dentro dela
(`greatest(j.inicio_em, min(md.executado_em))`, ver `InicioDaObservacao`), e com o motor desligado no
clone não houve medição. Comportamento de projeto, não defeito.

**O que só o banco vivo mostraria:** a mensagem de encerramento saindo de fato para o grupo do Telegram
pelo dispatcher. Para fazer o exercício no banco da carga basta entrar com o admin atual e repetir o
fluxo das capturas; antes disso vale considerar o A4 (§2, item 2).

As capturas do clone da carga têm nomes e IPs da rede real e ficaram fora do repositório. Foram feitas
antes da correção da faixa do diálogo, então a faixa aparece vermelha nelas; o comportamento é o mesmo.

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
   *Gatilho:* a rodada de corrida, antes de ampliar o uso real da manutenção.
3. **Contador por unidade multiplica equipamento com mais de um monitor** (o join equipamento × monitor
   acontece antes da contagem). Latente: ninguém tem mais de um monitor hoje.
   *Gatilho:* o primeiro equipamento com mais de um monitor ativo.
4. **"Ativar monitoramento" confirma com botão `--perigo`** (vermelho) sem ser destrutivo. Inconsistência
   visual, não alterada. *Gatilho:* a próxima revisão visual do diálogo (o `confirmTone` já permite trocar o tom).
5. **Unidade inativa não barra a abertura de incidente**, nem manual nem pelo motor: o predicado olha
   monitor e equipamento, não a unidade. *Gatilho:* decisão de produto sobre o que "unidade inativa" significa para o monitoramento.

## 3. Prova de reversão do M7

Os testes de integração da guarda (`AberturaManualElegibilidadePostgresIntegrationTest`, Postgres real)
foram executados com e sem a guarda; as saídas brutas estão em
`evidencias/`:

- [m7-reversao-sem-guarda.txt](evidencias/m7-reversao-sem-guarda.txt): sem a guarda, os testes ficam vermelhos;
- [m7-reversao-com-guarda.txt](evidencias/m7-reversao-com-guarda.txt): com a guarda restaurada, passam.

## 4. Verificação

Preenchido na verificação final.

## 5. Exercício na carga

Preenchido na verificação final.

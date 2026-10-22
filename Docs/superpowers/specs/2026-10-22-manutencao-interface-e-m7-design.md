# Manutenção pela interface, M7 e correção de documentação — design

Data: 2026-10-22 · Branch: `feat/manutencao-interface` (a partir de `origin/main` b380ea8) · Aprovado em chat.

## Contexto

A manutenção de equipamento está implementada e verificada no backend (`PATCH /equipamentos/{id}/manutencao/iniciar|encerrar`),
mas `EquipamentoApiService.startMaintenance`/`endMaintenance` não têm chamador: não há botão, e por isso ela nunca foi usada no
banco da carga. Em paralelo, o M7 da auditoria de concorrência (`IncidenteService.criar` não valida `ativo` nem `em_manutencao`)
continua aberto, e a documentação do ciclo ainda chama a manutenção de proposta.

## Objetivo e critério de sucesso

1. Operador coloca e tira equipamento de manutenção pela tela de Equipamentos (menu da linha e drawer), com confirmação que diz
   o que vai acontecer.
2. `POST /incidentes` recusa com 409 `BUSINESS_CONFLICT` monitor inativo, equipamento inativo e equipamento em manutenção, sem
   criar incidente nem notificação, inclusive sob corrida com a entrada em manutenção.
3. Documentação sem as afirmações vencidas; registros novos das dívidas que ficam.
4. Prova: specs do front, suíte do backend com Docker (contagem completa), e2e Playwright por clique com screenshots, e
   exercício real no banco da carga conferido por SQL (incidente, janela, notificação, SLA).

## 1. Interface de manutenção

### Lugar

Os mesmos de ativar/desativar hoje:

- Menu "…" da linha (`EquipamentoListComponent.itensDoMenu`): item novo logo depois de "Desativar/Ativar monitoramento", antes
  do divisor de "Excluir".
- Rodapé do drawer (`equipamento-detalhe-drawer.component.html`, `footer.gaveta__acoes`): botão novo depois de
  "Desativar/Ativar monitoramento", sob a mesma condição `acoesDeGestao() && authState.canManageInventory()`. No Mapa
  `acoesDeGestao` é falso: nada muda lá.
- O drawer não chama a API: emite um output (`alternarManutencao`), como já faz com `alternarEquipamento`, e a lista executa a
  ação pelo mesmo `executarAcao` → ConfirmDialog → `confirmarAcao`.

### Qual ação aparece

| Estado da linha | Item |
|---|---|
| `emManutencao` | "Encerrar manutenção" (mesmo com `ativo = false`: sair tem de ser sempre possível) |
| `ativo && !emManutencao` | "Iniciar manutenção" |
| `!ativo && !emManutencao` | nenhum item (manutenção de equipamento não monitorado não tem efeito) |

Sem permissão de gestão: `desabilitado: true`, como os demais itens.

### Campo novo no read-model

`DashboardEquipamentoLista` não tem `emManutencao`, e o status não basta: `OperationalStatusResolver` dá precedência a
`DESABILITADO` sobre `EM_MANUTENCAO`, e a entrada em manutenção não valida `ativo`. Um equipamento inativo em manutenção
apareceria como "Iniciar". Acrescenta-se `boolean emManutencao` em:

- `DashboardReadRepository.equipamentos` (a query já agrupa por `e.em_manutencao`) e no record de linha dela;
- `DashboardEquipamentoListaResponse` e no mapeamento de `DashboardService.equipamentos`;
- `DashboardEquipamentoLista` (front) e nas fixtures de spec que montam a interface.

### Estilo

- Gatilho: `.botao` neutro no rodapé (os vizinhos são neutros); item comum no menu (o menu não tem variante de cor além de
  `destrutivo`).
- Botão de confirmar do diálogo: `.botao--primario`. Não é `--perigo` (reversível, preserva histórico), não é `--sucesso`
  (não restaura nada); o azul casa com o tom `info` do badge `EM_MANUTENCAO`.
- `ConfirmDialogComponent` ganha `confirmTone = input<'perigo' | 'primario'>('perigo')`, aplicado como classe do botão de
  confirmar. Padrão `'perigo'`: nenhum chamador atual muda.

### Confirmação (sempre, nos dois sentidos)

- Iniciar — título `Iniciar manutenção de {nome}?`, botão `Iniciar manutenção`, mensagem:
  "{nome} deixa de ser verificado por ICMP e não gera incidentes nem alertas até a manutenção ser encerrada. Incidentes e
  episódios de latência abertos são encerrados com motivo Manutenção; se a abertura já foi avisada no Telegram, sai um aviso
  de encerramento, e avisos ainda não enviados são cancelados. O período não conta no relatório de disponibilidade."
- Encerrar — título `Encerrar manutenção de {nome}?`, botão `Encerrar manutenção`, mensagem:
  "{nome} volta a ser verificado por ICMP na próxima varredura. Se continuar fora do ar, um incidente é aberto depois das
  falhas consecutivas configuradas no monitor."

Os textos são fiéis ao código: o motor filtra `e.emManutencao = false` (`MonitorRepository:35`); a entrada fecha incidentes,
episódios e janela e trata notificações (`EquipamentoService.entrarEmManutencao`); a saída reabre a janela.

### Durante e depois

- Badge existente `EM_MANUTENCAO` ("Em manutenção", tom `info`) na coluna de status, no cabeçalho do drawer e em "Estado atual".
  Nenhum badge local.
- Sucesso: aviso `{nome} em manutenção.` / `Manutenção de {nome} encerrada.` e recarga da lista (mesmo fluxo de hoje).
- Erro: mensagem da API dentro do diálogo (`erroAcao`).
- Sai-se pela mesma ação, que passa a dizer "Encerrar manutenção".

## 2. M7 — incidente manual fora de observação

Decisão: **recusar** com 409 `BUSINESS_CONFLICT`.

Justificativa: o motor não mede equipamento em manutenção nem monitor/equipamento inativo. Um incidente manual criado ali nunca
seria fechado automaticamente; ficaria aberto pela manutenção inteira e além dela, contando no SLA, e ainda dispararia
`INCIDENTE_ABERTO` no Telegram. "Permitir sem notificar" conserta só a mensagem e deixa o incidente órfão.

Predicado: o mesmo de `IncidenteRepository.inserirSeElegivel` — `m.ativo AND e.ativo AND NOT e.em_manutencao`. Unidade inativa
fica de fora, como no motor (registrado como observação).

Implementação em `IncidenteService.criar`, antes do `existsBy`:

1. Lê a elegibilidade com `SELECT m.ativo, e.ativo, e.em_manutencao FROM monitor m JOIN equipamento e ... WHERE m.id = :id
   FOR UPDATE OF e` (query nativa nova no `IncidenteRepository`). Mesma linha e mesma ordem de lock de
   `entrarEmManutencao` (equipamento antes de incidente): serializa a corrida descrita no M7, sem ciclo.
2. Uma mensagem por condição, no estilo de `MENSAGEM_INCIDENTE_ABERTO`:
   - `Nao e possivel abrir incidente porque o monitor esta inativo`
   - `Nao e possivel abrir incidente porque o equipamento esta inativo`
   - `Nao e possivel abrir incidente porque o equipamento esta em manutencao`
3. O resto do fluxo (existsBy, saveAndFlush, notificação) fica igual.

Testes (Postgres real, `@RequerDocker`):

- um caso por condição: 409 com a mensagem certa, zero linhas novas em `incidente` e em `notificacao`;
- caso elegível continua criando incidente e notificação;
- corrida: `entrarEmManutencao` × `criar` com barreira; desfecho legítimo é só "manutenção primeiro → 409" ou "criar primeiro →
  incidente fechado com motivo MANUTENCAO"; nunca incidente ABERTO com equipamento em manutenção;
- prova de reversão: sem a guarda, os testes ficam vermelhos (saída registrada no relatório).

## 3. Documentação

Corrigir:

- `Docs/validacao-producao/validacao-producao.md:5,15` — manutenção implementada (link para a verificação ponta a ponta e para
  este design), não "proposta (ainda não implementada)".
- `Docs/superpowers/specs/2026-09-22-manutencao-e-fechamento-icmp-design.md:301-302` e
  `Docs/validacao-producao/manutencao-proposta.md:648,653` — "fecharAutomaticamente sem CAS" e "excluir não fecha janela"
  resolvidos (`riscos-execucao-correcoes.md` 1a e janela na exclusão); nota datada, sem reescrever o histórico.
- `LimiteDeEsperaPorLock` javadoc — a normalização do episódio já é CAS (`encerrarPorNormalizacaoSeAberto`).
- `NotificacaoRepository:93-94` — "a mensagem sai. Aceito e deliberado" pressupõe o aviso de encerramento, que o A4 mostra que
  pode não nascer; o comentário passa a apontar o A4.
- `auditoria-concorrencia-ciclo-de-vida.md` — M7 marcado como corrigido, com referência.

Registrar sem corrigir (em `Docs/validacao-producao/manutencao-interface-e-m7.md`, novo, indexado):

- 4 violações da invariante no dev (monitores 1, 4, 7, 9): legado de SQL direto e de antes da guarda de setembro; banco da carga
  limpo.
- Fila de dívidas de corrida A3, A4, A5, M1, M3–M6 para rodada própria, A4 primeiro (abertura sai, encerramento nunca).
- Contador por unidade multiplica equipamento com mais de um monitor: latente; gatilho = primeiro equipamento com mais de um
  monitor ativo.
- `ConfirmDialog` de "Ativar monitoramento" usa `--perigo` (vermelho) para ação não destrutiva: inconsistência registrada, não
  alterada.
- Unidade inativa não barra abertura de incidente (nem manual, nem motor).

## Verificação

- Front: specs de `EquipamentoListComponent`, drawer e `ConfirmDialogComponent` (itens por estado, tom do botão, chamadas à API,
  mensagens).
- Back: integração do M7 e do campo `emManutencao` no `/dashboard/equipamentos`; suíte completa com Docker.
- e2e `e2e/manutencao-interface.cjs`: login → Equipamentos → menu → Iniciar → diálogo → badge → drawer → Encerrar; screenshots
  em `e2e/manutencao-interface-evidence/`.
- Carga (Postgres 127.0.0.1:5436, jar em 8081, sem derrubar o dev): iniciar pela tela e conferir por SQL incidente
  (`motivo_encerramento = MANUTENCAO`), janela fechada/reaberta, notificações (`CANCELADA` ou
  `INCIDENTE_ENCERRADO_MANUTENCAO`) e relatório de SLA.

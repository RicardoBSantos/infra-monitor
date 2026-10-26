# Manutenção agendada — pendências

Decisões de produto que o desenho não toma sozinho, e dívidas deixadas de fora de propósito.
Cada uma traz a recomendação e o que destrava.

## Decididas em 2026-10-22

- **P-01** aprovada (MA01). **P-04** 72 h, configurável por variável (MA15). **P-06** aceita, com 409
  acionável (MA16). **P-09** OPERADOR e ADMIN; rota nas listas de `SecurityConfiguration`.
- **P-02** adiada para a F3: avisar janela **e** botão manual.

## Decisões de produto (registro original)

| # | Pergunta | Recomendação | Bloqueia |
|---|---|---|---|
| P-01 | Regra efetiva = manual OR janela ativa (MA01) | Aprovar. É a sua inclinação, materializada com CHECK | F1 |
| P-02 | Telegram: avisar início e fim da janela? E o botão manual, que hoje não avisa ninguém? Janela de unidade com N equipamentos fora gera N avisos `INCIDENTE_ENCERRADO_MANUTENCAO` + o da janela: suprimir os individuais? | Avisar início e fim, uma mensagem por janela; botão manual passa a avisar também; manter os individuais na primeira versão e medir o ruído | F3 |
| P-03 | Botão manual precisa de histórico (quem ligou, quando, por quê)? | Sim, mas não agora. Caminho: manual vira janela sem fim (alternativa de MA01) | Nada |
| P-04 | Duração máxima de uma janela? | 72 h. Janela de semanas é desativação disfarçada e esconde equipamento morto | F1 (validação) |
| P-05 | Antecedência mínima / permitir "começar agora"? | Permitir agora (tolerância de 5 min no passado) | F1 |
| P-06 | Agendador desligado por padrão + criação recusada (MA07) aceitável? Em produção alguém precisa ligar `MANUTENCAO_AGENDADA_ENABLED` | Sim, e entrar no README de variáveis junto com o motor | F1 |
| P-07 | Relatório precisa dizer *qual* janela fechou cada incidente? | Não por ora. Se sim, `incidente.manutencao_agendada_id` | F4 |
| P-08 | Corrigir `unidade.ativo` ignorado pelo motor? | Sim, em ciclo próprio, depois da F1 | Nada aqui |
| P-09 | Quem agenda: OPERADOR e ADMIN, ou só ADMIN? | Os dois, como o botão manual | F1 (segurança) |
| P-10 | Janela `EXPIRADA` (sistema fora a janela inteira) deve gerar algum aviso além do badge? | Só o badge e o log WARN; o aviso de verdade é o da dívida de monitoramento parado | Nada |

## Dívidas registradas

- **Monitoramento parado** continua sem detecção (`Docs/validacao-producao/monitoramento-parado-investigacao.md`).
  O desenho só ganha dela um subproduto: atraso de ativação/encerramento datado.
- **`unidade.ativo` ignorado** pelo motor, pelos INSERTs condicionais, pelo M7 e pela janela de SLA
  (P-08, MA14).
- **Fuso de entrada**: início/fim digitados no fuso de `app.reports.timezone`. Se um dia houver
  unidade em outro fuso, a tela precisa mostrar o fuso da unidade.
- **Exclusão de equipamento/unidade com janela no histórico** passa a ser recusada (409). Se isso
  incomodar a operação, a alternativa é permitir quando só houver janelas `CANCELADA`/`EXPIRADA`.

## F2 (entregue em 2026-10-26)

Decisões da F2: MA19 a MA26. Dívidas encontradas, nenhuma bloqueia:

- **Gaveta do Mapa mostra "Origem desconhecida"** com janela ativa: `resumoDoEquipamento()` não passa os
  campos da janela. Vem da F1; achado no e2e da Task 9.
- **Foco não é resgatado** quando `carregar(true)` termina em erro em `/manutencoes` (menor).
- **Aviso de preset** diz "da janela anterior" mesmo em preset que não é continuação (na prática não ocorre).
- **Edição recusada** quando a unidade da própria janela foi desativada (território da P-08; limite conhecido).
- **Banner da unidade não recarrega** se o roteador reaproveitar o componente para outro `:id` (mesmo padrão
  do store existente).
- **"Os dois desfechos" de C1 a C3** é garantido pela evidência, não afirmado pelo teste (idioma da F1).
- **Exercício no banco da carga** com motor e Telegram ligados em outro processo notifica o grupo de verdade:
  escolher equipamento online e sem incidente aberto (ver "Efeito colateral" na evidência).

## F3 (implementada e exercitada em clone (Telegram mock) em 2026-10-26)

- **P-02 fechada** (MA27 a MA36): uma mensagem por janela no início, no fim e na alteração do fim; o botão manual
  avisa ao ligar e ao desligar; os avisos individuais `INCIDENTE_ENCERRADO_MANUTENCAO` / `LATENCIA_ENCERRADA_MANUTENCAO`
  foram **mantidos** e o ruído será medido (consulta no spec da F3, §8, após duas semanas em produção).
- **P-03 atendida em parte**: o botão manual ganhou histórico (`manutencao_manual`, MA30 e MA36), sem motivo digitado
  (fora de escopo). Continua sem "por quê".
- **V23 não está no banco da carga** (`inframonitor-carga`): a 8080 roda código da V22 com dispatcher e Telegram reais, e
  linha F3 lá iria ao grupo e quebraria o enum do código antigo. Aplicar a V23 e trocar a 8080 para a F3 é decisão do
  usuário, depois do formato conferido. Ver "Rollback" no README do backend.
- Dívidas menores e pontos de atenção da F3 estão em "Pendências conhecidas" de
  `Docs/validacao-producao/manutencao-agendada-f3.md`. Nenhuma bloqueia.
- **Fora de escopo, continua aberto**: silenciar avisos por janela; aviso de "agendada"; motivo no botão manual;
  relatório de manutenção (F4, P-07).

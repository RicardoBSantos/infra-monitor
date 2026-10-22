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
